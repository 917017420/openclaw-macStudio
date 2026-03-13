import { memo } from "react";
import { LoaderCircle, X } from "lucide-react";
import type { ChatAttachment, ChatMessage } from "@/lib/gateway";
import { MessageCopyButton } from "@/features/chat/components/MessageCopyButton";
import { MarkdownRenderer } from "@/features/chat/components/MarkdownRenderer";
import { StreamingIndicator } from "@/features/chat/components/StreamingIndicator";
import { ThinkingBlock } from "@/features/chat/components/ThinkingBlock";
import type { QueuedChatMessage } from "@/features/chat/store";
import {
  extractImages,
  extractTextCached,
  extractThinkingCached,
  extractToolCards,
  getToolCallId,
  isToolResultMessage,
  normalizeRoleForGrouping,
} from "./message-normalizer";
import { ToolCardView } from "./tool-cards";

export type ChatItem =
  | { kind: "divider"; key: string; label: string; timestamp: number }
  | { kind: "stream"; key: string; text: string; startedAt: number }
  | { kind: "reading-indicator"; key: string }
  | { kind: "message"; key: string; message: unknown };

export type MessageGroup = {
  kind: "group";
  key: string;
  role: string;
  messages: Array<{ message: unknown; key: string }>;
  timestamp: number;
  isStreaming: boolean;
};

export type QueuedThreadItem = {
  kind: "queue";
  key: string;
  queueItem: QueuedChatMessage;
  index: number;
  total: number;
};

export type ThreadItem = ChatItem | MessageGroup | QueuedThreadItem;

const CHAT_HISTORY_RENDER_LIMIT = 200;

type BuildChatItemsOptions = {
  messages: ChatMessage[];
  toolMessages?: unknown[];
  streamingText?: string | null;
  streamStartedAt?: number | null;
  queuedMessages?: QueuedChatMessage[];
};

function messageKey(message: unknown, index: number): string {
  const m = message as Record<string, unknown>;
  const toolCallId = getToolCallId(message);
  if (toolCallId) {
    return `tool:${toolCallId}`;
  }
  const id = typeof m.id === "string" ? m.id : "";
  if (id) {
    return `msg:${id}`;
  }
  const timestamp = typeof m.timestamp === "number" ? m.timestamp : null;
  const role = typeof m.role === "string" ? m.role : "unknown";
  if (timestamp != null) {
    return `msg:${role}:${timestamp}:${index}`;
  }
  return `msg:${role}:${index}`;
}

function groupMessages(items: ChatItem[]): Array<ChatItem | MessageGroup> {
  const result: Array<ChatItem | MessageGroup> = [];
  let currentGroup: MessageGroup | null = null;

  for (const item of items) {
    if (item.kind !== "message") {
      if (currentGroup) {
        result.push(currentGroup);
        currentGroup = null;
      }
      result.push(item);
      continue;
    }

    const message = item.message as Record<string, unknown>;
    const role = normalizeRoleForGrouping(typeof message.role === "string" ? message.role : "unknown");
    const timestamp = typeof message.timestamp === "number" ? message.timestamp : Date.now();

    if (!currentGroup || currentGroup.role !== role) {
      if (currentGroup) {
        result.push(currentGroup);
      }
      currentGroup = {
        kind: "group",
        key: `group:${role}:${item.key}`,
        role,
        messages: [{ message: item.message, key: item.key }],
        timestamp,
        isStreaming: false,
      };
    } else {
      currentGroup.messages.push({ message: item.message, key: item.key });
      currentGroup.timestamp = timestamp;
    }
  }

  if (currentGroup) {
    result.push(currentGroup);
  }

  return result;
}

