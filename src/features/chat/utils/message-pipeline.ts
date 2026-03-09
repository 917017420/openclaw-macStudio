import type {
  AssistantMessage,
  ChatAttachment,
  ChatMessage,
  MessageToolCard,
  ToolCallMessage,
} from "@/lib/gateway";

const LOCAL_CACHE_WINDOW_MS = 10 * 60_000;
const SILENT_REPLY_PATTERN = /^\s*NO_REPLY\s*$/i;

function hashStable(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash * 31 + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function findJsonObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") depth++;
    if (ch === "}") {
      depth--;
      if (depth === 0) return i;
      if (depth < 0) return -1;
    }
  }

  return -1;
}

function isInternalFrame(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  const t = obj.type;
  if (typeof t !== "string") return false;
  return (
    t === "thinking" ||
    t === "toolCall" ||
    t === "toolResult" ||
    t === "reasoning" ||
    t === "reasoning_content" ||
    t === "thought"
  );
}

function stripLeadingInternalFrames(text: string): string {
  let cursor = 0;
  while (cursor < text.length) {
    while (cursor < text.length && /\s/.test(text[cursor])) cursor++;
    if (cursor >= text.length || text[cursor] !== "{") break;

    const end = findJsonObjectEnd(text, cursor);
    if (end === -1) break;
    const candidate = text.slice(cursor, end + 1);

    try {
      const parsed = JSON.parse(candidate);
      if (!isInternalFrame(parsed)) break;
      cursor = end + 1;
    } catch {
      break;
    }
  }

  return text.slice(cursor).trimStart();
}

function stripControlDirectives(text: string): string {
  return text.replace(/(^|\n)\s*\[\[[a-z][a-z0-9_:-]{1,64}\]\]\s*/gim, "$1");
}

function stripThinkingTags(text: string): string {
  return text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "");
}

function stripUntrustedMetadataBlocks(text: string): string {
  if (!/untrusted metadata/i.test(text)) return text;
  let cleaned = text;
  let changed = true;
  while (changed) {
    changed = false;
    const next = cleaned
      .replace(
        /^\s*(?:Conversation info|Sender)\s*\(untrusted metadata\):\s*\n?\s*`{2,}[a-z]*[\s\S]*?`{2,}\s*/i,
        "",
      )
      .replace(
        /^\s*(?:Conversation info|Sender)\s*\(untrusted metadata\):[\s\S]*?(?=\n{2,}|$)/i,
        "",
      )
      .replace(/^\s*"?(?:message_id|sender_id|sender|label)"?\s*:\s*.*(?:\n|$)/i, "");
    if (next !== cleaned) {
      changed = true;
      cleaned = next;
    }
  }
  return cleaned;
}

function stripJsonNoiseFragments(text: string): string {
  let cleaned = text;
  let changed = true;
  while (changed) {
    changed = false;
    const next = cleaned
      .replace(/^\s*`{2,}\s*json\s*(?:\n|$)/i, "")
      .replace(/^\s*`{2,}\s*(?:\n|$)/i, "")
      .replace(/^\s*[{]\s*(?:\n|$)/, "")
      .replace(/^\s*[}]\s*(?:\n|$)/, "")
      .replace(/^\s*"{0,1}(?:message_id|sender_id|sender|label)"{0,1}\s*:\s*.*(?:\n|$)/i, "");
    if (next !== cleaned) {
      changed = true;
      cleaned = next;
    }
  }
  return cleaned;
}

