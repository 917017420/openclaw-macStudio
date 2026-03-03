// Chat message helper utilities

import type {
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  SystemMessage,
} from "@/lib/gateway";
import { uid } from "@/lib/utils";

/** Create a user message */
export function createUserMessage(content: string): UserMessage {
  return {
    role: "user",
    id: uid(),
    content,
    timestamp: Date.now(),
  };
}

/** Create an assistant message (initially empty for streaming) */
export function createAssistantMessage(
  overrides: Partial<AssistantMessage> = {},
): AssistantMessage {
  return {
    role: "assistant",
    id: uid(),
    content: "",
    timestamp: Date.now(),
    isStreaming: false,
    ...overrides,
  };
}

/** Create a tool call message */
export function createToolCallMessage(
  toolName: string,
  toolCallId: string,
  input: unknown,
): ToolCallMessage {
  return {
    role: "tool",
    id: uid(),
    toolName,
    toolCallId,
    input,
    status: "started",
    timestamp: Date.now(),
  };
}

/** Create a system message */
export function createSystemMessage(content: string): SystemMessage {
  return {
    role: "system",
    id: uid(),
    content,
    timestamp: Date.now(),
  };
}

/** Check if a message is from the assistant and currently streaming */
export function isStreamingMessage(msg: ChatMessage): boolean {
  return msg.role === "assistant" && (msg as AssistantMessage).isStreaming === true;
}

/** Get the display content for a message (handles all roles) */
export function getMessagePreview(msg: ChatMessage, maxLength = 80): string {
  switch (msg.role) {
    case "user":
    case "assistant":
    case "system":
      return truncateText(msg.content, maxLength);
    case "tool":
      return truncateText(`[Tool: ${msg.toolName}]`, maxLength);
    default:
      return "";
  }
}

/** Truncate text with ellipsis */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 1) + "…";
}

/** Find a message by ID in a message array */
export function findMessageById(
  messages: ChatMessage[],
  id: string,
): ChatMessage | undefined {
  return messages.find((m) => m.id === id);
}

/** Find a tool call message by toolCallId */
export function findToolCallByToolCallId(
  messages: ChatMessage[],
  toolCallId: string,
): ToolCallMessage | undefined {
  return messages.find(
    (m) => m.role === "tool" && (m as ToolCallMessage).toolCallId === toolCallId,
  ) as ToolCallMessage | undefined;
}
