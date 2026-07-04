"use strict";

// Demo: an AI agent that pays for a Fundline workflow run using its OWN Circle
// Developer-Controlled Wallet on Arc. Non-custodial: the Circle API key + entity
// secret belong to the agent (you) and stay in the agent's environment; Fundline
// never sees them. Standalone example, NOT part of the Fundline app.
//
// Two phases:
//   node examples/circle-agent-demo.js setup   ONE-TIME: create the agent wallet,
//                                              print its address + how to fund it.
//   node examples/circle-agent-demo.js run     AUTONOMOUS: quote -> pay -> run,
//                                              no human clicks. Repeatable.
//
// Prerequisites (one time, human): a Circle testnet API key, a registered entity
// secret (https://developers.circle.com/wallets/dev-controlled/register-entity-secret),
// the SDK (npm i @circle-fin/developer-controlled-wallets), and a Fundline API key
// from the dashboard. See examples/README.md.
//
// Env: CIRCLE_API_KEY, CIRCLE_ENTITY_SECRET (both phases); CIRCLE_WALLET_ID (run
// phase, printed by setup); FUNDLINE_API_KEY, FUNDLINE_BASE_URL, WORKFLOW_SLUG,
// WORKFLOW_TIER, WORKFLOW_PROMPT, PAY_MODE (escrow|x402), RUN_COUNT (run phase).

const ESCROW_ABI_FUND = "fund(bytes32,uint256)";
const USDC_ABI_APPROVE = "approve(address,uint256)";
const USDC_ABI_TRANSFER = "transfer(address,uint256)";
const ARC_FAUCET_URL = "https://faucet.circle.com";

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}
function requireEnv(name) {
  const v = process.env[name];
  if (!v) { console.error("Missing env " + name); process.exit(1); }
  return v;
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getJson(url, headers) {
  const res = await fetch(url, { headers: headers || {} });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}
async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

async function circleClient() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

// Poll a Circle transaction to a final state; return its on-chain txHash.
async function waitForCircleTx(circle, id, label) {
  for (let i = 0; i < 60; i++) {
    const r = await circle.getTransaction({ id });
    const t = (r && r.data && r.data.transaction) || {};
    if (t.state === "COMPLETE" || t.state === "CONFIRMED") {
      console.log(`  ${label}: ${t.state} txHash=${t.txHash}`);
      return t.txHash;
    }
    if (t.state === "FAILED" || t.state === "CANCELLED") {
      throw new Error(`${label} failed: ${t.state} ${t.errorReason || ""}`);
    }
    await sleep(3000);
  }
  throw new Error(`${label} timed out`);
}

// ONE-TIME setup: create the agent's Circle wallet on Arc and print how to fund it.
async function cmdSetup() {
  const circle = await circleClient();
  console.log("Creating a Circle wallet on ARC-TESTNET for your agent...\n");
  const set = await circle.createWalletSet({ name: "Fundline agent" });
  const wallets = await circle.createWallets({
    blockchains: ["ARC-TESTNET"],
    count: 1,
    walletSetId: set.data.walletSet.id,
  });
  const w = wallets.data.wallets[0];
  console.log("Wallet created:");
  console.log("  CIRCLE_WALLET_ID = " + w.id);
  console.log("  address          = " + w.address);
  console.log("\nNext (one time):");
  console.log("  1. Fund the address above with USDC from the Arc testnet faucet:");
  console.log("     " + ARC_FAUCET_URL + "  (10 USDC/hour)");
  console.log("  2. export CIRCLE_WALLET_ID=" + w.id);
  console.log("  3. node examples/circle-agent-demo.js run");
  console.log("\nAfter that the agent runs autonomously; no more manual steps per run.");
}

// Best-effort USDC balance read for a pre-flight check.
async function readUsdcBalance(circle, walletId) {
  try {
    const r = await circle.getWalletTokenBalance({ id: walletId });
    const balances = (r && r.data && r.data.tokenBalances) || [];
    const usdc = balances.find((b) => b.token && /usdc/i.test(b.token.symbol || ""));
    return usdc ? usdc.amount : null;
  } catch (_) { return null; }
}

// AUTONOMOUS: quote -> pay -> run, repeated RUN_COUNT times, no human input.
async function cmdRun() {
  const circle = await circleClient();
  const walletId = env("CIRCLE_WALLET_ID", "");
  if (!walletId) {
    console.error("No CIRCLE_WALLET_ID. Run `node examples/circle-agent-demo.js setup` first, fund the wallet, then set CIRCLE_WALLET_ID.");
    process.exit(1);
  }
  const fundlineKey = requireEnv("FUNDLINE_API_KEY");
  const base = env("FUNDLINE_BASE_URL", "http://127.0.0.1:5190").replace(/\/$/, "");
  const slug = env("WORKFLOW_SLUG", "client-research");
  const tier = env("WORKFLOW_TIER", "normal");
  const prompt = env("WORKFLOW_PROMPT", "Research Acme Labs for a partnership call.");
  const payMode = env("PAY_MODE", "escrow");
  const runCount = Math.max(1, Number(env("RUN_COUNT", "1")) || 1);

  const walletResp = await circle.getWallet({ id: walletId });
  const walletAddress = walletResp.data.wallet.address;
  console.log("Agent Circle wallet: " + walletAddress + " (" + walletId + ")");

  const bal = await readUsdcBalance(circle, walletId);
  if (bal != null) console.log("USDC balance: " + bal);

  const cfg = await getJson(base + "/api/config");
  if (!cfg.json) { console.error("Could not read /api/config"); process.exit(1); }
  if (!cfg.json.workflowBillingEnabled) {
    console.error("Workflow billing is not enabled on this Fundline server.");
    process.exit(1);
  }
  const usdc = cfg.json.usdcTokenAddress;
  console.log("USDC: " + usdc + " | chainId: " + cfg.json.chainId + " | mode: " + payMode);

  for (let i = 1; i <= runCount; i++) {
    console.log(`\n===== Run ${i}/${runCount} =====`);
    const ctx = { circle, walletId, walletAddress, usdc, base, slug, tier, prompt, fundlineKey };
    if (payMode === "x402") { await runX402(ctx); } else { await runEscrow(ctx); }
  }
}

// Escrow-fund path: quote -> approve USDC -> fund(runId) -> run.
async function runEscrow(o) {
  const quote = await postJson(o.base + "/api/workflows/" + o.slug + "/quote",
    { tier: o.tier }, { "X-API-Key": o.fundlineKey });
  if (quote.status !== 200 || !quote.json) { console.error("Quote failed:", quote.status, quote.text); return; }
  const { runId, amount, escrowAddress } = quote.json;
  console.log("Quote: runId=" + runId + " amount=" + amount + " escrow=" + escrowAddress);

  console.log("Approving USDC to the escrow...");
  const approve = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_APPROVE, abiParameters: [escrowAddress, amount],
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });
  await waitForCircleTx(o.circle, approve.data.id, "approve");

  console.log("Funding the run...");
  const fund = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: escrowAddress,
    abiFunctionSignature: ESCROW_ABI_FUND, abiParameters: [runId, amount],
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });
  await waitForCircleTx(o.circle, fund.data.id, "fund");

  console.log("Running the workflow...");
  const run = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { runId, tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json" });
  printRun(run);
}