function isNoiseOnlyText(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (/^`{2,}\s*json$/i.test(t)) return true;
  if (/^[`{}\[\],:\s"']+$/.test(t)) return true;
  if (/^(?:message_id|sender_id|sender|label)\s*:/.test(t)) return true;
  return false;
}

function extractRawText(message: unknown): string | null {
  if (typeof message === "string") {
    return message;
  }
  if (!message || typeof message !== "object") {
    return null;
  }

  const m = message as Record<string, unknown>;
  const content = m.content;
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (typeof p === "string") {
        parts.push(p);
        continue;
      }
      if (!p || typeof p !== "object") {
        continue;
      }
      const item = p as Record<string, unknown>;
      const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
      if ((type === "text" || type === "output_text") && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }
  if (typeof m.text === "string") {
    return m.text;
  }
  if (typeof m.message === "string") {
    return m.message;
  }
  return null;
}

function extractRawThinking(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const m = message as Record<string, unknown>;
  const content = m.content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const p of content) {
      if (!p || typeof p !== "object") {
        continue;
      }
      const item = p as Record<string, unknown>;
      if (item.type === "thinking" && typeof item.thinking === "string") {
        const cleaned = item.thinking.trim();
        if (cleaned) {
          parts.push(cleaned);
        }
      }
    }
    if (parts.length > 0) {
      return parts.join("\n");
    }
  }

  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }
  const matches = [
    ...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi),
  ];
  const extracted = matches.map((m) => (m[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}

export function sanitizeVisibleText(text: string, role?: string): string {
  const withoutMessageId = text.replace(/\n?\[message_id:[^\]]+\]\s*$/gi, "").trimEnd();
  const maybeNoThink = role?.toLowerCase() === "assistant"
    ? stripThinkingTags(withoutMessageId)
    : withoutMessageId;
  const cleaned = stripControlDirectives(
    stripJsonNoiseFragments(
      stripUntrustedMetadataBlocks(stripLeadingInternalFrames(maybeNoThink)),
    ),
  )
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return isNoiseOnlyText(cleaned) ? "" : cleaned;
}

function normalizeComparableText(text: string): string {
  return stripControlDirectives(text.replace(/\n?\[message_id:[^\]]+\]\s*$/gi, ""))
    .replace(/\s+/g, " ")
    .trim();
}

function makeStableId(role: string, text: string, fallbackSeed: string): string {
  return `msg_${role}_${hashStable(`${role}|${text}|${fallbackSeed}`)}`;
}

