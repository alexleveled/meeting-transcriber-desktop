import { NextResponse } from "next/server";
import {
  deleteModel,
  downloadState,
  freeDiskBytes,
  isDownloaded,
  knownModels,
  startDownload,
} from "@/server/whisper/models";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET — status of every known local model (downloaded / downloading / progress) + free disk. */
export function GET() {
  const models = knownModels().map((m) => {
    const dl = downloadState(m.file);
    return {
      file: m.file,
      approxBytes: m.approxBytes,
      downloaded: isDownloaded(m.file),
      downloading: !!dl && !dl.error,
      receivedBytes: dl?.receivedBytes ?? 0,
      totalBytes: dl?.totalBytes ?? m.approxBytes,
      error: dl?.error ?? null,
    };
  });
  return NextResponse.json({ models, freeDiskBytes: freeDiskBytes() });
}

interface Body {
  file?: string;
}

/** POST { file } — begin downloading a model (idempotent). */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.file) return NextResponse.json({ error: "Missing model file" }, { status: 400 });
  const r = startDownload(body.file);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}

/** DELETE { file } — remove a downloaded model. */
export async function DELETE(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.file) return NextResponse.json({ error: "Missing model file" }, { status: 400 });
  const r = deleteModel(body.file);
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
