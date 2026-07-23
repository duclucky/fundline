# Invoice Verification Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make invoice verification transaction-first, bounded, and fast without weakening PaymentRouter reference matching, canonical USDC checks, or transaction reuse protection.

**Architecture:** Split receipt inspection from lookup orchestration so transaction-hash verification reads one receipt and never falls into recent-history scans. Bound no-hash discovery to two pages and twenty router candidates. Add a small browser/CommonJS polling helper for immediate checks, ten-second request timeouts, two-second retries, and a sixty-second wall-clock deadline.

**Tech Stack:** Node.js 20, CommonJS, vanilla browser JavaScript, Arc JSON-RPC, Arcscan REST, standalone Node tests.

## Global Constraints

- PaymentRouter `InvoicePaid` remains the highest-priority proof.
- A router transaction with a conflicting invoice reference must not be downgraded into an unreferenced direct transfer.
- Canonical ERC-20 USDC uses six decimals; native Arc USDC keeps its existing explicit decimal handling.
- Wrong asset, payer, recipient, amount, reverted receipt, stale payment, or reused `(chainId, txHash)` must remain rejected.
- Client timeout does not mean on-chain failure and must not trigger another payment.
- Preserve unrelated worktree changes in `workflow-mcp-tools.js` and `test_workflow_mcp_tools.js`.

---

### Task 1: Transaction-Scoped Receipt Inspection

**Files:**
- Modify: `server.js:4344-4421`
- Modify: `server.js:897-929`
- Create: `test_payment_verification_lookup.js`

**Interfaces:**
- Produces: `inspectPaymentReceipt(receipt, criteria) -> { routerMatch, directMatch, routerConflict }`.
- Produces: `findArcPayment(criteria, lookupOverrides = {}) -> payment | null`.
- Consumes: existing `findInvoicePaidLog`, `findUsdcTransferLog`, token-by-tx, native-by-tx, and recent lookup functions.

- [ ] **Step 1: Write the failing txHash strategy tests**

Create `test_payment_verification_lookup.js` with `FUNDLINE_NO_LISTEN=1`. Build a lookup override
object whose functions append their names to `calls`. Add:

```js
const assert = require("assert");
process.env.FUNDLINE_NO_LISTEN = "1";
const server = require("./server");

const TX = "0x" + "1".repeat(64);
const criteria = {
  txHash: TX,
  payerWallet: "0x" + "a".repeat(40),
  merchantWallet: "0x" + "b".repeat(40),
  amount: "10",
  onchainInvoiceId: "0x" + "2".repeat(64),
  requireInvoiceReference: true,
};

async function run() {
  let calls = [];
  const routerMatch = { source: "rpc_payment_router_event", txHash: TX };
  let result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch, directMatch: null, routerConflict: false };
    },
    findTokenTransferByTx: async () => { calls.push("tokenByTx"); return null; },
    findNativeTransferByTx: async () => { calls.push("nativeByTx"); return null; },
    findRecentTokenTransfer: async () => { calls.push("recentToken"); return null; },
    findRecentNativeTransfer: async () => { calls.push("recentNative"); return null; },
  });
  assert.equal(result, routerMatch);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  const directMatch = { source: "rpc_usdc_transfer_log", txHash: TX };
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch, routerConflict: false };
    },
    findTokenTransferByTx: async () => { calls.push("tokenByTx"); return null; },
    findNativeTransferByTx: async () => { calls.push("nativeByTx"); return null; },
    findRecentTokenTransfer: async () => { calls.push("recentToken"); return null; },
    findRecentNativeTransfer: async () => { calls.push("recentNative"); return null; },
  });
  assert.equal(result, directMatch);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch, routerConflict: true };
    },
    findTokenTransferByTx: async () => { calls.push("tokenByTx"); return null; },
    findNativeTransferByTx: async () => { calls.push("nativeByTx"); return null; },
    findRecentTokenTransfer: async () => { calls.push("recentToken"); return null; },
    findRecentNativeTransfer: async () => { calls.push("recentNative"); return null; },
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch: null, routerConflict: false };
    },
    findTokenTransferByTx: async () => { calls.push("tokenByTx"); return null; },
    findNativeTransferByTx: async () => { calls.push("nativeByTx"); return null; },
    findRecentTokenTransfer: async () => { calls.push("recentToken"); return null; },
    findRecentNativeTransfer: async () => { calls.push("recentNative"); return null; },
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ["receipt", "tokenByTx", "nativeByTx"]);
}

run().then(() => console.log("PASS: payment verification lookup")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the lookup test and verify RED**

```powershell
node test_payment_verification_lookup.js
```

Expected: FAIL because `findArcPayment` is not exported and has no injectable lookup boundary.

- [ ] **Step 3: Implement pure receipt inspection**

Add:

```js
function inspectPaymentReceipt(receipt, criteria) {
  if (!receipt || String(receipt.status || "").toLowerCase() !== "0x1") {
    return { routerMatch: null, directMatch: null, routerConflict: false };
  }
  const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
  const routerMatchLog = findInvoicePaidLog(logs, criteria);
  const transferMatchLog = findUsdcTransferLog(logs, criteria);
  const hasRouterEvent = logs.map(normalizeReceiptLog).some((log) =>
    sameAddress(log.address, ARC_PAYMENT_ROUTER_ADDRESS) && log.topics[0] === INVOICE_PAID_TOPIC
  );
  const base = {
    txHash: criteria.txHash,
    explorerUrl: `${ARCSCAN_EXPLORER_BASE}/tx/${criteria.txHash}`,
    from: criteria.payerWallet,
    to: criteria.merchantWallet,
    timestamp: "",
    blockNumber: hexToNumber(receipt.blockNumber),
    tokenSymbol: "USDC",
    tokenAddress: ARC_USDC_TOKEN_ADDRESS,
  };
  const routerMatch = routerMatchLog && transferMatchLog ? {
    ...base,
    source: "rpc_payment_router_event",
    rawAmount: String(routerMatchLog.amount),
    onchainInvoiceId: criteria.onchainInvoiceId,
    referenceVerified: true,
    transferVerified: true,
  } : null;
  const directMatch = transferMatchLog ? {
    ...base,
    source: "rpc_usdc_transfer_log",
    rawAmount: String(transferMatchLog.amount),
    onchainInvoiceId: "",
    referenceVerified: false,
    transferVerified: true,
  } : null;
  return {
    routerMatch,
    directMatch,
    routerConflict: Boolean(criteria.requireInvoiceReference && hasRouterEvent && !routerMatchLog),
  };
}

