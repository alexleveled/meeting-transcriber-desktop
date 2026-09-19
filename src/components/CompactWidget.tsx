"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useRecorder } from "@/hooks/useRecorder";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { TranscriptList } from "@/components/TranscriptList";
import { InterimBubble } from "@/components/InterimBubble";
import { JumpToLatestButton } from "@/components/JumpToLatestButton";
import { formatDuration } from "@/lib/format-time";
import {
  isElectron,
  COMPACT_HEIGHT_IDLE,
  COMPACT_HEIGHT_RECORDING,
} from "@/lib/window-adapter";
import { getSavedCompactPosition, saveCompactPosition } from "@/lib/compact-position";

/** Drag CSS for the Electron window (moves the OS window); inert in the browser. */
const DRAG = { WebkitAppRegion: "drag" } as unknown as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as unknown as React.CSSProperties;

const RAIL: { href: string; label: string; icon: React.ReactNode }[] = [
  {
    href: "/",
    label: "Recorder",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
      </svg>
    ),
  },
  {
    href: "/sessions",
    label: "Sessions",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    ),
  },
];

/**
 * Floating compact widget, shown (via the layout CSS view-swap) whenever viewMode === "compact".
 * Two shapes share one layout so the transition is seamless when a call starts:
 *   • Idle (not recording) — a short card with a Record button; useful while waiting for a call.
 *   • Recording — grows to add the live transcript stream and a Stop control.
 * A slim left icon rail (each icon reopens the full dashboard on that page) is always present.
 *
 * In Electron the widget fills the always-on-top window and the OS window is dragged via
 * `-webkit-app-region: drag`. In the browser there's no real window, so the widget is a fixed box
 * dragged around the viewport with pointer events.
 */
