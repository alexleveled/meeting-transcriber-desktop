import type { AudioSource } from "@/lib/types";

/**
 * Audio capture sources — framework-free browser code. Each source yields a MediaStream that
 * the audio pipeline turns into PCM16. Later, an ElectronLoopbackSource can implement the same
 * interface to replace the screen-share picker.
 */

export interface AudioCaptureSource {
  readonly kind: AudioSource;
  /** Prompt for permission and begin capture. Rejects on denial / no audio track. */
  start(): Promise<MediaStream>;
  /** Fires when the underlying track ends (e.g. user clicks "Stop sharing"). */
  onEnded(cb: () => void): void;
  stop(): void;
}

/** Thrown when a display-capture stream comes back with no audio track. */
export class NoAudioTrackError extends Error {
  constructor() {
    super("No system audio was shared. Pick “Entire screen” and tick “Also share system audio”.");
    this.name = "NoAudioTrackError";
  }
}

/** Thrown when the user denies a permission prompt. */
export class PermissionDeniedError extends Error {
  constructor(kind: AudioSource) {
    super(kind === "mic" ? "Microphone permission was denied." : "Screen share was cancelled.");
    this.name = "PermissionDeniedError";
  }
}

function isAbortLike(err: unknown): boolean {
  const name = (err as { name?: string })?.name ?? "";
  return name === "NotAllowedError" || name === "AbortError" || name === "SecurityError";
}

// ---- microphone ------------------------------------------------------------

export class MicCaptureSource implements AudioCaptureSource {
  readonly kind: AudioSource = "mic";
  private stream: MediaStream | null = null;
  private endedCb: (() => void) | null = null;

  /**
   * `raw` turns off the browser's voice processing. Needed for phone-call mode: the other party
   * comes out of a speakerphone in the room, and echo cancellation treats that as echo and
   * suppresses the very voice we're trying to transcribe.
   */
  constructor(private readonly opts: { raw?: boolean } = {}) {}

  async start(): Promise<MediaStream> {
    const processed = !this.opts.raw;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: processed,
          noiseSuppression: processed,
          autoGainControl: processed,
          channelCount: 1,
        },
        video: false,
      });
      this.stream = stream;
      const [track] = stream.getAudioTracks();
      track?.addEventListener("ended", () => this.endedCb?.());
      return stream;
    } catch (err) {
      if (isAbortLike(err)) throw new PermissionDeniedError("mic");
      throw err;
    }
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

// ---- system audio (screen share) -------------------------------------------

export class SystemAudioCaptureSource implements AudioCaptureSource {
  readonly kind: AudioSource = "system";
  private stream: MediaStream | null = null;
  private endedCb: (() => void) | null = null;

  async start(): Promise<MediaStream> {
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        // Video is required to get the "Also share system audio" option; we keep the (unused)
        // video track alive so the capture session doesn't tear down.
        video: true,
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
        // Chrome/Edge hint — surfaces the system-audio checkbox.
        // @ts-expect-error non-standard but supported in Chromium.
        systemAudio: "include",
      });
    } catch (err) {
      if (isAbortLike(err)) throw new PermissionDeniedError("system");
      throw err;
    }

    if (stream.getAudioTracks().length === 0) {
      // Half-armed: never proceed. Tear the whole stream down and signal the retry path.
      stream.getTracks().forEach((t) => t.stop());
      throw new NoAudioTrackError();
    }

    this.stream = stream;
    // Either track ending (user hits "Stop sharing") means we lost system audio.
    stream.getTracks().forEach((t) => t.addEventListener("ended", () => this.endedCb?.()));
    return stream;
  }

  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}