async function inspectPaymentInRpcReceipt(criteria) {
  if (!criteria.txHash || !ARC_RPC_URL) {
    return { routerMatch: null, directMatch: null, routerConflict: false };
  }
  try {
    return inspectPaymentReceipt(
      await rpcRequest("eth_getTransactionReceipt", [criteria.txHash]),
      criteria,
    );
  } catch {
    return { routerMatch: null, directMatch: null, routerConflict: false };
  }
}
```

Keep `findPaymentInRpcReceipt` as a compatibility wrapper that selects `routerMatch` when
`requireInvoiceReference` is true and otherwise returns `routerMatch || directMatch`.
Do not swallow request timeouts: assign `error.code = "rpc_timeout"` when the RPC request
times out and rethrow it. Apply the same rule to transaction-scoped Arcscan lookups with
`error.code = "explorer_timeout"`. Non-timeout not-found responses still return `null`.

- [ ] **Step 4: Make txHash orchestration terminal**

Change `findArcPayment(criteria, lookupOverrides = {})` to resolve its operations from overrides.
For `criteria.txHash`, run exactly:

```js
const inspection = await lookups.inspectPaymentInRpcReceipt(criteria);
if (inspection.routerMatch) return inspection.routerMatch;
if (inspection.routerConflict) return null;
if (inspection.directMatch) return inspection.directMatch;
const tokenByTx = await lookups.findTokenTransferByTx(criteria);
if (tokenByTx) return tokenByTx;
const nativeByTx = await lookups.findNativeTransferByTx(criteria);
if (nativeByTx) return nativeByTx;
return null;
```

Only the no-hash branch may invoke recent-list lookups. Export `findArcPayment` and
`inspectPaymentReceipt`.

In `handleVerifyPayment`, return HTTP 504 with the stable `error.code` for
`rpc_timeout` or `explorer_timeout`. Keep the invoice unpaid and let the browser retain the
transaction hash. Other unexpected errors retain the existing HTTP 500 behavior.

- [ ] **Step 5: Run lookup and payment matcher tests**

```powershell
node test_payment_verification_lookup.js
node test_native_transfer_fallback.js
node test_amount_units.js
```

Expected: all pass.

- [ ] **Step 6: Commit the transaction fast path**

```powershell
git add server.js test_payment_verification_lookup.js
git commit -m "Bound invoice verification by transaction"
```

### Task 2: Bounded No-Hash Router Discovery

**Files:**
- Modify: `server.js:483-488`
- Modify: `server.js:4410-4480`
- Modify: `test_payment_verification_lookup.js`

**Interfaces:**
- Produces: `selectRecentRouterCandidates(transactions, criteria, limit) -> transaction[]`.
- Consumes: `findRecentReferencedPayment`, `fetchArcscanItems`, and `inspectPaymentInRpcReceipt`.

- [ ] **Step 1: Add failing candidate-selection assertions**

Add:

```js
const ROUTER = server.ARC_PAYMENT_ROUTER_ADDRESS;
const candidateCriteria = {
  payerWallet: criteria.payerWallet,
  createdAt: new Date("2026-07-23T00:00:00.000Z"),
};
const recent = Array.from({ length: 30 }, (_, index) => ({
  hash: "0x" + String(index + 10).padStart(64, "0"),
  from: { hash: candidateCriteria.payerWallet },
  to: { hash: ROUTER },
  timestamp: "2026-07-23T00:00:30.000Z",
}));
recent.push({
  hash: "0x" + "f".repeat(64),
  from: { hash: candidateCriteria.payerWallet },
  to: { hash: "0x" + "c".repeat(40) },
  timestamp: "2026-07-23T00:00:30.000Z",
});
const selected = server.selectRecentRouterCandidates(recent, candidateCriteria, 20);
assert.equal(selected.length, 20);
assert.equal(selected.every((item) => server.normalizeAddress(item.to.hash) === ROUTER), true);
assert.deepEqual(selected.map((item) => item.hash), recent.slice(0, 20).map((item) => item.hash));
```

Also add fixtures for wrong payer, stale timestamp, missing hash, and invalid hash, asserting none
are selected.

- [ ] **Step 2: Run the lookup test and verify RED**

```powershell
node test_payment_verification_lookup.js
```

Expected: FAIL because `selectRecentRouterCandidates` is missing.

- [ ] **Step 3: Implement selection and bounded scanning**

Add constants:

```js
const ARC_VERIFY_RECENT_PAGES = 2;
const ARC_VERIFY_ROUTER_CANDIDATE_LIMIT = 20;
const ARC_VERIFY_RECEIPT_CONCURRENCY = 4;
```

Add:

```js
function selectRecentRouterCandidates(transactions, criteria, limit = ARC_VERIFY_ROUTER_CANDIDATE_LIMIT) {
  return (Array.isArray(transactions) ? transactions : []).filter((transaction) => {
    const txHash = normalizeTxHash(transaction.hash || transaction.transaction_hash);
    const from = normalizeAddress(transaction.from?.hash || transaction.from);
    const to = normalizeAddress(transaction.to?.hash || transaction.to);
    return Boolean(
      txHash
      && sameAddress(from, criteria.payerWallet)
      && sameAddress(to, ARC_PAYMENT_ROUTER_ADDRESS)
      && isRecentEnough(transaction.timestamp, criteria.createdAt)
    );
  }).slice(0, limit);
}
```

Update `findRecentReferencedPayment` to fetch two pages, select at most twenty candidates, and
inspect them in ordered batches of four. For each batch, use `Promise.all`; inspect results in
the original candidate order and return the first `routerMatch`. A `routerConflict` is not a
match. Stop after the first matching batch.

Keep recent token and native fallbacks at no more than two pages each. Export
`selectRecentRouterCandidates` and `ARC_PAYMENT_ROUTER_ADDRESS` for the offline test.

- [ ] **Step 4: Run backend payment regression tests**

```powershell
node test_payment_verification_lookup.js
node test_native_transfer_fallback.js
node test_amount_units.js
node --check server.js
```

Expected: all pass and the lookup test observes no more than twenty receipt candidates.

- [ ] **Step 5: Commit bounded discovery**

```powershell
git add server.js test_payment_verification_lookup.js
git commit -m "Limit invoice payment discovery"
```

### Task 3: Immediate Deadline-Bounded Browser Polling

**Files:**
- Create: `payment-verification.js`
- Create: `test_payment_verification_polling.js`
- Modify: `app.html:447-451`
- Modify: `app.js:647-655`
- Modify: `app.js:1765-1788`
- Modify: `app.js:1997-2019`
- Modify: `app.js:2335-2378`

**Interfaces:**
- Produces: `FundlinePaymentVerification.pollPaymentVerification(options)`.
- Produces: `FundlinePaymentVerification.fetchWithTimeout(fetchImpl, input, init, timeoutMs)`.
- Consumes: `verifyPaymentAndMarkPaid`, `updateInvoiceOnServer`, browser `fetch`, and `AbortController`.

- [ ] **Step 1: Write the failing polling tests**

Create `test_payment_verification_polling.js`:

```js
"use strict";

