import { memo, useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageCopyButtonProps {
  text: string;
  className?: string;
  title?: string;
  copiedTitle?: string;
}

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  className,
  title = "Copy message",
  copiedTitle = "Copied",
}: MessageCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore clipboard failures
    }
  }, [text]);

  return (
    <button
      type="button"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        void handleCopy();
      }}
      disabled={!text}
      className={cn(
        "rounded p-1 transition-[opacity,color,border-color,background-color] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]",
        "disabled:cursor-not-allowed disabled:opacity-30",
        className,
      )}
      title={copied ? copiedTitle : title}
      aria-label={copied ? copiedTitle : title}
      aria-live="polite"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
});
