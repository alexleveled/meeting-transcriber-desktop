"use client";

import { usePathname, useRouter } from "next/navigation";
import { useRecorder } from "@/hooks/useRecorder";
import { formatDuration } from "@/lib/format-time";

/**
 * Layout-level "recording live" pill, fixed top-right on every page while a recording is live.
 * Makes the active recording feel like the main event and carries its quick actions:
 * Go compact / View recording / Stop. Hidden in compact mode (the widget takes over) and when
 * the recording isn't live. On the recorder page it collapses to a bare "Go compact" button —
 * everything else it would show is already on that page.
 */
export function RecordingPill() {
  const rec = useRecorder();
  const router = useRouter();
  const pathname = usePathname() ?? "/";

  if (rec.state !== "live" || rec.viewMode === "compact") return null;

  const onRecorderPage = pathname === "/";

  // On the recorder itself the timer, status and Stop are all right there on the page, so the full
  // pill is just duplication that crowds the header actions. Shrink to the one control the page
  // doesn't already offer.
  if (onRecorderPage) {
    return (
      <button
        className="btn btn-secondary fixed right-6 top-5 z-40 px-3 py-1.5 text-xs shadow-lg"
        style={{ boxShadow: "0 6px 20px rgba(15,23,42,0.12)" }}
        onClick={() => void rec.enterCompact()}
        title="Shrink into a floating transcript widget"
      >
        Go compact
      </button>
    );
  }

  return (
    <div
      className="fixed right-6 top-5 z-40 flex items-center gap-3 rounded-full py-2 pl-4 pr-2 shadow-lg"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        boxShadow: "0 6px 20px rgba(15,23,42,0.12)",
      }}
    >
      <span className="relative flex h-2.5 w-2.5">
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-70"
          style={{ background: "var(--danger)" }}
        />
        <span
          className="relative inline-flex h-2.5 w-2.5 rounded-full"
          style={{ background: "var(--danger)" }}
        />
      </span>

      <div className="flex flex-col leading-tight">
        <span className="text-xs font-semibold" style={{ color: "var(--text)" }}>
          Transcript being recorded{rec.activeMode === "phone" ? " · Phone call" : ""}
        </span>
        <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
          {formatDuration(rec.elapsedMs)}
        </span>
      </div>

      <div className="ml-1 flex items-center gap-1">
        <button
          className="btn btn-secondary px-2.5 py-1 text-xs"
          onClick={() => void rec.enterCompact()}
          title="Shrink into a floating transcript widget"
        >
          Go compact
        </button>
        <button
          className="btn btn-secondary px-2.5 py-1 text-xs"
          onClick={() => router.push("/")}
          title="Open the live recorder"
        >
          View
        </button>
        <button
          className="btn btn-danger px-2.5 py-1 text-xs"
          onClick={() => void rec.stop()}
          title="Stop recording"
        >
          Stop
        </button>
      </div>
    </div>
  );
}
