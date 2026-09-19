import type { AudioSource, TranscriptSegment } from "@/lib/types";

/**
 * In-memory ordered transcript for a live session. Framework-free and observable.
 *
 * Finalized utterances are binary-inserted by (startedAtMs, seq) — NOT appended — because a slow
 * stream's utterance can finalize after a later utterance from the other stream, and correct
 * interleaving requires insertion. `seq` is a monotonic client counter stored alongside so a DB
 * replay reproduces byte-identical ordering. Interim text lives only in the two pending slots and
 * never enters the ordered list.
 */

export interface StoredSegment extends TranscriptSegment {
  /** Stable client key for React lists. */
  key: number;
}

export class TranscriptStore {
  private finals: StoredSegment[] = [];
  private interim: Record<AudioSource, string> = { mic: "", system: "" };
  private seqCounter = 0;
  private keyCounter = 0;
  private version = 0;
  private listeners = new Set<() => void>();

  /** Segments not yet persisted to the DB (drained in batches). */
  private unpersisted: TranscriptSegment[] = [];

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  };

  private emit() {
    this.version++;
    for (const cb of this.listeners) cb();
  }

  /** Monotonic version for React's useSyncExternalStore (stable between changes). */
  getVersion = (): number => this.version;

  /**
   * Insert a finalized utterance in sorted position; clears that source's interim.
   * `speaker` is the canonical diarized index (0/1) in phone mode, null everywhere else.
   */
  addFinal(
    source: AudioSource,
    text: string,
    startedAtMs: number,
    endedAtMs: number | null,
    speaker: number | null = null,
  ) {
    const clean = text.trim();
    if (!clean) return;
    const seg: StoredSegment = {
      key: this.keyCounter++,
      source,
      text: clean,
      speaker,
      startedAtMs,
      endedAtMs,
      seq: this.seqCounter++,
    };
    this.insertSorted(seg);
    this.unpersisted.push({
      source: seg.source,
      text: seg.text,
      speaker: seg.speaker,
      startedAtMs: seg.startedAtMs,
      endedAtMs: seg.endedAtMs,
      seq: seg.seq,
    });
    this.interim[source] = "";
    this.emit();
  }

  private insertSorted(seg: StoredSegment) {
    // Binary search for the first element greater than seg by (startedAtMs, seq).
    const arr = this.finals;
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const m = arr[mid];
      const before =
        m.startedAtMs < seg.startedAtMs ||
        (m.startedAtMs === seg.startedAtMs && m.seq <= seg.seq);
      if (before) lo = mid + 1;
      else hi = mid;
    }
    arr.splice(lo, 0, seg);
  }

  setInterim(source: AudioSource, text: string) {
    this.interim[source] = text;
    this.emit();
  }

  clearInterim(source: AudioSource) {
    if (this.interim[source]) {
      this.interim[source] = "";
      this.emit();
    }
  }

  get segments(): readonly StoredSegment[] {
    return this.finals;
  }

  getInterim(source: AudioSource): string {
    return this.interim[source];
  }

  /** Snapshot for rendering — new references so React sees a change. */
  snapshot(): { segments: StoredSegment[]; interim: Record<AudioSource, string> } {
    return { segments: this.finals.slice(), interim: { ...this.interim } };
  }

  /** Remove and return unpersisted segments for a batched write. */
  takeUnpersisted(): TranscriptSegment[] {
    const out = this.unpersisted;
    this.unpersisted = [];
    return out;
  }

  /** Re-queue segments whose persistence failed (front of the line, keep order). */
  requeue(segs: TranscriptSegment[]) {
    if (segs.length) this.unpersisted = segs.concat(this.unpersisted);
  }

  get pendingCount(): number {
    return this.unpersisted.length;
  }
}
