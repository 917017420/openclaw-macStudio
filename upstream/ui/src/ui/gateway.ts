import { buildDeviceAuthPayload } from "../../../src/gateway/device-auth.js";
import TauriWebSocket, {
  type CloseFrame as TauriCloseFrame,
  type Message as TauriWebSocketMessage,
} from "@tauri-apps/plugin-websocket";
import {
  GATEWAY_CLIENT_MODES,
  GATEWAY_CLIENT_NAMES,
  type GatewayClientMode,
  type GatewayClientName,
} from "../../../src/gateway/protocol/client-info.js";
import { readConnectErrorDetailCode } from "../../../src/gateway/protocol/connect-error-details.js";
import { clearDeviceAuthToken, loadDeviceAuthToken, storeDeviceAuthToken } from "./device-auth.ts";
import { loadOrCreateDeviceIdentity, signDevicePayload } from "./device-identity.ts";
import { generateUUID } from "./uuid.ts";

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type GatewayErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorInfo) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export function resolveGatewayErrorDetailCode(
  error: { details?: unknown } | null | undefined,
): string | null {
  return readConnectErrorDetailCode(error?.details);
}

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  server?: {
    version?: string;
    connId?: string;
  };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
    issuedAtMs?: number;
  };
  policy?: { tickIntervalMs?: number };
};

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

type BrowserSocket = WebSocket;
type NativeSocket = TauriWebSocket;

type RuntimeGatewayClientIdentity = {
  clientName: GatewayClientName;
  mode: GatewayClientMode;
  transport: "browser-websocket" | "tauri-plugin-websocket";
};

export type GatewayBrowserClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientName?: GatewayClientName;
  clientVersion?: string;
  platform?: string;
  mode?: GatewayClientMode;
  instanceId?: string;
  onHello?: (hello: GatewayHelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayErrorInfo }) => void;
  onGap?: (info: { expected: number; received: number }) => void;
};

// 4008 = application-defined code (browser rejects 1008 "Policy Violation")
const CONNECT_FAILED_CLOSE_CODE = 4008;

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const tauriWindow = window as Window & {
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
  };

  return Boolean(tauriWindow.__TAURI__ || tauriWindow.__TAURI_INTERNALS__);
}

function resolveDesktopGatewayClientName(): GatewayClientName {
  if (typeof navigator !== "undefined") {
    const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
    if (platform.includes("mac")) {
      return GATEWAY_CLIENT_NAMES.MACOS_APP;
    }
  }

  return GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT;
}

export function resolveGatewayRuntimeIdentity(): RuntimeGatewayClientIdentity {
  if (isTauriRuntime()) {
    return {
      clientName: resolveDesktopGatewayClientName(),
      mode: GATEWAY_CLIENT_MODES.UI,
      transport: "tauri-plugin-websocket",
    };
  }

  return {
    clientName: GATEWAY_CLIENT_NAMES.CONTROL_UI,
    mode: GATEWAY_CLIENT_MODES.WEBCHAT,
    transport: "browser-websocket",
  };
}

function isTauriCloseFrame(value: unknown): value is TauriCloseFrame {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const frame = value as { code?: unknown; reason?: unknown };
  return typeof frame.code === "number" && typeof frame.reason === "string";
}

export class GatewayBrowserClient {
  private ws: BrowserSocket | NativeSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private lastSeq: number | null = null;
  private connectNonce: string | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private pendingConnectError: GatewayErrorInfo | undefined;
  private socketOpen = false;

  constructor(private opts: GatewayBrowserClientOptions) {}

  start() {
    this.closed = false;
    this.connect();
  }

  stop() {
    this.closed = true;
    void this.closeSocket(1000, "gateway client stopped");
    this.ws = null;
    this.socketOpen = false;
    this.pendingConnectError = undefined;
    this.flushPending(new Error("gateway client stopped"));
  }

  get connected() {
    return this.socketOpen;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    if (resolveGatewayRuntimeIdentity().transport === "tauri-plugin-websocket") {
      void this.connectViaTauri();
      return;
    }

    this.connectViaBrowser();
  }

  private connectViaBrowser() {
    const ws = new WebSocket(this.opts.url);
    this.ws = ws;
    this.socketOpen = false;
    ws.addEventListener("open", () => {
      if (this.ws !== ws) {
        return;
      }
      this.socketOpen = true;
      this.queueConnect();
    });
    ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    ws.addEventListener("close", (ev) => {
      if (this.ws !== ws) {
        return;
      }
      this.handleSocketClosed(ev.code, String(ev.reason ?? ""));
    });
    ws.addEventListener("error", () => {
      // ignored; close handler will fire
    });
  }

  private async connectViaTauri() {
    try {
      const ws = await TauriWebSocket.connect(this.opts.url, { headers: {} });
      if (this.closed) {
        await ws.disconnect().catch(() => {
          // best effort cleanup if the client closed while connecting
        });
        return;
      }

      this.ws = ws;
      this.socketOpen = true;
      ws.addListener((message) => {
        void this.handleTauriSocketMessage(ws, message);
      });
      this.queueConnect();
    } catch (error) {
      this.handleSocketClosed(1006, error instanceof Error ? error.message : String(error));
    }
  }

