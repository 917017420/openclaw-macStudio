import { useQuery } from "@tanstack/react-query";
import { useConnectionStore } from "@/features/connection/store";
import { extractMessagesFromResponse } from "@/features/chat/utils/message-pipeline";
import type { ChatMessage, MessageToolCard } from "@/lib/gateway";
import { gateway } from "@/lib/gateway";
import { normalizeSessionsPreview, type SessionPreviewItem } from "../types";

export interface SessionTranscriptItem {
  role: SessionPreviewItem["role"];
  text: string;
}

export interface SessionTranscriptSnapshot {
  source: "history" | "preview";
  status: "ok" | "empty" | "missing" | "error";
  items: SessionTranscriptItem[];
}

function asText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => asText(entry)).filter(Boolean).join(" ");
  }
  if (!value || typeof value !== "object") {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function summarizeToolCards(cards: MessageToolCard[] | undefined): string {
  if (!cards || cards.length === 0) {
    return "";
  }

  return cards
    .map((card) => {
      const detail = asText(card.text ?? card.error ?? card.args).trim();
      return detail ? `${card.name}: ${detail}` : card.name;
    })
    .filter(Boolean)
    .join(" · ");
}

function messageToTranscriptItem(message: ChatMessage): SessionTranscriptItem | null {
  if (message.role === "user" || message.role === "system") {
    const text = message.content.trim();
    return text ? { role: message.role, text } : null;
  }

  if (message.role === "assistant") {
    const text = message.content.trim() || message.reasoning?.trim() || summarizeToolCards(message.toolCards);
    return text ? { role: "assistant", text } : null;
  }

  if (message.role === "tool") {
    const detail = asText(message.error ?? message.output ?? message.input).trim();
    const prefix = `${message.toolName} (${message.status})`;
    return {
      role: "tool",
      text: detail ? `${prefix}: ${detail}` : prefix,
    };
  }

  return null;
}

function normalizeHistoryItems(raw: unknown, sessionKey: string): SessionTranscriptItem[] {
  return extractMessagesFromResponse(raw, sessionKey)
    .map((message) => messageToTranscriptItem(message))
    .filter((message): message is SessionTranscriptItem => Boolean(message));
}

export function useSessionTranscript(sessionKey: string | null) {
  const isConnected = useConnectionStore((state) => state.state === "connected");

  return useQuery<SessionTranscriptSnapshot>({
    queryKey: ["workspace-session-transcript", sessionKey ?? ""],
    enabled: isConnected && Boolean(sessionKey),
    staleTime: 15_000,
    queryFn: async () => {
      if (!sessionKey) {
        return { source: "preview", status: "empty", items: [] };
      }

      try {
        const historyRaw = await gateway.request<unknown>("chat.history", { sessionKey });
        const items = normalizeHistoryItems(historyRaw, sessionKey);
        return {
          source: "history",
          status: items.length > 0 ? "ok" : "empty",
          items,
        };
      } catch {
        const previewRaw = await gateway.request<unknown>("sessions.preview", {
          keys: [sessionKey],
          limit: 24,
          maxChars: 240,
        });
        const previewSnapshot = normalizeSessionsPreview(previewRaw);
        const previewEntry = previewSnapshot.previews.find((entry) => entry.key === sessionKey)
          ?? previewSnapshot.previews[0]
          ?? null;

        return {
          source: "preview",
          status: previewEntry?.status ?? "missing",
          items: previewEntry?.items ?? [],
        };
      }
    },
  });
}
