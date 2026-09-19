const HIGHLIGHT_MS = 2000;

/**
 * Briefly flashes the `.seg-highlight` treatment (see globals.css) on an element, e.g. after a
 * citation jump scrolls a transcript row into view. Framework-free so it can be shared between the
 * page-scrolled finished-session view and the live recorder's inner scroll container.
 */
export function highlightSegment(el: HTMLElement) {
  el.classList.add("seg-highlight");
  window.setTimeout(() => el.classList.remove("seg-highlight"), HIGHLIGHT_MS);
}
