"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useRecorder } from "@/hooks/useRecorder";
import { useUpdates } from "@/hooks/useUpdates";

interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
  match: (path: string) => boolean;
}

const NAV: NavItem[] = [
  {
    href: "/",
    label: "Recorder",
    match: (p) => p === "/",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
        <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3" />
      </svg>
    ),
  },
  {
    href: "/sessions",
    label: "Sessions",
    match: (p) => p.startsWith("/sessions"),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h16M4 18h10" />
      </svg>
    ),
  },
  {
    href: "/specialties",
    label: "Chat Specialties",
    match: (p) => p.startsWith("/specialties"),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6.5 2h11a1 1 0 0 1 1 1v18l-6.5-3.5L5 21V3a1 1 0 0 1 1-1Z" />
        <path d="M9 8.5h6" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    match: (p) => p.startsWith("/settings"),
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
      </svg>
    ),
  },
];

const COLLAPSE_KEY = "sidebar:collapsed";

export function Sidebar() {
  const pathname = usePathname() ?? "/";
  const rec = useRecorder();
  const [collapsed, setCollapsed] = useState(false);

  // Read the persisted preference after mount (avoids a hydration mismatch).
  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* ignore */
    }
  }, []);

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        window.localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  return (
    <aside
      className={`flex h-full min-h-0 shrink-0 flex-col gap-1 overflow-y-auto border-r py-4 scroll-slim transition-[width] duration-200 ${
        collapsed ? "w-16 px-2" : "w-60 px-3"
      }`}
      style={{ background: "var(--sidebar)", borderColor: "var(--border)" }}
    >
      {collapsed ? (
        <div className="group relative mb-4 flex justify-center">
          <CollapseToggle collapsed onClick={toggle} />
          <Tooltip label="Expand sidebar" />
        </div>
      ) : (
        <div className="mb-4 flex items-center gap-2.5 px-2">
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ background: "var(--accent)" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 10v4M6 6v12M10 3v18M14 8v8M18 5v14M22 10v4" />
            </svg>
          </div>
          <div className="leading-tight">
            <div className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Transcriber
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              Live meeting capture
            </div>
          </div>
          <div className="ml-auto">
            <CollapseToggle collapsed={false} onClick={toggle} />
          </div>
        </div>
      )}

      <nav className="flex flex-col gap-0.5">
        {NAV.map((item) => {
          const active = item.match(pathname);
          return (
            <div key={item.href} className="group relative">
              <Link
                href={item.href}
                aria-label={item.label}
                className={`flex items-center rounded-lg py-2 text-sm font-medium transition-colors ${
                  collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
                }`}
                style={{
                  background: active ? "var(--surface)" : "transparent",
                  color: active ? "var(--accent)" : "var(--text-muted)",
                  boxShadow: active ? "0 1px 2px rgba(15,23,42,0.05)" : "none",
                }}
              >
                <span style={{ color: active ? "var(--accent)" : "var(--text-subtle)" }}>
                  {item.icon}
                </span>
                {!collapsed && item.label}
              </Link>
              {collapsed && <Tooltip label={item.label} />}
            </div>
          );
        })}

        {/* Shrink the app into the floating compact widget (works before/while recording). */}
        <div className="group relative">
          <button
            onClick={() => void rec.enterCompact()}
            aria-label="Compact mode"
            className={`flex w-full items-center rounded-lg py-2 text-sm font-medium transition-colors hover:bg-surface ${
              collapsed ? "justify-center px-0" : "gap-2.5 px-2.5"
            }`}
            style={{ color: "var(--text-muted)" }}
          >
            <span style={{ color: "var(--text-subtle)" }}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 10V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-6" />
                <rect x="2" y="13" width="10" height="7" rx="2" />
              </svg>
            </span>
            {!collapsed && "Compact mode"}
          </button>
          {collapsed && <Tooltip label="Compact mode" />}
        </div>
      </nav>

      <div className="mt-auto pt-3">
        <UpdateItem collapsed={collapsed} />
      </div>
    </aside>
  );
}

