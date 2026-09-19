import type { AudioSource, InputMode, Provider } from "@/lib/types";
import {
  MicCaptureSource,
  SystemAudioCaptureSource,
  type AudioCaptureSource,
} from "@/lib/audio/capture";
import { AudioPipeline, createAudioContext } from "@/lib/audio/pipeline";
import { createProvider } from "@/lib/transcription/factory";
import type { TranscriptionProvider } from "@/lib/transcription/provider";
import { TranscriptStore } from "@/lib/transcript-store";

/**
 * RecorderEngine — framework-free orchestration: 2× capture → 2× worklet pipelines → 2×
 * transcription providers → one interleaved TranscriptStore → batched REST persistence, plus
 * session lifecycle. The React layer touches this only through useRecorder.ts.
 *
 * In phone mode only the mic is armed (the caller ships out of a speakerphone in the room) and
 * Deepgram diarization splits that one stream into two speakers instead.
 *
 * Proactive 25-min token rotation + ring-buffer gap-fill is layered on in build step 8; this
 * file already reconnects on unexpected close so a dropped socket self-heals.
 */

export type SourceStatus =
  | "idle"
  | "arming"
  | "live"
  | "reconnecting"
  | "stopped"
  | "error";

export interface RecorderCallbacks {
  onSourceStatus: (source: AudioSource, status: SourceStatus) => void;
  onRms: (source: AudioSource, level: number) => void;
  onError: (source: AudioSource, message: string) => void;
  onPersistError?: (message: string) => void;
}

interface SourceRuntime {
  capture: AudioCaptureSource | null;
  pipeline: AudioPipeline | null;
  provider: TranscriptionProvider | null;
  stream: MediaStream | null;
  status: SourceStatus;
  /** ms offset of this stream's audio t=0 relative to recording start (for a unified timeline). */
  startOffsetMs: number;
  reconnecting: boolean;
  /** Ring buffer of the last few seconds of PCM chunks, to gap-fill an unexpected drop. */
  ring: ArrayBuffer[];
  /** Total audio ms routed to providers for this source (across reconnects). */
  sentMs: number;
  rotateTimer: ReturnType<typeof setTimeout> | null;
}

const PERSIST_INTERVAL_MS = 3000;
const CHUNK_MS = 100; // one worklet chunk
const RING_CHUNKS = 30; // ~3 s of audio kept for gap fill
// OpenAI Realtime sessions cap ~30 min; rotate well before that.
const ROTATE_MS = 25 * 60 * 1000;

export class RecorderEngine {
  readonly store = new TranscriptStore();
  private ctx: AudioContext | null = null;
  private sessionId: string | null = null;
  private model = "";
  private provider: Provider;
  private readonly mode: InputMode;
  private recordingStartEpoch = 0;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;

  /**
   * Deepgram's speaker indices are only stable within one WebSocket, so they're mapped to our own
   * 0 ("Me") / 1 ("Customer") on a first-seen-first-served basis and the map is thrown away on
   * every rotation/reconnect. Identity can therefore invert mid-recording — the Swap speakers
   * control is the fix.
   */
  private dgSpeakerMap = new Map<number, number>();

  private runtimes: Record<AudioSource, SourceRuntime> = {
    mic: blankRuntime(),
    system: blankRuntime(),
  };

  constructor(
    provider: Provider,
    model: string,
    private readonly cb: RecorderCallbacks,
    options: { mode?: InputMode } = {},
  ) {
    this.mode = options.mode ?? "pc";
    // Phone mode is mic-only and leans entirely on diarization, which only Deepgram does here.
    this.provider = this.mode === "phone" ? "deepgram" : provider;
    this.model = model;
  }

  /** Canonicalize a provider-side speaker index into 0/1; 3+ voices clamp onto "Customer". */
  private mapSpeaker(dgSpeaker: number | undefined): number | null {
    if (this.mode !== "phone" || typeof dgSpeaker !== "number") return null;
    const known = this.dgSpeakerMap.get(dgSpeaker);
    if (known !== undefined) return known;
    const next = this.dgSpeakerMap.size === 0 ? 0 : 1;
    this.dgSpeakerMap.set(dgSpeaker, next);
    return next;
  }

  get currentSessionId(): string | null {
    return this.sessionId;
  }

  private ctxOrCreate(): AudioContext {
    if (!this.ctx) this.ctx = createAudioContext();
    return this.ctx;
  }

  private setStatus(source: AudioSource, status: SourceStatus) {
    this.runtimes[source].status = status;
    this.cb.onSourceStatus(source, status);
  }