export function CompactWidget() {
  const rec = useRecorder();
  const router = useRouter();
  const electron = isElectron();

  const recording = rec.state === "live";
  const arming = rec.state === "arming";

  const { scrollRef, showJump, scrollToBottom, onScroll } = useStickToBottom([
    rec.segmentCount,
    rec.interim.mic,
    rec.interim.system,
  ]);

  // Browser-only free-drag position. Electron drags the OS window instead.
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [placed, setPlaced] = useState(false);
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  // Initial placement (browser only): last saved spot, else top-right of the viewport.
  useEffect(() => {
    if (electron || placed) return;
    let cancelled = false;
    const w = 380;
    const fallback = { x: Math.max(12, window.innerWidth - w - 24), y: 24 };
    getSavedCompactPosition()
      .then((saved) => {
        if (cancelled) return;
        const p = saved ?? fallback;
        // Clamp into the current viewport in case it was saved on a larger screen.
        setPos({
          x: Math.min(Math.max(0, p.x), window.innerWidth - 320),
          y: Math.min(Math.max(0, p.y), window.innerHeight - 120),
        });
        setPlaced(true);
      })
      .catch(() => {
        if (cancelled) return;
        setPos(fallback);
        setPlaced(true);
      });
    return () => {
      cancelled = true;
    };
  }, [electron, placed]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (electron) return; // OS handles the drag
      dragRef.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [electron, pos.x, pos.y],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const x = e.clientX - dragRef.current.dx;
    const y = e.clientY - dragRef.current.dy;
    const maxX = window.innerWidth - 320;
    const maxY = window.innerHeight - 120;
    setPos({ x: Math.min(Math.max(0, x), maxX), y: Math.min(Math.max(0, y), maxY) });
  }, []);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      if (dragRef.current) void saveCompactPosition(pos);
      dragRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    },
    [pos],
  );

  function openPage(href: string) {
    router.push(href);
    void rec.exitCompact();
  }

  // Electron: fill the window (main resizes it). Browser: a fixed floating card whose height
  // tracks whether the transcript is showing.
  const shellStyle: React.CSSProperties = electron
    ? { position: "fixed", inset: 0 }
    : {
        position: "fixed",
        left: pos.x,
        top: pos.y,
        width: 380,
        height: recording ? COMPACT_HEIGHT_RECORDING : COMPACT_HEIGHT_IDLE,
        borderRadius: 14,
        overflow: "hidden",
        boxShadow: "0 12px 40px rgba(15,23,42,0.28)",
      };

  return (
    <div
      className="z-50 flex"
      style={{
        ...shellStyle,
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      {/* Left icon rail — also the drag handle in Electron. */}
      <div
        className="flex w-12 shrink-0 flex-col items-center gap-1 py-3"
        style={{ ...DRAG, background: "var(--sidebar)", borderRight: "1px solid var(--border)" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        {RAIL.map((item) => (
          <div key={item.href} className="group relative" style={NO_DRAG}>
            <button
              className="flex h-9 w-9 items-center justify-center rounded-lg transition-colors hover:bg-surface-2"
              style={{ ...NO_DRAG, color: "var(--text-subtle)" }}
              aria-label={`Open ${item.label}`}
              onClick={() => openPage(item.href)}
            >
              {item.icon}
            </button>
            <Tooltip label={item.label} />
          </div>
        ))}
      </div>

      {/* Right column: header + (transcript when recording) + primary action. */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div
          className="flex items-center justify-between px-3 py-2"
          style={{ ...DRAG, borderBottom: "1px solid var(--border)" }}
        >
          <div className="flex items-center gap-2 font-mono text-sm" style={{ color: "var(--text)" }}>
            <span
              className={`h-2 w-2 rounded-full ${recording ? "animate-pulse" : ""}`}
              style={{ background: recording ? "var(--danger)" : "var(--text-subtle)" }}
            />
            {recording ? (
              formatDuration(rec.elapsedMs)
            ) : (
              <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                {arming ? "Starting…" : "Ready"}
              </span>
            )}
          </div>
          <button
            className="btn btn-secondary px-2 py-1 text-xs"
            style={NO_DRAG}
            onClick={() => void rec.exitCompact()}
            title="Back to the full dashboard"
          >
            Expand
          </button>
        </div>

        {recording ? (
          <div className="relative flex min-h-0 flex-1 flex-col">
            <div ref={scrollRef} onScroll={onScroll} className="flex-1 overflow-y-auto px-3 py-3">
              {rec.segments.length === 0 && !rec.interim.mic && !rec.interim.system ? (
                <div className="py-10 text-center text-xs" style={{ color: "var(--text-muted)" }}>
                  Listening…
                </div>
              ) : (
                <>
                  <TranscriptList
                    rows={rec.segments.map((s) => ({
                      key: s.key,
                      source: s.source,
                      text: s.text,
                      speaker: s.speaker,
                    }))}
                    swapped={rec.speakersSwapped}
                  />
                  <div className="mt-2.5 flex flex-col gap-2.5">
                    {rec.activeMode === "phone" ? (
                      <InterimBubble source="mic" text={rec.interim.mic} label="Hearing…" />
                    ) : (
                      <>
                        <InterimBubble source="system" text={rec.interim.system} />
                        <InterimBubble source="mic" text={rec.interim.mic} />
                      </>
                    )}
                  </div>
                </>
              )}
            </div>
            {showJump && <JumpToLatestButton onClick={() => scrollToBottom()} />}
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center px-3 text-center">
            <p className="text-xs" style={{ color: "var(--text-muted)" }}>
              {arming ? "Requesting audio…" : "Waiting to record. Press Record when your call starts."}
            </p>
          </div>
        )}

        <div className="px-3 py-2" style={{ borderTop: "1px solid var(--border)", ...NO_DRAG }}>
          {recording ? (
            <button className="btn btn-danger w-full py-1.5 text-xs" onClick={() => void rec.stop()}>
              Stop recording
            </button>
          ) : (
            <button
              className="btn btn-primary w-full py-1.5 text-xs"
              disabled={arming}
              onClick={() => void rec.start()}
            >
              <span className="mr-1 h-1.5 w-1.5 rounded-full bg-white" />
              {arming ? "Starting…" : "Record"}
            </button>
          )}
          {rec.error && !recording && (
            <p className="mt-1.5 text-center text-[11px]" style={{ color: "var(--danger)" }}>
              {rec.error}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/** Hover tooltip shown to the right of a compact-rail icon (matches the collapsed sidebar). */
function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100"
      style={{
        background: "var(--text)",
        color: "var(--surface)",
      }}
    >
      {label}
    </span>
  );
}
