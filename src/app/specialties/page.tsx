"use client";

import { useEffect, useState } from "react";
import { BuiltinBadge } from "@/components/BuiltinBadge";
import { PageHeader } from "@/components/PageHeader";
import { SpecialtyModal } from "@/components/SpecialtyModal";
import { formatDateTime } from "@/lib/format-time";
import type { SpecialtyRow } from "@/lib/types";

/** Standalone management surface for saved specialties: create, browse, edit, delete. */
export default function SpecialtiesPage() {
  const [specialties, setSpecialties] = useState<SpecialtyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<SpecialtyRow | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/specialties");
        if (!res.ok) throw new Error("Failed to load specialties.");
        const data = (await res.json()) as { specialties: SpecialtyRow[] };
        setSpecialties(data.specialties ?? []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load specialties.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  function openCreate() {
    setEditing(null);
    setModalOpen(true);
  }

  function openEdit(s: SpecialtyRow) {
    setEditing(s);
    setModalOpen(true);
  }

  async function addSpecialty(name: string, prompt: string): Promise<SpecialtyRow> {
    const res = await fetch("/api/specialties", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, prompt }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Failed to save specialty");
    }
    const data = (await res.json()) as { specialty: SpecialtyRow };
    setSpecialties((prev) => [...prev, data.specialty]);
    return data.specialty;
  }

  async function updateSpecialty(id: number, patch: { name: string; prompt: string }): Promise<SpecialtyRow> {
    const res = await fetch(`/api/specialties/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Failed to update specialty");
    }
    const data = (await res.json()) as { specialty: SpecialtyRow };
    setSpecialties((prev) => prev.map((s) => (s.id === id ? data.specialty : s)));
    return data.specialty;
  }

  async function removeSpecialty(id: number): Promise<void> {
    const res = await fetch(`/api/specialties/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}) as { error?: string });
      throw new Error(body.error ?? "Failed to delete specialty");
    }
    setSpecialties((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-8 py-8">
      <div className="shrink-0">
        <PageHeader
          title="Chat Specialties"
          subtitle="Saved instructions you can attach to a chat to steer how the assistant answers."
          actions={
            <button className="btn btn-primary" onClick={openCreate}>
              New specialty
            </button>
          }
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        {loading ? (
          <div className="card p-6 text-sm" style={{ color: "var(--text-muted)" }}>
            Loading…
          </div>
        ) : error ? (
          <div className="card p-6 text-sm" style={{ color: "var(--danger)" }}>
            {error}
          </div>
        ) : specialties.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
            <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
              No specialties yet
            </div>
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              Save a reusable instruction set to quickly steer how the assistant answers.
            </div>
            <button className="btn btn-secondary mt-2" onClick={openCreate}>
              New specialty
            </button>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {specialties.map((s) => (
              <div
                key={s.id}
                role="button"
                tabIndex={0}
                onClick={() => openEdit(s)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    openEdit(s);
                  }
                }}
                className="card relative cursor-pointer p-4 transition-shadow"
                style={{ borderColor: "var(--border)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--border-strong)";
                  e.currentTarget.style.boxShadow = "0 4px 12px rgba(15,23,42,0.08)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.boxShadow = "";
                }}
              >
                <button
                  aria-label={`Edit ${s.name}`}
                  title={`Edit ${s.name}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEdit(s);
                  }}
                  className="btn btn-ghost btn-icon absolute right-3 top-3 rounded-lg"
                  style={{ width: "1.75rem", height: "1.75rem" }}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                  </svg>
                </button>

                <h2 className="flex min-w-0 items-center gap-1.5 pr-8 text-sm font-semibold" style={{ color: "var(--text)" }}>
                  <span className="min-w-0 truncate">{s.name}</span>
                  {s.builtin_slug && <BuiltinBadge />}
                </h2>
                <p className="mt-2 line-clamp-3 text-sm" style={{ color: "var(--text-muted)" }}>
                  {s.prompt}
                </p>
                <p className="mt-3 text-xs" style={{ color: "var(--text-subtle)" }}>
                  Created {formatDateTime(s.created_at)}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      <SpecialtyModal
        open={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditing(null);
        }}
        specialty={editing}
        onCreate={addSpecialty}
        onUpdate={updateSpecialty}
        onDelete={removeSpecialty}
      />
    </div>
  );
}
