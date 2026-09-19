import { app, BrowserWindow, shell, dialog } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { installCaptureHandlers } from "./capture";
import { registerWindowIpc } from "./compact";
import { startServer, type ServerHandle } from "./server";
import { checkForUpdatesOnStartup, registerUpdaterIpc } from "./updater";

/** Append a line to userData/logs/main.log — a GUI app has no console, so this is our diagnostics. */
function log(msg: string): void {
  try {
    const dir = join(app.getPath("userData"), "logs");
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "main.log"), `${new Date().toISOString()} ${msg}\n`);
  } catch {
    /* logging must never crash boot */
  }
  process.stdout.write(`${msg}\n`);
}

/**
 * Electron main process. Two modes:
 *   • dev  (`npm run dev:electron`) — external `next dev` on :3000; we just load it (HMR intact).
 *   • packaged — fork the standalone Next server on a free port, wait for /api/health, load it.
 *
 * The window is frameless-looking via titleBarStyle:'hidden' (custom controls in React); Windows
 * keeps native resize borders + Snap Layouts. Zero-dialog capture handlers are installed before
 * the first window loads.
 */

const DEV_URL = "http://localhost:3000";

let mainWindow: BrowserWindow | null = null;
let server: ServerHandle | null = null;

function createWindow(startUrl: string): BrowserWindow {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    show: false,
    backgroundColor: "#0b1120",
    titleBarStyle: "hidden",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win.show());

  // External links open in the user's browser, never a new Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  win.webContents.on("did-fail-load", (_e, code, desc, url) =>
    log(`did-fail-load ${code} ${desc} ${url}`),
  );

  registerWindowIpc(win);
  registerUpdaterIpc(win, log);
  log(`loadURL ${startUrl}`);
  void win.loadURL(startUrl);
  return win;
}

async function boot(): Promise<void> {
  log(`boot: packaged=${app.isPackaged} resourcesPath=${process.resourcesPath}`);
  installCaptureHandlers();

  if (!app.isPackaged) {
    // Dev: the Next dev server is started by `concurrently`; just point at it.
    mainWindow = createWindow(DEV_URL);
    return;
  }

  try {
    log("starting server…");
    server = await startServer((msg) => {
      log(`server fatal: ${msg}`);
      dialog.showErrorBox("Meeting Transcriber", msg);
    });
    log(`server ready on port ${server.port}; creating window`);
    mainWindow = createWindow(`http://127.0.0.1:${server.port}`);
    checkForUpdatesOnStartup(log);
  } catch (err) {
    log(`boot failed: ${(err as Error).stack ?? (err as Error).message}`);
    dialog.showErrorBox(
      "Meeting Transcriber",
      `Could not start the transcription server.\n\n${(err as Error).message}`,
    );
    app.quit();
  }
}

// Single-instance lock — a second launch focuses the existing window instead of fighting for the
// port / corrupting the WAL DB.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => log("app ready"));
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(boot);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void boot();
  });
}

app.on("window-all-closed", () => {
  server?.shutdown();
  server = null;
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  server?.shutdown();
});