  private async handleTauriSocketMessage(
    ws: NativeSocket,
    message: TauriWebSocketMessage,
  ): Promise<void> {
    if (this.ws !== ws) {
      return;
    }

    switch (message.type) {
      case "Text":
        this.handleMessage(message.data);
        return;
      case "Binary": {
        const decoded = new TextDecoder().decode(Uint8Array.from(message.data));
        this.handleMessage(decoded);
        return;
      }
      case "Close": {
        const closeFrame = isTauriCloseFrame(message.data) ? message.data : null;
        this.handleSocketClosed(closeFrame?.code ?? 1000, closeFrame?.reason ?? "");
        return;
      }
      case "Ping":
      case "Pong":
        return;
      default:
        return;
    }
  }

  private handleSocketClosed(code: number, reason: string) {
    const connectError = this.pendingConnectError;
    this.pendingConnectError = undefined;
    this.ws = null;
    this.socketOpen = false;
    this.flushPending(new Error(`gateway closed (${code}): ${reason}`));
    this.opts.onClose?.({ code, reason, error: connectError });
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    window.setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }

    // crypto.subtle is only available in secure contexts (HTTPS, localhost).
    // Over plain HTTP, we skip device identity and fall back to token-only auth.
    // Gateways may reject this unless gateway.controlUi.allowInsecureAuth is enabled.
    const isSecureContext = typeof crypto !== "undefined" && !!crypto.subtle;
    const runtimeIdentity = resolveGatewayRuntimeIdentity();
    const clientName = this.opts.clientName ?? runtimeIdentity.clientName;
    const clientMode = this.opts.mode ?? runtimeIdentity.mode;

    const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];
    const role = "operator";
    let deviceIdentity: Awaited<ReturnType<typeof loadOrCreateDeviceIdentity>> | null = null;
    let canFallbackToShared = false;
    let authToken = this.opts.token;

    if (isSecureContext) {
      deviceIdentity = await loadOrCreateDeviceIdentity();
      const storedToken = loadDeviceAuthToken({
        deviceId: deviceIdentity.deviceId,
        role,
      })?.token;
      authToken = storedToken ?? this.opts.token;
      canFallbackToShared = Boolean(storedToken && this.opts.token);
    }
    const auth =
      authToken || this.opts.password
        ? {
            token: authToken,
            password: this.opts.password,
          }
        : undefined;

    let device:
      | {
          id: string;
          publicKey: string;
          signature: string;
          signedAt: number;
          nonce: string;
        }
      | undefined;

    if (isSecureContext && deviceIdentity) {
      const signedAtMs = Date.now();
      const nonce = this.connectNonce ?? "";
      const payload = buildDeviceAuthPayload({
        deviceId: deviceIdentity.deviceId,
        clientId: clientName,
        clientMode,
        role,
        scopes,
        signedAtMs,
        token: authToken ?? null,
        nonce,
      });
      const signature = await signDevicePayload(deviceIdentity.privateKey, payload);
      device = {
        id: deviceIdentity.deviceId,
        publicKey: deviceIdentity.publicKey,
        signature,
        signedAt: signedAtMs,
        nonce,
      };
    }
    const params = {
      minProtocol: 3,
      maxProtocol: 3,
      client: {
        id: clientName,
        version: this.opts.clientVersion ?? "control-ui",
        platform: this.opts.platform ?? navigator.platform ?? "web",
        mode: clientMode,
        instanceId: this.opts.instanceId,
      },
      role,
      scopes,
      device,
      caps: [],
      auth,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    void this.request<GatewayHelloOk>("connect", params)
      .then((hello) => {
        if (hello?.auth?.deviceToken && deviceIdentity) {
          storeDeviceAuthToken({
            deviceId: deviceIdentity.deviceId,
            role: hello.auth.role ?? role,
            token: hello.auth.deviceToken,
            scopes: hello.auth.scopes ?? [],
          });
        }
        this.backoffMs = 800;
        this.opts.onHello?.(hello);
      })
      .catch((err: unknown) => {
        if (err instanceof GatewayRequestError) {
          this.pendingConnectError = {
            code: err.gatewayCode,
            message: err.message,
            details: err.details,
          };
        } else {
          this.pendingConnectError = undefined;
        }
        if (canFallbackToShared && deviceIdentity) {
          clearDeviceAuthToken({ deviceId: deviceIdentity.deviceId, role });
        }
        void this.closeSocket(CONNECT_FAILED_CLOSE_CODE, "connect failed");
      });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const frame = parsed as { type?: unknown };
    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          this.connectNonce = nonce;
          void this.sendConnect();
        }
        return;
      }
      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
        }
        this.lastSeq = seq;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(
          new GatewayRequestError({
            code: res.error?.code ?? "UNAVAILABLE",
            message: res.error?.message ?? "request failed",
            details: res.error?.details,
          }),
        );
      }
      return;
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || !this.socketOpen) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    void this.sendRaw(JSON.stringify(frame)).catch((error) => {
      this.pending.delete(id);
      this.handleSocketClosed(1006, error instanceof Error ? error.message : String(error));
    });
    return p;
  }

  private async sendRaw(payload: string): Promise<void> {
    if (!this.ws || !this.socketOpen) {
      throw new Error("gateway not connected");
    }

    if (this.ws instanceof WebSocket) {
      this.ws.send(payload);
      return;
    }

    await this.ws.send(payload);
  }

  private async closeSocket(code: number, reason: string): Promise<void> {
    const ws = this.ws;
    if (!ws) {
      return;
    }

    if (ws instanceof WebSocket) {
      ws.close(code, reason);
      return;
    }

    await ws.disconnect();
  }

  private queueConnect() {
    this.connectNonce = null;
    this.connectSent = false;
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
    }
    this.connectTimer = window.setTimeout(() => {
      void this.sendConnect();
    }, 750);
  }
}
