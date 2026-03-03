// Gateway authentication logic — Protocol v3 connect
//
// Primary auth flow: token-only (no device identity required).
// The server accepts `auth: { token }` and returns a hello-ok response
// with server info, features, and snapshot.
//
// Device identity (Ed25519) is reserved for future use when persistent
// device pairing is needed.

import type { GatewayEvent } from "./protocol";
import type { GatewayConfig } from "./types";

/** Protocol version */
const PROTOCOL_VERSION = 3;

/** Client identity — values must be in GATEWAY_CLIENT_IDS / GATEWAY_CLIENT_MODES whitelist */
const CLIENT_INFO = {
  id: "gateway-client",
  version: "0.1.0",
  platform: "macos",
  mode: "ui",
};

/** Scopes requested for operator role */
const OPERATOR_SCOPES = [
  "operator.admin",
  "operator.approvals",
  "operator.pairing",
];

export interface AuthResult {
  /** Server connection ID */
  connId?: string;
  /** Available RPC methods */
  methods: string[];
  /** Available event types */
  events: string[];
  /** Server snapshot (presence, health, etc.) */
  snapshot: Record<string, unknown>;
}

/** Device identity (persisted to tauri-plugin-store) — reserved for future use */
export interface DeviceIdentity {
  version?: number;
  privateKey: string;
  publicKey: string;
  deviceId: string;
}

/**
 * Build connect request params for Protocol v3 (token-only auth).
 */
export function buildConnectParams(
  config: GatewayConfig,
): Record<string, unknown> {
  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { ...CLIENT_INFO },
    role: "operator",
    scopes: OPERATOR_SCOPES,
    auth: { token: config.token },
  };
}

/**
 * Extract nonce from connect.challenge event payload
 */
export function extractNonce(event: GatewayEvent): string | null {
  if (event.event !== "connect.challenge") return null;
  const payload = event.payload as { nonce?: string } | null;
  return payload?.nonce ?? null;
}

/**
 * Parse hello-ok response payload (Protocol v3)
 */
export function parseAuthResponse(payload: unknown): AuthResult | null {
  const data = payload as {
    type?: string;
    server?: { connId?: string };
    features?: { methods?: string[]; events?: string[] };
    snapshot?: Record<string, unknown>;
  } | null;

  if (data?.type !== "hello-ok") return null;

  return {
    connId: data.server?.connId,
    methods: data.features?.methods ?? [],
    events: data.features?.events ?? [],
    snapshot: data.snapshot ?? {},
  };
}
