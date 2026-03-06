// UserMessageBubble — right-aligned user message

import { memo } from "react";
import type { UserMessage } from "@/lib/gateway";
import { MessageCopyButton } from "./MessageCopyButton";

interface UserMessageBubbleProps {
  message: UserMessage;
}

export const UserMessageBubble = memo(function UserMessageBubble({
  message,
}: UserMessageBubbleProps) {
  return (
    <div className="flex justify-end">
      <div className="group relative max-w-[78%] rounded-2xl rounded-br-md bg-chat-user-bubble px-4 py-3 text-sm leading-relaxed text-text-inverse shadow-[0_10px_22px_rgba(11,118,229,0.35)]">
        <MessageCopyButton
          text={message.content}
          className="absolute right-2 top-2 text-text-inverse/80 opacity-0 hover:bg-white/15 hover:text-text-inverse group-hover:opacity-100"
        />
        <span className="whitespace-pre-wrap break-words">{message.content}</span>
      </div>
    </div>
  );
});
