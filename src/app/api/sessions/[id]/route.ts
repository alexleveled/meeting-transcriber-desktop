import { NextResponse } from "next/server";
import { deleteSession, getSegments, getSession, updateSession } from "@/server/queries";
import type { SessionStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session, segments: getSegments(id) });
}

interface PatchBody {
  title?: string;
  status?: SessionStatus;
  speakersSwapped?: boolean;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  let body: PatchBody;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (body.status && body.status !== "recording" && body.status !== "completed") {
    return NextResponse.json({ error: "Invalid status" }, { status: 400 });
  }
  const session = updateSession(id, {
    title: body.title,
    status: body.status,
    speakersSwapped: typeof body.speakersSwapped === "boolean" ? body.speakersSwapped : undefined,
  });
  if (!session) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ session });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const ok = deleteSession(id);
  if (!ok) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
