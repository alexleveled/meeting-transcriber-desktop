import { app, ipcMain, type BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * In-app updates.
 *
 * The installer lives on a GitHub Release. electron-builder bakes the `publish` block from
 * electron-builder.yml into the packaged app (resources/app-update.yml), so electron-updater's
 * `github` provider already knows where to look. The app ships no credentials of any kind.
 *
 * Downloads are deliberately NOT automatic: this is a metered-connection-unfriendly ~105 MB app,
 * and the user asks for the update explicitly. electron-updater still fetches only the changed
 * blocks when it can match the installed version's blockmap, so a small release is a small
 * download.
 *
 * The build is unsigned (no code-signing certificate), so installing an update raises the same
 * Windows SmartScreen prompt as the original install. Nothing here can suppress that — only a
 * certificate can.
 */

/** Sent to the renderer on every transition; the Settings UI renders straight off this. */
export type UpdateState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; notes: string | null }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

let state: UpdateState = { status: "idle" };
let targetWindow: BrowserWindow | null = null;

function publish(next: UpdateState): void {
  state = next;
  if (targetWindow && !targetWindow.isDestroyed()) {
    targetWindow.webContents.send("updates:state", next);
  }
}

/**
 * electron-updater refuses to run unpackaged (there is no installer to replace), and throwing that
 * error into the UI on every dev run is just noise. `unsupported` lets the Settings panel say so
 * plainly instead of showing a broken button.
 */
function supported(): boolean {
  return app.isPackaged;
}

/** Release notes arrive as a string or as a list of {version, note}; flatten to plain text. */
function notesToText(notes: unknown): string | null {
  if (typeof notes === "string") return notes.trim() || null;
  if (Array.isArray(notes)) {
    const joined = notes
      .map((n) => (typeof n === "string" ? n : ((n as { note?: string })?.note ?? "")))
      .filter(Boolean)
      .join("\n\n")
      .trim();
    return joined || null;
  }
  return null;
}

export function registerUpdaterIpc(win: BrowserWindow, log: (msg: string) => void): void {
  targetWindow = win;

  ipcMain.handle("updates:version", () => app.getVersion());
  ipcMain.handle("updates:state", () => state);

  if (!supported()) {
    state = { status: "unsupported" };
    ipcMain.handle("updates:check", () => state);
    ipcMain.handle("updates:download", () => state);
    ipcMain.handle("updates:install", () => state);
    return;
  }

  // Updating is a convenience; recording a meeting is the product. If electron-updater cannot
  // initialise for any reason, that must degrade to a dead Settings panel, never to an app that
  // fails to open a window.
  try {
    configure(log);
  } catch (err) {
    log(`updater: setup failed: ${(err as Error).stack ?? String(err)}`);
    state = { status: "error", message: "Updates are unavailable in this build." };
    ipcMain.handle("updates:check", () => state);
    ipcMain.handle("updates:download", () => state);
    ipcMain.handle("updates:install", () => state);
    return;
  }

  ipcMain.handle("updates:check", async () => {
    publish({ status: "checking" });
    try {
      await autoUpdater.checkForUpdates();
    } catch (err) {
      // The error event above already published for most failures; this catches the ones that
      // reject before any event fires (DNS down, GitHub unreachable, rate limited).
      publish({ status: "error", message: (err as Error).message ?? "Update check failed." });
    }
    return state;
  });

  ipcMain.handle("updates:download", async () => {
    if (state.status !== "available") return state;
    publish({ status: "downloading", version: state.version, percent: 0 });
    try {
      await autoUpdater.downloadUpdate();
    } catch (err) {
      publish({ status: "error", message: (err as Error).message ?? "Download failed." });
    }
    return state;
  });

  ipcMain.handle("updates:install", () => {
    if (state.status !== "ready") return state;
    // isSilent=false so the NSIS UI (and its SmartScreen prompt) is visible rather than the app
    // appearing to hang; isForceRunAfter=true reopens the app once the installer finishes.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return state;
  });
}

/** Provider + event wiring, split out so registerUpdaterIpc can guard it in one place. */
function configure(log: (msg: string) => void): void {
  autoUpdater.autoDownload = false;
  // If the user downloads an update but never clicks Restart, apply it on the next quit rather
  // than making them repeat the download.
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m: unknown) => log(`updater: ${String(m)}`),
    warn: (m: unknown) => log(`updater warn: ${String(m)}`),
    error: (m: unknown) => log(`updater error: ${String(m)}`),
    debug: () => {},
  };

  autoUpdater.on("update-available", (info) => {
    publish({ status: "available", version: info.version, notes: notesToText(info.releaseNotes) });
  });
  autoUpdater.on("update-not-available", () => publish({ status: "current" }));
  autoUpdater.on("download-progress", (p) => {
    const version = "version" in state ? (state as { version: string }).version : app.getVersion();
    publish({ status: "downloading", version, percent: Math.round(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => publish({ status: "ready", version: info.version }));
  autoUpdater.on("error", (err) => {
    log(`updater error: ${err?.stack ?? err?.message ?? String(err)}`);
    publish({ status: "error", message: err?.message ?? "Update check failed." });
  });
}

/**
 * A quiet check shortly after launch, so an available update is already showing in Settings by the
 * time anyone goes looking. Failures here are silent by design — a laptop opened offline should
 * not greet the user with an error it can do nothing about.
 */
export function checkForUpdatesOnStartup(log: (msg: string) => void): void {
  if (!supported()) return;
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      log(`updater: startup check failed: ${(err as Error).message}`);
    });
  }, 8000);
}

/** Drop handlers with the window (mirrors unregisterWindowIpc in compact.ts). */
export function unregisterUpdaterIpc(): void {
  for (const channel of [
    "updates:version",
    "updates:state",
    "updates:check",
    "updates:download",
    "updates:install",
  ]) {
    ipcMain.removeHandler(channel);
  }
  autoUpdater.removeAllListeners();
  targetWindow = null;
}
