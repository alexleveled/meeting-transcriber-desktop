"use client";

import { useState } from "react";

interface Saved {
  hasKey: boolean;
  last4: string | null;
  fromEnv: boolean;
}

/**
 * Per-provider API key entry. When a key is already saved it shows a masked chip with
 * Replace / Clear; entering edit mode reveals a password input. The typed value bubbles up
 * via `onDraftChange` so the parent can send it with PUT /api/settings (blank = keep).
 * `onClear` marks the key for clearing (parent sends `null`).
 */
export function ApiKeyField({
  provider,
  saved,
  draft,
  cleared,
  onDraftChange,
  onClear,
  onUndoClear,
  label = "API key",
  placeholder,
  testEndpoint = "/api/settings/test-key",
  note,
}: {
  provider: string;
  saved: Saved;
  draft: string;
  cleared: boolean;
  onDraftChange: (v: string) => void;
  onClear: () => void;
  onUndoClear: () => void;
  label?: string;
  placeholder?: string;
  testEndpoint?: string;
  note?: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const [test, setTest] = useState<{ state: "idle" | "loading" | "ok" | "err"; msg?: string }>({
    state: "idle",
  });

  async function runTest() {
    setTest({ state: "loading" });
    try {
      const res = await fetch(testEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Test the freshly typed key if present, otherwise the stored key.
        body: JSON.stringify({ provider, key: draft.trim() || undefined }),
      });
      const data = (await res.json()) as { valid: boolean; error?: string };
      setTest(
        data.valid
          ? { state: "ok", msg: "Key is valid" }
          : { state: "err", msg: data.error ?? "Key is invalid" },
      );
    } catch {
      setTest({ state: "err", msg: "Could not reach server" });
    }
  }

  const showMasked = saved.hasKey && !cleared && !editing && !draft;

  return (
    <div>
      <label className="label">{label}</label>

      {showMasked ? (
        <div className="flex flex-wrap items-center gap-2">
          <code
            className="rounded-md px-2.5 py-1.5 text-sm"
            style={{ background: "var(--surface-2)", border: "1px solid var(--border)" }}
          >
            {"•".repeat(8)}
            {saved.last4}
          </code>
          {saved.fromEnv && (
            <span className="hint" style={{ color: "var(--warn)" }}>
              from environment variable
            </span>
          )}
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>
            Replace
          </button>
          {!saved.fromEnv && (
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => {
                onClear();
                setTest({ state: "idle" });
              }}
            >
              Clear
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={runTest}>
            {test.state === "loading" ? "Testing…" : "Test key"}
          </button>
        </div>
      ) : cleared ? (
        <div className="flex items-center gap-2">
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            Key will be cleared on save.
          </span>
          <button type="button" className="btn btn-ghost" onClick={onUndoClear}>
            Undo
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="password"
            className="input flex-1"
            style={{ minWidth: "16rem" }}
            placeholder={placeholder ?? (provider === "openai" ? "sk-…" : "Deepgram API key")}
            value={draft}
            autoComplete="off"
            onChange={(e) => {
              onDraftChange(e.target.value);
              setTest({ state: "idle" });
            }}
          />
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!draft.trim() && !saved.hasKey}
            onClick={runTest}
          >
            {test.state === "loading" ? "Testing…" : "Test key"}
          </button>
          {saved.hasKey && editing && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => {
                setEditing(false);
                onDraftChange("");
              }}
            >
              Cancel
            </button>
          )}
        </div>
      )}

      {test.state === "ok" && (
        <p className="hint mt-1.5" style={{ color: "var(--success)" }}>
          ✓ {test.msg}
        </p>
      )}
      {test.state === "err" && (
        <p className="hint mt-1.5" style={{ color: "var(--danger)" }}>
          ✕ {test.msg}
        </p>
      )}
      {!showMasked && !cleared && (
        <p className="hint mt-1.5">
          Stored locally in your SQLite database. A blank field keeps the existing key.
        </p>
      )}
      {note && (
        <p className="hint mt-1.5">
          {note}
        </p>
      )}
    </div>
  );
}