export function buildChatItems(options: BuildChatItemsOptions): ThreadItem[] {
  const items: ChatItem[] = [];
  const history = Array.isArray(options.messages) ? options.messages : [];
  const tools = Array.isArray(options.toolMessages) ? options.toolMessages : [];
  const historyStart = Math.max(0, history.length - CHAT_HISTORY_RENDER_LIMIT);

  if (historyStart > 0) {
    items.push({
      kind: "message",
      key: "chat:history:notice",
      message: {
        role: "system",
        content: `Showing last ${CHAT_HISTORY_RENDER_LIMIT} messages (${historyStart} hidden).`,
        timestamp: Date.now(),
      },
    });
  }

  const historyToolIds = new Set<string>();
  for (let i = historyStart; i < history.length; i++) {
    const message = history[i];
    const raw = (message.raw && typeof message.raw === "object"
      ? message.raw
      : message) as Record<string, unknown>;
    const marker = raw.__openclaw as Record<string, unknown> | undefined;
    if (marker && marker.kind === "compaction") {
      items.push({
        kind: "divider",
        key:
          typeof marker.id === "string"
            ? `divider:compaction:${marker.id}`
            : `divider:compaction:${Date.now()}:${i}`,
        label: "Compaction",
        timestamp: typeof raw.timestamp === "number" ? raw.timestamp : Date.now(),
      });
      continue;
    }
    const historyToolCallId = getToolCallId(message);
    if (historyToolCallId) {
      historyToolIds.add(historyToolCallId);
    }
    items.push({ kind: "message", key: messageKey(message, i), message });
  }

  for (let i = 0; i < tools.length; i++) {
    const toolCallId = getToolCallId(tools[i]);
    if (toolCallId && historyToolIds.has(toolCallId)) {
      continue;
    }
    items.push({ kind: "message", key: messageKey(tools[i], history.length + i), message: tools[i] });
  }

  if (options.streamingText !== null && options.streamingText !== undefined) {
    const key = `stream:${options.streamStartedAt ?? "live"}`;
    if (options.streamingText.trim().length > 0) {
      items.push({
        kind: "stream",
        key,
        text: options.streamingText,
        startedAt: options.streamStartedAt ?? Date.now(),
      });
    } else {
      items.push({ kind: "reading-indicator", key });
    }
  }

  const grouped = groupMessages(items);
  const queuedMessages = Array.isArray(options.queuedMessages) ? options.queuedMessages : [];
  if (queuedMessages.length === 0) {
    return grouped;
  }

  return [
    ...grouped,
    ...queuedMessages.map(
      (queueItem, index): QueuedThreadItem => ({
        kind: "queue",
        key: `queue:${queueItem.id}`,
        queueItem,
        index,
        total: queuedMessages.length,
      }),
    ),
  ];
}

