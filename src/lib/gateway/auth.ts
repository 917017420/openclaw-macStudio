// Gateway authentication logic — Protocol v3 connect
//
// Auth flow uses operator token + signed device identity.
// Gateways that disable insecure auth require device signing fields:
// device.publicKey + device.signature + device.signedAt.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { GatewayEvent } from "./protocol";
import type { GatewayConfig } from "./types";
import { loadDeviceIdentity, saveDeviceIdentity } from "./device-store";

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
const DEFAULT_OPERATOR_SCOPES = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
];

export interface AuthResult {
  /** Server connection ID */
  connId?: string;
  /** Issued/persisted device token for subsequent connects */
  deviceToken?: string;
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
  /** Hex-encoded 32-byte Ed25519 private key */
  privateKey: string;
  /** Base64url-encoded Ed25519 public key */
  publicKey: string;
  deviceId: string;
}

/**
 * Convert bytes to URL-safe base64 string (without padding).
 */
function bytesToBase64url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/**
 * Build device signature payload expected by Gateway.
 * Gateway supports v3 payloads and keeps v2 compatibility.
 * We currently sign with v2 for broad server compatibility.
 */
function buildSignaturePayload(
  deviceId: string,
  scopes: string[],
  signedAt: number,
  token: string,
  nonce: string,
): string {
  return [
    "v2",
    deviceId,
    CLIENT_INFO.id,
    CLIENT_INFO.mode,
    "operator",
    scopes.join(","),
    String(signedAt),
    token,
    nonce,
  ].join("|");
}

function normalizeOperatorScopes(scopes?: string[]): string[] {
  if (!scopes || scopes.length === 0) return DEFAULT_OPERATOR_SCOPES;

  const normalized = Array.from(
    new Set(scopes.map((scope) => scope.trim()).filter(Boolean)),
  );

  return normalized.length > 0 ? normalized : DEFAULT_OPERATOR_SCOPES;
}

async function getOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const existing = await loadDeviceIdentity();
  if (existing?.privateKey) {
    try {
      const privateKeyBytes = hexToBytes(existing.privateKey);
      const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
      const canonical: DeviceIdentity = {
        ...existing,
        publicKey: bytesToBase64url(publicKeyBytes),
        deviceId: bytesToHex(sha256(publicKeyBytes)),
      };
      if (
        existing.publicKey !== canonical.publicKey ||
        existing.deviceId !== canonical.deviceId
      ) {
        await saveDeviceIdentity(canonical);
      }
      return canonical;
    } catch {
      // Corrupted stored identity; regenerate below.
    }
  }

  {
    const privateKeyBytes = ed25519.utils.randomSecretKey();
    const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
    const publicKey = bytesToBase64url(publicKeyBytes);
    const deviceId = bytesToHex(sha256(publicKeyBytes));

    const created: DeviceIdentity = {
      version: 1,
      privateKey: bytesToHex(privateKeyBytes),
      publicKey,
      deviceId,
    };
    await saveDeviceIdentity(created);
    return created;
  }
}

/**
 * Build signed connect request params for Protocol v3.
 */
export async function buildConnectParams(
  config: GatewayConfig,
  nonce: string,
): Promise<Record<string, unknown>> {
  const scopes = normalizeOperatorScopes(config.scopes);
  const device = await getOrCreateDeviceIdentity();
  const privateKeyBytes = hexToBytes(device.privateKey);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const publicKey = bytesToBase64url(publicKeyBytes);
  const deviceId = bytesToHex(sha256(publicKeyBytes));
  const signedAt = Date.now();

  // This gateway validates token in the signature payload.
  const payloadToken = config.token;
  const payload = buildSignaturePayload(
    deviceId,
    scopes,
    signedAt,
    payloadToken,
    nonce,
  );
  const signatureBytes = ed25519.sign(
    new TextEncoder().encode(payload),
    privateKeyBytes,
  );

  // Sanity check: if local verify fails, identity data is unusable.
  if (!ed25519.verify(signatureBytes, new TextEncoder().encode(payload), publicKeyBytes)) {
    throw new Error("Failed to self-verify device signature");
  }

  return {
    minProtocol: PROTOCOL_VERSION,
    maxProtocol: PROTOCOL_VERSION,
    client: { ...CLIENT_INFO },
    role: "operator",
    scopes,
    auth: {
      token: config.token,
    },
    device: {
      id: deviceId,
      publicKey,
      signature: bytesToBase64url(signatureBytes),
      signedAt,
      nonce,
    },
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
    auth?: { deviceToken?: string };
    features?: { methods?: string[]; events?: string[] };
    snapshot?: Record<string, unknown>;
  } | null;

  if (data?.type !== "hello-ok") return null;

  return {
    connId: data.server?.connId,
    deviceToken: data.auth?.deviceToken,
    methods: data.features?.methods ?? [],
    events: data.features?.events ?? [],
    snapshot: data.snapshot ?? {},
  };
}
