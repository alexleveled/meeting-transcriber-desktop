import type { Provider } from "@/lib/types";
import {
  pcm16BytesToMs,
  type CloseInfo,
  type ConnectOptions,
  type FinalUtterance,
  type TranscriptionProvider,
} from "./provider";

const WS_URL = "wss://api.openai.com/v1/realtime?intent=transcription";

/** ArrayBuffer → base64 (browser), chunked to avoid arg-length limits. */
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

/**
 * OpenAI Realtime transcription provider. Opens a WebSocket directly to OpenAI authenticated
 * with an ephemeral client secret (minted server-side). The transcription session's config
 * (model, server-VAD, noise reduction) is baked into the token, so the client only streams
 * audio and consumes events.
 */
export class OpenAIRealtimeProvider implements TranscriptionProvider {
  readonly name: Provider = "openai";
  private ws: WebSocket | null = null;
  private baselineMs = 0;
  private sentBytes = 0;
  private closedByUs = false;

  // item_id → audio_start_ms (from speech_started), for anchoring finals.
  private startByItem = new Map<string, number>();
  // Running interim text for the utterance in progress (deltas are fragments).
  private interimText = "";

  private speechStartCb?: (info: { startMs: number }) => void;
  private interimCb?: (text: string) => void;
  private finalCb?: (utt: FinalUtterance) => void;
  private errorCb?: (err: Error) => void;
  private closeCb?: (info: CloseInfo) => void;

  connect(opts: ConnectOptions): Promise<void> {
    this.baselineMs = opts.baselineAudioMs ?? 0;
    this.sentBytes = 0;
    this.closedByUs = false;

    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        // GA browser auth: pass the ephemeral secret as a WebSocket subprotocol (browsers
        // can't set Authorization headers on a WS handshake).
        ws = new WebSocket(WS_URL, ["realtime", `openai-insecure-api-key.${opts.token}`]);
      } catch (e) {
        reject(e as Error);
        return;
      }
      this.ws = ws;

      ws.addEventListener("open", () => resolve());
      ws.addEventListener("error", () => {
        // The error event carries no detail in browsers; surface a generic one.
        const err = new Error("OpenAI realtime WebSocket error");
        this.errorCb?.(err);
        // If we never opened, reject the connect promise.
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

    switch (type) {
      case "input_audio_buffer.speech_started": {
        const itemId = msg.item_id as string;
        const audioStartMs = (msg.audio_start_ms as number) ?? 0;
        if (itemId) this.startByItem.set(itemId, audioStartMs);
        this.interimText = "";
        this.speechStartCb?.({ startMs: this.baselineMs + audioStartMs });
        break;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const delta = (msg.delta as string) ?? "";
        if (delta) {
          // Emit the running full interim text so all providers behave identically.
          this.interimText += delta;
          this.interimCb?.(this.interimText);
        }
        break;
      }
      case "conversation.item.input_audio_transcription.completed": {
        const itemId = msg.item_id as string;
        const transcript = ((msg.transcript as string) ?? "").trim();
        const startMs = this.baselineMs + (this.startByItem.get(itemId) ?? 0);
        this.startByItem.delete(itemId);
        this.interimText = "";
        if (transcript) {
          this.finalCb?.({ text: transcript, startMs, endMs: null });
        }
        break;
      }
      case "error": {
        const errObj = (msg.error as { message?: string }) ?? {};
        this.errorCb?.(new Error(errObj.message ?? "OpenAI realtime error"));
        break;
      }
      default:
        break;
    }
  }

  sendAudio(pcm16: ArrayBuffer): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sentBytes += pcm16.byteLength;
    this.ws.send(JSON.stringify({ type: "input_audio_buffer.append", audio: toBase64(pcm16) }));
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
      this.ws?.close();
    } catch {
      /* noop */
    }
    this.ws = null;
    return Promise.resolve();
  }
}
