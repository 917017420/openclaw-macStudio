// SessionList — scrollable list of sessions for the selected agent

import { memo, useCallback } from "react";
import { useSessions } from "@/features/chat/hooks/useSessions";
import { useChatStore } from "@/features/chat/store";
import { SessionItem } from "./SessionItem";
import { Loader } from "lucide-react";

export const SessionList = memo(function SessionList() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectSession = useChatStore((s) => s.selectSession);
  const { data: sessions, isLoading, error } = useSessions(selectedAgentId);

  const handleSelect = useCallback(
    (sessionId: string) => {
      selectSession(sessionId);
    },
    [selectSession],
  );

  if (!selectedAgentId) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-tertiary">
        Select an agent first
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader size={16} className="animate-spin text-text-tertiary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-3 py-4 text-center text-xs text-status-error">
        Failed to load sessions: {String(error)}
      </div>
    );
  }

  if (!sessions || sessions.length === 0) {
    return (
      <div className="px-3 py-4 text-center text-xs text-text-tertiary">
        No conversations yet
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 overflow-y-auto px-2">
      {sessions.map((session) => (
        <SessionItem
          key={session.id}
          session={session}
          isActive={session.id === selectedSessionId}
          onSelect={handleSelect}
        />
      ))}
    </div>
  );
});
