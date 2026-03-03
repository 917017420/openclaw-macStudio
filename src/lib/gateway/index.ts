export { GatewayClient, gateway } from "./client";
export type {
  ConnectionState,
  ConnectionError,
  GatewayConfig,
  Agent,
  AgentCapabilities,
  ChatSession,
  ChatMessage,
  UserMessage,
  AssistantMessage,
  ToolCallMessage,
  SystemMessage,
  Channel,
  EventCallback,
  EventSubscription,
} from "./types";
export {
  createRequest,
  parseMessage,
  generateRequestId,
  type GatewayMessage,
  type GatewayRequest,
  type GatewayResponse,
  type GatewayEvent,
  type ChatStreamDelta,
  type ChatStreamFinal,
  type AgentLifecyclePayload,
  type ToolCallPayload,
} from "./protocol";
export { buildConnectParams, extractNonce, parseAuthResponse, type AuthResult } from "./auth";
