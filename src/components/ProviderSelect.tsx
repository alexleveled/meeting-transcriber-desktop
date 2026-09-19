"use client";

import { PROVIDER_LABEL, type Provider } from "@/lib/types";

const OPTIONS: Provider[] = ["openai", "deepgram", "local"];

const TAGLINE: Record<Provider, string> = {
  openai: "~1s latency · unified AI vendor",
  deepgram: "~300ms latency · fastest",
  local: "Free · offline · text after pauses",
};

export function ProviderSelect({
  value,
  onChange,
}: {
  value: Provider;
  onChange: (p: Provider) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-3">
      {OPTIONS.map((p) => {
        const active = p === value;
        return (
          <button
            key={p}
            type="button"
            onClick={() => onChange(p)}
            className="rounded-lg border px-4 py-3 text-left transition-colors"
            style={{
              borderColor: active ? "var(--accent)" : "var(--border-strong)",
              background: active ? "var(--accent-soft)" : "var(--surface)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                {PROVIDER_LABEL[p]}
              </span>
              <span
                className="flex h-4 w-4 items-center justify-center rounded-full border"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border-strong)",
                  background: active ? "var(--accent)" : "transparent",
                }}
              >
                {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
              </span>
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
              {TAGLINE[p]}
            </div>
          </button>
        );
      })}
    </div>
  );
}
