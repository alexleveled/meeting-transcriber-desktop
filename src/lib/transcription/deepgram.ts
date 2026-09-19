import type { Provider } from "@/lib/types";
import {
  pcm16BytesToMs,
  type CloseInfo,
  type ConnectOptions,
  type FinalUtterance,
  type TranscriptionProvider,
} from "./provider";

/**
 * Deepgram streaming provider — same interface as OpenAIRealtimeProvider. Opens a WebSocket
 * directly to Deepgram authenticated with a short-lived access token (minted server-side via
 * /v1/auth/grant) passed as the `token` subprotocol. Audio is sent as raw linear16 binary
 * frames (no base64). Deepgram reports word-level timings, so utterance start/end come straight
 * from the results.
 */

function buildUrl(model: string, diarize?: boolean): string {
  const params = new URLSearchParams({
    model,
    encoding: "linear16",
    sample_rate: "24000",
    channels: "1",
    interim_results: "true",
    smart_format: "true",
    punctuate: "true",
    vad_events: "true",
    // Emit an UtteranceEnd event after 1s of silence so we can flush a completed utterance.
    utterance_end_ms: "1000",
  });
  // Only appended when asked, so a non-diarized connection's URL is unchanged.
  if (diarize) params.set("diarize", "true");
  return `wss://api.deepgram.com/v1/listen?${params.toString()}`;
}

interface DgWord {
  start: number;
  end: number;
  word: string;
  punctuated_word?: string;
  speaker?: number;
}
interface DgResults {
  type: "Results";
  channel: { alternatives: Array<{ transcript: string; words?: DgWord[] }> };
  is_final: boolean;
  speech_final?: boolean;
  start: number;
  duration: number;
}

/** A contiguous stretch of finalized words attributed to one speaker. */
interface SpeakerRun {
  speaker: number;
  text: string;
  startMs: number;
  endMs: number;
}

export class DeepgramProvider implements TranscriptionProvider {
  readonly name: Provider = "deepgram";
  private ws: WebSocket | null = null;
  private baselineMs = 0;
  private sentBytes = 0;
  private closedByUs = false;
  private diarize = false;

  // Accumulated final pieces of the utterance in progress (non-diarized path).
  private finalBuffer = "";
  private utterStartMs = 0;
  private utterEndMs = 0;

  // Diarized path: the same utterance, split by speaker. Flushed one FinalUtterance per run.
  private finalRuns: SpeakerRun[] = [];

  private speechStartCb?: (info: { startMs: number }) => void;
  private interimCb?: (text: string) => void;
  private finalCb?: (utt: FinalUtterance) => void;
  private errorCb?: (err: Error) => void;
  private closeCb?: (info: CloseInfo) => void;

