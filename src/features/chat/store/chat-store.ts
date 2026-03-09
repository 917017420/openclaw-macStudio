// Chat store — manages chat UI state, streaming, and messages

import { create } from "zustand";
import type {
  ChatMessage,
  AssistantMessage,
  ToolCallMessage,
  ChatAttachment,
} from "@/lib/gateway";
import { sanitizeVisibleText } from "@/features/chat/utils/message-pipeline";
import type {
  CompactionStatus,
  FallbackStatus,
} from "@/features/chat/chat/tool-stream";

function coerceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => coerceText(item)).join("");
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    if (typeof obj.text === "string") return obj.text;
    if (typeof obj.content === "string") return obj.content;
    if (Array.isArray(obj.content)) return obj.content.map((item) => coerceText(item)).join("");
    if (Array.isArray(obj.parts)) return obj.parts.map((item) => coerceText(item)).join("");
    try {
      return JSON.stringify(obj);
    } catch {
      return "";
    }
  }
  return "";
}

function sanitizeDisplayText(text: string): string {
  return sanitizeVisibleText(text);
}

function normalizeComparableText(text: string): string {
  return sanitizeDisplayText(text).replace(/\s+/g, " ").trim();
}

function toolComparableKey(tool: ToolCallMessage): string | null {
  const toolCallId = tool.toolCallId?.trim();
  if (toolCallId) {
    return `tool|${toolCallId}`;
  }

  const name = tool.toolName?.trim();
  const inputKey = normalizeComparableText(coerceText(tool.input)).slice(0, 160);
  if (!name && !inputKey) {
    return null;
  }
  return `tool|${name ?? "tool"}|${inputKey}`;
}

function toolStatusRank(status: ToolCallMessage["status"]): number {
  if (status === "error") return 3;
  if (status === "completed") return 2;
  return 1;
}

function preferToolMessage(
  prev: ToolCallMessage,
  next: ToolCallMessage,
): ToolCallMessage {
  const prevRank = toolStatusRank(prev.status);
  const nextRank = toolStatusRank(next.status);
  const prevHasTerminalData = prev.output !== undefined || Boolean(prev.error?.trim());
  const nextHasTerminalData = next.output !== undefined || Boolean(next.error?.trim());

  let preferred = prev;
  if (nextRank !== prevRank) {
    preferred = nextRank > prevRank ? next : prev;
  } else if (nextHasTerminalData !== prevHasTerminalData) {
    preferred = nextHasTerminalData ? next : prev;
  } else if (next.timestamp >= prev.timestamp) {
    preferred = next;
  }

  const fallback = preferred === prev ? next : prev;
  return {
    ...preferred,
    input: preferred.input ?? fallback.input,
    output: preferred.output ?? fallback.output,
    error: preferred.error ?? fallback.error,
    timestamp: Math.max(prev.timestamp, next.timestamp),
  };
}

function messageComparableKey(message: ChatMessage): string | null {
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    const normalized = normalizeComparableText(message.content);
    return normalized ? `${message.role}|${normalized}` : null;
  }
  if (message.role === "tool") {
    return toolComparableKey(message as ToolCallMessage);
  }
  return null;
}

function preferAssistantMessage(
  prev: AssistantMessage,
  next: AssistantMessage,
): AssistantMessage {
  const prevLen = prev.content.trim().length;
  const nextLen = next.content.trim().length;
  if (nextLen > prevLen) return next;
  if (nextLen < prevLen) return prev;
  const prevReasoning = (prev.reasoning ?? "").trim().length;
  const nextReasoning = (next.reasoning ?? "").trim().length;
  if (nextReasoning > prevReasoning) return next;
  if (nextReasoning < prevReasoning) return prev;
  if ((prev.isStreaming ?? false) && !(next.isStreaming ?? false)) return next;
  if (next.timestamp >= prev.timestamp) return next;
  return prev;
}

