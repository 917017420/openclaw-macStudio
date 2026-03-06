// GatewayClient — WebSocket client for OpenClaw Gateway (Protocol v3)
// Token-only authentication (no device identity required).

import WebSocket from "@tauri-apps/plugin-websocket";
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
  parseAuthResponse,
  type AuthResult,
} from "./auth";
import type {
  ConnectionError,
  ConnectionState,
  EventCallback,
  EventSubscription,
  GatewayConfig,
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
const DEBUG_GATEWAY = false;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private config: GatewayConfig | null = null;

  // State
  private _state: ConnectionState = "disconnected";
  private _error: ConnectionError | null = null;
  private _authResult: AuthResult | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // RPC tracking
  private pendingRequests = new Map<string, PendingRequest>();

  // Event listeners
  private eventListeners = new Map<string, Set<EventCallback>>();
  private stateListeners = new Set<EventCallback<ConnectionState>>();

  // Diagnostic counters
  private _eventCount = 0;
  private _lastEventAt = 0;
  private _eventLog: Array<{ event: string; time: number; payloadSnippet: string }> = [];

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

    this.setState("connecting");

    try {
      await this.createConnection();
    } catch (err) {
      const message = String(err);
      if (message.includes("pairing required")) {
        const requestIdMatch = message.match(/requestId:\s*([^\s)]+)/i);
        const requestId = requestIdMatch?.[1];
        const requestIdHint = requestId ? ` Request ID: ${requestId}` : "";
        this._error = {
          code: "PAIRING_REQUIRED",
          message: `Pairing required. Approve this device on the Gateway side.${requestIdHint}`,
          timestamp: Date.now(),
        };
        this.setState("pairing_required");
        throw err;
      }
      this.handleError("CONNECTION_FAILED", String(err));
      throw err;
    }
  }

  /**
   * Disconnect from Gateway
   */
  async disconnect(): Promise<void> {
    this.clearTimers();
    this.rejectAllPending("Disconnected");

    if (this.ws) {
      try {
        await this.ws.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      this.ws = null;
    }

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

    this.ws = await WebSocket.connect(url, {
      headers: {},
    });

    this.ws.addListener((msg) => {
      if (typeof msg === "string") {
        if (DEBUG_GATEWAY) {
          console.log("[GatewayClient] WS string message (unexpected):", (msg as string).slice(0, 200));
        }
        return;
      }

      const wsMsg = msg as { type?: string; data?: string };
      const wsType = typeof wsMsg.type === "string" ? wsMsg.type.toLowerCase() : "";

      if (wsType === "close" || wsType === "closed") {
        this.handleClose();
        return;
      }

      if (wsType === "text" && wsMsg.data) {
        this.handleMessage(wsMsg.data);
        return;
      }

      // Log any unhandled message types
      if (DEBUG_GATEWAY) {
        console.log("[GatewayClient] Unhandled WS message type:", wsMsg.type);
      }
    });

    // Wait for challenge and authenticate
    this.setState("authenticating");
    await this.authenticate();
  }

  private authenticate(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this._authHandler = null;
        reject(new Error("Authentication timeout"));
      }, 15_000);

      const challengeHandler = async (rawData: string) => {
        const msg = parseMessage(rawData);
        if (!msg || msg.type !== "event") return;

        const event = msg as GatewayEvent;
        const nonce = extractNonce(event);
        if (!nonce) return;

        // Clear the handler so it doesn't fire again
        this._authHandler = null;

        try {
          // Build connect params (token + persisted device identity)
          const params = await buildConnectParams(this.config!, nonce);
          const id = generateRequestId();
          const req = createRequest(id, "connect", params);

          // Register response handler
          this.pendingRequests.set(id, {
            resolve: (payload: unknown) => {
              clearTimeout(timeout);

              // Log the FULL hello-ok response for debugging
              if (DEBUG_GATEWAY) {
                console.log(
                  "[Gateway] Full hello-ok response:",
                  JSON.stringify(payload, null, 2),
                );
              }

              const authResult = parseAuthResponse(payload);
              if (authResult) {
                this._authResult = authResult;
                if (DEBUG_GATEWAY) {
                  console.log("[Gateway] Connected:", authResult.connId);
                  console.log("[Gateway] Available methods:", authResult.methods);
                  console.log("[Gateway] Available events:", authResult.events);
                  console.log("[Gateway] Snapshot keys:", Object.keys(authResult.snapshot));
                }
                this.setState("connected");
                this.startHeartbeat();

                // Try to subscribe to events after connection
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

                resolve();
              } else {
                reject(new Error("Invalid auth response"));
              }
            },
            reject: (err: Error) => {
              clearTimeout(timeout);
              reject(err);
            },
            timer: timeout,
          });

          await this.send(JSON.stringify(req));
        } catch (err) {
          clearTimeout(timeout);
          reject(err);
        }
      };

      this._authHandler = challengeHandler;
    });
  }

  private _authHandler: ((data: string) => void) | null = null;

  private handleMessage(raw: string): void {
    // Log ALL raw messages (truncated) for diagnostics
    const isTickEvent = raw.includes('"tick"');
    if (DEBUG_GATEWAY && !isTickEvent) {
      console.log("[GatewayClient] Raw message:", raw.slice(0, 500));
    }

    // During authentication, pass to auth handler first
    if (this._authHandler && this._state === "authenticating") {
      this._authHandler(raw);
    }

    const msg = parseMessage(raw);
    if (!msg) return;

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

    this.pendingRequests.delete(res.id);
    clearTimeout(pending.timer);

    if (res.ok) {
      pending.resolve(this.normalizeResponsePayload(res.payload));
    } else {
      const errMsg = res.error?.message ?? "Unknown error";
      const details = (res.error?.details as { requestId?: string } | undefined) ?? undefined;
      const requestIdHint = details?.requestId ? ` (requestId: ${details.requestId})` : "";
      pending.reject(new Error(`RPC error: ${errMsg}${requestIdHint}`));
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

  private handleClose(): void {
    this._authHandler = null;

    if (this._state === "disconnected") return;

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

    if (state === "connected") {
      this._authHandler = null;
    }

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
    this._error = { code, message, timestamp: Date.now() };
    this.setState("error");
  }

  private setWarning(code: string, message: string): void {
    this._error = { code, message, timestamp: Date.now() };
    this.notifyStateListeners();
  }

  private async send(data: string): Promise<void> {
    if (!this.ws) {
      throw new Error("WebSocket not connected");
    }
    try {
      await this.ws.send(data);
    } catch (err) {
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
  }

  private rejectAllPending(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new Error(reason));
      this.pendingRequests.delete(id);
    }
  }
}

/** Singleton instance */
export const gateway = new GatewayClient();
