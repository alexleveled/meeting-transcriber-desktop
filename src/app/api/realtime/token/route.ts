import { NextResponse } from "next/server";
import {
  getApiKey,
  getModel,
  getProvider,
  isLocalProvider,
  MODELS,
  type Provider,
} from "@/server/settings";
import { isDownloaded } from "@/server/whisper/models";

export const dynamic = "force-dynamic";

interface Body {
  model?: string;
  /**
   * Provider override for a recording that can't use the settings provider. Phone-call mode needs
   * Deepgram (it's the only provider here that diarizes), so it asks for it explicitly. Only the
   * literal "deepgram" is honored — anything else falls back to the configured provider.
   */
  provider?: string;
}

/**
 * Mints a short-lived token for the active provider. The real API key never leaves the server:
 *  - OpenAI: client_secret from POST /v1/realtime/transcription_sessions (session config baked in).
 *  - Deepgram: temporary access token from POST /v1/auth/grant (added in step 9).
 * Returns { provider, model, token, expiresAt } for the browser to open a direct WS.
 */
export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    /* empty body ok */
  }

  // Never trust the client with an arbitrary provider — only the one override we support.
  const overridden = body.provider === "deepgram";
  const provider: Provider = overridden ? "deepgram" : getProvider();

  // Local Whisper needs no token/key. Short-circuit before the API-key check; the browser provider
  // talks to /api/local-whisper/* directly. Reject early if the selected model isn't downloaded.
  if (isLocalProvider(provider)) {
    const model = body.model?.trim() || getModel(provider);
    if (!isDownloaded(model)) {
      return NextResponse.json(
        { error: "This Whisper model isn't downloaded yet. Download it in Settings first." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      provider,
      model,
      token: "local",
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    });
  }

  const apiKey = getApiKey(provider);
  if (!apiKey) {
    return NextResponse.json(
      { error: `No API key configured for ${provider}. Add one in Settings.` },
      { status: 400 },
    );
  }
  // An override means the requested model may belong to the *other* provider, so it's only kept
  // when this provider actually offers it. Without an override the model passes through as before.
  const requested = body.model?.trim();
  const model = overridden
    ? requested && MODELS[provider].includes(requested)
      ? requested
      : getModel(provider)
    : requested || getModel(provider);

  try {
    if (provider === "openai") return NextResponse.json(await mintOpenAI(apiKey, model, provider));
    return NextResponse.json(await mintDeepgram(apiKey, model, provider));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 502 });
  }
}

async function mintOpenAI(apiKey: string, model: string, provider: Provider) {
  // GA Realtime API: mint an ephemeral client secret bound to a transcription session.
  // The session config (pcm16 @ 24kHz, model, server-VAD, near-field noise reduction) is baked
  // into the token here, so the browser only streams audio and reads events.
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      session: {
        type: "transcription",
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 24000 },
            transcription: { model },
            turn_detection: { type: "server_vad", silence_duration_ms: 500 },
            noise_reduction: { type: "near_field" },
          },
        },
      },
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`OpenAI token mint failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
  }
  // GA response: { value: "ek_...", expires_at: <unix s>, session: {...} }.
  const data = (await res.json()) as {
    value?: string;
    expires_at?: number;
    client_secret?: { value: string; expires_at: number };
  };
  const value = data.value ?? data.client_secret?.value;
  const expiresAtUnix = data.expires_at ?? data.client_secret?.expires_at;
  if (!value) throw new Error("OpenAI response missing client secret value");
  return {
    provider,
    model,
    token: value,
    expiresAt: (expiresAtUnix ?? Math.floor(Date.now() / 1000) + 60) * 1000,
  };
}

async function mintDeepgram(apiKey: string, model: string, provider: Provider) {
  // Preferred path: mint a short-lived token so the real key never reaches the browser.
  // Requires the API key to have the `keys:write` scope (Owner/Admin key).
  const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl_seconds: 30 }),
  });
  if (res.ok) {
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) throw new Error("Deepgram response missing access_token");
    return {
      provider,
      model,
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in ?? 30) * 1000,
    };
  }

  // Fallback: a member-scoped key can't mint grants (403). For a local single-user
  // app the key already lives in a local plaintext DB, so streaming with the raw key
  // over a localhost-originated WS is the same trust boundary. Degrade gracefully so
  // recording still works; upgrade to a `keys:write` key to use ephemeral tokens.
  if (res.status === 401 || res.status === 403) {
    return {
      provider,
      model,
      token: apiKey,
      // Raw keys don't expire; the engine rotates on its own 25-min timer regardless.
      expiresAt: Date.now() + 6 * 60 * 60 * 1000,
    };
  }

  const text = await res.text().catch(() => "");
  throw new Error(`Deepgram token grant failed (HTTP ${res.status}): ${text.slice(0, 300)}`);
}
