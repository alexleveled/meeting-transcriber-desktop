/**
 * Renderer-side client for in-app updates. Mirrors the IPC surface in electron/updater.ts the same
 * way WindowAdapter mirrors electron/preload.ts — nothing outside this file touches the bridge.
 *
 * In a plain browser (and in `npm run dev`) there is no shell to update, so getUpdateClient()
 * returns null and the Settings panel simply omits the section.
 */

/** Mirrors UpdateState in electron/updater.ts. Keep the two in step. */
export type UpdateState =
  | { status: "unsupported" }
  | { status: "idle" }
  | { status: "checking" }
  | { status: "current" }
  | { status: "available"; version: string; notes: string | null }
  | { status: "downloading"; version: string; percent: number }
  | { status: "ready"; version: string }
  | { status: "error"; message: string };

export interface UpdateClient {
  version(): Promise<string>;
  state(): Promise<UpdateState>;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  onState(cb: (s: UpdateState) => void): () => void;
}

/** The `updates` slice of window.desktopBridge, typed loosely because IPC returns `unknown`. */
interface UpdatesBridge {
  version(): Promise<string>;
  state(): Promise<unknown>;
  check(): Promise<unknown>;
  download(): Promise<unknown>;
  install(): Promise<unknown>;
  onState(cb: (s: unknown) => void): () => void;
}

function bridge(): UpdatesBridge | null {
  if (typeof window === "undefined") return null;
  const desktop = (window as { desktopBridge?: { updates?: UpdatesBridge } }).desktopBridge;
  return desktop?.updates ?? null;
}

/**
 * A build installed before this feature existed has a bridge with no `updates` slice, so callers
 * must handle null rather than assume Electron implies update support.
 */
export function getUpdateClient(): UpdateClient | null {
  const b = bridge();
  if (!b) return null;
  const asState = (v: unknown): UpdateState => (v as UpdateState) ?? { status: "idle" };
  return {
    version: () => b.version(),
    state: async () => asState(await b.state()),
    check: async () => asState(await b.check()),
    download: async () => asState(await b.download()),
    install: async () => asState(await b.install()),
    onState: (cb) => b.onState((s) => cb(asState(s))),
  };
}
