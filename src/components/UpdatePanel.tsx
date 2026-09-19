"use client";

import { useUpdates } from "@/hooks/useUpdates";
import type { UpdateClient, UpdateState } from "@/lib/updates";

/**
 * "You're on version X" plus the check/download/restart flow, for Settings.
 *
 * Renders nothing outside the desktop build: a browser tab has no installer to replace, and a
 * dead button would just raise questions. The panel reads the state the main process already holds,
 * so an update found by the quiet check at startup is showing the moment Settings opens.
 */
export function UpdatePanel() {
  const { client, version, state } = useUpdates();

  if (!client) return null;

  return (
    <div className="card mt-6 p-6">
      <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
        Updates
      </h2>
      <p className="hint mt-1">
        {version ? `You're running version ${version}.` : "Checking your version…"}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Action client={client} state={state} />
        <StatusText state={state} />
      </div>

      {state.status === "downloading" && <Progress percent={state.percent} />}

      {state.status === "available" && state.notes && (
        <p className="mt-3 whitespace-pre-wrap text-sm" style={{ color: "var(--text-muted)" }}>
          {state.notes}
        </p>
      )}

      {state.status === "ready" && (
        <p className="hint mt-3">
          Windows will warn that the publisher isn&apos;t recognized, the same as it did the first
          time. That&apos;s the missing signing certificate, not the update.
        </p>
      )}
    </div>
  );
}

function Action({ client, state }: { client: UpdateClient; state: UpdateState }) {
  if (state.status === "unsupported") return null;

  if (state.status === "available") {
    return (
      <button className="btn btn-primary" onClick={() => void client.download()}>
        Download {state.version}
      </button>
    );
  }

  if (state.status === "ready") {
    return (
      <button className="btn btn-primary" onClick={() => void client.install()}>
        Restart and install
      </button>
    );
  }

  const busy = state.status === "checking" || state.status === "downloading";
  return (
    <button className="btn btn-secondary" onClick={() => void client.check()} disabled={busy}>
      {state.status === "checking" ? "Checking…" : "Check for updates"}
    </button>
  );
}

function StatusText({ state }: { state: UpdateState }) {
  if (state.status === "unsupported") {
    return (
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>
        Updates only work in the installed app, not while running from source.
      </span>
    );
  }
  if (state.status === "current") {
    return (
      <span className="text-sm" style={{ color: "var(--success)" }}>
        You&apos;re up to date.
      </span>
    );
  }
  if (state.status === "ready") {
    return (
      <span className="text-sm" style={{ color: "var(--text-muted)" }}>
        Version {state.version} is ready to install.
      </span>
    );
  }
  if (state.status === "error") {
    return (
      <span className="text-sm" style={{ color: "var(--danger)" }}>
        {state.message}
      </span>
    );
  }
  return null;
}

function Progress({ percent }: { percent: number }) {
  return (
    <div className="mt-4">
      <div
        className="h-1.5 w-full overflow-hidden rounded-full"
        style={{ background: "var(--surface-2)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-200"
          style={{ width: `${Math.min(100, Math.max(0, percent))}%`, background: "var(--accent)" }}
        />
      </div>
      <p className="hint mt-2">Downloading… {percent}%</p>
    </div>
  );
}
