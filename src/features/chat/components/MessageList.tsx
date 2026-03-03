// MessageList — scrollable message list with auto-scroll

import { memo, useMemo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useAutoScroll } from "@/features/chat/hooks/useAutoScroll";
import { MessageBubble } from "./MessageBubble";
import { StreamingIndicator } from "./StreamingIndicator";
import { MessageSquare } from "lucide-react";

/** Stable empty array to avoid new-reference re-render loops in selectors */
const EMPTY_MESSAGES: never[] = [];

export const MessageList = memo(function MessageList() {
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const messagesRaw = useChatStore((s) =>
    selectedSessionId ? s.messagesBySession[selectedSessionId] : undefined,
  );
  const messages = messagesRaw ?? EMPTY_MESSAGES;
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);

  // Show a "waiting" indicator when polling but no assistant message yet
  const isPolling = isStreaming && streamingMessageId === "__polling__";
  const lastMsg = messages[messages.length - 1];
  const showWaiting = isPolling && (!lastMsg || lastMsg.role === "user");

  const lastMessageId = useMemo(
    () => lastMsg?.id,
    [lastMsg],
  );

  const { containerRef } = useAutoScroll<HTMLDivElement>({
    deps: [messages.length, isStreaming, lastMessageId],
  });

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="text-center">
          <MessageSquare size={40} className="mx-auto text-text-tertiary" />
          <p className="mt-3 text-sm text-text-secondary">
            Start a conversation
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto px-4 py-4"
    >
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* Waiting for response indicator */}
        {showWaiting && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-chat-assistant-bubble px-4 py-2.5 shadow-sm ring-1 ring-border/50">
              <StreamingIndicator />
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
