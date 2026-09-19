import type { InputMode } from "@/lib/types";

/**
 * Last-used input mode, remembered in localStorage so the recorder home opens on whatever the
 * user recorded with last and the compact widget's Record button can start without asking.
 *
 * Unlike the compact-widget position this stays client-side: it's a UI preference, it doesn't
 * need to survive a reinstall, and reading it has to be synchronous for the first paint.
 */

const KEY = "mt.inputMode";

export function getSavedInputMode(): InputMode {
  if (typeof window === "undefined") return "pc";
  try {
    return window.localStorage.getItem(KEY) === "phone" ? "phone" : "pc";
  } catch {
    return "pc";
  }
}

export function saveInputMode(mode: InputMode): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* private mode / storage disabled — the default is fine */
  }
}
