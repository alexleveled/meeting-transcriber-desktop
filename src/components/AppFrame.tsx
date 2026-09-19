"use client";

import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { RecordingPill } from "@/components/RecordingPill";
import { CompactWidget } from "@/components/CompactWidget";
import { WindowTitleBar } from "@/components/WindowTitleBar";
import { FirstRunToast } from "@/components/FirstRunToast";
import { NotReadyToast } from "@/components/NotReadyToast";
import { useRecorder } from "@/hooks/useRecorder";
import { isElectron } from "@/lib/window-adapter";

/**
 * Client shell that drives the compact ↔ dashboard view swap. The full dashboard stays *mounted*
 * (so the recording engine and transcript never remount) and is merely hidden via CSS when the
 * compact widget is showing. Compact mode can be entered while idle (waiting for a call) or while
 * a recording is live — the widget itself swaps a Record button in for the transcript when idle.
 *
 * In Electron the frameless window's custom title bar (drag region + caption controls) is drawn
 * here for dashboard mode; compact mode draws its own drag handle inside the widget.
 */
export function AppFrame({ children }: { children: React.ReactNode }) {
  const rec = useRecorder();
  const compact = rec.viewMode === "compact";

  // isElectron() reads `window` — resolve after mount to avoid a hydration mismatch.
  const [electron, setElectron] = useState(false);
  useEffect(() => setElectron(isElectron()), []);

  // Warm the chat model cache in the background; the route serves cache instantly when fresh.
  useEffect(() => {
    fetch("/api/chat/models").catch(() => {});
  }, []);

  return (
    <>
      <div
        className="flex h-screen flex-col overflow-hidden"
        // Keep mounted but out of sight/interaction while the compact widget is up.
        style={compact ? { visibility: "hidden", pointerEvents: "none" } : undefined}
        aria-hidden={compact}
      >
        {electron && <WindowTitleBar />}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar />
          <main className="flex-1 min-h-0 overflow-hidden">{children}</main>
        </div>
      </div>

      <RecordingPill />
      <NotReadyToast />
      {compact ? <CompactWidget /> : <FirstRunToast />}
    </>
  );
}
