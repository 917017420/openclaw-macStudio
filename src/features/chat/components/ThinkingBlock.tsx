// ThinkingBlock — collapsible reasoning/thinking block

import { memo, useState } from "react";
import { ChevronDown, ChevronRight, Brain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ThinkingBlockProps {
  reasoning: string;
  isStreaming?: boolean;
}

export const ThinkingBlock = memo(function ThinkingBlock({
  reasoning,
  isStreaming = false,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(false);

  if (!reasoning) return null;

  return (
    <div className="mb-2 rounded-xl border border-border/70 bg-surface-1/90">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-text-secondary transition-colors hover:text-text-primary"
      >
        <Brain size={14} className={cn(isStreaming && "animate-pulse text-primary")} />
        <span className="font-medium">
          {isStreaming ? "Thinking…" : "Thinking"}
        </span>
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
      </button>
      {expanded && (
        <div className="border-t border-border px-3 py-2 text-xs leading-relaxed text-text-secondary">
          <span className="whitespace-pre-wrap">{reasoning}</span>
        </div>
      )}
    </div>
  );
});
