// ToolCallBubble — collapsible panel showing tool call status

import { memo, useState } from "react";
import type { ToolCallMessage } from "@/lib/gateway";
import { ChevronDown, ChevronRight, Wrench, CheckCircle, XCircle, Loader } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolCallBubbleProps {
  message: ToolCallMessage;
}

const statusIcon = {
  started: <Loader size={14} className="animate-spin text-primary" />,
  completed: <CheckCircle size={14} className="text-status-running" />,
  error: <XCircle size={14} className="text-status-error" />,
};

export const ToolCallBubble = memo(function ToolCallBubble({
  message,
}: ToolCallBubbleProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="flex justify-start">
      <div className="max-w-[85%] rounded-lg border border-border bg-surface-1">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs"
        >
          <Wrench size={14} className="text-text-tertiary" />
          <span className="font-medium text-text-secondary">
            {message.toolName}
          </span>
          {statusIcon[message.status]}
          <span className="ml-auto">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
        </button>

        {expanded && (
          <div className="border-t border-border px-3 py-2 text-xs">
            {/* Input */}
            {message.input !== undefined && (
              <div className="mb-2">
                <div className="mb-1 font-medium text-text-secondary">Input</div>
                <pre className={cn(
                  "overflow-x-auto rounded bg-surface-2 p-2 text-text-primary",
                  "max-h-40"
                )}>
                  {typeof message.input === "string"
                    ? message.input
                    : JSON.stringify(message.input, null, 2)}
                </pre>
              </div>
            )}

            {/* Output */}
            {message.output !== undefined && (
              <div className="mb-2">
                <div className="mb-1 font-medium text-text-secondary">Output</div>
                <pre className="overflow-x-auto rounded bg-surface-2 p-2 text-text-primary max-h-40">
                  {typeof message.output === "string"
                    ? message.output
                    : JSON.stringify(message.output, null, 2)}
                </pre>
              </div>
            )}

            {/* Error */}
            {message.error && (
              <div className="rounded bg-status-error/10 p-2 text-status-error">
                {message.error}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
