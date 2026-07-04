"use strict";

// Demo: an AI agent that pays for a Fundline workflow run using its OWN Circle
// Developer-Controlled Wallet on Arc. Non-custodial: the Circle API key + entity
// secret belong to the agent (you) and stay in the agent's environment; Fundline
// never sees them. This is a standalone example, NOT part of the Fundline app.
//
// Setup (one time):
//   1. Create a Circle developer account and get a TESTNET API key.
//   2. Generate an entity secret and register it in the Circle console.
//      See https://developers.circle.com/wallets/dev-controlled/register-entity-secret
//   3. In the demo folder: npm i @circle-fin/developer-controlled-wallets
//   4. Create a Fundline API key in the dashboard (API keys tab).
//
// Env vars (put in your own shell/.env, never commit):
//   CIRCLE_API_KEY          your Circle testnet API key
//   CIRCLE_ENTITY_SECRET    your registered entity secret
//   CIRCLE_WALLET_ID        (optional) reuse an existing Circle wallet; if unset the
//                           demo creates one, prints its address, and asks you to fund
//                           it from the Arc testnet faucet (10 USDC/hour), then re-run.
//   FUNDLINE_API_KEY        your Fundline API key
//   FUNDLINE_BASE_URL       default http://127.0.0.1:5190
//   WORKFLOW_SLUG           default client-research
//   WORKFLOW_TIER           default normal
//   WORKFLOW_PROMPT         default a sample prompt
//   PAY_MODE                escrow (default) or x402
//
// Run: node examples/circle-agent-demo.js

const ESCROW_ABI_FUND = "fund(bytes32,uint256)";
const USDC_ABI_APPROVE = "approve(address,uint256)";
const USDC_ABI_TRANSFER = "transfer(address,uint256)";

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
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text };
}

async function postJson(url, body, headers) {
  const res = await fetch(url, {
    method: "POST",
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
    body: JSON.stringify(body || {}),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, headers: res.headers };
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

async function main() {
  const apiKey = requireEnv("CIRCLE_API_KEY");
  const entitySecret = requireEnv("CIRCLE_ENTITY_SECRET");
  const fundlineKey = requireEnv("FUNDLINE_API_KEY");
  const base = env("FUNDLINE_BASE_URL", "http://127.0.0.1:5190").replace(/\/$/, "");
  const slug = env("WORKFLOW_SLUG", "client-research");
  const tier = env("WORKFLOW_TIER", "normal");
  const prompt = env("WORKFLOW_PROMPT", "Research Acme Labs for a partnership call.");
  const payMode = env("PAY_MODE", "escrow");

  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  const circle = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });

  // 1. Wallet: reuse or create-and-stop-to-fund.
  let walletId = env("CIRCLE_WALLET_ID", "");
  if (!walletId) {
    console.log("No CIRCLE_WALLET_ID set. Creating a wallet on ARC-TESTNET...");
    const set = await circle.createWalletSet({ name: "Fundline agent demo" });
    const wallets = await circle.createWallets({
      blockchains: ["ARC-TESTNET"],
      count: 1,
      walletSetId: set.data.walletSet.id,
    });
    const w = wallets.data.wallets[0];
    console.log("Created wallet:");
    console.log("  id:      " + w.id);
    console.log("  address: " + w.address);
    console.log("\nFund this address with USDC from the Arc testnet faucet (10 USDC/hour),");
    console.log("then re-run with CIRCLE_WALLET_ID=" + w.id);
    return;
  }

  const walletResp = await circle.getWallet({ id: walletId });
  const walletAddress = walletResp.data.wallet.address;
  console.log("Agent Circle wallet: " + walletAddress + " (" + walletId + ")");

  // 2. Discover Fundline config (escrow, usdc, price).
  const cfg = await getJson(base + "/api/config");
  if (!cfg.json) { console.error("Could not read /api/config"); process.exit(1); }
  if (!cfg.json.workflowBillingEnabled) {
    console.error("Workflow billing is not enabled on this Fundline server. Set the billing env + restart.");
    process.exit(1);
  }
  const usdc = cfg.json.usdcTokenAddress;
  console.log("USDC: " + usdc + " | chainId: " + cfg.json.chainId);

  if (payMode === "x402") {
    await runX402({ circle, walletId, walletAddress, usdc, base, slug, tier, prompt, fundlineKey });
  } else {
    await runEscrow({ circle, walletId, usdc, base, slug, tier, prompt, fundlineKey });
  }
}

// Escrow-fund path: quote -> approve USDC -> fund(runId) -> run.
async function runEscrow(o) {
  console.log("\n== Escrow-fund mode ==");
  const quote = await postJson(o.base + "/api/workflows/" + o.slug + "/quote",
    { tier: o.tier }, { "X-API-Key": o.fundlineKey });
  if (quote.status !== 200 || !quote.json) { console.error("Quote failed:", quote.status, quote.text); process.exit(1); }
  const { runId, amount, escrowAddress } = quote.json;
  console.log("Quote: runId=" + runId + " amount=" + amount + " escrow=" + escrowAddress);

  console.log("Approving USDC to the escrow...");
  const approve = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId,
    contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_APPROVE,
    abiParameters: [escrowAddress, amount],
    fee: { type: "level", config: { feeLevel: "LOW" } },
  });
  await waitForCircleTx(o.circle, approve.data.id, "approve");

  console.log("Funding the run...");
  const fund = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId,
    contractAddress: escrowAddress,
    abiFunctionSignature: ESCROW_ABI_FUND,
    abiParameters: [runId, amount],
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
  console.log("\n== x402 mode ==");
  const challenge = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json" });
  if (challenge.status !== 402 || !challenge.json || !challenge.json.accepts) {
    console.error("Expected a 402 challenge, got:", challenge.status, challenge.text); process.exit(1);
  }
  const quote = challenge.json.accepts[0];
  console.log("402 quote: pay " + quote.maxAmountRequired + " to " + quote.payTo);

  console.log("Transferring USDC to the treasury...");
  const transfer = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId,
    contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_TRANSFER,
    abiParameters: [quote.payTo, quote.maxAmountRequired],
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
  if (run.status !== 200 || !run.json) { console.error("Run failed:", run.status, run.text); process.exit(1); }
  console.log("\n== Result ==");
  console.log("charged (USD-equivalent v98 cost): " + run.json.costUsd);
  console.log("settlement tx: " + (run.json.releaseTx || "(none)"));
  console.log("\n--- output ---\n" + String(run.json.output || "").slice(0, 2000));
}

main().catch((e) => { console.error("Demo error:", e.message); process.exit(1); });
