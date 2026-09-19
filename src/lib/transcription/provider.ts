import type { Provider } from "@/lib/types";

/**
 * Provider-agnostic transcription interface. Implemented by OpenAIRealtimeProvider and
 * DeepgramProvider. Framework-free — no React, no Next. Timestamps emitted are on the
 * provider's own audio timeline in milliseconds (0 = first audio byte of the FIRST
 * connection for this stream); `baselineAudioMs` lets a reconnect continue that timeline.
 */

export interface FinalUtterance {
  text: string;
  /** ms into this stream's audio timeline where the utterance began. */
  startMs: number;
  /** ms where it ended, if the provider reports it. */
  endMs: number | null;
  /**
   * Provider-side speaker index when diarization is on. Only stable within a single connection —
   * the engine maps it to a canonical 0/1 and resets that map on every reconnect/rotation.
   */
  speaker?: number;
}

export interface ConnectOptions {
  /** Short-lived ephemeral token (never the real API key). */
  token: string;
  model: string;
  /** Audio ms already sent on prior connections for this stream (reconnect continuity). */
  baselineAudioMs?: number;
  /** Optional BCP-47 language hint. */
  language?: string;
  /**
   * Ask the provider to attribute each utterance to a speaker. Only Deepgram implements this;
   * the others ignore it and keep emitting `speaker`-less utterances.
   */
  diarize?: boolean;
}

export interface CloseInfo {
  code: number;
  reason: string;
  wasClean: boolean;
}

export interface TranscriptionProvider {
  readonly name: Provider;
  connect(opts: ConnectOptions): Promise<void>;
  /** Send one PCM16 (24 kHz mono) chunk. */
  sendAudio(pcm16: ArrayBuffer): void;
  /** Total audio ms sent across the lifetime of this provider instance. */
  audioMsSent(): number;
  onSpeechStart(cb: (info: { startMs: number }) => void): void;
  onInterim(cb: (text: string) => void): void;
  onFinal(cb: (utt: FinalUtterance) => void): void;
  onError(cb: (err: Error) => void): void;
  onClose(cb: (info: CloseInfo) => void): void;
  close(): Promise<void>;
}

/** Bytes → milliseconds of PCM16 mono @ 24 kHz. 4800 bytes = 100 ms. */
export function pcm16BytesToMs(bytes: number): number {
  return bytes / 48; // (bytes/2 samples) / 24000 * 1000
}
