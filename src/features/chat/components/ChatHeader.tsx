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
  const isMainSession = selectedSessionId ? /(^main$)|(:main$)/.test(selectedSessionId) : false;
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [selectedSessionId]);

  return (
    <header className="chat-header">
      <div className="chat-header__left">
        <span className="status-pill">
          <span className="status-dot connected" />
          {agent?.name ?? "assistant"}
        </span>
        {session?.title ? <span className="muted">{session.title}</span> : null}
      </div>

      {selectedSessionId ? (
        <div className="chat-header__right">
          <button className="chat-btn-ghost" style={{ height: 32 }} onClick={() => resetSession(selectedSessionId)} title="Reset session">
            <RotateCcw size={15} />
          </button>
          {!isMainSession ? (
            confirmingDelete ? (
              <>
                <button className="chat-btn-danger" style={{ height: 32 }} onClick={() => deleteSession(selectedSessionId)} title="Confirm delete">
                  <Check size={15} />
                </button>
                <button className="chat-btn-ghost" style={{ height: 32 }} onClick={() => setConfirmingDelete(false)} title="Cancel">
                  <X size={15} />
                </button>
              </>
            ) : (
              <button className="chat-btn-danger" style={{ height: 32 }} onClick={() => setConfirmingDelete(true)} title="Delete session">
                <Trash2 size={15} />
              </button>
            )
          ) : null}
        </div>
      ) : null}
    </header>
  );
});
