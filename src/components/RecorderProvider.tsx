"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useRouter } from "next/navigation";
import { RecorderEngine, type SourceStatus } from "@/lib/recorder-engine";
import { NoAudioTrackError, PermissionDeniedError } from "@/lib/audio/capture";
import {
  RecorderContext,
  type RecorderState,
  type UseRecorder,
  type ViewMode,
} from "@/hooks/useRecorder";
import {
  getWindowAdapter,
  COMPACT_HEIGHT_IDLE,
  COMPACT_HEIGHT_RECORDING,
} from "@/lib/window-adapter";
import { getSavedCompactPosition, saveCompactPosition } from "@/lib/compact-position";
import { getSavedInputMode, saveInputMode } from "@/lib/input-mode";
import { DeepgramKeyModal } from "@/components/DeepgramKeyModal";
import type { AudioSource, ClientSettings, InputMode, Provider } from "@/lib/types";

const IDLE_STATUS: Record<AudioSource, SourceStatus> = { mic: "idle", system: "idle" };

/** Shown when the user hits Record before finishing setup (no downloaded model / no API key). */
const SETUP_REQUIRED_MESSAGE =
  "You need to either download a free Whisper model or enter an API key to get transcription going. Open Settings to finish setup.";

/** Is the selected local Whisper model actually downloaded? (Cloud providers skip this.) */
async function isLocalModelReady(model: string): Promise<boolean> {
  try {
    const res = await fetch("/api/local-whisper/models");
    if (!res.ok) return false;
    const data = (await res.json()) as { models: Array<{ file: string; downloaded: boolean }> };
    return data.models.some((m) => m.file === model && m.downloaded);
  } catch {
    return false;
  }
}
const NOOP_SUBSCRIBE = () => () => {};
const ZERO = () => 0;
const EMPTY_SNAPSHOT = { segments: [], interim: { mic: "", system: "" } } as ReturnType<
  RecorderEngine["store"]["snapshot"]
>;

/**
 * App-level owner of the single RecorderEngine. Mounted once in layout.tsx so a live recording
 * survives navigation between pages and is observable from the header pill and compact widget.
 * A *fresh* engine is built on every start() (the engine is single-shot: stop() is terminal), with
 * provider/model fetched from settings at that moment.
 */
