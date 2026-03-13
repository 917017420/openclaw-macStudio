import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Paperclip, Send, Square, X } from "lucide-react";
import { useChatStore } from "@/features/chat/store";
import { useChatActions } from "@/features/chat/hooks/useChatActions";
import { useModels } from "@/features/chat/hooks/useModels";
import { isChineseLanguage, useAppPreferencesStore } from "@/features/preferences/store";
import type { ChatAttachment } from "@/lib/gateway";

const MAX_HEIGHT = 200;
const EMPTY_ATTACHMENTS: ChatAttachment[] = [];

export const MessageComposer = memo(function MessageComposer() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
  const compositionUnlockTimerRef = useRef<number | null>(null);
  const selectedSessionId = useChatStore((s) => s.selectedSessionId);
  const selectedAgentId = useChatStore((s) => s.selectedAgentId);
  const selectedModelId = useChatStore((s) => s.selectedModelId);
  const setSelectedModel = useChatStore((s) => s.setSelectedModel);
  const isStreaming = useChatStore((s) => s.isStreaming);
  const setDraft = useChatStore((s) => s.setDraft);
  const setAttachments = useChatStore((s) => s.setAttachments);
  const { sendMessage, abortStreaming } = useChatActions();
  const { data: models, isLoading: modelsLoading } = useModels(selectedAgentId);
  const language = useAppPreferencesStore((store) => store.language);
  const isChinese = isChineseLanguage(language);

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
    if (!draft.trim() && attachments.length === 0) return;
    sendMessage(draft, attachments);
    if (selectedSessionId) {
      setDraft(selectedSessionId, "");
    } else {
      setNewChatDraft("");
    }
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [attachments, draft, sendMessage, selectedSessionId, setDraft]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key !== "Enter" || e.shiftKey) return;
      const nativeEvent = e.nativeEvent as KeyboardEvent | undefined;
      const keyCode = nativeEvent?.keyCode ?? ("keyCode" in e ? Number(e.keyCode) : undefined);
      if (isComposingRef.current || e.isComposing || nativeEvent?.isComposing || keyCode === 229) return;
      e.preventDefault();
      doSend();
    },
    [doSend],
  );

  const handleCompositionStart = useCallback(() => {
    if (compositionUnlockTimerRef.current != null) {
      window.clearTimeout(compositionUnlockTimerRef.current);
      compositionUnlockTimerRef.current = null;
    }
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback(() => {
    if (compositionUnlockTimerRef.current != null) {
      window.clearTimeout(compositionUnlockTimerRef.current);
    }
    compositionUnlockTimerRef.current = window.setTimeout(() => {
      isComposingRef.current = false;
      compositionUnlockTimerRef.current = null;
    }, 0);
  }, []);

  useEffect(() => {
    textareaRef.current?.focus();
  }, [selectedSessionId]);

  useEffect(() => () => {
    if (compositionUnlockTimerRef.current != null) {
      window.clearTimeout(compositionUnlockTimerRef.current);
    }
  }, []);

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
          <div className="chat-attachments" aria-label={isChinese ? `已附加图片：${attachments.length}` : `Attached images: ${attachments.length}`}>
            {attachments.map((attachment) => (
              <div key={attachment.id} className="chat-attachment">
                <img src={attachment.dataUrl} alt={attachment.alt ?? (isChinese ? "附件" : "Attachment")} className="chat-attachment__img" />
                <button
                  type="button"
                  className="chat-attachment__remove"
                  onClick={() => removeAttachment(attachment.id)}
                  aria-label={isChinese ? `移除${attachment.alt ?? "附件"}` : `Remove ${attachment.alt ?? "attachment"}`}
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
            disabled={disabled}
            className="composer-model"
            title={isChinese ? "选择模型" : "Choose model"}
            aria-label={isChinese ? "选择模型" : "Choose model"}
          >
            <option value="">{modelsLoading ? (isChinese ? "加载模型中..." : "Loading models...") : isChinese ? "自动" : "Auto"}</option>
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
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
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
            aria-label={isChinese ? "消息输入框" : "Message"}
            placeholder={
              disabled
                ? (isChinese ? "连接并选择 Agent 后开始聊天" : "Connect and choose an agent to start chatting")
                : attachments.length > 0
                  ? (isChinese ? "输入消息或继续粘贴图片…" : "Add a message or paste more images…")
                  : (isChinese ? "输入消息（中文选词时回车不会发送，Shift+Enter 换行，支持粘贴图片）" : "Message (IME Enter will not send, Shift+Enter for newline, supports pasted images)")
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
            disabled={disabled}
            title={isChinese ? "附加图片" : "Attach images"}
            aria-label={isChinese ? "附加图片" : "Attach images"}
          >
            <Paperclip size={15} />
          </button>

          {isStreaming ? (
            <button
              type="button"
              onClick={abortStreaming}
              disabled={disabled}
              className="composer-btn"
              title={isChinese ? "停止生成" : "Stop generating"}
              aria-label={isChinese ? "停止生成" : "Stop generating"}
            >
              <Square size={15} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={doSend}
            disabled={disabled || (!draft.trim() && attachments.length === 0)}
            className="composer-btn primary"
            title={isStreaming ? (isChinese ? "加入队列" : "Queue message") : isChinese ? "发送消息" : "Send message"}
            aria-label={isStreaming ? (isChinese ? "加入队列" : "Queue message") : isChinese ? "发送消息" : "Send message"}
          >
            <Send size={15} />
            <span>{isStreaming ? (isChinese ? "排队发送" : "Queue") : isChinese ? "发送" : "Send"}</span>
          </button>
        </div>
      </div>
    </div>
  );
});
