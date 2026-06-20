// Unit test for the direct/native USDC transfer verification fallback.
//
// Background: payers who do NOT connect a wallet (e.g. scan the pay-page QR with
// a mobile/exchange wallet) settle with a plain transfer that does NOT go through
// the PaymentRouter, so there is no InvoicePaid event. findArcPayment now accepts
// these via a fallback after the strict router path fails. This test locks in the
// security-critical properties of the two pure matchers that back that fallback:
//
//   findMatchingNativeTransaction (native USDC value, 18 decimals)
//     - EXACT amount match (===), NOT value>=expected: a larger unrelated native
//       transfer to the merchant must never settle a smaller invoice.
//     - rejects wrong payer/recipient, reverted (status "error"), and stale txs.
//     - honors the no-time-bound case (createdAt null) and both Arcscan field
//       shapes ({hash} objects vs bare strings).
//
//   findMatchingTokenTransfer (ERC-20 USDC, 6 decimals)
//     - requires the CANONICAL USDC contract address when configured; a token
//       that merely reports symbol "USDC" must NOT be accepted (spoof guard).
//     - forces the fixed 6-decimal scale for the canonical token rather than
//       trusting explorer-reported decimals.
//
// Runs offline: requires server.js as a module (FUNDLINE_NO_LISTEN), calls the
// exported pure matchers with hand-built Arcscan-shaped fixtures. No network.
//
// Run: node test_native_transfer_fallback.js

process.env.FUNDLINE_NO_LISTEN = "1"; // require server.js without booting the server
const server = require("./server.js");

const { findMatchingNativeTransaction, findMatchingTokenTransfer, amountToUnits } = server;

const PAYER = "0x" + "a".repeat(40);
const MERCHANT = "0x" + "b".repeat(40);
const OTHER = "0x" + "c".repeat(40);
const USDC = "0x3600000000000000000000000000000000000000"; // server default canonical USDC
const FAKE_USDC = "0x" + "d".repeat(40);
const TX1 = "0x" + "1".repeat(64);
const TX2 = "0x" + "2".repeat(64);

const AMOUNT = "10";
const NATIVE_EXACT = amountToUnits(AMOUNT, 18).toString(); // 18-decimal native value
const NATIVE_OVER = amountToUnits("11", 18).toString();
const NATIVE_UNDER = amountToUnits("9", 18).toString();
const TOKEN_EXACT = amountToUnits(AMOUNT, 6).toString(); // 6-decimal ERC-20 value
const TOKEN_AS_18 = amountToUnits(AMOUNT, 18).toString(); // wrong-magnitude value

const NOW = new Date();
const RECENT_TS = new Date().toISOString();
const STALE_TS = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min before now

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

function nativeCriteria(extra) {
  return { payerWallet: PAYER, merchantWallet: MERCHANT, amount: AMOUNT, txHash: "", createdAt: NOW, ...extra };
}
function tokenCriteria(extra) {
  return { payerWallet: PAYER, merchantWallet: MERCHANT, amount: AMOUNT, txHash: "", createdAt: NOW, ...extra };
}

// ---- exports present ----
console.log("exports");
assert(typeof findMatchingNativeTransaction === "function", "findMatchingNativeTransaction is exported");
assert(typeof findMatchingTokenTransfer === "function", "findMatchingTokenTransfer is exported");
assert(typeof amountToUnits === "function", "amountToUnits is exported");

// ---- native matcher ----
console.log("findMatchingNativeTransaction");

// 1. match, object field shape
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, status: "ok", value: NATIVE_EXACT }];
  const m = findMatchingNativeTransaction(txs, nativeCriteria());
  assert(m && m.source === "arcscan_native_transfer", "exact native match returns arcscan_native_transfer");
  assert(m && m.tokenAddress === "native", "native match tokenAddress is 'native'");
  assert(m && m.txHash === TX1, "native match carries the txHash");
}

// 2. match, bare string field shape
{
  const txs = [{ transaction_hash: TX1, from: PAYER, to: MERCHANT, timestamp: RECENT_TS, value: NATIVE_EXACT }];
  const m = findMatchingNativeTransaction(txs, nativeCriteria());
  assert(!!m, "exact native match works with bare string from/to and transaction_hash");
}

