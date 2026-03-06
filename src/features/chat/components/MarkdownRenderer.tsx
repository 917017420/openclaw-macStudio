// MarkdownRenderer — renders markdown content with GFM, syntax highlight, and copy

import { memo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import type { Components } from "react-markdown";
import { Copy, Check } from "lucide-react";
import { useState } from "react";

interface MarkdownRendererProps {
  content: string;
  /** If true, render as plain text (faster for streaming) */
  plainMode?: boolean;
}

function formatCommandHelpContent(content: string): string {
  if (!content.includes("ℹ️ Help")) return content;

  const lines = content.split("\n");
  const formatted = lines.map((line) => {
    const trimmed = line.trim();
    if (trimmed.length === 0) return line;
    if (trimmed.startsWith("ℹ️ Help")) return `**${trimmed}**`;

    return line.replace(/(^|\s)(\/[a-zA-Z][\w-]*)/g, (_m, prefix: string, cmd: string) => {
      return `${prefix}\`${cmd}\``;
    });
  });

  return formatted.join("\n");
}

/** Copy button for code blocks */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: noop
    }
  }, [text]);

  return (
    <button
      onClick={handleCopy}
      className="absolute right-2 top-2 rounded p-1 text-text-tertiary opacity-0 transition-opacity hover:bg-surface-3 hover:text-text-secondary group-hover:opacity-100"
      title="Copy code"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

/** Custom components for react-markdown */
const markdownComponents: Components = {
  pre({ children, ...props }) {
    // Extract code text for copy button
    const codeEl = children as React.ReactElement<{
      children?: string;
    }>;
    const codeText =
      typeof codeEl?.props?.children === "string"
        ? codeEl.props.children
        : "";

    return (
      <div className="group relative">
        <CopyButton text={codeText} />
        <pre {...props}>{children}</pre>
      </div>
    );
  },
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline hover:text-primary-hover"
        {...props}
      >
        {children}
      </a>
    );
  },
  table({ children, ...props }) {
    return (
      <div className="overflow-x-auto">
        <table
          className="min-w-full border-collapse border border-border text-sm"
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },
  th({ children, ...props }) {
    return (
      <th
        className="border border-border bg-surface-2 px-3 py-1.5 text-left font-medium"
        {...props}
      >
        {children}
      </th>
    );
  },
  td({ children, ...props }) {
    return (
      <td className="border border-border px-3 py-1.5" {...props}>
        {children}
      </td>
    );
  },
};

export const MarkdownRenderer = memo(function MarkdownRenderer({
  content,
  plainMode = false,
}: MarkdownRendererProps) {
  const formattedContent = plainMode ? content : formatCommandHelpContent(content);

  if (plainMode || !content) {
    return <span className="whitespace-pre-wrap">{formattedContent}</span>;
  }

  return (
    <div className="prose max-w-none text-sm leading-relaxed text-text-primary">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={markdownComponents}
      >
        {formattedContent}
      </ReactMarkdown>
    </div>
  );
});
