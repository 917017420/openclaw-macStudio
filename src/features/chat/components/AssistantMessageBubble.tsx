// AssistantMessageBubble — left-aligned, markdown rendering, streaming cursor

import { memo } from "react";
import type { AssistantMessage } from "@/lib/gateway";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { StreamingIndicator } from "./StreamingIndicator";

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
}

export const AssistantMessageBubble = memo(function AssistantMessageBubble({
  message,
}: AssistantMessageBubbleProps) {
  const isStreaming = message.isStreaming ?? false;
  const hasContent = message.content.length > 0;
  const hasReasoning = !!message.reasoning;

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-chat-assistant-bubble px-4 py-2.5 shadow-sm ring-1 ring-border/50">
        {/* Reasoning block */}
        {hasReasoning && (
          <ThinkingBlock
            reasoning={message.reasoning!}
            isStreaming={isStreaming && !hasContent}
          />
        )}

        {/* Content */}
        {hasContent ? (
          <MarkdownRenderer
            content={message.content}
            plainMode={isStreaming}
          />
        ) : isStreaming && !hasReasoning ? (
          <StreamingIndicator />
        ) : null}

        {/* Streaming cursor at end of content */}
        {isStreaming && hasContent && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-text-primary" />
        )}
      </div>
    </div>
  );
});
