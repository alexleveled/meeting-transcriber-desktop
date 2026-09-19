import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { CHAT_PROVIDERS, type ChatModel, type ChatProvider } from "@/lib/types";
import { delSetting, getChatApiKey, getSetting, setSetting } from "./settings";

/**
 * Lists selectable chat models per provider. Results are cached in the `settings` KV table
 * (24h TTL) plus an in-process memo, and degrade to a curated fallback list when the provider
 * API can't be reached or no key is configured.
 */

const TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Static safety net used when a provider's live model list can't be fetched (no key, network
 * error, etc). The live list from the provider always wins when available.
 */
const CURATED_FALLBACK: Record<ChatProvider, ChatModel[]> = {
  openai: [
    { provider: "openai", id: "gpt-5", label: "GPT-5" },
    { provider: "openai", id: "gpt-5-mini", label: "GPT-5 mini" },
    { provider: "openai", id: "gpt-4.1", label: "GPT-4.1" },
    { provider: "openai", id: "gpt-4o", label: "GPT-4o" },
    { provider: "openai", id: "gpt-4o-mini", label: "GPT-4o mini" },
  ],
  anthropic: [
    { provider: "anthropic", id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { provider: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { provider: "anthropic", id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
  ],
};

const EXCLUDE_ID_RE =
  /transcribe|tts|whisper|embedding|realtime|audio|image|dall-e|moderation|search|instruct|codex/;

/**
 * Pinned snapshots of a model OpenAI already exposes under a rolling alias — `gpt-4o-2024-05-13`,
 * `gpt-3.5-turbo-0125`, `…-16k`. Listing them all turns the picker into dozens of near-identical
 * rows, so only the rolling aliases are offered.
 */
const SNAPSHOT_ID_RE = /-\d{4}-\d{2}-\d{2}$|-\d{4}$|-\d+k$/;

async function fetchOpenAIChatModels(key: string): Promise<ChatModel[]> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!res.ok) throw new Error(`OpenAI models list returned HTTP ${res.status}`);
  const body = (await res.json()) as { data?: { id: string }[] };
  const ids = (body.data ?? [])
    .map((m) => m.id)
    .filter(
      (id) =>
        (/^gpt-/.test(id) || /^o\d/.test(id)) &&
        !EXCLUDE_ID_RE.test(id) &&
        !SNAPSHOT_ID_RE.test(id),
    )
    .sort((a, b) => a.localeCompare(b));
  return ids.map((id) => ({ provider: "openai", id, label: id }));
}

async function fetchAnthropicChatModels(key: string): Promise<ChatModel[]> {
  const client = new Anthropic({ apiKey: key });
  const models: ChatModel[] = [];
  for await (const m of client.models.list({ limit: 100 })) {
    models.push({ provider: "anthropic", id: m.id, label: m.display_name ?? m.id });
  }
  return models;
}

const FETCHERS: Record<ChatProvider, (key: string) => Promise<ChatModel[]>> = {
  openai: fetchOpenAIChatModels,
  anthropic: fetchAnthropicChatModels,
};

interface Memo {
  models: ChatModel[];
  fetchedAt: number | null;
}

const memo: Partial<Record<ChatProvider, Memo>> = {};

function kvModelsKey(provider: ChatProvider): string {
  return `chat.models.${provider}`;
}

function kvFetchedAtKey(provider: ChatProvider): string {
  return `chat.models.${provider}.fetchedAt`;
}

/** Clears the in-process memo and the KV cache for a provider (e.g. after its API key changes). */
export function invalidateChatModels(provider: ChatProvider): void {
  delete memo[provider];
  delSetting(kvModelsKey(provider));
  delSetting(kvFetchedAtKey(provider));
}

function readKvCache(provider: ChatProvider): Memo | null {
  const raw = getSetting(kvModelsKey(provider));
  const fetchedAtRaw = getSetting(kvFetchedAtKey(provider));
  if (!raw || !fetchedAtRaw) return null;
  try {
    const models = JSON.parse(raw) as ChatModel[];
    return { models, fetchedAt: Number(fetchedAtRaw) };
  } catch {
    return null;
  }
}

function writeKvCache(provider: ChatProvider, models: ChatModel[], fetchedAt: number): void {
  setSetting(kvModelsKey(provider), JSON.stringify(models));
  setSetting(kvFetchedAtKey(provider), String(fetchedAt));
}

function isFresh(fetchedAt: number | null, ttlMs: number): boolean {
  return fetchedAt !== null && Date.now() - fetchedAt < ttlMs;
}

async function resolveProviderModels(
  provider: ChatProvider,
  refresh: boolean,
): Promise<Memo> {
  const key = getChatApiKey(provider);
  if (!key) return { models: CURATED_FALLBACK[provider], fetchedAt: null };

  const memoed = memo[provider];
  if (memoed && !refresh && isFresh(memoed.fetchedAt, TTL_MS)) return memoed;

  const kv = readKvCache(provider);
  if (kv && !refresh && isFresh(kv.fetchedAt, TTL_MS)) {
    memo[provider] = kv;
    return kv;
  }

  try {
    const models = await FETCHERS[provider](key);
    const fetchedAt = Date.now();
    writeKvCache(provider, models, fetchedAt);
    const result: Memo = { models, fetchedAt };
    memo[provider] = result;
    return result;
  } catch (e) {
    console.warn(`[chat-models] failed to fetch ${provider} models, falling back:`, e);
    if (kv) {
      memo[provider] = kv;
      return kv;
    }
    return { models: CURATED_FALLBACK[provider], fetchedAt: null };
  }
}

export async function getChatModels(opts?: { refresh?: boolean }): Promise<{
  models: Record<ChatProvider, ChatModel[]>;
  fetchedAt: Record<ChatProvider, number | null>;
}> {
  const refresh = opts?.refresh ?? false;
  const entries = await Promise.all(
    CHAT_PROVIDERS.map(async (provider) => [provider, await resolveProviderModels(provider, refresh)] as const),
  );

  const models = {} as Record<ChatProvider, ChatModel[]>;
  const fetchedAt = {} as Record<ChatProvider, number | null>;
  for (const [provider, result] of entries) {
    models[provider] = result.models;
    fetchedAt[provider] = result.fetchedAt;
  }
  return { models, fetchedAt };
}
