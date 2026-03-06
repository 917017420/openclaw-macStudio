import { memo } from "react";
import type { SystemMessage } from "@/lib/gateway";

interface SystemMessageBubbleProps {
  message: SystemMessage;
}

export const SystemMessageBubble = memo(function SystemMessageBubble({ message }: SystemMessageBubbleProps) {
  return <div className="chat-system-chip">{message.content}</div>;
});
