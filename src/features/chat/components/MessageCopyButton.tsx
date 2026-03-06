import { memo, useCallback, useState } from "react";
import { Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";

interface MessageCopyButtonProps {
  text: string;
  className?: string;
}

export const MessageCopyButton = memo(function MessageCopyButton({
  text,
  className,
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
      onClick={handleCopy}
      disabled={!text}
      className={cn(
        "rounded p-1 transition-opacity",
        "disabled:cursor-not-allowed disabled:opacity-30",
        className,
      )}
      title={copied ? "Copied" : "Copy message"}
      aria-label={copied ? "Copied" : "Copy message"}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
});
