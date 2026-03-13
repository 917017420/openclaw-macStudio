import { memo, useEffect, useMemo, useState } from "react";
import { Brain, Check, LoaderCircle, MessageSquare, X } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useSessionMessages } from "@/features/chat/hooks/useSessionMessages";
import { ChatHeader } from "./ChatHeader";
import { MessageList } from "./MessageList";
import { MessageComposer } from "./MessageComposer";

const COMPACTION_TOAST_DURATION_MS = 5_000;
const FALLBACK_TOAST_DURATION_MS = 8_000;

export const ChatPanel = memo(function ChatPanel() {
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const focusMode = useChatStore((s) => s.focusMode);
  const toggleFocusMode = useChatStore((s) => s.toggleFocusMode);
  const compactionStatus = useChatStore((s) =>
    selectedSessionId ? s.compactionStatusBySession[selectedSessionId] ?? null : null,
  );
  const fallbackStatus = useChatStore((s) =>
    selectedSessionId ? s.fallbackStatusBySession[selectedSessionId] ?? null : null,
  );
  const [indicatorNow, setIndicatorNow] = useState(() => Date.now());

  const sessionMessagesQuery = useSessionMessages(selectedSessionId);

  useEffect(() => {
    const expiries: number[] = [];
    if (fallbackStatus?.occurredAt) {
      expiries.push(fallbackStatus.occurredAt + FALLBACK_TOAST_DURATION_MS);
    }
    if (compactionStatus?.completedAt) {
      expiries.push(compactionStatus.completedAt + COMPACTION_TOAST_DURATION_MS);
    }

    if (expiries.length === 0) {
      return;
    }

    const nextExpiry = Math.min(...expiries);
    const delay = Math.max(0, nextExpiry - Date.now()) + 32;
    const timer = window.setTimeout(() => setIndicatorNow(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [compactionStatus?.completedAt, fallbackStatus?.occurredAt]);

  const fallbackDetails = useMemo(() => {
    if (!fallbackStatus) {
      return null;
    }
    return [
      `Selected: ${fallbackStatus.selected}`,
      fallbackStatus.phase === "cleared"
        ? `Active: ${fallbackStatus.selected}`
        : `Active: ${fallbackStatus.active}`,
      fallbackStatus.previous ? `Previous: ${fallbackStatus.previous}` : null,
      fallbackStatus.reason ? `Reason: ${fallbackStatus.reason}` : null,
      fallbackStatus.attempts.length > 0
        ? `Attempts: ${fallbackStatus.attempts.slice(0, 3).join(" | ")}`
        : null,
    ]
      .filter(Boolean)
      .join(" • ");
  }, [fallbackStatus]);

  const showFallbackIndicator = Boolean(
    fallbackStatus && indicatorNow - fallbackStatus.occurredAt < FALLBACK_TOAST_DURATION_MS,
  );
  const showCompactionIndicator = Boolean(
    compactionStatus?.active ||
      (compactionStatus?.completedAt && indicatorNow - compactionStatus.completedAt < COMPACTION_TOAST_DURATION_MS),
  );

  if (!selectedAgentId) {
    return (
      <div className="chat-panel-card" style={{ display: "grid", placeItems: "center" }}>
        <div className="chat-system-chip chat-system-chip--prominent">
          <MessageSquare size={16} style={{ marginRight: 8, verticalAlign: "text-bottom" }} />
          Select an agent to start
        </div>
      </div>
    );
  }

  return (
    <section className={`chat-panel-card ${focusMode ? "is-focus-mode" : ""}`}>
      {focusMode ? (
        <button type="button" className="chat-focus-exit" onClick={toggleFocusMode} title="Exit focus mode" aria-label="Exit focus mode">
          <X size={15} />
        </button>
      ) : null}
      <ChatHeader />
      <MessageList isLoading={Boolean(selectedSessionId) && sessionMessagesQuery.isPending} />
      {showFallbackIndicator && fallbackStatus ? (
        <div
          className={`compaction-indicator ${fallbackStatus.phase === "cleared" ? "compaction-indicator--fallback-cleared" : "compaction-indicator--fallback"}`}
          title={fallbackDetails ?? undefined}
          role="status"
          aria-live="polite"
        >
          {fallbackStatus.phase === "cleared" ? <Check size={14} /> : <Brain size={14} />}
          {fallbackStatus.phase === "cleared" ? `Fallback cleared: ${fallbackStatus.selected}` : `Fallback active: ${fallbackStatus.active}`}
        </div>
      ) : null}
      {showCompactionIndicator ? compactionStatus?.active ? (
        <div className="compaction-indicator compaction-indicator--active" role="status" aria-live="polite">
          <LoaderCircle size={14} className="animate-spin" />
          Compacting context…
        </div>
      ) : (
        <div className="compaction-indicator compaction-indicator--complete" role="status" aria-live="polite">
          <Check size={14} />
          Context compacted
        </div>
      ) : null}
      <MessageComposer />
    </section>
  );
});
