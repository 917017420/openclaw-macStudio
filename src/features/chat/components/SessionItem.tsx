// SessionItem — single session row in the sidebar list

import { memo } from "react";
import type { ChatSession } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
}

export const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onSelect,
}: SessionItemProps) {
  return (
    <button
      onClick={() => onSelect(session.id)}
      className={cn(
        "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors",
        isActive
          ? "bg-primary-light text-primary"
          : "text-text-primary hover:bg-surface-2",
      )}
    >
      <span className="truncate text-sm font-medium">
        {session.title || "Untitled"}
      </span>
      <div className="flex items-center justify-between">
        <span className="text-xs text-text-tertiary">
          {session.messageCount} messages
        </span>
        <span className="text-xs text-text-tertiary">
          {formatRelativeTime(session.updatedAt)}
        </span>
      </div>
    </button>
  );
});
