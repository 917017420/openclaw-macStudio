import { memo, useEffect, useState } from "react";
import { Check, Trash2, X } from "lucide-react";
import type { ChatSession } from "@/lib/gateway";
import { formatRelativeTime } from "@/lib/utils";

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
    <div className={`session-item ${isActive ? "active" : ""}`}>
      <button type="button" className="session-main" onClick={() => onSelect(session.id)}>
        <div className="session-title">{session.title || "Untitled"}</div>
        <div className="session-meta">
          <span>{session.messageCount} messages</span>
          <span>{formatRelativeTime(session.updatedAt)}</span>
        </div>
      </button>

      {!isMainSession ? (
        confirmingDelete ? (
          <div style={{ display: "inline-flex", gap: 4 }}>
            <button className="chat-btn-danger" style={{ height: 28, padding: "0 8px" }} onClick={() => onDelete(session.id)} title="Confirm delete">
              <Check size={14} />
            </button>
            <button className="chat-btn-ghost" style={{ height: 28, padding: "0 8px" }} onClick={() => setConfirmingDelete(false)} title="Cancel">
              <X size={14} />
            </button>
          </div>
        ) : (
          <button className="chat-btn-ghost" style={{ height: 28, padding: "0 8px" }} onClick={() => setConfirmingDelete(true)} title="Delete session">
            <Trash2 size={14} />
          </button>
        )
      ) : null}
    </div>
  );
});
