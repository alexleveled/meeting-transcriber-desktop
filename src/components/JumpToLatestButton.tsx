"use client";

/**
 * Floating "jump to latest" pill shown at the bottom of a transcript scroll area when the user has
 * scrolled up and new content is streaming in below. Absolutely positioned — the parent must be
 * `relative`. Clicking re-pins the view to the bottom.
 */
export function JumpToLatestButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title="Jump to latest"
      aria-label="Jump to latest"
      className="absolute bottom-3 left-1/2 z-10 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
      style={{
        background: "var(--accent)",
        color: "#fff",
        boxShadow: "0 4px 14px rgba(15,23,42,0.28)",
      }}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 5v14M19 12l-7 7-7-7" />
      </svg>
    </button>
  );
}
