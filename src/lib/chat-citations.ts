import type { Citation } from "./types";

/**
 * Framework-free helpers for rendering assistant chat replies with inline citation markers.
 * The model is instructed (see the stream route) to cite transcript lines as `[n]`; these
 * helpers turn that raw text into renderable parts without pulling in React.
 */

export type CitationPart =
  | { kind: "text"; text: string }
  | { kind: "citation"; n: number; citation: Citation };

/** Safe JSON.parse of a `ChatMessageRow.citations` string; `[]` on null or malformed input. */
export function parseCitations(json: string | null): Citation[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as Citation[]) : [];
  } catch {
    return [];
  }
}

/**
 * Matches one bracketed citation group. The prompt asks for one line per bracket (`[12][15]`),
 * but models routinely emit comma lists (`[5, 7, 10]`) and ranges (`[4-17]`, with an en/em dash
 * as often as a hyphen), so the group is matched loosely and expanded by BRACKET_NUMBERS.
 */
const CITATION_GROUP_RE = /\[\s*\d+(?:\s*[-–—,]\s*\d+)*\s*\]/g;

/** A range wider than this is almost certainly the model gesturing at "most of the transcript". */
const MAX_RANGE_SPAN = 12;

/**
 * Expands the inside of a bracket group into the line numbers it refers to, in order and without
 * duplicates. `5, 7` → [5, 7]; `4-9` → [4…9]; an implausibly wide range collapses to just its
 * endpoints rather than burying the answer under dozens of chips.
 */
export function bracketNumbers(inner: string): number[] {
  const out: number[] = [];
  const push = (n: number) => {
    if (Number.isFinite(n) && !out.includes(n)) out.push(n);
  };

  for (const chunk of inner.split(",")) {
    const range = chunk.match(/^\s*(\d+)\s*[-–—]\s*(\d+)\s*$/);
    if (range) {
      const from = Number(range[1]);
      const to = Number(range[2]);
      const [lo, hi] = from <= to ? [from, to] : [to, from];
      if (hi - lo > MAX_RANGE_SPAN) {
        push(lo);
        push(hi);
      } else {
        for (let n = lo; n <= hi; n++) push(n);
      }
      continue;
    }
    const single = chunk.match(/\d+/);
    if (single) push(Number(single[0]));
  }

  return out;
}

/** Every line number cited anywhere in `text`, in first-appearance order. */
export function citedLineNumbers(text: string): number[] {
  const out: number[] = [];
  for (const group of text.match(CITATION_GROUP_RE) ?? []) {
    for (const n of bracketNumbers(group.slice(1, -1))) {
      if (!out.includes(n)) out.push(n);
    }
  }
  return out;
}

/**
 * The reply as plain text, for copying out of the app. Citation markers are dropped because
 * `[5, 7]` means nothing outside the chat — it points at transcript lines only this app can
 * resolve. Markdown is deliberately left in: it round-trips into notes and docs far better than
 * flattened text would. Unlike the renderer, this removes every marker, including ones that never
 * resolved to a citation.
 */
export function stripCitationMarkers(text: string): string {
  return text
    .replace(new RegExp(CITATION_GROUP_RE.source, "g"), "")
    // Close the gap a mid-sentence marker leaves behind, without touching leading indentation
    // (nested bullets depend on it) or the trailing whitespace handled on the next line.
    .replace(/(\S)[ \t]{2,}/g, "$1 ")
    .replace(/[ \t]+$/gm, "");
}

/**
 * Splits assistant text on citation markers. A group expands to one `citation` part per line
 * number it resolves to, so `[5, 7]` renders as two chips. A group whose numbers don't resolve
 * to any supplied `Citation` is left as literal text (e.g. the model citing a line that got
 * trimmed from the transcript context, or a number that was never a citation at all).
 */
export function splitWithCitations(text: string, citations: Citation[]): CitationPart[] {
  const byN = new Map(citations.map((c) => [c.n, c]));
  const parts: CitationPart[] = [];
  const re = new RegExp(CITATION_GROUP_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const resolved = bracketNumbers(match[0].slice(1, -1))
      .map((n) => ({ n, citation: byN.get(n) }))
      .filter((x): x is { n: number; citation: Citation } => x.citation !== undefined);
    if (resolved.length === 0) continue;

    if (match.index > lastIndex) {
      parts.push({ kind: "text", text: text.slice(lastIndex, match.index) });
    }
    for (const { n, citation } of resolved) {
      parts.push({ kind: "citation", n, citation });
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    parts.push({ kind: "text", text: text.slice(lastIndex) });
  }

  return parts;
}
