"use strict";

const https = require("https");
const crypto = require("crypto");

// Circle User-Controlled Wallets REST client (dep-light, no Circle SDK).
// Follows the tavily-client.js / v98-client.js style: a thin fetch-over-https layer with an
// INJECTABLE request function so tests can run fully offline. User-Controlled Wallets are
// authorized by the API key (Bearer) plus a short-lived per-user X-User-Token; they do NOT
// use an entity secret (that is a developer-controlled-wallets concept). Wallets are created on
// ARC-TESTNET as SCA accounts so Circle Gas Station can sponsor gas. See
// .claude/circle-ucw-wallet-spec.md.
//
// Endpoints used (base https://api.circle.com):
//   POST /v1/w3s/users/email/token   -> { deviceToken, deviceEncryptionKey, otpToken }
//   POST /v1/w3s/users/token         -> { userToken, encryptionKey }        (returning user)
//   POST /v1/w3s/user/initialize     -> { challengeId }                     (create the wallet)
//   GET  /v1/w3s/wallets             -> { wallets: [...] }
//   GET  /v1/w3s/transactions/:id    -> { transaction: {...} }              (P2/P3 signing)

const DEFAULT_BASE_URL = "https://api.circle.com";
const DEFAULT_BLOCKCHAIN = "ARC-TESTNET";
const DEFAULT_ACCOUNT_TYPE = "SCA";

