import { MessageSquare } from "lucide-react";
import { useConnectionStore } from "@/features/connection/store";
import { useChatEvents } from "@/features/chat/hooks/useChatEvents";
import { ChatSidebar } from "./ChatSidebar";
import { ChatPanel } from "./ChatPanel";

export function ChatPage() {
  const state = useConnectionStore((s) => s.state);

  useChatEvents();

  if (state !== "connected") {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="chat-system-chip" style={{ padding: "10px 14px", borderRadius: 12 }}>
          <MessageSquare size={16} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
          连接 Gateway 后即可开始聊天
        </div>
      </div>
    );
  }

  return (
    <div className="chat-workspace">
      <ChatSidebar />
      <ChatPanel />
    </div>
  );
}
