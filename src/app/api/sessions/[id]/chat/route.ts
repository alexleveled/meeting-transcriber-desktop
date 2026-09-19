import { NextResponse } from "next/server";
import { getChatMessages } from "@/server/chat-queries";
import { getSession } from "@/server/queries";

/**
 * Chat history for a session. GET-only — messages are written by the streaming
 * endpoint at ./stream/route.ts, not here.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: "Session not found" }, { status: 404 });
  return NextResponse.json({ messages: getChatMessages(id) });
}
