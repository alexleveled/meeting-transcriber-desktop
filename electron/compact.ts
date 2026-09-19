import { ipcMain, screen, type BrowserWindow } from "electron";

/**
 * Compact-mode window control + custom title-bar controls, all IPC-driven from the renderer.
 * The DB stays single-owner: main NEVER touches SQLite. While compact, main forwards the window's
 * `moved` events to the renderer (`window:moved`), which debounces and persists x/y through the
 * settings REST API. On the next enterCompact() the renderer passes the saved position back in.
 */

const COMPACT_WIDTH = 380;
const COMPACT_HEIGHT = 520; // recording (transcript visible)

interface CompactPosition {
  x: number;
  y: number;
}

interface CompactEnterArg {
  pos: CompactPosition | null;
  height: number | null;
}

/** Keep a rectangle on a real display so a disconnected monitor can't strand the window. */
function clampToDisplay(bounds: Electron.Rectangle): Electron.Rectangle {
  const display = screen.getDisplayMatching(bounds) ?? screen.getPrimaryDisplay();
  const wa = display.workArea;
  const width = Math.min(bounds.width, wa.width);
  const height = Math.min(bounds.height, wa.height);
  const x = Math.min(Math.max(bounds.x, wa.x), wa.x + wa.width - width);
  const y = Math.min(Math.max(bounds.y, wa.y), wa.y + wa.height - height);
  return { x, y, width, height };
}

export function registerWindowIpc(win: BrowserWindow): void {
  // Dashboard bounds are stashed in-memory here so exit restores the exact prior geometry.
  let dashboardBounds: Electron.Rectangle | null = null;
  let moveForwarder: (() => void) | null = null;

  ipcMain.handle("compact:enter", (_e, arg: CompactEnterArg | null) => {
    const pos = arg?.pos ?? null;
    const height = arg?.height ?? COMPACT_HEIGHT;
    dashboardBounds = win.getBounds();
    if (win.isMaximized()) win.unmaximize();

    win.setMinimumSize(320, 140);

    // Default the widget to the top-right of the current display if no saved position.
    const display = screen.getDisplayMatching(win.getBounds());
    const wa = display.workArea;
    const target = clampToDisplay({
      x: pos?.x ?? wa.x + wa.width - COMPACT_WIDTH - 24,
      y: pos?.y ?? wa.y + 24,
      width: COMPACT_WIDTH,
      height,
    });

    win.setResizable(false);
    win.setBounds(target); // `animate` is macOS-only; instant snap on Windows is fine
    win.setAlwaysOnTop(true, "floating");

    // Forward live moves so the renderer can persist the position (debounced there).
    if (!moveForwarder) {
      const onMoved = () => {
        const b = win.getBounds();
        win.webContents.send("window:moved", { x: b.x, y: b.y });
      };
      win.on("moved", onMoved);
      moveForwarder = () => win.removeListener("moved", onMoved);
    }
  });

  // Grow/shrink the compact window in place (keeps x/y/width) — e.g. recording starts or stops.
  ipcMain.handle("compact:resize", (_e, height: number) => {
    const b = win.getBounds();
    win.setBounds(clampToDisplay({ x: b.x, y: b.y, width: COMPACT_WIDTH, height }));
  });

  ipcMain.handle("compact:exit", () => {
    if (moveForwarder) {
      moveForwarder();
      moveForwarder = null;
    }
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setMinimumSize(640, 480);
    if (dashboardBounds) {
      win.setBounds(clampToDisplay(dashboardBounds));
      dashboardBounds = null;
    }
  });

  // Custom title-bar controls (titleBarStyle: 'hidden', no native caption buttons).
  ipcMain.on("window:minimize", () => win.minimize());
  ipcMain.on("window:maximize-toggle", () => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.on("window:close", () => win.close());
}

/** Detach IPC handlers when the window is gone (single-window app, but keeps things tidy). */
export function unregisterWindowIpc(): void {
  ipcMain.removeHandler("compact:enter");
  ipcMain.removeHandler("compact:resize");
  ipcMain.removeHandler("compact:exit");
  ipcMain.removeAllListeners("window:minimize");
  ipcMain.removeAllListeners("window:maximize-toggle");
  ipcMain.removeAllListeners("window:close");
}
