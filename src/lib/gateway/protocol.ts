// Gateway WebSocket message types

/** Unique request identifier */
export type RequestId = string;

/** Core message types for Gateway protocol */
export type GatewayMessage = GatewayRequest | GatewayResponse | GatewayEvent;

/** Client → Gateway request */
export interface GatewayRequest {
  type: "req";
  id: RequestId;
  method: string;
  params: Record<string, unknown>;
}

/** Gateway → Client response */
export interface GatewayResponse {
  type: "res";
  id: RequestId;
  ok: boolean;
  payload: unknown;
  error?: GatewayError;
}

/** Gateway → Client event */
export interface GatewayEvent {
  type: "event";
  event: string;
  payload: unknown;
  seq: number;
}

/** Error payload in responses */
export interface GatewayError {
  code: string;
  message: string;
  details?: unknown;
}

// ---- Request/Response type helpers ----

/** Connect request params (Protocol v3) */
export interface ConnectParams {
  minProtocol: number;
  maxProtocol: number;
  client: {
    id: string;
    version: string;
    platform: string;
    mode: string;
  };
  role: "operator";
  scopes: string[];
  auth: {
    token?: string;
    deviceToken?: string;
  };
  device?: {
    id?: string;
    nonce: string;
    publicKey?: string;
    signature?: string;
    signedAt?: number;
  };
}

/** Connect success response (hello-ok) */
export interface HelloOkPayload {
  type: "hello-ok";
  protocol: number;
  auth: {
    deviceToken: string;
    role: string;
    scopes: string[];
  };
  tick?: Record<string, unknown>;
}

/** Challenge event payload */
export interface ChallengePayload {
  nonce: string;
}

/** Config get response */
export interface ConfigPayload {
  [key: string]: unknown;
}

/** Chat send params */
export interface ChatSendParams {
  sessionKey: string;
  message: string;
  idempotencyKey: string;
}

// ---- Event payload types ----

/** Chat stream delta */
export interface ChatStreamDelta {
  agentId: string;
  sessionId: string;
  delta: string;
  type: "assistant" | "reasoning" | "tool";
}

/** Chat stream final */
export interface ChatStreamFinal {
  agentId: string;
  sessionId: string;
  content: string;
}

/** Agent lifecycle event */
export interface AgentLifecyclePayload {
  agentId: string;
  status: "running" | "idle" | "error";
}

/** Tool call event */
export interface ToolCallPayload {
  agentId: string;
  sessionId: string;
  toolName: string;
  toolCallId: string;
  status: "started" | "completed" | "error";
  input?: unknown;
  output?: unknown;
  error?: string;
}

// ---- Helper functions ----

/** Create a request message frame */
export function createRequest(
  id: RequestId,
  method: string,
  params: Record<string, unknown> = {},
): GatewayRequest {
  return { type: "req", id, method, params };
}

/** Parse raw WebSocket message */
export function parseMessage(raw: string): GatewayMessage | null {
  try {
    const msg = JSON.parse(raw) as GatewayMessage;
    if (msg.type === "req" || msg.type === "res" || msg.type === "event") {
      return msg;
    }
    return null;
  } catch {
    return null;
  }
}

/** Generate a unique request ID */
let _reqCounter = 0;
export function generateRequestId(): RequestId {
  return `req_${Date.now()}_${++_reqCounter}`;
}
