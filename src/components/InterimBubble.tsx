"use client";

import type { AudioSource } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/format-transcript";

const COLOR: Record<AudioSource, string> = { system: "#2563eb", mic: "#16a34a" };

/**
 * Grayed, italic pending-utterance bubble pinned below the transcript while a source speaks.
 * `label` overrides the source name — phone-call mode passes a neutral one, because a live
 * interim isn't attributed to either voice until it finalizes.
 */
export function InterimBubble({
  source,
  text,
  label,
}: {
  source: AudioSource;
  text: string;
  label?: string;
}) {
  if (!text) return null;
  const color = label ? "var(--text-muted)" : COLOR[source];
  return (
    <div className="flex gap-3 opacity-70">
      <div className="flex w-28 shrink-0 items-start gap-1.5 pt-0.5">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full animate-pulse" style={{ background: color }} />
        <span className="text-xs font-semibold" style={{ color }}>
          {label ?? SOURCE_LABEL[source]}
        </span>
      </div>
      <p className="flex-1 px-3 py-2 text-sm italic leading-relaxed" style={{ color: "var(--text-muted)" }}>
        {text}
        <span className="ml-0.5 inline-block animate-pulse">▍</span>
      </p>
    </div>
  );
}
