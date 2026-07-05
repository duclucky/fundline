"use strict";

// Circle Gateway (Nanopayments) batching facilitator wrapper.
//
// This is an OPTIONAL, parallel payment gate for workflow runs. It lets an agent
// pay gas-free, sub-cent, per-call via Circle Gateway: the agent pre-funds a
// Gateway balance once, then signs off-chain payment authorizations that Circle
// verifies and settles in batches. Fundline never holds the agent's funds (the
// balance lives in the agent's own Gateway account; settle moves it to Fundline's
// seller Gateway balance, which Fundline later withdraws). The non-custodial
// invariant toward the agent is preserved; the trust shift is that settlement is
// Circle-intermediated (batched) rather than one on-chain tx per call.
//
// The SDK (@circle-fin/x402-batching) plus its peers (@x402/core, viem) are a
// heavy, OPTIONAL dependency. We lazy-require it so the server stays up even when
// the package is not installed: available() returns false and the gate is simply
// not offered (the on-chain x402 and escrow gates keep working).
//
// Verify -> run -> settle ordering: verify() proves the signed authorization is
// valid and the agent has the funds BEFORE we run the workflow; settle() captures
// the payment AFTER a successful run. If the run fails we never settle, so the
// agent is not charged (cleaner than an on-chain refund).

let sdk = null;
let sdkLoadTried = false;

// Lazy-load the SDK once. Returns the module exports or null if not installed.
function loadSdk() {
  if (sdkLoadTried) return sdk;
  sdkLoadTried = true;
  try {
    // eslint-disable-next-line global-require
    sdk = require("@circle-fin/x402-batching/server");
  } catch (err) {
    console.error("[Gateway] SDK not installed:", err.message);
    sdk = null;
  }
  return sdk;
}

// Build a Gateway payment client. Config:
//   enabled       - master switch (WORKFLOW_GATEWAY_ENABLED)
//   url           - Circle Gateway API base (testnet vs mainnet)
//   sellerAddress - Fundline's seller Gateway address (receives settled funds)
//   network       - target network id, e.g. "eip155:5042002" (Arc testnet)
//   asset         - USDC token address on that network
//   arcPrivateMainnet - send the private-mainnet header so Arc mainnet appears
//   makeClient    - test hook: a factory returning a fake FacilitatorClient
function createGatewayClient(config) {
  const cfg = config || {};
  const enabled = Boolean(cfg.enabled);
  let client = null;
  let clientTried = false;
  let supportedKind = null; // cached batch payment kind for our network
  let supportedTried = false;

  function getClient() {
    if (clientTried) return client;
    clientTried = true;
    if (cfg.makeClient) { client = cfg.makeClient(); return client; }
    const mod = loadSdk();
    if (!mod || !mod.BatchFacilitatorClient) { client = null; return client; }
    try {
      client = new mod.BatchFacilitatorClient({
        url: cfg.url || undefined,
        arcPrivateMainnet: Boolean(cfg.arcPrivateMainnet),
      });
    } catch (err) {
      console.error("[Gateway] client init failed:", err.message);
      client = null;
    }
    return client;
  }

  // available() is true only when the gate is switched on, the seller address is
  // set, and the SDK (or a test client) loaded.
  function available() {
    return Boolean(enabled && cfg.sellerAddress && getClient());
  }

  // Fetch and cache the batch payment kind Circle supports for our network, so we
  // can echo its scheme + extra into the 402 challenge. Returns null if the
  // network is not supported by the facilitator.
  async function getSupportedKind() {
    if (supportedTried) return supportedKind;
    supportedTried = true;
    const c = getClient();
    if (!c) return null;
    try {
      const supported = await c.getSupported();
      const kinds = (supported && supported.kinds) || [];
      supportedKind = kinds.find((k) => String(k.network) === String(cfg.network)) || null;
    } catch (err) {
      console.error("[Gateway] getSupported failed:", err.message);
      supportedKind = null;
    }
    return supportedKind;
  }

  // Build the PaymentRequirements entry for the 402 `accepts` array. Returns null
  // if the facilitator does not support our network (so we just omit the gate).
  async function buildRequirements(opts) {
    const kind = await getSupportedKind();
    if (!kind) return null;
    return {
      scheme: kind.scheme,
      network: kind.network,
      asset: cfg.asset,
      amount: String(opts.amount),
      payTo: cfg.sellerAddress,
      maxTimeoutSeconds: opts.maxTimeoutSeconds || 3600,
      extra: Object.assign({}, kind.extra, { slug: opts.slug, tier: opts.tier }),
    };
  }

  // Detect whether an incoming payment (the retry's X-PAYMENT) targets this gate.
  // We match on the batch scheme so the on-chain x402 payload (which carries a
  // txHash and a different scheme) routes to the existing verifier instead.
  function isGatewayPayment(requirements) {
    const mod = cfg.makeClient ? null : loadSdk();
    if (mod && typeof mod.isBatchPayment === "function") {
      try { return Boolean(mod.isBatchPayment(requirements)); } catch (_) { /* fall through */ }
    }
    if (cfg.batchScheme && requirements && requirements.scheme === cfg.batchScheme) return true;
    return false;
  }

  async function verify(payload, requirements) {
    const c = getClient();
    if (!c) throw new Error("Gateway facilitator not available");
    return c.verify(payload, requirements);
  }

  async function settle(payload, requirements) {
    const c = getClient();
    if (!c) throw new Error("Gateway facilitator not available");
    return c.settle(payload, requirements);
  }

  return { available, getSupportedKind, buildRequirements, isGatewayPayment, verify, settle };
}

module.exports = { createGatewayClient, loadSdk };
