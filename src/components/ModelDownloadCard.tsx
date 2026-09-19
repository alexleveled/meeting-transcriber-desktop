"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LOCAL_MODEL_LABEL } from "@/lib/types";

/**
 * Local Whisper model picker + download manager. Lists each installable ggml model with a
 * downloaded/not-downloaded badge, a download button with live progress, and a delete action.
 * The selected model radio drives the same `model` value the cloud providers use in Settings.
 */

interface ModelStatus {
  file: string;
  approxBytes: number;
  downloaded: boolean;
  downloading: boolean;
  receivedBytes: number;
  totalBytes: number;
  error: string | null;
}

function formatBytes(n: number): string {
  if (n <= 0) return "—";
  const mb = n / 1_000_000;
  if (mb >= 1000) return `${(mb / 1000).toFixed(1)} GB`;
  return `${Math.round(mb)} MB`;
}

export function ModelDownloadCard({
  files,
  value,
  onChange,
}: {
  files: string[];
  value: string;
  onChange: (file: string) => void;
}) {
  const [status, setStatus] = useState<Record<string, ModelStatus>>({});
  const [freeDisk, setFreeDisk] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/local-whisper/models");
      const data = (await res.json()) as { models: ModelStatus[]; freeDiskBytes: number };
      const map: Record<string, ModelStatus> = {};
      for (const m of data.models) map[m.file] = m;
      setStatus(map);
      setFreeDisk(data.freeDiskBytes);
    } catch {
      /* leave last-known status */
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Poll while any model is downloading so the progress bar advances.
  const anyDownloading = Object.values(status).some((s) => s.downloading);
  useEffect(() => {
    if (anyDownloading && !pollRef.current) {
      pollRef.current = setInterval(refresh, 700);
    } else if (!anyDownloading && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [anyDownloading, refresh]);

  async function download(file: string) {
    await fetch("/api/local-whisper/models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file }),
    });
    refresh();
  }

  async function remove(file: string) {
    await fetch("/api/local-whisper/models", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ file }),
    });
    refresh();
  }

  return (
    <div className="space-y-3">
      {files.map((file) => {
        const s = status[file];
        const active = file === value;
        const pct =
          s && s.totalBytes > 0 ? Math.min(100, Math.round((s.receivedBytes / s.totalBytes) * 100)) : 0;
        return (
          <div
            key={file}
            className="rounded-lg border px-4 py-3"
            style={{
              borderColor: active ? "var(--accent)" : "var(--border-strong)",
              background: active ? "var(--accent-soft)" : "var(--surface)",
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <button
                type="button"
                className="flex items-center gap-2.5 text-left"
                onClick={() => onChange(file)}
              >
                <span
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                  style={{
                    borderColor: active ? "var(--accent)" : "var(--border-strong)",
                    background: active ? "var(--accent)" : "transparent",
                  }}
                >
                  {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                </span>
                <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  {LOCAL_MODEL_LABEL[file] ?? file}
                </span>
              </button>

              {s?.downloaded ? (
                <span className="flex items-center gap-2">
                  <span className="hint" style={{ color: "var(--success)" }}>
                    ✓ Downloaded
                  </span>
                  <button type="button" className="btn btn-danger" onClick={() => remove(file)}>
                    Delete
                  </button>
                </span>
              ) : s?.downloading ? (
                <span className="hint" style={{ color: "var(--text-muted)" }}>
                  {pct}% · {formatBytes(s.receivedBytes)} / {formatBytes(s.totalBytes)}
                </span>
              ) : (
                <button type="button" className="btn btn-secondary" onClick={() => download(file)}>
                  Download
                </button>
              )}
            </div>

            {s?.downloading && (
              <div
                className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full"
                style={{ background: "var(--surface-2)" }}
              >
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, background: "var(--accent)" }}
                />
              </div>
            )}

            {s?.error && (
              <p className="hint mt-1.5" style={{ color: "var(--danger)" }}>
                ✕ {s.error}
              </p>
            )}
          </div>
        );
      })}

      <p className="hint">
        Models download once and run fully offline afterward. Transcript text appears a few seconds
        after each pause in speech. {freeDisk != null && `Free disk: ${formatBytes(freeDisk)}.`}
      </p>
    </div>
  );
}