function openAttachment(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

function formatReasoningMarkdown(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed;
}

function Avatar({ role, assistantName, assistantAvatar }: { role: string; assistantName: string; assistantAvatar?: string | null }) {
  const normalized = normalizeRoleForGrouping(role);
  const initial =
    normalized === "user"
      ? "U"
      : normalized === "assistant"
        ? assistantName.charAt(0).toUpperCase() || "A"
        : normalized === "tool"
          ? "⚙"
          : "?";
  const className =
    normalized === "user"
      ? "user"
      : normalized === "assistant"
        ? "assistant"
        : normalized === "tool"
          ? "tool"
          : "other";

  if (normalized === "assistant" && assistantAvatar) {
    if (/^(https?:\/\/|data:image\/|\/)/i.test(assistantAvatar)) {
      return <img className={`chat-avatar ${className}`} src={assistantAvatar} alt={assistantName} />;
    }
    return <div className={`chat-avatar ${className}`}>{assistantAvatar}</div>;
  }

  return <div className={`chat-avatar ${className}`}>{initial}</div>;
}

function MessageImages({ message }: { message: unknown }) {
  const images = extractImages(message);
  if (images.length === 0) {
    return null;
  }
  return (
    <div className="chat-message-images">
      {images.map((image) => (
        <img
          key={image.id}
          src={image.dataUrl}
          alt={image.alt ?? "Attached image"}
          className="chat-message-image"
          onClick={() => openAttachment(image.dataUrl)}
        />
      ))}
    </div>
  );
}

function QueuedMessageImages({ attachments }: { attachments: ChatAttachment[] }) {
  if (attachments.length === 0) {
    return null;
  }

  return (
    <div className="chat-message-images chat-queue-bubble__images">
      {attachments.map((attachment) => (
        <img
          key={attachment.id}
          src={attachment.dataUrl}
          alt={attachment.alt ?? "Queued attachment"}
          className="chat-message-image"
          onClick={() => openAttachment(attachment.dataUrl)}
        />
      ))}
    </div>
  );
}

const RenderGroupedMessage = memo(function RenderGroupedMessage({
  message,
  isStreaming,
  showReasoning,
  onOpenSidebar,
}: {
  message: unknown;
  isStreaming: boolean;
  showReasoning: boolean;
  onOpenSidebar?: (content: string, error?: string | null, rawContent?: string | null) => void;
}) {
  const raw = message as Record<string, unknown>;
  const role = typeof raw.role === "string" ? raw.role : "unknown";
  const isToolOnly = isToolResultMessage(message);
  const toolCards = extractToolCards(message);
  const text = extractTextCached(message);
  const thinking = showReasoning && role === "assistant" ? extractThinkingCached(message) : null;
  const canCopyMarkdown = role === "assistant" && Boolean(text?.trim());

  if (!text && toolCards.length > 0 && isToolOnly) {
    return <>{toolCards.map((card, index) => <ToolCardView key={`${card.name}:${index}`} card={card} onOpenSidebar={onOpenSidebar} />)}</>;
  }

  if (!text && toolCards.length === 0 && extractImages(message).length === 0 && !thinking) {
    return null;
  }

  return (
    <div className={`chat-bubble fade-in ${isStreaming ? "streaming" : ""} ${canCopyMarkdown ? "has-copy" : ""}`}>
      {canCopyMarkdown ? <MessageCopyButton text={text ?? ""} className="chat-copy-btn" title="Copy as markdown" /> : null}
      <MessageImages message={message} />
      {thinking ? <ThinkingBlock reasoning={formatReasoningMarkdown(thinking)} isStreaming={isStreaming && !text} /> : null}
      {text ? <MarkdownRenderer content={text} plainMode={isStreaming} /> : isStreaming ? <StreamingIndicator /> : null}
      {toolCards.map((card, index) => (
        <ToolCardView key={`${card.name}:${card.kind}:${index}`} card={card} onOpenSidebar={onOpenSidebar} />
      ))}
    </div>
  );
});

export function ReadingIndicatorGroup({ assistantName, assistantAvatar }: { assistantName: string; assistantAvatar?: string | null }) {
  return (
    <div className="chat-group assistant">
      <Avatar role="assistant" assistantName={assistantName} assistantAvatar={assistantAvatar} />
      <div className="chat-group-messages">
        <div className="chat-bubble chat-reading-indicator" aria-hidden="true">
          <span className="chat-reading-indicator__dots">
            <span />
            <span />
            <span />
          </span>
        </div>
      </div>
    </div>
  );
}

export function StreamingGroup({
  text,
  startedAt,
  assistantName,
  assistantAvatar,
  onOpenSidebar,
}: {
  text: string;
  startedAt: number;
  assistantName: string;
  assistantAvatar?: string | null;
  onOpenSidebar?: (content: string, error?: string | null, rawContent?: string | null) => void;
}) {
  const timestamp = new Date(startedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return (
    <div className="chat-group assistant">
      <Avatar role="assistant" assistantName={assistantName} assistantAvatar={assistantAvatar} />
      <div className="chat-group-messages">
        <RenderGroupedMessage
          message={{ role: "assistant", content: text, timestamp: startedAt }}
          isStreaming={true}
          showReasoning={false}
          onOpenSidebar={onOpenSidebar}
        />
        <div className="chat-group-footer">
          <span className="chat-sender-name">{assistantName}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
        </div>
      </div>
    </div>
  );
}

export function MessageGroupView({
  group,
  assistantName,
  assistantAvatar,
  onOpenSidebar,
  showReasoning,
}: {
  group: MessageGroup;
  assistantName: string;
  assistantAvatar?: string | null;
  onOpenSidebar?: (content: string, error?: string | null, rawContent?: string | null) => void;
  showReasoning: boolean;
}) {
  const normalizedRole = normalizeRoleForGrouping(group.role);
  const who = normalizedRole === "user" ? "You" : normalizedRole === "assistant" ? assistantName : normalizedRole;
  const roleClass = normalizedRole === "user" ? "user" : normalizedRole === "assistant" ? "assistant" : "other";
  const timestamp = new Date(group.timestamp).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

  return (
    <div className={`chat-group ${roleClass}`}>
      <Avatar role={group.role} assistantName={assistantName} assistantAvatar={assistantAvatar} />
      <div className="chat-group-messages">
        {group.messages.map((item, index) => (
          <RenderGroupedMessage
            key={item.key}
            message={item.message}
            isStreaming={group.isStreaming && index === group.messages.length - 1}
            showReasoning={showReasoning}
            onOpenSidebar={onOpenSidebar}
          />
        ))}
        <div className="chat-group-footer">
          <span className="chat-sender-name">{who}</span>
          <span className="chat-group-timestamp">{timestamp}</span>
        </div>
      </div>
    </div>
  );
}

export function QueuedMessageGroup({
  item,
  onRemove,
}: {
  item: QueuedThreadItem;
  onRemove: (id: string) => void;
}) {
  const timestamp = new Date(item.queueItem.createdAt).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
  const attachmentCount = item.queueItem.attachments.length;
  const attachmentSummary =
    attachmentCount > 0
      ? `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`
      : null;

  return (
    <div className="chat-group user chat-group--queued">
      <Avatar role="user" assistantName="Assistant" />
      <div className="chat-group-messages">
        <div className="chat-bubble chat-queue-bubble fade-in">
          <div className="chat-queue-bubble__meta">
            <span className="chat-queue-badge">
              <LoaderCircle size={12} className="animate-spin" />
              Queued
            </span>
            {item.total > 1 ? (
              <span className="chat-queue-bubble__count">
                {item.index + 1}/{item.total}
              </span>
            ) : null}
          </div>

          <QueuedMessageImages attachments={item.queueItem.attachments} />

          {item.queueItem.text ? (
            <div className="chat-queue-bubble__text">{item.queueItem.text}</div>
          ) : attachmentSummary ? (
            <div className="chat-queue-bubble__text muted">{attachmentSummary}</div>
          ) : null}

          <div className="chat-queue-bubble__footer">
            <span className="chat-queue-bubble__timestamp">{timestamp}</span>
            <button
              type="button"
              className="composer-btn chat-queue-bubble__remove"
              onClick={() => onRemove(item.queueItem.id)}
              aria-label="Remove queued message"
              title="Remove queued message"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        <div className="chat-group-footer">
          <span className="chat-sender-name">You</span>
          <span className="chat-group-timestamp">Queued</span>
        </div>
      </div>
    </div>
  );
}
