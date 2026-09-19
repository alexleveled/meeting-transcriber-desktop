"use client";

import { createContext, useContext } from "react";
import type { RecorderEngine, SourceStatus } from "@/lib/recorder-engine";
import type { AudioSource, InputMode, Provider } from "@/lib/types";

export type RecorderState = "idle" | "arming" | "live" | "stopped";

/** Which layout is showing while a recording is live. Portable across browser/Electron. */
export type ViewMode = "dashboard" | "compact";

export interface UseRecorder {
  state: RecorderState;
  sessionId: string | null;
  sourceStatus: Record<AudioSource, SourceStatus>;
  levels: Record<AudioSource, number>;
  elapsedMs: number;
  error: string | null;
  /** Set when Record is pressed before setup is complete (no downloaded model / no API key). */
  notReady: string | null;
  /** Dismiss the not-ready prompt. */
  dismissNotReady: () => void;
  /** Set when the system share needs attention (no audio / cancelled / stopped). */
  systemNeedsAttention: boolean;
  /** Set when phone mode was requested but no Deepgram key is configured (drives the modal). */
  deepgramKeyMissing: boolean;
  /** Open that modal without attempting a start — used when the phone-mode card is picked. */
  reportDeepgramKeyMissing: () => void;
  dismissDeepgramKeyMissing: () => void;
  /** Input mode of the active (or most recent) recording; null while idle. */
  activeMode: InputMode | null;
  /** Phone mode: whether the two diarized voices are shown the other way round. */
  speakersSwapped: boolean;
  /** Flip the two diarized labels and persist the flag on the session. */
  toggleSpeakersSwapped: () => void;
  segments: ReturnType<RecorderEngine["store"]["snapshot"]>["segments"];
  interim: Record<AudioSource, string>;
  segmentCount: number;
  /** True while a batch of segments failed to persist and is being retried. */
  saveWarning: boolean;
  /** Provider/model backing the active (or most recent) recording — for header/pill display. */
  provider: Provider | null;
  model: string | null;
  /** Compact vs dashboard view. Only meaningful while a recording is live. */
  viewMode: ViewMode;
  /** Begin recording. Omit `mode` to reuse the last-used one (localStorage, default "pc"). */
  start: (mode?: InputMode) => Promise<void>;
  resumeSystem: () => Promise<void>;
  stop: () => Promise<void>;
  /** Clear a finished ("stopped") recording so the Recorder page shows the idle/start view again. */
  reset: () => void;
  /** Shrink into the floating compact transcript widget (also drives the OS window in Electron). */
  enterCompact: () => Promise<void>;
  /** Return to the full dashboard. */
  exitCompact: () => Promise<void>;
}

/**
 * Recorder state is owned by a single app-level <RecorderProvider> (mounted in layout.tsx) so a
 * live recording survives navigation between pages and is readable from the header pill and the
 * compact widget. `useRecorder()` is a thin context consumer with the same shape it always had.
 */
export const RecorderContext = createContext<UseRecorder | null>(null);

export function useRecorder(): UseRecorder {
  const ctx = useContext(RecorderContext);
  if (!ctx) {
    throw new Error("useRecorder must be used within <RecorderProvider>");
  }
  return ctx;
}
