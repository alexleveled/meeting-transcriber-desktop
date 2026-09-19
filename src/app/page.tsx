"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { SetupChecklist } from "@/components/SetupChecklist";
import { StatusPill } from "@/components/StatusPill";
import { VuMeter } from "@/components/VuMeter";
import { TranscriptList } from "@/components/TranscriptList";
import { InterimBubble } from "@/components/InterimBubble";
import { ExportButton } from "@/components/ExportButton";
import { CopyTranscriptButton } from "@/components/CopyTranscriptButton";
import { JumpToLatestButton } from "@/components/JumpToLatestButton";
import { ChatDock } from "@/components/chat/ChatDock";
import { useRecorder } from "@/hooks/useRecorder";
import { useStickToBottom } from "@/hooks/useStickToBottom";
import { isElectron } from "@/lib/window-adapter";
import { getSavedInputMode } from "@/lib/input-mode";
import { formatDuration } from "@/lib/format-time";
import { highlightSegment } from "@/lib/highlight-segment";
import { PROVIDER_LABEL, type ClientSettings, type InputMode, type Provider } from "@/lib/types";

export default function RecorderPage() {
  const [settings, setSettings] = useState<ClientSettings | null>(null);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then((d: ClientSettings) => setSettings(d))
      .catch(() => setSettings(null));
  }, []);

  if (!settings) {
    return (
      <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-8 py-8">
        <div className="shrink-0">
          <PageHeader title="Recorder" />
        </div>
        <div className="card p-6 text-sm" style={{ color: "var(--text-muted)" }}>
          Loading…
        </div>
      </div>
    );
  }

  return <RecorderInner settings={settings} />;
}

