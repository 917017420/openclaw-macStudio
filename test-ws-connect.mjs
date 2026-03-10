// Direct WebSocket test against the real Gateway
// Usage: node test-ws-connect.mjs <gateway-url> <token>

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { WebSocket } from "ws";

const GATEWAY_URL = process.argv[2] || "ws://43.163.251.25:18789";
const TOKEN = process.argv[3] || "fe33b7ea79209e97c32e2aa5cbc581c8";

// Generate device identity
const privateKey = ed25519.utils.randomSecretKey();
const publicKey = ed25519.getPublicKey(privateKey);
const deviceId = bytesToHex(sha256(publicKey));

function toBase64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

console.log("Connecting to:", GATEWAY_URL);
console.log("Device ID:", deviceId);
console.log("Public key (b64url):", toBase64url(publicKey));

const ws = new WebSocket(GATEWAY_URL);
let reqCounter = 0;

ws.on("open", () => {
  console.log("\n[WS] Connected, waiting for challenge...");
});

ws.on("message", (data) => {
  const raw = data.toString();
  const msg = JSON.parse(raw);
  console.log("\n[WS] Received:", JSON.stringify(msg, null, 2));

  if (msg.type === "event" && msg.event === "connect.challenge") {
    const nonce = msg.payload.nonce;
    console.log("\n[Challenge] nonce:", nonce);

    const signedAt = Date.now();
    const scopes = [
      "operator.admin",
      "operator.approvals",
      "operator.pairing",
      "operator.read",
      "operator.write",
    ];

    // Try v3 payload
    const payloadV3 = [
      "v3", deviceId, "gateway-client", "ui", "operator",
      scopes.join(","), String(signedAt), TOKEN, nonce, "macos", "",
    ].join("|");

    console.log("\n[Signing] v3 payload:", payloadV3);

    const msgBytes = new TextEncoder().encode(payloadV3);
    const sig = ed25519.sign(msgBytes, privateKey);

    // Verify locally
    const localOk = ed25519.verify(sig, msgBytes, publicKey);
    console.log("[Signing] Local verify:", localOk);

    const connectReq = {
      type: "req",
      id: `req_${Date.now()}_${++reqCounter}`,
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: {
          id: "gateway-client",
          version: "0.1.0",
          platform: "macos",
          mode: "ui",
        },
        role: "operator",
        scopes,
        auth: { token: TOKEN },
        device: {
          id: deviceId,
          publicKey: toBase64url(publicKey),
          signature: toBase64url(sig),
          signedAt,
          nonce,
        },
      },
    };

    console.log("\n[WS] Sending connect:", JSON.stringify(connectReq, null, 2));
    ws.send(JSON.stringify(connectReq));
  }

  if (msg.type === "res") {
    if (msg.ok) {
      console.log("\n✅ SUCCESS! Connected to Gateway");
    } else {
      console.log("\n❌ FAILED:", msg.error?.message || JSON.stringify(msg));
    }
    ws.close();
  }
});

ws.on("error", (err) => {
  console.error("[WS] Error:", err.message);
});

ws.on("close", (code, reason) => {
  console.log(`\n[WS] Closed: code=${code} reason=${reason}`);
  process.exit(0);
});
