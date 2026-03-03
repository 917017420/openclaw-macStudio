// ChatSidebar — left 240px panel with agent picker, sessions, and new chat button

import { memo, useCallback, useEffect } from "react";
import { Plus } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useSessions } from "@/features/chat/hooks/useSessions";
import { AgentPicker } from "./AgentPicker";
import { SessionList } from "./SessionList";

export const ChatSidebar = memo(function ChatSidebar() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const { data: sessions } = useSessions(selectedAgentId);

  // Auto-select first session when agent changes or sessions load
  useEffect(() => {
    if (sessions && sessions.length > 0 && !selectedSessionId) {
      selectSession(sessions[0].id);
    }
  }, [sessions, selectedSessionId, selectSession]);

  /** Start new chat: deselect session so next send creates a new one */
  const handleNewChat = useCallback(() => {
    selectSession(null);
  }, [selectSession]);

  return (
    <div className="flex h-full w-60 flex-col border-r border-border bg-surface-1">
      {/* Agent picker */}
      <div className="border-b border-border">
        <AgentPicker />
      </div>

      {/* New chat button */}
      <div className="px-2 py-2">
        <button
          onClick={handleNewChat}
          disabled={!selectedAgentId}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:border-primary hover:bg-primary-light hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={14} />
          New Chat
        </button>
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto">
        <SessionList />
      </div>
    </div>
  );
});
