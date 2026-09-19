import type { Provider } from "@/lib/types";
import {
  pcm16BytesToMs,
  type CloseInfo,
  type ConnectOptions,
  type FinalUtterance,
  type TranscriptionProvider,
} from "./provider";
import { NoiseGate, computeRms } from "./vad";

/**
 * Local Whisper provider — same interface as the cloud providers, but transcription runs on the
 * user's machine via whisper.cpp (served by /api/local-whisper/*). Whisper is not a streaming
 * model, so instead of a socket we buffer audio and, whenever the speaker pauses (or a hard 15 s
 * cap is hit), POST that window to the server and emit its result as finals. No interim text.
 *
 * Timeline: emitted startMs/endMs are on this stream's audio timeline (baselineAudioMs + the ms
 * offset of the window within the stream), matching the contract the cloud providers use.
 */

const SAMPLE_RATE = 24000;
const SILENCE_FLUSH_MS = 700; // trailing silence that ends an utterance
const MAX_WINDOW_MS = 15000; // hard cap so a long monologue still ships
const CARRY_OVER_MS = 500; // audio kept across a hard-cap flush to avoid clipping a word
const PREROLL_MS = 300; // silence kept before speech so onsets aren't cut

export class LocalWhisperProvider implements TranscriptionProvider {
  readonly name: Provider = "local";

  private baselineMs = 0;
  private sentBytes = 0;
  private model = "";
  private language = "en";
  private closed = false;

  // Current window buffer.
  private buffer: Int16Array[] = [];
  private bufferSamples = 0;
  private bufferMs = 0;
  private bufferStartMs = 0;
  private hasSpeech = false;
  private speechStartEmitted = false;
  private trailingSilenceMs = 0;
  private gate = new NoiseGate();

  // Serializes window POSTs so utterances persist in order.
  private pending: Promise<void> = Promise.resolve();

  private speechStartCb?: (info: { startMs: number }) => void;
  private interimCb?: (text: string) => void;
  private finalCb?: (utt: FinalUtterance) => void;
  private errorCb?: (err: Error) => void;
  private closeCb?: (info: CloseInfo) => void;

