"use client";

import { useRouter } from "next/navigation";
import { Modal } from "@/components/Modal";

/**
 * Shown when phone-call mode is picked without a Deepgram key. Phone mode can't fall back to the
 * configured provider — telling the two voices apart in one mic stream is Deepgram-only here — so
 * this is a hard stop rather than a warning.
 */
export function DeepgramKeyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  return (
    <Modal open={open} onClose={onClose} labelledBy="deepgram-key-modal-title">
      <h2
        id="deepgram-key-modal-title"
        className="text-base font-semibold"
        style={{ color: "var(--text)" }}
      >
        Deepgram API key needed
      </h2>
      <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--text-muted)" }}>
        Phone-call mode hears both people through one microphone, so it uses Deepgram to work out
        who said what. That needs a Deepgram API key, whichever provider the rest of the app is set
        to.
      </p>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          onClick={() => {
            onClose();
            router.push("/settings");
          }}
        >
          Enter one now
        </button>
      </div>
    </Modal>
  );
}
