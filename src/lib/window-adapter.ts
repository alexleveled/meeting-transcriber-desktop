/**
 * WindowAdapter — the single seam between the (portable) React view logic and real OS-window
 * manipulation. Compact mode is a *view* concern (which layout renders); this adapter is the
 * *window* concern (resize / always-on-top / position persistence). The browser build is a no-op
 * (view swap only); the Electron build drives a real BrowserWindow over IPC.
 *
 * Selection happens once, lazily, via getWindowAdapter(): if `window.desktopBridge` exists we're
 * inside Electron, otherwise the browser no-op. All Electron-specific renderer code lives behind
 * this interface — nothing else in src/ imports the bridge directly.
 */

export interface CompactPosition {
  x: number;
  y: number;
}

/** Compact widget dimensions. Idle (waiting to record) is short; recording adds the transcript. */
export const COMPACT_WIDTH = 380;
export const COMPACT_HEIGHT_RECORDING = 520;
export const COMPACT_HEIGHT_IDLE = 168;

export interface WindowAdapter {
  /** True in the Electron build; false in a plain browser. */
  readonly isElectron: boolean;
  /** Resize/float into the compact widget. `pos` is the remembered position; `height` the window height. */
  enterCompact(pos?: CompactPosition | null, height?: number): Promise<void>;
  /** Resize the compact window's height in place (e.g. when a recording starts/stops). */
  resizeCompact(height: number): Promise<void>;
  /** Restore the dashboard window. */
  exitCompact(): Promise<void>;
  /** Subscribe to live position changes while compact (Electron only). Returns an unsubscribe. */
  onWindowMoved(cb: (pos: CompactPosition) => void): () => void;
  windowControls: {
    minimize(): void;
    maximizeToggle(): void;
    close(): void;
  };
}

/** The IPC surface exposed by electron/preload.ts. Mirrors DesktopBridge there. */
interface DesktopBridge {
  isElectron: true;
  enterCompact(pos?: CompactPosition, height?: number): Promise<void>;
  resizeCompact(height: number): Promise<void>;
  exitCompact(): Promise<void>;
  onWindowMoved(cb: (pos: CompactPosition) => void): () => void;
  windowControls: { minimize(): void; maximizeToggle(): void; close(): void };
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
  }
}

/** Browser build: view swap only. No real window to move, so every window op is inert. */
class BrowserWindowAdapter implements WindowAdapter {
  readonly isElectron = false;
  async enterCompact(): Promise<void> {}
  async resizeCompact(): Promise<void> {}
  async exitCompact(): Promise<void> {}
  onWindowMoved(): () => void {
    return () => {};
  }
  windowControls = {
    minimize() {},
    maximizeToggle() {},
    close() {},
  };
}

/** Electron build: forward every call to the preload-exposed bridge. */
class ElectronWindowAdapter implements WindowAdapter {
  readonly isElectron = true;
  constructor(private readonly bridge: DesktopBridge) {}
  enterCompact(pos?: CompactPosition | null, height?: number): Promise<void> {
    return this.bridge.enterCompact(pos ?? undefined, height);
  }
  resizeCompact(height: number): Promise<void> {
    return this.bridge.resizeCompact(height);
  }
  exitCompact(): Promise<void> {
    return this.bridge.exitCompact();
  }
  onWindowMoved(cb: (pos: CompactPosition) => void): () => void {
    return this.bridge.onWindowMoved(cb);
  }
  get windowControls() {
    return this.bridge.windowControls;
  }
}

let cached: WindowAdapter | null = null;

/** True when running inside the Electron shell (preload bridge present). */
export function isElectron(): boolean {
  return typeof window !== "undefined" && "desktopBridge" in window && !!window.desktopBridge;
}

/** Lazily select and memoize the adapter for the current runtime. */
export function getWindowAdapter(): WindowAdapter {
  if (cached) return cached;
  if (isElectron()) {
    cached = new ElectronWindowAdapter(window.desktopBridge!);
  } else {
    cached = new BrowserWindowAdapter();
  }
  return cached;
}
