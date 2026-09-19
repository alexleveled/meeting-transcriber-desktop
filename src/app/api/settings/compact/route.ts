import { NextResponse } from "next/server";
import { getCompactPosition, setCompactPosition } from "@/server/settings";

/**
 * Compact-widget position KV endpoint. The renderer (browser or Electron) is the sole writer of
 * the SQLite settings table; the Electron main process forwards `window:moved` events to the
 * renderer, which debounces and PUTs here so the widget reopens where it was left.
 */

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(getCompactPosition() ?? { x: null, y: null });
}

export async function PUT(req: Request) {
  let body: { x?: unknown; y?: unknown };
  try {
    body = (await req.json()) as { x?: unknown; y?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const x = Number(body.x);
  const y = Number(body.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return NextResponse.json({ error: "x and y must be numbers" }, { status: 400 });
  }
  setCompactPosition({ x, y });
  return NextResponse.json({ x: Math.round(x), y: Math.round(y) });
}
