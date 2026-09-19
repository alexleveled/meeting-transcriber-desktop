"use client";

import { useRef, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { VuMeter } from "@/components/VuMeter";
import {
  MicCaptureSource,
  SystemAudioCaptureSource,
  NoAudioTrackError,
  PermissionDeniedError,
  type AudioCaptureSource,
} from "@/lib/audio/capture";
import { AudioPipeline, createAudioContext } from "@/lib/audio/pipeline";
import type { AudioSource } from "@/lib/types";

interface Chan {
  status: "idle" | "arming" | "live" | "ended" | "error";
  level: number;
  chunks: number;
  bytes: number;
  error?: string;
  rate?: number;
}

const BLANK: Chan = { status: "idle", level: 0, chunks: 0, bytes: 0 };

/**
 * Temporary debug panel — exercises the capture + pipeline layer (VU meters + chunk counters)
 * with no transcription provider involved. Reachable at /debug; not linked from the nav.
 */
export default function DebugPage() {
  const [mic, setMic] = useState<Chan>(BLANK);
  const [sys, setSys] = useState<Chan>(BLANK);
  const ctxRef = useRef<AudioContext | null>(null);
  const pipes = useRef<Record<AudioSource, AudioPipeline | null>>({ mic: null, system: null });
  const sources = useRef<Record<AudioSource, AudioCaptureSource | null>>({ mic: null, system: null });

  function ctx(): AudioContext {
    if (!ctxRef.current) ctxRef.current = createAudioContext();
    return ctxRef.current;
  }

  const setter = (kind: AudioSource) => (kind === "mic" ? setMic : setSys);

  async function startSource(kind: AudioSource) {
    const set = setter(kind);
    set((c) => ({ ...c, status: "arming", error: undefined }));
    const src = kind === "mic" ? new MicCaptureSource() : new SystemAudioCaptureSource();
    sources.current[kind] = src;
    try {
      const stream = await src.start();
      const pipe = new AudioPipeline(ctx(), stream, {
        onChunk: (buf) =>
          set((c) => ({ ...c, chunks: c.chunks + 1, bytes: c.bytes + buf.byteLength })),
        onRms: (v) => set((c) => ({ ...c, level: v })),
      });
      await pipe.start();
      pipes.current[kind] = pipe;
      src.onEnded(() => {
        set((c) => ({ ...c, status: "ended", level: 0 }));
      });
      set((c) => ({ ...c, status: "live", rate: pipe.contextSampleRate }));
    } catch (err) {
      const msg =
        err instanceof NoAudioTrackError || err instanceof PermissionDeniedError
          ? err.message
          : (err as Error).message;
      set((c) => ({ ...c, status: "error", error: msg }));
    }
  }

  function stopSource(kind: AudioSource) {
    pipes.current[kind]?.stop();
    sources.current[kind]?.stop();
    pipes.current[kind] = null;
    sources.current[kind] = null;
    setter(kind)((c) => ({ ...c, status: "idle", level: 0 }));
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-2xl flex-col px-8 py-8">
      <div className="shrink-0">
        <PageHeader title="Audio debug" subtitle="Exercise the capture + PCM pipeline with no transcription." />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-slim">
        <div className="flex flex-col gap-4">
          <ChannelCard kind="mic" title="Microphone (Me)" chan={mic} onStart={() => startSource("mic")} onStop={() => stopSource("mic")} color="#16a34a" />
          <ChannelCard kind="system" title="System audio (Participants)" chan={sys} onStart={() => startSource("system")} onStop={() => stopSource("system")} color="#2563eb" />
        </div>
        <p className="hint mt-4">
          System audio requires sharing <strong>Entire screen</strong> with “Also share system
          audio” ticked. Forgetting the checkbox should surface a “no audio” error here.
        </p>
      </div>
    </div>
  );
}

function ChannelCard({
  title,
  chan,
  onStart,
  onStop,
  color,
}: {
  kind: AudioSource;
  title: string;
  chan: Chan;
  onStart: () => void;
  onStop: () => void;
  color: string;
}) {
  const live = chan.status === "live";
  return (
    <div className="card p-5">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text)" }}>
          {title}
        </h2>
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          {chan.status}
          {chan.rate ? ` · ${chan.rate} Hz ctx` : ""}
        </span>
      </div>
      <VuMeter level={chan.level} color={color} />
      <div className="mt-3 flex items-center gap-4 text-xs" style={{ color: "var(--text-muted)" }}>
        <span>{chan.chunks} chunks</span>
        <span>{(chan.bytes / 1024).toFixed(1)} KB</span>
        <span>~{(chan.chunks * 0.1).toFixed(1)}s audio</span>
      </div>
      {chan.error && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {chan.error}
        </p>
      )}
      <div className="mt-4 flex gap-2">
        <button className="btn btn-primary" onClick={onStart} disabled={live || chan.status === "arming"}>
          {chan.status === "arming" ? "Arming…" : "Start"}
        </button>
        <button className="btn btn-secondary" onClick={onStop} disabled={chan.status === "idle"}>
          Stop
        </button>
      </div>
    </div>
  );
}
