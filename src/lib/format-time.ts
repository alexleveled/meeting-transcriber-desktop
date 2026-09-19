/** Small, dependency-free time/duration formatters shared by server and client. */

/** ms → "m:ss" or "h:mm:ss". */
export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** epoch ms → "Jul 15, 2026 · 3:42 PM" (locale-stable-ish). */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${date} · ${time}`;
}

export function sessionDurationMs(startedAt: number, endedAt: number | null): number {
  return (endedAt ?? Date.now()) - startedAt;
}
