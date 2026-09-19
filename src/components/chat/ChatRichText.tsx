"use client";

import { Fragment } from "react";
import type { Citation } from "@/lib/types";
import { splitWithCitations } from "@/lib/chat-citations";
import { parseBlocks, parseInline, type ListItem } from "@/lib/chat-markdown";
import { CitationChip } from "./CitationChip";

/**
 * Renders an assistant reply: markdown blocks (headings, lists, paragraphs) with inline citation
 * chips. Used by both the finalized message bubble and the live streaming block, which is what
 * keeps a reply from visibly reflowing the moment the stream ends.
 *
 * While streaming, `citations` is empty — the server only resolves them once the reply is
 * complete — so `[n]` stays literal text until then and turns into chips in place afterwards.
 */
export function ChatRichText({
  text,
  citations,
  onGoTo,
  trailing,
}: {
  text: string;
  citations: Citation[];
  onGoTo: (startedAtMs: number, seq: number) => void;
  /** Rendered at the very end of the last block, so the streaming cursor sits on the text. */
  trailing?: React.ReactNode;
}) {
  const blocks = parseBlocks(text);

  return (
    <div className="w-full text-sm leading-relaxed" style={{ color: "var(--text)" }}>
      {/* Nothing to lay out yet — the first streamed token hasn't landed — but the cursor still
          has to show, so it gets a block of its own. */}
      {blocks.length === 0 && trailing ? <div>{trailing}</div> : null}
      {blocks.map((block, i) => {
        const isLast = i === blocks.length - 1;
        const tail = isLast ? trailing : null;

        if (block.kind === "heading") {
          // Body text is 14px, so a heading has to differ by more than weight to read as one.
          // Titles step up in size; section headings step down into small caps, which separates
          // them from both the title above and the sentences below without shouting.
          const isSection = block.level >= 3;
          return (
            <div
              key={i}
              className={`font-semibold ${
                isSection
                  ? "text-[11px] uppercase tracking-[0.06em]"
                  : block.level === 1
                    ? "text-[17px]"
                    : "text-[15px]"
              } ${i === 0 ? "" : isSection ? "mt-4" : "mt-5"} mb-1.5`}
              style={{ color: isSection ? "var(--text-muted)" : "var(--text)" }}
            >
              <Inline text={block.text} citations={citations} onGoTo={onGoTo} />
              {tail}
            </div>
          );
        }

        if (block.kind === "list") {
          return (
            <ul key={i} className="my-1.5 space-y-1">
              {block.items.map((item, j) => (
                <ListRow
                  key={j}
                  item={item}
                  ordered={block.ordered}
                  marker={block.start + j}
                  citations={citations}
                  onGoTo={onGoTo}
                  trailing={tail && j === block.items.length - 1 ? tail : null}
                />
              ))}
            </ul>
          );
        }

        return (
          <div key={i} className={`whitespace-pre-wrap ${i === 0 ? "" : "mt-2"}`}>
            <Inline text={block.text} citations={citations} onGoTo={onGoTo} />
            {tail}
          </div>
        );
      })}
    </div>
  );
}

/**
 * One list row. The bullet/number is drawn as its own flex column rather than with `list-style`,
 * because citation chips are absolutely-positioned buttons and native list markers don't align
 * with a wrapped, chip-bearing line the way a fixed marker column does.
 */
function ListRow({
  item,
  ordered,
  marker,
  citations,
  onGoTo,
  trailing,
}: {
  item: ListItem;
  ordered: boolean;
  marker: number;
  citations: Citation[];
  onGoTo: (startedAtMs: number, seq: number) => void;
  trailing?: React.ReactNode;
}) {
  return (
    <li className="flex gap-2" style={{ marginLeft: `${item.depth * 1}rem` }}>
      <span
        className="shrink-0 select-none tabular-nums"
        style={{ color: "var(--text-muted)", minWidth: ordered ? "1.1rem" : undefined }}
        aria-hidden
      >
        {ordered ? `${marker}.` : item.depth > 0 ? "◦" : "•"}
      </span>
      <span className="min-w-0 flex-1">
        <Inline text={item.text} citations={citations} onGoTo={onGoTo} />
        {trailing}
      </span>
    </li>
  );
}

/**
 * Inline content of one block. Bold/code runs are found first and citations split *inside* each
 * run, so a citation that falls within a bold phrase still becomes a chip without breaking the
 * bold across it. Citation markers contain no asterisks or backticks, so the inline pass can't
 * corrupt them.
 */
function Inline({
  text,
  citations,
  onGoTo,
}: {
  text: string;
  citations: Citation[];
  onGoTo: (startedAtMs: number, seq: number) => void;
}) {
  return (
    <>
      {parseInline(text).map((part, i) => {
        const content = splitWithCitations(part.text, citations).map((p, j) =>
          p.kind === "text" ? (
            <Fragment key={j}>{p.text}</Fragment>
          ) : (
            <CitationChip key={j} citation={p.citation} onGoTo={onGoTo} />
          ),
        );

        if (part.bold) {
          return (
            <strong key={i} className="font-semibold">
              {content}
            </strong>
          );
        }
        if (part.code) {
          return (
            <code
              key={i}
              className="rounded px-1 py-0.5 text-[12px]"
              style={{ background: "var(--surface-2)" }}
            >
              {content}
            </code>
          );
        }
        return <Fragment key={i}>{content}</Fragment>;
      })}
    </>
  );
}
