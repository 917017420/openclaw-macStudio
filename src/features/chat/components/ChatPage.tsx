// ChatPage — main chat page with sidebar + chat panel layout

import { useState, useEffect } from "react";
import { MessageSquare, Bug } from "lucide-react";
import { useConnectionStore } from "@/features/connection/store";
import { useChatStore } from "@/features/chat/store";
import { useChatEvents } from "@/features/chat/hooks/useChatEvents";
import { gateway } from "@/lib/gateway";
import { ChatSidebar } from "./ChatSidebar";
import { ChatPanel } from "./ChatPanel";

/** Debug panel — shows key state for troubleshooting */
function DebugPanel() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingMessageId = useChatStore((s) => s.streamingMessageId);
  const messagesBySession = useChatStore((s) => s.messagesBySession);

  // Poll gateway event count every second for live display
  const [eventCount, setEventCount] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => {
      setEventCount(gateway.eventCount);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const sessionKeys = Object.keys(messagesBySession);
  const currentMsgs = selectedSessionId
    ? messagesBySession[selectedSessionId]
    : undefined;

  // Show message details for debugging
  const msgSummary = currentMsgs
    ? currentMsgs
        .map(
          (m) =>
            `${m.role}(${(typeof m.id === "string" ? m.id : "no-id").slice(0, 6)}${
              m.role === "assistant"
                ? `:${(m as { content?: string }).content?.length ?? 0}ch`
                : ""
            })`,
        )
        .join(", ")
    : "none";

  return (
    <div className="fixed bottom-0 left-16 right-0 z-50 border-t border-border bg-surface-0/95 px-4 py-2 text-xs font-mono backdrop-blur">
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <b>agent:</b> {selectedAgentId ?? "null"}
        </span>
        <span>
          <b>session:</b> {selectedSessionId ?? "null"}
        </span>
        <span>
          <b>streaming:</b>{" "}
          <span className={isStreaming ? "text-green-400" : ""}>
            {isStreaming ? "YES" : "no"}
          </span>{" "}
          ({streamingMessageId?.slice(0, 8) ?? "none"})
        </span>
        <span>
          <b>events:</b>{" "}
          <span className={eventCount > 0 ? "text-blue-400" : "text-red-400"}>
            {eventCount}
          </span>
        </span>
        <span>
          <b>msgs:</b> {currentMsgs?.length ?? 0}
        </span>
        <span>
          <b>sessions:</b> [{sessionKeys.join(", ")}]
        </span>
      </div>
      {currentMsgs && currentMsgs.length > 0 && (
        <div className="mt-1 truncate text-text-tertiary">
          <b>detail:</b> {msgSummary}
        </div>
      )}
    </div>
  );
}

export function ChatPage() {
  const state = useConnectionStore((s) => s.state);
  const [showDebug, setShowDebug] = useState(false);

  // Subscribe to chat/agent events (mounted once at page level)
  useChatEvents();

  if (state !== "connected") {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="rounded-3xl border border-border/80 bg-surface-1 px-8 py-10 shadow-[0_8px_28px_rgba(0,0,0,0.08)] dark:shadow-[0_8px_28px_rgba(0,0,0,0.35)]">
          <MessageSquare size={48} className="mx-auto text-text-tertiary" />
          <h2 className="mt-4 text-lg font-semibold text-text-primary">
            No Connection
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Connect to a Gateway server to start chatting
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex h-full overflow-hidden">
      <ChatSidebar />
      <div className="flex-1 overflow-hidden">
        <ChatPanel />
      </div>

      {/* Debug toggle button */}
      <button
        onClick={() => setShowDebug((v) => !v)}
        className="fixed bottom-3 right-3 z-50 rounded-full border border-border bg-surface-1 p-2 text-text-tertiary shadow-sm transition-colors hover:bg-surface-2 hover:text-text-primary"
        title="Toggle debug panel"
      >
        <Bug size={14} />
      </button>

      {showDebug && <DebugPanel />}
    </div>
  );
}
