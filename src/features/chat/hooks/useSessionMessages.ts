// Hook: useSessionMessages — fetches message history for a session

import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { ChatMessage } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { useEffect, useRef } from "react";

/** Query key for session messages */
export function messagesQueryKey(sessionKey: string) {
  return ["session-messages", sessionKey] as const;
}

/**
 * Fetch initial message history for a session.
 * Tries `chat.history` first, falls back to `sessions.preview`.
 * Syncs fetched messages into the Zustand chat store.
 */
export function useSessionMessages(sessionKey: string | null) {
  const isConnected = useConnectionStore((s) => s.state === "connected");
  const syncedRef = useRef<{ sessionKey: string | null; dataRef: unknown }>({
    sessionKey: null,
    dataRef: null,
  });

  const query = useQuery<ChatMessage[]>({
    queryKey: messagesQueryKey(sessionKey ?? ""),
    queryFn: async () => {
      if (!sessionKey) return [];

      try {
        // Try chat.history first (server expects `sessionKey`)
        const res = await gateway.request<unknown>("chat.history", {
          sessionKey,
        });

        return extractMessages(res);
      } catch {
        // Fallback: sessions.preview (server expects `keys` array)
        try {
          const res = await gateway.request<unknown>("sessions.preview", {
            keys: [sessionKey],
          });

          // sessions.preview may return a map { [key]: messages } or array
          return extractPreviewMessages(res, sessionKey);
        } catch (e) {
          console.warn("[useSessionMessages] Failed to fetch messages:", e);
          return [];
        }
      }
    },
    enabled: isConnected && sessionKey !== null,
    staleTime: 0,
  });

  // Sync fetched messages into Zustand store — guarded to prevent loops
  useEffect(() => {
    if (
      sessionKey &&
      query.data &&
      (syncedRef.current.sessionKey !== sessionKey ||
        syncedRef.current.dataRef !== query.data)
    ) {
      syncedRef.current = { sessionKey, dataRef: query.data };
      useChatStore.getState().setMessages(sessionKey, query.data);
    }
  }, [sessionKey, query.data]);

  return query;
}

/** Extract messages from chat.history response */
function extractMessages(res: unknown): ChatMessage[] {
  if (Array.isArray(res)) return res as ChatMessage[];
  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;
    for (const key of ["messages", "items", "data", "history"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return obj[key] as ChatMessage[];
      }
    }
  }
  return [];
}

/** Extract messages from sessions.preview response (may be keyed by sessionKey) */
function extractPreviewMessages(
  res: unknown,
  sessionKey: string,
): ChatMessage[] {
  // Direct array
  if (Array.isArray(res)) return res as ChatMessage[];

  if (res && typeof res === "object") {
    const obj = res as Record<string, unknown>;

    // Keyed by sessionKey: { "agent:main:main": { messages: [...] } }
    if (sessionKey in obj) {
      const sessionData = obj[sessionKey];
      if (Array.isArray(sessionData)) return sessionData as ChatMessage[];
      if (sessionData && typeof sessionData === "object") {
        return extractMessages(sessionData);
      }
    }

    // Standard extraction
    return extractMessages(res);
  }

  return [];
}
