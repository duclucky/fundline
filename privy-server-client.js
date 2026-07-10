"use strict";

const https = require("https");
const crypto = require("crypto");

// Server-side Privy client for policy-based MFA co-signing (dep-light: raw HTTPS + Node crypto, no
// heavy SDK on the shared host). Signs wallet RPC requests with a P-256 authorization key so the
// server can co-sign policy-compliant transactions (workflow run funding) WITHOUT the user's MFA,
// while export + withdraw stay on the client and still require MFA. Auth per Privy docs:
//   Basic auth (appId:appSecret) + privy-app-id header + privy-authorization-signature (P-256 over
//   the RFC 8785 JCS canonicalization of {version:1, method, url, body, headers:{privy-app-id}}).
// See .claude/circle-ucw-wallet-spec.md history / Privy authorization-signatures docs.

const BASE_URL = "https://api.privy.io";

// Minimal RFC 8785 JSON Canonicalization Scheme (JCS): sort object keys by UTF-16 code units, drop
// undefined, no whitespace. Sufficient for our ASCII payload (app id, hex, urls) with no floats.
function jcs(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(jcs).join(",") + "]";
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + jcs(value[k])).join(",") + "}";
}

function httpsPostJson(pathname, headers, bodyString) {
  return new Promise((resolve, reject) => {
    const url = new URL(pathname, BASE_URL);
    const request = https.request(
      {
        hostname: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: "POST",
        headers: Object.assign(
          { "Content-Type": "application/json", "Accept": "application/json", "Content-Length": Buffer.byteLength(bodyString) },
          headers,
        ),
      },
      (response) => {
        let raw = "";
        response.on("data", (chunk) => { raw += chunk; });
        response.on("end", () => {
          let json = null;
          try { json = raw ? JSON.parse(raw) : {}; } catch { json = { _raw: raw }; }
          resolve({ status: response.statusCode, json });
        });
      },
    );
    request.setTimeout(30000, () => request.destroy(new Error("Privy request timed out")));
    request.on("error", reject);
    request.write(bodyString);
    request.end();
  });
}

function createPrivyServerClient(config) {
  config = config || {};
  const appId = config.appId || "";
  const appSecret = config.appSecret || "";
  const authKeyId = config.authorizationKeyId || "";
  const authPrivateKey = config.authorizationPrivateKey || "";
  const caip2 = config.caip2 || "eip155:5042002";

  function available() {
    return Boolean(appId && appSecret && authPrivateKey);
  }

  // Build the P-256 authorization signature over the canonical request payload.
  function authorizationSignature(fullUrl, body) {
    const payload = { version: 1, method: "POST", url: fullUrl, body: body, headers: { "privy-app-id": appId } };
    const serialized = jcs(payload);
    const keyBody = String(authPrivateKey).replace(/^wallet-auth:/, "").trim();
    const pem = `-----BEGIN PRIVATE KEY-----\n${keyBody}\n-----END PRIVATE KEY-----`;
    const keyObject = crypto.createPrivateKey({ key: pem, format: "pem" });
    return crypto.sign("sha256", Buffer.from(serialized, "utf8"), keyObject).toString("base64");
  }

  async function signedPost(pathname, body) {
    if (!available()) throw new Error("Privy server client is not configured");
    const bodyString = JSON.stringify(body);
    const fullUrl = new URL(pathname, BASE_URL).toString();
    const headers = {
      "Authorization": "Basic " + Buffer.from(`${appId}:${appSecret}`).toString("base64"),
      "privy-app-id": appId,
      "privy-authorization-signature": authorizationSignature(fullUrl, body),
    };
    const result = await httpsPostJson(pathname, headers, bodyString);
    const status = result && result.status;
    if (typeof status !== "number" || status < 200 || status >= 300) {
      const message = result && result.json && (result.json.message || result.json.error || (result.json.data && result.json.data.message));
      throw new Error(`Privy API ${status || "error"}: ${message || "request failed"}`);
    }
    return result.json || {};
  }

  // Co-sign + broadcast a transaction from a user's embedded wallet, authorized by the server's
  // authorization key (no user MFA). Returns { hash }.
  async function sendTransaction({ walletId, to, data, value }) {
    if (!walletId) throw new Error("walletId is required");
    if (!to) throw new Error("to is required");
    const tx = { to: to, data: data || "0x" };
    tx.value = value == null || value === "" ? "0x0" : value;
    const out = await signedPost(`/v1/wallets/${encodeURIComponent(walletId)}/rpc`, {
      method: "eth_sendTransaction",
      caip2: caip2,
      chain_type: "ethereum",
      params: { transaction: tx },
    });
    return { hash: out.hash || (out.data && out.data.hash) || "" };
  }

  return { available, sendTransaction, authorizationKeyId: authKeyId };
}

module.exports = { createPrivyServerClient, jcs };
