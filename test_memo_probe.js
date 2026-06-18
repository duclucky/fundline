"use strict";

// Probe: does Arc's Memo contract (which routes through the CallFrom precompile) actually
// work for a USDC transfer? Fundline's earlier finding was that CallFrom threw StackUnderflow
// for any subcall, forcing a 2-tx flow. Transaction memos depend on CallFrom, so this resolves
// whether the memo path (and a possible 1-tx invoice payment) is viable on the current testnet.
//
// It does a self-transfer of 0.01 USDC wrapped in a memo (net-zero except gas) and checks:
//   1. the tx does not revert (CallFrom works),
//   2. a USDC Transfer event fires with from == payer (msg.sender preserved by CallFrom),
//   3. the Memo contract emits its Memo event.
//
// Run: node test_memo_probe.js

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
  console.log(`[${ts()}] Payer: ${payer}`);

  const usdcIface = new ethers.Interface(ERC20_ABI);
  const amount = ethers.parseUnits("0.01", ARC_USDC_DECIMALS); // 6 decimals, NOT 18
  const transferData = usdcIface.encodeFunctionData("transfer", [payer, amount]); // self-transfer

  const memoId = ethers.id("fundline-probe-invoice-0001"); // bytes32, like an on-chain invoice id
  const memoData = ethers.toUtf8Bytes("order=probe-0001;src=fundline");

  console.log(`[${ts()}] memoId:   ${memoId}`);
  console.log(`[${ts()}] memoData: "${Buffer.from(memoData).toString("utf8")}" (${memoData.length} bytes)`);
  console.log(`[${ts()}] Calling Memo.memo(USDC, transfer(self, 0.01), memoId, memoData)...`);

  const memo = new ethers.Contract(MEMO_CONTRACT, MEMO_ABI, signer);
  let tx;
  try {
    tx = await memo.memo(ARC_USDC, transferData, memoId, memoData, { gasLimit: 400000n });
  } catch (e) {
    console.error(`[${ts()}] FAIL: send reverted on estimate/submit: ${e.shortMessage || e.message}`);
    process.exit(1);
  }
  console.log(`[${ts()}] tx: ${tx.hash}`);
  const receipt = await tx.wait(1);
  console.log(`[${ts()}] status: ${receipt.status === 1 ? "SUCCESS" : "REVERTED"}, gas ${receipt.gasUsed}, logs ${receipt.logs.length}`);
  if (receipt.status !== 1) {
    console.error(`[${ts()}] FAIL: memo tx reverted (CallFrom likely still broken).`);
    process.exit(1);
  }

  // Check USDC Transfer event with from == payer (proves CallFrom preserved msg.sender)
  const transferLog = receipt.logs.find(
    (l) => l.address.toLowerCase() === ARC_USDC.toLowerCase() && l.topics[0] === TRANSFER_TOPIC
  );
  let senderPreserved = false;
  if (transferLog) {
    const from = "0x" + transferLog.topics[1].slice(26);
    const to = "0x" + transferLog.topics[2].slice(26);
    senderPreserved = from.toLowerCase() === payer.toLowerCase();
    console.log(`[${ts()}] USDC Transfer: from=${from} to=${to}`);
    console.log(`[${ts()}] msg.sender preserved (from == payer): ${senderPreserved ? "YES" : "NO"}`);
  } else {
    console.log(`[${ts()}] No USDC Transfer event found.`);
  }

  // Check a Memo event from the memo contract
  const memoLogs = receipt.logs.filter((l) => l.address.toLowerCase() === MEMO_CONTRACT.toLowerCase());
  console.log(`[${ts()}] Memo contract emitted ${memoLogs.length} event(s). memoId indexed topic present: ${memoLogs.some((l) => l.topics.includes(memoId))}`);

  console.log(`\n[${ts()}] --- Summary ---`);
  if (receipt.status === 1 && senderPreserved) {
    console.log(`[${ts()}] PASS: Arc Memo path WORKS. CallFrom preserved msg.sender; USDC moved in a single tx with an on-chain memo. Arcscan: https://testnet.arcscan.app/tx/${tx.hash}`);
  } else {
    console.log(`[${ts()}] PARTIAL: tx succeeded but msg.sender not preserved; inspect manually.`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(`[${ts()}] Error: ${e.message || e}`); process.exit(1); });