// 3. reject wrong recipient
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: OTHER }, timestamp: RECENT_TS, value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects wrong recipient");
}

// 4. reject wrong payer
{
  const txs = [{ hash: TX1, from: { hash: OTHER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects wrong payer");
}

// 5. reject underpayment
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, value: NATIVE_UNDER }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects underpayment");
}

// 6. reject OVERPAYMENT (the critical >= -> === fix)
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, value: NATIVE_OVER }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects OVERPAYMENT (exact match only)");
}

// 7. reject reverted tx
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, status: "error", value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects reverted (status 'error') tx");
}

// 8. reject stale tx (older than createdAt - 5 min)
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: STALE_TS, value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects stale tx (recency window)");
}

// 9. accept stale tx when createdAt is null (no time bound)
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: STALE_TS, value: NATIVE_EXACT }];
  assert(!!findMatchingNativeTransaction(txs, nativeCriteria({ createdAt: null })), "native accepts old tx when createdAt is null");
}

// 10. txHash filter
{
  const txs = [{ hash: TX1, from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria({ txHash: TX2 })) === null, "native skips a tx whose hash != criteria.txHash");
  assert(!!findMatchingNativeTransaction(txs, nativeCriteria({ txHash: TX1 })), "native matches when criteria.txHash equals the tx hash");
}

// 11. reject a match with no usable txHash (defensive: double-spend guard needs it)
{
  const txs = [{ from: { hash: PAYER }, to: { hash: MERCHANT }, timestamp: RECENT_TS, value: NATIVE_EXACT }];
  assert(findMatchingNativeTransaction(txs, nativeCriteria()) === null, "native rejects an otherwise-matching tx that has no hash");
}

// ---- token matcher ----
console.log("findMatchingTokenTransfer");

function tokenTransfer(extra) {
  return {
    from: { hash: PAYER },
    to: { hash: MERCHANT },
    transaction_hash: TX1,
    timestamp: RECENT_TS,
    token: { address: USDC, symbol: "USDC", decimals: 6 },
    total: { value: TOKEN_EXACT, decimals: 6 },
    ...extra,
  };
}

// 1. canonical match
{
  const m = findMatchingTokenTransfer([tokenTransfer()], tokenCriteria());
  assert(m && m.source === "arcscan_token_transfer", "exact ERC-20 USDC match returns arcscan_token_transfer");
  assert(m && m.txHash === TX1, "token match carries the txHash");
}

// 2. reject spoofed token: wrong address but symbol "USDC" (the security fix)
{
  const t = tokenTransfer({ token: { address: FAKE_USDC, symbol: "USDC", decimals: 6 } });
  assert(findMatchingTokenTransfer([t], tokenCriteria()) === null, "token rejects a spoofed contract that only reports symbol 'USDC'");
}

// 3. reject wrong amount
{
  const t = tokenTransfer({ total: { value: amountToUnits("9", 6).toString(), decimals: 6 } });
  assert(findMatchingTokenTransfer([t], tokenCriteria()) === null, "token rejects wrong amount");
}

// 4. reject wrong recipient
{
  const t = tokenTransfer({ to: { hash: OTHER } });
  assert(findMatchingTokenTransfer([t], tokenCriteria()) === null, "token rejects wrong recipient");
}

// 5a. force 6 decimals: explorer lies decimals=18 but a real 6-decimal value still matches
{
  const t = tokenTransfer({ token: { address: USDC, symbol: "USDC", decimals: 18 }, total: { value: TOKEN_EXACT, decimals: 18 } });
  assert(!!findMatchingTokenTransfer([t], tokenCriteria()), "token forces 6 decimals for canonical USDC (ignores lying decimals=18)");
}

// 5b. force 6 decimals: an 18-magnitude value is NOT accepted for the canonical token
{
  const t = tokenTransfer({ token: { address: USDC, symbol: "USDC", decimals: 18 }, total: { value: TOKEN_AS_18, decimals: 18 } });
  assert(findMatchingTokenTransfer([t], tokenCriteria()) === null, "token rejects a wrong-magnitude (18-dec) value for canonical USDC");
}

// ---- summary ----
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
