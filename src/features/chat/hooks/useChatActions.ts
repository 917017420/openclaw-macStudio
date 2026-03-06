import { useCallback, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { createUserMessage } from "@/features/chat/utils";
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

export function useChatActions() {
  const queryClient = useQueryClient();
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionModelPatchModeRef = useRef<"unknown" | "model" | "modelId" | "unsupported">(
    "unknown",
  );

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

  const sendMessage = useCallback(
    async (content: string) => {
      const {
        selectedAgentId,
        selectedSessionId,
        selectedModelId,
        addMessage,
        markSessionSent,
        setDraft,
        selectSession,
      } = useChatStore.getState();

      if (!selectedAgentId) return;
      const trimmed = content.trim();
      if (!trimmed) return;

      const sessionKey = selectedSessionId ?? `agent:${selectedAgentId}:main`;
      if (!selectedSessionId) {
        selectSession(sessionKey);
      }

      const userMessage = createUserMessage(trimmed);
      markSessionSent(sessionKey, userMessage.timestamp);
      addMessage(sessionKey, userMessage);
      setDraft(sessionKey, "");

      const knownCount =
        useChatStore.getState().messagesBySession[sessionKey]?.length ?? 0;

      const params: Record<string, unknown> = {
        sessionKey,
        message: trimmed,
        idempotencyKey: uid(),
      };

      try {
        if (selectedModelId) {
          try {
            await applySessionModel(sessionKey, selectedModelId);
          } catch (error) {
            console.warn("[useChatActions] sessions.patch model failed:", error);
          }
        }

        const res = await requestChatSend(params);
        const { sessionKey: responseSessionKey, sessionId: responseSessionId } =
          extractSessionIdentity(res);
        const rawReturnedSession = responseSessionKey ?? responseSessionId;

        const effectiveSessionKey = rawReturnedSession
          ? normalizeSessionKeyForRpc(rawReturnedSession, selectedAgentId, sessionKey)
          : sessionKey;

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

        if (effectiveSessionKey !== sessionKey) {
          const source = state.messagesBySession[sessionKey] ?? [];
          const target = state.messagesBySession[effectiveSessionKey] ?? [];
          const merged = [...target];
          for (const msg of source) {
            if (!merged.some((m) => m.id === msg.id)) {
              merged.push(msg);
            }
          }
          state.setMessages(effectiveSessionKey, merged);
          state.clearSession(sessionKey);
        }

        state.selectSession(effectiveSessionKey);
        queryClient.invalidateQueries({
          queryKey: sessionsQueryKey(selectedAgentId),
        });

        const currentState = useChatStore.getState();
        const count =
          currentState.messagesBySession[effectiveSessionKey]?.length ?? knownCount;
        // Start polling immediately to reduce final-message display latency.
        pollForResponse(effectiveSessionKey, count);
      } catch (error) {
        console.error("[useChatActions] sendMessage failed:", error);
      }
    },
    [pollForResponse, queryClient],
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

  return {
    sendMessage,
    abortStreaming,
    resetSession,
    deleteSession,
  };
}
