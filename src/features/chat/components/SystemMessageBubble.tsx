// SystemMessageBubble — centered system message

import { memo } from "react";
import type { SystemMessage } from "@/lib/gateway";
import { MessageCopyButton } from "./MessageCopyButton";

interface SystemMessageBubbleProps {
  message: SystemMessage;
}

export const SystemMessageBubble = memo(function SystemMessageBubble({
  message,
}: SystemMessageBubbleProps) {
  return (
    <div className="flex justify-center">
      <div className="group relative rounded-full border border-border/70 bg-surface-1 px-4 py-1.5 pr-8 text-xs text-text-secondary">
        <MessageCopyButton
          text={message.content}
          className="absolute right-1 top-1/2 -translate-y-1/2 text-text-tertiary opacity-0 hover:bg-surface-3 hover:text-text-primary group-hover:opacity-100"
        />
        {message.content}
      </div>
    </div>
  );
});
