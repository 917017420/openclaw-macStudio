// GatewayClient — WebSocket client for OpenClaw Gateway (Protocol v3)
// Uses signed device identity + shared token for Control UI pairing/auth.

import { Channel, invoke } from "@tauri-apps/api/core";
import WebSocket, {
  type ConnectionConfig,
  type Message as TauriWsMessage,
} from "@tauri-apps/plugin-websocket";
import {
  createRequest,
  generateRequestId,
  parseMessage,
  type GatewayEvent,
  type GatewayResponse,
} from "./protocol";
import {
  buildConnectParams,
  extractNonce,
  GATEWAY_CLIENT_INFO,
  parseAuthResponse,
  type AuthResult,
} from "./auth";
import type {
  ConnectionError,
  ConnectionState,
  EventCallback,
  EventSubscription,
  GatewayConfig,
  GatewayHandshakeTraceEntry,
  GatewayRuntimeContext,
  PendingRequest,
} from "./types";

/** Default RPC timeout in ms */
const RPC_TIMEOUT = 30_000;

/** Heartbeat interval in ms */
const HEARTBEAT_INTERVAL = 30_000;

/** Max reconnect attempts */
const MAX_RECONNECT_ATTEMPTS = 10;

/** Base reconnect delay in ms */
const BASE_RECONNECT_DELAY = 1_000;
const MAX_HANDSHAKE_TRACE = 40;
const DEBUG_GATEWAY = false;

function normalizeSocketConfig(config?: ConnectionConfig): ConnectionConfig | undefined {
  if (!config) {
    return undefined;
  }

  if (!config.headers) {
    return config;
  }

  return {
    ...config,
    headers: Array.from(new Headers(config.headers).entries()),
  };
}

