import { memo } from "react";
import type { UserMessage } from "@/lib/gateway";
import { MessageCopyButton } from "./MessageCopyButton";

interface UserMessageBubbleProps {
  message: UserMessage;
}

export const UserMessageBubble = memo(function UserMessageBubble({ message }: UserMessageBubbleProps) {
  return (
    <div className="chat-bubble user group">
      <MessageCopyButton
        text={message.content}
        className="absolute right-2 top-2 text-white/80 opacity-0 group-hover:opacity-100"
      />
      <span className="whitespace-pre-wrap break-words">{message.content}</span>
    </div>
  );
});
