import { memo, useMemo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useAutoScroll } from "@/features/chat/hooks/useAutoScroll";
import type { ChatMessage } from "@/lib/gateway";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";

type Group = {
  role: "user" | "assistant" | "tool" | "system";
  items: ChatMessage[];
};

function groupMessages(messages: ChatMessage[]): Group[] {
  const groups: Group[] = [];
  for (const m of messages) {
    const role = m.role;
    const last = groups[groups.length - 1];
    if (!last || last.role !== role || role === "system") {
      groups.push({ role, items: [m] });
      continue;
    }
    last.items.push(m);
  }
  return groups;
}

function avatarForRole(role: Group["role"]): string {
  if (role === "user") return "U";
  if (role === "assistant") return "A";
  if (role === "tool") return "⚙";
  return "S";
}

const EMPTY_MESSAGES: ChatMessage[] = [];

export const MessageList = memo(function MessageList() {
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const messagesRaw = useChatStore((s) =>
    selectedSessionId ? s.messagesBySession[selectedSessionId] : undefined,
  );
  const messages = messagesRaw ?? EMPTY_MESSAGES;
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);

  const grouped = useMemo(() => groupMessages(messages), [messages]);
  const lastMessageId = messages[messages.length - 1]?.id;

  const { containerRef } = useAutoScroll<HTMLDivElement>({
    deps: [messages.length, isStreaming, lastMessageId],
  });

  const isPolling = isStreaming && streamingMessageId === "__polling__";

  if (messages.length === 0) {
    return (
      <div ref={containerRef} className="chat-thread">
        <div className="chat-system-chip">Start a conversation</div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="chat-thread">
      {grouped.map((group, groupIndex) => {
        if (group.role === "system") {
          return (
            <div key={`sys-${groupIndex}`} style={{ display: "grid", gap: 8 }}>
              {group.items.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
            </div>
          );
        }

        const ts = group.items[group.items.length - 1]?.timestamp ?? Date.now();
        const time = new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

        return (
          <div key={`${group.role}-${groupIndex}`} className={`chat-group ${group.role === "user" ? "user" : ""}`}>
            <div className={`chat-avatar ${group.role === "user" ? "user" : group.role === "assistant" ? "assistant" : "other"}`}>
              {avatarForRole(group.role)}
            </div>
            <div className="chat-group-messages">
              {group.items.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              <div className="chat-group-footer">
                <span>{group.role === "user" ? "You" : group.role === "assistant" ? "Assistant" : "Tool"}</span>
                <span>{time}</span>
              </div>
            </div>
          </div>
        );
      })}

      {isPolling ? (
        <div className="chat-group">
          <div className="chat-avatar assistant">A</div>
          <div className="chat-group-messages">
            <div className="chat-bubble">
              <StreamingIndicator />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
});