// x402 path: run (no payment) -> 402 quote -> transfer USDC to payTo -> run with X-PAYMENT.
async function runX402(o) {
  const challenge = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json" });
  if (challenge.status !== 402 || !challenge.json || !challenge.json.accepts) {
    console.error("Expected a 402 challenge, got:", challenge.status, challenge.text); return;
  }
  const quote = challenge.json.accepts[0];
  console.log("402 quote: pay " + quote.maxAmountRequired + " to " + quote.payTo);

  console.log("Transferring USDC to the treasury...");
  const transfer = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_TRANSFER, abiParameters: [quote.payTo, quote.maxAmountRequired],
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });
  const txHash = await waitForCircleTx(o.circle, transfer.data.id, "transfer");

  const xPayment = Buffer.from(JSON.stringify({ payerWallet: o.walletAddress, txHash })).toString("base64");
  console.log("Retrying the run with X-PAYMENT proof...");
  const run = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json", "X-PAYMENT": xPayment });
  printRun(run);
}

function printRun(run) {
  if (run.status !== 200 || !run.json) { console.error("Run failed:", run.status, run.text); return; }
  console.log("charged (v98 cost, USD): " + run.json.costUsd + " | settlement tx: " + (run.json.releaseTx || "(none)"));
  console.log("--- output ---\n" + String(run.json.output || "").slice(0, 1500));
}

async function main() {
  const cmd = (process.argv[2] || "run").toLowerCase();
  if (cmd === "setup") { await cmdSetup(); return; }
  if (cmd === "run") { await cmdRun(); return; }
  console.error("Usage: node examples/circle-agent-demo.js [setup|run]");
  process.exit(1);
}

main().catch((e) => { console.error("Demo error:", e.message); process.exit(1); });
