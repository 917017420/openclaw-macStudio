import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Send, Square } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useChatActions } from "@/features/chat/hooks/useChatActions";
import { useModels } from "@/features/chat/hooks/useModels";

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

  const sessionDraft = useChatStore((s) =>
    selectedSessionId ? s.draftBySession[selectedSessionId] : undefined,
  );
  const [newChatDraft, setNewChatDraft] = useState("");
  const draft = selectedSessionId ? (sessionDraft ?? "") : newChatDraft;

  const adjustHeight = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT)}px`;
  }, []);

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

  const doSend = useCallback(() => {
    if (!draft.trim() || isStreaming) return;
    sendMessage(draft);
    if (selectedSessionId) {
      setDraft(selectedSessionId, "");
    } else {
      setNewChatDraft("");
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [draft, isStreaming, sendMessage, selectedSessionId, setDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    },
    [doSend],
  );

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
    <div className="chat-compose">
      <div className="chat-compose__row">
        <select
          value={selectedModelId ?? ""}
          onChange={(e) => setSelectedModel(e.target.value || null)}
          disabled={disabled || isStreaming}
          className="composer-model"
          title="选择模型"
        >
          <option value="">{modelsLoading ? "加载模型中..." : "Auto"}</option>
          {(models ?? []).map((model) => (
            <option key={model.id} value={model.id}>
              {model.provider ? `${model.provider} / ${model.label}` : model.label}
            </option>
          ))}
        </select>

        <textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          className="composer-input"
          style={{ maxHeight: MAX_HEIGHT }}
          disabled={disabled}
          placeholder={
            disabled
              ? "连接并选择 agent 后开始聊天"
              : "Message (Enter 发送，Shift+Enter 换行)"
          }
        />

        <button
          onClick={isStreaming ? abortStreaming : doSend}
          disabled={disabled || (!isStreaming && !draft.trim())}
          className="composer-btn primary"
          title={isStreaming ? "Stop" : "Send"}
        >
          {isStreaming ? <Square size={15} /> : <Send size={15} />}
        </button>
      </div>
    </div>
  );
});
