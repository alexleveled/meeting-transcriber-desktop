import "server-only";
import { db } from "./db";
import type { ChatMessageRow, ChatProvider, Citation, SpecialtyRow } from "@/lib/types";

// ---- chat messages ----------------------------------------------------------

export function getChatMessages(sessionId: string): ChatMessageRow[] {
  return db
    .prepare(
      `SELECT * FROM chat_messages WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`,
    )
    .all(sessionId) as ChatMessageRow[];
}

export function insertChatMessage(input: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  provider?: ChatProvider | null;
  model?: string | null;
  specialtyId?: number | null;
  citations?: Citation[] | null;
}): ChatMessageRow {
  const now = Date.now();
  const result = db
    .prepare(
      `INSERT INTO chat_messages (session_id, role, content, provider, model, specialty_id, citations, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.sessionId,
      input.role,
      input.content,
      input.provider ?? null,
      input.model ?? null,
      input.specialtyId ?? null,
      input.citations ? JSON.stringify(input.citations) : null,
      now,
    );
  return db
    .prepare("SELECT * FROM chat_messages WHERE id = ?")
    .get(result.lastInsertRowid) as ChatMessageRow;
}

// ---- specialties --------------------------------------------------------------

export function listSpecialties(): SpecialtyRow[] {
  return db.prepare("SELECT * FROM specialties ORDER BY name COLLATE NOCASE ASC").all() as SpecialtyRow[];
}

export function getSpecialty(id: number): SpecialtyRow | null {
  return (db.prepare("SELECT * FROM specialties WHERE id = ?").get(id) as SpecialtyRow) ?? null;
}

export function createSpecialty(input: { name: string; prompt: string }): SpecialtyRow {
  const now = Date.now();
  const result = db
    .prepare("INSERT INTO specialties (name, prompt, created_at) VALUES (?, ?, ?)")
    .run(input.name.trim(), input.prompt.trim(), now);
  return getSpecialty(result.lastInsertRowid as number)!;
}

export function updateSpecialty(
  id: number,
  patch: { name?: string; prompt?: string },
): SpecialtyRow | null {
  const existing = getSpecialty(id);
  if (!existing) return null;
  const name = patch.name?.trim() || existing.name;
  const prompt = patch.prompt?.trim() || existing.prompt;
  db.prepare("UPDATE specialties SET name = ?, prompt = ? WHERE id = ?").run(name, prompt, id);
  return getSpecialty(id);
}

export function deleteSpecialty(id: number): boolean {
  const res = db.prepare("DELETE FROM specialties WHERE id = ?").run(id);
  return res.changes > 0;
}
