"use strict";

// End-to-end billing dry-run against a LOCAL server + the live escrow on Arc testnet.
// Simulates the client: POST /quote -> fund the escrow on-chain (payer wallet) ->
// POST /run with the runId -> the server verifies the funded run, runs the workflow
// (real v98 + Tavily, small cost), and treasury-releases the escrow. Asserts the run
// output, the on-chain release, and the InvoiceMemo. Needs the server running locally
// with billing active. Run: node test_billing_e2e_dryrun.js  (set BASE to override URL)

const fs = require("fs");
const path = require("path");
const { JsonRpcProvider, Wallet, Contract } = require("ethers");

const ROOT = __dirname;
loadEnv(path.join(ROOT, ".env"));
const BASE = process.env.E2E_BASE || "http://127.0.0.1:5199";
const RPC = req("ARC_RPC_URL");
const USDC = (process.env.ARC_USDC_TOKEN_ADDRESS || "0x3600000000000000000000000000000000000000").trim();

const ESCROW_ABI = [
  "function fund(bytes32 runId, uint256 amount)",
  "function getRun(bytes32 runId) view returns (address payer, uint256 amount, uint64 refundDeadline, bool released, bool refunded)",
];
const USDC_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
];

let passed = 0;
let failed = 0;
function check(n, c) { if (c) { passed += 1; console.log("  ok " + n); } else { failed += 1; console.error("  FAIL " + n); } }

main().catch((e) => { console.error(e.message || e); process.exit(1); });

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const payer = new Wallet(norm("ARC_DEPLOYER_PRIVATE_KEY"), provider);
  console.log(`Server ${BASE} | Payer ${payer.address}`);

  // 1. Quote
  const quote = await postJson(`${BASE}/api/workflows/client-research/quote`, {});
  check("quote returns runId", /^0x[0-9a-f]{64}$/i.test(quote.runId || ""));
  check("quote returns escrow + amount", Boolean(quote.escrowAddress) && BigInt(quote.amount) > 0n);
  const amount = BigInt(quote.amount);
  const escrow = new Contract(quote.escrowAddress, ESCROW_ABI, payer);
  const usdc = new Contract(USDC, USDC_ABI, payer);

  // 2. Fund on-chain
  if ((await usdc.allowance(payer.address, quote.escrowAddress)) < amount) {
    console.log("  approving...");
    await (await usdc.approve(quote.escrowAddress, 1000000n)).wait(1);
  }
  console.log("  funding run...");
  await (await escrow.fund(quote.runId, amount)).wait(1);
  let r = await escrow.getRun(quote.runId);
  check("funded on-chain", BigInt(r[1]) === amount && r[3] === false);

  // 3. Run (server verifies funding, runs, releases)
  console.log("  running workflow (real v98 + Tavily)...");
  const run = await postJson(`${BASE}/api/workflows/client-research/run`, {
    runId: quote.runId,
    prompt: "Research Acme Corp for a partnership outreach call",
    mode: "search",
  });
  check("run returned output", typeof run.output === "string" && run.output.length > 50);
  check("run returned a release tx", typeof run.releaseTx === "string" && run.releaseTx.startsWith("0x"));
  check("run returned a memo", typeof run.memo === "string" && run.memo.indexOf("Workflow:") !== -1);

  // 4. Verify on-chain release
  r = await escrow.getRun(quote.runId);
  check("run released on-chain", r[3] === true && r[4] === false);

  console.log(`\nbilling e2e: ${passed} passed, ${failed} failed`);
  if (run.releaseTx) console.log("release tx:", run.releaseTx);
  process.exit(failed === 0 ? 0 : 1);
}

async function postJson(url, body) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}: ${data.message || data.error || "failed"}`);
  return data;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  fs.readFileSync(filePath, "utf8").split(/\r?\n/).forEach((line) => {
    const t = line.trim();
    if (!t || t.startsWith("#")) return;
    const i = t.indexOf("=");
    if (i <= 0) return;
    const k = t.slice(0, i).trim();
    const v = t.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    if (k && process.env[k] === undefined) process.env[k] = v;
  });
}
function req(k) { const v = String(process.env[k] || "").trim(); if (!v) throw new Error("Missing " + k); return v; }
function norm(k) { const v = req(k); return v.startsWith("0x") ? v : "0x" + v; }