  async connect(opts: ConnectOptions): Promise<void> {
    this.baselineMs = opts.baselineAudioMs ?? 0;
    this.sentBytes = 0;
    this.model = opts.model;
    this.language = opts.language ?? "en";
    this.closed = false;
    this.resetBuffer();
    this.gate = new NoiseGate();

    // Warm the whisper-server (loads the model) before we start streaming audio.
    const res = await fetch(`/api/local-whisper/health?model=${encodeURIComponent(this.model)}`);
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Local Whisper is not ready");
    }
  }

  sendAudio(pcm16: ArrayBuffer): void {
    if (this.closed) return;
    // Copy — the worklet may reuse the underlying buffer for the next chunk.
    const frame = new Int16Array(pcm16.slice(0));
    const frameMs = pcm16BytesToMs(pcm16.byteLength);
    const frameStartStreamMs = this.baselineMs + pcm16BytesToMs(this.sentBytes);
    this.sentBytes += pcm16.byteLength;

    const speaking = this.gate.update(computeRms(frame));

    if (this.bufferSamples === 0) this.bufferStartMs = frameStartStreamMs;
    this.buffer.push(frame);
    this.bufferSamples += frame.length;
    this.bufferMs += frameMs;

    if (speaking) {
      this.hasSpeech = true;
      this.trailingSilenceMs = 0;
      if (!this.speechStartEmitted) {
        this.speechStartCb?.({ startMs: frameStartStreamMs });
        this.speechStartEmitted = true;
      }
    } else {
      this.trailingSilenceMs += frameMs;
      // Before any speech, keep only a short pre-roll so we don't buffer (or transcribe) long silence.
      if (!this.hasSpeech) {
        while (this.bufferMs > PREROLL_MS && this.buffer.length > 1) {
          const dropped = this.buffer.shift()!;
          this.bufferSamples -= dropped.length;
          const droppedMs = (dropped.length / SAMPLE_RATE) * 1000;
          this.bufferMs -= droppedMs;
          this.bufferStartMs += droppedMs;
        }
      }
    }

    if (this.hasSpeech && this.trailingSilenceMs >= SILENCE_FLUSH_MS) {
      this.flushWindow(0); // natural utterance end
    } else if (this.bufferMs >= MAX_WINDOW_MS) {
      if (this.hasSpeech) this.flushWindow(CARRY_OVER_MS);
      else this.resetBuffer(); // 15 s of pure silence — discard
    }
  }

  /** Ship the current buffer to the server; keep `keepTailMs` of trailing audio for continuity. */
  private flushWindow(keepTailMs: number): void {
    if (this.bufferSamples === 0) return;
    const windowStartMs = this.bufferStartMs;
    const pcm = concatInt16(this.buffer, this.bufferSamples);
    this.enqueueTranscribe(pcm, windowStartMs);

    if (keepTailMs > 0) {
      const tailSamples = Math.min(pcm.length, Math.floor((keepTailMs / 1000) * SAMPLE_RATE));
      const tail = pcm.slice(pcm.length - tailSamples);
      const consumedMs = ((pcm.length - tailSamples) / SAMPLE_RATE) * 1000;
      this.buffer = [tail];
      this.bufferSamples = tailSamples;
      this.bufferMs = (tailSamples / SAMPLE_RATE) * 1000;
      this.bufferStartMs = windowStartMs + consumedMs;
    } else {
      this.resetBuffer();
    }
    this.hasSpeech = false;
    this.speechStartEmitted = false;
    this.trailingSilenceMs = 0;
  }

  private resetBuffer(): void {
    this.buffer = [];
    this.bufferSamples = 0;
    this.bufferMs = 0;
    this.bufferStartMs = 0;
    this.hasSpeech = false;
    this.speechStartEmitted = false;
    this.trailingSilenceMs = 0;
  }

  private enqueueTranscribe(pcm: Int16Array, windowStartMs: number): void {
    this.pending = this.pending
      .then(() => this.postWindow(pcm, windowStartMs))
      .catch((err: unknown) => this.errorCb?.(err as Error));
  }

  private async postWindow(pcm: Int16Array, windowStartMs: number): Promise<void> {
    const qs = `model=${encodeURIComponent(this.model)}&language=${encodeURIComponent(this.language)}`;
    // Send the exact PCM bytes as a plain ArrayBuffer (a fresh copy avoids typed-array/BodyInit
    // generic friction and any shared-buffer aliasing).
    const body = new ArrayBuffer(pcm.byteLength);
    new Int16Array(body).set(pcm);
    const res = await fetch(`/api/local-whisper/transcribe?${qs}`, {
      method: "POST",
      headers: { "content-type": "application/octet-stream" },
      body,
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? `Local transcription failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as {
      segments: Array<{ text: string; startMs: number; endMs: number }>;
    };
    for (const seg of data.segments) {
      const text = seg.text?.trim();
      if (!text) continue;
      this.finalCb?.({
        text,
        startMs: windowStartMs + seg.startMs,
        endMs: windowStartMs + seg.endMs,
      });
    }
  }

  audioMsSent(): number {
    return this.baselineMs + pcm16BytesToMs(this.sentBytes);
  }

  onSpeechStart(cb: (info: { startMs: number }) => void): void {
    this.speechStartCb = cb;
  }
  onInterim(cb: (text: string) => void): void {
    // Local Whisper produces no interim (partial) text; kept for interface parity.
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

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    // Drain whatever speech is buffered as a final window, then wait for all POSTs to settle.
    if (this.hasSpeech) this.flushWindow(0);
    try {
      await this.pending;
    } catch {
      /* already surfaced via onError */
    }
    // Note: closeCb is intentionally NOT called — it signals an *unexpected* drop (which triggers a
    // reconnect in RecorderEngine). Local transcription has no socket to lose, so a close is final.
  }
}

function concatInt16(chunks: Int16Array[], total: number): Int16Array {
  const out = new Int16Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return out;
}
