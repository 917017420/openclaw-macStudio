import { memo, useMemo } from "react";
import { Wrench, CheckCircle, XCircle, Loader } from "lucide-react";
import type { ToolCallMessage } from "@/lib/gateway";

interface ToolCallBubbleProps {
  message: ToolCallMessage;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export const ToolCallBubble = memo(function ToolCallBubble({ message }: ToolCallBubbleProps) {
  const inputText = useMemo(() => stringify(message.input), [message.input]);
  const outputText = useMemo(() => stringify(message.output), [message.output]);

  return (
    <div className="chat-tool-card">
      <div className="chat-tool-card__title">
        <Wrench size={14} />
        <span>{message.toolName}</span>
        {message.status === "started" ? (
          <Loader size={13} className="animate-spin" />
        ) : message.status === "completed" ? (
          <CheckCircle size={13} />
        ) : (
          <XCircle size={13} />
        )}
      </div>
      <div className="chat-tool-card__status">status: {message.status}</div>
      {message.input !== undefined ? <pre className="chat-tool-card__code">{inputText}</pre> : null}
      {message.output !== undefined ? <pre className="chat-tool-card__code">{outputText}</pre> : null}
      {message.error ? <div className="chat-tool-card__status" style={{ color: "var(--danger)" }}>{message.error}</div> : null}
    </div>
  );
});
