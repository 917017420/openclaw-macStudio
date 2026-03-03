// ChatHeader — displays agent name, session title, and action buttons

import { memo } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
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

  return (
    <div className="flex h-12 items-center justify-between border-b border-border px-4">
      <div className="flex items-center gap-3">
        {agent && (
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-status-running" />
            <span className="text-sm font-medium text-text-primary">
              {agent.name}
            </span>
          </div>
        )}
        {session?.title && (
          <>
            <span className="text-text-tertiary">/</span>
            <span className="text-sm text-text-secondary">
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
          <button
            onClick={() => deleteSession(selectedSessionId)}
            className="rounded-lg p-1.5 text-text-tertiary transition-colors hover:bg-surface-2 hover:text-status-error"
            title="Delete session"
          >
            <Trash2 size={16} />
          </button>
        </div>
      )}
    </div>
  );
});
