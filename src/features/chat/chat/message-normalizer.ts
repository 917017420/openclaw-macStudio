import type { ChatAttachment, ChatMessage, MessageToolCard, ToolCallMessage } from "@/lib/gateway";

const textCache = new WeakMap<object, string | null>();
const thinkingCache = new WeakMap<object, string | null>();
const toolCardCache = new WeakMap<object, MessageToolCard[]>();
const imageCache = new WeakMap<object, ChatAttachment[]>();

function unwrapMessage(message: unknown): Record<string, unknown> | null {
  if (!message || typeof message !== "object") {
    return null;
  }
  const base = message as Record<string, unknown>;
  if (base.raw && typeof base.raw === "object") {
    return base.raw as Record<string, unknown>;
  }
  return base;
}

function normalizeContentArray(message: unknown): Array<Record<string, unknown>> {
  const raw = unwrapMessage(message);
  if (!raw) {
    return [];
  }
  const content = raw.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
}

function stripThinkingTags(text: string): string {
  return text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?<\s*\/\s*think(?:ing)?\s*>/gi, "");
}

function extractRawText(message: unknown): string | null {
  if (typeof message === "string") {
    return message;
  }

  const raw = unwrapMessage(message);
  if (!raw) {
    return null;
  }

  if (typeof raw.content === "string") {
    return raw.content;
  }

  const textParts: string[] = [];
  for (const item of normalizeContentArray(message)) {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if ((type === "text" || type === "output_text") && typeof item.text === "string") {
      textParts.push(item.text);
    }
  }
  if (textParts.length > 0) {
    return textParts.join("\n");
  }

  if (typeof raw.text === "string") {
    return raw.text;
  }

  return null;
}

function extractRawThinking(message: unknown): string | null {
  const raw = unwrapMessage(message);
  if (!raw) {
    return null;
  }

  const parts: string[] = [];
  for (const item of normalizeContentArray(message)) {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if ((type === "thinking" || type === "reasoning") && typeof item.thinking === "string") {
      parts.push(item.thinking.trim());
    }
    if ((type === "thinking" || type === "reasoning") && typeof item.text === "string") {
      parts.push(item.text.trim());
    }
  }
  const filtered = parts.filter(Boolean);
  if (filtered.length > 0) {
    return filtered.join("\n");
  }

  const rawText = extractRawText(message);
  if (!rawText) {
    return null;
  }

  const matches = [...rawText.matchAll(/<\s*think(?:ing)?\s*>([\s\S]*?)<\s*\/\s*think(?:ing)?\s*>/gi)];
  const extracted = matches.map((match) => (match[1] ?? "").trim()).filter(Boolean);
  return extracted.length > 0 ? extracted.join("\n") : null;
}

