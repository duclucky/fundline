"use strict";

// Fundline turnkey agent client: discover -> pay (x402) -> run -> print output.
// An agent does NOT need to write its own on-chain code. Download this file and run it.
//
// Setup (once):
//   npm i ethers
//
// Run:
//   FUNDLINE_PRIVATE_KEY=0xYourAgentKey node fundline-agent.js <slug> <tier> "<prompt>"
//
// Example:
//   FUNDLINE_PRIVATE_KEY=0x... node fundline-agent.js client-research normal "Research Acme Corp"
//
// Discover slugs and tiers first with:  curl https://fundline.xyz/api/workflows
// Tiers are: normal, plus, pro (default normal). There is no "standard" tier.
//
// Non-custodial: your private key never leaves this machine. It signs ONE USDC transfer
// of the exact price to Fundline's treasury, then the run executes and returns the output.
// Use a DEDICATED agent wallet funded with a small USDC amount. On Arc, USDC is also the
// gas token, so keep a little extra USDC for gas.

const { ethers } = require("ethers");

const BASE = process.env.FUNDLINE_BASE || "https://fundline.xyz";
// The public Arc testnet RPC rate-limits heavily ("request limit reached"). For anything
// beyond occasional runs, set ARC_RPC_URL to a less-throttled endpoint.
const RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const PRIVATE_KEY = process.env.FUNDLINE_PRIVATE_KEY || process.env.AGENT_PRIVATE_KEY || "";

const slug = process.argv[2] || "client-research";
const tier = process.argv[3] || "normal";
const prompt = process.argv[4] || "Research Acme Corp, a mid-market SaaS company.";

const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

// The public Arc RPC returns -32011 "request limit reached" under load. Retry a few
// times with backoff so a transient limit does not abort a run.
async function withRetry(label, fn, tries) {
  tries = tries || 5;
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); }
    catch (e) {
      lastErr = e;
      const msg = String((e && e.message) || e);
      if (!/request limit|rate|-32011|timeout|coalesce/i.test(msg)) throw e;
      const waitMs = 1500 * (i + 1);
      console.log("  RPC busy on " + label + ", retrying in " + (waitMs / 1000) + "s...");
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw lastErr;
}

async function postRun(headers) {
  return fetch(BASE + "/api/workflows/" + slug + "/run", {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json", "Accept": "application/json" }, headers || {}),
    body: JSON.stringify({ tier: tier, prompt: prompt }),
  });
}

async function main() {
  if (!PRIVATE_KEY) throw new Error("Set FUNDLINE_PRIVATE_KEY to your agent wallet's private key.");

  // 1. Discover the price: an unpaid run returns HTTP 402 with a quote.
  const challenge = await postRun();
  if (challenge.status === 200) {
    // Billing is off on this server: the run is free, just print the output.
    const free = await challenge.json().catch(() => ({}));
    console.log(String(free.output || JSON.stringify(free)));
    return;
  }
  if (challenge.status !== 402) {
    const t = await challenge.text();
    throw new Error("Unexpected status " + challenge.status + ": " + t);
  }
  const quote = await challenge.json();
  // Pick the direct on-chain x402 option (skip the Circle Gateway batching entry).
  const accept = (quote.accepts || []).find(
    (a) => a.payTo && a.asset && !(a.extra && a.extra.name === "GatewayWalletBatched")
  ) || (quote.accepts || [])[0];
  if (!accept || !accept.payTo || !accept.maxAmountRequired) {
    throw new Error("No usable payment option in the 402 quote.");
  }
  const amount = BigInt(accept.maxAmountRequired);
  const payTo = accept.payTo;
  const usdc = accept.asset;
  console.log("Workflow:", slug, "| tier:", tier, "| price:",
    (quote.howToPay && quote.howToPay.priceUsdc) || (Number(amount) / 1e6).toFixed(6), "USDC");

  // 2. Pay: transfer the exact USDC amount to the treasury from the agent wallet.
  // Pin the network so ethers does not spend RPC calls auto-detecting the chain id.
  const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID, { staticNetwork: true });
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const token = new ethers.Contract(usdc, ERC20_ABI, wallet);
  const balance = await withRetry("balanceOf", () => token.balanceOf(wallet.address));
  if (balance < amount) {
    throw new Error("Insufficient USDC: have " + (Number(balance) / 1e6).toFixed(6) +
      ", need " + (Number(amount) / 1e6).toFixed(6) + " (plus a little for gas). Fund " + wallet.address);
  }
  console.log("Paying from", wallet.address, "...");
  const tx = await withRetry("transfer", () => token.transfer(payTo, amount));
  console.log("Payment tx:", tx.hash, "- waiting for confirmation...");
  await withRetry("confirm", () => tx.wait());

  // 3. Retry the run with proof of payment; the workflow executes and returns the output.
  const xPayment = Buffer.from(JSON.stringify({ payerWallet: wallet.address, txHash: tx.hash })).toString("base64");
  const paid = await postRun({ "X-PAYMENT": xPayment });
  const out = await paid.json().catch(() => ({}));
  if (paid.status !== 200) {
    throw new Error("Run failed: " + (out.message || out.error || paid.status));
  }
  console.log("\nCharged", out.priceUsdc || (Number(amount) / 1e6).toFixed(6), "USDC | settlement:",
    out.releaseTx || out.settlementTx || "(none)");
  console.log("\n--- OUTPUT ---\n" + String(out.output || "").trim());
}

main().catch((e) => { console.error("Error:", e.message); process.exit(1); });