export function RecorderProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const engineRef = useRef<RecorderEngine | null>(null);
  const [engineNonce, setEngineNonce] = useState(0);
  const [state, setState] = useState<RecorderState>("idle");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourceStatus, setSourceStatus] = useState<Record<AudioSource, SourceStatus>>(IDLE_STATUS);
  const [levels, setLevels] = useState<Record<AudioSource, number>>({ mic: 0, system: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notReady, setNotReady] = useState<string | null>(null);
  const [systemNeedsAttention, setSystemNeedsAttention] = useState(false);
  const [deepgramKeyMissing, setDeepgramKeyMissing] = useState(false);
  const [saveWarning, setSaveWarning] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [activeMode, setActiveMode] = useState<InputMode | null>(null);
  const [speakersSwapped, setSpeakersSwapped] = useState(false);
  const [active, setActive] = useState<{ provider: Provider; model: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("dashboard");
  const startedAtRef = useRef<number>(0);

  // Latest state readable from callbacks without re-creating them (e.g. enterCompact height).
  const stateRef = useRef<RecorderState>(state);
  stateRef.current = state;
  const isRecording = (s: RecorderState) => s === "live" || s === "arming";

  // Elapsed timer while live.
  useEffect(() => {
    if (state !== "live") return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAtRef.current), 250);
    return () => clearInterval(id);
  }, [state]);

  // Warn before leaving/closing the page (or a hard reload) while a recording is live.
  useEffect(() => {
    if (state !== "live") return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [state]);

  // While compact, persist the widget's live position (Electron drives real window moves; the
  // browser no-op adapter never fires, so this is inert there). Debounced ~500ms per the spec.
  useEffect(() => {
    if (viewMode !== "compact") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = getWindowAdapter().onWindowMoved((pos) => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void saveCompactPosition(pos), 500);
    });
    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
    };
  }, [viewMode]);

  // Subscribe to the current engine's transcript store for live re-renders.
  const engine = engineRef.current;
  const version = useSyncExternalStore(
    engine ? engine.store.subscribe : NOOP_SUBSCRIBE,
    engine ? engine.store.getVersion : ZERO,
    ZERO,
  );
  void version; // participates in render so the snapshot below refreshes on every change
  void engineNonce; // re-render when a fresh engine is swapped in
  const snap = engine ? engine.store.snapshot() : EMPTY_SNAPSHOT;

  /** Build a brand-new engine wired to our state setters. Replaces any previous one. */
  const buildEngine = useCallback(
    (provider: Provider, model: string, mode: InputMode): RecorderEngine => {
      const eng = new RecorderEngine(
        provider,
        model,
        {
          onSourceStatus: (source, status) => setSourceStatus((s) => ({ ...s, [source]: status })),
          onRms: (source, level) => setLevels((l) => ({ ...l, [source]: level })),
          onError: (source, message) => {
            // Phone mode never arms system audio, so there's no share to nag about.
            if (source === "system" && mode === "pc") setSystemNeedsAttention(true);
            setError(message);
          },
          onPersistError: () => {
            setSaveWarning(true);
            setTimeout(() => setSaveWarning(false), 4000);
          },
        },
        { mode },
      );
      engineRef.current = eng;
      setEngineNonce((n) => n + 1);
      return eng;
    },
    [],
  );

  const start = useCallback(
    async (requestedMode?: InputMode) => {
      setError(null);
      setNotReady(null);
      setSystemNeedsAttention(false);
      setSourceStatus(IDLE_STATUS);
      setLevels({ mic: 0, system: 0 });
      setElapsedMs(0);
      setSpeakersSwapped(false);

      // No explicit mode (e.g. the compact widget's Record button) → whatever was used last.
      const mode: InputMode = requestedMode ?? getSavedInputMode();
      saveInputMode(mode);

      // Fetch settings at start time so a mid-session settings change never bites a running engine.
      let provider: Provider;
      let model: string;
      let settings: ClientSettings;
      try {
        const res = await fetch("/api/settings");
        if (!res.ok) throw new Error("Could not load settings");
        settings = (await res.json()) as ClientSettings;
        provider = settings.provider;
        model = settings.model;
      } catch (err) {
        setState("idle");
        setError(describeError(err));
        return;
      }

      // Phone mode ignores the configured provider — Deepgram is the only one that diarizes.
      if (mode === "phone") {
        provider = "deepgram";
        model = settings.modelByProvider.deepgram;
      }

      // Preflight: don't prompt for the mic or create a session if transcription can't run yet — a
      // local model that hasn't been downloaded, or a cloud provider with no API key.
      if (mode === "phone") {
        // A missing key here is a mode problem, not a setup problem — modal, not toast. The home
        // page catches this earlier when the card is picked; this covers the widget's Record.
        if (!settings.keys.deepgram.hasKey) {
          setState("idle");
          setDeepgramKeyMissing(true);
          return;
        }
      } else {
        const ready =
          provider === "local" ? await isLocalModelReady(model) : settings.keys[provider].hasKey;
        if (!ready) {
          setState("idle");
          setNotReady(SETUP_REQUIRED_MESSAGE);
          return;
        }
      }

      setActive({ provider, model });
      setActiveMode(mode);
      const engine = buildEngine(provider, model, mode);
      setState("arming");
      try {
        await engine.createSession();
        setSessionId(engine.currentSessionId);
        // Mic is required — a denial aborts back to idle.
        await engine.armMic();
      } catch (err) {
        setState("idle");
        setActiveMode(null);
        setError(describeError(err));
        return;
      }
      // Mic is live; enter live state now.
      startedAtRef.current = Date.now();
      setState("live");
      // Phone mode is mic-only: the other voice comes through the room, not the sound card.
      if (mode === "phone") return;
      try {
        await engine.armSystem();
      } catch (err) {
        // System is optional to *enter* live — surface it for retry, keep mic running.
        setSystemNeedsAttention(true);
        setError(describeError(err));
      }
    },
    [buildEngine],
  );

  const resumeSystem = useCallback(async () => {
    setError(null);
    const engine = engineRef.current;
    if (!engine) return;
    try {
      await engine.resumeSystem();
      setSystemNeedsAttention(false);
    } catch (err) {
      setSystemNeedsAttention(true);
      setError(describeError(err));
    }
  }, []);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    if (!engine) return;
    await engine.stop();
    const finishedId = engine.currentSessionId;
    setState("stopped");
    setLevels({ mic: 0, system: 0 });
    // If the user stopped while compact, stay compact — they'll expand when they're ready.
    // (The resize effect shrinks the window back to idle height as state leaves "live".)
    // Only when already on the dashboard do we make sure the OS window is un-compacted.
    if (viewMode !== "compact") {
      await getWindowAdapter().exitCompact().catch(() => {});
    }
    // Hand off to the Sessions page immediately — that's the home for reviewing a finished
    // recording, and it frees the Recorder page to go back to idle for the next one. (When
    // compact, this is queued behind the hidden dashboard and only shows once they expand.)
    router.push(finishedId ? `/sessions/${finishedId}` : "/sessions");
  }, [router, viewMode]);

  /**
   * Diarization picks which voice is "Me" from whoever speaks first, so it can land the wrong way
   * round. Flipping is purely a labelling change — the flag rides on the session so the detail
   * page and the export agree with what's on screen right now.
   */
  const toggleSpeakersSwapped = useCallback(() => {
    const next = !speakersSwapped;
    setSpeakersSwapped(next);
    if (!sessionId) return;
    void fetch(`/api/sessions/${sessionId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ speakersSwapped: next }),
    }).catch(() => {});
  }, [sessionId, speakersSwapped]);

  const dismissNotReady = useCallback(() => setNotReady(null), []);
  const dismissDeepgramKeyMissing = useCallback(() => setDeepgramKeyMissing(false), []);
  const reportDeepgramKeyMissing = useCallback(() => setDeepgramKeyMissing(true), []);

  /** Clear a finished recording so the Recorder page renders the idle/start view again. */
  const reset = useCallback(() => {
    setState((s) => (s === "stopped" ? "idle" : s));
    setSessionId(null);
    setError(null);
    setNotReady(null);
    setSystemNeedsAttention(false);
    setDeepgramKeyMissing(false);
    setSaveWarning(false);
    setElapsedMs(0);
    setActive(null);
    setActiveMode(null);
    setSpeakersSwapped(false);
    setSourceStatus(IDLE_STATUS);
    setLevels({ mic: 0, system: 0 });
    engineRef.current = null;
  }, []);

  // Keep the compact window sized to its content: short while idle, tall once a transcript shows.
  useEffect(() => {
    if (viewMode !== "compact") return;
    const height = isRecording(state) ? COMPACT_HEIGHT_RECORDING : COMPACT_HEIGHT_IDLE;
    void getWindowAdapter().resizeCompact(height).catch(() => {});
  }, [viewMode, state]);

  const enterCompact = useCallback(async () => {
    const pos = await getSavedCompactPosition().catch(() => null);
    setViewMode("compact");
    const height = isRecording(stateRef.current) ? COMPACT_HEIGHT_RECORDING : COMPACT_HEIGHT_IDLE;
    await getWindowAdapter().enterCompact(pos, height).catch(() => {});
  }, []);

  const exitCompact = useCallback(async () => {
    setViewMode("dashboard");
    await getWindowAdapter().exitCompact().catch(() => {});
  }, []);

  const value = useMemo<UseRecorder>(
    () => ({
      state,
      sessionId,
      sourceStatus,
      levels,
      elapsedMs,
      error,
      notReady,
      dismissNotReady,
      systemNeedsAttention,
      deepgramKeyMissing,
      reportDeepgramKeyMissing,
      dismissDeepgramKeyMissing,
      activeMode,
      speakersSwapped,
      toggleSpeakersSwapped,
      segments: snap.segments,
      interim: snap.interim,
      segmentCount: snap.segments.length,
      saveWarning,
      provider: active?.provider ?? null,
      model: active?.model ?? null,
      viewMode,
      start,
      resumeSystem,
      stop,
      reset,
      enterCompact,
      exitCompact,
    }),
    [
      state,
      sessionId,
      sourceStatus,
      levels,
      elapsedMs,
      error,
      notReady,
      dismissNotReady,
      systemNeedsAttention,
      deepgramKeyMissing,
      reportDeepgramKeyMissing,
      dismissDeepgramKeyMissing,
      activeMode,
      speakersSwapped,
      toggleSpeakersSwapped,
      snap,
      saveWarning,
      active,
      viewMode,
      start,
      resumeSystem,
      stop,
      reset,
      enterCompact,
      exitCompact,
    ],
  );

  return (
    <RecorderContext.Provider value={value}>
      {children}
      {/* Mounted here (not on the home page) so the compact widget's Record button gets it too. */}
      <DeepgramKeyModal open={deepgramKeyMissing} onClose={dismissDeepgramKeyMissing} />
    </RecorderContext.Provider>
  );
}

function describeError(err: unknown): string {
  if (err instanceof NoAudioTrackError || err instanceof PermissionDeniedError) return err.message;
  return (err as Error)?.message ?? "Something went wrong.";
}
