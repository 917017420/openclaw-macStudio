import { memo } from "react";
import { AlertCircle, Check, ChevronRight, FileSearch, Globe, LoaderCircle, TerminalSquare, Wrench } from "lucide-react";
import type { MessageToolCard } from "@/lib/gateway";

const TOOL_INLINE_THRESHOLD = 80;
const PREVIEW_MAX_LINES = 2;
const PREVIEW_MAX_CHARS = 100;

type ToolCardRendererProps = {
  card: MessageToolCard;
  onOpenSidebar?: (content: string, error?: string | null, rawContent?: string | null) => void;
};

function resolveToolStatus(card: MessageToolCard): MessageToolCard["status"] {
  if (card.status) {
    return card.status;
  }
  if (card.error) {
    return "error";
  }
  if (card.kind === "result") {
    return "completed";
  }
  return undefined;
}

function getToolStatusLabel(status: MessageToolCard["status"]): string | null {
  if (status === "started") return "Running";
  if (status === "completed") return "Completed";
  if (status === "error") return "Error";
  return null;
}

function resolveToolIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("search") || lower.includes("grep")) {
    return FileSearch;
  }
  if (lower.includes("web") || lower.includes("http") || lower.includes("fetch") || lower.includes("browser")) {
    return Globe;
  }
  if (lower.includes("shell") || lower.includes("exec") || lower.includes("command") || lower.includes("terminal")) {
    return TerminalSquare;
  }
  return Wrench;
}

function formatToolLabel(name: string): string {
  const base = name.split(/[/:.]/).filter(Boolean).at(-1) ?? name;
  const spaced = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  if (!spaced) {
    return "Tool";
  }
  return spaced
    .split(/\s+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatToolDetail(card: MessageToolCard): string | null {
  if (card.kind !== "call" || card.args == null) {
    return null;
  }
  if (typeof card.args === "string") {
    return card.args;
  }
  if (typeof card.args === "object") {
    const entries = Object.entries(card.args as Record<string, unknown>).slice(0, 3);
    if (entries.length === 0) {
      return null;
    }
    return entries
      .map(([key, value]) => `${key}=${typeof value === "string" ? value : JSON.stringify(value)}`)
      .join(" • ");
  }
  return String(card.args);
}

export function formatToolOutputForSidebar(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return `\`\`\`json\n${JSON.stringify(parsed, null, 2)}\n\`\`\``;
    } catch {
      return text;
    }
  }
  return text;
}

export function getTruncatedPreview(text: string): string {
  const allLines = text.split("\n");
  const previewLines = allLines.slice(0, PREVIEW_MAX_LINES);
  const preview = previewLines.join("\n");
  if (preview.length > PREVIEW_MAX_CHARS) {
    return `${preview.slice(0, PREVIEW_MAX_CHARS)}…`;
  }
  return previewLines.length < allLines.length ? `${preview}…` : preview;
}

export const ToolCardView = memo(function ToolCardView({ card, onOpenSidebar }: ToolCardRendererProps) {
  const Icon = resolveToolIcon(card.name);
  const label = formatToolLabel(card.name);
  const detail = formatToolDetail(card);
  const hasText = Boolean(card.text?.trim());
  const status = resolveToolStatus(card);
  const statusLabel = getToolStatusLabel(status);
  const canClick = Boolean(onOpenSidebar);
  const isShort = hasText && (card.text?.length ?? 0) <= TOOL_INLINE_THRESHOLD;
  const showCollapsed = hasText && !isShort;
  const showInline = hasText && isShort;
  const isEmpty = !hasText && !card.error;

  const handleOpen = () => {
    if (!onOpenSidebar) {
      return;
    }
    const selection = window.getSelection?.()?.toString().trim();
    if (selection) {
      return;
    }
    if (hasText) {
      onOpenSidebar(formatToolOutputForSidebar(card.text!), card.error ?? null, card.text!);
      return;
    }
    const summaryLines = [
      `## ${label}`,
      "",
      detail ? `**Command:** \`${detail}\`` : null,
      statusLabel ? `**Status:** ${statusLabel}` : null,
      card.error ? `**Error:** ${card.error}` : null,
      !detail && !statusLabel && !card.error ? "*No output available.*" : null,
    ].filter(Boolean);
    const summary = summaryLines.join("\n\n");
    onOpenSidebar(summary, card.error ?? null, summary);
  };

  const statusIndicator =
    status === "started" ? <LoaderCircle size={14} className="animate-spin" /> :
    status === "error" ? <AlertCircle size={14} /> :
    <Check size={14} />;

  return (
    <div
      className={`chat-tool-card ${canClick ? "chat-tool-card--clickable" : ""}`}
      onClick={canClick ? handleOpen : undefined}
      onKeyDown={
        canClick
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              event.preventDefault();
              handleOpen();
            }
          : undefined
      }
      role={canClick ? "button" : undefined}
      tabIndex={canClick ? 0 : undefined}
      title={detail ?? label}
      data-status={status ?? undefined}
    >
      <div className="chat-tool-card__header">
        <div className="chat-tool-card__title">
          <span className="chat-tool-card__icon"><Icon size={14} /></span>
          <span>{label}</span>
        </div>
        {statusLabel ? (
          <span className={`chat-tool-card__status is-${status}`}>
            {statusIndicator}
            {statusLabel}
          </span>
        ) : null}
        {canClick ? (
          <span className="chat-tool-card__action">
            {hasText ? "View" : "Details"}
            <ChevronRight size={12} />
          </span>
        ) : null}
      </div>

      {detail ? <div className="chat-tool-card__detail">{detail}</div> : null}
      {card.error ? <div className="chat-tool-card__status-text">{card.error}</div> : null}
      {isEmpty ? <div className="chat-tool-card__status-text muted">No output</div> : null}
      {showCollapsed ? <div className="chat-tool-card__preview mono">{getTruncatedPreview(card.text!)}</div> : null}
      {showInline ? <div className="chat-tool-card__inline mono">{card.text}</div> : null}
    </div>
  );
});