async function connectWithBufferedMessages(
  url: string,
  config?: ConnectionConfig,
): Promise<{
  socket: WebSocket;
  bufferedMessages: TauriWsMessage[];
  addListener: (listener: (message: TauriWsMessage) => void) => () => void;
}> {
  const listeners = new Set<(message: TauriWsMessage) => void>();
  const bufferedMessages: TauriWsMessage[] = [];
  const onMessage = new Channel<TauriWsMessage>();

  onMessage.onmessage = (message) => {
    if (listeners.size === 0) {
      bufferedMessages.push(message);
      return;
    }

    for (const cb of listeners) {
      cb(message);
    }
  };

  const id = await invoke<number>("plugin:websocket|connect", {
    url,
    onMessage,
    config: normalizeSocketConfig(config),
  });

  return {
    socket: new WebSocket(id, listeners),
    bufferedMessages,
    addListener: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

type GatewayRpcError = Error & {
  gatewayCode?: string;
  gatewayDetails?: unknown;
};

function createGatewayRpcError(response: GatewayResponse): GatewayRpcError {
  const error = new Error(
    response.error?.message ?? response.error?.code ?? "Unknown error",
  ) as GatewayRpcError;
  error.gatewayCode = response.error?.code;
  error.gatewayDetails = response.error?.details;
  return error;
}

function readGatewayDetailCode(error: unknown): string | null {
  const details = (error as GatewayRpcError | null | undefined)?.gatewayDetails;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const code = (details as { code?: unknown }).code;
  return typeof code === "string" && code.trim().length > 0 ? code : null;
}

function readGatewayRequestId(error: unknown): string | null {
  const details = (error as GatewayRpcError | null | undefined)?.gatewayDetails;
  if (!details || typeof details !== "object" || Array.isArray(details)) {
    return null;
  }

  const requestId = (details as { requestId?: unknown }).requestId;
  return typeof requestId === "string" && requestId.trim().length > 0 ? requestId : null;
}

type GatewayCloseFrame = {
  code: number;
  reason: string;
};

function isCloseFrame(value: unknown): value is GatewayCloseFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const frame = value as { code?: unknown; reason?: unknown };
  return typeof frame.code === "number" && typeof frame.reason === "string";
}

function decodeBinarySocketMessage(data: number[]): string | null {
  try {
    return new TextDecoder().decode(Uint8Array.from(data));
  } catch {
    return null;
  }
}

function summarizeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function readRuntimeValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function resolveRuntimeContext(explicitOriginHeader: string | null = null): GatewayRuntimeContext {
  const location = typeof window !== "undefined" ? window.location : null;
  const documentRef = typeof document !== "undefined" ? document : null;
  const navigatorRef = typeof navigator !== "undefined" ? navigator : null;
  const tauriWindow =
    typeof window !== "undefined"
      ? (window as Window & { __TAURI__?: unknown; __TAURI_INTERNALS__?: unknown })
      : null;

  return {
    clientId: GATEWAY_CLIENT_INFO.id,
    clientMode: GATEWAY_CLIENT_INFO.mode,
    socketTransport: "tauri-plugin-websocket",
    explicitOriginHeader,
    locationHref: readRuntimeValue(location?.href),
    locationOrigin: readRuntimeValue(location?.origin),
    locationProtocol: readRuntimeValue(location?.protocol),
    locationHost: readRuntimeValue(location?.host),
    documentBaseUri: readRuntimeValue(documentRef?.baseURI),
    referrer: readRuntimeValue(documentRef?.referrer),
    userAgent: readRuntimeValue(navigatorRef?.userAgent),
    platform: readRuntimeValue(navigatorRef?.platform),
    tauriDetected: Boolean(tauriWindow?.__TAURI__ || tauriWindow?.__TAURI_INTERNALS__),
  };
}

function summarizeRuntimeContext(context: GatewayRuntimeContext): string {
  return [
    `client=${context.clientId}/${context.clientMode}`,
    `origin=${context.locationOrigin ?? "n/a"}`,
    `href=${context.locationHref ?? "n/a"}`,
    `transport=${context.socketTransport}`,
    `originHeader=${context.explicitOriginHeader ?? "none"}`,
    `tauri=${context.tauriDetected ? "yes" : "no"}`,
  ].join(" ");
}

export class GatewayClient {
  private ws: WebSocket | null = null;
  private removeWsListener: (() => void) | null = null;
  private config: GatewayConfig | null = null;
  private _runtimeContext: GatewayRuntimeContext = resolveRuntimeContext();

  // State
  private _state: ConnectionState = "disconnected";
  private _error: ConnectionError | null = null;
  private _authResult: AuthResult | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private authTimer: ReturnType<typeof setTimeout> | null = null;
  private authResolve: (() => void) | null = null;
  private authReject: ((error: Error) => void) | null = null;
  private connectSent = false;
  private suppressReconnect = false;
  private intentionalDisconnect = false;
  private connectChallengeSeen = false;
  private connectRequestId: string | null = null;
  private lastCloseFrame: GatewayCloseFrame | null = null;
  private lastHandshakeStage = "idle";

  // RPC tracking
  private pendingRequests = new Map<string, PendingRequest>();

  // Event listeners
  private eventListeners = new Map<string, Set<EventCallback>>();
  private stateListeners = new Set<EventCallback<ConnectionState>>();

  // Diagnostic counters
  private _eventCount = 0;
  private _lastEventAt = 0;
  private _eventLog: Array<{ event: string; time: number; payloadSnippet: string }> = [];
  private _handshakeTrace: GatewayHandshakeTraceEntry[] = [];

  /** Total gateway events received since connection */
  get eventCount(): number {
    return this._eventCount;
  }

  /** Timestamp of last event received */
  get lastEventAt(): number {
    return this._lastEventAt;
  }

  /** Recent event log (last 20 events) for diagnostics */
  get recentEvents(): Array<{ event: string; time: number; payloadSnippet: string }> {
    return this._eventLog;
  }

  /** Recent handshake trace for verification/auth diagnostics */
  get recentHandshakeTrace(): GatewayHandshakeTraceEntry[] {
    return this._handshakeTrace;
  }

  /** Current desktop runtime/WebView context for origin diagnostics */
  get runtimeContext(): GatewayRuntimeContext {
    return this._runtimeContext;
  }

  /** Current connection state */
  get state(): ConnectionState {
    return this._state;
  }

  /** Last connection error */
  get error(): ConnectionError | null {
    return this._error;
  }

  /** Whether connected and authenticated */
  get isConnected(): boolean {
    return this._state === "connected";
  }

  /** Auth result after successful connection */
  get authResult(): AuthResult | null {
    return this._authResult;
  }

  /**
   * Connect to a Gateway server
   */
  async connect(config: GatewayConfig): Promise<void> {
    if (this.ws) {
      await this.disconnect();
    }

    this.config = config;
    this.reconnectAttempts = 0;
    this._error = null;
    this._authResult = null;
    this.suppressReconnect = false;
    this.intentionalDisconnect = false;
    this._runtimeContext = resolveRuntimeContext();
    this.resetHandshakeDiagnostics();
    this.recordHandshake("runtime.context", summarizeRuntimeContext(this._runtimeContext));
    this.recordHandshake("connect.start", config.url);

    this.setState("connecting");

    try {
      await this.createConnection();
    } catch (err) {
      const message = String(err);
      const detailCode = readGatewayDetailCode(err);
      if (detailCode === "PAIRING_REQUIRED" || message.includes("pairing required")) {
        const requestId = readGatewayRequestId(err) ?? message.match(/requestId:\s*([^\s)]+)/i)?.[1];
        const requestIdHint = requestId ? ` Request ID: ${requestId}` : "";
        this._error = this.createConnectionError(
          "PAIRING_REQUIRED",
          `Pairing required. Approve this device on the Gateway side.${requestIdHint}`,
        );
        this.suppressReconnect = true;
        this.setState("pairing_required");
        throw err;
      }
      this.suppressReconnect = true;
      this.handleError("CONNECTION_FAILED", String(err));
      throw err;
    }
  }

  /**
   * Disconnect from Gateway
   */
  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this.suppressReconnect = true;
    this.clearTimers();
    this.clearAuthenticationState();
    this.rejectAllPending("Disconnected");

    if (this.ws) {
      try {
        await this.ws.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.ws = null;
    }
    this.removeWsListener?.();
    this.removeWsListener = null;

    this._authResult = null;
    this.setState("disconnected");
  }

  /**
   * Send an RPC request and wait for response
   */
  async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {},
    timeout = RPC_TIMEOUT,
  ): Promise<T> {
    if (!this.isConnected) {
      throw new Error("Not connected to Gateway");
    }

    const id = generateRequestId();
    const msg = createRequest(id, method, params);

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method} (${timeout}ms)`));
      }, timeout);

      this.pendingRequests.set(id, {
        resolve: resolve as (payload: unknown) => void,
        reject,
        timer,
      });

      this.send(JSON.stringify(msg)).catch((err) => {
        this.pendingRequests.delete(id);
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  /**
   * Subscribe to Gateway events
   */
  on<T = unknown>(event: string, callback: EventCallback<T>): EventSubscription {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    const listeners = this.eventListeners.get(event)!;
    const wrappedCb = callback as EventCallback;
    listeners.add(wrappedCb);

    return {
      unsubscribe: () => {
        listeners.delete(wrappedCb);
        if (listeners.size === 0) {
          this.eventListeners.delete(event);
        }
      },
    };
  }

  /**
   * Subscribe to connection state changes
   */
  onStateChange(callback: EventCallback<ConnectionState>): EventSubscription {
    this.stateListeners.add(callback);
    return {
      unsubscribe: () => {
        this.stateListeners.delete(callback);
      },
    };
  }

  // ---- Private methods ----

  private async createConnection(): Promise<void> {
    const url = this.config!.url;
    const authPromise = this.beginAuthentication();
    let socket: WebSocket | null = null;

    this.setState("authenticating");
    this.armAuthenticationTimeout();
    this.recordHandshake("socket.connect.start", url);

    try {
      const { socket: nextSocket, bufferedMessages, addListener } = await connectWithBufferedMessages(url, {
        headers: {},
      });

      socket = nextSocket;
      this.ws = nextSocket;
      this.removeWsListener = addListener((msg) => this.handleSocketMessage(msg));
      this.recordHandshake("socket.connect.ready", `buffered=${bufferedMessages.length}`);

      for (const bufferedMessage of bufferedMessages) {
        this.handleSocketMessage(bufferedMessage);
      }

      await authPromise;
    } catch (err) {
      this.recordHandshake("auth.failed", summarizeError(err));
      this.suppressReconnect = true;
      this.removeWsListener?.();
      this.removeWsListener = null;
      const activeSocket = socket ?? this.ws;
      this.ws = null;
      if (activeSocket) {
        await activeSocket.disconnect().catch(() => {
          // Ignore close failures while unwinding a failed handshake.
        });
      }
      this.clearAuthenticationState();
      throw err;
    }
  }

  private handleSocketMessage(msg: TauriWsMessage): void {
    const wsMsg = msg as { type?: string; data?: string };
    const wsType = typeof wsMsg.type === "string" ? wsMsg.type.toLowerCase() : "";

    if (wsType === "close" || wsType === "closed") {
      const closeFrame = isCloseFrame(wsMsg.data) ? wsMsg.data : null;
      if (closeFrame) {
        this.lastCloseFrame = closeFrame;
        this.recordHandshake(
          "socket.close",
          `code=${closeFrame.code} reason=${closeFrame.reason || "n/a"}`,
        );
      } else {
        this.recordHandshake("socket.close");
      }
      this.handleClose(closeFrame);
      return;
    }

    if (wsType === "text" && typeof wsMsg.data === "string") {
      this.handleMessage(wsMsg.data);
      return;
    }

    if (wsType === "binary" && Array.isArray((msg as { data?: unknown }).data)) {
      const decoded = decodeBinarySocketMessage((msg as { data: number[] }).data);
      this.recordHandshake(
        "socket.binary",
        decoded ? `bytes=${(msg as { data: number[] }).data.length} decoded` : "undecodable",
      );
      if (decoded) {
        this.handleMessage(decoded);
      }
      return;
    }

    // Log any unhandled message types
    if (DEBUG_GATEWAY) {
      console.log("[GatewayClient] Unhandled WS message type:", wsMsg.type);
    }
  }

  private beginAuthentication(): Promise<void> {
    this.clearAuthenticationState();
    this.connectSent = false;
    this.connectChallengeSeen = false;
    this.connectRequestId = null;

    return new Promise<void>((resolve, reject) => {
      this.authResolve = resolve;
      this.authReject = reject;
    });
  }

  private handleMessage(raw: string): void {
    // Log ALL raw messages (truncated) for diagnostics
    const isTickEvent = raw.includes('"tick"');
    if (DEBUG_GATEWAY && !isTickEvent) {
      console.log("[GatewayClient] Raw message:", raw.slice(0, 500));
    }

    const msg = parseMessage(raw);
    if (!msg) {
      if (this.hasPendingAuthentication()) {
        this.recordHandshake("message.unparsed", raw.slice(0, 180));
      }
      return;
    }

    switch (msg.type) {
      case "res":
        this.handleResponse(msg as GatewayResponse);
        break;
      case "event":
        this.handleEvent(msg as GatewayEvent);
        break;
      default:
        break;
    }
  }

  private handleResponse(res: GatewayResponse): void {
    const pending = this.pendingRequests.get(res.id);
    if (!pending) return;

    if (res.id === this.connectRequestId) {
      this.recordHandshake(
        res.ok ? "connect.response.ok" : "connect.response.error",
        res.ok
          ? "hello-ok"
          : `${res.error?.code ?? "UNKNOWN"}: ${res.error?.message ?? "request failed"}`,
      );
    }

    this.pendingRequests.delete(res.id);
    clearTimeout(pending.timer);

    if (res.ok) {
      pending.resolve(this.normalizeResponsePayload(res.payload));
    } else {
      pending.reject(createGatewayRpcError(res));
    }
  }

  private normalizeResponsePayload(payload: unknown): unknown {
    if (typeof payload !== "string") {
      return payload;
    }
    const trimmed = payload.trim();
    if (!trimmed) {
      return payload;
    }
    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return payload;
      }
    }
    return payload;
  }

  private handleEvent(event: GatewayEvent): void {
    if (event.event === "connect.challenge") {
      const nonce = extractNonce(event);
      this.connectChallengeSeen = true;
      this.recordHandshake(
        "challenge.received",
        nonce ? `nonce_len=${nonce.trim().length}` : "missing_nonce",
      );
      if (nonce && this.hasPendingAuthentication()) {
        void this.sendConnect(nonce);
      } else if (!nonce && this.hasPendingAuthentication()) {
        this.suppressReconnect = true;
        this.clearAuthenticationState(new Error("Gateway connect challenge missing nonce"));
      }
      return;
    }

    // Diagnostic tracking
    this._eventCount++;
    this._lastEventAt = Date.now();
    const snippet = JSON.stringify(event.payload).slice(0, 200);
    this._eventLog.push({ event: event.event, time: this._lastEventAt, payloadSnippet: snippet });
    if (this._eventLog.length > 20) this._eventLog.shift();

    if (DEBUG_GATEWAY) {
      console.log(
        `[GatewayClient] Event #${this._eventCount} "${event.event}" (seq=${event.seq}):`,
        snippet,
      );
    }

    const listeners = this.eventListeners.get(event.event);
    const listenerCount = listeners?.size ?? 0;
    if (DEBUG_GATEWAY) {
      console.log(
        `[GatewayClient] Dispatching "${event.event}" to ${listenerCount} listener(s)`,
      );
    }

    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(event.payload);
        } catch (err) {
          console.error(`Event listener error (${event.event}):`, err);
        }
      }
    }

    // Wildcard listeners
    const wildcardListeners = this.eventListeners.get("*");
    if (wildcardListeners) {
      for (const cb of wildcardListeners) {
        try {
          cb(event);
        } catch (err) {
          console.error("Wildcard event listener error:", err);
        }
      }
    }
  }

  private handleClose(closeFrame?: GatewayCloseFrame | null): void {
    const hadPendingAuthentication = this.hasPendingAuthentication();
    const resolvedCloseFrame = closeFrame ?? this.lastCloseFrame;
    if (hadPendingAuthentication) {
      this.recordHandshake(
        "auth.closed",
        `challenge=${this.connectChallengeSeen ? "yes" : "no"} connectSent=${this.connectSent ? "yes" : "no"}`,
      );
    }
    this.removeWsListener?.();
    this.removeWsListener = null;
    this.ws = null;
    this.clearTimers();
    this.rejectAllPending("Connection closed");
    this.clearAuthenticationState(
      hadPendingAuthentication
        ? new Error(
            resolvedCloseFrame
              ? `Connection closed during authentication (${resolvedCloseFrame.code}: ${resolvedCloseFrame.reason || "n/a"})`
              : "Connection closed during authentication",
          )
        : undefined,
    );

    if (this._state === "disconnected") return;

    if (this.intentionalDisconnect || this.suppressReconnect) {
      return;
    }

    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS && this.config) {
      this.scheduleReconnect();
    } else {
      this.handleError("CONNECTION_LOST", "Connection lost and max retries exceeded");
    }
  }

  /**
   * Try multiple strategies to subscribe to server events.
   * Some gateways require explicit subscription after connect.
   */
  private async subscribeToEvents(availableEvents: string[]): Promise<void> {
    if (availableEvents.length === 0) {
      if (DEBUG_GATEWAY) {
        console.log("[Gateway] No events listed, skipping subscription");
      }
      return;
    }

    const eventNames = availableEvents.filter(
      (e) => e !== "tick" && e !== "connect.challenge",
    );

    if (eventNames.length === 0) return;

    if (DEBUG_GATEWAY) {
      console.log("[Gateway] Attempting to subscribe to events:", eventNames);
    }

    const supportedMethods = new Set(this._authResult?.methods ?? []);
    const shouldProbeAll = supportedMethods.size === 0;
    const supportsEventsSubscribe =
      shouldProbeAll || supportedMethods.has("events.subscribe");
    const supportsSubscribe = shouldProbeAll || supportedMethods.has("subscribe");

    let subscribed = false;

    // Strategy 1: events.subscribe RPC
    if (supportsEventsSubscribe) {
      try {
        const res = await this.request<unknown>("events.subscribe", {
          events: eventNames,
        });
        if (DEBUG_GATEWAY) {
          console.log("[Gateway] events.subscribe succeeded:", res);
        }
        subscribed = true;
        return;
      } catch (err) {
        if (DEBUG_GATEWAY) {
          console.log("[Gateway] events.subscribe not available:", err);
        }
      }
    } else {
      if (DEBUG_GATEWAY) {
        console.log("[Gateway] events.subscribe not advertised by server, skipping");
      }
    }

    // Strategy 2: subscribe RPC
    if (supportsSubscribe) {
      try {
        const res = await this.request<unknown>("subscribe", {
          events: eventNames,
        });
        if (DEBUG_GATEWAY) {
          console.log("[Gateway] subscribe succeeded:", res);
        }
        subscribed = true;
        return;
      } catch (err) {
        if (DEBUG_GATEWAY) {
          console.log("[Gateway] subscribe not available:", err);
        }
      }
    } else {
      if (DEBUG_GATEWAY) {
        console.log("[Gateway] subscribe not advertised by server, skipping");
      }
    }

    // Strategy 3: Individual event subscriptions
    if (supportsEventsSubscribe) {
      for (const eventName of eventNames) {
        try {
          const res = await this.request<unknown>("events.subscribe", {
            event: eventName,
          });
          if (DEBUG_GATEWAY) {
            console.log(`[Gateway] Subscribed to ${eventName}:`, res);
          }
          subscribed = true;
        } catch {
          // Silently skip — not all gateways support this
        }
      }
    }

    if (!subscribed) {
      if (DEBUG_GATEWAY) {
        console.log(
          "[Gateway] No explicit subscribe method available. " +
          "Assuming server pushes events automatically for this role.",
        );
      }
      return;
    }

    if (DEBUG_GATEWAY) {
      console.log(
        "[Gateway] Event subscription attempts complete. " +
        "If events still don't arrive, the server may auto-subscribe based on role/scopes.",
      );
    }
  }

  private scheduleReconnect(): void {
    this.setState("reconnecting");
    this.reconnectAttempts++;
    this.suppressReconnect = false;

    const delay =
      Math.min(BASE_RECONNECT_DELAY * Math.pow(2, this.reconnectAttempts - 1), 30_000) +
      Math.random() * 1000;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.createConnection();
        this.reconnectAttempts = 0;
      } catch {
        if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          this.scheduleReconnect();
        } else {
          this.handleError("RECONNECT_FAILED", "Max reconnect attempts exceeded");
        }
      }
    }, delay);
  }

  private startHeartbeat(): void {
    // The server sends periodic `tick` events as keepalive.
    // We just need to track if we've received any message recently.
    // If not, attempt a reconnect.
    this.heartbeatTimer = setInterval(() => {
      // No-op for now — rely on server tick events + WebSocket close detection.
      // If needed, we can track lastMessageTime and close stale connections.
    }, HEARTBEAT_INTERVAL);
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;

    this.notifyStateListeners();
  }

  private notifyStateListeners(): void {
    for (const cb of this.stateListeners) {
      try {
        cb(this._state);
      } catch (err) {
        console.error("State listener error:", err);
      }
    }
  }

  private handleError(code: string, message: string): void {
    this._error = this.createConnectionError(code, message);
    this.setState("error");
  }

  private setWarning(code: string, message: string): void {
    this._error = this.createConnectionError(code, message);
    this.notifyStateListeners();
  }

  private async send(data: string): Promise<void> {
    if (!this.ws) {
      throw new Error("WebSocket not connected");
    }
    try {
      await this.ws.send(data);
    } catch (err) {
      if (this.hasPendingAuthentication()) {
        this.recordHandshake("socket.send.failed", summarizeError(err));
      }
      console.warn("[GatewayClient] send failed, marking connection as closed:", err);
      this.handleClose();
      throw err;
    }
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }

  private armAuthenticationTimeout(): void {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }
    this.authTimer = setTimeout(() => {
      this.recordHandshake(
        "auth.timeout",
        `challenge=${this.connectChallengeSeen ? "yes" : "no"} connectSent=${this.connectSent ? "yes" : "no"}`,
      );
      const error = new Error("Authentication timeout waiting for connect challenge");
      this.suppressReconnect = true;
      this.clearAuthenticationState(error);
      if (this.ws) {
        void this.ws.disconnect().catch(() => {
          // Ignore disconnect errors while tearing down a failed handshake.
        });
      }
    }, 15_000);
  }

  private hasPendingAuthentication(): boolean {
    return Boolean(this.authResolve || this.authReject);
  }

  private clearAuthenticationState(error?: Error): void {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    const reject = error ? this.authReject : null;

    this.authResolve = null;
    this.authReject = null;
    this.connectSent = false;
    this.connectRequestId = null;

    if (reject && error) {
      reject(error);
    }
  }

  private completeAuthentication(): void {
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    const resolve = this.authResolve;
    this.authResolve = null;
    this.authReject = null;
    this.connectSent = false;
    this.connectRequestId = null;
    resolve?.();
  }

  private async sendConnect(nonce: string): Promise<void> {
    if (this.connectSent || !this.config) {
      return;
    }

    const trimmedNonce = nonce.trim();
    if (!trimmedNonce) {
      this.recordHandshake("connect.nonce.invalid");
      this.suppressReconnect = true;
      this.clearAuthenticationState(new Error("Gateway connect challenge missing nonce"));
      return;
    }

    this.connectSent = true;
    this.recordHandshake("connect.prepare", `nonce_len=${trimmedNonce.length}`);
    if (this.authTimer) {
      clearTimeout(this.authTimer);
      this.authTimer = null;
    }

    try {
      const params = await buildConnectParams(this.config, trimmedNonce);
      const id = generateRequestId();
      this.connectRequestId = id;
      this.recordHandshake(
        "connect.prepared",
        `req=${id} auth=${params.auth?.token ? "token" : params.auth?.deviceToken ? "device-token" : "none"}`,
      );
      const req = createRequest(id, "connect", params as Record<string, unknown>);

      this.pendingRequests.set(id, {
        resolve: (payload: unknown) => {
          const authResult = parseAuthResponse(payload);
          if (!authResult) {
            this.recordHandshake("connect.payload.invalid");
            this.suppressReconnect = true;
            this.clearAuthenticationState(new Error("Invalid auth response"));
            return;
          }

          this._authResult = authResult;
          this.recordHandshake("connect.authenticated", authResult.connId ?? "connected");

          if (DEBUG_GATEWAY) {
            console.log("[Gateway] Connected:", authResult.connId);
            console.log("[Gateway] Available methods:", authResult.methods);
            console.log("[Gateway] Available events:", authResult.events);
            console.log("[Gateway] Snapshot keys:", Object.keys(authResult.snapshot));
          }

          this.setState("connected");
          this.startHeartbeat();
          this.completeAuthentication();

          this.subscribeToEvents(authResult.events).then(
            () => {
              if (DEBUG_GATEWAY) {
                console.log("[Gateway] Event subscription complete");
              }
              if (this._error?.code === "EVENT_SUBSCRIPTION_FAILED") {
                this._error = null;
                this.notifyStateListeners();
              }
            },
            (err) => {
              if (DEBUG_GATEWAY) {
                console.warn("[Gateway] Event subscription failed:", err);
              }
              this.setWarning(
                "EVENT_SUBSCRIPTION_FAILED",
                "Connected, but failed to subscribe to real-time events. Message updates may be delayed.",
              );
            },
          );
        },
        reject: (err: Error) => {
          this.recordHandshake("connect.rejected", summarizeError(err));
          this.suppressReconnect = true;
          this.clearAuthenticationState(err);
        },
        timer: setTimeout(() => {
          this.pendingRequests.delete(id);
          this.recordHandshake("connect.rpc.timeout", `req=${id}`);
          this.suppressReconnect = true;
          this.clearAuthenticationState(new Error(`RPC timeout: connect (${RPC_TIMEOUT}ms)`));
        }, RPC_TIMEOUT),
      });

      this.recordHandshake("connect.send", id);
      await this.send(JSON.stringify(req));
      this.recordHandshake("connect.sent", id);
    } catch (err) {
      this.recordHandshake("connect.prepare.failed", summarizeError(err));
      this.suppressReconnect = true;
      this.connectSent = false;
      this.clearAuthenticationState(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private resetHandshakeDiagnostics(): void {
    this.connectChallengeSeen = false;
    this.connectRequestId = null;
    this.lastCloseFrame = null;
    this.lastHandshakeStage = "idle";
    this._handshakeTrace = [];
  }

  private recordHandshake(stage: string, detail?: string): void {
    const entry: GatewayHandshakeTraceEntry = {
      stage,
      timestamp: Date.now(),
      detail,
    };
    this.lastHandshakeStage = stage;
    this._handshakeTrace.push(entry);
    if (this._handshakeTrace.length > MAX_HANDSHAKE_TRACE) {
      this._handshakeTrace.shift();
    }

    if (DEBUG_GATEWAY) {
      console.log("[GatewayClient] handshake", stage, detail ?? "");
    }
  }

  private createConnectionError(code: string, message: string): ConnectionError {
    const closeCode = this.lastCloseFrame?.code;
    const closeReason = this.lastCloseFrame?.reason;
    const detailParts = [
      this.lastHandshakeStage !== "idle" ? `stage=${this.lastHandshakeStage}` : null,
      typeof closeCode === "number"
        ? `close=${closeCode}${closeReason ? `:${closeReason}` : ""}`
        : null,
    ].filter(Boolean);

    return {
      code,
      message: detailParts.length > 0 ? `${message} (${detailParts.join(" ")})` : message,
      timestamp: Date.now(),
      stage: this.lastHandshakeStage,
      closeCode,
      closeReason,
    };
  }
}

/** Singleton instance */
export const gateway = new GatewayClient();
