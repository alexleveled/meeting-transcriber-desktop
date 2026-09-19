import "server-only";
import { db } from "./db";
import { env } from "./env";
import { CHAT_PROVIDERS, type ChatKeyState, type ChatProvider } from "@/lib/types";

/**
 * Typed accessors over the generic key-value `settings` table, plus API-key masking.
 * Real keys are only ever returned by getApiKey() (server-side, e.g. the token route);
 * the public settings API uses maskedSettings() which never exposes a full key.
 */

export type Provider = "openai" | "deepgram" | "local";

export const PROVIDERS: Provider[] = ["openai", "deepgram", "local"];

/** Providers that transcribe on-device (no API key, no network). */
export const LOCAL_PROVIDERS: Provider[] = ["local"];

export function isLocalProvider(p: Provider): boolean {
  return LOCAL_PROVIDERS.includes(p);
}

export const MODELS: Record<Provider, string[]> = {
  openai: ["gpt-4o-transcribe", "gpt-4o-mini-transcribe"],
  deepgram: ["nova-3", "nova-2"],
  // Local Whisper models (ggml filenames as served by huggingface.co/ggerganov/whisper.cpp).
  local: ["ggml-small.en.bin"],
};

const DEFAULT_MODEL: Record<Provider, string> = {
  openai: "gpt-4o-transcribe",
  deepgram: "nova-3",
  local: "ggml-small.en.bin",
};

// ---- raw kv helpers --------------------------------------------------------

function getRaw(key: string): string | null {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function setRaw(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, Date.now());
}

function delRaw(key: string): void {
  db.prepare("DELETE FROM settings WHERE key = ?").run(key);
}

// ---- kv helpers (exported for other server modules, e.g. chat-models.ts) --

/** Thin public wrapper over the private KV getter — for modules outside settings.ts. */
export function getSetting(key: string): string | null {
  return getRaw(key);
}

/** Thin public wrapper over the private KV setter — for modules outside settings.ts. */
export function setSetting(key: string, value: string): void {
  setRaw(key, value);
}

/** Thin public wrapper over the private KV deleter — for modules outside settings.ts. */
export function delSetting(key: string): void {
  delRaw(key);
}

// ---- onboarding ------------------------------------------------------------

/**
 * Whether the one-time first-run welcome has been shown. Stored server-side (not localStorage)
 * because the packaged Electron app binds a fresh random port each launch, which would reset any
 * origin-scoped browser storage — this KV lives in userData and is stable across launches.
 */
export function getOnboardingSeen(): boolean {
  return getRaw("onboarding.welcomed") === "1";
}

export function setOnboardingSeen(): void {
  setRaw("onboarding.welcomed", "1");
}

// ---- compact widget position ----------------------------------------------

export interface CompactPosition {
  x: number;
  y: number;
}

/** Remembered floating-widget position, or null if never saved / malformed. */
export function getCompactPosition(): CompactPosition | null {
  const x = Number(getRaw("compact.x"));
  const y = Number(getRaw("compact.y"));
  if (Number.isFinite(x) && Number.isFinite(y)) return { x, y };
  return null;
}

export function setCompactPosition(pos: CompactPosition): void {
  setRaw("compact.x", String(Math.round(pos.x)));
  setRaw("compact.y", String(Math.round(pos.y)));
}

// ---- provider / model ------------------------------------------------------

export function getProvider(): Provider {
  const v = getRaw("transcription_provider");
  return v === "deepgram" || v === "openai" || v === "local" ? v : "openai";
}

export function setProvider(p: Provider): void {
  setRaw("transcription_provider", p);
}

/** Model configured for a given provider (falls back to that provider's default). */
export function getModel(provider: Provider): string {
  const v = getRaw(`model.${provider}`);
  return v && MODELS[provider].includes(v) ? v : DEFAULT_MODEL[provider];
}

export function setModel(provider: Provider, model: string): void {
  if (!MODELS[provider].includes(model)) {
    throw new Error(`Unknown model "${model}" for provider "${provider}"`);
  }
  setRaw(`model.${provider}`, model);
}

// ---- API keys --------------------------------------------------------------

/** Env fallback key for a cloud provider ("" for local, which needs none). */
function envKeyFor(provider: Provider): string {
  if (provider === "openai") return env.openaiApiKey;
  if (provider === "deepgram") return env.deepgramApiKey;
  return "";
}

