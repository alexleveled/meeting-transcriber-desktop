import { NextResponse } from "next/server";
import { ensureRunning, transcribe } from "@/server/whisper/manager";
import { encodeWav, resamplePcm16 } from "@/server/whisper/wav";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const IN_RATE = 24000; // browser pipeline rate
const OUT_RATE = 16000; // whisper.cpp rate

/**
 * POST /api/local-whisper/transcribe?model=<file>&language=<bcp47>
 * Body: raw mono PCM16 @ 24 kHz (one buffered speech window).
 * Returns { segments: [{ text, startMs, endMs }] } with times RELATIVE to the window start;
 * the caller offsets them onto the stream timeline.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const model = url.searchParams.get("model") ?? "";
  const language = url.searchParams.get("language") ?? "en";

  const raw = Buffer.from(await req.arrayBuffer());
  if (raw.length < 2) return NextResponse.json({ segments: [] });

  // Reinterpret the bytes as Int16 samples. Buffer may not be 2-aligned in its pool, so copy.
  const samples = new Int16Array(raw.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = raw.readInt16LE(i * 2);

  const durationMs = (samples.length / IN_RATE) * 1000;

  try {
    await ensureRunning(model);
    const wav = encodeWav(resamplePcm16(samples, IN_RATE, OUT_RATE), OUT_RATE);
    const result = await transcribe(wav, language);

    let segments: Array<{ text: string; startMs: number; endMs: number }>;
    if (result.segments.length > 0) {
      segments = result.segments.map((s) => ({
        text: s.text,
        startMs: Math.round(s.start * 1000),
        endMs: Math.round(s.end * 1000),
      }));
    } else if (result.text) {
      // No per-segment timing — emit the whole window as one utterance.
      segments = [{ text: result.text, startMs: 0, endMs: Math.round(durationMs) }];
    } else {
      segments = [];
    }
    return NextResponse.json({ segments });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