const assert = require("assert");
const {
  pollPaymentVerification,
  fetchWithTimeout,
} = require("./payment-verification");

async function main() {
  let now = 0;
  const events = [];
  const result = await pollPaymentVerification({
    attempt: async (attempt) => {
      events.push("attempt:" + attempt);
      return attempt === 3;
    },
    wait: async (ms) => {
      events.push("wait:" + ms);
      now += ms;
    },
    now: () => now,
    retryDelayMs: 2000,
    deadlineMs: 60000,
  });
  assert.equal(result.verified, true);
  assert.deepEqual(events, ["attempt:1", "wait:2000", "attempt:2", "wait:2000", "attempt:3"]);

  now = 0;
  let attempts = 0;
  await assert.rejects(() => pollPaymentVerification({
    attempt: async () => {
      attempts += 1;
      const error = new Error("request timed out");
      error.code = "verification_timeout";
      throw error;
    },
    wait: async () => { throw new Error("must not wait after timeout"); },
    now: () => now,
    retryDelayMs: 2000,
    deadlineMs: 60000,
  }), /request timed out/);
  assert.equal(attempts, 1);

  let capturedSignal;
  await assert.rejects(() => fetchWithTimeout(
    (_input, init) => {
      capturedSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    "/slow",
    {},
    5,
  ), /timed out/);
  assert.equal(capturedSignal.aborted, true);
}

main().then(() => console.log("PASS: payment verification polling")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the polling test and verify RED**

```powershell
node test_payment_verification_polling.js
```

Expected: FAIL because `payment-verification.js` does not exist.

- [ ] **Step 3: Implement the browser/CommonJS helper**

Create a dependency-free UMD module exposing:

```js
async function pollPaymentVerification(options) {
  const attempt = options.attempt;
  const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const now = options.now || Date.now;
  const retryDelayMs = Number(options.retryDelayMs) || 2000;
  const deadlineMs = Number(options.deadlineMs) || 60000;
  const startedAt = now();
  let attemptNumber = 0;
  while (now() - startedAt < deadlineMs) {
    attemptNumber += 1;
    if (await attempt(attemptNumber)) return { verified: true, attempts: attemptNumber };
    const remaining = deadlineMs - (now() - startedAt);
    if (remaining <= 0) break;
    await wait(Math.min(retryDelayMs, remaining));
  }
  return { verified: false, attempts: attemptNumber, timedOut: true };
}

async function fetchWithTimeout(fetchImpl, input, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(input, { ...(init || {}), signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      const timeoutError = new Error("Payment verification request timed out.");
      timeoutError.code = "verification_timeout";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
```

Export through `module.exports` in Node and `window.FundlinePaymentVerification` in the browser.

- [ ] **Step 4: Load and integrate the helper**

Load `/payment-verification.js` before `/app.js`. Replace both duplicated ten-second loops with
one call configured as:

```js
return window.FundlinePaymentVerification.pollPaymentVerification({
  attempt: (attempt) => verifyPaymentAndMarkPaid(id, { preventDefault() {} }, {
    payerWallet,
    txHash,
    auto: true,
    showPendingToast: attempt === 1,
  }),
  retryDelayMs: 2000,
  deadlineMs: 60000,
}).then((result) => result.verified);
```

Use `fetchWithTimeout(..., 10000)` for the verification POST and the status PATCH requests.
When `verification_timeout` occurs during auto polling, rethrow it so the polling helper stops.
Keep the transaction hash in the form and show:

```text
Payment was submitted, but verification timed out. Retry verification with the same transaction hash.
```

- [ ] **Step 5: Run browser helper and invoice regression tests**

```powershell
node test_payment_verification_polling.js
node test_payment_verification_lookup.js
node test_native_transfer_fallback.js
node test_amount_units.js
node --check app.js
node --check server.js
```

Expected: all pass, and the polling event order begins with `attempt:1`.

- [ ] **Step 6: Commit browser polling**

```powershell
git add payment-verification.js test_payment_verification_polling.js app.html app.js
git commit -m "Poll invoice verification immediately"
```

### Task 4: Settlement-Integrity Audit and Acceptance

**Files:**
- Review: `server.js`, `app.js`, `payment-verification.js`
- Verify: payment tests

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: independently shippable invoice verification reliability change.

- [ ] **Step 1: Run the full payment verification gate**

```powershell
node test_payment_verification_lookup.js
node test_payment_verification_polling.js
node test_native_transfer_fallback.js
node test_amount_units.js
node test_memo_payment_dryrun.js
node --check app.js
node --check server.js
```

Expected: all offline tests pass. If the dry run is blocked by an external RPC limit, report that
external failure separately and do not treat it as an offline test failure.

- [ ] **Step 2: Re-run the verify-payment-audit checklist**

Confirm from the final diff:

```text
PaymentRouter event priority: preserved
Canonical USDC and exact amount: preserved
(chainId, txHash) reuse guard: preserved
Paid transition idempotency: preserved
CCTP final Arc settlement verification: unchanged
Wrong asset/recipient/amount/reference: rejected
```

- [ ] **Step 3: Review the scoped diff**

```powershell
git diff HEAD~3 -- server.js app.js app.html payment-verification.js test_payment_verification_lookup.js test_payment_verification_polling.js
git status --short
```

Expected: only invoice verification scope plus pre-existing unrelated worktree files.
