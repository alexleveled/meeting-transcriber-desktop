"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Session title with an inline rename affordance. Shows the name plus a pencil icon; clicking the
 * pencil swaps in a text field that PATCHes `/api/sessions/[id]` on save (Enter) and refreshes the
 * server component so the new title sticks everywhere. Escape / Cancel reverts.
 */
export function SessionTitle({
  sessionId,
  initialTitle,
}: {
  sessionId: string;
  initialTitle: string;
}) {
  const router = useRouter();
  const [title, setTitle] = useState(initialTitle);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialTitle);
  const [busy, setBusy] = useState(false);

  function cancel() {
    setEditing(false);
    setDraft(title);
  }

  async function save() {
    const next = draft.trim();
    if (!next || next === title) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error("Rename failed");
      setTitle(next);
      setEditing(false);
      router.refresh();
    } catch {
      alert("Failed to rename session.");
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void save();
            else if (e.key === "Escape") cancel();
          }}
          className="w-full max-w-md rounded-md border px-2 py-1 text-xl font-semibold outline-none"
          style={{ background: "var(--surface)", borderColor: "var(--accent)", color: "var(--text)" }}
        />
        <button className="btn btn-primary px-2.5 py-1 text-xs" disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button className="btn btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <h1 className="text-xl font-semibold" style={{ color: "var(--text)" }}>
        {title}
      </h1>
      <button
        aria-label="Rename session"
        title="Rename"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        className="rounded-md p-1 opacity-60 transition-opacity hover:bg-surface hover:opacity-100"
        style={{ color: "var(--text-subtle)" }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      </button>
    </div>
  );
}
