"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SessionRow } from "@/lib/types";
import { formatDateTime, formatDuration, sessionDurationMs } from "@/lib/format-time";

type Session = SessionRow & { segment_count: number };

export function SessionsTable({ sessions: initial }: { sessions: Session[] }) {
  const router = useRouter();
  const [sessions, setSessions] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function open(id: string) {
    router.push(`/sessions/${id}`);
  }

  async function saveTitle(id: string, raw: string) {
    setEditingId(null);
    const next = raw.trim();
    const current = sessions.find((s) => s.id === id);
    if (!current || next === "" || next === current.title) return; // nothing to save

    // Optimistic update, roll back on failure.
    const prev = current.title;
    setSessions((list) => list.map((s) => (s.id === id ? { ...s, title: next } : s)));
    setSaving(true);
    try {
      const res = await fetch(`/api/sessions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      if (!res.ok) throw new Error(`PATCH failed: ${res.status}`);
      const { session } = (await res.json()) as { session: SessionRow };
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, title: session.title } : s)));
    } catch {
      setSessions((list) => list.map((s) => (s.id === id ? { ...s, title: prev } : s)));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: "var(--text-muted)" }} className="text-left">
            <th className="px-4 py-3 font-medium">Title</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium">Duration</th>
            <th className="px-4 py-3 font-medium">Lines</th>
            <th className="px-4 py-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => {
            const editing = editingId === s.id;
            return (
              <tr
                key={s.id}
                onClick={() => !editing && open(s.id)}
                className="cursor-pointer border-t transition-colors hover:bg-[var(--surface-2)]"
                style={{ borderColor: "var(--border)" }}
              >
                <td className="px-4 py-3">
                  {editing ? (
                    <input
                      autoFocus
                      defaultValue={s.title}
                      placeholder={s.title}
                      disabled={saving}
                      onClick={(e) => e.stopPropagation()}
                      onFocus={(e) => e.currentTarget.select()}
                      onBlur={(e) => saveTitle(s.id, e.currentTarget.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur();
                        else if (e.key === "Escape") {
                          e.currentTarget.value = s.title; // discard edits
                          setEditingId(null);
                        }
                      }}
                      className="w-full rounded-md px-2 py-1 text-sm font-medium outline-none transition-shadow"
                      style={{
                        background: "var(--surface)",
                        color: "var(--text)",
                        border: "1px solid var(--accent)",
                        boxShadow: "0 0 0 3px var(--accent-soft, rgba(59,130,246,0.18))",
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      title="Click to rename"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditingId(s.id);
                      }}
                      className="rounded px-1 py-0.5 text-left font-medium hover:underline"
                      style={{ color: "var(--accent)" }}
                    >
                      {s.title}
                    </button>
                  )}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                  {formatDateTime(s.started_at)}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                  {formatDuration(sessionDurationMs(s.started_at, s.ended_at))}
                </td>
                <td className="px-4 py-3" style={{ color: "var(--text-muted)" }}>
                  {s.segment_count}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={s.status} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const isRec = status === "recording";
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
      style={{
        background: isRec ? "var(--danger-soft)" : "var(--success-soft)",
        color: isRec ? "var(--danger)" : "var(--success)",
      }}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ background: isRec ? "var(--danger)" : "var(--success)" }}
      />
      {isRec ? "Recording" : "Completed"}
    </span>
  );
}
