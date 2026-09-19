import { NextResponse } from "next/server";
import { PROVIDERS, getApiKey, isLocalProvider, type Provider } from "@/server/settings";

export const dynamic = "force-dynamic";

interface Body {
  provider?: Provider;
  /** Optional inline key to test before saving; falls back to the stored/env key. */
  key?: string;
}

/** Cheap authenticated GET per provider — 2xx means the key works. */
async function validateKey(provider: Provider, key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { valid: true };
      if (res.status === 401) return { valid: false, error: "Invalid API key (401 Unauthorized)" };
      return { valid: false, error: `OpenAI returned HTTP ${res.status}` };
    }
    // deepgram
    const res = await fetch("https://api.deepgram.com/v1/projects", {
      headers: { Authorization: `Token ${key}` },
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403)
      return { valid: false, error: "Invalid API key (unauthorized)" };
    return { valid: false, error: `Deepgram returned HTTP ${res.status}` };
  } catch (e) {
    return { valid: false, error: `Network error: ${(e as Error).message}` };
  }
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ valid: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const provider = body.provider;
  if (!provider || !PROVIDERS.includes(provider)) {
    return NextResponse.json({ valid: false, error: "Unknown provider" }, { status: 400 });
  }
  if (isLocalProvider(provider)) {
    return NextResponse.json({ valid: false, error: "Local Whisper needs no API key" });
  }

  const key = body.key?.trim() || getApiKey(provider);
  if (!key) {
    return NextResponse.json({ valid: false, error: "No API key to test" });
  }

  return NextResponse.json(await validateKey(provider, key));
}
