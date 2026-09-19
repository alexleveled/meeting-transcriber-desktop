import { app, utilityProcess, type UtilityProcess } from "electron";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { join } from "node:path";

/**
 * Runs the standalone Next server (.next/standalone/server.js, shipped via extraResources at
 * resources/app-server/) inside an Electron-managed utilityProcess. utilityProcess runs Electron's
 * embedded Node — which is why better-sqlite3 is swapped to Electron's ABI at packaging time.
 *
 * The child is auto-killed with the app, its stdio is piped for log capture, and an `exit` event
 * triggers a single restart attempt (step: crash resilience). Main picks a free port so there's
 * never a collision with a dev server or a second instance.
 */

export interface ServerHandle {
  port: number;
  child: UtilityProcess;
  shutdown(): void;
}

/** Bind :0 to let the OS hand us a guaranteed-free port, then release it for the child. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close();
        reject(new Error("Could not determine a free port"));
      }
    });
  });
}

function serverEntry(): string {
  return join(process.resourcesPath, "app-server", "server.js");
}

function dbPath(): string {
  return join(app.getPath("userData"), "data", "transcriber.db");
}

/** whisper.cpp binaries ship as extraResources under resources/whisper. */
function whisperBinDir(): string {
  return join(process.resourcesPath, "whisper");
}

/** Downloaded ggml models live in userData (kept out of the installer). */
function modelsDir(): string {
  return join(app.getPath("userData"), "models");
}

async function pollHealth(port: number, timeoutMs = 20000): Promise<void> {
  const url = `http://127.0.0.1:${port}/api/health`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* server not up yet */
    }
    if (Date.now() > deadline) throw new Error("Server did not become healthy in time");
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Kill the server AND everything it spawned.
 *
 * whisper-server.exe is spawned by the Next server, so it is a child of this utilityProcess.
 * utilityProcess.kill() terminates only that process — and a hard terminate skips Node's
 * `process.on("exit")`, so the manager's own whisper cleanup never runs either. The orphan then
 * keeps an open handle on resources/whisper/ inside the install directory, which makes the NEXT
 * installer fail with the thoroughly misleading "Meeting Transcriber cannot be closed. Please close
 * it manually." — with nothing by that name in the task list for the user to close.
 *
 * taskkill /T walks the whole tree, so the orphan cannot outlive us. Returns false if it could not
 * run, so the caller can fall back to a plain kill().
 */
function killTree(pid: number | undefined): boolean {
  if (pid === undefined || process.platform !== "win32") return false;
  try {
    execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], {
      stdio: "ignore",
      timeout: 5000,
      windowsHide: true,
    });
    return true;
  } catch {
    return false; // already exited, or taskkill unavailable
  }
}

function fork(port: number): UtilityProcess {
  const child = utilityProcess.fork(serverEntry(), [], {
    stdio: "pipe",
    env: {
      ...process.env,
      PORT: String(port),
      HOSTNAME: "127.0.0.1",
      NODE_ENV: "production",
      TRANSCRIBER_DB_PATH: dbPath(),
      WHISPER_BIN_DIR: whisperBinDir(),
      TRANSCRIBER_MODELS_DIR: modelsDir(),
    },
  });
  child.stdout?.on("data", (d) => process.stdout.write(`[server] ${d}`));
  child.stderr?.on("data", (d) => process.stderr.write(`[server] ${d}`));
  return child;
}

/**
 * Start the server on a free port, wait for readiness, and wire a one-shot crash restart.
 * `onFatal` fires if the server dies and cannot be brought back.
 */
export async function startServer(onFatal: (msg: string) => void): Promise<ServerHandle> {
  const port = await findFreePort();
  let child = fork(port);
  let shuttingDown = false;
  let restarted = false;

  const onExit = (code: number) => {
    if (shuttingDown) return;
    if (!restarted) {
      restarted = true;
      process.stderr.write(`[server] exited (code ${code}); restarting once…\n`);
      child = fork(port);
      child.once("exit", onExit);
      pollHealth(port).catch(() => onFatal("The transcription server stopped and could not restart."));
    } else {
      onFatal("The transcription server crashed repeatedly.");
    }
  };
  child.once("exit", onExit);

  await pollHealth(port);

  return {
    port,
    get child() {
      return child;
    },
    shutdown() {
      shuttingDown = true;
      // Tree kill first so whisper-server.exe cannot be orphaned; plain kill only as a fallback.
      if (!killTree(child.pid)) {
        try {
          child.kill();
        } catch {
          /* already gone */
        }
      }
    },
  };
}
