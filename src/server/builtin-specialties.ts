import type Database from "better-sqlite3";
import { SALES_COACH_PROMPT } from "./sales-coach-prompt";

/** A specialty shipped with the app rather than authored by the user. */
export type BuiltinSpecialty = { slug: string; name: string; prompt: string };

const SUMMARIZER_PROMPT = `You are a meeting summarizer. Produce a clear, well-structured summary of the conversation.

Formatting rules:
- Use "## " for the document title and "### " for section headings.
- Use "- " bullet points for lists; keep each bullet to one idea.
- Bold key terms, names, numbers, and decisions with **double asterisks**.
- Keep paragraphs short. Prefer bullets over long prose.

If the user asks about a specific topic, summarize only that topic. Otherwise summarize the entire conversation.

Structure the summary with these sections (skip any that don't apply):

### Overview
Two or three sentences on what the conversation was about and how it ended.

### Key Discussion Points
The main topics, each with its important details.

### Decisions Made
Anything agreed or concluded.

### Action Items
Tasks, owners if identifiable, and deadlines if mentioned.

### Participants
If speakers are identified, one entry per person: their role in the conversation, what they discussed, and the main points they made.

Cite transcript lines with bracketed markers exactly as instructed, one bracket per line number (for example [12][15]). Never run several line numbers together outside brackets.`;

export const BUILTIN_SPECIALTIES: BuiltinSpecialty[] = [
  { slug: "summarizer", name: "Meeting Summarizer", prompt: SUMMARIZER_PROMPT },
  { slug: "sales-coach", name: "Sales Call Coach", prompt: SALES_COACH_PROMPT },
];

/**
 * Inserts each built-in specialty on first boot, once. A `settings` row keyed
 * `builtin.specialty.seeded.<slug>` is written alongside the insert and checked before it; its
 * presence (not the specialty row's) is what "already seeded" means. That's what makes deleting
 * a built-in stick: the user can delete the specialty row, but the marker survives, so this never
 * re-inserts it on the next restart or app update. It also means shipping a new built-in later is
 * just a new entry in BUILTIN_SPECIALTIES — its marker doesn't exist on any existing install yet,
 * so it seeds in for everyone on their next boot without touching the ones already seeded.
 *
 * Takes the raw Database handle (not db.ts's `db` export) because db.ts calls this from inside
 * `create()`, before the module has anything to export yet — importing ./db here would be
 * circular. Same reason it talks to the settings table directly instead of importing ./settings.
 */
export function seedBuiltinSpecialties(db: Database.Database): void {
  const hasMarker = db.prepare("SELECT 1 FROM settings WHERE key = ?");
  const insertSpecialty = db.prepare(
    "INSERT INTO specialties (name, prompt, created_at, builtin_slug) VALUES (?, ?, ?, ?)",
  );
  const insertMarker = db.prepare(
    "INSERT INTO settings (key, value, updated_at) VALUES (?, '1', ?)",
  );

  const seedOne = db.transaction((s: BuiltinSpecialty) => {
    const key = `builtin.specialty.seeded.${s.slug}`;
    if (hasMarker.get(key)) return;
    const now = Date.now();
    insertSpecialty.run(s.name, s.prompt, now, s.slug);
    insertMarker.run(key, now);
  });

  for (const specialty of BUILTIN_SPECIALTIES) seedOne(specialty);
}
