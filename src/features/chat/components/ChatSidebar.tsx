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

  useEffect(() => {
    if (sessions && sessions.length > 0 && !selectedSessionId) {
      selectSession(sessions[0].id);
    }
  }, [sessions, selectedSessionId, selectSession]);

  const handleNewChat = useCallback(() => {
    if (!selectedAgentId) return;
    const sessionKey = `agent:${selectedAgentId}:${crypto.randomUUID()}`;
    selectSession(sessionKey);
  }, [selectSession, selectedAgentId]);

  return (
    <aside className="chat-sidebar-pane">
      <div className="chat-sidebar-head">
        <AgentPicker />
      </div>

      <div className="chat-sidebar-actions">
        <button className="new-chat-btn" style={{ width: "100%" }} onClick={handleNewChat} disabled={!selectedAgentId}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            <Plus size={14} /> New Chat
          </span>
        </button>
      </div>

      <SessionList />
    </aside>
  );
});
