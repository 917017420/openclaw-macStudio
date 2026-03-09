// Gateway authentication logic — Protocol v3 connect
//
// Auth flow uses operator token + signed device identity.
// Gateways that disable insecure auth require device signing fields:
// device.publicKey + device.signature + device.signedAt.

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { ConnectParams, GatewayEvent } from "./protocol";
import type { GatewayConfig } from "./types";
import { loadDeviceIdentity, saveDeviceIdentity } from "./device-store";

/** Protocol version */
const PROTOCOL_VERSION = 3;

function resolveDesktopClientId(): "openclaw-macos" | "gateway-client" {
  if (typeof navigator !== "undefined") {
    const platform = ((navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
    if (platform.includes("mac")) {
      return "openclaw-macos";
    }
  }

  return "gateway-client";
}

/** Desktop client identity — avoid browser Control UI origin enforcement. */
export const GATEWAY_CLIENT_INFO = {
  id: resolveDesktopClientId(),
  version: "0.1.0",
  mode: "ui",
} as const;

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

function resolveClientPlatform(): string {
  if (typeof navigator !== "undefined") {
    const platform = (
      navigator as Navigator & { userAgentData?: { platform?: string } }
    ).userAgentData?.platform ?? navigator.platform;
    if (typeof platform === "string" && platform.trim().length > 0) {
      return platform.trim();
    }
  }

  return "desktop";
}

function resolveClientLocale(): string | undefined {
  if (typeof navigator !== "undefined" && typeof navigator.language === "string") {
    const locale = navigator.language.trim();
    if (locale) {
      return locale;
    }
  }

  return undefined;
}

function resolveClientUserAgent(): string | undefined {
  if (typeof navigator !== "undefined" && typeof navigator.userAgent === "string") {
    const userAgent = navigator.userAgent.trim();
    if (userAgent) {
      return userAgent;
    }
  }

  return undefined;
}

/**
 * Build device signature payload expected by Gateway.
 * Gateway supports v3 payloads and keeps v2 compatibility.
 * We currently sign with v2 for broad server compatibility.
 */
function buildSignaturePayload(
  deviceId: string,
  clientId: string,
  clientMode: string,
  scopes: string[],
  signedAt: number,
  token: string,
  nonce: string,
): string {
  return [
    "v2",
    deviceId,
    clientId,
    clientMode,
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
): Promise<ConnectParams> {
  const trimmedNonce = nonce.trim();
  if (!trimmedNonce) {
    throw new Error("Gateway connect challenge missing nonce");
  }

  const scopes = normalizeOperatorScopes(config.scopes);
  const device = await getOrCreateDeviceIdentity();
  const privateKeyBytes = hexToBytes(device.privateKey);
  const publicKeyBytes = ed25519.getPublicKey(privateKeyBytes);
  const publicKey = bytesToBase64url(publicKeyBytes);
  const deviceId = bytesToHex(sha256(publicKeyBytes));
  const signedAt = Date.now();
  const client = {
    ...GATEWAY_CLIENT_INFO,
    displayName: config.name.trim() || undefined,
    platform: resolveClientPlatform(),
  };
  const locale = resolveClientLocale();
  const userAgent = resolveClientUserAgent();
  const sharedToken = config.token.trim();
  const deviceToken = config.deviceToken?.trim() || undefined;
  const authToken = sharedToken || deviceToken || "";
  const auth = authToken || deviceToken ? { token: authToken || undefined, deviceToken } : undefined;

  // This gateway validates token in the signature payload.
  const payload = buildSignaturePayload(
    deviceId,
    client.id,
    client.mode,
    scopes,
    signedAt,
    authToken,
    trimmedNonce,
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
    client,
    caps: [],
    role: "operator",
    scopes,
    auth,
    device: {
      id: deviceId,
      publicKey,
      signature: bytesToBase64url(signatureBytes),
      signedAt,
      nonce: trimmedNonce,
    },
    locale,
    userAgent,
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