/** Full key: saved-in-DB value wins; otherwise env fallback. Server-side only. */
export function getApiKey(provider: Provider): string {
  if (isLocalProvider(provider)) return "";
  const saved = getRaw(`apikey.${provider}`);
  if (saved) return saved;
  return envKeyFor(provider);
}

export function setApiKey(provider: Provider, key: string): void {
  setRaw(`apikey.${provider}`, key);
}

export function clearApiKey(provider: Provider): void {
  delRaw(`apikey.${provider}`);
}

function maskKey(provider: Provider): { hasKey: boolean; last4: string | null; fromEnv: boolean } {
  // Local providers use no key; report an empty slot so the client hides the key UI for them.
  if (isLocalProvider(provider)) return { hasKey: false, last4: null, fromEnv: false };
  const saved = getRaw(`apikey.${provider}`);
  const envKey = envKeyFor(provider);
  const effective = saved || envKey;
  if (!effective) return { hasKey: false, last4: null, fromEnv: false };
  return {
    hasKey: true,
    last4: effective.slice(-4),
    fromEnv: !saved && !!envKey,
  };
}

// ---- AI chat keys / model ----------------------------------------------------

/** Saved-in-DB chat key wins; openai falls back to the transcription key, anthropic to env. */
export function getChatApiKey(p: ChatProvider): string {
  const saved = getRaw(`chat.apikey.${p}`);
  if (saved) return saved;
  if (p === "openai") return getApiKey("openai");
  return env.anthropicApiKey;
}

export function setChatApiKey(p: ChatProvider, key: string): void {
  setRaw(`chat.apikey.${p}`, key);
}

export function clearChatApiKey(p: ChatProvider): void {
  delRaw(`chat.apikey.${p}`);
}

function maskChatKey(p: ChatProvider): ChatKeyState {
  const saved = getRaw(`chat.apikey.${p}`);
  if (saved) return { hasKey: true, last4: saved.slice(-4), fromEnv: false };

  if (p === "openai") {
    // No dedicated chat key saved — borrow the transcription OpenAI key, if any.
    const transcriptionSaved = getRaw("apikey.openai");
    const transcriptionKey = transcriptionSaved || env.openaiApiKey;
    if (!transcriptionKey) return { hasKey: false, last4: null, fromEnv: false };
    return {
      hasKey: true,
      last4: transcriptionKey.slice(-4),
      fromEnv: !transcriptionSaved,
      fromTranscription: true,
    };
  }

  // anthropic
  if (!env.anthropicApiKey) return { hasKey: false, last4: null, fromEnv: false };
  return { hasKey: true, last4: env.anthropicApiKey.slice(-4), fromEnv: true };
}

export function getChatModel(): { provider: ChatProvider; id: string } | null {
  const provider = getRaw("chat.model.provider");
  const id = getRaw("chat.model.id");
  if (!provider || !id || !CHAT_PROVIDERS.includes(provider as ChatProvider)) return null;
  return { provider: provider as ChatProvider, id };
}

export function setChatModel(provider: ChatProvider, id: string): void {
  setRaw("chat.model.provider", provider);
  setRaw("chat.model.id", id);
}

// ---- public snapshot (masked) ----------------------------------------------

export interface MaskedSettings {
  provider: Provider;
  model: string;
  models: Record<Provider, string[]>;
  modelByProvider: Record<Provider, string>;
  keys: Record<Provider, { hasKey: boolean; last4: string | null; fromEnv: boolean }>;
  chatKeys: Record<ChatProvider, ChatKeyState>;
  chatModel: { provider: ChatProvider; id: string } | null;
}

export function maskedSettings(): MaskedSettings {
  const provider = getProvider();
  return {
    provider,
    model: getModel(provider),
    models: MODELS,
    modelByProvider: {
      openai: getModel("openai"),
      deepgram: getModel("deepgram"),
      local: getModel("local"),
    },
    keys: { openai: maskKey("openai"), deepgram: maskKey("deepgram"), local: maskKey("local") },
    chatKeys: { openai: maskChatKey("openai"), anthropic: maskChatKey("anthropic") },
    chatModel: getChatModel(),
  };
}
