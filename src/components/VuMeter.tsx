"use client";

/** Horizontal VU meter driven by an RMS level (~0..0.4 typical speech). */
export function VuMeter({
  level,
  color = "var(--accent)",
  label,
}: {
  level: number;
  color?: string;
  label?: string;
}) {
  // Perceptual scaling — speech RMS is small; boost and clamp to 0..1.
  const pct = Math.min(1, Math.sqrt(Math.max(0, level)) * 1.6) * 100;
  return (
    <div className="flex items-center gap-2">
      {label && (
        <span className="w-20 shrink-0 text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
      )}
      <div
        className="relative h-2.5 flex-1 overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
      >
        <div
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-75"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
    </div>
  );
}
