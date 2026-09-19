"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      const res = await fetch(`/api/sessions/${sessionId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      router.push("/sessions");
      router.refresh();
    } catch {
      setBusy(false);
      setConfirming(false);
      alert("Failed to delete session.");
    }
  }

  if (!confirming) {
    return (
      <button className="btn btn-danger" onClick={() => setConfirming(true)}>
        Delete
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        Delete permanently?
      </span>
      <button className="btn btn-danger" disabled={busy} onClick={del}>
        {busy ? "Deleting…" : "Yes, delete"}
      </button>
      <button className="btn btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
        Cancel
      </button>
    </div>
  );
}
