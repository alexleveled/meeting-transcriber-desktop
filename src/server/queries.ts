import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import type {
  InputMode,
  SegmentRow,
  SessionRow,
  SessionStatus,
  TranscriptSegment,
} from "@/lib/types";

// ---- sessions --------------------------------------------------------------

export function createSession(input: {
  title?: string;
  model: string;
  inputMode?: InputMode;
}): SessionRow {
  const now = Date.now();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO sessions (id, title, status, model, input_mode, speakers_swapped, started_at, ended_at, created_at)
     VALUES (?, ?, 'recording', ?, ?, 0, ?, NULL, ?)`,
  ).run(
    id,
    input.title?.trim() || "Untitled meeting",
    input.model,
    input.inputMode ?? "pc",
    now,
    now,
  );
  return getSession(id)!;
}

export function getSession(id: string): SessionRow | null {
  return (db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow) ?? null;
}

export function listSessions(): (SessionRow & { segment_count: number })[] {
  return db
    .prepare(
      `SELECT s.*, (SELECT COUNT(*) FROM segments seg WHERE seg.session_id = s.id) AS segment_count
       FROM sessions s
       ORDER BY s.started_at DESC`,
    )
    .all() as (SessionRow & { segment_count: number })[];
}

export function updateSession(
  id: string,
  patch: { title?: string; status?: SessionStatus; speakersSwapped?: boolean },
): SessionRow | null {
  const existing = getSession(id);
  if (!existing) return null;
  const title = patch.title?.trim() || existing.title;
  const status = patch.status ?? existing.status;
  const swapped =
    patch.speakersSwapped === undefined ? existing.speakers_swapped : patch.speakersSwapped ? 1 : 0;
  // Stamp ended_at the first time a session transitions to completed.
  const endedAt =
    status === "completed" && existing.status !== "completed" ? Date.now() : existing.ended_at;
  db.prepare(
    "UPDATE sessions SET title = ?, status = ?, speakers_swapped = ?, ended_at = ? WHERE id = ?",
  ).run(title, status, swapped, endedAt, id);
  return getSession(id);
}

export function deleteSession(id: string): boolean {
  const res = db.prepare("DELETE FROM sessions WHERE id = ?").run(id);
  return res.changes > 0;
}

// ---- segments --------------------------------------------------------------

export function getSegments(sessionId: string): SegmentRow[] {
  return db
    .prepare(
      `SELECT * FROM segments WHERE session_id = ?
       ORDER BY started_at_ms ASC, seq ASC, id ASC`,
    )
    .all(sessionId) as SegmentRow[];
}

/** Batched insert of finalized client segments. Returns how many rows were written. */
export function insertSegments(sessionId: string, segments: TranscriptSegment[]): number {
  if (segments.length === 0) return 0;
  const now = Date.now();
  const stmt = db.prepare(
    `INSERT INTO segments (session_id, source, text, speaker, started_at_ms, ended_at_ms, seq, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const tx = db.transaction((rows: TranscriptSegment[]) => {
    for (const r of rows) {
      stmt.run(
        sessionId,
        r.source,
        r.text,
        r.speaker ?? null,
        r.startedAtMs,
        r.endedAtMs ?? null,
        r.seq,
        now,
      );
    }
  });
  tx(segments);
  return segments.length;
}