function normalizeTimestamp(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function normalizeContentItems(message: unknown): Array<Record<string, unknown>> {
  if (!message || typeof message !== "object") {
    return [];
  }
  const content = (message as Record<string, unknown>).content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function extractAttachments(raw: Record<string, unknown>): ChatAttachment[] {
  const images: ChatAttachment[] = [];
  for (const item of normalizeContentItems(raw)) {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if (type === "image") {
      const source = item.source as Record<string, unknown> | undefined;
      if (source?.type === "base64" && typeof source.data === "string") {
        const mediaType = (source.media_type as string) || "image/png";
        const data = source.data;
        images.push({
          id: `att:${images.length}:${mediaType}`,
          dataUrl: data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`,
          mimeType: mediaType,
        });
        continue;
      }
      if (typeof item.url === "string") {
        images.push({
          id: `att:${images.length}:url`,
          dataUrl: item.url,
          mimeType: "image/*",
        });
      }
      continue;
    }
    if (type === "image_url") {
      const imageUrl = item.image_url as Record<string, unknown> | undefined;
      if (typeof imageUrl?.url === "string") {
        images.push({
          id: `att:${images.length}:url`,
          dataUrl: imageUrl.url,
          mimeType: "image/*",
        });
      }
    }
  }
  return images;
}

function extractToolCardsFromRaw(raw: Record<string, unknown>): MessageToolCard[] {
  const cards: MessageToolCard[] = [];
  for (const item of normalizeContentItems(raw)) {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    const toolCallId = typeof raw.toolCallId === "string" ? raw.toolCallId : undefined;
    const name = typeof item.name === "string" ? item.name : "tool";
    if (["toolcall", "tool_call", "tooluse", "tool_use"].includes(type)) {
      cards.push({
        kind: "call",
        name,
        args: item.arguments ?? item.args,
        toolCallId,
      });
      continue;
    }
    if (["toolresult", "tool_result"].includes(type)) {
      cards.push({
        kind: "result",
        name,
        text:
          typeof item.text === "string"
            ? item.text
            : typeof item.content === "string"
              ? item.content
              : undefined,
        toolCallId,
      });
    }
  }
  return cards;
}

function detectToolRole(raw: Record<string, unknown>): boolean {
  const role = typeof raw.role === "string" ? raw.role.toLowerCase() : "";
  if (role === "tool" || role === "toolresult" || role === "tool_result" || role === "function") {
    return true;
  }
  if (typeof raw.toolCallId === "string" || typeof raw.tool_call_id === "string") {
    return true;
  }
  return extractToolCardsFromRaw(raw).some((card) => card.kind === "result");
}

function resolveBaseRole(rawRole: string, raw?: Record<string, unknown>): "user" | "assistant" | "system" | "tool" | "ignore" {
  const role = rawRole.toLowerCase();
  if (role === "user" || role === "human") return "user";
  if (role === "assistant" || role === "ai" || role === "bot") return "assistant";
  if (role === "system") return "system";
  if (raw && detectToolRole(raw)) return "tool";
  return "ignore";
}

export function isSilentAssistantReplyText(text: string): boolean {
  return SILENT_REPLY_PATTERN.test(text);
}

export function normalizeGatewayMessage(
  raw: unknown,
  index = 0,
  opts?: { fallbackSeed?: string },
): ChatMessage | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const roleRaw = (obj.role ?? obj.type) as string | undefined;
  if (!roleRaw || typeof roleRaw !== "string") return null;

  const role = resolveBaseRole(roleRaw, obj);
  if (role === "ignore") return null;

  const timestamp = normalizeTimestamp(
    obj.timestamp ?? obj.ts ?? obj.created_at ?? obj.createdAt,
    Date.now() + index,
  );
  const rawText = extractRawText(raw) ?? "";
  const content = sanitizeVisibleText(rawText, role);
  const attachments = extractAttachments(obj);
  const toolCards = extractToolCardsFromRaw(obj);
  const rawReasoning =
    extractRawThinking(raw) ??
    (typeof obj.reasoning === "string" ? obj.reasoning : null) ??
    (typeof obj.thinking === "string" ? obj.thinking : null) ??
    "";
  const reasoning = sanitizeVisibleText(rawReasoning, "assistant");

  const explicitId = obj.id ?? obj.messageId ?? obj.message_id;
  const id = typeof explicitId === "string" && explicitId.trim()
    ? explicitId
    : makeStableId(
      role,
      content || reasoning,
      opts?.fallbackSeed ?? `${timestamp}|${index}`,
    );

  if (role === "user") {
    if (!content && attachments.length === 0) return null;
    return { role: "user", id, content, timestamp, attachments, raw: obj };
  }
  if (role === "assistant") {
    if ((!content && !reasoning && attachments.length === 0 && toolCards.length === 0) || isSilentAssistantReplyText(content)) return null;
    return {
      role: "assistant",
      id,
      content,
      timestamp,
      isStreaming: false,
      attachments,
      raw: obj,
      ...(toolCards.length > 0 ? { toolCards } : {}),
      ...(reasoning ? { reasoning } : {}),
    };
  }
  if (role === "tool") {
    const toolCallId =
      (typeof obj.toolCallId === "string" && obj.toolCallId) ||
      (typeof obj.tool_call_id === "string" && obj.tool_call_id) ||
      toolCards.find((card) => card.toolCallId)?.toolCallId ||
      `tool:${id}`;
    const toolName =
      (typeof obj.toolName === "string" && obj.toolName) ||
      (typeof obj.tool_name === "string" && obj.tool_name) ||
      toolCards[0]?.name ||
      "tool";
    const toolResult = toolCards.find((card) => card.kind === "result");
    const toolCall = toolCards.find((card) => card.kind === "call");
    const statusRaw = typeof obj.status === "string" ? obj.status.toLowerCase() : "";
    const status: ToolCallMessage["status"] =
      statusRaw === "error"
        ? "error"
        : statusRaw === "completed" || toolResult
          ? "completed"
          : "started";
    return {
      role: "tool",
      id,
      toolName,
      toolCallId,
      input: toolCall?.args ?? obj.args ?? obj.arguments ?? obj.input,
      output: toolResult?.text ?? obj.output ?? obj.result,
      error: typeof obj.error === "string" ? obj.error : undefined,
      status,
      timestamp,
      raw: obj,
    };
  }
  if (!content && attachments.length === 0) return null;
  return { role: "system", id, content, timestamp, attachments, raw: obj };
}

function extractArrayMessages(
  rows: unknown[],
  preferredSessionKey?: string,
): ChatMessage[] {
  const fallbackSeedBase = preferredSessionKey ?? "global";
  const normalized = rows
    .map((item, index) =>
      normalizeGatewayMessage(item, index, { fallbackSeed: `${fallbackSeedBase}|${index}` }))
    .filter((m): m is ChatMessage => m !== null);
  return dedupeMessages(sortMessagesByTimestamp(normalized));
}

export function extractMessagesFromResponse(
  res: unknown,
  preferredSessionKey?: string,
): ChatMessage[] {
  if (!res) return [];

  if (Array.isArray(res)) {
    return extractArrayMessages(res, preferredSessionKey);
  }

  if (typeof res === "string") {
    const text = sanitizeVisibleText(res, "assistant");
    if (!text || isSilentAssistantReplyText(text)) return [];
    return [
      {
        role: "assistant",
        id: makeStableId("assistant", text, preferredSessionKey ?? "string"),
        content: text,
        timestamp: Date.now(),
        isStreaming: false,
      },
    ];
  }

  if (typeof res !== "object") return [];
  const obj = res as Record<string, unknown>;

  for (const key of ["messages", "items", "data", "history", "result", "content"]) {
    if (Array.isArray(obj[key])) {
      return extractArrayMessages(obj[key] as unknown[], preferredSessionKey);
    }
  }

  const previews = obj.previews;
  if (Array.isArray(previews)) {
    const matched = preferredSessionKey
      ? previews.find((entry) => {
        if (!entry || typeof entry !== "object") return false;
        const key = (entry as Record<string, unknown>).key;
        return key === preferredSessionKey;
      }) ?? previews[0]
      : previews[0];

    if (matched && typeof matched === "object") {
      const items = (matched as Record<string, unknown>).items;
      if (Array.isArray(items)) {
        return extractArrayMessages(items, preferredSessionKey);
      }
    }
  }

  if (preferredSessionKey && preferredSessionKey in obj) {
    return extractMessagesFromResponse(obj[preferredSessionKey], preferredSessionKey);
  }

  const single = normalizeGatewayMessage(obj, 0, {
    fallbackSeed: `${preferredSessionKey ?? "single"}|single`,
  });
  return single ? [single] : [];
}

function getComparableKey(message: ChatMessage): string | null {
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    const text = normalizeComparableText(message.content);
    if (!text) return null;
    return `${message.role}|${text}`;
  }
  if (message.role === "tool") {
    const tool = message as ToolCallMessage;
    const toolCallId = tool.toolCallId?.trim();
    if (toolCallId) {
      return `tool|${toolCallId}`;
    }

    const toolName = tool.toolName?.trim() ?? "tool";
    let comparableInput = "";
    if (typeof tool.input === "string") {
      comparableInput = tool.input;
    } else if (tool.input != null) {
      try {
        comparableInput = JSON.stringify(tool.input);
      } catch {
        comparableInput = String(tool.input);
      }
    }

    const input = normalizeComparableText(comparableInput).slice(0, 160);
    if (!toolName && !input) {
      return null;
    }
    return `tool|${toolName}|${input}`;
  }
  return null;
}

function getMessageText(message: ChatMessage): string {
  if (message.role === "user" || message.role === "assistant" || message.role === "system") {
    return message.content;
  }
  return "";
}

export function sortMessagesByTimestamp(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .map((msg, index) => ({ msg, index }))
    .sort((a, b) => {
      const ta = Number.isFinite(a.msg.timestamp) ? a.msg.timestamp : 0;
      const tb = Number.isFinite(b.msg.timestamp) ? b.msg.timestamp : 0;
      if (ta !== tb) return ta - tb;
      return a.index - b.index;
    })
    .map((entry) => entry.msg);
}

export function dedupeMessages(messages: ChatMessage[]): ChatMessage[] {
  const deduped: ChatMessage[] = [];
  const seenIds = new Set<string>();
  let prevAssistant: ChatMessage | null = null;

  for (const msg of messages) {
    if (seenIds.has(msg.id)) continue;
    seenIds.add(msg.id);

    if (msg.role === "assistant") {
      const curText = normalizeComparableText(getMessageText(msg));
      if (prevAssistant && prevAssistant.role === "assistant") {
        const prevText = normalizeComparableText(getMessageText(prevAssistant));
        const closeInTime = Math.abs(msg.timestamp - prevAssistant.timestamp) <= 15_000;
        if (prevText.length > 0 && curText === prevText && closeInTime) {
          continue;
        }
      }
      prevAssistant = msg;
      deduped.push(msg);
      continue;
    }

    prevAssistant = null;
    deduped.push(msg);
  }

  return deduped;
}

export function mergeServerWithLocal(
  serverMessages: ChatMessage[],
  localMessages: ChatMessage[],
): ChatMessage[] {
  if (localMessages.length === 0) {
    return dedupeMessages(sortMessagesByTimestamp(serverMessages));
  }

  const now = Date.now();
  const serverIds = new Set(serverMessages.map((m) => m.id));
  const serverComparable = new Set(
    serverMessages
      .map((m) => getComparableKey(m))
      .filter((key): key is string => key !== null),
  );

  const localPending = localMessages.filter((m) => {
    if (m.role === "assistant" && (m as AssistantMessage).isStreaming) {
      return true;
    }

    if (now - m.timestamp > LOCAL_CACHE_WINDOW_MS) return false;
    if (serverIds.has(m.id)) return false;

    const key = getComparableKey(m);
    if (key && serverComparable.has(key)) return false;

    return true;
  });

  return dedupeMessages(sortMessagesByTimestamp([...serverMessages, ...localPending]));
}

export type ChatEventState = "delta" | "final" | "aborted" | "error";

export type ParsedChatEventPayload = {
  runId: string | null;
  sessionKey: string | null;
  state: ChatEventState | null;
  message?: unknown;
  errorMessage?: string;
};

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

export function parseChatEventPayload(payload: unknown): ParsedChatEventPayload {
  const data = payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
  const run = data.run && typeof data.run === "object"
    ? (data.run as Record<string, unknown>)
    : null;
  const session = data.session && typeof data.session === "object"
    ? (data.session as Record<string, unknown>)
    : null;

  const runId =
    readString(data.runId) ??
    readString(data.run_id) ??
    readString(data.idempotencyKey) ??
    readString(data.idempotency_key) ??
    readString(run?.id) ??
    readString(run?.runId) ??
    null;

  const sessionKey =
    readString(data.sessionKey) ??
    readString(data.session_key) ??
    readString(data.sessionId) ??
    readString(data.session_id) ??
    readString(data.key) ??
    readString(session?.key) ??
    readString(session?.sessionKey) ??
    readString(session?.sessionId) ??
    readString(run?.sessionKey) ??
    readString(run?.sessionId) ??
    readString(run?.key) ??
    null;

  const stateRaw = readString(data.state)?.toLowerCase() ?? null;
  const state = stateRaw === "delta" ||
      stateRaw === "final" ||
      stateRaw === "aborted" ||
      stateRaw === "error"
    ? (stateRaw as ChatEventState)
    : null;

  return {
    runId,
    sessionKey,
    state,
    message: data.message,
    errorMessage: readString(data.errorMessage) ?? readString(data.error_message) ?? undefined,
  };
}

export function extractAssistantText(message: unknown): string | null {
  const raw = extractRawText(message);
  if (!raw) return null;
  const text = sanitizeVisibleText(raw, "assistant");
  if (!text || isSilentAssistantReplyText(text)) return null;
  return text;
}

export function shouldReloadHistoryForFinalEvent(
  payload: Pick<ParsedChatEventPayload, "state" | "message">,
): boolean {
  if (payload.state !== "final") {
    return false;
  }
  if (!payload.message || typeof payload.message !== "object") {
    return true;
  }
  const message = payload.message as Record<string, unknown>;
  const role = typeof message.role === "string" ? message.role.toLowerCase() : "";
  if (role && role !== "assistant") {
    return true;
  }
  return false;
}
