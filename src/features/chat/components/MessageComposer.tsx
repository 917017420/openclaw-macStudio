// MessageComposer — adaptive textarea with send/abort button

import { memo, useRef, useCallback, useEffect, useState } from "react";
import { Send, Square } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useChatActions } from "@/features/chat/hooks/useChatActions";
import { useModels } from "@/features/chat/hooks/useModels";
import { cn } from "@/lib/utils";

const MAX_HEIGHT = 200;

export const MessageComposer = memo(function MessageComposer() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setDraft = useChatStore((s) => s.setDraft);
  const { sendMessage, abortStreaming } = useChatActions();
  const { data: models, isLoading: modelsLoading } = useModels(selectedAgentId);

  // Session draft from store (for existing sessions)
  const sessionDraft = useChatStore((s) =>
    selectedSessionId ? s.draftBySession[selectedSessionId] : undefined,
  );

  // Local draft for "new chat" mode (no session yet)
  const [newChatDraft, setNewChatDraft] = useState("");

  // Unified draft value
  const draft = selectedSessionId ? (sessionDraft ?? "") : newChatDraft;

  /** Auto-resize textarea */
  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

  /** Handle input changes */
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (selectedSessionId) {
        setDraft(selectedSessionId, value);
      } else {
        setNewChatDraft(value);
      }
      adjustHeight();
    },
    [selectedSessionId, setDraft, adjustHeight],
  );

  /** Send the current draft */
  const doSend = useCallback(() => {
    if (!draft.trim() || isStreaming) return;
    sendMessage(draft);
    // Clear the draft
    if (selectedSessionId) {
      setDraft(selectedSessionId, "");
    } else {
      setNewChatDraft("");
    }
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [draft, isStreaming, sendMessage, selectedSessionId, setDraft]);

  /** Handle key down: Enter to send, Shift+Enter for newline */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend],
  );

  /** Handle send/abort button click */
  const handleButtonClick = useCallback(() => {
    if (isStreaming) {
      abortStreaming();
    } else {
      doSend();
    }
  }, [isStreaming, abortStreaming, doSend]);

  /** Focus textarea when session changes */
  useEffect(() => {
    textareaRef.current?.focus();
  }, [selectedSessionId]);

  useEffect(() => {
    if (!models || models.length === 0) {
      if (selectedModelId !== null) {
        setSelectedModel(null);
      }
      return;
    }
    if (selectedModelId && models.some((m) => m.id === selectedModelId)) return;
    setSelectedModel(null);
  }, [models, selectedModelId, setSelectedModel]);

  const disabled = !selectedAgentId;

  return (
    <div className="border-t border-border/80 bg-surface-1/85 px-4 py-3 backdrop-blur">
      <div className="mx-auto flex max-w-4xl items-end gap-2.5">
        <div className="min-w-[10rem] max-w-[12rem]">
          <select
            value={selectedModelId ?? ""}
            onChange={(e) => setSelectedModel(e.target.value || null)}
            disabled={disabled || isStreaming}
            className={cn(
              "h-11 w-full rounded-2xl border border-border bg-surface-0 px-3 text-sm text-text-secondary shadow-sm",
              "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
            title="选择模型"
          >
            <option value="">
              {modelsLoading ? "加载模型中..." : "Auto"}
            </option>
            {(models ?? []).map((model) => (
              <option key={model.id} value={model.id}>
                {model.provider ? `${model.provider} / ${model.label}` : model.label}
              </option>
            ))}
          </select>
        </div>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            disabled
              ? "Select an agent to start chatting"
              : selectedSessionId
                ? "Type a message… (Enter to send, Shift+Enter for newline)"
                : "Type a message to start a new chat…"
          }
          disabled={disabled}
          rows={1}
          className={cn(
            "flex-1 resize-none rounded-2xl border border-border bg-surface-0 px-4 py-2.5 text-sm text-text-primary shadow-sm",
            "placeholder:text-text-tertiary",
            "focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/30",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
          style={{ maxHeight: MAX_HEIGHT }}
        />

        <button
          onClick={handleButtonClick}
          disabled={disabled || (!isStreaming && !draft.trim())}
          className={cn(
            "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl shadow-sm transition-all",
            isStreaming
              ? "bg-status-error text-text-inverse hover:bg-status-error/80"
              : "bg-primary text-text-inverse hover:-translate-y-0.5 hover:bg-primary-hover",
            "disabled:cursor-not-allowed disabled:opacity-40",
          )}
          title={isStreaming ? "Stop generating" : "Send message"}
        >
          {isStreaming ? <Square size={16} /> : <Send size={16} />}
        </button>
      </div>
    </div>
  );
});
