import type { AudioSource } from "./types";

/**
 * Shared transcript formatter — used by BOTH the live in-memory export and the DB export
 * route, so a live download and a from-DB download are byte-identical.
 *
 * Output shape:
 *   Participants: hey, how's it going
 *   Me: I'm doing great how is everything going over there
 *
 * Phone-call sessions carry a diarized `speaker` (0/1) instead of two audio sources, so they
 * label by speaker — and honor the session's speakers-swapped flag when the two came out
 * the wrong way round.
 */

export const SOURCE_LABEL: Record<AudioSource, string> = {
  system: "Participants",
  mic: "Me",
};

/** Labels for the two diarized voices in a phone-call recording, in canonical order. */
export const SPEAKER_LABEL = ["Me", "Customer"] as const;

export interface FormattableSegment {
  source: AudioSource;
  text: string;
  /** Diarized speaker index, or null/undefined for a normal two-source segment. */
  speaker?: number | null;
}

/** The name to show for one segment, accounting for a swapped phone-call session. */
export function labelFor(seg: FormattableSegment, swapped = false): string {
  if (seg.speaker == null) return SOURCE_LABEL[seg.source];
  const idx = seg.speaker === 0 ? 0 : 1;
  return SPEAKER_LABEL[swapped ? (idx === 0 ? 1 : 0) : idx];
}

export function formatTranscript(segments: FormattableSegment[], swapped = false): string {
  return segments.map((s) => `${labelFor(s, swapped)}: ${s.text.trim()}`).join("\n");
}
