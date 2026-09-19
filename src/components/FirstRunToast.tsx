"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * First-run welcome: a bottom-of-screen toast shown once on the very first launch of a fresh
 * install. Transcribing needs a one-time setup step first — either download the free Local Whisper
 * model or add a cloud API key — so this points the user at Settings before their first recording.
 *
 * The "already seen" flag lives server-side (GET/POST /api/onboarding), not localStorage: the
 * packaged app binds a new random port each launch, which would wipe origin-scoped browser storage
 * and make the toast reappear every time. It hides on the Settings page and once dismissed.
 */
export function FirstRunToast() {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [show, setShow] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/onboarding")
      .then((res) => (res.ok ? (res.json() as Promise<{ seen: boolean }>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        if (!data.seen) setShow(true);
      })
      .catch(() => {
        /* leave hidden on error */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Hide and persist "seen" so it never shows again on this install. */
  function dismiss() {
    setShow(false);
    void fetch("/api/onboarding", { method: "POST" }).catch(() => {});
  }

  if (!show || pathname.startsWith("/settings")) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div
        className="pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-xl border px-4 py-3 shadow-lg"
        style={{ background: "var(--surface)", borderColor: "var(--border)" }}
        role="status"
      >
        <span
          className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m7 10 5 5 5-5" />
            <path d="M12 15V3" />
          </svg>
        </span>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
            One quick step before you record
          </div>
          <div className="mt-0.5 text-xs" style={{ color: "var(--text-muted)" }}>
            The free Local Whisper model needs a one-time download before it can transcribe — until
            then, recording won&rsquo;t capture anything. Open Settings to download it, or add an API
            key to use a cloud model instead.
          </div>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              className="btn btn-primary px-3 py-1 text-xs"
              onClick={() => {
                dismiss();
                router.push("/settings");
              }}
            >
              Open Settings
            </button>
            <button className="btn btn-ghost px-2.5 py-1 text-xs" onClick={dismiss}>
              Got it
            </button>
          </div>
        </div>

        <button
          aria-label="Dismiss"
          className="rounded-md p-1 transition-colors hover:bg-surface"
          style={{ color: "var(--text-subtle)" }}
          onClick={dismiss}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
