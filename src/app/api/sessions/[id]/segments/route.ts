import { NextResponse } from "next/server";
import { getSession, insertSegments } from "@/server/queries";
import type { AudioSource, TranscriptSegment } from "@/lib/types";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

interface Body {
  segments?: Array<{
    source?: string;
    text?: string;
    speaker?: number | null;
    startedAtMs?: number;
    endedAtMs?: number | null;
    seq?: number;
  }>;
}

function sanitize(raw: NonNullable<Body["segments"]>): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const s of raw) {
    if (s.source !== "mic" && s.source !== "system") continue;
    if (typeof s.text !== "string" || s.text.trim() === "") continue;
    if (typeof s.startedAtMs !== "number" || typeof s.seq !== "number") continue;
    out.push({
      source: s.source as AudioSource,
      text: s.text,
      // Diarized speaker index; anything that isn't a finite number persists as NULL.
      speaker: typeof s.speaker === "number" && Number.isFinite(s.speaker)
        ? Math.round(s.speaker)
        : null,
      startedAtMs: Math.round(s.startedAtMs),
      endedAtMs: typeof s.endedAtMs === "number" ? Math.round(s.endedAtMs) : null,
      seq: Math.round(s.seq),
    });
  }
  return out;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  if (!getSession(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!Array.isArray(body.segments)) {
    return NextResponse.json({ error: "Expected { segments: [...] }" }, { status: 400 });
  }

  const clean = sanitize(body.segments);
  const written = insertSegments(id, clean);
  return NextResponse.json({ written });
}
