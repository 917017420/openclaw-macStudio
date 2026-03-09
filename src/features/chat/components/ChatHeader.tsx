import { memo, useCallback, useEffect } from "react";
import { MessageSquarePlus } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useSessions } from "@/features/chat/hooks/useSessions";
import { formatRelativeTime } from "@/lib/utils";
import type { ChatSession } from "@/lib/gateway";
import { AgentPicker } from "./AgentPicker";

function formatSessionLabel(session: ChatSession) {
  const title = session.title?.trim() || "Untitled";
  return `${title} · ${session.messageCount} msg · ${formatRelativeTime(session.updatedAt)}`;
}

export const ChatHeader = memo(function ChatHeader() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const { data: sessions } = useSessions(selectedAgentId);

  const session = sessions?.find((candidate) => candidate.id === selectedSessionId);
  const sessionExists = Boolean(session);
  const isDraftSession = Boolean(
    selectedSessionId &&
      selectedAgentId &&
      selectedSessionId.startsWith(`agent:${selectedAgentId}:`) &&
      !sessionExists,
  );

  useEffect(() => {
    if (!selectedAgentId || !sessions) {
      return;
    }

    const sessionBelongsToAgent = Boolean(
      selectedSessionId && selectedSessionId.startsWith(`agent:${selectedAgentId}:`),
    );
    const matchesExistingSession = sessions.some((candidate) => candidate.id === selectedSessionId);

    if (sessions.length === 0) {
      if (selectedSessionId && !sessionBelongsToAgent) {
        selectSession(null);
      }
      return;
    }

    if (!selectedSessionId || (!matchesExistingSession && !sessionBelongsToAgent)) {
      selectSession(sessions[0].id);
    }
  }, [selectedAgentId, selectedSessionId, selectSession, sessions]);

  const handleNewChat = useCallback(() => {
    if (!selectedAgentId) {
      return;
    }
    selectSession(`agent:${selectedAgentId}:${crypto.randomUUID()}`);
  }, [selectSession, selectedAgentId]);

  return (
    <header className="chat-header">
      <div className="chat-header__inner">
        <div className="chat-header__main">
          <div className="chat-header__left">
            <AgentPicker />

            <label className="chat-session-select-wrap">
              <select
                className="chat-session-select"
                aria-label="Conversation"
                value={selectedSessionId ?? ""}
                onChange={(event) => selectSession(event.target.value || null)}
              >
                {isDraftSession && selectedSessionId ? <option value={selectedSessionId}>New conversation</option> : null}
                {!selectedSessionId ? <option value="">New conversation</option> : null}
                {(sessions ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {formatSessionLabel(candidate)}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="chat-header__right">
            <button
              type="button"
              className="chat-btn-ghost chat-header__new-chat"
              onClick={handleNewChat}
              disabled={!selectedAgentId}
              title="Start a new chat"
              aria-label="Start a new chat"
            >
              <MessageSquarePlus size={15} />
            </button>
          </div>
        </div>
      </div>
    </header>
  );
});
