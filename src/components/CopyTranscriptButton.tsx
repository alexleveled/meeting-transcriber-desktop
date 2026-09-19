"use client";

import { useEffect, useRef, useState } from "react";
import { formatTranscript, type FormattableSegment } from "@/lib/format-transcript";

/**
 * Copies the current in-memory transcript to the clipboard. Safe to hit mid-recording — it
 * snapshots whatever has been transcribed so far, same text the live .txt export would write.
 */
export function CopyTranscriptButton({
  segments,
  disabled,
  swapped = false,
}: {
  segments: FormattableSegment[];
  disabled?: boolean;
  /** Phone-call sessions whose two diarized voices were swapped by the user. */
  swapped?: boolean;
}) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function flash(next: "copied" | "failed") {
    setState(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  }

  async function copy() {
    const text = formatTranscript(segments, swapped);
    try {
      await navigator.clipboard.writeText(text);
      flash("copied");
    } catch {
      // Clipboard API can be unavailable or blocked (non-secure context, denied permission).
      if (legacyCopy(text)) flash("copied");
      else flash("failed");
    }
  }

  const label =
    state === "copied"
      ? "Transcript copied"
      : state === "failed"
        ? "Copy failed — try again"
        : "Copy the transcript so far to the clipboard";

  return (
    <button
      className="btn btn-secondary btn-icon"
      onClick={copy}
      disabled={disabled || segments.length === 0}
      title={label}
      aria-label={label}
      style={state === "failed" ? { color: "var(--danger)" } : undefined}
    >
      {state === "copied" ? <CheckIcon /> : <ClipboardIcon />}
    </button>
  );
}

function ClipboardIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/** Fallback for environments where navigator.clipboard is missing or rejects. */
function legacyCopy(text: string): boolean {
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
