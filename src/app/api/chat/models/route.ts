import { NextResponse } from "next/server";
import { CHAT_PROVIDERS, type ChatProvider } from "@/lib/types";
import { getChatModels } from "@/server/chat-models";
import { getChatModel, setChatModel } from "@/server/settings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET ?refresh=1 — cached (or freshly fetched) chat model lists for every provider. */
export async function GET(req: Request) {
  const refresh = new URL(req.url).searchParams.get("refresh") === "1";
  const { models, fetchedAt } = await getChatModels({ refresh });
  return NextResponse.json({ models, selected: getChatModel(), fetchedAt });
}

interface PutBody {
  provider?: ChatProvider;
  id?: string;
}

/** PUT { provider, id } — set the selected chat model. */
export async function PUT(req: Request) {
  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.provider || !CHAT_PROVIDERS.includes(body.provider)) {
    return NextResponse.json({ error: `Unknown provider: ${body.provider}` }, { status: 400 });
  }
  if (!body.id || !body.id.trim()) {
    return NextResponse.json({ error: "Missing model id" }, { status: 400 });
  }

  setChatModel(body.provider, body.id.trim());
  return NextResponse.json({ selected: getChatModel() });
}
