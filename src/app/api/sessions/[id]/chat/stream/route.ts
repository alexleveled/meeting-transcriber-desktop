import { getChatMessages, getSpecialty, insertChatMessage } from "@/server/chat-queries";
import { streamAnthropic, streamOpenAI } from "@/server/chat-providers";
import { getSegments, getSession } from "@/server/queries";
import { getChatApiKey, getChatModel } from "@/server/settings";
import { labelFor } from "@/lib/format-transcript";
import { citedLineNumbers } from "@/lib/chat-citations";
import { CHAT_PROVIDERS, type ChatMessageRow, type ChatProvider, type Citation } from "@/lib/types";
import { NextResponse } from "next/server";

/**
 * Streaming chat endpoint: takes a user question about a meeting transcript, streams the
 * assistant's answer back over SSE, and persists both the user message and the completed
 * (or partial, on error/abort) assistant reply to the DB.
 *
 * The transcript context is built from either a live client-side segment snapshot (the
 * recorder's in-memory state, which is fresher than the DB during an active recording — see
 * the `segments` field below) or, when omitted, the DB via getSegments(). Lines are numbered
 * so the model can cite them inline as [n], and citations are resolved back to transcript
 * positions via a lookup map built alongside the numbered lines.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

interface BodySegment {
  source: "mic" | "system";
  text: string;
  speaker: number | null;
  startedAtMs: number;
  seq: number;
}

interface Body {
  message: string;
  provider?: ChatProvider;
  model?: string;
  specialtyId?: number | null;
  /** Live snapshot from the recorder (DB lags by the 3s persist interval). Omitted => load from DB. */
  segments?: BodySegment[];
  swapped?: boolean;
}

interface CitationMapEntry {
  startedAtMs: number;
  seq: number;
  snippet: string;
  label: string;
}

const MAX_TRANSCRIPT_CHARS = 60000;
const OMITTED_PREFIX = "[… earlier transcript omitted …]";

const BASE_SYSTEM_INSTRUCTION =
  "You are an assistant answering questions about a meeting transcript. Answer only using " +
  "information contained in the transcript below, and explicitly say so when the transcript " +
  "does not cover something the user asked about. Be concise. " +
  // The reply is rendered as markdown (see components/chat/ChatRichText), so saying this is what
  // stops short answers arriving as one wall of prose and long ones as literal '##' characters.
  "Replies are rendered as markdown: use '## ' and '### ' headings, '- ' bullets, and **bold** " +
  "when the answer has enough structure to benefit. A one- or two-sentence answer needs none of it.";

const CITATION_INSTRUCTION =
  "When you reference something from the transcript, cite the supporting line inline in square " +
  "brackets, like [12]. Put each line in its own brackets — write [12][15], never a range like " +
  "[12-15] and never a list like [12, 15]. Only use line numbers that appear in the transcript " +
  "above, never invent one, and cite the few most relevant lines rather than every related line.";

function buildTranscriptContext(segments: BodySegment[], swapped: boolean) {
  const lines: { n: number; text: string }[] = [];
  const citationMap = new Map<number, CitationMapEntry>();

  segments.forEach((seg, idx) => {
    const n = idx + 1;
    const label = labelFor(seg, swapped);
    const trimmed = seg.text.trim();
    lines.push({ n, text: `[${n}] ${label}: ${trimmed}` });
    const snippet = trimmed.length > 240 ? `${trimmed.slice(0, 240)}…` : trimmed;
    citationMap.set(n, { startedAtMs: seg.startedAtMs, seq: seg.seq, snippet, label });
  });

  // Drop oldest lines until the block fits. Line numbers on the survivors are NOT reassigned —
  // the citation map has to keep pointing at the same segments the model sees.
  let total = lines.reduce((sum, l) => sum + l.text.length + 1, 0);
  let dropped = false;
  while (lines.length > 0 && total > MAX_TRANSCRIPT_CHARS) {
    const removed = lines.shift()!;
    total -= removed.text.length + 1;
    citationMap.delete(removed.n);
    dropped = true;
  }

  const body = lines.map((l) => l.text).join("\n");
  const block = dropped ? `${OMITTED_PREFIX}\n${body}` : body;
  return { block, citationMap };
}

