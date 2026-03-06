import { memo } from "react";
import { MessageSquare } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useSessionMessages } from "@/features/chat/hooks/useSessionMessages";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";

export const ChatPanel = memo(function ChatPanel() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);

  useSessionMessages(selectedSessionId);

  if (!selectedAgentId) {
    return (
      <div className="chat-panel-card" style={{ display: "grid", placeItems: "center" }}>
        <div className="chat-system-chip" style={{ borderRadius: 12, padding: "10px 14px" }}>
          <MessageSquare size={16} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
          Select an agent to start
        </div>
      </div>
    );
  }

  return (
    <section className="chat-panel-card">
      <ChatHeader />
      <MessageList />
      <MessageComposer />
    </section>
  );
});
