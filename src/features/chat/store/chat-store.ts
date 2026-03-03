// Chat store — manages chat UI state, streaming, and messages

import { create } from "zustand";
import type {
  ChatMessage,
  AssistantMessage,
  ToolCallMessage,
} from "@/lib/gateway";

export interface ChatState {
  // Selection
  selectedAgentId: string | null;
  selectedSessionId: string | null;

  // Messages keyed by session key
  messagesBySession: Record<string, ChatMessage[]>;

  // Streaming state
  isStreaming: boolean;
  streamingMessageId: string | null;
  /** Maps server session UUIDs → store session keys for event routing */
  streamSessionMap: Record<string, string>;

  // Draft inputs keyed by session key
  draftBySession: Record<string, string>;

  // Actions: Selection
  selectAgent: (agentId: string | null) => void;
  selectSession: (sessionId: string | null) => void;

  // Actions: Messages
  setMessages: (sessionKey: string, messages: ChatMessage[]) => void;
  addMessage: (sessionKey: string, message: ChatMessage) => void;
  clearSession: (sessionKey: string) => void;

  // Actions: Streaming
  startStreaming: (sessionKey: string, messageId: string) => void;
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
}

export const useChatStore = create<ChatState>((set, get) => ({
  // Initial state
  selectedAgentId: null,
  selectedSessionId: null,
  messagesBySession: {},
  isStreaming: false,
  streamingMessageId: null,
  streamSessionMap: {},
  draftBySession: {},

  // --- Selection ---

  selectAgent: (agentId) => {
    set({ selectedAgentId: agentId });
  },

  selectSession: (sessionId) => {
    set({ selectedSessionId: sessionId });
  },

  // --- Messages ---

  setMessages: (sessionKey, messages) => {
    set((s) => ({
      messagesBySession: {
        ...s.messagesBySession,
        [sessionKey]: messages,
      },
    }));
  },

  addMessage: (sessionKey, message) => {
    console.log("[ChatStore] addMessage:", { sessionKey, role: message.role, id: message.id });
    set((s) => {
      const existing = s.messagesBySession[sessionKey] ?? [];
      return {
        messagesBySession: {
          ...s.messagesBySession,
          [sessionKey]: [...existing, message],
        },
      };
    });
  },

  clearSession: (sessionKey) => {
    set((s) => {
      const { [sessionKey]: _, ...rest } = s.messagesBySession;
      return { messagesBySession: rest };
    });
  },

  // --- Streaming ---

  startStreaming: (sessionKey, messageId) => {
    console.log("[ChatStore] startStreaming:", { sessionKey, messageId });
    set({ isStreaming: true, streamingMessageId: messageId });
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
    console.log("[ChatStore] setStreamContent:", { sessionKey, messageId, contentLen: content.length });
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
    console.log("[ChatStore] finalizeStream:", { sessionKey, messageId, hasFinal: finalContent !== undefined });
    set((s) => {
      const msgs = s.messagesBySession[sessionKey];
      if (!msgs) return { isStreaming: false, streamingMessageId: null };

      const updated = msgs.map((m) => {
        if (m.id !== messageId || m.role !== "assistant") return m;
        const am = m as AssistantMessage;
        return {
          ...am,
          isStreaming: false,
          ...(finalContent !== undefined ? { content: finalContent } : {}),
        };
      });

      return {
        messagesBySession: { ...s.messagesBySession, [sessionKey]: updated },
        isStreaming: false,
        streamingMessageId: null,
      };
    });
  },

  stopStreaming: () => {
    const { streamingMessageId, selectedSessionId } = get();
    if (streamingMessageId && selectedSessionId) {
      get().finalizeStream(selectedSessionId, streamingMessageId);
    } else {
      set({ isStreaming: false, streamingMessageId: null });
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
    if (map[serverSessionId]) return map[serverSessionId];
    // Fallback: use currently selected session
    return get().selectedSessionId;
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
}));
