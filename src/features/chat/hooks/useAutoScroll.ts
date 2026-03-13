// Hook: useAutoScroll — smart auto-scroll for message lists

import { useRef, useCallback, useEffect, useLayoutEffect, useState } from "react";

interface UseAutoScrollOptions {
  /** Distance from bottom (px) to consider "at bottom" */
  threshold?: number;
  /** Dependencies that trigger a scroll check */
  deps?: unknown[];
  /** Current conversation/session key */
  sessionKey?: string | null;
  /** Whether the next session view is still loading */
  loading?: boolean;
}

/**
 * Provides a ref for the scroll container and auto-scrolls to bottom
 * when new content arrives — but only if the user was already at the bottom.
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: UseAutoScrollOptions = {},
) {
  const { threshold = 100, deps = [], sessionKey = null, loading = false } = options;
  const containerRef = useRef<T>(null);
  const isAtBottomRef = useRef(true);
  const scrollPositionsRef = useRef<Map<string, number>>(new Map());
  const previousSessionKeyRef = useRef<string | null>(sessionKey);
  const pendingRestoreSessionKeyRef = useRef<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);

  const saveScrollPosition = useCallback(
    (key: string | null, top?: number) => {
      if (!key) {
        return;
      }
      const el = containerRef.current;
      if (!el) {
        return;
      }
      const nextTop = top ?? el.scrollTop;
      const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
      scrollPositionsRef.current.set(key, Math.min(Math.max(0, nextTop), maxScrollTop));
    },
    [],
  );

  /** Check if scrolled to (near) bottom */
  const checkIsAtBottom = useCallback(() => {
    const el = containerRef.current;
    if (!el) return true;
    const { scrollTop, scrollHeight, clientHeight } = el;
    return scrollHeight - scrollTop - clientHeight < threshold;
  }, [threshold]);

  /** Scroll to the very bottom */
  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = containerRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  /** Track scroll position */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const handleScroll = () => {
      const next = checkIsAtBottom();
      isAtBottomRef.current = next;
      setIsNearBottom(next);
      saveScrollPosition(previousSessionKeyRef.current);
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();
    return () => el.removeEventListener("scroll", handleScroll);
  }, [checkIsAtBottom, saveScrollPosition]);

  useEffect(() => {
    if (previousSessionKeyRef.current !== sessionKey) {
      pendingRestoreSessionKeyRef.current = sessionKey;
      previousSessionKeyRef.current = sessionKey;
      isAtBottomRef.current = true;
      setIsNearBottom(true);
    }
  }, [sessionKey]);

  /** Auto-scroll when deps change (new messages / streaming delta) */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) {
      return;
    }

    if (pendingRestoreSessionKeyRef.current === sessionKey) {
      if (loading) {
        return;
      }

      const savedScrollTop = sessionKey ? scrollPositionsRef.current.get(sessionKey) : undefined;
      if (typeof savedScrollTop === "number") {
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(Math.max(0, savedScrollTop), maxScrollTop);
      } else if (el.scrollHeight > el.clientHeight) {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = 0;
      }

      const next = checkIsAtBottom();
      isAtBottomRef.current = next;
      setIsNearBottom(next);
      saveScrollPosition(sessionKey);
      pendingRestoreSessionKeyRef.current = null;
      return;
    }

    if (isAtBottomRef.current) {
      scrollToBottom("auto");
      saveScrollPosition(sessionKey, el.scrollTop);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionKey, loading, checkIsAtBottom, saveScrollPosition, scrollToBottom, ...deps]);

  return {
    containerRef,
    scrollToBottom,
    isAtBottom: checkIsAtBottom,
    isNearBottom,
  };
}