  /** Create the DB session. Call once before arming sources. */
  async createSession(title?: string): Promise<string> {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, model: this.model, inputMode: this.mode }),
    });
    if (!res.ok) throw new Error("Could not create session");
    const data = (await res.json()) as { session: { id: string } };
    this.sessionId = data.session.id;
    this.recordingStartEpoch = Date.now();
    this.startPersistLoop();
    return this.sessionId;
  }

  // ---- arming ---------------------------------------------------------------

  async armMic(): Promise<void> {
    // Phone mode wants the unprocessed mic — see MicCaptureSource for why.
    await this.armSource("mic", () => new MicCaptureSource({ raw: this.mode === "phone" }));
  }

  async armSystem(): Promise<void> {
    await this.armSource("system", () => new SystemAudioCaptureSource());
  }

  private async armSource(source: AudioSource, makeCapture: () => AudioCaptureSource) {
    const rt = this.runtimes[source];
    this.setStatus(source, "arming");

    const capture = makeCapture();
    rt.capture = capture;
    // Capture start can throw (permission denied / no audio track) — let it bubble to the UI.
    const stream = await capture.start();
    rt.stream = stream;
    rt.startOffsetMs = Date.now() - this.recordingStartEpoch;

    // User ends the share/track (e.g. "Stop sharing"): stop this source but keep the other going.
    capture.onEnded(() => {
      if (this.stopped) return;
      this.teardownSource(source, "stopped");
    });

    try {
      await this.connectProvider(source, 0);
    } catch (err) {
      this.teardownSource(source, "error");
      throw err;
    }

    const pipeline = new AudioPipeline(this.ctxOrCreate(), stream, {
      onChunk: (buf) => this.routeChunk(source, buf),
      onRms: (level) => this.cb.onRms(source, level),
    });
    rt.pipeline = pipeline;
    await pipeline.start();
    this.scheduleRotate(source);
    this.setStatus(source, "live");
  }

  /** Buffer every chunk (for gap fill) and forward it to the live provider. */
  private routeChunk(source: AudioSource, buf: ArrayBuffer) {
    const rt = this.runtimes[source];
    rt.ring.push(buf);
    if (rt.ring.length > RING_CHUNKS) rt.ring.shift();
    rt.sentMs += CHUNK_MS;
    rt.provider?.sendAudio(buf);
  }

  private scheduleRotate(source: AudioSource) {
    const rt = this.runtimes[source];
    if (rt.rotateTimer) clearTimeout(rt.rotateTimer);
    rt.rotateTimer = setTimeout(() => void this.rotateSource(source), ROTATE_MS);
  }

  /** Re-arm system audio after the user stopped sharing (hot-swap the source). */
  async resumeSystem(): Promise<void> {
    // Tear any remnants down first, then arm fresh.
    this.teardownSource("system", "arming", { silent: true });
    await this.armSystem();
  }

  // ---- provider connect / reconnect ----------------------------------------

  /** Build, wire, and connect a fresh provider WITHOUT assigning it to the runtime yet. */
  private async buildProvider(
    source: AudioSource,
    baselineAudioMs: number,
  ): Promise<TranscriptionProvider> {
    const rt = this.runtimes[source];
    const token = await this.mintToken();
    const provider = createProvider(this.provider);
    const diarize = this.mode === "phone";
    // A fresh connection means a fresh Deepgram speaker index space.
    if (diarize) this.dgSpeakerMap.clear();

    provider.onInterim((text) => this.store.setInterim(source, text));
    provider.onFinal((utt) => {
      this.store.addFinal(
        source,
        utt.text,
        rt.startOffsetMs + utt.startMs,
        utt.endMs,
        this.mapSpeaker(utt.speaker),
      );
    });
    provider.onError((err) => this.cb.onError(source, err.message));
    provider.onClose(() => {
      // Only react if this is still the active provider and we didn't retire it ourselves.
      if (this.stopped || rt.reconnecting || rt.provider !== provider) return;
      void this.reconnectSource(source);
    });

    await provider.connect({ token, model: this.model, baselineAudioMs, diarize });
    return provider;
  }

  private async connectProvider(source: AudioSource, baselineAudioMs: number) {
    this.runtimes[source].provider = await this.buildProvider(source, baselineAudioMs);
  }

  /** Proactive rotation before the provider's session cap — make-before-break, no gap. */
  private async rotateSource(source: AudioSource) {
    const rt = this.runtimes[source];
    if (this.stopped || rt.status !== "live" || rt.reconnecting) return;
    const old = rt.provider;
    try {
      // New session continues the timeline at the current audio position. The old provider keeps
      // receiving until we flip, so no audio is lost and we avoid replaying (which would dupe).
      const fresh = await this.buildProvider(source, rt.sentMs);
      rt.provider = fresh; // subsequent chunks now route to the fresh session
      // Give in-flight utterances on the old session a moment to finalize, then retire it.
      setTimeout(() => void old?.close(), 2000);
      this.scheduleRotate(source);
    } catch {
      // Rotation failed — keep the old session; it will reconnect on close if it hits the cap.
      this.scheduleRotate(source);
    }
  }

  private async mintToken(): Promise<string> {
    const res = await fetch("/api/realtime/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      // Phone mode overrides whatever provider Settings has selected — diarization is Deepgram-only.
      body: JSON.stringify({
        model: this.model,
        ...(this.mode === "phone" ? { provider: "deepgram" } : {}),
      }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error ?? "Could not mint transcription token");
    }
    const data = (await res.json()) as { token: string };
    return data.token;
  }

  /** Reconnect a source on unexpected close, replaying the ring buffer to gap-fill the drop. */
  private async reconnectSource(source: AudioSource) {
    const rt = this.runtimes[source];
    if (!rt.stream || this.stopped) return;
    rt.reconnecting = true;
    this.setStatus(source, "reconnecting");

    try {
      await rt.provider?.close();
    } catch {
      /* ignore */
    }
    rt.provider = null;

    // Rewind the timeline by the buffered window; we'll replay it so the drop is covered.
    const replay = rt.ring.slice();
    const baseline = Math.max(0, rt.sentMs - replay.length * CHUNK_MS);

    for (let attempt = 0; attempt < 5 && !this.stopped; attempt++) {
      try {
        const provider = await this.buildProvider(source, baseline);
        // Replay the recent audio that was in flight / lost during the drop.
        for (const buf of replay) provider.sendAudio(buf);
        rt.provider = provider;
        rt.reconnecting = false;
        this.scheduleRotate(source);
        this.setStatus(source, "live");
        return;
      } catch {
        await delay(1000 * (attempt + 1));
      }
    }
    rt.reconnecting = false;
    if (!this.stopped) {
      this.setStatus(source, "error");
      this.cb.onError(source, "Lost connection and could not reconnect.");
    }
  }

  // ---- persistence ----------------------------------------------------------

  private startPersistLoop() {
    if (this.persistTimer) return;
    this.persistTimer = setInterval(() => void this.flush(), PERSIST_INTERVAL_MS);
  }

  private async flush(): Promise<void> {
    if (!this.sessionId) return;
    const batch = this.store.takeUnpersisted();
    if (batch.length === 0) return;
    try {
      const res = await fetch(`/api/sessions/${this.sessionId}/segments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ segments: batch }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Re-queue so nothing is lost; try again next tick.
      this.store.requeue(batch);
      this.cb.onPersistError?.((e as Error).message);
    }
  }

  // ---- teardown -------------------------------------------------------------

  private teardownSource(
    source: AudioSource,
    finalStatus: SourceStatus,
    opts: { silent?: boolean } = {},
  ) {
    const rt = this.runtimes[source];
    rt.reconnecting = false;
    if (rt.rotateTimer) {
      clearTimeout(rt.rotateTimer);
      rt.rotateTimer = null;
    }
    try {
      rt.pipeline?.stop();
    } catch {
      /* ignore */
    }
    void rt.provider?.close();
    rt.capture?.stop();
    this.store.clearInterim(source);
    rt.pipeline = null;
    rt.provider = null;
    rt.capture = null;
    rt.stream = null;
    rt.ring = [];
    if (!opts.silent) this.setStatus(source, finalStatus);
    else rt.status = finalStatus;
  }

  isSourceLive(source: AudioSource): boolean {
    return this.runtimes[source].status === "live";
  }

  anyLive(): boolean {
    return this.isSourceLive("mic") || this.isSourceLive("system");
  }

  /** Stop everything, flush remaining segments, mark the session completed. */
  async stop(title?: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;

    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }

    (["mic", "system"] as AudioSource[]).forEach((s) => this.teardownSource(s, "stopped"));

    // Final drain of any unpersisted segments.
    await this.flush();

    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* ignore */
      }
      this.ctx = null;
    }

    if (this.sessionId) {
      await fetch(`/api/sessions/${this.sessionId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: "completed", ...(title ? { title } : {}) }),
      }).catch(() => {});
    }
  }
}

function blankRuntime(): SourceRuntime {
  return {
    capture: null,
    pipeline: null,
    provider: null,
    stream: null,
    status: "idle",
    startOffsetMs: 0,
    reconnecting: false,
    ring: [],
    sentMs: 0,
    rotateTimer: null,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
