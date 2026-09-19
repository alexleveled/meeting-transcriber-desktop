"use client";

import { createPortal } from "react-dom";
import type { Citation } from "@/lib/types";

/**
 * Preview card for a cited transcript line, with a jump-to-section action.
 *
 * It renders through a portal to <body> with fixed positioning rather than as an absolutely
 * positioned child of the chip. The chip lives inside the chat overlay's scroll container, and an
 * absolutely positioned popover in there gets clipped by that container's overflow — which is what
 * made the preview appear not to open at all. Anchoring to the chip's viewport rect sidesteps the
 * clipping entirely and lets the card flip below the chip when there isn't room above it.
 */

const WIDTH = 256;
const GAP = 10;
const EDGE = 8;
/** Below this much room above the chip, the card flips underneath it instead. */
const MIN_SPACE_ABOVE = 190;

export function CitationPopover({
  citation,
  anchor,
  onGoTo,
  onClose,
}: {
  citation: Citation;
  /** The chip's viewport rect, re-measured as the page scrolls. */
  anchor: DOMRect;
  onGoTo: () => void;
  onClose: () => void;
}) {
  const above = anchor.top >= MIN_SPACE_ABOVE;
  const left = Math.min(
    Math.max(anchor.left + anchor.width / 2 - WIDTH / 2, EDGE),
    window.innerWidth - WIDTH - EDGE,
  );
  // Anchoring "above" by its bottom edge means the card never has to be measured first.
  const position = above
    ? { bottom: window.innerHeight - anchor.top + GAP }
    : { top: anchor.bottom + GAP };
  // The arrow tracks the chip even when the card was clamped away from the viewport edge.
  const arrowLeft = Math.min(Math.max(anchor.left + anchor.width / 2 - left, 14), WIDTH - 14);

  return createPortal(
    <>
      <div className="fixed inset-0 z-[58]" onClick={onClose} />
      <div
        role="dialog"
        className="card fixed z-[59] p-3 text-left shadow-lg"
        style={{ left, width: WIDTH, ...position }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-xs font-semibold" style={{ color: "var(--text)" }}>
          {citation.label}
        </p>
        <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
          {citation.snippet}
        </p>
        <button
          className="btn btn-secondary mt-2.5 w-full px-2 py-1 text-xs"
          onClick={() => {
            onGoTo();
            onClose();
          }}
        >
          Go to section
        </button>

        {/* A rotated square peeking out of the card, masked on two sides so only the tip shows. */}
        <span
          className="absolute h-2.5 w-2.5 rotate-45"
          style={{
            left: arrowLeft - 5,
            [above ? "bottom" : "top"]: "-6px",
            background: "var(--surface)",
            borderRight: above ? "1px solid var(--border)" : undefined,
            borderBottom: above ? "1px solid var(--border)" : undefined,
            borderLeft: above ? undefined : "1px solid var(--border)",
            borderTop: above ? undefined : "1px solid var(--border)",
          }}
        />
      </div>
    </>,
    document.body,
  );
}
