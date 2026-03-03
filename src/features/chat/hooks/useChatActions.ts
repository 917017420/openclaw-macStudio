// Hook: useChatActions — sendMessage, abortStreaming, resetSession

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { createUserMessage } from "@/features/chat/utils";
import { uid } from "@/lib/utils";
import { sessionsQueryKey } from "./useSessions";
import { messagesQueryKey } from "./useSessionMessages";

/**
 * Provides action callbacks for sending messages, aborting streams,
 * and resetting sessions.
 */
export function useChatActions() {
  const queryClient = useQueryClient();

  /**
   * Send a chat message.
   * Immediately sets the session key so events can route correctly.
   */
  const sendMessage = useCallback(
    async (content: string) => {
      const {
        selectedAgentId,
        selectedSessionId,
        addMessage,
        setDraft,
        selectSession,
      } = useChatStore.getState();

      if (!selectedAgentId) {
        console.warn("[useChatActions] No agent selected");
        return;
      }

      const trimmed = content.trim();
      if (!trimmed) return;

      // Resolve session key — use existing or construct default
      const sessionKey = selectedSessionId ?? `agent:${selectedAgentId}:main`;

      // CRITICAL: Set selected session BEFORE sending so event handlers
      // can route incoming agent events to the correct session key
      if (!selectedSessionId) {
        selectSession(sessionKey);
      }

      // Optimistically add user message
      const userMsg = createUserMessage(trimmed);
      addMessage(sessionKey, userMsg);
      setDraft(sessionKey, "");

      // Build RPC params — server expects `sessionKey` + `idempotencyKey`
      const params: Record<string, unknown> = {
        sessionKey,
        message: trimmed,
        idempotencyKey: uid(),
      };

      console.log("[useChatActions] chat.send params:", params);

      try {
        const res = await gateway.request<unknown>("chat.send", params);
        console.log("[useChatActions] chat.send response:", res);

        // Refresh session list to pick up any new/updated sessions
        queryClient.invalidateQueries({
          queryKey: sessionsQueryKey(selectedAgentId),
        });
      } catch (err) {
        console.error("[useChatActions] Failed to send message:", err);
      }
    },
    [queryClient],
  );

  /**
   * Abort the current streaming response.
   */
  const abortStreaming = useCallback(async () => {
    const { selectedSessionId, stopStreaming } = useChatStore.getState();

    try {
      await gateway.request("chat.abort", {
        sessionKey: selectedSessionId,
      });
    } catch (err) {
      console.warn("[useChatActions] Abort failed:", err);
    }

    stopStreaming();
  }, []);

  /**
   * Reset (clear) a session's messages on the server.
   */
  const resetSession = useCallback(
    async (sessionKey: string) => {
      try {
        await gateway.request("sessions.reset", { sessionKey });
        useChatStore.getState().clearSession(sessionKey);
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
      } catch (err) {
        console.error("[useChatActions] Reset session failed:", err);
      }
    },
    [queryClient],
  );

  /**
   * Delete a session from the server.
   */
  const deleteSession = useCallback(
    async (sessionKey: string) => {
      try {
        await gateway.request("sessions.delete", { sessionKey });
        const state = useChatStore.getState();
        state.clearSession(sessionKey);

        if (state.selectedSessionId === sessionKey) {
          state.selectSession(null);
        }

        queryClient.invalidateQueries({
          queryKey: sessionsQueryKey(state.selectedAgentId ?? undefined),
        });
      } catch (err) {
        console.error("[useChatActions] Delete session failed:", err);
      }
    },
    [queryClient],
  );

  return {
    sendMessage,
    abortStreaming,
    resetSession,
    deleteSession,
  };
}
