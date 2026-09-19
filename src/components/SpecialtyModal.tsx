"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/Modal";
import { BuiltinBadge } from "@/components/BuiltinBadge";
import type { SpecialtyRow } from "@/lib/types";

/**
 * Create/edit dialog for a saved specialty (reusable named system prompt). Used both from
 * `ChatMenu`'s specialty chooser and from the standalone `/specialties` management page.
 * `specialty` null/undefined means create mode; otherwise the dialog edits that row in place.
 */
export function SpecialtyModal({
  open,
  onClose,
  specialty,
  onCreate,
  onUpdate,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  specialty?: SpecialtyRow | null;
  onCreate: (name: string, prompt: string) => Promise<SpecialtyRow>;
  onUpdate: (id: number, patch: { name: string; prompt: string }) => Promise<SpecialtyRow>;
  onDelete?: (id: number) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const isEdit = specialty != null;

  // Seed (or reset) the fields whenever the modal opens or the target row changes — never leave
  // stale text from a previously-edited specialty behind.
  useEffect(() => {
    if (!open) return;
    setName(specialty?.name ?? "");
    setPrompt(specialty?.prompt ?? "");
    setError(null);
    setBusy(false);
    setConfirmingDelete(false);
  }, [open, specialty]);

  function close() {
    onClose();
  }

  async function save() {
    if (!name.trim() || !prompt.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isEdit) {
        await onUpdate(specialty.id, { name: name.trim(), prompt: prompt.trim() });
      } else {
        await onCreate(name.trim(), prompt.trim());
      }
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save specialty.");
      setBusy(false);
    }
  }

  async function doDelete() {
    if (!isEdit || !onDelete || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onDelete(specialty.id);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete specialty.");
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} labelledBy="specialty-modal-title">
      <h2 id="specialty-modal-title" className="mb-4 flex items-center gap-1.5 text-base font-semibold" style={{ color: "var(--text)" }}>
        <span>{isEdit ? "Edit specialty" : "Add specialty"}</span>
        {specialty?.builtin_slug && <BuiltinBadge />}
      </h2>

      <div className="mb-3">
        <label className="label">Name</label>
        <input
          autoFocus
          className="input"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Sales coach"
          disabled={busy}
        />
      </div>

      <div className="mb-4">
        <label className="label">Prompt</label>
        <textarea
          className="input"
          rows={9}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Instructions to steer how the assistant answers…"
          disabled={busy}
        />
      </div>

      {error && (
        <p className="mb-3 text-sm" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div>
          {isEdit && onDelete && (
            confirmingDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  Delete?
                </span>
                <button
                  className="btn btn-danger"
                  onClick={() => void doDelete()}
                  disabled={busy}
                >
                  {busy ? "Deleting…" : "Yes, delete"}
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={busy}
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                className="btn btn-danger"
                onClick={() => setConfirmingDelete(true)}
                disabled={busy}
              >
                Delete
              </button>
            )
          )}
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void save()}
            disabled={busy || !name.trim() || !prompt.trim()}
          >
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
