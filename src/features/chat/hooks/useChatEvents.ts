import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import {
  createAssistantMessage,
  createSystemMessage,
} from "@/features/chat/utils";
import { SESSIONS_QUERY_KEY } from "./useSessions";
import { messagesQueryKey } from "./useSessionMessages";
import {
  createSessionToolStreamHost,
  handleAgentToolEvent,
  resetToolStream,
  type SessionToolStreamHost,
} from "@/features/chat/chat/tool-stream";
import {
  extractAssistantText,
  extractMessagesFromResponse,
  mergeServerWithLocal,
  parseChatEventPayload,
} from "@/features/chat/utils/message-pipeline";

const TERMINAL_EVENT_DEDUPE_WINDOW_MS = 15_000;

function tryParseObject(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === "object") {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === "object") {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

type ParsedAgentEvent = {
  runId: string | null;
  sessionKey: string | null;
  seq: number;
  stream: string | null;
  phase: string | null;
  ts: number;
  text: string | null;
  toolCallId: string | null;
  toolName: string | null;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  data: Record<string, unknown>;
  isError: boolean;
};

function parseAgentEventPayload(payload: unknown): ParsedAgentEvent {
  const root = tryParseObject(payload) ?? {};
  const data = tryParseObject(root.data) ?? null;
  const run = tryParseObject(root.run) ?? null;
  const session = tryParseObject(root.session) ?? null;

  const runId =
    readString(root.runId) ??
    readString(root.run_id) ??
    readString(root.run) ??
    readString(run?.id) ??
    readString(run?.runId) ??
    null;

  const sessionKey =
    readString(root.sessionKey) ??
    readString(root.session_key) ??
    readString(root.sessionId) ??
    readString(root.session_id) ??
    readString(root.session) ??
    readString(root.key) ??
    readString(session?.key) ??
    readString(session?.sessionKey) ??
    readString(session?.sessionId) ??
    readString(run?.sessionKey) ??
    readString(run?.sessionId) ??
    readString(run?.key) ??
    null;

  const text =
    readString(root.text) ??
    readString(root.delta) ??
    readString(data?.text) ??
    readString(data?.delta) ??
    null;

  return {
    runId,
    sessionKey,
    seq: typeof root.seq === "number" ? root.seq : 0,
    stream: readString(root.stream)?.toLowerCase() ?? null,
    phase: readString(root.phase)?.toLowerCase() ?? null,
    ts: typeof root.ts === "number" ? root.ts : Date.now(),
    text,
    toolCallId: readString(root.toolCallId) ?? readString(data?.toolCallId) ?? null,
    toolName: readString(root.name) ?? readString(data?.name) ?? null,
    args: data?.args,
    partialResult: data?.partialResult,
    result: data?.result,
    data: data ?? {},
    isError: root.isError === true || data?.isError === true,
  };
}

function isSessionKey(value: string): boolean {
  return value === "main" || /^agent:[^:]+:.+/.test(value);
}

function resolveMainAliasKey(store: ReturnType<typeof useChatStore.getState>): string | null {
  const selected = store.selectedSessionId;
  if (selected && /(^main$)|(:main$)/.test(selected)) {
    return selected;
  }
  const streaming = store.streamingSessionKey;
  if (streaming && /(^main$)|(:main$)/.test(streaming)) {
    return streaming;
  }
  if (store.selectedAgentId) {
    return `agent:${store.selectedAgentId}:main`;
  }
  return "main";
}

function normalizeSessionKey(raw: string, selectedAgentId: string | null): string {
  if (raw === "main") {
    return selectedAgentId ? `agent:${selectedAgentId}:main` : "main";
  }
  if (isSessionKey(raw)) return raw;
  if (selectedAgentId) return `agent:${selectedAgentId}:${raw}`;
  return raw;
}

function resolveEventSessionKey(raw: string | null): string | null {
  const store = useChatStore.getState();
  if (!raw) {
    return store.streamingSessionKey ?? store.selectedSessionId;
  }
  if (raw === "main") {
    return resolveMainAliasKey(store);
  }

  const mapped = store.resolveSessionKey(raw);
  if (mapped) {
    return mapped;
  }

  const normalized = normalizeSessionKey(raw, store.selectedAgentId);
  if (normalized !== raw) {
    store.mapSession(raw, normalized);
  }
  return normalized;
}

async function syncMessagesFromHistory(sessionKey: string): Promise<void> {
  try {
    const historyRes = await gateway.request<unknown>("chat.history", { sessionKey });
    const messages = extractMessagesFromResponse(historyRes, sessionKey);
    const current = useChatStore.getState().messagesBySession[sessionKey] ?? [];
    useChatStore.getState().setMessages(sessionKey, mergeServerWithLocal(messages, current));
  } catch {
    // Ignore sync errors; polling/query invalidation remains as fallback.
  }
}

function ensureStreamingAssistant(
  sessionKey: string,
  runId: string | null,
): { store: ReturnType<typeof useChatStore.getState>; messageId: string } {
  const store = useChatStore.getState();
  const activeMessageId =
    store.streamingSessionKey === sessionKey &&
    store.streamingMessageId &&
    store.streamingMessageId !== "__polling__" &&
    (!runId || !store.streamingRunId || store.streamingRunId === runId)
      ? store.streamingMessageId
      : null;

  const messageId = activeMessageId ?? `stream:${runId ?? sessionKey}`;
  const messages = store.messagesBySession[sessionKey] ?? [];
  const hasMessage = messages.some((message) => message.id === messageId && message.role === "assistant");

  if (!hasMessage) {
    store.addMessage(
      sessionKey,
      createAssistantMessage({
        id: messageId,
        isStreaming: true,
      }),
    );
  }

  const latest = useChatStore.getState();
  const shouldStartStreaming =
    latest.streamingSessionKey !== sessionKey ||
    latest.streamingMessageId !== messageId ||
    !latest.isStreaming ||
    (runId !== null && latest.streamingRunId !== runId);

  if (shouldStartStreaming) {
    latest.startStreaming(sessionKey, messageId, runId);
  }

  return { store: useChatStore.getState(), messageId };
}

function setStreamingAssistantText(sessionKey: string, runId: string | null, text: string) {
  const nextText = text.trim();
  if (!nextText) return;

  const { store, messageId } = ensureStreamingAssistant(sessionKey, runId);
  store.setStreamContent(sessionKey, messageId, nextText);
}

function upsertTerminalSystemMessage(sessionKey: string, text: string) {
  const store = useChatStore.getState();
  const existing = store.messagesBySession[sessionKey] ?? [];
  const last = existing[existing.length - 1];
  if (last?.role === "system" && last.content === text) {
    return;
  }
  store.addMessage(sessionKey, createSystemMessage(text));
}

export function useChatEvents() {
  const isConnected = useConnectionStore((s) => s.state === "connected");
  const queryClient = useQueryClient();
  const terminalEventSeenRef = useRef<Map<string, number>>(new Map());
  const toolHostsRef = useRef<Map<string, SessionToolStreamHost>>(new Map());

  const getToolHost = (sessionKey: string) => {
    let host = toolHostsRef.current.get(sessionKey);
    if (!host) {
      host = createSessionToolStreamHost(sessionKey);
      toolHostsRef.current.set(sessionKey, host);
    }
    return host;
  };

  const clearToolStreamState = (sessionKey: string, runId?: string | null) => {
    const host = getToolHost(sessionKey);
    if (runId && host.currentRunId && host.currentRunId !== runId) {
      return host;
    }

    resetToolStream(host, null);
    const state = useChatStore.getState();
    state.setToolMessages(sessionKey, host.chatToolMessages);
    return host;
  };

  useEffect(() => {
    if (!isConnected) return;

    const subscription = gateway.on("chat", (payload: unknown) => {
      const parsed = parseChatEventPayload(payload);
      const sessionKey = resolveEventSessionKey(parsed.sessionKey);
      if (!sessionKey) return;

      const store = useChatStore.getState();
      const activeRunId = store.streamingRunId;
      const hasActiveRun =
        store.isStreaming &&
        store.streamingSessionKey === sessionKey &&
        store.streamingMessageId !== "__polling__";
      const isOtherRun =
        Boolean(parsed.runId) &&
        Boolean(activeRunId) &&
        parsed.runId !== activeRunId &&
        hasActiveRun;

      if (parsed.state === "delta") {
        if (!isOtherRun) {
          const text = extractAssistantText(parsed.message);
          if (text) {
            setStreamingAssistantText(sessionKey, parsed.runId, text);
          }
        }
        return;
      }

      if (parsed.state === "final" || parsed.state === "aborted") {
        const terminalSig = [
          parsed.state,
          sessionKey,
          parsed.runId ?? "no-run",
        ].join("|");
        const now = Date.now();
        const seenAt = terminalEventSeenRef.current.get(terminalSig);
        if (seenAt && now - seenAt < TERMINAL_EVENT_DEDUPE_WINDOW_MS) {
          return;
        }
        terminalEventSeenRef.current.set(terminalSig, now);
        if (terminalEventSeenRef.current.size > 300) {
          for (const [key, ts] of terminalEventSeenRef.current) {
            if (now - ts > TERMINAL_EVENT_DEDUPE_WINDOW_MS * 4) {
              terminalEventSeenRef.current.delete(key);
            }
          }
        }

        if (!isOtherRun) {
          if (parsed.state === "final") {
            const finalText = extractAssistantText(parsed.message);
            if (finalText) {
              const latest = useChatStore.getState();
              const messageId =
                latest.streamingSessionKey === sessionKey &&
                latest.streamingMessageId &&
                latest.streamingMessageId !== "__polling__"
                  ? latest.streamingMessageId
                  : null;
              if (messageId) {
                latest.finalizeStream(sessionKey, messageId, finalText);
              } else {
                setStreamingAssistantText(sessionKey, parsed.runId, finalText);
                useChatStore.getState().stopStreaming();
              }
            }
            void (async () => {
              await syncMessagesFromHistory(sessionKey);
              clearToolStreamState(sessionKey, parsed.runId);
              const latest = useChatStore.getState();
              if (latest.isStreaming && latest.streamingSessionKey === sessionKey) {
                latest.stopStreaming();
              }

              queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
              queryClient.invalidateQueries({
                queryKey: messagesQueryKey(sessionKey),
              });
            })();
            return;
          }

          if (store.isStreaming && store.streamingSessionKey === sessionKey) {
            store.stopStreaming();
          }
          clearToolStreamState(sessionKey, parsed.runId);
          upsertTerminalSystemMessage(sessionKey, "Run aborted");
        }

        queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
        return;
      }

      if (parsed.state === "error") {
        if (store.isStreaming && store.streamingSessionKey === sessionKey) {
          store.stopStreaming();
        }
        clearToolStreamState(sessionKey, parsed.runId);
        upsertTerminalSystemMessage(
          sessionKey,
          `Run error${parsed.errorMessage ? `: ${parsed.errorMessage}` : ""}`,
        );
        // Keep loading state for transient tool-phase errors.
        void syncMessagesFromHistory(sessionKey);
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
      }
    });

      const agentSubscription = gateway.on("agent", (payload: unknown) => {
        const parsed = parseAgentEventPayload(payload);
        const sessionKey = resolveEventSessionKey(parsed.sessionKey);
        if (!sessionKey) return;
        const host = getToolHost(sessionKey);
        if (parsed.runId && (!host.currentRunId || parsed.phase === "start")) {
          if (host.currentRunId !== parsed.runId && parsed.stream === "tool") {
            resetToolStream(host, parsed.runId);
          } else {
            host.currentRunId = parsed.runId;
          }
        }

        const store = useChatStore.getState();
      const hasActiveRun =
        store.isStreaming &&
        store.streamingSessionKey === sessionKey &&
        store.streamingMessageId !== "__polling__";
      const isOtherRun =
        Boolean(parsed.runId) &&
        Boolean(store.streamingRunId) &&
        parsed.runId !== store.streamingRunId &&
        hasActiveRun;

      if (parsed.stream === "assistant" && parsed.text && !isOtherRun) {
        setStreamingAssistantText(sessionKey, parsed.runId, parsed.text);
        return;
      }

      handleAgentToolEvent(host, {
        runId: parsed.runId,
        seq: parsed.seq,
        stream: parsed.stream,
        phase: parsed.phase,
        ts: parsed.ts,
        sessionKey,
        data: parsed.data,
        isError: parsed.isError,
      });
      store.setToolMessages(sessionKey, host.chatToolMessages);
      store.setCompactionStatus(sessionKey, host.compactionStatus);
      store.setFallbackStatus(sessionKey, host.fallbackStatus);

      if (parsed.stream === "tool" && !isOtherRun) {
        return;
      }

      if (parsed.stream === "lifecycle" && parsed.phase === "end") {
        void syncMessagesFromHistory(sessionKey).finally(() => {
          clearToolStreamState(sessionKey, parsed.runId);
        });
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
        return;
      }

      if (parsed.stream === "lifecycle" && parsed.phase === "error") {
        if (store.isStreaming && store.streamingSessionKey === sessionKey) {
          store.stopStreaming();
        }
        clearToolStreamState(sessionKey, parsed.runId);
        upsertTerminalSystemMessage(sessionKey, "Run error");
      }
    });

    return () => {
      subscription.unsubscribe();
      agentSubscription.unsubscribe();
    };
  }, [isConnected, queryClient]);
}
