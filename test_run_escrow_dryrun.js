"use strict";

// On-chain lifecycle dry-run for FundlineRunEscrow on Arc testnet. Exercises
// fund -> release and fund -> refund against the deployed + verified contract,
// asserting state, the escrow contract's USDC balance delta (robust even if
// payer == treasury), and the emitted events (InvoiceMemo / RunReleased /
// RunRefunded). Sends real testnet transactions; needs ARC_TREASURY_PRIVATE_KEY
// (signs release/refund) and a payer key with testnet USDC. Run: node test_run_escrow_dryrun.js

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { JsonRpcProvider, Wallet, Contract, Interface, toUtf8Bytes, toUtf8String, formatUnits } = require("ethers");
const memo = require("./memo-util");

const ROOT = __dirname;
loadEnv(path.join(ROOT, ".env"));

const RPC = req("ARC_RPC_URL");
const USDC_ADDR = (process.env.ARC_USDC_TOKEN_ADDRESS || "0x3600000000000000000000000000000000000000").trim();
const ESCROW_ADDR = req("ARC_RUN_ESCROW_ADDRESS");
const PRICE = 50000n; // 0.05 USDC

const ESCROW_ABI = [
  "function fund(bytes32 runId, uint256 amount)",
  "function release(bytes32 runId, bytes memo)",
  "function refund(bytes32 runId)",
  "function getRun(bytes32 runId) view returns (address payer, uint256 amount, uint64 refundDeadline, bool released, bool refunded)",
  "event RunFunded(bytes32 indexed runId, address indexed payer, uint256 amount)",
  "event RunReleased(bytes32 indexed runId, address indexed payer, uint256 amount)",
  "event RunRefunded(bytes32 indexed runId, address indexed payer, uint256 amount)",
  "event InvoiceMemo(bytes32 indexed invoiceId, address indexed payer, bytes memo)",
];
const USDC_ABI = [
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

let passed = 0;
let failed = 0;
function check(name, cond) { if (cond) { passed += 1; console.log("  ok " + name); } else { failed += 1; console.error("  FAIL " + name); } }

main().catch((e) => { console.error(e.message || e); process.exit(1); });

async function main() {
  const provider = new JsonRpcProvider(RPC);
  const payer = new Wallet(norm("ARC_DEPLOYER_PRIVATE_KEY"), provider);
  const treasury = new Wallet(norm("ARC_TREASURY_PRIVATE_KEY"), provider);
  const escrowIface = new Interface(ESCROW_ABI);
  const usdc = new Contract(USDC_ADDR, USDC_ABI, payer);
  const escrowAsPayer = new Contract(ESCROW_ADDR, ESCROW_ABI, payer);
  const escrowAsTreasury = new Contract(ESCROW_ADDR, ESCROW_ABI, treasury);

  console.log(`Escrow ${ESCROW_ADDR}`);
  console.log(`Payer ${payer.address} | Treasury ${treasury.address}`);
  const payerBal = await usdc.balanceOf(payer.address);
  console.log(`Payer USDC: ${formatUnits(payerBal, 6)}`);
  if (payerBal < PRICE * 2n) throw new Error("Payer needs at least 0.1 USDC for the dry-run.");

  // Approve the escrow to pull two runs worth, if needed.
  const allowance = await usdc.allowance(payer.address, ESCROW_ADDR);
  if (allowance < PRICE * 2n) {
    console.log("Approving escrow for 1 USDC...");
    await (await usdc.approve(ESCROW_ADDR, 1000000n)).wait(1);
  }

  const escrowStart = await usdc.balanceOf(ESCROW_ADDR);

  // --- Lifecycle 1: fund -> release ---
  console.log("\n[release path]");
  const runId1 = "0x" + crypto.randomBytes(32).toString("hex");
  await (await escrowAsPayer.fund(runId1, PRICE)).wait(1);
  let r1 = await escrowAsPayer.getRun(runId1);
  check("funded: payer set", r1[0].toLowerCase() === payer.address.toLowerCase());
  check("funded: amount == price", BigInt(r1[1]) === PRICE);
  check("funded: not released/refunded", r1[3] === false && r1[4] === false);
  check("escrow balance +price after fund", (await usdc.balanceOf(ESCROW_ADDR)) === escrowStart + PRICE);

  const memoText = memo.buildWorkflowMemoText({ workflowName: "Client Research", steps: [
    { name: "Role analysis", model: "gpt-4o-mini" },
    { name: "Web research", model: "Tavily" },
    { name: "Report writer", model: "gpt-4.1-mini" },
  ] });
  const relRcpt = await (await escrowAsTreasury.release(runId1, toUtf8Bytes(memoText))).wait(1);
  r1 = await escrowAsPayer.getRun(runId1);
  check("released: released == true", r1[3] === true);
  check("escrow balance back to start after release", (await usdc.balanceOf(ESCROW_ADDR)) === escrowStart);
  const logs1 = parseLogs(escrowIface, relRcpt);
  const memoLog = logs1.find((l) => l.name === "InvoiceMemo");
  check("InvoiceMemo emitted", Boolean(memoLog));
  check("InvoiceMemo runId matches", memoLog && memoLog.args[0].toLowerCase() === runId1.toLowerCase());
  check("InvoiceMemo body matches memo text", memoLog && toUtf8String(memoLog.args[2]) === memoText);
  check("RunReleased emitted", logs1.some((l) => l.name === "RunReleased"));

  // --- Lifecycle 2: fund -> refund ---
  console.log("\n[refund path]");
  const runId2 = "0x" + crypto.randomBytes(32).toString("hex");
  await (await escrowAsPayer.fund(runId2, PRICE)).wait(1);
  check("escrow balance +price after fund2", (await usdc.balanceOf(ESCROW_ADDR)) === escrowStart + PRICE);
  const refRcpt = await (await escrowAsTreasury.refund(runId2)).wait(1);
  const r2 = await escrowAsPayer.getRun(runId2);
  check("refunded: refunded == true", r2[4] === true);
  check("escrow balance back to start after refund", (await usdc.balanceOf(ESCROW_ADDR)) === escrowStart);
  check("RunRefunded emitted", parseLogs(escrowIface, refRcpt).some((l) => l.name === "RunRefunded"));

  // --- Guard: double-release reverts ---
  console.log("\n[guards]");
  let reverted = false;
  try { await (await escrowAsTreasury.release(runId1, "0x")).wait(1); } catch { reverted = true; }
  check("double-release reverts", reverted);

  console.log(`\nrun escrow dry-run: ${passed} passed, ${failed} failed`);
  console.log(`memo emitted on-chain:\n${memoText}`);
  process.exit(failed === 0 ? 0 : 1);
}

function parseLogs(iface, receipt) {
  const out = [];
  for (const log of receipt.logs) {
    try { const p = iface.parseLog(log); if (p) out.push(p); } catch {}
  }
  return out;
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
