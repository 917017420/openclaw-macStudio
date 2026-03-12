import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import type { ChatAttachment } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import {
  createAssistantMessage,
  createSystemMessage,
  createUserMessage,
} from "@/features/chat/utils";
import { uid } from "@/lib/utils";
import { messagesQueryKey } from "./useSessionMessages";
import { sessionsQueryKey } from "./useSessions";
import {
  extractMessagesFromResponse,
  mergeServerWithLocal,
} from "@/features/chat/utils/message-pipeline";

const POLL_INTERVAL_MS = 800;
const POLL_TIMEOUT_MS = 10 * 60_000;
const POLL_STABLE_COUNT = 1;

function parseAgentIdFromSessionKey(sessionKey: string): string | null {
  const m = sessionKey.match(/^agent:([^:]+):/);
  return m?.[1] ?? null;
}

function isSessionKey(value: string): boolean {
  return value === "main" || /^agent:[^:]+:.+/.test(value);
}

function normalizeSessionKeyForRpc(
  rawSessionKey: string,
  agentId?: string | null,
  fallbackSessionKey?: string,
): string {
  if (isSessionKey(rawSessionKey)) return rawSessionKey;
  const fallbackAgentId = fallbackSessionKey
    ? parseAgentIdFromSessionKey(fallbackSessionKey)
    : null;
  const resolvedAgentId = agentId ?? fallbackAgentId;
  if (resolvedAgentId) {
    return `agent:${resolvedAgentId}:${rawSessionKey}`;
  }
  return rawSessionKey;
}

function extractSessionIdentity(res: unknown): {
  sessionKey?: string;
  sessionId?: string;
} {
  if (!res || typeof res !== "object") return {};
  const obj = res as Record<string, unknown>;

  const directSessionKey = obj.sessionKey;
  const directSessionId = obj.sessionId;
  if (typeof directSessionKey === "string" || typeof directSessionId === "string") {
    return {
      sessionKey: typeof directSessionKey === "string" ? directSessionKey : undefined,
      sessionId: typeof directSessionId === "string" ? directSessionId : undefined,
    };
  }

  const session = obj.session;
  if (session && typeof session === "object") {
    const sessionObj = session as Record<string, unknown>;
    return {
      sessionKey:
        typeof sessionObj.key === "string"
          ? sessionObj.key
          : typeof sessionObj.sessionKey === "string"
            ? sessionObj.sessionKey
            : undefined,
      sessionId:
        typeof sessionObj.id === "string"
          ? sessionObj.id
          : typeof sessionObj.sessionId === "string"
            ? sessionObj.sessionId
            : undefined,
    };
  }

  return {};
}

async function requestChatSend(params: Record<string, unknown>): Promise<unknown> {
  console.log("[useChatActions] chat.send:", params);
  return gateway.request<unknown>("chat.send", params);
}

async function fetchLatestMessages(sessionKey: string): Promise<ReturnType<typeof extractMessagesFromResponse>> {
  try {
    const historyRes = await gateway.request<unknown>("chat.history", { sessionKey });
    return extractMessagesFromResponse(historyRes, sessionKey);
  } catch {
    return [];
  }
}

function dataUrlToAttachmentPayload(dataUrl: string): { mimeType: string; content: string } | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) {
    return null;
  }
  const [, mimeType, content] = match;
  return { mimeType, content };
}

