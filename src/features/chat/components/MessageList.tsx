// MessageList — scrollable message list with auto-scroll

import { memo, useMemo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useAutoScroll } from "@/features/chat/hooks/useAutoScroll";
import { MessageBubble } from "./MessageBubble";
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

  const lastMessageId = useMemo(
    () => messages[messages.length - 1]?.id,
    [messages],
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
      </div>
    </div>
  );
});
