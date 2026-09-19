import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { cpus } from "node:os";
import { env } from "../env";
import { isDownloaded, isKnownModel, modelPath } from "./models";

/**
 * Supervises a single whisper.cpp `whisper-server.exe` child that both the mic and system streams
 * share. The server loads the model once (seconds for small) and serves HTTP /inference; the Node
 * side serializes requests through a FIFO queue so the two streams never run concurrent inferences
 * (which would thrash the CPU and both fall behind). The process is killed after an idle period and
 * on process exit. Cached on globalThis so Next dev HMR doesn't spawn duplicates.
 */

export interface WhisperSegment {
  /** seconds from the start of the submitted window */
  start: number;
  end: number;
  text: string;
}

export interface WhisperResult {
  text: string;
  segments: WhisperSegment[];
}

const IDLE_KILL_MS = 10 * 60 * 1000;
const READY_TIMEOUT_MS = 90_000;

interface ManagerState {
  child: ChildProcess | null;
  port: number;
  model: string | null;
  starting: Promise<void> | null;
  queue: Promise<unknown>;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

const g = globalThis as unknown as { __whisperMgr?: ManagerState };
const state: ManagerState =
  g.__whisperMgr ??
  (g.__whisperMgr = { child: null, port: 0, model: null, starting: null, queue: Promise.resolve(), idleTimer: null });

function serverBinary(): string {
  return resolve(process.cwd(), join(env.whisperBinDir, "whisper-server.exe"));
}

export function serverBinaryExists(): boolean {
  return existsSync(serverBinary());
}

function findFreePort(): Promise<number> {
  return new Promise((res, rej) => {
    const srv = createServer();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => res(port));
      } else {
        srv.close();
        rej(new Error("Could not find a free port for whisper-server"));
      }
    });
  });
}

function threadCount(): number {
  return Math.max(2, cpus().length - 2);
}

function clearIdleTimer() {
  if (state.idleTimer) {
    clearTimeout(state.idleTimer);
    state.idleTimer = null;
  }
}

function armIdleTimer() {
  clearIdleTimer();
  state.idleTimer = setTimeout(() => stop(), IDLE_KILL_MS);
  // Don't keep the event loop alive just for the idle timer.
  state.idleTimer.unref?.();
}

export function stop(): void {
  clearIdleTimer();
  if (state.child) {
    try {
      state.child.kill();
    } catch {
      /* already gone */
    }
  }
  state.child = null;
  state.model = null;
  state.starting = null;
}

async function pollReady(port: number): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  const url = `http://127.0.0.1:${port}/`;
  for (;;) {
    try {
      const res = await fetch(url);
      // Any HTTP response means the server bound the port and finished loading the model.
      if (res.status > 0) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) throw new Error("whisper-server did not become ready in time");
    await new Promise((r) => setTimeout(r, 300));
  }
}

async function spawnServer(model: string): Promise<void> {
  if (!serverBinaryExists()) {
    throw new Error(
      "whisper-server.exe is missing. Run `node scripts/fetch-whisper.mjs` (dev) or reinstall the app.",
    );
  }
  const port = await findFreePort();
  const child = spawn(
    serverBinary(),
    [
      "-m",
      modelPath(model),
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "-t",
      String(threadCount()),
      "-l",
      "en",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  state.child = child;
  state.port = port;
  state.model = model;

  child.on("exit", () => {
    // If the active child dies, clear state so the next request respawns it.
    if (state.child === child) {
      state.child = null;
      state.model = null;
    }
  });

  await pollReady(port);
}

/** Ensure a server is running for `model`, (re)starting if a different model was loaded. */
export async function ensureRunning(model: string): Promise<void> {
  if (!isKnownModel(model)) throw new Error(`Unknown local model: ${model}`);
  if (!isDownloaded(model)) throw new Error(`Model not downloaded: ${model}`);

  clearIdleTimer();

  if (state.child && state.model === model) return;
  if (state.starting && state.model === model) return state.starting;

  // Wrong model (or nothing) running — (re)spawn.
  if (state.child && state.model !== model) stop();

  state.starting = spawnServer(model).finally(() => {
    state.starting = null;
  });
  return state.starting;
}

async function inference(wav: Buffer, language: string): Promise<WhisperResult> {
  const form = new FormData();
  form.append("file", new Blob([wav as unknown as BlobPart], { type: "audio/wav" }), "audio.wav");
  form.append("response_format", "verbose_json");
  form.append("temperature", "0");
  form.append("language", language || "en");

  const res = await fetch(`http://127.0.0.1:${state.port}/inference`, { method: "POST", body: form });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`whisper-server /inference failed (HTTP ${res.status}): ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as {
    text?: string;
    segments?: Array<{ start?: number; end?: number; text?: string }>;
  };
  const segments: WhisperSegment[] = (data.segments ?? [])
    .map((s) => ({ start: Number(s.start) || 0, end: Number(s.end) || 0, text: (s.text ?? "").trim() }))
    .filter((s) => s.text.length > 0);
  return { text: (data.text ?? "").trim(), segments };
}

/**
 * Transcribe one WAV window. Requests are serialized (FIFO) across both audio streams so only one
 * inference runs at a time. `model` must already be running via ensureRunning().
 */
export function transcribe(wav: Buffer, language = "en"): Promise<WhisperResult> {
  const run = state.queue.then(() => inference(wav, language));
  // Keep the chain alive regardless of individual failures.
  state.queue = run.catch(() => undefined);
  run.finally(() => armIdleTimer());
  return run;
}

// Best-effort cleanup so we never leave an orphaned whisper-server behind. An orphan holds a handle
// on resources/whisper/ in the install directory, which breaks the next installer.
//
// "exit" only fires on a graceful teardown, and the packaged app is killed as a process tree
// (electron/server.ts killTree), which skips these entirely — that is the belt. These are the
// braces, and they are what actually runs in dev and on a plain SIGTERM.
process.once("exit", () => stop());
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
  process.once(signal, () => {
    stop();
    process.exit(0);
  });
}
