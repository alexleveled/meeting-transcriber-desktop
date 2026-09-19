/** Shared domain types — framework-free, imported by both server and client code. */

export type AudioSource = "mic" | "system";
export type SessionStatus = "recording" | "completed";
export type Provider = "openai" | "deepgram" | "local";

export type ChatProvider = "openai" | "anthropic";
export const CHAT_PROVIDERS: ChatProvider[] = ["openai", "anthropic"];
export const CHAT_PROVIDER_LABEL: Record<ChatProvider, string> = {
  openai: "OpenAI",
  anthropic: "Anthropic",
};

export interface ChatModel {
  provider: ChatProvider;
  id: string;
  label: string;
}

/** A transcript line an assistant answer pointed at. `n` is the bracket number in the reply. */
export interface Citation {
  n: number;
  startedAtMs: number;
  seq: number;
  snippet: string;
  label: string;
}

/**
 * How the call reaches the app.
 *  - "pc"    — the call plays through this computer: mic + system audio, two streams.
 *  - "phone" — a phone on speaker in the room: mic only, split into two voices by Deepgram
 *              diarization. Sessions recorded before this existed have input_mode = NULL and
 *              are treated as "pc".
 */
export type InputMode = "pc" | "phone";

export const INPUT_MODE_LABEL: Record<InputMode, string> = {
  pc: "Call on this PC",
  phone: "Phone call on speaker",
};

/** Client-facing (masked) settings snapshot, as returned by GET /api/settings. */
export interface ClientSettings {
  provider: Provider;
  model: string;
  models: Record<Provider, string[]>;
  modelByProvider: Record<Provider, string>;
  keys: Record<Provider, { hasKey: boolean; last4: string | null; fromEnv: boolean }>;
  chatKeys: Record<ChatProvider, ChatKeyState>;
  chatModel: { provider: ChatProvider; id: string } | null;
}

export interface ChatKeyState {
  hasKey: boolean;
  last4: string | null;
  fromEnv: boolean;
  fromTranscription?: boolean;
}

export const PROVIDER_LABEL: Record<Provider, string> = {
  openai: "OpenAI Realtime",
  deepgram: "Deepgram",
  local: "Local Whisper (free)",
};

/** Human-friendly labels for local Whisper model files (keyed by ggml filename). */
export const LOCAL_MODEL_LABEL: Record<string, string> = {
  "ggml-small.en.bin": "Whisper Small — English (~466 MB)",
};

export interface SessionRow {
  id: string;
  title: string;
  status: SessionStatus;
  model: string;
  /** NULL on sessions recorded before input modes existed — treat as "pc". */
  input_mode: string | null;
  /** 1 when the user swapped the two diarized speaker labels (phone mode only). */
  speakers_swapped: number;
  started_at: number;
  ended_at: number | null;
  created_at: number;
}

export interface SegmentRow {
  id: number;
  session_id: string;
  source: AudioSource;
  text: string;
  /** Diarized speaker index (0 = "Me", 1 = "Customer"); NULL outside phone mode. */
  speaker: number | null;
  started_at_ms: number;
  ended_at_ms: number | null;
  seq: number;
  created_at: number;
}

/** A finalized segment as produced client-side, before it has a DB id. */
export interface TranscriptSegment {
  source: AudioSource;
  text: string;
  speaker: number | null;
  startedAtMs: number;
  endedAtMs: number | null;
  seq: number;
}

export interface ChatMessageRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  provider: ChatProvider | null;
  model: string | null;
  specialty_id: number | null;
  /** JSON-encoded Citation[]; null on user rows. */
  citations: string | null;
  created_at: number;
}

export interface SpecialtyRow {
  id: number;
  name: string;
  prompt: string;
  created_at: number;
  /** Slug of the built-in specialty this row was seeded from; null for user-created specialties. */
  builtin_slug: string | null;
}
