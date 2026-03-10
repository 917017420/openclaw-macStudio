// Test: verify noble-curves Ed25519 signatures are compatible with Node.js crypto.verify
// This simulates what the OpenClaw Gateway server does

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import crypto from "crypto";

// 1. Generate key pair with noble-curves
const privateKey = ed25519.utils.randomSecretKey();
const publicKey = ed25519.getPublicKey(privateKey);
const deviceId = bytesToHex(sha256(publicKey));

console.log("Private key (hex):", bytesToHex(privateKey));
console.log("Public key (hex):", bytesToHex(publicKey));
console.log("Device ID:", deviceId);

// 2. Build signature payload (simulating v3 format)
const payload = [
  "v3",
  deviceId,
  "gateway-client",
  "ui",
  "operator",
  "operator.admin,operator.approvals,operator.pairing,operator.read,operator.write",
  String(Date.now()),
  "test-token-123",
  "test-nonce-456",
  "macos",
  "",
].join("|");

console.log("\nPayload:", payload);

// 3. Sign with noble-curves
const messageBytes = new TextEncoder().encode(payload);
const signature = ed25519.sign(messageBytes, privateKey);

// base64url encode
function toBase64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64url(str) {
  return Buffer.from(str, "base64url");
}

const sigBase64url = toBase64url(signature);
const pubBase64url = toBase64url(publicKey);

console.log("\nSignature (base64url):", sigBase64url);
console.log("Public key (base64url):", pubBase64url);

// 4. Verify with noble-curves (should pass)
const nobleVerify = ed25519.verify(signature, messageBytes, publicKey);
console.log("\n--- Noble-curves self-verify:", nobleVerify);

// 5. Verify with Node.js crypto (simulating server-side verification)
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const rawPubKey = fromBase64url(pubBase64url);
const spkiKey = Buffer.concat([ED25519_SPKI_PREFIX, rawPubKey]);

const nodePublicKey = crypto.createPublicKey({
  key: spkiKey,
  type: "spki",
  format: "der",
});

const sigBuffer = fromBase64url(sigBase64url);
const payloadBuffer = Buffer.from(payload, "utf8");
const nodeVerify = crypto.verify(null, payloadBuffer, nodePublicKey, sigBuffer);
console.log("--- Node.js crypto.verify:", nodeVerify);

// 6. Test with our bytesToBase64url function (same as in auth.ts)
function bytesToBase64url_ours(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

const sigOurEncoding = bytesToBase64url_ours(signature);
const pubOurEncoding = bytesToBase64url_ours(publicKey);

console.log("\n--- Our base64url encoding matches?");
console.log("  Signature:", sigOurEncoding === sigBase64url ? "MATCH" : `MISMATCH: ${sigOurEncoding} vs ${sigBase64url}`);
console.log("  PublicKey:", pubOurEncoding === pubBase64url ? "MATCH" : `MISMATCH: ${pubOurEncoding} vs ${pubBase64url}`);

// 7. Verify using our encoding
const sigFromOurs = fromBase64url(sigOurEncoding);
const pubFromOurs = fromBase64url(pubOurEncoding);
const spkiFromOurs = Buffer.concat([ED25519_SPKI_PREFIX, pubFromOurs]);

const nodeKey2 = crypto.createPublicKey({
  key: spkiFromOurs,
  type: "spki",
  format: "der",
});
const nodeVerify2 = crypto.verify(null, payloadBuffer, nodeKey2, sigFromOurs);
console.log("--- Node.js verify with our encoding:", nodeVerify2);
