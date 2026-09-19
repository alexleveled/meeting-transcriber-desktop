import Link from "next/link";
import { notFound } from "next/navigation";
import { getSegments, getSession } from "@/server/queries";
import { getChatMessages } from "@/server/chat-queries";
import { type TranscriptRow } from "@/components/TranscriptList";
import { SessionWorkspace } from "@/components/SessionWorkspace";
import { DeleteSessionButton } from "@/components/DeleteSessionButton";
import { SessionTitle } from "@/components/SessionTitle";
import { formatDateTime, formatDuration, sessionDurationMs } from "@/lib/format-time";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = getSession(id);
  if (!session) notFound();

  const segments = getSegments(id);
  const rows: TranscriptRow[] = segments.map((s) => ({
    key: s.id,
    source: s.source,
    text: s.text,
    speaker: s.speaker,
    startedAtMs: s.started_at_ms,
    seq: s.seq,
  }));
  const isPhone = session.input_mode === "phone";

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-8 py-8">
      <div className="shrink-0">
        <Link
          href="/sessions"
          className="mb-4 inline-flex items-center gap-1 text-sm hover:underline"
          style={{ color: "var(--text-muted)" }}
        >
          ← All sessions
        </Link>

        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <SessionTitle sessionId={id} initialTitle={session.title} />
            <p className="mt-1 text-sm" style={{ color: "var(--text-muted)" }}>
              {`${formatDateTime(session.started_at)} · ${formatDuration(
                sessionDurationMs(session.started_at, session.ended_at),
              )} · ${session.model}${isPhone ? " · Phone call" : ""}`}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <a href={`/api/sessions/${id}/export`} className="btn btn-secondary">
              Export .txt
            </a>
            <DeleteSessionButton sessionId={id} />
          </div>
        </div>
      </div>

      <SessionWorkspace
        sessionId={id}
        rows={rows}
        initialSwapped={session.speakers_swapped === 1}
        showSwap={isPhone}
        initialChatMessages={getChatMessages(id)}
      />
    </div>
  );
}
