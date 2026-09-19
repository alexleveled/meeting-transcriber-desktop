import { NextResponse } from "next/server";
import { CHAT_PROVIDERS, type ChatProvider } from "@/lib/types";
import { getChatApiKey } from "@/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

interface Body {
  provider?: ChatProvider;
  /** Optional inline key to test before saving; falls back to the stored/env key. */
  key?: string;
}

/** Cheap authenticated GET per provider — 2xx means the key works. */
async function validateKey(provider: ChatProvider, key: string): Promise<{ valid: boolean; error?: string }> {
  try {
    if (provider === "openai") {
      const res = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.ok) return { valid: true };
      if (res.status === 401 || res.status === 403)
        return { valid: false, error: "Invalid API key (unauthorized)" };
      return { valid: false, error: `OpenAI returned HTTP ${res.status}` };
    }
    // anthropic
    const res = await fetch("https://api.anthropic.com/v1/models", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    if (res.ok) return { valid: true };
    if (res.status === 401 || res.status === 403)
      return { valid: false, error: "Invalid API key (unauthorized)" };
    return { valid: false, error: `Anthropic returned HTTP ${res.status}` };
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
  if (!provider || !CHAT_PROVIDERS.includes(provider)) {
    return NextResponse.json({ valid: false, error: "Unknown provider" }, { status: 400 });
  }

  const key = body.key?.trim() || getChatApiKey(provider);
  if (!key) {
    return NextResponse.json({ valid: false, error: "No API key to test" });
  }

  return NextResponse.json(await validateKey(provider, key));
}
