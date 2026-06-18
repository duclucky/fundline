"use strict";

// Realistic Fundline-shaped memo payment on Arc testnet, plus reconciliation read-back.
// This validates the exact flow a memo-based invoice payment would use, and proves the
// indexing claim both candidate directions depend on:
//   Pay:  Memo.memo(USDC, transfer(MERCHANT, amount), invoiceId, memoData)  (payer -> merchant)
//   Read: eth_getLogs on the Memo contract, locate the log carrying our invoiceId topic,
//         confirming an indexer can reconcile a payment by invoice id.
//
// It does NOT change the shipped app or deploy anything. Run: node test_memo_payment_dryrun.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  });
}

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_USDC_DECIMALS = 6;
const MEMO_CONTRACT = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";

// Distinct test "merchant" (not the payer) so we prove to != from.
const MERCHANT = "0x000000000000000000000000000000000000bEEF";

const MEMO_ABI = ["function memo(address target, bytes data, bytes32 memoId, bytes memoData)"];
const ERC20_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

function ts() { return new Date().toISOString().slice(11, 19); }

async function main() {
  const pk = process.env.ARC_DEPLOYER_PRIVATE_KEY;
  if (!pk) { console.error("ERROR: ARC_DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const net = await provider.getNetwork();
  if (net.chainId !== ARC_CHAIN_ID) { console.error("Wrong Arc chain", net.chainId); process.exit(1); }

  const signer = new ethers.Wallet(pk, provider);
  const payer = signer.address;
  const merchant = ethers.getAddress(MERCHANT);
  console.log(`[${ts()}] Payer:    ${payer}`);
  console.log(`[${ts()}] Merchant: ${merchant} (distinct test recipient)`);

  const usdcIface = new ethers.Interface(ERC20_ABI);
  const usdc = new ethers.Contract(ARC_USDC, ERC20_ABI, provider);
  const amount = ethers.parseUnits("0.01", ARC_USDC_DECIMALS); // 6 decimals
  const transferData = usdcIface.encodeFunctionData("transfer", [merchant, amount]);

  // memoId carries the on-chain invoice id (Fundline already uses a bytes32 onchainInvoiceId).
  const invoiceId = ethers.id("FUND-INV-2026-0042");
  const memoData = ethers.toUtf8Bytes(JSON.stringify({ inv: "FUND-INV-2026-0042", src: "fundline" }));
  console.log(`[${ts()}] invoiceId (memoId): ${invoiceId}`);
  console.log(`[${ts()}] memoData: ${Buffer.from(memoData).toString("utf8")}`);

  const merchantBefore = await usdc.balanceOf(merchant);

  // --- Pay ---
  console.log(`\n[${ts()}] --- Pay: Memo.memo(USDC, transfer(merchant, 0.01), invoiceId, memoData) ---`);
  const memo = new ethers.Contract(MEMO_CONTRACT, MEMO_ABI, signer);
  const tx = await memo.memo(ARC_USDC, transferData, invoiceId, memoData, { gasLimit: 400000n });
  console.log(`[${ts()}] tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`[${ts()}] status: ${receipt.status === 1 ? "SUCCESS" : "REVERTED"}, gas ${receipt.gasUsed}, block ${receipt.blockNumber}`);
  if (receipt.status !== 1) { console.error("FAIL: memo payment reverted"); process.exit(1); }

  const transferLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === ARC_USDC.toLowerCase() && l.topics[0] === TRANSFER_TOPIC
  );
  let payOk = false;
  if (transferLog) {
    const from = ethers.getAddress("0x" + transferLog.topics[1].slice(26));
    const to = ethers.getAddress("0x" + transferLog.topics[2].slice(26));
    payOk = from.toLowerCase() === payer.toLowerCase() && to.toLowerCase() === merchant.toLowerCase();
    console.log(`[${ts()}] USDC Transfer: from=${from} to=${to}`);
  }
  const merchantAfter = await usdc.balanceOf(merchant);
  const delta = merchantAfter - merchantBefore;
  console.log(`[${ts()}] Merchant balance delta: ${Number(delta) / 1e6} USDC (expected ${Number(amount) / 1e6})`);

  // --- Read back: query the Memo contract logs and locate our invoiceId ---
  console.log(`\n[${ts()}] --- Read back: eth_getLogs by invoiceId (reconciliation) ---`);
  const logs = await provider.getLogs({
    address: MEMO_CONTRACT,
    fromBlock: receipt.blockNumber,
    toBlock: receipt.blockNumber,
  });
  const matching = logs.filter((l) => l.topics.includes(invoiceId));
  console.log(`[${ts()}] Memo logs in block: ${logs.length}, carrying our invoiceId: ${matching.length}`);
  let readOk = matching.length > 0;
  if (readOk) {
    const l = matching[0];
    console.log(`[${ts()}] Matched Memo log: topics=${l.topics.length}, txHash=${l.transactionHash}`);
    console.log(`[${ts()}] Reconciled to our payment tx: ${l.transactionHash.toLowerCase() === tx.hash.toLowerCase()}`);
    readOk = l.transactionHash.toLowerCase() === tx.hash.toLowerCase();
  }

  console.log(`\n[${ts()}] --- Summary ---`);
  if (payOk && delta === amount && readOk) {
    console.log(`[${ts()}] ALL CHECKS PASSED. Memo invoice payment (payer -> merchant) settled in 1 tx and is`);
    console.log(`[${ts()}] queryable by invoiceId for reconciliation. Arcscan: https://testnet.arcscan.app/tx/${tx.hash}`);
  } else {
    console.log(`[${ts()}] CHECK FAILED: payOk=${payOk} deltaOk=${delta === amount} readOk=${readOk}; inspect manually.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[${ts()}] Error: ${e.message || e}`); process.exit(1); });
