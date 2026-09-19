import { contextBridge, ipcRenderer } from "electron";

/**
 * Preload — the ONLY bridge between the sandboxed renderer and the main process. Runs with
 * contextIsolation on / nodeIntegration off / sandbox on, so it exposes a tiny, explicit API on
 * `window.desktopBridge` (mirrored by the WindowAdapter's DesktopBridge interface in
 * src/lib/window-adapter.ts). No Node globals leak into the page.
 */

interface CompactPosition {
  x: number;
  y: number;
}

const desktopBridge = {
  isElectron: true as const,

  enterCompact: (pos?: CompactPosition, height?: number): Promise<void> =>
    ipcRenderer.invoke("compact:enter", { pos: pos ?? null, height: height ?? null }),

  resizeCompact: (height: number): Promise<void> =>
    ipcRenderer.invoke("compact:resize", height),

  exitCompact: (): Promise<void> => ipcRenderer.invoke("compact:exit"),

  /** Live window position while compact. Returns an unsubscribe. */
  onWindowMoved: (cb: (pos: CompactPosition) => void): (() => void) => {
    const listener = (_: unknown, pos: CompactPosition) => cb(pos);
    ipcRenderer.on("window:moved", listener);
    return () => ipcRenderer.removeListener("window:moved", listener);
  },

  windowControls: {
    minimize: () => ipcRenderer.send("window:minimize"),
    maximizeToggle: () => ipcRenderer.send("window:maximize-toggle"),
    close: () => ipcRenderer.send("window:close"),
  },

  updates: {
    /** The running app's version — the "you have X" half of the Settings panel. */
    version: (): Promise<string> => ipcRenderer.invoke("updates:version"),
    /** Current state, so a freshly-mounted panel reflects the quiet check made at startup. */
    state: (): Promise<unknown> => ipcRenderer.invoke("updates:state"),
    check: (): Promise<unknown> => ipcRenderer.invoke("updates:check"),
    download: (): Promise<unknown> => ipcRenderer.invoke("updates:download"),
    install: (): Promise<unknown> => ipcRenderer.invoke("updates:install"),
    /** Progress and transitions pushed from main. Returns an unsubscribe. */
    onState: (cb: (s: unknown) => void): (() => void) => {
      const listener = (_: unknown, s: unknown) => cb(s);
      ipcRenderer.on("updates:state", listener);
      return () => ipcRenderer.removeListener("updates:state", listener);
    },
  },
};

contextBridge.exposeInMainWorld("desktopBridge", desktopBridge);
