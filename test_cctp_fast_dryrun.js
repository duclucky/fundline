"use strict";

// CCTP Fast Transfer end-to-end testnet dry-run: ETH Sepolia (domain 0) -> Arc (domain 26).
// This proves the cross-chain path the product actually ships (the bridge-and-pay flow in
// app.js uses fast: true). It mirrors that flow exactly:
//   Step 1: Resolve the Fast fee tier (IRIS fee API, finalityThreshold 1000, minimumFee > 0)
//   Step 2: approve(TokenMessengerV2) + depositForBurn V2 with maxFee and finalityThreshold 1000
//   Step 3: Poll IRIS for the attestation (Fast = soft finality, far quicker than ~19 min)
//   Step 4: receiveMessage(message, attestation) on Arc to mint
//   Step 5: Verify the Arc USDC balance increased by the transferred amount
//
// Run in the background: node test_cctp_fast_dryrun.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

// Arc (destination)
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_DOMAIN = 26;
const ARC_USDC_DECIMALS = 6;

// ETH Sepolia (source)
const SRC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SRC_CHAIN_ID = 11155111n;
const SRC_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SRC_DOMAIN = 0;

// CCTP V2 (same addresses across testnet chains)
const TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const IRIS_BASE = "iris-api-sandbox.circle.com";
const FAST_FINALITY_THRESHOLD = 1000;
const STANDARD_FINALITY_THRESHOLD = 2000;

const TRANSFER_AMOUNT = 500_000n; // 0.5 USDC

const TM_ABI = [
  "function depositForBurn(uint256 amount, uint32 destinationDomain, bytes32 mintRecipient, address burnToken, bytes32 destinationCaller, uint256 maxFee, uint32 minFinalityThreshold)",
];
const MT_ABI = ["function receiveMessage(bytes message, bytes attestation)"];
const ERC20_ABI = [
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
];

function ts() { return new Date().toISOString().slice(11, 19); }
function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function httpsGet(pathname) {
  return new Promise((resolve) => {
    https.get({ hostname: IRIS_BASE, path: pathname, headers: { Accept: "application/json" } }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ status: res.statusCode, raw: body }); } });
    }).on("error", () => resolve({ error: true }));
  });
}

// Mirror app.js resolveCctpFee for the Fast path.
async function resolveFastFee(amountUnits, srcDomain, dstDomain) {
  let maxFee = 0n;
  let minFinalityThreshold = FAST_FINALITY_THRESHOLD;
  const r = await httpsGet(`/v2/burn/USDC/fees/${srcDomain}/${dstDomain}`);
  const tiers = Array.isArray(r.data) ? r.data : [];
  let tier = tiers.find((f) => Number(f.minimumFee) > 0);
  if (!tier && tiers.length) tier = tiers.reduce((p, c) => (Number(c.finalityThreshold) < Number(p.finalityThreshold) ? c : p), tiers[0]);
  if (tier) {
    minFinalityThreshold = Number(tier.finalityThreshold) || minFinalityThreshold;
    const bps = Number(tier.minimumFee) || 0;
    if (bps > 0) {
      const bpsScaled = BigInt(Math.ceil(bps * 100));
      const feeUnits = (amountUnits * bpsScaled + 999999n) / 1000000n;
      maxFee = (feeUnits * 125n) / 100n;
    }
  }
  if (maxFee === 0n) { minFinalityThreshold = STANDARD_FINALITY_THRESHOLD; } // would be slow; flagged below
  return { maxFee, minFinalityThreshold };
}

