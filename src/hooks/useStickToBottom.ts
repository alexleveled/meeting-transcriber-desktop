import { useCallback, useEffect, useRef, useState } from "react";

/** How close to the bottom (px) still counts as "pinned" and keeps auto-following. */
const BOTTOM_THRESHOLD = 80;

/**
 * Keeps a scroll container pinned to the bottom as new content streams in — but only while the user
 * is already at (or near) the bottom. If they scroll up to read earlier content, auto-follow pauses
 * so their position is preserved, and `showJump` flips true so the caller can offer a "jump to
 * latest" control. Calling `scrollToBottom()` re-pins and resumes following.
 *
 * Pass the values that change when new content arrives as `deps` (e.g. segment count, interim text).
 */
export function useStickToBottom(deps: unknown[]) {
  const scrollRef = useRef<HTMLDivElement>(null);
  // Whether the user is currently pinned to the bottom. Ref (not state) so the scroll handler and
  // the streaming effect read the latest value without re-subscribing.
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const isNearBottom = useCallback((el: HTMLDivElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    pinnedRef.current = true;
    setShowJump(false);
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  // Track the user's intent: as they scroll, remember whether they're parked at the bottom.
  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const near = isNearBottom(el);
    pinnedRef.current = near;
    setShowJump(!near);
  }, [isNearBottom]);

  // Call before programmatically scrolling the container elsewhere (e.g. a citation jump) so the
  // next streaming update doesn't yank the view back to the bottom.
  const unpin = useCallback(() => {
    pinnedRef.current = false;
    setShowJump(true);
  }, []);

  // New content arrived — follow it only if the user hasn't scrolled away.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (pinnedRef.current) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
    } else {
      setShowJump(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { scrollRef, showJump, scrollToBottom, onScroll, unpin };
}
