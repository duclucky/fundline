// Unit test for the PaymentRouterV2 on-chain memo helpers (memo-util.js).
//
// Covers the two correctness-critical pure functions:
//   encodePayInvoiceWithMemo - the hand-rolled ABI encoding of
//     payInvoiceWithMemo(bytes32,address,uint256,bytes) MUST byte-for-byte match
//     ethers' canonical encoding for empty, small, 32-byte-aligned, unaligned, and
//     max-size memos, and MUST reject memos over the 2048-byte cap.
//   buildInvoiceMemoText - only the selected fields appear, in canonical order, and
//     unselected sensitive fields (clientName, items, note) never leak on-chain.
//
// Runs offline: requires memo-util.js (Node export) and ethers (ground truth).
//
// Run: node test_memo_encoding.js

const { ethers } = require("ethers");
const memo = require("./memo-util.js");
const crypto = require("crypto");

const INVOICE_ID = "0x" + "1".repeat(64);
const MERCHANT = "0x" + "b".repeat(40);
const AMOUNT = 10500000n; // 10.50 USDC at 6 decimals

const iface = new ethers.Interface(["function payInvoiceWithMemo(bytes32,address,uint256,bytes)"]);

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

function expectedCalldata(memoText) {
  return iface.encodeFunctionData("payInvoiceWithMemo", [
    INVOICE_ID,
    ethers.getAddress(MERCHANT),
    AMOUNT,
    ethers.toUtf8Bytes(memoText),
  ]);
}

// ---- ABI encoding matches ethers for many memo sizes ----
console.log("encodePayInvoiceWithMemo matches ethers");
const cases = [
  ["empty memo", ""],
  ["short memo", "Fundline invoice INV-1"],
  ["exactly 32 bytes", "x".repeat(32)],
  ["31 bytes (unaligned)", "y".repeat(31)],
  ["33 bytes (spills a word)", "z".repeat(33)],
  ["unicode memo", "Fundline hoa don 10.50 USDC • cam on"],
  ["near max (2000 bytes)", "a".repeat(2000)],
  ["exactly max (2048 bytes)", "m".repeat(2048)],
];
for (const [name, text] of cases) {
  const got = memo.encodePayInvoiceWithMemo({ invoiceId: INVOICE_ID, merchant: MERCHANT, amount: AMOUNT, memoText: text });
  assert(got === expectedCalldata(text), "calldata matches ethers: " + name);
}

// selector is correct
{
  const got = memo.encodePayInvoiceWithMemo({ invoiceId: INVOICE_ID, merchant: MERCHANT, amount: AMOUNT, memoText: "hi" });
  assert(got.slice(0, 10) === "0x53a2a881", "uses payInvoiceWithMemo selector 0x53a2a881");
}

// rejects oversize memo (> MAX_MEMO_BYTES)
{
  let threw = false;
  try {
    memo.encodePayInvoiceWithMemo({ invoiceId: INVOICE_ID, merchant: MERCHANT, amount: AMOUNT, memoText: "q".repeat(2049) });
  } catch (e) {
    threw = true;
  }
  assert(threw, "rejects a memo larger than the 2048-byte cap");
}

// ---- text builder respects field selection ----
console.log("buildInvoiceMemoText field selection");
const invoice = {
  number: "INV-2026-abc123",
  total: 150,
  createdAt: "2026-06-20T14:35:22.000Z",
  dueDate: "2026-06-27T00:00:00.000Z",
  merchantName: "Acme Corp",
  clientName: "John Doe",
  merchantWallet: MERCHANT,
  items: [
    { description: "Widget", quantity: 2, price: 50 },
    { description: "Setup", quantity: 1, price: 50 },
  ],
  note: "Thanks for your business",
};

// empty selection -> empty memo (the "do not attach" choice)
assert(memo.buildInvoiceMemoText(invoice, []) === "", "no fields selected -> empty memo");

// safe-only selection: includes number/total/dates/merchant, excludes sensitive
{
  const text = memo.buildInvoiceMemoText(invoice, ["number", "total", "createdAt", "dueDate", "merchantName"]);
  assert(text.includes("INV-2026-abc123"), "safe memo includes invoice number");
  assert(text.includes("150.00 USDC"), "safe memo includes total formatted to 2 decimals");
  assert(text.includes("issued 2026-06-20"), "safe memo includes issue date (UTC)");
  assert(text.includes("due 2026-06-27"), "safe memo includes due date (UTC)");
  assert(text.includes("Acme Corp"), "safe memo includes merchant name");
  assert(!text.includes("John Doe"), "safe memo does NOT leak client name");
  assert(!text.includes("Widget"), "safe memo does NOT leak line items");
  assert(!text.includes("Thanks"), "safe memo does NOT leak the note");
}

// sensitive fields only appear when explicitly selected
{
  const text = memo.buildInvoiceMemoText(invoice, ["clientName", "items", "note"]);
  assert(text.includes("to John Doe"), "client name appears when selected");
  assert(text.includes("2x Widget @50"), "line items appear when selected");
  assert(text.includes("note: Thanks for your business"), "note appears when selected");
}

// unknown keys are dropped (whitelist)
{
  const text = memo.buildInvoiceMemoText(invoice, ["number", "evilField", "__proto__"]);
  assert(text === "Fundline | invoice INV-2026-abc123", "unknown keys ignored, only number kept");
}

// canonical order is stable regardless of input order
{
  const a = memo.buildInvoiceMemoText(invoice, ["total", "number"]);
  const b = memo.buildInvoiceMemoText(invoice, ["number", "total"]);
  assert(a === b, "field order in selection does not change memo output");
  assert(a.indexOf("invoice INV") < a.indexOf("USDC"), "number comes before total in canonical order");
}

// hash commitment: deterministic, matches an independent SHA-256 of the canonical form
{
  const canonical = memo.canonicalInvoiceForHash(invoice);
  const hashHex = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
  const text = memo.buildInvoiceMemoText(invoice, ["number", "hash"], hashHex);
  assert(text.includes("commit:" + hashHex), "hash field appends the SHA-256 commitment");
  // hash selected but no hash provided -> no commit fragment
  const noHash = memo.buildInvoiceMemoText(invoice, ["number", "hash"]);
  assert(!noHash.includes("commit:"), "hash field omitted when no hash is supplied");
}

// ---- summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
