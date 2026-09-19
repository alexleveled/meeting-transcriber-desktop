import { NextResponse } from "next/server";
import { createSession, listSessions } from "@/server/queries";
import { getModel, getProvider } from "@/server/settings";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ sessions: listSessions() });
}

interface Body {
  title?: string;
  model?: string;
  inputMode?: string;
}

export async function POST(req: Request) {
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    // empty body is fine — fall back to active provider's model
  }
  const model = body.model?.trim() || getModel(getProvider());
  const inputMode = body.inputMode === "phone" ? "phone" : "pc";
  const session = createSession({ title: body.title, model, inputMode });
  return NextResponse.json({ session }, { status: 201 });
}
