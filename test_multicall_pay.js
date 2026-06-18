"use strict";

// Unit test for Multicall3From calldata encoding.
// Verifies that encodeMulticall3Batch produces correctly ABI-encoded
// aggregate3((address,bool,bytes)[]) calldata for [approve, payInvoice].
//
// Checks: selector, outer offset, array length, per-element offsets, tuple
// structure (target, allowFailure=false, bytes offset=96), callData content,
// and that amounts use 6 decimals (not 18).
//
// Run: node test_multicall_pay.js

// --- Constants (mirrors app.js) ---
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const PAYMENT_ROUTER_PAY_SELECTOR = "0xe1a9ef45";
const MULTICALL3FROM_ADDRESS = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";
const MULTICALL3_AGGREGATE3_SELECTOR = "0x82ad56cb";
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const ROUTER_ADDRESS = "0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24";
const ARC_USDC_DECIMALS = 6;

// --- Helpers (mirrors app.js) ---
function normalizeAddress(value) {
  const text = String(value || "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(text) ? text : "";
}

function normalizeBytes32(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : "";
}

function encodeAddress(value) {
  const address = normalizeAddress(value);
  if (!address) throw new Error("Invalid wallet or contract address.");
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function encodeBytes32(value) {
  const bytes = normalizeBytes32(value);
  if (!bytes) throw new Error("Invalid bytes32 value.");
  return bytes.replace(/^0x/, "").toLowerCase();
}

function encodeUint256(value) {
  const amount = typeof value === "bigint" ? value : BigInt(String(value || "0"));
  if (amount < 0n) throw new Error("Amount cannot be negative.");
  return amount.toString(16).padStart(64, "0");
}

function parseTokenUnits(value, decimals) {
  const normalizedDecimals = Math.min(Math.max(Number(decimals) || 0, 0), 18);
  const text = String(value || "0").replace(/,/g, "").trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(whole) * 10n ** BigInt(normalizedDecimals) + BigInt(fraction || "0");
}

// --- Implementation under test (mirrors app.js encodeMulticall3Batch) ---
function encodeMulticall3Batch(calls) {
  const N = calls.length;
  if (N === 0) throw new Error("Multicall3 batch cannot be empty.");
  const callDatas = calls.map((c) => {
    const hex = String(c.callData || "").replace(/^0x/, "").toLowerCase();
    if (hex.length % 2 !== 0) throw new Error("callData hex length must be even.");
    const byteLen = hex.length / 2;
    const padLen = byteLen === 0 ? 0 : Math.ceil(byteLen / 32) * 32;
    return { hex, byteLen, padLen };
  });
  const callSizes = callDatas.map((cd) => 128 + cd.padLen);
  const baseOffset = N * 32;
  const callOffsets = [];
  let cumSize = 0;
  for (let i = 0; i < N; i++) {
    callOffsets.push(baseOffset + cumSize);
    cumSize += callSizes[i];
  }
  let arrayHex = encodeUint256(BigInt(N));
  for (let i = 0; i < N; i++) {
    arrayHex += encodeUint256(BigInt(callOffsets[i]));
  }
  for (let i = 0; i < N; i++) {
    const cd = callDatas[i];
    arrayHex += encodeAddress(calls[i].target);
    arrayHex += encodeUint256(0n);
    arrayHex += encodeUint256(96n);
    arrayHex += encodeUint256(BigInt(cd.byteLen));
    arrayHex += cd.hex.padEnd(cd.padLen * 2, "0");
  }
  return MULTICALL3_AGGREGATE3_SELECTOR + encodeUint256(32n) + arrayHex;
}

// --- Test runner ---
let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    passed++;
  } else {
    console.error(`FAIL: ${label}`);
    failed++;
  }
}

function assertEqual(actual, expected, label) {
  if (actual === expected) {
    passed++;
  } else {
    console.error(`FAIL: ${label}`);
    console.error(`  expected: ${String(expected).slice(0, 80)}`);
    console.error(`  actual:   ${String(actual).slice(0, 80)}`);
    failed++;
  }
}

// --- Fixtures ---
const MERCHANT_WALLET = "0xabcdef1234567890abcdef1234567890abcdef12";
const INVOICE_ID = "0x" + "a1".repeat(32); // 32-byte invoice ID
const AMOUNT_TEXT = "10.50"; // 10.50 USDC
const AMOUNT_UNITS = parseTokenUnits(AMOUNT_TEXT, ARC_USDC_DECIMALS);

