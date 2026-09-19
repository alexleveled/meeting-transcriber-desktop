"use client";

import { useRouter } from "next/navigation";
import { useRecorder } from "@/hooks/useRecorder";

/**
 * Shown when the user presses Record before setup is finished — either the free Local Whisper model
 * hasn't been downloaded yet, or the selected cloud provider has no API key. The recorder's start()
 * bails out early in that case (no mic prompt, no session), and surfaces the reason here so the user
 * knows why "nothing happened" and where to fix it.
 */
export function NotReadyToast() {
  const router = useRouter();
  const { notReady, dismissNotReady } = useRecorder();

  if (!notReady) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-lg"
        style={{ background: "var(--surface)", borderColor: "var(--warn)" }}
        role="alert"
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            Finish setup to start recording
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            {notReady}
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              className="btn btn-primary px-3 py-1 text-xs"
              onClick={() => {
                dismissNotReady();
                router.push("/settings");
              }}
            >
              Open Settings
            </button>
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={dismissNotReady}>
              Dismiss
            </button>
          </div>
        </div>

        <button
          aria-label="Dismiss"
          className="rounded-md p-1 transition-colors hover:bg-surface"
          style={{ color: "var(--text-subtle)" }}
          onClick={dismissNotReady}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
