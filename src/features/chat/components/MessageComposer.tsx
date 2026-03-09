import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useChatActions } from "@/features/chat/hooks/useChatActions";
import { useModels } from "@/features/chat/hooks/useModels";
import type { ChatAttachment } from "@/lib/gateway";

const MAX_HEIGHT = 200;
const EMPTY_ATTACHMENTS: ChatAttachment[] = [];

export const MessageComposer = memo(function MessageComposer() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setDraft = useChatStore((s) => s.setDraft);
  const setAttachments = useChatStore((s) => s.setAttachments);
  const { sendMessage, abortStreaming } = useChatActions();
  const { data: models, isLoading: modelsLoading } = useModels(selectedAgentId);

  const sessionDraft = useChatStore((s) =>
    selectedSessionId ? s.draftBySession[selectedSessionId] : undefined,
  );
  const [newChatDraft, setNewChatDraft] = useState("");
  const draft = selectedSessionId ? (sessionDraft ?? "") : newChatDraft;
  const sessionKey = selectedSessionId ?? (selectedAgentId ? `agent:${selectedAgentId}:main` : null);
  const attachments = useChatStore((s) =>
    sessionKey ? s.attachmentsBySession[sessionKey] ?? EMPTY_ATTACHMENTS : EMPTY_ATTACHMENTS,
  );

  const appendAttachments = useCallback(async (files: FileList | File[]) => {
    if (!sessionKey) return;
    const readers = Array.from(files).filter((file) => file.type.startsWith("image/"));
    const next = await Promise.all(
      readers.map(
        (file) =>
          new Promise<ChatAttachment | null>((resolve) => {
            const reader = new FileReader();
            reader.addEventListener("load", () => {
              if (typeof reader.result !== "string") {
                resolve(null);
                return;
              }
              resolve({
                id: `att-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                dataUrl: reader.result,
                mimeType: file.type,
                alt: file.name,
              });
            });
            reader.readAsDataURL(file);
          }),
      ),
    );
    setAttachments(sessionKey, [...attachments, ...next.filter((item: ChatAttachment | null): item is ChatAttachment => item !== null)]);
  }, [attachments, sessionKey, setAttachments]);

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
    if ((!draft.trim() && attachments.length === 0) || isStreaming) return;
    sendMessage(draft, attachments);
    if (selectedSessionId) {
      setDraft(selectedSessionId, "");
    } else {
      setNewChatDraft("");
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [attachments, draft, isStreaming, sendMessage, selectedSessionId, setDraft]);

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

  const removeAttachment = useCallback((attachmentId: string) => {
    if (!sessionKey) return;
    setAttachments(sessionKey, attachments.filter((attachment) => attachment.id !== attachmentId));
  }, [attachments, sessionKey, setAttachments]);

  return (
    <div className="chat-compose">
      <div className="chat-compose__inner">
        {attachments.length > 0 ? (
          <div className="chat-attachments" aria-label={`Attached images: ${attachments.length}`}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="chat-attachment">
                <img src={attachment.dataUrl} alt={attachment.alt ?? "Attachment"} className="chat-attachment__img" />
                <button
                  type="button"
                  className="chat-attachment__remove"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={`Remove ${attachment.alt ?? "attachment"}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        ) : null}

        <div className="chat-compose__row">
          <select
            value={selectedModelId ?? ""}
            onChange={(e) => setSelectedModel(e.target.value || null)}
            disabled={disabled || isStreaming}
            className="composer-model"
            title="Choose model"
            aria-label="Choose model"
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
            onPaste={(event) => {
              const items = event.clipboardData?.items;
              if (!items) return;
              const files = Array.from(items)
                .filter((item) => item.type.startsWith("image/"))
                .map((item) => item.getAsFile())
                .filter((file): file is File => file !== null);
              if (files.length === 0) return;
              event.preventDefault();
              void appendAttachments(files);
            }}
            className="composer-input"
            style={{ maxHeight: MAX_HEIGHT }}
            disabled={disabled}
            aria-label="Message"
            placeholder={
              disabled
                ? "连接并选择 agent 后开始聊天"
                : attachments.length > 0
                  ? "Add a message or paste more images…"
                  : "Message (Enter 发送，Shift+Enter 换行，支持粘贴图片)"
            }
          />

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={(event) => {
              if (!event.target.files || event.target.files.length === 0) {
                return;
              }
              void appendAttachments(event.target.files);
              event.target.value = "";
            }}
          />

          <button
            type="button"
            className="composer-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled || isStreaming}
            title="Attach images"
            aria-label="Attach images"
          >
            <Paperclip size={15} />
          </button>

          <button
            type="button"
            onClick={isStreaming ? abortStreaming : doSend}
            disabled={disabled || (!isStreaming && !draft.trim() && attachments.length === 0)}
            className="composer-btn primary"
            title={isStreaming ? "Stop generating" : "Send message"}
            aria-label={isStreaming ? "Stop generating" : "Send message"}
          >
            {isStreaming ? <Square size={15} /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
});
