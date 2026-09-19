"use client";

import { useEffect, useRef } from "react";
import type { ChatMessageRow } from "@/lib/types";
import { ChatMessageBubble } from "./ChatMessageBubble";
import { ChatRichText } from "./ChatRichText";

/**
 * The conversation panel, expanding upward from the input bar. Owns its own scroll-to-bottom
 * behavior (separate from the transcript's stick-to-bottom instance) since it lives in its own
 * scroll container with its own lifecycle.
 */
export function ChatOverlay({
  messages,
  streamingText,
  isStreaming,
  error,
  onClose,
  onGoTo,
}: {
  messages: ChatMessageRow[];
  streamingText: string;
  isStreaming: boolean;
  error: string | null;
  onClose: () => void;
  onGoTo: (startedAtMs: number, seq: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages.length, streamingText, error]);

  return (
    <div
      className="card absolute bottom-full left-0 right-0 z-50 mb-2 flex max-h-[50vh] flex-col overflow-hidden shadow-lg"
      style={{ border: "1px solid var(--border)" }}
    >
      <div
        className="flex shrink-0 items-center justify-between px-3 py-2"
        style={{ borderBottom: "1px solid var(--border)" }}
      >
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          {messages.length === 0 ? "Chat" : `${messages.length} message${messages.length === 1 ? "" : "s"}`}
        </span>
        <button
          aria-label="Close chat"
          onClick={onClose}
          className="btn btn-ghost btn-icon rounded text-xs"
          style={{ width: "1.5rem", height: "1.5rem" }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div ref={scrollRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {messages.length === 0 && !isStreaming && !streamingText ? (
          <div className="py-8 text-center text-sm" style={{ color: "var(--text-muted)" }}>
            Ask a question about this meeting.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((m) => (
              <ChatMessageBubble key={m.id} message={m} onGoTo={onGoTo} />
            ))}
            {isStreaming && (
              <div className="flex flex-col items-start">
                {/* Same renderer as the finalized bubble, so the reply doesn't reflow when the
                    stream ends and citation chips take the place of the raw [n] markers. */}
                <ChatRichText
                  text={streamingText}
                  citations={[]}
                  onGoTo={onGoTo}
                  trailing={<span className="chat-cursor" />}
                />
              </div>
            )}
          </div>
        )}
        {error && (
          <p className="mt-3 text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
