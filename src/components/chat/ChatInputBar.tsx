"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import type { ChatModel, ChatProvider, SpecialtyRow } from "@/lib/types";
import { ChatMenu } from "./ChatMenu";

const MAX_ROWS = 5;
const LINE_HEIGHT_PX = 20;

/**
 * The always-visible chat bar: menu trigger, auto-growing textarea, overlay toggle, send/stop.
 * Shows the active model + specialty as a compact pill underneath.
 */
export function ChatInputBar({
  ready,
  disabledHint,
  isStreaming,
  send,
  stop,
  overlayOpen,
  setOverlayOpen,
  unread,
  clearUnread,
  model,
  models,
  setModel,
  hasAnyKey,
  specialty,
  setSpecialty,
  specialties,
  addSpecialty,
  updateSpecialty,
  removeSpecialty,
  menuOpen,
  setMenuOpen,
}: {
  ready: boolean;
  disabledHint?: string;
  isStreaming: boolean;
  send: (text: string) => void;
  stop: () => void;
  overlayOpen: boolean;
  setOverlayOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  unread: boolean;
  clearUnread: () => void;
  model: { provider: ChatProvider; id: string } | null;
  models: Record<ChatProvider, ChatModel[]> | null;
  setModel: (m: { provider: ChatProvider; id: string }) => void;
  hasAnyKey: boolean;
  specialty: SpecialtyRow | null;
  setSpecialty: (s: SpecialtyRow | null) => void;
  specialties: SpecialtyRow[];
  addSpecialty: (name: string, prompt: string) => Promise<SpecialtyRow>;
  updateSpecialty: (id: number, patch: { name: string; prompt: string }) => Promise<SpecialtyRow>;
  removeSpecialty: (id: number) => Promise<void>;
  menuOpen: boolean;
  setMenuOpen: (open: boolean) => void;
}) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const modelLabel = model
    ? models?.[model.provider]?.find((m) => m.id === model.id)?.label ?? model.id
    : null;

  const disabled = !ready;
  const placeholder = !hasAnyKey
    ? "Add an API key in Settings to chat"
    : disabled
      ? disabledHint ?? "Chat is unavailable"
      : "Ask about this meeting…";

  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const max = LINE_HEIGHT_PX * MAX_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  function submit() {
    if (!text.trim() || isStreaming) return;
    send(text);
    setText("");
    requestAnimationFrame(autoGrow);
  }

  function toggleOverlay() {
    setOverlayOpen((o) => !o);
    clearUnread();
  }

  return (
    <div className="card relative p-2">
      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          disabled={disabled || !hasAnyKey}
          placeholder={placeholder}
          onChange={(e) => {
            setText(e.target.value);
            autoGrow();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          className="input min-h-9 flex-1 resize-none py-2"
          style={{ overflowY: "hidden" }}
        />

        <button
          aria-label={overlayOpen ? "Collapse chat" : "Expand chat"}
          title={overlayOpen ? "Collapse chat" : "Expand chat"}
          onClick={toggleOverlay}
          disabled={disabled}
          className="btn btn-ghost btn-icon relative rounded-lg"
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: overlayOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
          {unread && !overlayOpen && (
            <span
              className="absolute right-1 top-1 h-2 w-2 rounded-full"
              style={{ background: "var(--danger)" }}
            />
          )}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-2 px-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <button
            aria-label="Chat options"
            title="Model & specialty"
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={disabled}
            className="btn btn-ghost btn-icon shrink-0 rounded-lg"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="3" width="18" height="18" rx="5" fill="none" />
              <line x1="9.5" y1="16" x2="14.5" y2="8" strokeLinecap="round" />
            </svg>
          </button>
          {modelLabel && (
            <span className="truncate text-xs font-medium" style={{ color: "var(--text)" }}>
              {modelLabel}
            </span>
          )}
          {specialty && (
            <span className="truncate text-xs" style={{ color: "var(--text-muted)" }}>
              · {specialty.name}
            </span>
          )}
          {!hasAnyKey && (
            <Link href="/settings" className="truncate text-[11px] hover:underline" style={{ color: "var(--text-muted)" }}>
              Add an API key in Settings
            </Link>
          )}
        </div>

        {isStreaming ? (
          <button className="btn btn-danger h-8 shrink-0 px-3" onClick={stop}>
            Stop
          </button>
        ) : (
          <button
            className="btn btn-primary h-8 shrink-0 px-3"
            onClick={submit}
            disabled={disabled || !hasAnyKey || !text.trim()}
          >
            Send
          </button>
        )}
      </div>

      {menuOpen && (
        <ChatMenu
          models={models}
          model={model}
          setModel={setModel}
          specialty={specialty}
          setSpecialty={setSpecialty}
          specialties={specialties}
          addSpecialty={addSpecialty}
          updateSpecialty={updateSpecialty}
          removeSpecialty={removeSpecialty}
          onClose={() => setMenuOpen(false)}
        />
      )}
    </div>
  );
}
