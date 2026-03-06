// SessionItem — single session row in the sidebar list

import { memo, useEffect, useState } from "react";
import type { ChatSession } from "@/lib/gateway";
import { cn } from "@/lib/utils";
import { formatRelativeTime } from "@/lib/utils";
import { Check, Trash2, X } from "lucide-react";

interface SessionItemProps {
  session: ChatSession;
  isActive: boolean;
  onSelect: (sessionId: string) => void;
  onDelete: (sessionId: string) => void;
}

export const SessionItem = memo(function SessionItem({
  session,
  isActive,
  onSelect,
  onDelete,
}: SessionItemProps) {
  const isMainSession = /(^main$)|(:main$)/.test(session.id);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  return (
    <div
      className={cn(
        "group flex w-full items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-all",
        isActive
          ? "border-primary/40 bg-primary-light shadow-sm"
          : "border-border/70 bg-surface-0/70 hover:border-border-hover hover:bg-surface-0",
      )}
    >
      <button
        onClick={() => onSelect(session.id)}
        className="flex min-w-0 flex-1 flex-col gap-0.5 px-1 py-1 text-left"
      >
        <span className="truncate text-sm font-medium text-text-primary">
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
      {!isMainSession && (confirmingDelete
        ? (
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                console.log("[SessionItem] Confirm delete:", session.id);
                onDelete(session.id);
                setConfirmingDelete(false);
              }}
              className="rounded-md p-1 text-status-error transition hover:bg-surface-3"
              title={isMainSession ? "Confirm clear main session" : "Confirm delete session"}
            >
              <Check size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setConfirmingDelete(false);
              }}
              className="rounded-md p-1 text-text-tertiary transition hover:bg-surface-3 hover:text-text-secondary"
              title="Cancel"
            >
              <X size={14} />
            </button>
          </div>
        )
        : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                console.log("[SessionItem] Arm delete confirm:", session.id);
                setConfirmingDelete(true);
              }}
              className="rounded-md p-1 text-text-tertiary opacity-0 transition hover:bg-surface-3 hover:text-status-error group-hover:opacity-100"
              title="Delete session"
            >
              <Trash2 size={14} />
            </button>
        ))}
    </div>
  );
});
