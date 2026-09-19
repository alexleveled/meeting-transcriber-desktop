import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { env } from "./env";
import { seedBuiltinSpecialties } from "./builtin-specialties";

/**
 * SQLite handle, cached on globalThis so Next.js dev HMR doesn't open a new connection
 * (and re-run the schema) on every hot reload. Schema is bootstrapped idempotently.
 */

type DB = Database.Database;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id               TEXT PRIMARY KEY,
  title            TEXT NOT NULL DEFAULT 'Untitled meeting',
  status           TEXT NOT NULL DEFAULT 'recording' CHECK (status IN ('recording','completed')),
  model            TEXT NOT NULL,
  input_mode       TEXT,
  speakers_swapped INTEGER NOT NULL DEFAULT 0,
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  created_at       INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS segments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  source        TEXT NOT NULL CHECK (source IN ('mic','system')),
  text          TEXT NOT NULL,
  speaker       INTEGER,
  started_at_ms INTEGER NOT NULL,
  ended_at_ms   INTEGER,
  seq           INTEGER NOT NULL,
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_segments_order ON segments(session_id, started_at_ms, seq);

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS specialties (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  prompt       TEXT NOT NULL,
  created_at   INTEGER NOT NULL,
  builtin_slug TEXT
);

-- specialty_id is a soft reference (no FK) so deleting a specialty keeps chat history intact;
-- citations is JSON: [{n,startedAtMs,seq,snippet,label}].
CREATE TABLE IF NOT EXISTS chat_messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id   TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role         TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content      TEXT NOT NULL,
  provider     TEXT,
  model        TEXT,
  specialty_id INTEGER,
  citations    TEXT,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON chat_messages(session_id, created_at, id);
`;

/**
 * Columns added after the first release. `CREATE TABLE IF NOT EXISTS` is a no-op on an existing
 * DB, so a database created before these columns existed needs them added explicitly. Each entry
 * is applied only when `PRAGMA table_info` says the column is missing, which makes the whole pass
 * idempotent and safe to run on every boot (including a fresh DB, where nothing is missing).
 */
const ADDED_COLUMNS: Array<{ table: string; column: string; ddl: string }> = [
  { table: "sessions", column: "input_mode", ddl: "TEXT" },
  { table: "sessions", column: "speakers_swapped", ddl: "INTEGER NOT NULL DEFAULT 0" },
  { table: "segments", column: "speaker", ddl: "INTEGER" },
  { table: "specialties", column: "builtin_slug", ddl: "TEXT" },
];

function migrate(db: DB): void {
  for (const { table, column, ddl } of ADDED_COLUMNS) {
    const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === column)) continue;
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

function create(): DB {
  const path = resolve(process.cwd(), env.dbPath);
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);
  migrate(db);
  seedBuiltinSpecialties(db);
  return db;
}

const globalForDb = globalThis as unknown as { __transcriberDb?: DB };

export const db: DB = globalForDb.__transcriberDb ?? (globalForDb.__transcriberDb = create());