/**
 * The update notice, pinned to the bottom of the rail (the VS Code position).
 *
 * Settings has the full panel, but nobody opens Settings looking for news — so the one thing that
 * has to be visible without going looking is "there is a newer version". This renders only when
 * there is something to act on: available, mid-download, or downloaded and waiting on a restart.
 * Every other state (idle, checking, up to date, errored) falls back to the plain version line, so
 * the rail stays quiet until it has a reason not to be.
 */
function UpdateItem({ collapsed }: { collapsed: boolean }) {
  const { client, version, state } = useUpdates();

  const actionable =
    state.status === "available" || state.status === "downloading" || state.status === "ready";

  if (!client || !actionable) {
    // Outside the packaged app `version` is null and there is nothing truthful to print.
    if (!version) return null;
    return collapsed ? (
      <div className="group relative flex justify-center">
        <span className="text-[10px]" style={{ color: "var(--text-subtle)" }}>
          v{version}
        </span>
        <Tooltip label={`Version ${version}`} />
      </div>
    ) : (
      <div className="px-2 text-[11px]" style={{ color: "var(--text-subtle)" }}>
        Local-first · v{version}
      </div>
    );
  }

  const busy = state.status === "downloading";
  const onClick = () => {
    if (state.status === "available") void client.download();
    else if (state.status === "ready") void client.install();
  };

  const title =
    state.status === "ready"
      ? "Restart to update"
      : busy
        ? `Downloading… ${state.percent}%`
        : "Update available";
  // Current → target, the way every app that does this well phrases it. During a download the
  // percentage is already in the title, so the second line stays the version pair either way.
  const detail = version ? `v${version} → v${state.version}` : `Version ${state.version}`;

  if (collapsed) {
    return (
      <div className="group relative flex justify-center">
        <button
          onClick={onClick}
          disabled={busy}
          aria-label={`${title} (${detail})`}
          className="relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <UpdateIcon spinning={busy} />
          {!busy && (
            <span
              className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full"
              style={{ background: "var(--accent)" }}
            />
          )}
        </button>
        <Tooltip label={`${title} · ${detail}`} />
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      className="flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors"
      style={{
        background: "var(--accent-soft)",
        borderColor: "var(--border)",
        color: "var(--accent)",
        cursor: busy ? "default" : "pointer",
      }}
    >
      <span className="mt-0.5 shrink-0">
        <UpdateIcon spinning={busy} />
      </span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[13px] font-semibold">{title}</span>
        <span className="mt-0.5 block text-[11px]" style={{ color: "var(--text-muted)" }}>
          {detail}
        </span>
        {busy && (
          <span
            className="mt-1.5 block h-1 w-full overflow-hidden rounded-full"
            style={{ background: "var(--surface-2)" }}
          >
            <span
              className="block h-full rounded-full transition-[width] duration-200"
              style={{
                width: `${Math.min(100, Math.max(0, state.percent))}%`,
                background: "var(--accent)",
              }}
            />
          </span>
        )}
      </span>
    </button>
  );
}

/** Circular-arrow refresh glyph; spins while a download is in flight. */
function UpdateIcon({ spinning }: { spinning: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={spinning ? "animate-spin" : undefined}
    >
      <path d="M3 12a9 9 0 0 1 15.5-6.2L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15.5 6.2L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/** Sidebar collapse/expand toggle — the panel icon that sits in the logo row. */
function CollapseToggle({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-surface"
      style={{ color: "var(--text-subtle)" }}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        {collapsed && <path d="m13 9 3 3-3 3" />}
      </svg>
    </button>
  );
}

/** Hover tooltip shown to the right of a collapsed-rail icon. */
function Tooltip({ label }: { label: string }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-md px-2 py-1 text-xs font-medium opacity-0 shadow-md transition-opacity duration-100 group-hover:opacity-100"
      style={{
        background: "var(--text)",
        color: "var(--surface)",
      }}
    >
      {label}
    </span>
  );
}
