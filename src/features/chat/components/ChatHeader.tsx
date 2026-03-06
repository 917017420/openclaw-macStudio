// ChatHeader — displays agent name, session title, and action buttons

import { memo, useEffect, useState } from "react";
import { Check, RotateCcw, Trash2, X } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useAgents } from "@/features/chat/hooks/useAgents";
import { useSessions } from "@/features/chat/hooks/useSessions";
import { useChatActions } from "@/features/chat/hooks/useChatActions";

export const ChatHeader = memo(function ChatHeader() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const { data: agents } = useAgents();
  const { data: sessions } = useSessions(selectedAgentId);
  const { resetSession, deleteSession } = useChatActions();

  const agent = agents?.find((a) => a.id === selectedAgentId);
  const session = sessions?.find((s) => s.id === selectedSessionId);
  const isMainSession = selectedSessionId
    ? /(^main$)|(:main$)/.test(selectedSessionId)
    : false;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedSessionId]);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 5000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  return (
    <div className="flex h-14 items-center justify-between border-b border-border/80 bg-surface-1/80 px-4 backdrop-blur">
      <div className="flex items-center gap-3">
        {agent && (
          <div className="flex items-center gap-2 rounded-full bg-surface-0 px-2.5 py-1 ring-1 ring-border/70">
            <div className="h-2.5 w-2.5 rounded-full bg-status-running" />
            <span className="text-sm font-medium text-text-primary">
              {agent.name}
            </span>
          </div>
        )}
        {session?.title && (
          <>
            <span className="text-text-tertiary">/</span>
            <span className="max-w-[26rem] truncate text-sm text-text-secondary">
              {session.title}
            </span>
          </>
        )}
      </div>

      {selectedSessionId && (
        <div className="flex items-center gap-1">
          <button
            onClick={() => resetSession(selectedSessionId)}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-secondary"
            title="Reset session"
          >
            <RotateCcw size={16} />
          </button>
          {!isMainSession && (confirmingDelete
            ? (
              <>
                <button
                  onClick={() => {
                    console.log("[ChatHeader] Confirm delete:", selectedSessionId);
                    deleteSession(selectedSessionId);
                    setConfirmingDelete(false);
                  }}
                  className="rounded-lg p-1.5 text-status-error transition-colors hover:bg-surface-2"
                  title="Confirm delete session"
                >
                  <Check size={16} />
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-text-secondary"
                  title="Cancel"
                >
                  <X size={16} />
                </button>
              </>
            )
            : (
              <button
                onClick={() => {
                  console.log("[ChatHeader] Arm delete confirm:", selectedSessionId);
                  setConfirmingDelete(true);
                }}
                className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-status-error"
                title="Delete session"
              >
                <Trash2 size={16} />
              </button>
            ))}
        </div>
      )}
    </div>
  );
});
