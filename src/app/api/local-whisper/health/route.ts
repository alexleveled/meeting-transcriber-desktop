import { NextResponse } from "next/server";
import { isDownloaded, isKnownModel } from "@/server/whisper/models";
import { ensureRunning, serverBinaryExists } from "@/server/whisper/manager";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET ?model=<file> — warm the whisper-server for `model` so the first utterance isn't delayed by
 * model load. Called by LocalWhisperProvider.connect(). Returns 400 (not 500) with a friendly
 * message when the binary or model file is missing, so the recorder can surface it cleanly.
 */
export async function GET(req: Request) {
  const model = new URL(req.url).searchParams.get("model") ?? "";
  if (!isKnownModel(model)) {
    return NextResponse.json({ error: `Unknown local model: ${model}` }, { status: 400 });
  }
  if (!serverBinaryExists()) {
    return NextResponse.json(
      { error: "Local Whisper engine is not installed. Reinstall the app or run the fetch script." },
      { status: 400 },
    );
  }
  if (!isDownloaded(model)) {
    return NextResponse.json(
      { error: "This Whisper model isn't downloaded yet. Download it in Settings first." },
      { status: 400 },
    );
  }
  try {
    await ensureRunning(model);
    return NextResponse.json({ ready: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
