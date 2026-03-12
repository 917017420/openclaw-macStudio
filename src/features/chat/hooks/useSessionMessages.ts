import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { ChatMessage } from "@/lib/gateway";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import {
  extractMessagesFromResponse,
  mergeServerWithLocal,
} from "@/features/chat/utils/message-pipeline";

export function messagesQueryKey(sessionKey: string) {
  return ["session-messages", sessionKey] as const;
}

function isMethodUnavailableError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return (
    msg.includes("unknown method") ||
    msg.includes("not found") ||
    msg.includes("unsupported")
  );
}

function isTransientTimeoutError(error: unknown): boolean {
  const msg = String(error).toLowerCase();
  return msg.includes("timeout") || msg.includes("rpc timeout");
}

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
        const historyRes = await gateway.request<unknown>("chat.history", { sessionKey });
        return extractMessagesFromResponse(historyRes, sessionKey);
      } catch (error) {
        if (isTransientTimeoutError(error)) {
          throw error;
        }
        // Only fallback to preview when history method truly unavailable.
        if (!isMethodUnavailableError(error)) {
          throw error;
        }
        try {
          const previewRes = await gateway.request<unknown>("sessions.preview", {
            keys: [sessionKey],
          });
          return extractMessagesFromResponse(previewRes, sessionKey);
        } catch (previewError) {
          throw previewError;
        }
      }
    },
    enabled: isConnected && sessionKey !== null,
    staleTime: 0,
  });

  useEffect(() => {
    if (
      !sessionKey ||
      !query.data ||
      (syncedRef.current.sessionKey === sessionKey &&
        syncedRef.current.dataRef === query.data)
    ) {
      return;
    }

    syncedRef.current = { sessionKey, dataRef: query.data };
    const store = useChatStore.getState();
    const currentMessages = store.messagesBySession[sessionKey] ?? [];
    const serverMessages = query.data;

    if (serverMessages.length === 0 && currentMessages.length > 0) {
      return;
    }

    const merged = mergeServerWithLocal(serverMessages, currentMessages);
    if (merged === currentMessages) {
      return;
    }
    store.setMessages(sessionKey, merged);
  }, [query.data, sessionKey]);

  return query;
}
