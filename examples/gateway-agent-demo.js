"use strict";

// Workaround for "Do not know how to serialize a BigInt": some SDK paths JSON.stringify
// values that contain BigInts. Teaching BigInt to serialize as a string is the standard,
// low-risk fix and does not affect on-chain amounts (those are handled as strings/BigInts).
if (typeof BigInt.prototype.toJSON !== "function") {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function () { return this.toString(); };
}

// Fundline Gateway (Nanopayments) agent demo: pay for workflow runs gas-free, sub-cent,
// per call, via Circle Gateway. This is the agent-to-agent / service-payment path.
//
// How it differs from the escrow and x402 demos (circle-agent-demo.js):
//   - escrow / x402  -> one on-chain USDC transaction per run (Circle wallet signs).
//   - gateway        -> the agent pre-funds a Gateway balance ONCE (one on-chain deposit),
//                       then each run is paid by an off-chain signed authorization that
//                       Circle verifies and settles in batches. No gas, sub-500ms per call.
//
// Non-custodial: the pre-funded balance lives in the agent's own Gateway account; a run
// only settles the exact price to Fundline's seller balance AFTER the run succeeds. If the
// run fails, nothing settles (cleaner than an on-chain refund).
//
// Integration-only: this file is NOT part of the deployed app. Install its deps here in
// examples/ (they are NOT in the app package.json, keeping the server buildless):
//   npm install @circle-fin/x402-batching
//
// The Fundline server must have the Gateway gate ON for /run to offer this path:
//   cPanel env  WORKFLOW_GATEWAY_ENABLED=true, GATEWAY_SELLER_ADDRESS=<seller>, and
//   `npm install @circle-fin/x402-batching` on the Node app, then restart.
//
// VERIFY LIVE: the exact client method names below (deposit / pay) follow Circle's
// published shape for @circle-fin/x402-batching/client; pin them against the installed
// SDK version. Reference agent: Circle's arc-nanopayments repo (`npm run agent`).

const BASE = process.env.FUNDLINE_BASE || "https://fundline.xyz";
const FUNDLINE_KEY = process.env.FUNDLINE_API_KEY || ""; // optional; keyless works too
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || ""; // 0x... EOA that holds/deposits USDC
const CHAIN = process.env.GATEWAY_CHAIN || "arcTestnet";
// Optional dedicated RPC. The public Arc testnet RPC rate-limits heavily; set this to a
// less-throttled endpoint to avoid intermittent "request limit reached" failures.
const RPC_URL = process.env.GATEWAY_RPC_URL || "";
const SLUG = process.env.WF_SLUG || "client-research";
const TIER = process.env.WF_TIER || "normal";
const PROMPT = process.env.WF_PROMPT || "Acme Corp, a mid-market SaaS company.";
// Set to a decimal USDC amount (e.g. "1") to make a one-time Gateway deposit before paying.
const DEPOSIT = process.env.GATEWAY_DEPOSIT || "";

async function getJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  let json = null; try { json = await res.json(); } catch (_) {}
  return { status: res.status, json };
}

async function main() {
  if (!AGENT_PRIVATE_KEY) throw new Error("Set AGENT_PRIVATE_KEY (0x... EOA with USDC on " + CHAIN + ")");

  // 1. Discover: confirm the workflow exists and Gateway is offered by this server.
  const cfg = (await getJson(BASE + "/api/config")).json || {};
  if (!cfg.workflowGatewayEnabled) {
    throw new Error("This Fundline server does not offer the Gateway gate (workflowGatewayEnabled is false).");
  }
  const menu = (await getJson(BASE + "/api/workflows?q=" + encodeURIComponent(SLUG))).json || {};
  const wf = (menu.workflows || []).find((w) => w.slug === SLUG);
  if (!wf) throw new Error("Workflow not found: " + SLUG);
  console.log("Workflow:", wf.slug, "| tier:", TIER, "| price:", (wf.tiers && wf.tiers[TIER] && wf.tiers[TIER].usdc) || "?", "USDC");

  // 2. Create the Gateway client (signs payment authorizations locally; no gas).
  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  const clientConfig = { chain: CHAIN, privateKey: AGENT_PRIVATE_KEY };
  if (RPC_URL) clientConfig.rpcUrl = RPC_URL;
  const client = new GatewayClient(clientConfig);

  // 3. One-time on-chain deposit into the Gateway balance (only when GATEWAY_DEPOSIT is set).
  //    After this, many runs are paid off-chain from the same balance with no further gas.
  if (DEPOSIT) {
    console.log("Depositing", DEPOSIT, "USDC into the Gateway balance (one-time, on-chain)...");
    await client.deposit(DEPOSIT);
    console.log("Deposit done. Subsequent runs are gas-free until the balance is spent.");
  }

  // 4. Pay and run. The client wraps the request: it hits /run, receives the 402 challenge,
  //    signs an off-chain EIP-3009 authorization from the Gateway balance, and retries with
  //    the payment header. Fundline verifies, runs the workflow, then settles the batch.
  const runUrl = BASE + "/api/workflows/" + SLUG + "/run";
  // The SDK sets Content-Type + the Payment-Signature header itself; body is a plain object.
  const headers = { "Accept": "application/json" };
  if (FUNDLINE_KEY) headers["X-API-Key"] = FUNDLINE_KEY;

  console.log("Paying and running via Gateway (gas-free)...");
  const payRes = await client.pay(runUrl, {
    method: "POST",
    body: { tier: TIER, prompt: PROMPT },
    headers: headers,
  });
  const out = (payRes && payRes.data) || {};

  console.log("\nRun complete.");
  console.log("Paid:", (payRes && payRes.amount) || "?", "USDC | settlement:", out.settlementTx || out.releaseTx || "(batched)");
  console.log("\n--- OUTPUT ---\n" + String(out.output || "").slice(0, 1200));
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
