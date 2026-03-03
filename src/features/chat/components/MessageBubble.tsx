// MessageBubble — routes to the correct bubble component based on message role

import { memo } from "react";
import type { ChatMessage } from "@/lib/gateway";
import { UserMessageBubble } from "./UserMessageBubble";
import { AssistantMessageBubble } from "./AssistantMessageBubble";
import { ToolCallBubble } from "./ToolCallBubble";
import { SystemMessageBubble } from "./SystemMessageBubble";
import type { UserMessage, AssistantMessage, ToolCallMessage, SystemMessage } from "@/lib/gateway";

interface MessageBubbleProps {
  message: ChatMessage;
}

export const MessageBubble = memo(function MessageBubble({
  message,
}: MessageBubbleProps) {
  switch (message.role) {
    case "user":
      return <UserMessageBubble message={message as UserMessage} />;
    case "assistant":
      return <AssistantMessageBubble message={message as AssistantMessage} />;
    case "tool":
      return <ToolCallBubble message={message as ToolCallMessage} />;
    case "system":
      return <SystemMessageBubble message={message as SystemMessage} />;
    default:
      return null;
  }
});
