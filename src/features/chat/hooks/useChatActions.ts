// Hook: useChatActions — sendMessage, abortStreaming, resetSession
// Strategy: after chat.send, poll chat.history for the response
// (server does not push agent events to this client)

import { useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { ChatMessage, AssistantMessage } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { createUserMessage, createAssistantMessage } from "@/features/chat/utils";
import { uid } from "@/lib/utils";
import { sessionsQueryKey } from "./useSessions";
import { messagesQueryKey } from "./useSessionMessages";

/** Polling interval for chat.history */
const POLL_INTERVAL = 2000;
/** Max polling time before giving up */
const POLL_TIMEOUT = 120_000;
/** Stabilization: stop polling after N consecutive identical results */
const STABLE_COUNT = 3;

/**
 * Normalize a raw message from the server into our ChatMessage type.
 * The server may use different field names.
 */
function normalizeMessage(raw: Record<string, unknown>): ChatMessage | null {
  const role = (raw.role ?? raw.type) as string | undefined;
  if (!role) return null;

  const id = (raw.id ?? raw.messageId ?? raw.message_id ?? uid()) as string;
  const content = (raw.content ?? raw.text ?? raw.message ?? "") as string;
  const timestamp = (raw.timestamp ?? raw.ts ?? raw.created_at ?? Date.now()) as number;

  if (role === "user" || role === "human") {
    return { role: "user", id, content, timestamp };
  }

  if (role === "assistant" || role === "ai" || role === "bot") {
    return {
      role: "assistant",
      id,
      content,
      timestamp,
      isStreaming: false,
      reasoning: (raw.reasoning ?? raw.thinking) as string | undefined,
    } as AssistantMessage;
  }

  if (role === "system") {
    return { role: "system", id, content, timestamp };
  }

  if (role === "tool" || role === "tool_call") {
    return {
      role: "tool",
      id,
      toolName: (raw.toolName ?? raw.tool_name ?? raw.name ?? "unknown") as string,
      toolCallId: (raw.toolCallId ?? raw.tool_call_id ?? id) as string,
      input: raw.input ?? raw.arguments,
      output: raw.output ?? raw.result,
      status: (raw.status ?? "completed") as "started" | "completed" | "error",
      timestamp,
    };
  }

  return null;
}

/**
 * Extract messages from server response, trying multiple structures.
 */
function extractMessages(res: unknown): ChatMessage[] {
  if (!res) return [];

  // Direct array
  if (Array.isArray(res)) {
    return res
      .map((r) => {
        if (r && typeof r === "object" && "role" in r) {
          return normalizeMessage(r as Record<string, unknown>);
        }
        return null;
      })
      .filter(Boolean) as ChatMessage[];
  }

  // Object with known array keys
  if (typeof res === "object") {
    const obj = res as Record<string, unknown>;

    for (const key of ["messages", "items", "data", "history", "result", "content"]) {
      if (key in obj && Array.isArray(obj[key])) {
        return extractMessages(obj[key]);
      }
    }

    // Maybe the response IS a single message
    if ("role" in obj || "type" in obj) {
      const msg = normalizeMessage(obj);
      if (msg) return [msg];
    }

    // Maybe it contains a text/content field (direct assistant response)
    if ("text" in obj || "content" in obj) {
      const text = (obj.text ?? obj.content) as string;
      if (typeof text === "string" && text.length > 0) {
        return [createAssistantMessage({ content: text })];
      }
    }
  }

  // String response — treat as assistant message
  if (typeof res === "string" && res.length > 0) {
    return [createAssistantMessage({ content: res })];
  }

  return [];
}

/**
 * Provides action callbacks for sending messages, aborting streams,
 * and resetting sessions.
 */
export function useChatActions() {
  const queryClient = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /** Stop any active polling */
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  /**
   * Poll chat.history for new messages after sending.
   */
  const pollForResponse = useCallback(
    (sessionKey: string, knownMessageCount: number) => {
      stopPolling();

      const store = useChatStore.getState();
      store.startStreaming(sessionKey, "__polling__");

      const startTime = Date.now();
      let lastMsgCount = knownMessageCount;
      let stableChecks = 0;
      let pollCount = 0;

      console.log(
        "[useChatActions] Starting poll for session:",
        sessionKey,
        "known msgs:",
        knownMessageCount,
      );

      pollTimerRef.current = setInterval(async () => {
        pollCount++;
        const elapsed = Date.now() - startTime;

        if (elapsed > POLL_TIMEOUT) {
          console.log("[useChatActions] Poll timeout reached");
          stopPolling();
          useChatStore.getState().stopStreaming();
          return;
        }

        try {
          // Try chat.history
          let res: unknown;
          try {
            res = await gateway.request<unknown>("chat.history", { sessionKey });
          } catch {
            // Fallback to sessions.preview
            try {
              res = await gateway.request<unknown>("sessions.preview", {
                keys: [sessionKey],
              });
            } catch (e2) {
              console.warn("[useChatActions] Poll fetch failed:", e2);
              return;
            }
          }

          console.log(
            `[useChatActions] Poll #${pollCount} raw response:`,
            JSON.stringify(res).slice(0, 500),
          );

          const messages = extractMessages(res);
          console.log(
            `[useChatActions] Poll #${pollCount}: got ${messages.length} messages (known: ${knownMessageCount})`,
          );

          if (messages.length > 0) {
            // We got server messages — merge them into the store
            // Keep our optimistic user message if server didn't include it
            const currentStore = useChatStore.getState();
            const currentMsgs = currentStore.messagesBySession[sessionKey] ?? [];
            const optimisticUserMsgs = currentMsgs.filter(
              (m) => m.role === "user" && !messages.some((sm) => sm.id === m.id),
            );

            // Combine: server messages + any user messages not yet on server
            const merged = [...optimisticUserMsgs, ...messages].sort(
              (a, b) => a.timestamp - b.timestamp,
            );

            currentStore.setMessages(sessionKey, merged);

            // Check if we have new assistant messages beyond what we knew
            const assistantMsgs = messages.filter((m) => m.role === "assistant");
            const hasNewContent = messages.length > knownMessageCount || assistantMsgs.length > 0;

            if (hasNewContent) {
              // Check stability — if count stopped changing, response is complete
              if (messages.length === lastMsgCount) {
                stableChecks++;
                if (stableChecks >= STABLE_COUNT) {
                  console.log("[useChatActions] Response stabilized, stopping poll");
                  stopPolling();
                  useChatStore.getState().stopStreaming();

                  // Refresh queries
                  queryClient.invalidateQueries({
                    queryKey: messagesQueryKey(sessionKey),
                  });
                  return;
                }
              } else {
                stableChecks = 0;
                lastMsgCount = messages.length;
              }
            }
          }
        } catch (err) {
          console.error("[useChatActions] Poll error:", err);
        }
      }, POLL_INTERVAL);
    },
    [queryClient, stopPolling],
  );

  /**
   * Send a chat message.
   * After sending, polls for the response via chat.history.
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

      // Set selected session BEFORE sending
      if (!selectedSessionId) {
        selectSession(sessionKey);
      }

      // Optimistically add user message
      const userMsg = createUserMessage(trimmed);
      addMessage(sessionKey, userMsg);
      setDraft(sessionKey, "");

      const currentMsgCount =
        useChatStore.getState().messagesBySession[sessionKey]?.length ?? 0;

      // Build RPC params
      const params: Record<string, unknown> = {
        sessionKey,
        message: trimmed,
        idempotencyKey: uid(),
      };

      console.warn("[useChatActions] >>> chat.send params:", params);

      try {
        const res = await gateway.request<unknown>("chat.send", params);
        console.warn("[useChatActions] >>> chat.send response:", JSON.stringify(res));

        // Try to extract assistant response directly from chat.send result
        const responseMessages = extractMessages(res);
        console.log("[useChatActions] Extracted from response:", responseMessages.length, "messages");

        if (responseMessages.length > 0) {
          // Server returned messages directly — add them
          const assistantMsgs = responseMessages.filter((m) => m.role === "assistant");
          if (assistantMsgs.length > 0) {
            for (const msg of assistantMsgs) {
              addMessage(sessionKey, msg);
            }
            console.log("[useChatActions] Added", assistantMsgs.length, "assistant messages from response");
          }
        }

        // Start polling for the full response regardless
        // (server may be still processing, or response was just an ack)
        pollForResponse(sessionKey, currentMsgCount);

        // Refresh session list
        queryClient.invalidateQueries({
          queryKey: sessionsQueryKey(selectedAgentId),
        });
      } catch (err) {
        console.error("[useChatActions] Failed to send message:", err);
      }
    },
    [queryClient, pollForResponse],
  );

  /**
   * Abort the current streaming response.
   */
  const abortStreaming = useCallback(async () => {
    stopPolling();
    const { selectedSessionId, stopStreaming } = useChatStore.getState();

    try {
      await gateway.request("chat.abort", {
        sessionKey: selectedSessionId,
      });
    } catch (err) {
      console.warn("[useChatActions] Abort failed:", err);
    }

    stopStreaming();
  }, [stopPolling]);

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
