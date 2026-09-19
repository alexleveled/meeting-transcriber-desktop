"use client";

import { useCallback, useRef } from "react";
import { SessionTranscript } from "@/components/SessionTranscript";
import { ChatDock } from "@/components/chat/ChatDock";
import type { TranscriptRow } from "@/components/TranscriptList";
import type { ChatMessageRow } from "@/lib/types";
import { highlightSegment } from "@/lib/highlight-segment";

/**
 * Session detail page body: the transcript panel (which owns its own internal scroller) plus the
 * chat dock fixed beneath it in the same fixed-height column. `scrollToSegment` finds the
 * transcript row by its `data-seg` attribute *within the transcript's own scroll container* (not
 * the page — the page never scrolls), scrolls it into view, and briefly highlights it.
 */
export function SessionWorkspace({
  sessionId,
  rows,
  initialSwapped,
  showSwap,
  initialChatMessages,
}: {
  sessionId: string;
  rows: TranscriptRow[];
  initialSwapped: boolean;
  showSwap: boolean;
  initialChatMessages: ChatMessageRow[];
}) {
  const transcriptScrollRef = useRef<HTMLDivElement>(null);

  const scrollToSegment = useCallback((startedAtMs: number, seq: number) => {
    const el = transcriptScrollRef.current?.querySelector<HTMLElement>(
      `[data-seg="${startedAtMs}:${seq}"]`,
    );
    if (!el) return;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    highlightSegment(el);
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <SessionTranscript
        sessionId={sessionId}
        rows={rows}
        initialSwapped={initialSwapped}
        showSwap={showSwap}
        scrollContainerRef={transcriptScrollRef}
      />
      <div className="shrink-0">
        <ChatDock
          sessionId={sessionId}
          initialMessages={initialChatMessages}
          scrollToSegment={scrollToSegment}
        />
      </div>
    </div>
  );
}
