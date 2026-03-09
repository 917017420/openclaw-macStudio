// Gateway type definitions

/** Gateway server configuration */
export interface GatewayConfig {
  id: string;
  name: string;
  url: string;
  token: string;
  scopes?: string[];
  deviceId?: string;
  deviceToken?: string;
  isDefault?: boolean;
}

/** Connection state */
export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "authenticating"
  | "connected"
  | "reconnecting"
  | "pairing_required"
  | "error";

/** Connection error info */
export interface ConnectionError {
  code: string;
  message: string;
  timestamp: number;
  stage?: string;
  closeCode?: number;
  closeReason?: string;
}

export interface GatewayHandshakeTraceEntry {
  stage: string;
  timestamp: number;
  detail?: string;
}

export interface GatewayRuntimeContext {
  clientId: string;
  clientMode: string;
  socketTransport: "tauri-plugin-websocket";
  explicitOriginHeader: string | null;
  locationHref: string | null;
  locationOrigin: string | null;
  locationProtocol: string | null;
  locationHost: string | null;
  documentBaseUri: string | null;
  referrer: string | null;
  userAgent: string | null;
  platform: string | null;
  tauriDetected: boolean;
}

/** Agent definition from Gateway */
export interface Agent {
  id: string;
  name: string;
  avatar?: string;
  status: "running" | "idle" | "error";
  description?: string;
  capabilities?: AgentCapabilities;
}

/** Agent capability flags */
export interface AgentCapabilities {
  commandExecution: "off" | "ask" | "auto";
  webAccess: boolean;
  fileTools: boolean;
}

/** Chat session */
export interface ChatSession {
  id: string;
  agentId: string;
  title?: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

/** Chat message types */
export type ChatMessage =
  | UserMessage
  | AssistantMessage
  | ToolCallMessage
  | SystemMessage;

export interface ChatAttachment {
  id: string;
  dataUrl: string;
  mimeType: string;
  alt?: string;
}

export interface MessageToolCard {
  kind: "call" | "result";
  name: string;
  args?: unknown;
  text?: string;
  toolCallId?: string;
  status?: "started" | "completed" | "error";
  error?: string;
}

interface ChatMessageBase {
  raw?: unknown;
  attachments?: ChatAttachment[];
}

export interface UserMessage extends ChatMessageBase {
  role: "user";
  id: string;
  content: string;
  timestamp: number;
}

export interface AssistantMessage extends ChatMessageBase {
  role: "assistant";
  id: string;
  content: string;
  reasoning?: string;
  timestamp: number;
  isStreaming?: boolean;
  toolCards?: MessageToolCard[];
}

export interface ToolCallMessage extends ChatMessageBase {
  role: "tool";
  id: string;
  toolName: string;
  toolCallId: string;
  input: unknown;
  output?: unknown;
  status: "started" | "completed" | "error";
  error?: string;
  timestamp: number;
}

export interface SystemMessage extends ChatMessageBase {
  role: "system";
  id: string;
  content: string;
  timestamp: number;
}

/** Channel configuration */
export interface Channel {
  type: string;
  enabled: boolean;
  config: Record<string, unknown>;
  status?: "connected" | "disconnected" | "error";
  connectionCount?: number;
}

/** Event listener callback */
export type EventCallback<T = unknown> = (payload: T) => void;

/** Event subscription handle */
export interface EventSubscription {
  unsubscribe: () => void;
}

/** RPC pending request */
export interface PendingRequest {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}
