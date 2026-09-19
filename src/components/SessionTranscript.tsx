"use client";

import { type RefObject, useState } from "react";
import { TranscriptList, type TranscriptRow } from "@/components/TranscriptList";

/**
 * Transcript panel on the session detail page. Only phone-call sessions get the swap control:
 * diarization decides which voice is "Me" from whoever speaks first on the connection, and it can
 * pick wrong (or invert after a mid-recording reconnect). The flag is non-destructive — it only
 * changes which label each speaker index renders as, here and in the .txt export.
 *
 * The panel fills the height its parent gives it: the swap-control row stays fixed, and the
 * transcript list scrolls internally. `scrollContainerRef` is forwarded by the parent so citation
 * jumps can scope their `data-seg` lookup to this scroller instead of the page.
 */
export function SessionTranscript({
  sessionId,
  rows,
  initialSwapped,
  showSwap,
  scrollContainerRef,
}: {
  sessionId: string;
  rows: TranscriptRow[];
  initialSwapped: boolean;
  showSwap: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
}) {
  const [swapped, setSwapped] = useState(initialSwapped);

  function toggleSwap() {
    const next = !swapped;
    setSwapped(next);
    void fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speakersSwapped: next }),
    }).catch(() => {});
  }

  return (
    <div className="card flex min-h-0 flex-1 flex-col p-6">
      {showSwap && rows.length > 0 && (
        <div className="mb-4 flex shrink-0 justify-end">
          <button
            className="btn btn-ghost px-2.5 py-1 text-xs"
            onClick={toggleSwap}
            title="The two voices came out the wrong way round"
          >
            Swap speakers
          </button>
        </div>
      )}
      {rows.length === 0 ? (
        <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
          This session has no transcript lines.
        </div>
      ) : (
        <div ref={scrollContainerRef} className="min-h-0 flex-1 overflow-y-auto scroll-slim">
          <TranscriptList rows={rows} swapped={swapped} />
        </div>
      )}
    </div>
  );
}
