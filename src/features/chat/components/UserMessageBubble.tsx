// UserMessageBubble — right-aligned user message

import { memo } from "react";
import type { UserMessage } from "@/lib/gateway";

interface UserMessageBubbleProps {
  message: UserMessage;
}

export const UserMessageBubble = memo(function UserMessageBubble({
  message,
}: UserMessageBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[75%] rounded-2xl rounded-br-md bg-chat-user-bubble px-4 py-2.5 text-sm leading-relaxed text-text-inverse">
        <span className="whitespace-pre-wrap break-words">{message.content}</span>
      </div>
    </div>
  );
});