export function useChatActions() {
  const queryClient = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastQueueFailureRef = useRef<{ id: string; at: number } | null>(null);
  const sessionModelPatchModeRef = useRef<"unknown" | "model" | "modelId" | "unsupported">(
    "unknown",
  );
  const isStreaming = useChatStore((s) => s.isStreaming);
  const queuedCount = useChatStore((s) => s.chatQueue.length);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => {
      stopPolling();
    };
  }, [stopPolling]);

  const stopPollingIndicatorIfOwned = useCallback((sessionKey: string) => {
    const state = useChatStore.getState();
    const ownsPollingIndicator =
      state.isStreaming &&
      state.streamingSessionKey === sessionKey &&
      state.streamingMessageId === "__polling__";
    if (ownsPollingIndicator) {
      state.stopStreaming();
    }
  }, []);

  const pollForResponse = useCallback(
    (sessionKey: string, knownMessageCount: number) => {
      stopPolling();

      const store = useChatStore.getState();
      const hasActiveAssistantStream =
        store.isStreaming &&
        store.streamingSessionKey === sessionKey &&
        store.streamingMessageId !== "__polling__";
      if (!hasActiveAssistantStream) {
        store.startStreaming(sessionKey, "__polling__", null);
      }

      const startedAt = Date.now();
      let lastServerSignature = "";
      let stableCount = 0;
      let inFlight = false;

      const tick = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
          if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
            stopPolling();
            stopPollingIndicatorIfOwned(sessionKey);
            return;
          }

          const serverMessages = await fetchLatestMessages(sessionKey);
          if (serverMessages.length === 0) {
            return;
          }

          const current = useChatStore.getState().messagesBySession[sessionKey] ?? [];
          const merged = mergeServerWithLocal(serverMessages, current);
          useChatStore.getState().setMessages(sessionKey, merged);

          const serverSignature = serverMessages
            .map((m) => `${m.role}|${m.id}|${m.timestamp}|${m.role === "assistant" || m.role === "user" || m.role === "system" ? m.content : ""}`)
            .join("\n");
          if (serverSignature === lastServerSignature) {
            stableCount++;
          } else {
            lastServerSignature = serverSignature;
            stableCount = 0;
          }

          const hasServerAssistantProgress =
            serverMessages.length > knownMessageCount &&
            serverMessages.some((m) => m.role === "assistant" || m.role === "system");
          const latestState = useChatStore.getState();
          const hasActiveRealtimeStream =
            latestState.isStreaming &&
            latestState.streamingSessionKey === sessionKey &&
            latestState.streamingMessageId !== "__polling__";

          if (
            hasServerAssistantProgress &&
            stableCount >= POLL_STABLE_COUNT &&
            !hasActiveRealtimeStream
          ) {
            stopPolling();
            stopPollingIndicatorIfOwned(sessionKey);
            queryClient.invalidateQueries({ queryKey: messagesQueryKey(sessionKey) });
          }
        } finally {
          inFlight = false;
        }
      };

      // Trigger one immediate history probe, then continue with interval polling.
      void tick();
      pollTimerRef.current = setInterval(() => {
        void tick();
      }, POLL_INTERVAL_MS);
    },
    [queryClient, stopPolling, stopPollingIndicatorIfOwned],
  );

  async function applySessionModel(
    sessionKey: string,
    modelKey: string,
  ): Promise<void> {
    const mode = sessionModelPatchModeRef.current;
    const payloads: Array<Record<string, unknown>> = mode === "model"
      ? [{ key: sessionKey, model: modelKey }]
      : mode === "modelId"
        ? [{ key: sessionKey, modelId: modelKey }]
        : mode === "unsupported"
          ? []
          : [
            { key: sessionKey, model: modelKey },
            { key: sessionKey, modelId: modelKey },
          ];

    for (const payload of payloads) {
      try {
        await gateway.request("sessions.patch", payload);
        sessionModelPatchModeRef.current = "model" in payload ? "model" : "modelId";
        return;
      } catch (err) {
        const message = String(err);
        if (
          message.includes("invalid") ||
          message.includes("required property") ||
          message.includes("unexpected property")
        ) {
          continue;
        }
        throw err;
      }
    }

    if (mode !== "unsupported") {
      sessionModelPatchModeRef.current = "unsupported";
    }
  }

  async function callSessionMutation(
    method: "sessions.reset" | "sessions.delete",
    sessionKey: string,
  ): Promise<void> {
    const payloads: Array<Record<string, unknown>> = [
      { key: sessionKey },
      { sessionKey },
      { sessionId: sessionKey },
      { id: sessionKey },
    ];

    let lastError: unknown;
    for (const payload of payloads) {
      try {
        await gateway.request(method, payload);
        return;
      } catch (err) {
        lastError = err;
        const message = String(err);
        if (
          message.includes("invalid") ||
          message.includes("required property") ||
          message.includes("unexpected property")
        ) {
          continue;
        }
        throw err;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  const performSendMessage = useCallback(
    async (params: {
      agentId: string;
      sessionKey: string;
      selectedModelId: string | null;
      content: string;
      attachments: ChatAttachment[];
    }) => {
      const {
        addMessage,
        clearToolMessages,
        closeSidebar,
        markSessionSent,
        setCompactionStatus,
        setFallbackStatus,
        selectSession,
        startStreaming,
      } = useChatStore.getState();

      const trimmed = params.content.trim();
      if (!trimmed && params.attachments.length === 0) {
        return { ok: false as const };
      }

      selectSession(params.sessionKey);

      const userContentBlocks: Array<Record<string, unknown>> = [];
      if (trimmed) {
        userContentBlocks.push({ type: "text", text: trimmed });
      }
      for (const attachment of params.attachments) {
        userContentBlocks.push({
          type: "image",
          source: {
            type: "base64",
            media_type: attachment.mimeType,
            data: attachment.dataUrl,
          },
        });
      }

      const userMessage = createUserMessage(trimmed, {
        attachments: params.attachments,
        raw: {
          role: "user",
          content: userContentBlocks,
          timestamp: Date.now(),
        },
      });
      markSessionSent(params.sessionKey, userMessage.timestamp);
      addMessage(params.sessionKey, userMessage);
      clearToolMessages(params.sessionKey);
      setCompactionStatus(params.sessionKey, null);
      setFallbackStatus(params.sessionKey, null);
      closeSidebar();

      const runId = uid();
      const pendingAssistant = createAssistantMessage({
        id: `stream:${runId}`,
        timestamp: userMessage.timestamp + 1,
        isStreaming: true,
      });
      addMessage(params.sessionKey, pendingAssistant);
      startStreaming(params.sessionKey, pendingAssistant.id, runId);

      const requestParams: Record<string, unknown> = {
        sessionKey: params.sessionKey,
        message: trimmed,
        idempotencyKey: runId,
      };
      const apiAttachments = params.attachments
        .map((attachment) => dataUrlToAttachmentPayload(attachment.dataUrl))
        .filter((attachment): attachment is NonNullable<typeof attachment> => attachment !== null)
        .map((attachment) => ({
          type: "image",
          mimeType: attachment.mimeType,
          content: attachment.content,
        }));
      if (apiAttachments.length > 0) {
        requestParams.attachments = apiAttachments;
      }

      try {
        if (params.selectedModelId) {
          try {
            await applySessionModel(params.sessionKey, params.selectedModelId);
          } catch (error) {
            console.warn("[useChatActions] sessions.patch model failed:", error);
          }
        }

        const res = await requestChatSend(requestParams);
        const { sessionKey: responseSessionKey, sessionId: responseSessionId } =
          extractSessionIdentity(res);
        const rawReturnedSession = responseSessionKey ?? responseSessionId;

        const effectiveSessionKey = rawReturnedSession
          ? normalizeSessionKeyForRpc(rawReturnedSession, params.agentId, params.sessionKey)
          : params.sessionKey;

        const state = useChatStore.getState();
        if (responseSessionId) {
          state.mapSession(responseSessionId, effectiveSessionKey);
        }
        if (
          responseSessionKey &&
          responseSessionId &&
          responseSessionKey !== responseSessionId
        ) {
          state.mapSession(responseSessionKey, effectiveSessionKey);
        }

        if (effectiveSessionKey !== params.sessionKey) {
          const source = state.messagesBySession[params.sessionKey] ?? [];
          const target = state.messagesBySession[effectiveSessionKey] ?? [];
          const merged = [...target];
          for (const msg of source) {
            if (!merged.some((m) => m.id === msg.id)) {
              merged.push(msg);
            }
          }
          state.setMessages(effectiveSessionKey, merged);
          state.remapQueuedSession(params.sessionKey, effectiveSessionKey);
          state.clearSession(params.sessionKey);
          if (state.streamingSessionKey === params.sessionKey) {
            useChatStore.setState({ streamingSessionKey: effectiveSessionKey });
          }
        }

        state.selectSession(effectiveSessionKey);
        queryClient.invalidateQueries({
          queryKey: sessionsQueryKey(params.agentId),
        });

        const currentState = useChatStore.getState();
        const effectiveMessages = currentState.messagesBySession[effectiveSessionKey] ?? [];
        const count = effectiveMessages.some((message) => message.id === pendingAssistant.id)
          ? Math.max(0, effectiveMessages.length - 1)
          : effectiveMessages.length;
        pollForResponse(effectiveSessionKey, count);
        return { ok: true as const };
      } catch (error) {
        console.error("[useChatActions] sendMessage failed:", error);
        const state = useChatStore.getState();
        if (state.streamingRunId === runId) {
          state.stopStreaming();
        }
        state.addMessage(
          params.sessionKey,
          createSystemMessage(
            `Send failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
        return { ok: false as const };
      }
    },
    [pollForResponse, queryClient],
  );

  const flushQueuedMessages = useCallback(async () => {
    const state = useChatStore.getState();
    if (state.isStreaming || state.chatQueue.length === 0) {
      return;
    }
    const next = state.chatQueue[0];
    if (!next) {
      return;
    }
    const lastFailed = lastQueueFailureRef.current;
    if (lastFailed && lastFailed.id === next.id && Date.now() - lastFailed.at < 3_000) {
      return;
    }
    state.removeQueuedMessage(next.id);
    const result = await performSendMessage({
      agentId: next.agentId,
      sessionKey: next.sessionKey,
      selectedModelId: next.modelId,
      content: next.text,
      attachments: next.attachments,
    });
    if (!result.ok) {
      lastQueueFailureRef.current = { id: next.id, at: Date.now() };
      useChatStore.getState().prependQueuedMessage(next);
      return;
    }
    lastQueueFailureRef.current = null;
  }, [performSendMessage]);

  useEffect(() => {
    if (!isStreaming && queuedCount > 0) {
      void flushQueuedMessages();
    }
  }, [flushQueuedMessages, isStreaming, queuedCount]);

  const sendMessage = useCallback(
    async (content: string, attachments: ChatAttachment[] = []) => {
      const {
        selectedAgentId,
        selectedSessionId,
        selectedModelId,
        setDraft,
        setAttachments,
        selectSession,
        enqueueQueuedMessage,
      } = useChatStore.getState();

      if (!selectedAgentId) return;
      const trimmed = content.trim();
      if (!trimmed && attachments.length === 0) return;

      const sessionKey = selectedSessionId ?? `agent:${selectedAgentId}:main`;
      if (!selectedSessionId) {
        selectSession(sessionKey);
      }
      setDraft(sessionKey, "");
      setAttachments(sessionKey, []);

      if (useChatStore.getState().isStreaming) {
        enqueueQueuedMessage({
          id: uid(),
          sessionKey,
          agentId: selectedAgentId,
          modelId: selectedModelId,
          text: trimmed,
          createdAt: Date.now(),
          attachments,
        });
        return;
      }

      await performSendMessage({
        agentId: selectedAgentId,
        sessionKey,
        selectedModelId,
        content: trimmed,
        attachments,
      });
    },
    [performSendMessage],
  );

  const abortStreaming = useCallback(async () => {
    stopPolling();

    const state = useChatStore.getState();
    const sessionKey = state.selectedSessionId;
    if (!sessionKey) {
      state.stopStreaming();
      return;
    }
    const rpcSessionKey = normalizeSessionKeyForRpc(
      sessionKey,
      state.selectedAgentId,
    );

    try {
      const params: Record<string, unknown> = { sessionKey: rpcSessionKey };
      if (state.streamingRunId) {
        params.runId = state.streamingRunId;
      }
      await gateway.request("chat.abort", params);
    } catch (error) {
      const msg = String(error);
      if (!/no_active_run/i.test(msg)) {
        console.warn("[useChatActions] chat.abort failed:", error);
      }
    } finally {
      state.stopStreaming();
    }
  }, [stopPolling]);

  const resetSession = useCallback(
    async (sessionKey: string) => {
      const state = useChatStore.getState();
      const rpcSessionKey = normalizeSessionKeyForRpc(sessionKey, state.selectedAgentId);
      try {
        await callSessionMutation("sessions.reset", rpcSessionKey);
        state.clearSession(sessionKey);
        if (rpcSessionKey !== sessionKey) {
          state.clearSession(rpcSessionKey);
        }
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(rpcSessionKey),
        });
      } catch (error) {
        console.error("[useChatActions] resetSession failed:", error);
      }
    },
    [queryClient],
  );

  const deleteSession = useCallback(
    async (sessionKey: string) => {
      const state = useChatStore.getState();
      const rpcSessionKey = normalizeSessionKeyForRpc(sessionKey, state.selectedAgentId);
      const isMainSession = /(^main$)|(:main$)/.test(rpcSessionKey);
      if (isMainSession) {
        return;
      }

      try {
        await callSessionMutation("sessions.delete", rpcSessionKey);
      } catch (error) {
        try {
          await callSessionMutation("sessions.reset", rpcSessionKey);
        } catch (fallbackError) {
          console.error("[useChatActions] deleteSession failed:", error);
          console.error("[useChatActions] fallback reset failed:", fallbackError);
          return;
        }
      }

      state.clearSession(sessionKey);
      if (rpcSessionKey !== sessionKey) {
        state.clearSession(rpcSessionKey);
      }
      if (
        state.selectedSessionId === sessionKey ||
        state.selectedSessionId === rpcSessionKey
      ) {
        state.selectSession(null);
      }

      queryClient.invalidateQueries({
        queryKey: messagesQueryKey(rpcSessionKey),
      });
      queryClient.invalidateQueries({
        queryKey: sessionsQueryKey(state.selectedAgentId ?? undefined),
      });
    },
    [queryClient],
  );

  const refreshSession = useCallback(async () => {
    const state = useChatStore.getState();
    const sessionKey = state.selectedSessionId;
    if (!sessionKey) {
      return;
    }
    const rpcSessionKey = normalizeSessionKeyForRpc(sessionKey, state.selectedAgentId);
    queryClient.invalidateQueries({ queryKey: messagesQueryKey(rpcSessionKey) });
    queryClient.invalidateQueries({ queryKey: sessionsQueryKey(state.selectedAgentId ?? undefined) });
    await queryClient.refetchQueries({ queryKey: messagesQueryKey(rpcSessionKey) });
  }, [queryClient]);

  return {
    sendMessage,
    abortStreaming,
    refreshSession,
    resetSession,
    deleteSession,
  };
}
