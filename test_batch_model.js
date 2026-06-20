// Unit test for the batch payout server model (server.js normalizeBatch /
// normalizeBatchItem). Locks the validation rules and the exact total/count math the
// verify step relies on. Runs offline (FUNDLINE_NO_LISTEN), no network, no disk writes
// (only the pure normalizers are exercised; createBatchRecord, which writes to disk, is
// covered by the live API).
//
// Run: node test_batch_model.js

process.env.FUNDLINE_NO_LISTEN = "1";
const server = require("./server.js");
const { normalizeBatch, normalizeBatchItem } = server;

const CREATOR = "0x" + "a".repeat(40);
const R1 = "0x" + "b".repeat(40);
const R2 = "0x" + "c".repeat(40);

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ok   -", msg);
  } else {
    failed++;
    console.error("  FAIL -", msg);
  }
}
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

// ---- normalizeBatchItem ----
console.log("normalizeBatchItem");
{
  const item = normalizeBatchItem({ recipientName: "Alice", recipientWallet: R1, amount: "10.5", reference: "Salary March", email: "a@x.com" });
  assert(item.recipientWallet === R1, "keeps a valid recipient wallet");
  assert(item.amount === 10.5, "parses amount");
  assert(item.reference === "Salary March", "keeps reference");
  assert(throws(() => normalizeBatchItem({ recipientWallet: "0xnope", amount: 1 })), "rejects an invalid wallet");
  assert(throws(() => normalizeBatchItem({ recipientWallet: R1, amount: 0 })), "rejects amount 0");
  assert(throws(() => normalizeBatchItem({ recipientWallet: R1, amount: -5 })), "rejects negative amount");
  assert(throws(() => normalizeBatchItem({ recipientWallet: R1, amount: 1e13 })), "rejects an absurdly large amount");
  // comma thousands separator tolerated
  assert(normalizeBatchItem({ recipientWallet: R1, amount: "1,000" }).amount === 1000, "tolerates comma thousands separators");
}

// ---- normalizeBatch ----
console.log("normalizeBatch");
{
  const batch = normalizeBatch({
    creatorWallet: CREATOR,
    items: [
      { recipientWallet: R1, amount: 10 },
      { recipientWallet: R2, amount: 2.5 },
      { recipientWallet: R1, amount: 0.999999 },
    ],
  });
  assert(batch.count === 3, "count equals the number of items");
  assert(batch.totalUnits === "13499999", "totalUnits is the exact 6-decimal sum (13.499999 USDC)");
  assert(Math.abs(batch.total - 13.499999) < 1e-9, "total mirrors totalUnits in USDC");
  assert(/^[a-f0-9]{20}$/.test(batch.id), "assigns a 20-hex id");
  assert(batch.status === "open", "new batch is open");
  assert(batch.onchainBatchId === "", "no onchainBatchId until createBatchRecord assigns one");

  assert(throws(() => normalizeBatch({ creatorWallet: CREATOR, items: [] })), "rejects an empty batch");
  assert(throws(() => normalizeBatch({ items: [{ recipientWallet: R1, amount: 1 }] })), "rejects a missing creator wallet");
  const big = Array.from({ length: 257 }, () => ({ recipientWallet: R1, amount: 1 }));
  assert(throws(() => normalizeBatch({ creatorWallet: CREATOR, items: big })), "rejects a batch over 256 recipients");
}

// onchainBatchId is normalized (lowercased 0x form) when supplied
{
  const id = "0x" + "F".repeat(64);
  const batch = normalizeBatch({ creatorWallet: CREATOR, onchainBatchId: id, items: [{ recipientWallet: R1, amount: 1 }] });
  assert(batch.onchainBatchId === "0x" + "f".repeat(64), "normalizes a supplied onchainBatchId to lowercase");
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
