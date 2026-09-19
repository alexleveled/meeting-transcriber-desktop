"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessageRow } from "@/lib/types";
import { parseCitations, stripCitationMarkers } from "@/lib/chat-citations";
import { ChatRichText } from "./ChatRichText";

/**
 * One message row in the overlay. User messages are short right-aligned bubbles; assistant
 * messages run full width, left-aligned, rendered as formatted markdown with inline citation
 * chips and the model id shown small underneath.
 */
export function ChatMessageBubble({
  message,
  onGoTo,
}: {
  message: ChatMessageRow;
  onGoTo: (startedAtMs: number, seq: number) => void;
}) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <p
          className="max-w-[85%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm leading-relaxed"
          style={{ background: "var(--surface-2)", color: "var(--text)" }}
        >
          {message.content}
        </p>
      </div>
    );
  }

  const citations = parseCitations(message.citations);

  return (
    <div className="group relative flex flex-col items-start">
      <CopyButton text={message.content} />
      {/* A div, not a p: citation chips carry an absolutely-positioned popover, and a <p> may
          not contain the div/p elements that popover renders (invalid HTML → hydration error). */}
      <div className="w-full pr-8">
        <ChatRichText text={message.content} citations={citations} onGoTo={onGoTo} />
      </div>
      {message.model && (
        <p className="mt-1 text-[11px]" style={{ color: "var(--text-subtle)" }}>
          {message.model}
        </p>
      )}
    </div>
  );
}

/**
 * Copies just this reply, not the whole conversation — the common case is lifting one generated
 * summary out into a doc. Stays invisible until the message is hovered or the button is focused,
 * so it doesn't compete with the text.
 */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(stripCitationMarkers(text));
    } catch {
      return;
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Copied" : "Copy message"}
      title={copied ? "Copied" : "Copy message"}
      className="btn btn-ghost btn-icon absolute right-0 top-0 rounded-lg opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
      style={{ width: "1.75rem", height: "1.75rem", opacity: copied ? 1 : undefined }}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {copied ? (
          <path d="M20 6 9 17l-5-5" />
        ) : (
          <>
            <rect x="9" y="9" width="11" height="11" rx="2" />
            <path d="M5 15V5a2 2 0 0 1 2-2h10" />
          </>
        )}
      </svg>
    </button>
  );
}
