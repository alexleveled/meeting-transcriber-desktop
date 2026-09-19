import Link from "next/link";
import { listSessions } from "@/server/queries";
import { PageHeader } from "@/components/PageHeader";
import { SessionsTable } from "./SessionsTable";

export const dynamic = "force-dynamic";

export default function SessionsPage() {
  const sessions = listSessions();

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-4xl flex-col px-8 py-8">
      <div className="shrink-0">
        <PageHeader
          title="Sessions"
          subtitle="Past recordings. Open one to read the transcript or export it."
          actions={
            <Link href="/" className="btn btn-primary">
              New recording
            </Link>
          }
        />
      </div>

      {sessions.length === 0 ? (
        <div className="card flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
          <div className="text-sm font-medium" style={{ color: "var(--text)" }}>
            No sessions yet
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            Start a recording and it will show up here.
          </div>
          <Link href="/" className="btn btn-secondary mt-2">
            Go to Recorder
          </Link>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
          <SessionsTable sessions={sessions} />
        </div>
      )}
    </div>
  );
}
