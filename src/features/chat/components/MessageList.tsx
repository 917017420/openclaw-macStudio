import { memo, useCallback, useEffect, useMemo } from "react";
import { ChevronDown } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useAutoScroll } from "@/features/chat/hooks/useAutoScroll";
import { useAgents } from "@/features/chat/hooks/useAgents";
import {
  buildChatItems,
  MessageGroupView,
  ReadingIndicatorGroup,
  StreamingGroup,
  type MessageGroup,
} from "@/features/chat/chat/grouped-render";
import { MarkdownSidebar } from "./MarkdownSidebar";

const EMPTY_MESSAGES: never[] = [];

function ChatDivider({ label }: { label: string }) {
  return (
    <div className="chat-divider" role="separator">
      <span className="chat-divider__line" />
      <span className="chat-divider__label">{label}</span>
      <span className="chat-divider__line" />
    </div>
  );
}

export const MessageList = memo(function MessageList() {
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const messagesRaw = useChatStore((s) =>
    selectedSessionId ? s.messagesBySession[selectedSessionId] : undefined,
  );
  const toolMessages = useChatStore((s) =>
    selectedSessionId ? s.toolMessagesBySession[selectedSessionId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
  const sidebarOpen = useChatStore((s) => s.sidebarOpen);
  const sidebarContent = useChatStore((s) => s.sidebarContent);
  const sidebarRawContent = useChatStore((s) => s.sidebarRawContent);
  const sidebarError = useChatStore((s) => s.sidebarError);
  const splitRatio = useChatStore((s) => s.splitRatio);
  const closeSidebar = useChatStore((s) => s.closeSidebar);
  const openSidebar = useChatStore((s) => s.openSidebar);
  const setSplitRatio = useChatStore((s) => s.setSplitRatio);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const streamingSessionKey = useChatStore((s) => s.streamingSessionKey);
  const messages = messagesRaw ?? EMPTY_MESSAGES;
  const { data: agents } = useAgents();

  const agent = agents?.find((candidate) => candidate.id === selectedAgentId);
  const assistantName = agent?.name ?? "Assistant";
  const assistantAvatar = agent?.avatar ?? null;

  const streamingMessage = useMemo(() => {
    if (!isStreaming || selectedSessionId !== streamingSessionKey) {
      return null;
    }
    return [...messages].reverse().find(
      (message): message is Extract<(typeof messages)[number], { role: "assistant" }> =>
        message.role === "assistant" && Boolean(message.isStreaming),
    ) ?? null;
  }, [isStreaming, messages, selectedSessionId, streamingSessionKey]);

  const historyMessages = useMemo(
    () => (streamingMessage ? messages.filter((message) => message.id !== streamingMessage.id) : messages),
    [messages, streamingMessage],
  );

  const chatItems = useMemo(
    () =>
      buildChatItems({
        messages: historyMessages,
        toolMessages,
        streamingText:
          streamingMessage && selectedSessionId === streamingSessionKey
            ? (streamingMessage.content ?? "")
            : null,
        streamStartedAt: streamingMessage?.timestamp ?? null,
      }),
    [historyMessages, selectedSessionId, streamingMessage, streamingSessionKey, toolMessages],
  );

  const lastKey = chatItems[chatItems.length - 1]?.key ?? null;
  const { containerRef, scrollToBottom, isNearBottom } = useAutoScroll<HTMLDivElement>({
    deps: [lastKey, isStreaming, streamingMessage?.content],
  });

  const showNewMessages = !isNearBottom && chatItems.length > 0;

  const handleDividerDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!sidebarOpen) return;
      const parent = event.currentTarget.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const onMove = (moveEvent: MouseEvent) => {
        const ratio = (moveEvent.clientX - rect.left) / rect.width;
        setSplitRatio(ratio);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [setSplitRatio, sidebarOpen],
  );

  useEffect(() => {
    if (!selectedSessionId) {
      closeSidebar();
    }
  }, [closeSidebar, selectedSessionId]);

  if (messages.length === 0 && !streamingMessage && toolMessages.length === 0) {
    return (
      <div className={`chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}`}>
        <div className="chat-main" style={{ flex: sidebarOpen ? `0 0 ${splitRatio * 100}%` : undefined }}>
          <div ref={containerRef} className="chat-thread">
            <div className="chat-thread__body">
              <div className="chat-empty-state">
                <div className="chat-empty-state__title">Start a conversation</div>
                <div className="chat-empty-state__hint">
                  Ask something, paste images, or switch to another conversation.
                </div>
              </div>
            </div>
          </div>
        </div>
        {sidebarOpen ? (
          <>
            <div className="chat-resize-handle" onMouseDown={handleDividerDrag} />
            <div className="chat-sidebar">
              <MarkdownSidebar
                content={sidebarContent}
                rawContent={sidebarRawContent}
                error={sidebarError}
                onClose={closeSidebar}
              />
            </div>
          </>
        ) : null}
      </div>
    );
  }

  return (
    <>
      <div className={`chat-split-container ${sidebarOpen ? "chat-split-container--open" : ""}`}>
        <div className="chat-main" style={{ flex: sidebarOpen ? `0 0 ${splitRatio * 100}%` : undefined }}>
          <div ref={containerRef} className="chat-thread" role="log" aria-live="polite">
            <div className="chat-thread__body">
              {chatItems.map((item) => {
                if (item.kind === "divider") {
                  return <ChatDivider key={item.key} label={item.label} />;
                }
                if (item.kind === "reading-indicator") {
                  return <ReadingIndicatorGroup key={item.key} assistantName={assistantName} assistantAvatar={assistantAvatar} />;
                }
                if (item.kind === "stream") {
                  return (
                    <StreamingGroup
                      key={item.key}
                      text={item.text}
                      startedAt={item.startedAt}
                      assistantName={assistantName}
                      assistantAvatar={assistantAvatar}
                      onOpenSidebar={openSidebar}
                    />
                  );
                }
                if (item.kind === "group") {
                  return (
                    <MessageGroupView
                      key={item.key}
                      group={item as MessageGroup}
                      assistantName={assistantName}
                      assistantAvatar={assistantAvatar}
                      onOpenSidebar={openSidebar}
                      showReasoning={true}
                    />
                  );
                }
                return null;
              })}
            </div>
          </div>
        </div>

        {sidebarOpen ? (
          <>
            <div className="chat-resize-handle" onMouseDown={handleDividerDrag} />
            <div className="chat-sidebar">
              <MarkdownSidebar
                content={sidebarContent}
                rawContent={sidebarRawContent}
                error={sidebarError}
                onClose={closeSidebar}
              />
            </div>
          </>
        ) : null}
      </div>

      {showNewMessages ? (
        <button type="button" className="chat-new-messages" onClick={() => scrollToBottom("smooth")}>
          New messages
          <ChevronDown size={14} />
        </button>
      ) : null}
    </>
  );
});