  connect(opts: ConnectOptions): Promise<void> {
    this.baselineMs = opts.baselineAudioMs ?? 0;
    this.sentBytes = 0;
    this.closedByUs = false;
    this.diarize = opts.diarize === true;
    this.finalBuffer = "";
    this.finalRuns = [];

    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        // Browser auth: pass the temporary access token as the `token` subprotocol.
        ws = new WebSocket(buildUrl(opts.model, this.diarize), ["token", opts.token]);
      } catch (e) {
        reject(e as Error);
        return;
      }
      ws.binaryType = "arraybuffer";
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => {
        const err = new Error("Deepgram WebSocket error");
        this.errorCb?.(err);
        if (ws.readyState !== WebSocket.OPEN) reject(err);
      });
      ws.addEventListener("close", (ev) => {
        if (!this.closedByUs) {
          this.closeCb?.({ code: ev.code, reason: ev.reason, wasClean: ev.wasClean });
        }
      });
      ws.addEventListener("message", (ev) => this.handleMessage(ev.data as string));
    });
  }

  private handleMessage(raw: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    const type = msg.type as string;

    if (type === "SpeechStarted") {
      const ts = (msg.timestamp as number) ?? 0;
      this.speechStartCb?.({ startMs: this.baselineMs + ts * 1000 });
      return;
    }

    if (type === "UtteranceEnd") {
      this.flushFinal();
      return;
    }

    if (type === "Results") {
      const r = msg as unknown as DgResults;
      const alt = r.channel?.alternatives?.[0];
      const transcript = (alt?.transcript ?? "").trim();
      const pieceStartMs = this.baselineMs + r.start * 1000;
      const pieceEndMs = this.baselineMs + (r.start + r.duration) * 1000;

      if (this.diarize) {
        if (r.is_final && transcript) {
          this.absorbRuns(alt.words ?? [], transcript, pieceStartMs, pieceEndMs);
          this.interimCb?.(this.runsText());
        } else if (!r.is_final && transcript) {
          // Per-word speakers on interim results flip around, so the live guess stays
          // unattributed — the neutral bubble in the UI. Only is_final words build runs.
          const pending = this.runsText();
          this.interimCb?.(pending ? `${pending} ${transcript}` : transcript);
        }
        if (r.is_final && r.speech_final) this.flushFinal();
        return;
      }

      if (r.is_final) {
        if (transcript) {
          if (!this.finalBuffer) this.utterStartMs = pieceStartMs;
          this.finalBuffer = this.finalBuffer ? `${this.finalBuffer} ${transcript}` : transcript;
          this.utterEndMs = pieceEndMs;
          this.interimCb?.(this.finalBuffer);
        }
        // speech_final marks the end of a spoken utterance → flush as one final line.
        if (r.speech_final) this.flushFinal();
      } else if (transcript) {
        // Interim: show accumulated finals plus the live guess.
        const live = this.finalBuffer ? `${this.finalBuffer} ${transcript}` : transcript;
        this.interimCb?.(live);
      }
    }
  }

  /**
   * Split one finalized result into contiguous same-speaker runs and merge them into the
   * utterance in progress. A word with no `speaker` inherits whichever speaker is currently
   * being accumulated. Results with no word list at all (shouldn't happen with diarize on)
   * fall back to appending the whole transcript to the current run.
   */
  private absorbRuns(words: DgWord[], transcript: string, startMs: number, endMs: number) {
    const last = () => this.finalRuns[this.finalRuns.length - 1];

    if (words.length === 0) {
      this.appendRun(last()?.speaker ?? 0, transcript, startMs, endMs);
      return;
    }

    let runSpeaker = words[0].speaker ?? last()?.speaker ?? 0;
    let runWords: string[] = [];
    let runStart = this.baselineMs + words[0].start * 1000;
    let runEnd = runStart;

    const commit = () => {
      if (runWords.length) this.appendRun(runSpeaker, runWords.join(" "), runStart, runEnd);
      runWords = [];
    };

    for (const w of words) {
      const speaker = w.speaker ?? runSpeaker;
      if (speaker !== runSpeaker && runWords.length) commit();
      runSpeaker = speaker;
      if (!runWords.length) runStart = this.baselineMs + w.start * 1000;
      runWords.push(w.punctuated_word ?? w.word);
      runEnd = this.baselineMs + w.end * 1000;
    }
    commit();
  }

  /** Extend the trailing run when the speaker matches, otherwise open a new one. */
  private appendRun(speaker: number, text: string, startMs: number, endMs: number) {
    const clean = text.trim();
    if (!clean) return;
    const last = this.finalRuns[this.finalRuns.length - 1];
    if (last && last.speaker === speaker) {
      last.text = `${last.text} ${clean}`;
      last.endMs = Math.max(last.endMs, endMs);
      return;
    }
    this.finalRuns.push({ speaker, text: clean, startMs, endMs });
  }

  private runsText(): string {
    return this.finalRuns.map((r) => r.text).join(" ");
  }

  private flushFinal() {
    if (this.diarize) {
      // One final line per speaker run, in the order they were spoken.
      const runs = this.finalRuns;
      this.finalRuns = [];
      for (const run of runs) {
        const text = run.text.trim();
        if (!text) continue;
        this.finalCb?.({
          text,
          startMs: run.startMs,
          endMs: run.endMs || null,
          speaker: run.speaker,
        });
      }
      return;
    }
    const text = this.finalBuffer.trim();
    if (!text) return;
    this.finalCb?.({ text, startMs: this.utterStartMs, endMs: this.utterEndMs || null });
    this.finalBuffer = "";
  }

  sendAudio(pcm16: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sentBytes += pcm16.byteLength;
    this.ws.send(pcm16); // raw linear16 binary frame
  }

  audioMsSent(): number {
    return this.baselineMs + pcm16BytesToMs(this.sentBytes);
  }

  onSpeechStart(cb: (info: { startMs: number }) => void): void {
    this.speechStartCb = cb;
  }
  onInterim(cb: (text: string) => void): void {
    this.interimCb = cb;
  }
  onFinal(cb: (utt: FinalUtterance) => void): void {
    this.finalCb = cb;
  }
  onError(cb: (err: Error) => void): void {
    this.errorCb = cb;
  }
  onClose(cb: (info: CloseInfo) => void): void {
    this.closeCb = cb;
  }

  close(): Promise<void> {
    this.closedByUs = true;
    try {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // Ask Deepgram to flush and close cleanly.
        this.ws.send(JSON.stringify({ type: "CloseStream" }));
      }
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    return Promise.resolve();
  }
}