function parseCitations(text: string, citationMap: Map<number, CitationMapEntry>): Citation[] {
  const citations: Citation[] = [];
  // citedLineNumbers is shared with the client renderer, so what gets persisted here and what
  // gets drawn as a chip can never drift apart (it also expands `[5, 7]` and `[4-9]`).
  for (const n of citedLineNumbers(text)) {
    const entry = citationMap.get(n);
    if (entry) citations.push({ n, ...entry });
  }
  return citations;
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;

  const session = getSession(id);
  if (!session) return NextResponse.json({ error: "Session not found" }, { status: 404 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.message !== "string" || body.message.trim() === "") {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const chatModelSetting = getChatModel();
  const provider = body.provider ?? chatModelSetting?.provider;
  const model = body.model ?? chatModelSetting?.id;
  if (!provider || !model || !CHAT_PROVIDERS.includes(provider)) {
    return NextResponse.json({ error: "No chat model selected" }, { status: 400 });
  }

  const apiKey = getChatApiKey(provider);
  if (!apiKey) {
    return NextResponse.json(
      { error: `No API key for ${provider}. Add one in Settings.` },
      { status: 400 },
    );
  }

  const specialtyId = body.specialtyId ?? null;
  const swapped = body.swapped ?? session.speakers_swapped === 1;

  const sourceSegments: BodySegment[] =
    body.segments ??
    getSegments(id).map((s) => ({
      source: s.source,
      text: s.text,
      speaker: s.speaker,
      startedAtMs: s.started_at_ms,
      seq: s.seq,
    }));

  const { block: transcriptBlock, citationMap } = buildTranscriptContext(sourceSegments, swapped);

  // Last 20 turns, minus any leading assistant rows: Anthropic rejects a conversation whose
  // first message isn't from the user, and a 20-message window can easily start mid-exchange.
  const history = getChatMessages(id)
    .slice(-20)
    .map((m) => ({ role: m.role, content: m.content }));
  while (history.length > 0 && history[0].role !== "user") history.shift();

  let specialtyPrompt: string | null = null;
  if (specialtyId != null) {
    const specialty = getSpecialty(specialtyId);
    if (specialty) specialtyPrompt = specialty.prompt;
  }

  const systemParts = [BASE_SYSTEM_INSTRUCTION];
  if (specialtyPrompt) systemParts.push(specialtyPrompt);
  systemParts.push(`Transcript:\n"""\n${transcriptBlock}\n"""`);
  systemParts.push(CITATION_INSTRUCTION);
  const system = systemParts.join("\n\n");

  const message = body.message.trim();
  insertChatMessage({ sessionId: id, role: "user", content: message, specialtyId });

  const messages = [...history, { role: "user" as const, content: message }];

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (obj: unknown) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(obj)}\n\n`));
        } catch {
          // Client is already gone — nothing to do.
        }
      };

      let full = "";

      const persist = (): ChatMessageRow => {
        const citations = parseCitations(full, citationMap);
        return insertChatMessage({
          sessionId: id,
          role: "assistant",
          content: full,
          provider,
          model,
          specialtyId,
          citations,
        });
      };

      try {
        const streamFn = provider === "anthropic" ? streamAnthropic : streamOpenAI;
        for await (const chunk of streamFn({
          apiKey,
          model,
          system,
          messages,
          signal: req.signal,
        })) {
          full += chunk;
          send({ type: "delta", text: chunk });
        }
        if (full) {
          const row = persist();
          send({ type: "done", message: row });
        } else {
          // No text at all — the client is waiting on a terminal event, so give it one.
          send({ type: "error", error: "The model returned an empty response." });
        }
      } catch (err) {
        const aborted = req.signal.aborted || (err instanceof Error && err.name === "AbortError");
        if (aborted) {
          if (full) {
            const row = persist();
            send({ type: "done", message: row });
          }
        } else {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send({ type: "error", error: errorMessage });
          if (full) persist();
        }
      } finally {
        try {
          controller.close();
        } catch {
          // Already closed/gone.
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
