"use strict";

// Fundline turnkey agent client (RECOMMENDED): pay per run gas-free via Circle Gateway.
// Best for agents that make more than a one-off run. Unlike the plain x402 path, this does
// NOT send an on-chain transaction per run, so it does not depend on the throttled public
// Arc RPC: you deposit ONCE, then every run is paid by an off-chain signed authorization
// that settles in a batch after the run succeeds. Gasless, sub-second, non-custodial.
//
// Setup (once):
//   npm i @circle-fin/x402-batching
//   # then make a one-time deposit into your Gateway balance:
//   FUNDLINE_PRIVATE_KEY=0xYourAgentKey GATEWAY_DEPOSIT=1 node fundline-agent-gateway.js
//
// Run (many times, no gas, no deposit flag):
//   FUNDLINE_PRIVATE_KEY=0xYourAgentKey node fundline-agent-gateway.js <slug> <tier> "<prompt>"
//
// Discover slugs and tiers first with:  curl https://fundline.xyz/api/workflows
// Non-custodial: your key never leaves this machine; the pre-funded balance is your own and
// only the exact price settles to Fundline after a run succeeds.

// Some SDK paths JSON.stringify values that contain BigInts. Teaching BigInt to serialize
// as a string is the standard, low-risk fix and does not affect on-chain amounts.
if (typeof BigInt.prototype.toJSON !== "function") {
  // eslint-disable-next-line no-extend-native
  BigInt.prototype.toJSON = function () { return this.toString(); };
}

const BASE = process.env.FUNDLINE_BASE || "https://fundline.xyz";
const CHAIN = process.env.GATEWAY_CHAIN || "arcTestnet";
const RPC_URL = process.env.GATEWAY_RPC_URL || process.env.ARC_RPC_URL || "";
const PRIVATE_KEY = process.env.FUNDLINE_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || "";
const DEPOSIT = process.env.GATEWAY_DEPOSIT || ""; // decimal USDC, e.g. "1"; set only to top up.

const slug = process.argv[2] || "client-research";
const tier = process.argv[3] || "normal";
const prompt = process.argv[4] || "Research Acme Corp, a mid-market SaaS company.";

async function main() {
  if (!PRIVATE_KEY) throw new Error("Set FUNDLINE_PRIVATE_KEY to your agent wallet's private key.");

  // Confirm the server offers the Gateway gate before trying to pay through it.
  const cfg = await (await fetch(BASE + "/api/config")).json().catch(() => ({}));
  if (!cfg.workflowGatewayEnabled) {
    throw new Error("This Fundline server does not offer the Gateway gate. Use fundline-agent.js (x402) instead.");
  }

  const { GatewayClient } = await import("@circle-fin/x402-batching/client");
  const clientConfig = { chain: CHAIN, privateKey: PRIVATE_KEY };
  if (RPC_URL) clientConfig.rpcUrl = RPC_URL;
  const client = new GatewayClient(clientConfig);

  // One-time on-chain deposit (only when GATEWAY_DEPOSIT is set). After this, many runs are
  // paid off-chain from the same balance with no further gas.
  if (DEPOSIT) {
    console.log("Depositing", DEPOSIT, "USDC into the Gateway balance (one-time, on-chain)...");
    await client.deposit(DEPOSIT);
    console.log("Deposit done. Subsequent runs are gas-free until the balance is spent.");
  }

  const runUrl = BASE + "/api/workflows/" + slug + "/run";
  console.log("Workflow:", slug, "| tier:", tier, "| paying via Gateway (gas-free)...");
  const payRes = await client.pay(runUrl, {
    method: "POST",
    body: { tier: tier, prompt: prompt },
    headers: { "Accept": "application/json" },
  });
  const out = (payRes && payRes.data) || {};
  console.log("\nPaid:", (payRes && payRes.amount) || "?", "| settlement:", out.settlementTx || out.releaseTx || "(batched)");
  console.log("\n--- OUTPUT ---\n" + String(out.output || "").trim());
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