// Build calldata the same way app.js does
const invoiceBytes = normalizeBytes32(INVOICE_ID);
const approveCallData =
  ERC20_APPROVE_SELECTOR +
  encodeAddress(ROUTER_ADDRESS) +
  encodeUint256(AMOUNT_UNITS);
const payCallData =
  PAYMENT_ROUTER_PAY_SELECTOR +
  encodeBytes32(invoiceBytes) +
  encodeAddress(MERCHANT_WALLET) +
  encodeUint256(AMOUNT_UNITS);

const calls = [
  { target: USDC_ADDRESS, callData: approveCallData },
  { target: ROUTER_ADDRESS, callData: payCallData },
];

const encoded = encodeMulticall3Batch(calls);
const hex = encoded.slice(2); // strip leading 0x

// Helper: read a 32-byte word (64 hex chars) at byte offset in the hex string.
// byteOffset is from the start of calldata (after selector).
function wordAt(byteOffset) {
  const charOffset = (byteOffset - 4) * 2; // subtract 4 for selector
  return hex.slice(charOffset + 8, charOffset + 72); // 8 chars = 4-byte selector already in hex
}
// Better helper: index directly in hex by char offset past the selector.
function word(charOffset) {
  return hex.slice(8 + charOffset, 8 + charOffset + 64);
}

// --- Tests ---

// 1. Selector
assertEqual(encoded.slice(0, 10), MULTICALL3_AGGREGATE3_SELECTOR, "selector is aggregate3");

// 2. Outer offset = 0x20 (32)
assertEqual(word(0), "0000000000000000000000000000000000000000000000000000000000000020", "outer offset = 32");

// 3. Array length = 2 (starts at char offset 64 in hex after selector)
assertEqual(word(64), "0000000000000000000000000000000000000000000000000000000000000002", "array length = 2");

// 4. approveCallData uses 6 decimals (10.50 USDC = 10500000 = 0xa037a0)
assertEqual(AMOUNT_UNITS, 10500000n, "amount = 10500000 (6 decimals, not 18)");
assert(AMOUNT_UNITS < 10n ** 12n, "amount is well below 18-decimal range");

// 5. The calldata for approve contains the correct selector
assert(approveCallData.startsWith(ERC20_APPROVE_SELECTOR), "approve callData starts with approve selector");

// 6. The calldata for payInvoice contains the correct selector
assert(payCallData.startsWith(PAYMENT_ROUTER_PAY_SELECTOR), "payInvoice callData starts with pay selector");

// 7. approveCallData length: 4 + 32 + 32 = 68 bytes
const approveHex = approveCallData.replace(/^0x/, "");
assertEqual(approveHex.length / 2, 68, "approveCallData is 68 bytes");

// 8. payCallData length: 4 + 32 + 32 + 32 = 100 bytes
const payHex = payCallData.replace(/^0x/, "");
assertEqual(payHex.length / 2, 100, "payCallData is 100 bytes");

// 9. Offsets from start of head section (after length word, per ABI spec):
// N=2, base = N*32 = 64. callSize[0] = 128 + ceil(68/32)*32 = 128 + 96 = 224
// offset[0] = 64, offset[1] = 64 + 224 = 288 = 0x120
const off0 = word(64 + 64);  // first element offset (after length word, at char 128 from array start)
const off1 = word(64 + 128); // second element offset
assertEqual(off0, "0000000000000000000000000000000000000000000000000000000000000040", "call[0] offset = 64 (0x40)");
assertEqual(off1, "0000000000000000000000000000000000000000000000000000000000000120", "call[1] offset = 288 (0x120)");