// Default transport: one HTTPS JSON request. Returns { status, json }. Kept tiny and replaceable
// (config.request) so unit tests never touch the network.
function httpsRequestJson({ baseUrl, method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, baseUrl);
    const payload = body ? JSON.stringify(body) : "";
    const request = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method,
        headers: Object.assign(
          { "Accept": "application/json" },
          payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {},
          headers || {},
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
    request.setTimeout(30000, () => request.destroy(new Error("Circle request timed out")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function newIdempotencyKey() {
  return crypto.randomUUID();
}

function createCircleWalletClient(config) {
  config = config || {};
  const apiKey = config.apiKey || "";
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const blockchain = config.blockchain || DEFAULT_BLOCKCHAIN;
  const accountType = config.accountType || DEFAULT_ACCOUNT_TYPE;
  const request = config.request || httpsRequestJson;

  function available() {
    return Boolean(apiKey);
  }

  async function call({ method, path, userToken, body }) {
    if (!apiKey) throw new Error("Circle API key is not configured");
    const headers = { "Authorization": `Bearer ${apiKey}`, "X-Request-Id": crypto.randomUUID() };
    if (userToken) headers["X-User-Token"] = userToken;
    const result = await request({ baseUrl, method, path, headers, body });
    const status = result && result.status;
    if (typeof status !== "number" || status < 200 || status >= 300) {
      const message = result && result.json && (result.json.message || (result.json.error && result.json.error.message));
      throw new Error(`Circle API ${status || "error"}: ${message || "request failed"}`);
    }
    // Circle wraps successful payloads in { data: {...} }.
    return (result.json && result.json.data) || {};
  }

  // 1. Backend requests the email OTP device token (SMTP configured in the Circle Console then
  //    delivers the code). deviceId comes from the Web SDK (sdk.getDeviceId()).
  async function createEmailDeviceToken({ deviceId, email }) {
    if (!deviceId) throw new Error("deviceId is required");
    if (!email) throw new Error("email is required");
    return call({
      method: "POST",
      path: "/v1/w3s/users/email/token",
      body: { idempotencyKey: newIdempotencyKey(), deviceId, email: String(email).trim() },
    });
  }

  // 2. Returning user: mint a fresh userToken + encryptionKey from a known Circle userId.
  async function createUserToken({ userId }) {
    if (!userId) throw new Error("userId is required");
    return call({ method: "POST", path: "/v1/w3s/users/token", body: { userId } });
  }

  // 3. Create the user's wallet on ARC-TESTNET as an SCA account. Returns { challengeId }, which
  //    the Web SDK executes to finish creation. Authorized by the user token.
  async function initializeWallet({ userToken }) {
    if (!userToken) throw new Error("userToken is required");
    return call({
      method: "POST",
      path: "/v1/w3s/user/initialize",
      userToken,
      body: { idempotencyKey: newIdempotencyKey(), blockchains: [blockchain], accountType },
    });
  }

  // 4. List the user's wallets (to read the address after creation).
  async function listWallets({ userToken }) {
    if (!userToken) throw new Error("userToken is required");
    const data = await call({ method: "GET", path: "/v1/w3s/wallets", userToken });
    return Array.isArray(data.wallets) ? data.wallets : [];
  }

  // Convenience: the first wallet on our configured blockchain (or the first wallet).
  async function getPrimaryWallet({ userToken }) {
    const wallets = await listWallets({ userToken });
    const onChain = wallets.filter((w) => String(w.blockchain || "").toUpperCase() === blockchain.toUpperCase());
    const chosen = onChain[0] || wallets[0] || null;
    if (!chosen) return null;
    return { id: chosen.id || "", address: chosen.address || "", blockchain: chosen.blockchain || "", accountType: chosen.accountType || "" };
  }

  // 5. Poll a transaction (used by the P2/P3 signing path) -> { transaction: {...} }.
  async function getTransaction({ userToken, id }) {
    if (!userToken) throw new Error("userToken is required");
    if (!id) throw new Error("transaction id is required");
    const data = await call({ method: "GET", path: `/v1/w3s/transactions/${encodeURIComponent(id)}`, userToken });
    return data.transaction || null;
  }

  // 6. (P2/P3) Create a contract-execution challenge from raw calldata. Fundline already encodes
  //    calldata (USDC.approve, router.payInvoice, escrow.fund, batch.payBatch) with its own ABI
  //    helpers, so we pass callData directly. Returns { challengeId }. The user then approves it in
  //    the Web SDK, and Circle signs + broadcasts. Set refId so the tx can be found by listTransactions.
  async function createContractExecution({ userToken, walletId, walletAddress, contractAddress, callData, amount, refId, feeLevel }) {
    if (!userToken) throw new Error("userToken is required");
    if (!contractAddress) throw new Error("contractAddress is required");
    if (!callData) throw new Error("callData is required");
    const body = {
      idempotencyKey: newIdempotencyKey(),
      contractAddress,
      callData,
      feeLevel: feeLevel || "MEDIUM",
    };
    if (walletId) body.walletId = walletId;
    else if (walletAddress) { body.walletAddress = walletAddress; body.blockchain = blockchain; }
    else throw new Error("walletId or walletAddress is required");
    // Native value only for payable calls; our USDC contract calls are non-payable (value 0).
    if (amount != null && amount !== "" && amount !== "0x0" && amount !== "0") body.amount = amount;
    if (refId) body.refId = refId;
    return call({ method: "POST", path: "/v1/w3s/user/transactions/contractExecution", userToken, body });
  }

  // 8. Start the PIN recovery flow (forgot PIN). Circle returns a challengeId; the Web SDK then walks
  //    the user through answering their security questions and setting a new PIN. Recovery is
  //    independent of email, so a user who loses email access still keeps this path (and vice versa).
  async function restorePin({ userToken }) {
    if (!userToken) throw new Error("userToken is required");
    return call({ method: "POST", path: "/v1/w3s/user/pin/restore", userToken, body: { idempotencyKey: newIdempotencyKey() } });
  }

  // 7. (P2/P3) List the user's transactions, optionally filtered by refId, to resolve the on-chain
  //    txHash after a challenge is executed. Returns an array.
  async function listTransactions({ userToken, refId }) {
    if (!userToken) throw new Error("userToken is required");
    const query = refId ? ("?refId=" + encodeURIComponent(refId)) : "";
    const data = await call({ method: "GET", path: "/v1/w3s/transactions" + query, userToken });
    return Array.isArray(data.transactions) ? data.transactions : [];
  }

  return {
    available,
    blockchain,
    accountType,
    createEmailDeviceToken,
    createUserToken,
    initializeWallet,
    listWallets,
    getPrimaryWallet,
    getTransaction,
    createContractExecution,
    listTransactions,
    restorePin,
  };
}

module.exports = { createCircleWalletClient, newIdempotencyKey, DEFAULT_BASE_URL, DEFAULT_BLOCKCHAIN, DEFAULT_ACCOUNT_TYPE };
