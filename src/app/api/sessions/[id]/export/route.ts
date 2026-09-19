import { getSegments, getSession } from "@/server/queries";
import { formatTranscript } from "@/lib/format-transcript";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function safeFilename(title: string): string {
  const base = title.trim().replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
  return (base || "meeting") + ".txt";
}

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) return new Response("Not found", { status: 404 });

  const segments = getSegments(id);
  const body = formatTranscript(segments, session.speakers_swapped === 1);

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${safeFilename(session.title)}"`,
    },
  });
}
