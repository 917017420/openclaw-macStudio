import { memo, useCallback } from "react";
import { Loader } from "lucide-react";
import { useSessions } from "@/features/chat/hooks/useSessions";
import { useChatStore } from "@/features/chat/store";
import { useChatActions } from "@/features/chat/hooks/useChatActions";
import { SessionItem } from "./SessionItem";

export const SessionList = memo(function SessionList() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const { deleteSession } = useChatActions();
  const { data: sessions, isLoading, error } = useSessions(selectedAgentId);

  const handleSelect = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
    },
    [selectSession],
  );

  if (!selectedAgentId) {
    return <div className="session-list muted">Select an agent first</div>;
  }

  if (isLoading) {
    return (
      <div className="session-list muted" style={{ justifyItems: "center", alignContent: "start", paddingTop: 20 }}>
        <Loader size={16} className="animate-spin" />
      </div>
    );
  }

  if (error && (!sessions || sessions.length === 0)) {
    return <div className="session-list muted">Failed to load sessions</div>;
  }

  if (!sessions || sessions.length === 0) {
    return <div className="session-list muted">No conversations yet</div>;
  }

  return (
    <div className="session-list">
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === selectedSessionId}
          onSelect={handleSelect}
          onDelete={deleteSession}
        />
      ))}
    </div>
  );
});
