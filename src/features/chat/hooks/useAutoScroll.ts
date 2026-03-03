// Hook: useAutoScroll — smart auto-scroll for message lists

import { useRef, useCallback, useEffect } from "react";

interface UseAutoScrollOptions {
  /** Distance from bottom (px) to consider "at bottom" */
  threshold?: number;
  /** Dependencies that trigger a scroll check */
  deps?: unknown[];
}

/**
 * Provides a ref for the scroll container and auto-scrolls to bottom
 * when new content arrives — but only if the user was already at the bottom.
 */
export function useAutoScroll<T extends HTMLElement = HTMLDivElement>(
  options: UseAutoScrollOptions = {},
) {
  const { threshold = 100, deps = [] } = options;
  const containerRef = useRef<T>(null);
  const isAtBottomRef = useRef(true);

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
      isAtBottomRef.current = checkIsAtBottom();
    };

    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [checkIsAtBottom]);

  /** Auto-scroll when deps change (new messages / streaming delta) */
  useEffect(() => {
    if (isAtBottomRef.current) {
      scrollToBottom("smooth");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return {
    containerRef,
    scrollToBottom,
    isAtBottom: checkIsAtBottom,
  };
}