function normalizeMessagesForStore(messages: ChatMessage[]): ChatMessage[] {
  const sanitized = messages
    .map((msg) => sanitizeMessage(msg))
    .filter((msg) => shouldKeepMessage(msg))
    .map((msg, index) => ({ msg, index }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.msg.timestamp) ? a.msg.timestamp : 0;
      const tb = Number.isFinite(b.msg.timestamp) ? b.msg.timestamp : 0;
      if (ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map((entry) => entry.msg);

  const dedupedById: ChatMessage[] = [];
  const idToIndex = new Map<string, number>();
  for (const msg of sanitized) {
    const existingIndex = idToIndex.get(msg.id);
    if (existingIndex === undefined) {
      idToIndex.set(msg.id, dedupedById.length);
      dedupedById.push(msg);
      continue;
    }
    const existing = dedupedById[existingIndex];
    if (msg.role === "assistant" && existing.role === "assistant") {
      dedupedById[existingIndex] = preferAssistantMessage(existing, msg);
    } else if (msg.role === "tool" && existing.role === "tool") {
      dedupedById[existingIndex] = preferToolMessage(existing, msg);
    } else if (msg.timestamp >= existing.timestamp) {
      dedupedById[existingIndex] = msg;
    }
  }

  const compacted: ChatMessage[] = [];
  for (const msg of dedupedById) {
    const last = compacted[compacted.length - 1];
    if (!last) {
      compacted.push(msg);
      continue;
    }

    const lastKey = messageComparableKey(last);
    const curKey = messageComparableKey(msg);
    if (lastKey && curKey && lastKey === curKey) {
      if (msg.role === "assistant" && last.role === "assistant") {
        compacted[compacted.length - 1] = preferAssistantMessage(last, msg);
      } else if (msg.role === "tool" && last.role === "tool") {
        compacted[compacted.length - 1] = preferToolMessage(last, msg);
      } else if (msg.timestamp >= last.timestamp) {
        compacted[compacted.length - 1] = msg;
      }
      continue;
    }
    compacted.push(msg);
  }

  // Second pass: remove assistant duplicates even when another message slipped in-between.
  // This catches event/history double-writes for the same run.
  const ASSISTANT_DUP_WINDOW_MS = 30_000;
  const dedupedAssistant: ChatMessage[] = [];
  const assistantIndexByKey = new Map<string, number>();

  for (const msg of compacted) {
    if (msg.role !== "assistant") {
      dedupedAssistant.push(msg);
      continue;
    }

    const key = messageComparableKey(msg);
    if (!key) {
      dedupedAssistant.push(msg);
      continue;
    }

    const seenIndex = assistantIndexByKey.get(key);
    if (seenIndex === undefined) {
      assistantIndexByKey.set(key, dedupedAssistant.length);
      dedupedAssistant.push(msg);
      continue;
    }

    const existing = dedupedAssistant[seenIndex];
    if (!existing || existing.role !== "assistant") {
      assistantIndexByKey.set(key, dedupedAssistant.length);
      dedupedAssistant.push(msg);
      continue;
    }

    const closeInTime = Math.abs(msg.timestamp - existing.timestamp) <= ASSISTANT_DUP_WINDOW_MS;
    if (!closeInTime) {
      assistantIndexByKey.set(key, dedupedAssistant.length);
      dedupedAssistant.push(msg);
      continue;
    }

    dedupedAssistant[seenIndex] = preferAssistantMessage(existing, msg);
  }

  // Third pass: remove cross-gap duplicates for assistant/system/tool messages.
  // Some gateways replay progress/status frames with new ids during history sync.
  const CROSS_GAP_DUP_WINDOW_MS = 120_000;
  const dedupedCrossGap: ChatMessage[] = [];
  const seenIndexByComparable = new Map<string, number>();

  for (const msg of dedupedAssistant) {
    const key = messageComparableKey(msg);
    if (!key || msg.role === "user") {
      dedupedCrossGap.push(msg);
      continue;
    }

    const seenIndex = seenIndexByComparable.get(key);
    if (seenIndex === undefined) {
      seenIndexByComparable.set(key, dedupedCrossGap.length);
      dedupedCrossGap.push(msg);
      continue;
    }

    const existing = dedupedCrossGap[seenIndex];
    if (!existing) {
      seenIndexByComparable.set(key, dedupedCrossGap.length);
      dedupedCrossGap.push(msg);
      continue;
    }

    const closeInTime = Math.abs(msg.timestamp - existing.timestamp) <= CROSS_GAP_DUP_WINDOW_MS;
    if (!closeInTime) {
      seenIndexByComparable.set(key, dedupedCrossGap.length);
      dedupedCrossGap.push(msg);
      continue;
    }

    // Keep earliest occurrence for status/system duplicates to avoid visual repetition.
    // For assistant, upgrade in-place when later content is clearly better.
    if (msg.role === "assistant" && existing.role === "assistant") {
      dedupedCrossGap[seenIndex] = preferAssistantMessage(existing, msg);
    } else if (msg.role === "tool" && existing.role === "tool") {
      dedupedCrossGap[seenIndex] = preferToolMessage(existing, msg);
    }
  }

  return dedupedCrossGap;
}

function shouldKeepMessage(message: ChatMessage): boolean {
  if (message.role === "assistant") {
    const assistant = message as AssistantMessage;
    if (assistant.isStreaming) return true;
    return (assistant.content?.trim().length ?? 0) > 0 || (assistant.reasoning?.trim().length ?? 0) > 0;
  }
  if (message.role === "user" || message.role === "system") {
    return message.content.trim().length > 0;
  }
  return true;
}

function sanitizeMessage(message: ChatMessage): ChatMessage {
  const safeId =
    typeof (message as { id?: unknown }).id === "string" &&
    (message as { id?: string }).id!.length > 0
      ? (message as { id: string }).id
      : `${message.role}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const safeTimestamp =
    typeof (message as { timestamp?: unknown }).timestamp === "number" &&
    Number.isFinite((message as { timestamp: number }).timestamp)
      ? (message as { timestamp: number }).timestamp
      : Date.now();

  if (message.role === "assistant") {
    const assistant = message as AssistantMessage & {
      content?: unknown;
      reasoning?: unknown;
    };
    return {
      ...assistant,
      id: safeId,
      timestamp: safeTimestamp,
      content: sanitizeDisplayText(coerceText(assistant.content)),
      reasoning:
        assistant.reasoning === undefined
          ? undefined
          : sanitizeDisplayText(coerceText(assistant.reasoning)),
    };
  }

  if (message.role === "user" || message.role === "system") {
    return {
      ...message,
      id: safeId,
      timestamp: safeTimestamp,
      content: sanitizeDisplayText(coerceText((message as { content?: unknown }).content)),
    };
  }

  return {
    ...message,
    id: safeId,
    timestamp: safeTimestamp,
  };
}

export interface ChatState {
  // Selection
  selectedAgentId: string | null;
  selectedSessionId: string | null;
  selectedModelId: string | null;
  focusMode: boolean;
  sidebarOpen: boolean;
  sidebarContent: string | null;
  sidebarRawContent: string | null;
  sidebarError: string | null;
  splitRatio: number;

  // Messages keyed by session key
  messagesBySession: Record<string, ChatMessage[]>;
  toolMessagesBySession: Record<string, unknown[]>;
  attachmentsBySession: Record<string, ChatAttachment[]>;
  compactionStatusBySession: Record<string, CompactionStatus | null>;
  fallbackStatusBySession: Record<string, FallbackStatus | null>;

  // Streaming state
  isStreaming: boolean;
  streamingMessageId: string | null;
  streamingSessionKey: string | null;
  streamingRunId: string | null;
  /** Maps server session UUIDs → store session keys for event routing */
  streamSessionMap: Record<string, string>;

  // Draft inputs keyed by session key
  draftBySession: Record<string, string>;
  // Recent user-send timestamp keyed by session key
  lastSentAtBySession: Record<string, number>;

  // Actions: Selection
  selectAgent: (agentId: string | null) => void;
  selectSession: (sessionId: string | null) => void;
  setSelectedModel: (modelId: string | null) => void;
  setFocusMode: (value: boolean) => void;
  toggleFocusMode: () => void;
  openSidebar: (content: string, error?: string | null, rawContent?: string | null) => void;
  closeSidebar: () => void;
  setSplitRatio: (ratio: number) => void;

  // Actions: Messages
  setMessages: (sessionKey: string, messages: ChatMessage[]) => void;
  addMessage: (sessionKey: string, message: ChatMessage) => void;
  clearSession: (sessionKey: string) => void;
  setToolMessages: (sessionKey: string, messages: unknown[]) => void;
  clearToolMessages: (sessionKey: string) => void;
  setCompactionStatus: (sessionKey: string, status: CompactionStatus | null) => void;
  setFallbackStatus: (sessionKey: string, status: FallbackStatus | null) => void;

  // Actions: Streaming
  startStreaming: (sessionKey: string, messageId: string, runId?: string | null) => void;
  /** Replace entire content of a streaming message (for cumulative text) */
  setStreamContent: (
    sessionKey: string,
    messageId: string,
    content: string,
  ) => void;
  appendStreamDelta: (
    sessionKey: string,
    messageId: string,
    delta: string,
    target: "content" | "reasoning",
  ) => void;
  finalizeStream: (
    sessionKey: string,
    messageId: string,
    finalContent?: string,
  ) => void;
  stopStreaming: () => void;

  // Actions: Session mapping
  mapSession: (serverSessionId: string, sessionKey: string) => void;
  resolveSessionKey: (serverSessionId: string) => string | null;

  // Actions: Tool calls
  updateToolCall: (
    sessionKey: string,
    toolCallId: string,
    updates: Partial<ToolCallMessage>,
  ) => void;

  // Actions: Drafts
  setDraft: (sessionKey: string, draft: string) => void;
  setAttachments: (sessionKey: string, attachments: ChatAttachment[]) => void;
  markSessionSent: (sessionKey: string, ts: number) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  selectedAgentId: null,
  selectedSessionId: null,
  selectedModelId: null,
  focusMode: false,
  sidebarOpen: false,
  sidebarContent: null,
  sidebarRawContent: null,
  sidebarError: null,
  splitRatio: 0.62,
  messagesBySession: {},
  toolMessagesBySession: {},
  attachmentsBySession: {},
  compactionStatusBySession: {},
  fallbackStatusBySession: {},
  isStreaming: false,
  streamingMessageId: null,
  streamingSessionKey: null,
  streamingRunId: null,
  streamSessionMap: {},
  draftBySession: {},
  lastSentAtBySession: {},

  // --- Selection ---

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
  },

  selectSession: (sessionId) => {
    set((state) =>
      state.selectedSessionId === sessionId
        ? state
        : { selectedSessionId: sessionId },
    );
  },

  setSelectedModel: (modelId) => {
    set((state) =>
      state.selectedModelId === modelId
        ? state
        : { selectedModelId: modelId },
    );
  },

  setFocusMode: (value) => {
    set((state) => (state.focusMode === value ? state : { focusMode: value }));
  },

  toggleFocusMode: () => {
    set((state) => ({ focusMode: !state.focusMode }));
  },

  openSidebar: (content, error = null, rawContent = null) => {
    set((state) => {
      const nextError = error ?? null;
      if (
        state.sidebarOpen &&
        state.sidebarContent === content &&
        state.sidebarRawContent === rawContent &&
        state.sidebarError === nextError
      ) {
        return state;
      }
      return {
        sidebarOpen: true,
        sidebarContent: content,
        sidebarRawContent: rawContent,
        sidebarError: nextError,
      };
    });
  },

  closeSidebar: () => {
    set((state) =>
      !state.sidebarOpen &&
      state.sidebarContent === null &&
      state.sidebarRawContent === null &&
      state.sidebarError === null
        ? state
        : { sidebarOpen: false, sidebarContent: null, sidebarRawContent: null, sidebarError: null },
    );
  },

  setSplitRatio: (ratio) => {
    const clamped = Math.min(0.82, Math.max(0.35, ratio));
    set((state) => (state.splitRatio === clamped ? state : { splitRatio: clamped }));
  },

  // --- Messages ---

  setMessages: (sessionKey, messages) => {
    const normalized = normalizeMessagesForStore(messages);
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionKey]: normalized,
      },
    }));
  },

  addMessage: (sessionKey, message) => {
    const sanitizedMessage = sanitizeMessage(message);
    if (!shouldKeepMessage(sanitizedMessage)) {
      return;
    }
    set((s) => {
      const existing = s.messagesBySession[sessionKey] ?? [];
      const normalized = normalizeMessagesForStore([...existing, sanitizedMessage]);
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionKey]: normalized,
        },
      };
    });
  },

  clearSession: (sessionKey) => {
    set((s) => {
      const rest = { ...s.messagesBySession };
      const toolRest = { ...s.toolMessagesBySession };
      const draftRest = { ...s.draftBySession };
      const attachmentRest = { ...s.attachmentsBySession };
      const compactionRest = { ...s.compactionStatusBySession };
      const fallbackRest = { ...s.fallbackStatusBySession };
      delete rest[sessionKey];
      delete toolRest[sessionKey];
      delete draftRest[sessionKey];
      delete attachmentRest[sessionKey];
      delete compactionRest[sessionKey];
      delete fallbackRest[sessionKey];
      return {
        messagesBySession: rest,
        toolMessagesBySession: toolRest,
        draftBySession: draftRest,
        attachmentsBySession: attachmentRest,
        compactionStatusBySession: compactionRest,
        fallbackStatusBySession: fallbackRest,
      };
    });
  },

  setToolMessages: (sessionKey, messages) => {
    set((s) => ({
      toolMessagesBySession: {
        ...s.toolMessagesBySession,
        [sessionKey]: messages,
      },
    }));
  },

  clearToolMessages: (sessionKey) => {
    set((s) => ({
      toolMessagesBySession: {
        ...s.toolMessagesBySession,
        [sessionKey]: [],
      },
    }));
  },

  setCompactionStatus: (sessionKey, status) => {
    set((s) => ({
      compactionStatusBySession: {
        ...s.compactionStatusBySession,
        [sessionKey]: status,
      },
    }));
  },

  setFallbackStatus: (sessionKey, status) => {
    set((s) => ({
      fallbackStatusBySession: {
        ...s.fallbackStatusBySession,
        [sessionKey]: status,
      },
    }));
  },

  // --- Streaming ---

  startStreaming: (sessionKey, messageId, runId) => {
    set({
      isStreaming: true,
      streamingMessageId: messageId,
      streamingSessionKey: sessionKey,
      streamingRunId: runId ?? null,
    });
    const msgs = get().messagesBySession[sessionKey];
    if (!msgs) return;
    const updated = msgs.map((m) =>
      m.id === messageId && m.role === "assistant"
        ? { ...m, isStreaming: true }
        : m,
    );
    set((s) => ({
      messagesBySession: { ...s.messagesBySession, [sessionKey]: updated },
    }));
  },

  setStreamContent: (sessionKey, messageId, content) => {
    set((s) => {
      const msgs = s.messagesBySession[sessionKey];
      if (!msgs) return s;

      const updated = msgs.map((m) => {
        if (m.id !== messageId || m.role !== "assistant") return m;
        return { ...m, content } as AssistantMessage;
      });

      return {
        messagesBySession: { ...s.messagesBySession, [sessionKey]: updated },
      };
    });
  },

  appendStreamDelta: (sessionKey, messageId, delta, target) => {
    set((s) => {
      const msgs = s.messagesBySession[sessionKey];
      if (!msgs) return s;

      const updated = msgs.map((m) => {
        if (m.id !== messageId || m.role !== "assistant") return m;
        const am = m as AssistantMessage;
        if (target === "content") {
          return { ...am, content: am.content + delta };
        } else {
          return { ...am, reasoning: (am.reasoning ?? "") + delta };
        }
      });

      return {
        messagesBySession: { ...s.messagesBySession, [sessionKey]: updated },
      };
    });
  },

  finalizeStream: (sessionKey, messageId, finalContent) => {
    set((s) => {
      const msgs = s.messagesBySession[sessionKey];
      if (!msgs) {
        return {
          isStreaming: false,
          streamingMessageId: null,
          streamingSessionKey: null,
          streamingRunId: null,
        };
      }

      const updated = msgs.map((m) => {
        if (m.id !== messageId || m.role !== "assistant") return m;
        const am = m as AssistantMessage;
        return {
          ...am,
          isStreaming: false,
          ...(finalContent !== undefined ? { content: finalContent } : {}),
        };
      });
      const normalized = normalizeMessagesForStore(updated);

      return {
        messagesBySession: { ...s.messagesBySession, [sessionKey]: normalized },
        isStreaming: false,
        streamingMessageId: null,
        streamingSessionKey: null,
        streamingRunId: null,
      };
    });
  },

  stopStreaming: () => {
    const { streamingMessageId, streamingSessionKey } = get();
    if (streamingMessageId && streamingSessionKey) {
      get().finalizeStream(streamingSessionKey, streamingMessageId);
    } else {
      set({
        isStreaming: false,
        streamingMessageId: null,
        streamingSessionKey: null,
        streamingRunId: null,
      });
    }
  },

  // --- Session mapping ---

  mapSession: (serverSessionId, sessionKey) => {
    set((s) => ({
      streamSessionMap: {
        ...s.streamSessionMap,
        [serverSessionId]: sessionKey,
      },
    }));
  },

  resolveSessionKey: (serverSessionId) => {
    const map = get().streamSessionMap;
    return map[serverSessionId] ?? null;
  },

  // --- Tool calls ---

  updateToolCall: (sessionKey, toolCallId, updates) => {
    set((s) => {
      const msgs = s.messagesBySession[sessionKey];
      if (!msgs) return s;

      const updated = msgs.map((m) => {
        if (m.role !== "tool") return m;
        const tm = m as ToolCallMessage;
        if (tm.toolCallId !== toolCallId) return m;
        return { ...tm, ...updates };
      });

      return {
        messagesBySession: { ...s.messagesBySession, [sessionKey]: updated },
      };
    });
  },

  // --- Drafts ---

  setDraft: (sessionKey, draft) => {
    set((s) => ({
      draftBySession: { ...s.draftBySession, [sessionKey]: draft },
    }));
  },

  setAttachments: (sessionKey, attachments) => {
    set((s) => ({
      attachmentsBySession: { ...s.attachmentsBySession, [sessionKey]: attachments },
    }));
  },

  markSessionSent: (sessionKey, ts) => {
    set((s) => ({
      lastSentAtBySession: { ...s.lastSentAtBySession, [sessionKey]: ts },
    }));
  },
}));
