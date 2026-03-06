// ChatPanel — right-side main chat panel (header + messages + composer)

import { memo } from "react";
import { useChatStore } from "@/features/chat/store";
import { useSessionMessages } from "@/features/chat/hooks/useSessionMessages";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";
import { MessageSquare } from "lucide-react";

export const ChatPanel = memo(function ChatPanel() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);

  // Fetch initial messages when session is selected
  useSessionMessages(selectedSessionId);

  if (!selectedAgentId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <MessageSquare size={48} className="mx-auto text-text-tertiary" />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">
            Select an Agent
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Choose an agent from the sidebar to start chatting
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-chat-surface">
      <ChatHeader />
      <MessageList />
      <MessageComposer />
    </div>
  );
});