// 10. call[0] allowFailure = false (slot 1 of tuple, at 96+32=128 bytes into array data)
// Array data starts at char 128 (array offset=32, array starts at 32 bytes into calldata-after-selector = char 64,
// then +64 chars for length word = char 128... let me reason differently.
// Full hex structure after selector (each "word" = 64 hex chars):
//   word[0]  : outer offset = 32
//   word[1]  : array offset start -> actually the array encoding starts here (word index 1)
//   word[1]  (char 64): array length = 2
//   word[2]  (char 128): offset to call[0]
//   word[3]  (char 192): offset to call[1]
//   word[4]  (char 256): call[0] target  <- array data starts at char 64 + 96 bytes*2 = char 64+192=256
//   word[5]  (char 320): call[0] allowFailure
//   word[6]  (char 384): call[0] bytes offset (96)
//   word[7]  (char 448): call[0] bytes length
//   word[8+] (char 512+): call[0] bytes data (padded to 96 bytes = 192 chars)
//   ...
// Array data (call tuples) begins at char offset: 64 (array length word) + 2*64 (2 offset words) = 192 chars into array hex
// Plus the outer-offset word at char 0..63 = total char offset from selector = 64 + 192 = 256.
const call0Start = 64 + 192; // char offset of call[0] tuple from start of hex after selector
const call0AllowFailure = word(call0Start + 64); // slot 1 of tuple
assertEqual(call0AllowFailure, "0000000000000000000000000000000000000000000000000000000000000000", "call[0] allowFailure = false");

const call1Start = call0Start + (128 + Math.ceil(68 / 32) * 32) * 2; // call[0] size in chars
const call1AllowFailure = word(call1Start + 64);
assertEqual(call1AllowFailure, "0000000000000000000000000000000000000000000000000000000000000000", "call[1] allowFailure = false");

// 11. call[0] bytes offset within tuple = 96 (0x60)
const call0BytesOffset = word(call0Start + 128);
assertEqual(call0BytesOffset, "0000000000000000000000000000000000000000000000000000000000000060", "call[0] bytes offset within tuple = 96");

// 12. call[0] target = USDC address
const call0Target = word(call0Start);
assertEqual(call0Target, "0000000000000000000000003600000000000000000000000000000000000000", "call[0] target = USDC address");

// 13. call[1] target = PaymentRouter address
const call1Target = word(call1Start);
assertEqual(call1Target, "0000000000000000000000007f3bcf33711f981e2d67870d5cdb5503f01e1a24", "call[1] target = PaymentRouter address");

// 14. call[0] bytes length = 68
const call0BytesLen = word(call0Start + 192);
assertEqual(BigInt("0x" + call0BytesLen), 68n, "call[0] callData length = 68 bytes");

// 15. call[1] bytes length = 100
const call1BytesLen = word(call1Start + 192);
assertEqual(BigInt("0x" + call1BytesLen), 100n, "call[1] callData length = 100 bytes");

// 16. MULTICALL3FROM_ADDRESS is a valid address (sanity check)
assert(/^0x[0-9a-fA-F]{40}$/.test(MULTICALL3FROM_ADDRESS), "MULTICALL3FROM_ADDRESS has correct format");
assertEqual(MULTICALL3FROM_ADDRESS.toLowerCase(), "0x522faf9a91c41c443c66765030741e4aace147d0", "MULTICALL3FROM_ADDRESS matches plan");

// 17. Empty batch throws
let threw = false;
try { encodeMulticall3Batch([]); } catch (e) { threw = true; }
assert(threw, "empty batch throws");

// 18. Odd-length callData throws
threw = false;
try { encodeMulticall3Batch([{ target: USDC_ADDRESS, callData: "0xabc" }]); } catch (e) { threw = true; }
assert(threw, "odd-length callData throws");

// 19. callData with no 0x prefix also works (strips cleanly)
const noPrefixResult = encodeMulticall3Batch([{ target: USDC_ADDRESS, callData: "095ea7b3" + "0".repeat(128) }]);
assert(noPrefixResult.startsWith(MULTICALL3_AGGREGATE3_SELECTOR), "no-prefix callData encodes without error");

// 20. Encoded calldata starts with 0x
assert(encoded.startsWith("0x"), "result starts with 0x");

// 21. Total calldata length sanity check:
// 4 (selector) + 32 (outer offset) + [32 (len) + 2*32 (offsets) + 224 (call0) + 256 (call1)] = 4 + 32 + 576 = 612 bytes
// call0: 96 head + 32 len + 96 padded(68) = 224 bytes
// call1: 96 head + 32 len + 128 padded(100) = 256 bytes
const expectedBytes = 4 + 32 + 32 + 2 * 32 + 224 + 256;
assertEqual(encoded.length, 2 + expectedBytes * 2, `encoded calldata is ${expectedBytes} bytes`);

// --- Result ---
console.log(`\nMulticall3From encoding: ${passed} passed, ${failed} failed.`);
if (failed > 0) process.exit(1);
