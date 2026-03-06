import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { gateway } from "@/lib/gateway";
import { useChatStore } from "@/features/chat/store";
import { useConnectionStore } from "@/features/connection/store";
import { SESSIONS_QUERY_KEY } from "./useSessions";
import { messagesQueryKey } from "./useSessionMessages";
import {
  extractMessagesFromResponse,
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
  stream: string | null;
  phase: string | null;
  text: string | null;
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
    stream: readString(root.stream)?.toLowerCase() ?? null,
    phase: readString(root.phase)?.toLowerCase() ?? null,
    text,
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
    if (messages.length > 0) {
      useChatStore.getState().setMessages(sessionKey, messages);
    }
  } catch {
    // Ignore sync errors; polling/query invalidation remains as fallback.
  }
}

export function useChatEvents() {
  const isConnected = useConnectionStore((s) => s.state === "connected");
  const queryClient = useQueryClient();
  const terminalEventSeenRef = useRef<Map<string, number>>(new Map());

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
        // Disabled by design: do not render incremental text. We only display
        // finalized assistant content from server history.
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
            void (async () => {
              await syncMessagesFromHistory(sessionKey);
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
        }

        queryClient.invalidateQueries({ queryKey: SESSIONS_QUERY_KEY });
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
        return;
      }

      if (parsed.state === "error") {
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

      if (parsed.stream === "assistant" && parsed.text) return;

      if (parsed.stream === "lifecycle" && parsed.phase === "end") {
        void syncMessagesFromHistory(sessionKey);
        queryClient.invalidateQueries({
          queryKey: messagesQueryKey(sessionKey),
        });
      }
    });

    return () => {
      subscription.unsubscribe();
      agentSubscription.unsubscribe();
    };
  }, [isConnected, queryClient]);
}