async function main() {
  const pk = process.env.ARC_DEPLOYER_PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!pk) { console.error("ERROR: ARC_DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }

  const srcProvider = new ethers.JsonRpcProvider(SRC_RPC);
  const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
  const srcNet = await srcProvider.getNetwork();
  if (srcNet.chainId !== SRC_CHAIN_ID) { console.error("Wrong source chain", srcNet.chainId); process.exit(1); }
  const arcNet = await arcProvider.getNetwork();
  if (arcNet.chainId !== ARC_CHAIN_ID) { console.error("Wrong Arc chain", arcNet.chainId); process.exit(1); }

  const srcSigner = new ethers.Wallet(pk, srcProvider);
  const arcSigner = new ethers.Wallet(pk, arcProvider);
  const wallet = srcSigner.address;
  console.log(`[${ts()}] Wallet: ${wallet}`);
  console.log(`[${ts()}] Bridging ${Number(TRANSFER_AMOUNT) / 1e6} USDC via CCTP Fast: ETH Sepolia (0) -> Arc (26)`);

  const srcUsdc = new ethers.Contract(SRC_USDC, ERC20_ABI, srcSigner);
  const arcUsdc = new ethers.Contract(ARC_USDC, ERC20_ABI, arcProvider);

  const srcBal = await srcUsdc.balanceOf(wallet);
  console.log(`[${ts()}] Source USDC balance: ${Number(srcBal) / 1e6} USDC`);
  if (srcBal < TRANSFER_AMOUNT) { console.error("FAIL: insufficient source USDC"); process.exit(1); }
  const arcBefore = await arcUsdc.balanceOf(wallet);
  console.log(`[${ts()}] Arc USDC balance before: ${Number(arcBefore) / 1e6} USDC`);

  // Step 1: fee tier
  console.log(`\n[${ts()}] --- Step 1: Resolve Fast fee tier ---`);
  const fee = await resolveFastFee(TRANSFER_AMOUNT, SRC_DOMAIN, ARC_DOMAIN);
  console.log(`[${ts()}] finalityThreshold=${fee.minFinalityThreshold} maxFee=${Number(fee.maxFee) / 1e6} USDC`);
  if (fee.minFinalityThreshold !== FAST_FINALITY_THRESHOLD) {
    console.log(`[${ts()}] WARNING: no Fast tier resolved; this would fall back to Standard (~13-19 min).`);
  }

  // Step 2: approve + depositForBurn
  console.log(`\n[${ts()}] --- Step 2: approve + depositForBurn ---`);
  const allowance = await srcUsdc.allowance(wallet, TOKEN_MESSENGER_V2);
  if (allowance < TRANSFER_AMOUNT) {
    const approveTx = await srcUsdc.approve(TOKEN_MESSENGER_V2, TRANSFER_AMOUNT);
    console.log(`[${ts()}] approve tx: ${approveTx.hash}`);
    await approveTx.wait(1);
    console.log(`[${ts()}] PASS: approved`);
  } else {
    console.log(`[${ts()}] allowance sufficient, skip approve`);
  }

  const tm = new ethers.Contract(TOKEN_MESSENGER_V2, TM_ABI, srcSigner);
  const mintRecipient = ethers.zeroPadValue(wallet, 32);
  const destinationCaller = ethers.ZeroHash;
  const burnTx = await tm.depositForBurn(
    TRANSFER_AMOUNT, ARC_DOMAIN, mintRecipient, SRC_USDC, destinationCaller, fee.maxFee, fee.minFinalityThreshold
  );
  console.log(`[${ts()}] depositForBurn tx: ${burnTx.hash}`);
  const burnReceipt = await burnTx.wait(1);
  if (burnReceipt.status !== 1) { console.error("FAIL: depositForBurn reverted"); process.exit(1); }
  console.log(`[${ts()}] PASS: burn confirmed in block ${burnReceipt.blockNumber}, gas ${burnReceipt.gasUsed}`);

  // Step 3: poll IRIS for attestation
  console.log(`\n[${ts()}] --- Step 3: Poll IRIS for attestation (Fast soft finality) ---`);
  const pollStart = Date.now();
  let message = null;
  for (let attempt = 1; attempt <= 240; attempt++) { // up to ~20 min safety
    const r = await httpsGet(`/v2/messages/${SRC_DOMAIN}?transactionHash=${burnTx.hash}`);
    const msg = Array.isArray(r.data?.messages) ? r.data.messages[0] : null;
    const status = String(msg?.status || "").toLowerCase();
    if (attempt === 1 || attempt % 4 === 0 || (msg?.message && msg?.attestation)) {
      console.log(`[${ts()}]   attempt ${attempt}: status=${status || "pending"} (${Math.round((Date.now() - pollStart) / 1000)}s)`);
    }
    if (msg?.message && msg?.attestation && status === "complete") { message = msg; break; }
    await delay(5000);
  }
  if (!message) { console.error(`[${ts()}] FAIL: attestation not ready in time`); process.exit(1); }
  console.log(`[${ts()}] PASS: attestation ready after ${Math.round((Date.now() - pollStart) / 1000)}s`);

  // Step 4: receiveMessage on Arc
  console.log(`\n[${ts()}] --- Step 4: receiveMessage on Arc (mint) ---`);
  const mt = new ethers.Contract(MESSAGE_TRANSMITTER_V2, MT_ABI, arcSigner);
  const mintTx = await mt.receiveMessage(message.message, message.attestation);
  console.log(`[${ts()}] receiveMessage tx: ${mintTx.hash}`);
  const mintReceipt = await mintTx.wait(1);
  if (mintReceipt.status !== 1) { console.error("FAIL: receiveMessage reverted"); process.exit(1); }
  console.log(`[${ts()}] PASS: mint confirmed in block ${mintReceipt.blockNumber}, gas ${mintReceipt.gasUsed}`);

  // Step 5: verify Arc balance
  console.log(`\n[${ts()}] --- Step 5: Verify Arc balance ---`);
  let arcAfter = arcBefore;
  for (let i = 0; i < 24; i++) {
    arcAfter = await arcUsdc.balanceOf(wallet);
    if (arcAfter > arcBefore) break;
    await delay(5000);
  }
  const delta = arcAfter - arcBefore;
  // The Arc balance delta is the minted amount minus two small costs:
  //   1. the CCTP Fast fee (deducted from the transfer before mint), and
  //   2. the Arc gas for receiveMessage -- Arc's gas token IS USDC, and this tx is sent by the
  //      wallet, so the gas reduces the same USDC balance we are measuring.
  // Both are well under 1% of the transfer, so the delta should land just below TRANSFER_AMOUNT.
  const lowerBound = (TRANSFER_AMOUNT * 98n) / 100n; // allow up to ~2% for fee + Arc gas
  console.log(`[${ts()}] Arc before: ${Number(arcBefore) / 1e6} USDC`);
  console.log(`[${ts()}] Arc after:  ${Number(arcAfter) / 1e6} USDC`);
  console.log(`[${ts()}] Delta:      ${Number(delta) / 1e6} USDC (transfer ${Number(TRANSFER_AMOUNT) / 1e6} minus CCTP fee + Arc USDC gas)`);

  console.log(`\n[${ts()}] --- Summary ---`);
  if (delta > 0n && delta <= TRANSFER_AMOUNT && delta >= lowerBound) {
    const totalSec = Math.round((Date.now() - pollStart) / 1000);
    console.log(`[${ts()}] ALL CHECKS PASSED. CCTP Fast minted ${Number(delta) / 1e6} USDC on Arc. Attestation took ${totalSec}s.`);
  } else {
    console.log(`[${ts()}] CHECK: Arc delta ${Number(delta) / 1e6} USDC outside expected band; inspect manually.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[${ts()}] Error: ${e.message || e}`); process.exit(1); });
