// Unit test for the FundlineBatchRouter ABI encoders (batch-util.js).
//
// The payBatch / payBatchWithMemo calldata is hand-rolled (dynamic arrays, and an array
// of dynamic bytes for the memo variant). This locks that encoding byte-for-byte against
// ethers' canonical encoding across batch sizes and memo shapes, and checks the guard
// rails (length mismatch, empty, oversize batch, oversize memo).
//
// Run: node test_batch_router.js

const { ethers } = require("ethers");
const batch = require("./batch-util.js");

const BATCH_ID = "0x" + "9".repeat(64);
const A = (n) => "0x" + String(n).repeat(40).slice(0, 40);
const R1 = "0x" + "a".repeat(40);
const R2 = "0x" + "b".repeat(40);
const R3 = "0x" + "c".repeat(40);

const ifacePlain = new ethers.Interface(["function payBatch(bytes32,address[],uint256[])"]);
const ifaceMemo = new ethers.Interface(["function payBatchWithMemo(bytes32,address[],uint256[],bytes[])"]);

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

function expectedPlain(recipients, amounts) {
  return ifacePlain.encodeFunctionData("payBatch", [BATCH_ID, recipients.map(ethers.getAddress), amounts]);
}
function expectedMemo(recipients, amounts, memos) {
  return ifaceMemo.encodeFunctionData("payBatchWithMemo", [
    BATCH_ID,
    recipients.map(ethers.getAddress),
    amounts,
    memos.map((m) => ethers.toUtf8Bytes(m)),
  ]);
}

// ---- payBatch matches ethers ----
console.log("encodePayBatch matches ethers");
{
  const cases = [
    ["1 recipient", [R1], [1000000n]],
    ["3 recipients", [R1, R2, R3], [1000000n, 2500000n, 999n]],
    ["10 recipients", Array.from({ length: 10 }, (_, i) => A(i % 9 + 1)), Array.from({ length: 10 }, (_, i) => BigInt((i + 1) * 1000))],
  ];
  for (const [name, recipients, amounts] of cases) {
    const got = batch.encodePayBatch({ batchId: BATCH_ID, recipients, amounts });
    assert(got === expectedPlain(recipients, amounts), "payBatch calldata matches ethers: " + name);
  }
  const sel = batch.encodePayBatch({ batchId: BATCH_ID, recipients: [R1], amounts: [1n] }).slice(0, 10);
  assert(sel === "0x4ae7161f", "payBatch uses selector 0x4ae7161f");
}

// ---- payBatchWithMemo matches ethers ----
console.log("encodePayBatchWithMemo matches ethers");
{
  const cases = [
    ["1 item short memo", [R1], [1000000n], ["Salary March 2026"]],
    ["3 items mixed memos", [R1, R2, R3], [1000000n, 2000000n, 3000000n], ["Salary - Alice", "", "Bonus 32-byte aligned memo here!"]],
    ["unicode memo", [R1], [500000n], ["Luong thang 3 - Nguyen Van A"]],
    ["max-size memo", [R1], [1n], ["m".repeat(256)]],
  ];
  for (const [name, recipients, amounts, memos] of cases) {
    const got = batch.encodePayBatchWithMemo({ batchId: BATCH_ID, recipients, amounts, memos });
    assert(got === expectedMemo(recipients, amounts, memos), "payBatchWithMemo calldata matches ethers: " + name);
  }
  const sel = batch.encodePayBatchWithMemo({ batchId: BATCH_ID, recipients: [R1], amounts: [1n], memos: [""] }).slice(0, 10);
  assert(sel === "0xb4199844", "payBatchWithMemo uses selector 0xb4199844");
}

// ---- guard rails ----
console.log("guard rails");
function throws(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}
assert(throws(() => batch.encodePayBatch({ batchId: BATCH_ID, recipients: [R1, R2], amounts: [1n] })), "rejects recipients/amounts length mismatch");
assert(throws(() => batch.encodePayBatch({ batchId: BATCH_ID, recipients: [], amounts: [] })), "rejects empty batch");
assert(throws(() => batch.encodePayBatchWithMemo({ batchId: BATCH_ID, recipients: [R1], amounts: [1n], memos: [] })), "rejects memos length mismatch");
assert(throws(() => batch.encodePayBatchWithMemo({ batchId: BATCH_ID, recipients: [R1], amounts: [1n], memos: ["x".repeat(257)] })), "rejects a memo over 256 bytes");
assert(throws(() => batch.encodePayBatch({ batchId: BATCH_ID, recipients: ["0xnothex"], amounts: [1n] })), "rejects an invalid recipient address");
{
  const big = Array.from({ length: 257 }, () => R1);
  assert(throws(() => batch.encodePayBatch({ batchId: BATCH_ID, recipients: big, amounts: big.map(() => 1n) })), "rejects a batch over MAX_BATCH (256)");
}

// ---- summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
