// SystemMessageBubble — centered system message

import { memo } from "react";
import type { SystemMessage } from "@/lib/gateway";

interface SystemMessageBubbleProps {
  message: SystemMessage;
}

export const SystemMessageBubble = memo(function SystemMessageBubble({
  message,
}: SystemMessageBubbleProps) {
  return (
    <div className="flex justify-center">
      <div className="rounded-full bg-surface-2 px-4 py-1.5 text-xs text-text-secondary">
        {message.content}
      </div>
    </div>
  );
});
