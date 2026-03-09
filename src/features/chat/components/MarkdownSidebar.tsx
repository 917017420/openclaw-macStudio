import { memo, useEffect, useMemo, useState } from "react";
import { FileCode2, X } from "lucide-react";
import { MarkdownRenderer } from "./MarkdownRenderer";

interface MarkdownSidebarProps {
  content: string | null;
  rawContent: string | null;
  error: string | null;
  onClose: () => void;
}

export const MarkdownSidebar = memo(function MarkdownSidebar({
  content,
  rawContent,
  error,
  onClose,
}: MarkdownSidebarProps) {
  const hasRendered = Boolean(content?.trim()) && !error;
  const hasRaw = Boolean(rawContent?.trim());
  const [mode, setMode] = useState<"rendered" | "raw">(
    error && hasRaw ? "raw" : "rendered",
  );

  useEffect(() => {
    setMode(error && hasRaw ? "raw" : "rendered");
  }, [content, error, hasRaw, rawContent]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const renderedLabel = useMemo(
    () => (mode === "raw" ? "Raw text" : hasRendered ? "Rendered markdown" : "Tool output"),
    [hasRendered, mode],
  );

  return (
    <div className="sidebar-panel">
      <div className="sidebar-header">
        <div>
          <div className="sidebar-title">Tool Output</div>
          <div className="sidebar-subtitle">{renderedLabel}</div>
        </div>

        <div className="sidebar-header__actions">
          {hasRaw ? (
            <div className="sidebar-toggle" role="tablist" aria-label="Tool output view mode">
              <button
                type="button"
                className={`sidebar-toggle__btn ${mode === "rendered" ? "is-active" : ""}`}
                onClick={() => setMode("rendered")}
                disabled={!hasRendered}
                aria-pressed={mode === "rendered"}
              >
                Rendered
              </button>
              <button
                type="button"
                className={`sidebar-toggle__btn ${mode === "raw" ? "is-active" : ""}`}
                onClick={() => setMode("raw")}
                aria-pressed={mode === "raw"}
              >
                Raw
              </button>
            </div>
          ) : null}

          <button type="button" className="chat-btn-ghost sidebar-close-btn" onClick={onClose} title="Close sidebar">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="sidebar-content">
        {error && mode !== "raw" ? (
          <>
            <div className="chat-system-chip chat-system-chip--danger">{error}</div>
            {hasRaw ? (
              <button type="button" className="composer-btn sidebar-error-action" onClick={() => setMode("raw")}>
                <FileCode2 size={14} />
                <span>View Raw Text</span>
              </button>
            ) : null}
          </>
        ) : mode === "raw" && hasRaw ? (
          <pre className="sidebar-raw">{rawContent}</pre>
        ) : content ? (
          <div className="sidebar-markdown">
            <MarkdownRenderer content={content} />
          </div>
        ) : (
          <div className="muted">No content available</div>
        )}
      </div>
    </div>
  );
});