function RecorderInner({ settings }: { settings: ClientSettings }) {
  const provider: Provider = settings.provider;
  const model = settings.model;
  const isLocal = provider === "local";
  const hasKey = settings.keys[provider].hasKey;
  const rec = useRecorder();

  // Local Whisper is "ready" once its model is downloaded; cloud providers once a key is set.
  const [localReady, setLocalReady] = useState<boolean | null>(isLocal ? null : true);
  useEffect(() => {
    if (!isLocal) {
      setLocalReady(true);
      return;
    }
    let cancelled = false;
    fetch("/api/local-whisper/models")
      .then((r) => r.json() as Promise<{ models: Array<{ file: string; downloaded: boolean }> }>)
      .then((d) => {
        if (!cancelled) setLocalReady(d.models.some((m) => m.file === model && m.downloaded));
      })
      .catch(() => {
        if (!cancelled) setLocalReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isLocal, model]);

  const ready = isLocal ? localReady === true : hasKey;
  // Don't flash a "not ready" banner before the local download check resolves.
  const readyKnown = isLocal ? localReady !== null : true;

  // Arriving at the Recorder page should always offer a fresh recording. Normally `stop()`
  // navigates straight to the session's detail page, but if the user lands here anyway with a
  // leftover "stopped" state (e.g. back button), clear it instead of showing the last transcript.
  const resetRecorder = rec.reset;
  useEffect(() => {
    if (rec.state === "stopped") resetRecorder();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-8 py-8">
      <div className="shrink-0">
        <PageHeader
          title="Recorder"
          subtitle="Capture a live meeting with separate transcripts for you and the participants."
          actions={
            (rec.state === "live" || rec.state === "stopped") &&
            (() => {
              const exportable = rec.segments.map((s) => ({
                source: s.source,
                text: s.text,
                speaker: s.speaker,
              }));
              return (
                <>
                  <CopyTranscriptButton segments={exportable} swapped={rec.speakersSwapped} />
                  <ExportButton segments={exportable} swapped={rec.speakersSwapped} />
                </>
              );
            })()
          }
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scroll-slim">
        {rec.state === "idle" && (
          <IdleView
            provider={provider}
            model={model}
            isLocal={isLocal}
            ready={ready}
            readyKnown={readyKnown}
            deepgramModel={settings.modelByProvider.deepgram}
            hasDeepgramKey={settings.keys.deepgram.hasKey}
            onNeedDeepgramKey={rec.reportDeepgramKeyMissing}
            onStart={rec.start}
          />
        )}

        {rec.state === "arming" && (
          <div className="card flex items-center gap-3 p-6">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
            <span className="text-sm" style={{ color: "var(--text)" }}>
              {rec.activeMode === "phone"
                ? "Requesting microphone…"
                : "Requesting microphone and screen share…"}
            </span>
          </div>
        )}

        {(rec.state === "live" || rec.state === "stopped") && <LiveView rec={rec} />}

        {rec.error && rec.state !== "idle" && (
          <p className="mt-3 shrink-0 text-sm" style={{ color: "var(--danger)" }}>
            {rec.error}
          </p>
        )}
      </div>
    </div>
  );
}

const MODE_CARDS: { mode: InputMode; title: string; body: string }[] = [
  {
    mode: "pc",
    title: "Call on this PC",
    body: "Zoom, Meet, or any call playing through this computer. Records your mic and the call audio.",
  },
  {
    mode: "phone",
    title: "Phone call on speaker",
    body: "Your phone is on speaker in the room. Records the mic only and separates the two voices. Requires a Deepgram API key.",
  },
];

function IdleView({
  provider,
  model,
  isLocal,
  ready,
  readyKnown,
  deepgramModel,
  hasDeepgramKey,
  onNeedDeepgramKey,
  onStart,
}: {
  provider: Provider;
  model: string;
  isLocal: boolean;
  ready: boolean;
  readyKnown: boolean;
  deepgramModel: string;
  hasDeepgramKey: boolean;
  onNeedDeepgramKey: () => void;
  onStart: (mode: InputMode) => void;
}) {
  const [electron, setElectron] = useState(false);
  const [mode, setMode] = useState<InputMode>("pc");
  const [step, setStep] = useState<1 | 2>(1);
  // Both read `window`, so resolve after mount to avoid a hydration mismatch.
  useEffect(() => {
    setElectron(isElectron());
    setMode(getSavedInputMode());
  }, []);

  function pick(next: InputMode) {
    // Phone mode is a dead end without a key, so say so here instead of at Start.
    if (next === "phone" && !hasDeepgramKey) {
      onNeedDeepgramKey();
      return;
    }
    setMode(next);
    setStep(2);
  }

  if (step === 1) {
    return (
      <div className="card p-6">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          Step 1 of 2 · How are you taking this call?
        </h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {MODE_CARDS.map((c) => {
            const active = c.mode === mode;
            return (
              <button
                key={c.mode}
                type="button"
                onClick={() => pick(c.mode)}
                className="rounded-lg border px-4 py-4 text-left transition-colors"
                style={{
                  borderColor: active ? "var(--accent)" : "var(--border-strong)",
                  background: active ? "var(--accent-soft)" : "var(--surface)",
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium" style={{ color: "var(--text)" }}>
                    {c.title}
                  </span>
                  <span
                    className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                    style={{
                      borderColor: active ? "var(--accent)" : "var(--border-strong)",
                      background: active ? "var(--accent)" : "transparent",
                    }}
                  >
                    {active && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
                  </span>
                </div>
                <div className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                  {c.body}
                </div>
                {c.mode === "phone" && !hasDeepgramKey && (
                  <span
                    className="mt-2.5 inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
                    style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
                  >
                    Deepgram key required
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const phone = mode === "phone";
  return (
    <div className="flex flex-col gap-4">
      {/* The provider/key warning is a PC-mode concern — phone mode gates on its own key instead. */}
      {!phone && readyKnown && !ready && (
        <div
          className="flex items-center justify-between gap-3 rounded-lg px-4 py-3 text-sm"
          style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
        >
          <span>
            {isLocal ? (
              <>
                The free <strong>{PROVIDER_LABEL[provider]}</strong> model isn&rsquo;t downloaded yet.
                Download it before recording.
              </>
            ) : (
              <>
                No API key set for <strong>{PROVIDER_LABEL[provider]}</strong>. Add one before
                recording.
              </>
            )}
          </span>
          <Link href="/settings" className="btn btn-secondary shrink-0">
            Open Settings
          </Link>
        </div>
      )}

      <div className="card p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setStep(1)}>
              ← Change mode
            </button>
            <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
              Step 2 of 2 · Before you start
            </h2>
          </div>
          <span className="shrink-0 text-xs" style={{ color: "var(--text-muted)" }}>
            {phone
              ? `${PROVIDER_LABEL.deepgram} · ${deepgramModel}`
              : `${PROVIDER_LABEL[provider]} · ${model}`}
          </span>
        </div>

        <SetupChecklist mode={mode} />

        <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
          <button className="btn btn-primary" onClick={() => onStart(mode)}>
            <span className="mr-1 h-2 w-2 rounded-full bg-white" />
            Start recording
          </button>
          <p className="hint mt-2">
            {phone
              ? "You'll only be asked for microphone access."
              : electron
                ? "Both your microphone and the meeting audio start recording instantly — no prompts."
                : "You'll be asked for microphone access, then to pick a screen to share."}
          </p>
        </div>
      </div>
    </div>
  );
}

function LiveView({ rec }: { rec: ReturnType<typeof useRecorder> }) {
  const stopped = rec.state === "stopped";
  const phone = rec.activeMode === "phone";
  const { scrollRef, showJump, scrollToBottom, onScroll, unpin } = useStickToBottom([
    rec.segmentCount,
    rec.interim.mic,
    rec.interim.system,
  ]);

  // `rec.segments` changes constantly during recording, so ChatDock's `getSegments` reads from a
  // ref kept in sync via effect rather than closing over the array directly — that keeps the
  // callback identity stable while still returning the current segments when called.
  const segmentsRef = useRef(rec.segments);
  segmentsRef.current = rec.segments;
  const getSegments = useCallback(() => segmentsRef.current, []);

  const scrollToSegment = useCallback(
    (startedAtMs: number, seq: number) => {
      // Must come first: otherwise the next interim transcript delta re-pins the container and
      // yanks the view straight back to the bottom before (or right after) the jump.
      unpin();
      const el = scrollRef.current?.querySelector<HTMLElement>(
        `[data-seg="${startedAtMs}:${seq}"]`,
      );
      if (!el) return;
      el.scrollIntoView({ block: "center", behavior: "smooth" });
      highlightSegment(el);
    },
    [unpin, scrollRef],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Status bar */}
      <div className="card shrink-0 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 font-mono text-lg" style={{ color: "var(--text)" }}>
            <span
              className={`h-2.5 w-2.5 rounded-full ${stopped ? "" : "animate-pulse"}`}
              style={{ background: stopped ? "var(--text-subtle)" : "var(--danger)" }}
            />
            {formatDuration(rec.elapsedMs)}
          </div>
          <div className="flex items-center gap-2">
            {phone && (
              <button
                className="btn btn-ghost px-2.5 py-1 text-xs"
                onClick={rec.toggleSpeakersSwapped}
                title="The two voices came out the wrong way round"
              >
                Swap speakers
              </button>
            )}
            {!stopped && (
              <button className="btn btn-danger" onClick={rec.stop}>
                Stop recording
              </button>
            )}
            {stopped && (
              <Link href={rec.sessionId ? `/sessions/${rec.sessionId}` : "/sessions"} className="btn btn-primary">
                View session
              </Link>
            )}
          </div>
        </div>

        {rec.saveWarning && !stopped && (
          <p className="mt-2 text-xs" style={{ color: "var(--warn)" }}>
            Saving is retrying… (transcript is safe in memory)
          </p>
        )}

        {phone ? (
          <div className="mt-4">
            <SourceMeter
              title="Phone call (microphone)"
              status={rec.sourceStatus.mic}
              level={rec.levels.mic}
              color="#16a34a"
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-4">
            <SourceMeter
              title="Participants (system)"
              status={rec.sourceStatus.system}
              level={rec.levels.system}
              color="#2563eb"
            />
            <SourceMeter
              title="Me (microphone)"
              status={rec.sourceStatus.mic}
              level={rec.levels.mic}
              color="#16a34a"
            />
          </div>
        )}

        {!phone && rec.systemNeedsAttention && !stopped && (
          <div
            className="mt-4 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm"
            style={{ background: "var(--warn-soft)", color: "var(--warn)" }}
          >
            <span>System audio isn&apos;t active. Re-share your screen with “Also share system audio”.</span>
            <button className="btn btn-secondary shrink-0" onClick={rec.resumeSystem}>
              Resume system audio
            </button>
          </div>
        )}
      </div>

      {/* Transcript */}
      <div className="card relative flex min-h-0 flex-1 flex-col p-6">
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto scroll-slim"
        >
          {rec.segments.length === 0 && !rec.interim.mic && !rec.interim.system ? (
            <div className="py-10 text-center text-sm" style={{ color: "var(--text-muted)" }}>
              {stopped ? "No transcript was captured." : "Listening… start talking to see the transcript."}
            </div>
          ) : (
            <>
              <TranscriptList
                rows={rec.segments.map((s) => ({
                  key: s.key,
                  source: s.source,
                  text: s.text,
                  speaker: s.speaker,
                  startedAtMs: s.startedAtMs,
                  seq: s.seq,
                }))}
                swapped={rec.speakersSwapped}
              />
              {!stopped && (
                <div className="mt-2.5 flex flex-col gap-2.5">
                  {phone ? (
                    // One undifferentiated bubble: interim words aren't attributed to a voice yet.
                    <InterimBubble source="mic" text={rec.interim.mic} label="Hearing…" />
                  ) : (
                    <>
                      <InterimBubble source="system" text={rec.interim.system} />
                      <InterimBubble source="mic" text={rec.interim.mic} />
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>
        {showJump && <JumpToLatestButton onClick={() => scrollToBottom()} />}
      </div>

      <div className="shrink-0">
        <ChatDock
          sessionId={rec.sessionId ?? null}
          getSegments={getSegments}
          swapped={rec.speakersSwapped}
          scrollToSegment={scrollToSegment}
          disabledHint="Start recording to chat about this meeting."
        />
      </div>
    </div>
  );
}

function SourceMeter({
  title,
  status,
  level,
  color,
}: {
  title: string;
  status: ReturnType<typeof useRecorder>["sourceStatus"]["mic"];
  level: number;
  color: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "var(--text-muted)" }}>
          {title}
        </span>
        <StatusPill status={status} />
      </div>
      <VuMeter level={level} color={color} />
    </div>
  );
}
