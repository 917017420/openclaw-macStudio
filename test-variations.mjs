// Exhaustive test: try different payload variations to find which one the server accepts

import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { WebSocket } from "ws";

const GATEWAY_URL = process.argv[2] || "ws://43.163.251.25:18789";
const TOKEN = process.argv[3] || "fe33b7ea79209e97c32e2aa5cbc581c8";

function toBase64url(bytes) {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

// Test variations of the signature payload
const variations = [
  {
    name: "v3 with token",
    build: (deviceId, scopes, signedAt, nonce) => [
      "v3", deviceId, "gateway-client", "ui", "operator",
      scopes.join(","), String(signedAt), TOKEN, nonce, "macos", "",
    ].join("|"),
  },
  {
    name: "v3 with empty token",
    build: (deviceId, scopes, signedAt, nonce) => [
      "v3", deviceId, "gateway-client", "ui", "operator",
      scopes.join(","), String(signedAt), "", nonce, "macos", "",
    ].join("|"),
  },
  {
    name: "v2 with token",
    build: (deviceId, scopes, signedAt, nonce) => [
      "v2", deviceId, "gateway-client", "ui", "operator",
      scopes.join(","), String(signedAt), TOKEN, nonce,
    ].join("|"),
  },
  {
    name: "v2 with empty token",
    build: (deviceId, scopes, signedAt, nonce) => [
      "v2", deviceId, "gateway-client", "ui", "operator",
      scopes.join(","), String(signedAt), "", nonce,
    ].join("|"),
  },
];

let currentVariation = 0;

async function tryVariation(index) {
  if (index >= variations.length) {
    console.log("\n❌ All variations failed!");
    process.exit(1);
  }

  const variation = variations[index];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Trying: ${variation.name} (#${index + 1}/${variations.length})`);
  console.log("=".repeat(60));

  const privateKey = ed25519.utils.randomSecretKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  const deviceId = bytesToHex(sha256(publicKey));

  return new Promise((resolve) => {
    const ws = new WebSocket(GATEWAY_URL);
    const timeout = setTimeout(() => {
      ws.close();
      resolve(false);
    }, 10000);

    ws.on("open", () => {
      console.log("[WS] Connected");
    });

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());

      if (msg.type === "event" && msg.event === "connect.challenge") {
        const nonce = msg.payload.nonce;
        const signedAt = Date.now();
        const scopes = ["operator.admin", "operator.approvals", "operator.pairing"];

        const payload = variation.build(deviceId, scopes, signedAt, nonce);
        console.log("[Payload]", payload);

        const msgBytes = new TextEncoder().encode(payload);
        const sig = ed25519.sign(msgBytes, privateKey);

        const connectReq = {
          type: "req",
          id: `req_${Date.now()}_1`,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: { id: "gateway-client", version: "0.1.0", platform: "macos", mode: "ui" },
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

        ws.send(JSON.stringify(connectReq));
      }

      if (msg.type === "res") {
        clearTimeout(timeout);
        if (msg.ok) {
          console.log(`\n✅ SUCCESS with: ${variation.name}`);
          console.log("Response:", JSON.stringify(msg.payload, null, 2));
          ws.close();
          process.exit(0);
        } else {
          console.log(`❌ Failed: ${msg.error?.message}`);
          ws.close();
          resolve(false);
        }
      }
    });

    ws.on("error", (err) => {
      clearTimeout(timeout);
      console.log(`Error: ${err.message}`);
      resolve(false);
    });

    ws.on("close", () => {
      clearTimeout(timeout);
      resolve(false);
    });
  });
}

async function main() {
  for (let i = 0; i < variations.length; i++) {
    const success = await tryVariation(i);
    if (success === true) return;
    // Small delay between attempts
    await new Promise((r) => setTimeout(r, 1000));
  }
}

main();
