"use strict";

// Shared agent core for Fundline: discover workflows and pay-and-run them from a
// Circle Developer-Controlled Wallet on Arc. Used by both circle-agent-demo.js
// (CLI) and mcp-server/fundline-mcp.js (MCP server). Non-custodial: the caller
// passes in its own Circle client + Fundline key; this module holds no secrets.

const ESCROW_ABI_FUND = "fund(bytes32,uint256)";
const USDC_ABI_APPROVE = "approve(address,uint256)";
const USDC_ABI_TRANSFER = "transfer(address,uint256)";
const LOW_FEE = { type: "level", config: { feeLevel: "LOW" } };

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function initCircle(apiKey, entitySecret) {
  const { initiateDeveloperControlledWalletsClient } = await import("@circle-fin/developer-controlled-wallets");
  return initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
}

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

// Poll a Circle transaction to a final state; return its on-chain txHash.
async function waitForCircleTx(circle, id) {
  for (let i = 0; i < 60; i++) {
    const r = await circle.getTransaction({ id });
    const t = (r && r.data && r.data.transaction) || {};
    if (t.state === "COMPLETE" || t.state === "CONFIRMED") return t.txHash;
    if (t.state === "FAILED" || t.state === "CANCELLED") throw new Error("tx " + t.state + " " + (t.errorReason || ""));
    await sleep(3000);
  }
  throw new Error("tx timed out");
}

async function getWalletAddress(circle, walletId) {
  const r = await circle.getWallet({ id: walletId });
  return r.data.wallet.address;
}

async function getUsdcBalance(circle, walletId) {
  try {
    const r = await circle.getWalletTokenBalance({ id: walletId });
    const balances = (r && r.data && r.data.tokenBalances) || [];
    const usdc = balances.find((b) => b.token && /usdc/i.test(b.token.symbol || ""));
    return usdc ? usdc.amount : null;
  } catch (_) { return null; }
}

// Discover the workflow menu (optionally filtered by keyword). Returns an array.
async function listWorkflows(base, query) {
  const url = base + "/api/workflows" + (query ? "?q=" + encodeURIComponent(query) : "");
  const r = await getJson(url);
  return (r.json && r.json.workflows) || [];
}

async function getConfig(base) {
  const r = await getJson(base + "/api/config");
  return r.json || {};
}

// Escrow mode: quote -> approve -> fund(runId) -> run. Returns the run JSON.
async function runEscrow(o) {
  const quote = await postJson(o.base + "/api/workflows/" + o.slug + "/quote",
    { tier: o.tier }, { "X-API-Key": o.fundlineKey });
  if (quote.status !== 200 || !quote.json) throw new Error("quote failed: " + quote.status + " " + quote.text);
  const { runId, amount, escrowAddress } = quote.json;

  const approve = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_APPROVE, abiParameters: [escrowAddress, amount], fee: LOW_FEE,
  });
  await waitForCircleTx(o.circle, approve.data.id);

  const fund = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: escrowAddress,
    abiFunctionSignature: ESCROW_ABI_FUND, abiParameters: [runId, amount], fee: LOW_FEE,
  });
  await waitForCircleTx(o.circle, fund.data.id);

  const run = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { runId, tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json" });
  if (run.status !== 200 || !run.json) throw new Error("run failed: " + run.status + " " + run.text);
  return run.json;
}

// x402 mode: run -> 402 quote -> transfer to treasury -> run with X-PAYMENT.
async function runX402(o) {
  const challenge = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { tier: o.tier, prompt: o.prompt }, { "X-API-Key": o.fundlineKey, "Accept": "application/json" });
  if (challenge.status !== 402 || !challenge.json || !challenge.json.accepts) {
    throw new Error("expected 402 challenge, got " + challenge.status + " " + challenge.text);
  }
  const q = challenge.json.accepts[0];
  const transfer = await o.circle.createContractExecutionTransaction({
    walletId: o.walletId, contractAddress: o.usdc,
    abiFunctionSignature: USDC_ABI_TRANSFER, abiParameters: [q.payTo, q.maxAmountRequired], fee: LOW_FEE,
  });
  const txHash = await waitForCircleTx(o.circle, transfer.data.id);
  const xPayment = Buffer.from(JSON.stringify({ payerWallet: o.walletAddress, txHash })).toString("base64");
  const run = await postJson(o.base + "/api/workflows/" + o.slug + "/run",
    { tier: o.tier, prompt: o.prompt },
    { "X-API-Key": o.fundlineKey, "Accept": "application/json", "X-PAYMENT": xPayment });
  if (run.status !== 200 || !run.json) throw new Error("run failed: " + run.status + " " + run.text);
  return run.json;
}

// Pay for and run a workflow using the chosen mode. o: { circle, walletId,
// walletAddress, usdc, base, fundlineKey, slug, tier, prompt, payMode }.
async function payAndRun(o) {
  if (o.payMode === "x402") return runX402(o);
  return runEscrow(o);
}

module.exports = {
  initCircle, getJson, postJson, waitForCircleTx, getWalletAddress, getUsdcBalance,
  listWorkflows, getConfig, runEscrow, runX402, payAndRun,
};
