import { NextResponse } from "next/server";
import { deleteSpecialty, updateSpecialty } from "@/server/chat-queries";

export const dynamic = "force-dynamic";

// Specialties are reusable saved prompts selectable from the chat bar.

type Ctx = { params: Promise<{ id: string }> };

interface PatchBody {
  name?: string;
  prompt?: string;
}

export async function PATCH(req: Request, { params }: Ctx) {
  const { id } = await params;
  const numId = Number(id);

  if (!Number.isFinite(numId) || !Number.isInteger(numId)) {
    return NextResponse.json({ error: "Invalid specialty id" }, { status: 400 });
  }

  let body: PatchBody = {};
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if ((body.name !== undefined && body.name.trim() === "") || (body.prompt !== undefined && body.prompt.trim() === "")) {
    return NextResponse.json({ error: "name and prompt cannot be empty" }, { status: 400 });
  }

  const specialty = updateSpecialty(numId, {
    name: body.name?.trim(),
    prompt: body.prompt?.trim(),
  });

  if (!specialty) {
    return NextResponse.json({ error: "Specialty not found" }, { status: 404 });
  }

  return NextResponse.json({ specialty });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const numId = Number(id);

  if (!Number.isFinite(numId) || !Number.isInteger(numId)) {
    return NextResponse.json({ error: "Invalid specialty id" }, { status: 400 });
  }

  const ok = deleteSpecialty(numId);
  if (!ok) {
    return NextResponse.json({ error: "Specialty not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
