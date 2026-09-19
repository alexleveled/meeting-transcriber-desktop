"use client";

import { getWindowAdapter } from "@/lib/window-adapter";

/** Drag CSS for the frameless Electron window. */
const DRAG = { WebkitAppRegion: "drag" } as unknown as React.CSSProperties;
const NO_DRAG = { WebkitAppRegion: "no-drag" } as unknown as React.CSSProperties;

/**
 * Custom title bar for the frameless (titleBarStyle: 'hidden') Electron window in dashboard mode.
 * Windows keeps native resize borders + Snap Layouts; we draw the drag region and the three
 * caption controls ourselves (native overlay buttons can't be removed at runtime and would float
 * over the 380px compact widget). Rendered only in Electron, only while not compact.
 */
export function WindowTitleBar() {
  const controls = getWindowAdapter().windowControls;

  return (
    <div
      className="flex h-8 shrink-0 items-center justify-between pl-3"
      style={{ ...DRAG, background: "var(--sidebar)", borderBottom: "1px solid var(--border)" }}
    >
      <span className="text-[11px] font-medium" style={{ color: "var(--text-subtle)" }}>
        Meeting Transcriber
      </span>
      <div className="flex items-center" style={NO_DRAG}>
        <CaptionButton label="Minimize" onClick={() => controls.minimize()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor" strokeWidth="1" /></svg>
        </CaptionButton>
        <CaptionButton label="Maximize" onClick={() => controls.maximizeToggle()}>
          <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1" /></svg>
        </CaptionButton>
        <CaptionButton label="Close" onClick={() => controls.close()} danger>
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" /></svg>
        </CaptionButton>
      </div>
    </div>
  );
}

function CaptionButton({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-11 items-center justify-center transition-colors"
      style={{ color: "var(--text-muted)" }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "#e81123" : "var(--surface-2)";
        e.currentTarget.style.color = danger ? "#fff" : "var(--text)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
        e.currentTarget.style.color = "var(--text-muted)";
      }}
    >
      {children}
    </button>
  );
}
