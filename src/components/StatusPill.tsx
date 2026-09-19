"use client";

import type { SourceStatus } from "@/lib/recorder-engine";

const STATUS_META: Record<SourceStatus, { label: string; fg: string; bg: string; pulse?: boolean }> = {
  idle: { label: "Idle", fg: "var(--text-muted)", bg: "var(--surface-2)" },
  arming: { label: "Arming…", fg: "var(--warn)", bg: "var(--warn-soft)", pulse: true },
  live: { label: "Live", fg: "var(--success)", bg: "var(--success-soft)", pulse: true },
  reconnecting: { label: "Reconnecting…", fg: "var(--warn)", bg: "var(--warn-soft)", pulse: true },
  stopped: { label: "Stopped", fg: "var(--text-muted)", bg: "var(--surface-2)" },
  error: { label: "Error", fg: "var(--danger)", bg: "var(--danger-soft)" },
};

export function StatusPill({ status }: { status: SourceStatus }) {
  const m = STATUS_META[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{ background: m.bg, color: m.fg }}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${m.pulse ? "animate-pulse" : ""}`}
        style={{ background: m.fg }}
      />
      {m.label}
    </span>
  );
}
