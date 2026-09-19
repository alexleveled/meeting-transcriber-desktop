import { NextResponse } from "next/server";
import { createSpecialty, listSpecialties } from "@/server/chat-queries";

export const dynamic = "force-dynamic";

// Specialties are reusable saved prompts selectable from the chat bar.

export function GET() {
  return NextResponse.json({ specialties: listSpecialties() });
}

interface Body {
  name?: string;
  prompt?: string;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = body.name?.trim() || "";
  const prompt = body.prompt?.trim() || "";

  if (!name || !prompt) {
    return NextResponse.json({ error: "name and prompt are required" }, { status: 400 });
  }

  const specialty = createSpecialty({ name, prompt });
  return NextResponse.json({ specialty }, { status: 201 });
}
