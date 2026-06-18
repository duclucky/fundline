"use strict";

// Standalone, read-only Arc Memo indexer (demonstration tool, NOT wired into server.js).
// Scans the Arc Memo contract's events and reconciles invoice payments by invoiceId. This
// shows the "indexer" direction concretely without changing the shipped payment flow or
// moving any funds. Decode uses the exact Memo event ABI:
//   event Memo(address indexed sender, address indexed target, bytes32 callDataHash,
//              bytes32 indexed memoId, bytes memo, uint256 memoIndex)
//
// Usage:
//   node memo_indexer.js                 # scan a recent block window, list all memo payments
//   node memo_indexer.js <invoiceIdHex>  # look up one invoice id (bytes32) across a wide range

const { ethers } = require("ethers");

const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_USDC_DECIMALS = 6;
const MEMO_CONTRACT = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";

const MEMO_EVENT_ABI = [
  "event Memo(address indexed sender, address indexed target, bytes32 callDataHash, bytes32 indexed memoId, bytes memo, uint256 memoIndex)",
];
const TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");
const memoIface = new ethers.Interface(MEMO_EVENT_ABI);
const MEMO_TOPIC = memoIface.getEvent("Memo").topicHash;

function decodeMemoData(bytes) {
  try {
    const text = ethers.toUtf8String(bytes);
    if (/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text)) return text; // printable -> show as text
  } catch { /* fall through */ }
  return bytes; // otherwise raw hex
}

// Pull the USDC Transfer (merchant + amount) from the same tx as a memo log.
async function reconcilePayment(provider, log) {
  const receipt = await provider.getTransactionReceipt(log.transactionHash);
  const transfer = receipt.logs.find(
    (l) => l.address.toLowerCase() === ARC_USDC.toLowerCase() && l.topics[0] === TRANSFER_TOPIC
  );
  if (!transfer) return null;
  return {
    to: ethers.getAddress("0x" + transfer.topics[2].slice(26)),
    amount: BigInt(transfer.data),
  };
}

async function getLogsChunked(provider, filter, fromBlock, toBlock, chunk) {
  const out = [];
  for (let start = fromBlock; start <= toBlock; start += chunk) {
    const end = Math.min(start + chunk - 1, toBlock);
    try {
      const logs = await provider.getLogs({ ...filter, fromBlock: start, toBlock: end });
      out.push(...logs);
    } catch (e) {
      // Narrow on RPC range limits.
      if (chunk > 500) return getLogsChunked(provider, filter, fromBlock, toBlock, Math.floor(chunk / 4));
      throw e;
    }
  }
  return out;
}

async function main() {
  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const latest = await provider.getBlockNumber();
  const arg = process.argv[2];

  let filter, fromBlock, toBlock, label;
  if (arg && /^0x[0-9a-fA-F]{64}$/.test(arg)) {
    // Precise per-invoice lookup: topics = [MEMO_TOPIC, null, null, invoiceId]
    filter = { address: MEMO_CONTRACT, topics: [MEMO_TOPIC, null, null, arg.toLowerCase()] };
    fromBlock = Math.max(0, latest - 200000);
    toBlock = latest;
    label = `invoiceId ${arg}`;
  } else {
    filter = { address: MEMO_CONTRACT, topics: [MEMO_TOPIC] };
    fromBlock = Math.max(0, latest - 6000);
    toBlock = latest;
    label = `recent window [${fromBlock}, ${toBlock}]`;
  }

  console.log(`Arc Memo indexer (read-only). Memo topic ${MEMO_TOPIC}`);
  console.log(`Scanning ${label}...\n`);

  const logs = await getLogsChunked(provider, filter, fromBlock, toBlock, 2000);
  if (logs.length === 0) {
    console.log("No Memo events found in range.");
    return;
  }

  let count = 0;
  for (const log of logs) {
    const parsed = memoIface.parseLog(log);
    const payer = parsed.args.sender;
    const target = parsed.args.target;
    const invoiceId = parsed.args.memoId;
    const memoText = decodeMemoData(parsed.args.memo);
    const pay = target.toLowerCase() === ARC_USDC.toLowerCase() ? await reconcilePayment(provider, log) : null;

    count += 1;
    console.log(`#${count}  block ${log.blockNumber}  tx ${log.transactionHash}`);
    console.log(`     invoiceId: ${invoiceId}`);
    console.log(`     payer:     ${payer}`);
    if (pay) {
      console.log(`     paid:      ${Number(pay.amount) / 10 ** ARC_USDC_DECIMALS} USDC -> ${pay.to}`);
    } else {
      console.log(`     target:    ${target} (non-USDC memo)`);
    }
    console.log(`     memoData:  ${typeof memoText === "string" ? `"${memoText}"` : memoText}`);
    console.log();
  }
  console.log(`Reconciled ${count} memo payment(s).`);
}

main().catch((e) => { console.error("Error:", e.message || e); process.exit(1); });
