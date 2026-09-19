"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Citation } from "@/lib/types";
import { CitationPopover } from "./CitationPopover";

/**
 * Inline `[n]` marker in an assistant reply. Clicking toggles a preview of the cited transcript
 * line with a "Go to section" jump.
 *
 * The popover is portalled to <body> and positioned from this button's viewport rect (it would be
 * clipped by the chat overlay's scroll container otherwise), so the rect has to be re-measured
 * whenever anything scrolls or the window resizes — hence the capture-phase scroll listener,
 * which also catches scrolling of the inner containers this chip sits in.
 */
export function CitationChip({
  citation,
  onGoTo,
}: {
  citation: Citation;
  onGoTo: (startedAtMs: number, seq: number) => void;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const measure = useCallback(() => {
    const el = buttonRef.current;
    if (el) setAnchor(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!anchor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAnchor(null);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [anchor, measure]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => (anchor ? setAnchor(null) : measure())}
        className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded px-1 align-super text-[10px] font-semibold leading-none"
        style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        aria-label={`Citation ${citation.n}: ${citation.label}`}
      >
        {citation.n}
      </button>
      {anchor && (
        <CitationPopover
          citation={citation}
          anchor={anchor}
          onGoTo={() => onGoTo(citation.startedAtMs, citation.seq)}
          onClose={() => setAnchor(null)}
        />
      )}
    </>
  );
}
