import type { CompactPosition } from "@/lib/window-adapter";

/**
 * Client helpers for the remembered compact-widget position. The DB stays single-owner: the
 * renderer reads/writes `compact.x` / `compact.y` through the settings REST API (main process
 * never touches SQLite). Used by the Electron adapter's debounced move-save and by
 * enterCompact() to restore the last spot.
 */

export async function getSavedCompactPosition(): Promise<CompactPosition | null> {
  const res = await fetch("/api/settings/compact");
  if (!res.ok) return null;
  const data = (await res.json()) as { x: number | null; y: number | null };
  if (typeof data.x === "number" && typeof data.y === "number") {
    return { x: data.x, y: data.y };
  }
  return null;
}

export async function saveCompactPosition(pos: CompactPosition): Promise<void> {
  await fetch("/api/settings/compact", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(pos),
  }).catch(() => {});
}