function normalizeToolArgs(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  if (!trimmed || (!["{", "["].includes(trimmed[0]))) {
    return value;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function extractToolText(item: Record<string, unknown>): string | undefined {
  if (typeof item.text === "string") {
    return item.text;
  }
  if (typeof item.content === "string") {
    return item.content;
  }
  return undefined;
}

function normalizeToolStatus(value: unknown): MessageToolCard["status"] | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  if (value === "started" || value === "completed" || value === "error") {
    return value;
  }
  return undefined;
}

function stringifyToolValue(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function coerceToolCards(message: unknown): MessageToolCard[] {
  const typedMessage = message as ({ toolCards?: MessageToolCard[] } & Partial<ChatMessage>) | null;
  if (typedMessage && Array.isArray(typedMessage.toolCards) && typedMessage.toolCards.length > 0) {
    return typedMessage.toolCards;
  }

  if (typedMessage?.role === "tool") {
    const typedTool = typedMessage as Partial<ToolCallMessage>;
    const toolName = typeof typedTool.toolName === "string" ? typedTool.toolName : "tool";
    const toolCallId = typeof typedTool.toolCallId === "string" ? typedTool.toolCallId : undefined;
    const status = normalizeToolStatus(typedTool.status) ?? "started";
    const cards: MessageToolCard[] = [
      {
        kind: "call",
        name: toolName,
        args: normalizeToolArgs(typedTool.input),
        toolCallId,
        status,
        error: typeof typedTool.error === "string" ? typedTool.error : undefined,
      },
    ];

    const outputText = stringifyToolValue(typedTool.output);
    if (outputText || typeof typedTool.error === "string") {
      cards.push({
        kind: "result",
        name: toolName,
        text: outputText ?? typedTool.error,
        toolCallId,
        status,
        error: typeof typedTool.error === "string" ? typedTool.error : undefined,
      });
    }

    return cards;
  }

  const raw = unwrapMessage(message);
  if (!raw) {
    return [];
  }

  const cards: MessageToolCard[] = [];
  const toolStatus = normalizeToolStatus(raw.status);
  const toolError = typeof raw.error === "string" ? raw.error : undefined;
  for (const item of normalizeContentArray(message)) {
    const kind = (typeof item.type === "string" ? item.type : "").toLowerCase();
    const isToolCall =
      ["toolcall", "tool_call", "tooluse", "tool_use"].includes(kind) ||
      (typeof item.name === "string" && item.arguments != null);
    if (isToolCall) {
      cards.push({
        kind: "call",
        name: (item.name as string) ?? "tool",
        args: normalizeToolArgs(item.arguments ?? item.args),
        toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
        status: toolStatus,
        error: toolError,
      });
      continue;
    }

    if (["toolresult", "tool_result"].includes(kind)) {
      cards.push({
        kind: "result",
        name: typeof item.name === "string" ? item.name : "tool",
        text: extractToolText(item),
        toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
        status: toolStatus,
        error: toolError,
      });
    }
  }

  if (isToolResultMessage(message) && !cards.some((card) => card.kind === "result")) {
    const text = extractText(message) ?? undefined;
    const name =
      (typeof raw.toolName === "string" && raw.toolName) ||
      (typeof raw.tool_name === "string" && raw.tool_name) ||
      "tool";
    cards.push({
      kind: "result",
      name,
      text,
      toolCallId: typeof raw.toolCallId === "string" ? raw.toolCallId : undefined,
      status: toolStatus,
      error: toolError,
    });
  }

  return cards;
}

function coerceImages(message: unknown): ChatAttachment[] {
  const typedMessage = message as Partial<ChatMessage> | null;
  if (typedMessage && Array.isArray(typedMessage.attachments) && typedMessage.attachments.length > 0) {
    return typedMessage.attachments;
  }

  const images: ChatAttachment[] = [];
  for (const item of normalizeContentArray(message)) {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    if (type === "image") {
      const source = item.source as Record<string, unknown> | undefined;
      if (source?.type === "base64" && typeof source.data === "string") {
        const mediaType = (source.media_type as string) || "image/png";
        const data = source.data;
        images.push({
          id: `img:${images.length}:${mediaType}`,
          dataUrl: data.startsWith("data:") ? data : `data:${mediaType};base64,${data}`,
          mimeType: mediaType,
          alt: typeof item.alt === "string" ? item.alt : undefined,
        });
        continue;
      }
      if (typeof item.url === "string") {
        images.push({
          id: `img:${images.length}:url`,
          dataUrl: item.url,
          mimeType: "image/*",
          alt: typeof item.alt === "string" ? item.alt : undefined,
        });
      }
      continue;
    }

    if (type === "image_url") {
      const imageUrl = item.image_url as Record<string, unknown> | undefined;
      if (typeof imageUrl?.url === "string") {
        images.push({
          id: `img:${images.length}:url`,
          dataUrl: imageUrl.url,
          mimeType: "image/*",
          alt: typeof item.alt === "string" ? item.alt : undefined,
        });
      }
    }
  }
  return images;
}

export function normalizeRoleForGrouping(role: string): string {
  const lower = role.toLowerCase();
  if (lower === "user" || lower === "human") {
    return "user";
  }
  if (lower === "assistant" || lower === "ai" || lower === "bot") {
    return "assistant";
  }
  if (lower === "system") {
    return "system";
  }
  if (
    lower === "toolresult" ||
    lower === "tool_result" ||
    lower === "tool" ||
    lower === "function"
  ) {
    return "tool";
  }
  return lower;
}

export function isToolResultMessage(message: unknown): boolean {
  const raw = unwrapMessage(message);
  if (!raw) {
    return false;
  }
  const role = typeof raw.role === "string" ? raw.role.toLowerCase() : "";
  if (role === "toolresult" || role === "tool_result") {
    return true;
  }
  if (typeof raw.toolCallId === "string" || typeof raw.tool_call_id === "string") {
    return true;
  }
  return normalizeContentArray(message).some((item) => {
    const type = typeof item.type === "string" ? item.type.toLowerCase() : "";
    return type === "toolresult" || type === "tool_result";
  });
}

export function extractText(message: unknown): string | null {
  const raw = unwrapMessage(message);
  const role = typeof raw?.role === "string" ? raw.role : "";
  const text = extractRawText(message);
  if (!text) {
    return null;
  }
  return role.toLowerCase() === "assistant" ? stripThinkingTags(text).trim() : text.trim();
}

export function extractTextCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractText(message);
  }
  const obj = message as object;
  if (textCache.has(obj)) {
    return textCache.get(obj) ?? null;
  }
  const value = extractText(message);
  textCache.set(obj, value);
  return value;
}

export function extractThinking(message: unknown): string | null {
  const value = extractRawThinking(message);
  return value?.trim() || null;
}

export function extractThinkingCached(message: unknown): string | null {
  if (!message || typeof message !== "object") {
    return extractThinking(message);
  }
  const obj = message as object;
  if (thinkingCache.has(obj)) {
    return thinkingCache.get(obj) ?? null;
  }
  const value = extractThinking(message);
  thinkingCache.set(obj, value);
  return value;
}

export function extractToolCards(message: unknown): MessageToolCard[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const obj = message as object;
  if (toolCardCache.has(obj)) {
    return toolCardCache.get(obj) ?? [];
  }
  const value = coerceToolCards(message);
  toolCardCache.set(obj, value);
  return value;
}

export function extractImages(message: unknown): ChatAttachment[] {
  if (!message || typeof message !== "object") {
    return [];
  }
  const obj = message as object;
  if (imageCache.has(obj)) {
    return imageCache.get(obj) ?? [];
  }
  const value = coerceImages(message);
  imageCache.set(obj, value);
  return value;
}

export function isStreamingToolMessage(message: unknown): boolean {
  const cards = extractToolCards(message);
  return cards.some((card) => card.kind === "call") && !cards.some((card) => card.kind === "result");
}

export function getToolCallId(message: unknown): string | null {
  const raw = unwrapMessage(message);
  if (!raw) {
    return null;
  }
  if (typeof raw.toolCallId === "string") {
    return raw.toolCallId;
  }
  if (typeof raw.tool_call_id === "string") {
    return raw.tool_call_id;
  }
  const typedTool = message as Partial<ToolCallMessage>;
  if (typeof typedTool.toolCallId === "string") {
    return typedTool.toolCallId;
  }
  return extractToolCards(message).find((card) => card.toolCallId)?.toolCallId ?? null;
}
