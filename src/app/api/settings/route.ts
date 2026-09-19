import { NextResponse } from "next/server";
import { CHAT_PROVIDERS, type ChatProvider } from "@/lib/types";
import { invalidateChatModels } from "@/server/chat-models";
import {
  PROVIDERS,
  clearApiKey,
  clearChatApiKey,
  maskedSettings,
  setApiKey,
  setChatApiKey,
  setModel,
  setProvider,
  type Provider,
} from "@/server/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(maskedSettings());
}

interface PutBody {
  provider?: Provider;
  model?: string;
  // Per-provider key updates. Omit/undefined a key to leave it unchanged;
  // "" also leaves unchanged (blank field = keep stored key); null clears it.
  keys?: Partial<Record<Provider, string | null>>;
  // Same semantics as `keys`, but for the AI chat providers.
  chatKeys?: Partial<Record<ChatProvider, string | null>>;
}

export async function PUT(req: Request) {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (body.provider !== undefined) {
    if (!PROVIDERS.includes(body.provider)) {
      return NextResponse.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
    }
    setProvider(body.provider);
  }

  if (body.model !== undefined) {
    // Model applies to the effective provider for this request.
    const provider = body.provider ?? maskedSettings().provider;
    try {
      setModel(provider, body.model);
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }

  if (body.keys) {
    for (const provider of PROVIDERS) {
      if (!(provider in body.keys)) continue;
      const val = body.keys[provider];
      if (val === null) {
        clearApiKey(provider);
        // Chat's "openai" model list borrows the transcription openai key as a fallback, so
        // clearing/setting it here can change the effective chat key too — invalidate its cache.
        if (provider === "openai") invalidateChatModels("openai");
      } else if (typeof val === "string" && val.trim() !== "") {
        setApiKey(provider, val.trim());
        if (provider === "openai") invalidateChatModels("openai");
      }
      // "" / undefined => leave the stored key untouched.
    }
  }

  if (body.chatKeys) {
    for (const provider of CHAT_PROVIDERS) {
      if (!(provider in body.chatKeys)) continue;
      const val = body.chatKeys[provider];
      if (val === null) {
        clearChatApiKey(provider);
        invalidateChatModels(provider);
      } else if (typeof val === "string" && val.trim() !== "") {
        setChatApiKey(provider, val.trim());
        invalidateChatModels(provider);
      }
      // "" / undefined => leave the stored key untouched.
    }
  }

  return NextResponse.json(maskedSettings());
}
