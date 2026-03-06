// AssistantMessageBubble — left-aligned, markdown rendering, streaming cursor

import { memo } from "react";
import type { AssistantMessage } from "@/lib/gateway";
import { MarkdownRenderer } from "./MarkdownRenderer";
import { ThinkingBlock } from "./ThinkingBlock";
import { StreamingIndicator } from "./StreamingIndicator";
import { MessageCopyButton } from "./MessageCopyButton";

interface AssistantMessageBubbleProps {
  message: AssistantMessage;
}

export const AssistantMessageBubble = memo(function AssistantMessageBubble({
  message,
}: AssistantMessageBubbleProps) {
  const isStreaming = message.isStreaming ?? false;
  const hasContent = message.content.length > 0;
  const hasReasoning = !!message.reasoning;
  const copyText = hasContent ? message.content : (message.reasoning ?? "");
  const contentToRender = hasContent ? message.content : "";
  const hasRenderedContent = contentToRender.length > 0;

  return (
    <div className="flex justify-start">
      <div className="group relative max-w-[86%] rounded-2xl rounded-bl-md border border-border/75 bg-chat-assistant-bubble px-4 py-3 shadow-[0_6px_20px_rgba(0,0,0,0.06)]">
        <MessageCopyButton
          text={copyText}
          className="absolute right-2 top-2 text-text-tertiary opacity-0 hover:bg-surface-2 hover:text-text-primary group-hover:opacity-100"
        />

        {/* Reasoning block */}
        {hasReasoning && (
          <ThinkingBlock
            reasoning={message.reasoning!}
            isStreaming={isStreaming && !hasContent}
          />
        )}

        {/* Content */}
        {hasRenderedContent ? (
          <MarkdownRenderer
            content={contentToRender}
            plainMode={isStreaming}
          />
        ) : isStreaming && !hasReasoning ? (
          <StreamingIndicator />
        ) : null}

        {/* Streaming cursor at end of content */}
        {isStreaming && hasRenderedContent && (
          <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-text-primary" />
        )}
      </div>
    </div>
  );
});
