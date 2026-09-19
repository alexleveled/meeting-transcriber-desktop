import type { AudioSource } from "@/lib/types";
import { labelFor } from "@/lib/format-transcript";

export interface TranscriptRow {
  key: string | number;
  source: AudioSource;
  text: string;
  /** Diarized speaker index (phone-call sessions); null/undefined for mic-vs-system rows. */
  speaker?: number | null;
  /** Present on DB-backed rows; used to build the `data-seg` scroll-to-segment target. */
  startedAtMs?: number;
  seq?: number;
}

interface Palette {
  dot: string;
  label: string;
  bg: string;
}

const ME: Palette = { dot: "#16a34a", label: "#15803d", bg: "#f0fdf4" }; // green
const THEM: Palette = { dot: "#2563eb", label: "#1d4ed8", bg: "#eff6ff" }; // blue

const SOURCE_STYLE: Record<AudioSource, Palette> = {
  system: THEM, // Participants
  mic: ME, // Me
};

/**
 * Renders interleaved transcript rows with speaker attribution. PC sessions colour by audio
 * source; phone-call sessions colour by the *displayed* role, so a swap flips the colours with
 * the names and "Me" always reads green.
 */
export function TranscriptList({
  rows,
  swapped = false,
}: {
  rows: TranscriptRow[];
  swapped?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const label = labelFor(r, swapped);
        const s = r.speaker == null ? SOURCE_STYLE[r.source] : label === "Me" ? ME : THEM;
        const dataSeg = r.startedAtMs != null && r.seq != null ? `${r.startedAtMs}:${r.seq}` : undefined;
        return (
          <div key={r.key} data-seg={dataSeg} className="flex gap-3">
            <div className="flex w-28 shrink-0 items-start gap-1.5 pt-0.5">
              <span
                className="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                style={{ background: s.dot }}
              />
              <span className="text-xs font-semibold" style={{ color: s.label }}>
                {label}
              </span>
            </div>
            <p
              className="flex-1 rounded-lg px-3 py-2 text-sm leading-relaxed"
              style={{ background: s.bg, color: "var(--text)" }}
            >
              {r.text}
            </p>
          </div>
        );
      })}
    </div>
  );
}
