import { memo } from "react";
import type { AssistantMessage } from "@/lib/gateway";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { StreamingIndicator } from "./StreamingIndicator";
import { MessageCopyButton } from "./MessageCopyButton";

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
}

export const AssistantMessageBubble = memo(function AssistantMessageBubble({ message }: AssistantMessageBubbleProps) {
  const isStreaming = message.isStreaming ?? false;
  const hasContent = message.content.length > 0;
  const hasReasoning = !!message.reasoning;
  const copyText = hasContent ? message.content : (message.reasoning ?? "");

  return (
    <div className="chat-bubble group">
      <MessageCopyButton
        text={copyText}
        className="absolute right-2 top-2 text-text-tertiary opacity-0 group-hover:opacity-100"
      />

      {hasReasoning ? <ThinkingBlock reasoning={message.reasoning!} isStreaming={isStreaming && !hasContent} /> : null}

      {hasContent ? (
        <MarkdownRenderer content={message.content} plainMode={isStreaming} />
      ) : isStreaming ? (
        <StreamingIndicator />
      ) : null}
    </div>
  );
});
