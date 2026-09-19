"use client";

import { useEffect, useState } from "react";
import type { ChatMessageRow, TranscriptSegment } from "@/lib/types";
import { useChat } from "@/hooks/useChat";
import { ChatOverlay } from "./ChatOverlay";
import { ChatInputBar } from "./ChatInputBar";

/**
 * Orchestrates the chat overlay + input bar for a session. Renders as the last, non-shrinking row
 * of the page's fixed-height column, with the transcript scrolling in the space above it.
 *
 * Escape handling has one dismiss target per press: the model/specialty menu first (if open),
 * else the conversation overlay.
 */
export function ChatDock({
  sessionId,
  getSegments,
  swapped,
  initialMessages,
  scrollToSegment,
  disabledHint,
}: {
  sessionId: string | null;
  getSegments?: () => TranscriptSegment[];
  swapped?: boolean;
  initialMessages?: ChatMessageRow[];
  scrollToSegment?: (startedAtMs: number, seq: number) => void;
  disabledHint?: string;
}) {
  const chat = useChat({ sessionId, getSegments, swapped, initialMessages });
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (menuOpen) {
        setMenuOpen(false);
      } else if (chat.overlayOpen) {
        chat.setOverlayOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen, chat.overlayOpen]);

  function handleGoToSegment(startedAtMs: number, seq: number) {
    chat.setOverlayOpen(false);
    scrollToSegment?.(startedAtMs, seq);
  }

  return (
    // The page itself no longer scrolls — the dock is simply the last row of a fixed-height
    // column, so it needs no sticky positioning or fade-out over passing transcript text.
    <div className="shrink-0">
      <div className="relative">
        {chat.overlayOpen && (
          <ChatOverlay
            messages={chat.messages}
            streamingText={chat.streamingText}
            isStreaming={chat.isStreaming}
            error={chat.error}
            onClose={() => chat.setOverlayOpen(false)}
            onGoTo={handleGoToSegment}
          />
        )}
        <ChatInputBar
          ready={chat.ready}
          disabledHint={disabledHint}
          isStreaming={chat.isStreaming}
          send={chat.send}
          stop={chat.stop}
          overlayOpen={chat.overlayOpen}
          setOverlayOpen={chat.setOverlayOpen}
          unread={chat.unread}
          clearUnread={chat.clearUnread}
          model={chat.model}
          models={chat.models}
          setModel={chat.setModel}
          hasAnyKey={chat.hasAnyKey}
          specialty={chat.specialty}
          setSpecialty={chat.setSpecialty}
          specialties={chat.specialties}
          addSpecialty={chat.addSpecialty}
          updateSpecialty={chat.updateSpecialty}
          removeSpecialty={chat.removeSpecialty}
          menuOpen={menuOpen}
          setMenuOpen={setMenuOpen}
        />
      </div>
    </div>
  );
}
