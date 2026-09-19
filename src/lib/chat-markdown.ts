/**
 * A deliberately small markdown reader for assistant replies. Models asked for a formatted
 * summary answer in markdown, and rendering that raw puts `## Overview` and `**bold**` on screen
 * verbatim. Rather than pull in remark/rehype, this covers the subset the chat actually produces:
 * headings, bullet and numbered lists, bold, and inline code.
 *
 * Framework-free (mirrors ./chat-citations) so the parse stays testable and the React layer in
 * components/chat/ChatRichText.tsx only maps blocks to elements. Parsing is a linear line scan,
 * cheap enough to redo on every streamed token.
 */

export type Block =
  | { kind: "heading"; level: 1 | 2 | 3; text: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "paragraph"; text: string };

export type ListItem = { text: string; depth: number };

/** Nesting past this reads as noise at chat width, so deeper indents flatten into it. */
const MAX_LIST_DEPTH = 2;

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const BULLET_RE = /^(\s*)[-*•]\s+(.*)$/;
const ORDERED_RE = /^(\s*)(\d+)[.)]\s+(.*)$/;

/** Two spaces per level is the common convention; tabs count as one level. */
function indentDepth(indent: string): number {
  const spaces = indent.replace(/\t/g, "  ").length;
  return Math.min(Math.floor(spaces / 2), MAX_LIST_DEPTH);
}

/**
 * Groups raw text into renderable blocks. Consecutive list lines merge into one list (switching
 * between bullets and numbers starts a new one); consecutive plain lines merge into one paragraph
 * with their newlines intact, so prose that predates markdown formatting renders exactly as it
 * always did. A line that matches nothing special is just paragraph text.
 */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let list: Extract<Block, { kind: "list" }> | null = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    blocks.push({ kind: "paragraph", text: paragraph.join("\n") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) blocks.push(list);
    list = null;
  };
  const flushAll = () => {
    flushParagraph();
    flushList();
  };

  const pushItem = (ordered: boolean, start: number, item: ListItem) => {
    flushParagraph();
    if (!list || list.ordered !== ordered) {
      flushList();
      list = { kind: "list", ordered, start, items: [] };
    }
    list.items.push(item);
  };

  for (const line of text.split("\n")) {
    if (line.trim() === "") {
      flushAll();
      continue;
    }

    const heading = line.match(HEADING_RE);
    if (heading) {
      flushAll();
      // Trailing hashes are the closed-ATX style (`## Title ##`) and are decoration, not content.
      const body = heading[2].replace(/\s*#+\s*$/, "").trim();
      if (body) blocks.push({ kind: "heading", level: heading[1].length as 1 | 2 | 3, text: body });
      continue;
    }

    const bullet = line.match(BULLET_RE);
    if (bullet) {
      pushItem(false, 1, { text: bullet[2], depth: indentDepth(bullet[1]) });
      continue;
    }

    const ordered = line.match(ORDERED_RE);
    if (ordered) {
      pushItem(true, Number(ordered[2]), { text: ordered[3], depth: indentDepth(ordered[1]) });
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushAll();
  return blocks;
}

export type InlinePart = { text: string; bold?: boolean; code?: boolean };

/**
 * `**bold**` and `` `code` `` runs within one line of text. Citation markers can't be disturbed
 * by this pass (they contain no asterisks or backticks), which is why ChatRichText runs inline
 * parsing first and splits citations inside each part — that way a citation sitting inside a bold
 * phrase still renders as a chip, and the bold still covers the whole phrase.
 */
const INLINE_RE = /\*\*(.+?)\*\*|`([^`]+)`/g;

export function parseInline(text: string): InlinePart[] {
  const parts: InlinePart[] = [];
  const re = new RegExp(INLINE_RE.source, "g");
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) parts.push({ text: text.slice(lastIndex, match.index) });
    if (match[1] !== undefined) parts.push({ text: match[1], bold: true });
    else parts.push({ text: match[2], code: true });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex) });
  return parts;
}
