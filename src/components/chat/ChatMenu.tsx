"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CHAT_PROVIDER_LABEL, CHAT_PROVIDERS, type ChatModel, type ChatProvider, type SpecialtyRow } from "@/lib/types";
import { BuiltinBadge } from "@/components/BuiltinBadge";
import { SpecialtyModal } from "@/components/SpecialtyModal";

type View = "root" | "model" | "specialty";

const VIEW_TITLE: Record<Exclude<View, "root">, string> = {
  model: "Select a model",
  specialty: "Select a specialty",
};

/**
 * Pull-up popover above the input bar, spanning the full width of the chat dock. Mirrors the VS
 * Code Claude Code picker: the root view lists what's currently active as two drill-in rows
 * ("Switch model…" / "Switch specialty…"), and clicking one replaces the panel contents with that
 * chooser. A transparent full-screen backdrop handles outside-click dismissal; the dock handles
 * Escape.
 */
export function ChatMenu({
  models,
  model,
  setModel,
  specialty,
  setSpecialty,
  specialties,
  addSpecialty,
  updateSpecialty,
  removeSpecialty,
  onClose,
}: {
  models: Record<ChatProvider, ChatModel[]> | null;
  model: { provider: ChatProvider; id: string } | null;
  setModel: (m: { provider: ChatProvider; id: string }) => void;
  specialty: SpecialtyRow | null;
  setSpecialty: (s: SpecialtyRow | null) => void;
  specialties: SpecialtyRow[];
  addSpecialty: (name: string, prompt: string) => Promise<SpecialtyRow>;
  updateSpecialty: (id: number, patch: { name: string; prompt: string }) => Promise<SpecialtyRow>;
  removeSpecialty: (id: number) => Promise<void>;
  onClose: () => void;
}) {
  const [view, setView] = useState<View>("root");
  const [filter, setFilter] = useState("");
  const [specialtyModalOpen, setSpecialtyModalOpen] = useState(false);
  const [editingSpecialty, setEditingSpecialty] = useState<SpecialtyRow | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Drilling in or back is a fresh search: clear the filter and put the caret back in it.
  useEffect(() => {
    setFilter("");
    filterRef.current?.focus();
  }, [view]);

  const q = filter.trim().toLowerCase();

  const modelLabel = model
    ? models?.[model.provider]?.find((m) => m.id === model.id)?.label ?? model.id
    : null;

  const filteredModels = useMemo(() => {
    const out = {} as Record<ChatProvider, ChatModel[]>;
    for (const provider of CHAT_PROVIDERS) {
      out[provider] = (models?.[provider] ?? []).filter(
        (m) => !q || m.label.toLowerCase().includes(q) || m.id.toLowerCase().includes(q),
      );
    }
    return out;
  }, [models, q]);

  const filteredSpecialties = useMemo(
    () => specialties.filter((s) => !q || s.name.toLowerCase().includes(q)),
    [specialties, q],
  );

  const showSwitchModel = !q || "switch model".includes(q);
  const showSwitchSpecialty = !q || "switch specialty".includes(q);
  const showNone = !q || "none".includes(q);
  const showAdd = !q || "add specialty".includes(q);

  const rowClass =
    "flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface";

  function sectionLabel(text: string) {
    return (
      <div
        className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide"
        style={{ color: "var(--text-subtle)" }}
      >
        {text}
      </div>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-[55]" onClick={onClose} />
      <div
        className="absolute bottom-full left-0 right-0 z-[55] mb-2 flex max-h-[24rem] flex-col overflow-hidden rounded-lg shadow-lg"
        style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
        onClick={(e) => e.stopPropagation()}
      >
        {view !== "root" && (
          <div
            className="flex shrink-0 items-center gap-1.5 px-2 pt-2"
            style={{ color: "var(--text)" }}
          >
            <button
              aria-label="Back"
              title="Back"
              onClick={() => setView("root")}
              className="btn btn-ghost btn-icon rounded-lg"
              style={{ width: "1.75rem", height: "1.75rem" }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M15 6l-6 6 6 6" />
              </svg>
            </button>
            <span className="text-sm font-medium">{VIEW_TITLE[view]}</span>
          </div>
        )}

        <div className="shrink-0 p-2" style={{ borderBottom: "1px solid var(--border)" }}>
          <input
            ref={filterRef}
            autoFocus
            className="input"
            placeholder="Filter…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>

        <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1.5">
          {view === "root" && (
            <>
              {showSwitchModel && (
                <div className="mb-1">
                  {sectionLabel("Model")}
                  <button onClick={() => setView("model")} className={rowClass} style={{ color: "var(--text)" }}>
                    <span>Switch model…</span>
                    <span className="min-w-0 truncate" style={{ color: "var(--text-muted)" }}>
                      {modelLabel ?? "None"}
                    </span>
                  </button>
                </div>
              )}

              {showSwitchSpecialty && (
                <div className="mt-1">
                  {sectionLabel("Specialty")}
                  <button onClick={() => setView("specialty")} className={rowClass} style={{ color: "var(--text)" }}>
                    <span>Switch specialty…</span>
                    <span className="min-w-0 truncate" style={{ color: "var(--text-muted)" }}>
                      {specialty?.name ?? "None"}
                    </span>
                  </button>
                </div>
              )}
            </>
          )}

          {view === "model" &&
            CHAT_PROVIDERS.map((provider) =>
              filteredModels[provider]?.length ? (
                <div key={provider} className="mb-1">
                  {sectionLabel(CHAT_PROVIDER_LABEL[provider])}
                  {filteredModels[provider].map((m) => {
                    const active = model?.provider === m.provider && model?.id === m.id;
                    return (
                      <button
                        key={`${m.provider}:${m.id}`}
                        onClick={() => {
                          setModel({ provider: m.provider, id: m.id });
                          onClose();
                        }}
                        className={rowClass}
                        style={{ color: "var(--text)" }}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{m.label}</span>
                          {/* OpenAI has no display names, so its label IS the id — don't say it twice. */}
                          {m.label !== m.id && (
                            <span className="block truncate text-xs" style={{ color: "var(--text-subtle)" }}>
                              {m.id}
                            </span>
                          )}
                        </span>
                        {active && <span className="shrink-0" style={{ color: "var(--accent)" }}>✓</span>}
                      </button>
                    );
                  })}
                </div>
              ) : null,
            )}

          {view === "specialty" && (
            <>
              {showNone && (
                <button
                  onClick={() => {
                    setSpecialty(null);
                    onClose();
                  }}
                  className={rowClass}
                  style={{ color: "var(--text)" }}
                >
                  <span>None</span>
                  {specialty === null && <span style={{ color: "var(--accent)" }}>✓</span>}
                </button>
              )}
              {filteredSpecialties.map((s) => (
                <div key={s.id} className="flex w-full items-center gap-1">
                  <button
                    onClick={() => {
                      setSpecialty(s);
                      onClose();
                    }}
                    // min-w-0 is what lets the inner truncate actually bite — without it the row
                    // sizes to the full untruncated prompt and shoves the pencil out of view.
                    className={`${rowClass} min-w-0 flex-1`}
                    style={{ color: "var(--text)" }}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate">{s.name}</span>
                        {s.builtin_slug && <BuiltinBadge />}
                      </span>
                      <span className="block truncate text-xs" style={{ color: "var(--text-subtle)" }}>
                        {s.prompt}
                      </span>
                    </span>
                    {specialty?.id === s.id && <span className="shrink-0" style={{ color: "var(--accent)" }}>✓</span>}
                  </button>
                  <button
                    aria-label={`Edit ${s.name}`}
                    title={`Edit ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingSpecialty(s);
                      setSpecialtyModalOpen(true);
                    }}
                    className="btn btn-ghost btn-icon shrink-0 rounded-lg"
                    style={{ width: "1.75rem", height: "1.75rem" }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                    </svg>
                  </button>
                </div>
              ))}
              {showAdd && (
                <button
                  onClick={() => {
                    setEditingSpecialty(null);
                    setSpecialtyModalOpen(true);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm hover:bg-surface"
                  style={{ color: "var(--accent)" }}
                >
                  <span>+</span>
                  <span>Add specialty…</span>
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <SpecialtyModal
        open={specialtyModalOpen}
        onClose={() => {
          setSpecialtyModalOpen(false);
          setEditingSpecialty(null);
        }}
        specialty={editingSpecialty}
        onCreate={addSpecialty}
        onUpdate={updateSpecialty}
        onDelete={removeSpecialty}
      />
    </>
  );
}
