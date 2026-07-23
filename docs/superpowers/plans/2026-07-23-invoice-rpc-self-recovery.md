# Invoice RPC Self-Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover direct Arc invoice payments from transient wallet RPC 429 errors without resubmitting an ambiguous approval or payment transaction.

**Architecture:** Extend the existing invoice-only `payment-verification.js` browser module with testable RPC fallback and submit-once recovery helpers. Integrate those helpers only into the direct invoice payment call sites in `app.js`; bridge, batch, workflow, MCP, shared wallet, and server behavior remain unchanged.

**Tech Stack:** Plain browser JavaScript, CommonJS-compatible UMD module, Node.js `assert`, EIP-1193 wallet provider, JSON-RPC over `fetch`.

## Global Constraints

- Code, comments, UI copy, and docs are in English.
- Do not use long em dashes or emoji.
- USDC amounts remain 6-decimal integer values.
- Do not change `wallet.js`, `server.js`, contracts, workflows, MCP, batch payment, or bridge behavior.
- Never retry `eth_sendTransaction` after an ambiguous HTTP 429.
- Preserve invoice verification and the existing anti-double-confirm guard.

---

### Task 1: Add invoice RPC fallback and submit-once recovery primitives

**Files:**
- Modify: `payment-verification.js`
- Create: `test_invoice_rpc_recovery.js`

**Interfaces:**
- Consumes: `fetch`-compatible function, RPC endpoint arrays, an invoice transaction submit callback, and an on-chain state check callback.
- Produces:
  - `normalizeRpcUrls(primary, fallbacks): string[]`
  - `isRpcRateLimitError(error): boolean`
  - `rpcRequestWithFallback(options): Promise<any>`
  - `submitInvoiceTransactionOnce(options): Promise<{ status: "submitted", value: any } | { status: "recovered" }>`

- [ ] **Step 1: Write failing tests for endpoint normalization and rate-limit classification**

Create `test_invoice_rpc_recovery.js` with:

```js
"use strict";

const assert = require("assert");
const {
  normalizeRpcUrls,
  isRpcRateLimitError,
  rpcRequestWithFallback,
  submitInvoiceTransactionOnce,
} = require("./payment-verification");

async function main() {
  assert.deepEqual(
    normalizeRpcUrls(
      "https://primary.example",
      ["https://fallback.example", "https://primary.example", "", "ftp://invalid.example"],
    ),
    ["https://primary.example", "https://fallback.example"],
  );

  assert.equal(isRpcRateLimitError(new Error("Non-200 status code: '429'")), true);
  assert.equal(isRpcRateLimitError(Object.assign(new Error("limited"), { status: 429 })), true);
  assert.equal(isRpcRateLimitError(Object.assign(new Error("limited"), { code: -32011 })), true);
  assert.equal(isRpcRateLimitError(new Error("execution reverted")), false);
}

main().then(() => {
  console.log("PASS: invoice RPC recovery");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
node test_invoice_rpc_recovery.js
```

Expected: FAIL because the four new exports do not exist.

- [ ] **Step 3: Add failing tests for safe RPC fallback**

Append inside `main()`:

```js
  const calls = [];
  const fallbackResult = await rpcRequestWithFallback({
    urls: ["https://primary.example", "https://fallback.example"],
    method: "eth_chainId",
    params: [],
    wait: async () => {},
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("primary")) {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: { code: 429, message: "Too many requests" } }),
        };
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({ result: "0x4cef52" }),
      };
    },
  });
  assert.equal(fallbackResult, "0x4cef52");
  assert.deepEqual(calls, ["https://primary.example", "https://fallback.example"]);

  let permanentCalls = 0;
  await assert.rejects(() => rpcRequestWithFallback({
    urls: ["https://primary.example", "https://fallback.example"],
    method: "eth_call",
    params: [],
    wait: async () => {},
    fetchImpl: async () => {
      permanentCalls += 1;
      return {
        ok: true,
        status: 200,
        json: async () => ({ error: { code: 3, message: "execution reverted" } }),
      };
    },
  }), /execution reverted/);
  assert.equal(permanentCalls, 1);
```

- [ ] **Step 4: Add failing tests proving transaction submission happens once**

Append inside `main()`:

```js
  let submitCalls = 0;
  let stateChecks = 0;
  const recovered = await submitInvoiceTransactionOnce({
    submit: async () => {
      submitCalls += 1;
      throw new Error("Non-200 status code: '429'");
    },
    checkState: async () => {
      stateChecks += 1;
      return stateChecks === 2;
    },
    wait: async () => {},
    attempts: 3,
    delayMs: 1,
  });
  assert.deepEqual(recovered, { status: "recovered" });
  assert.equal(submitCalls, 1);
  assert.equal(stateChecks, 2);

  submitCalls = 0;
  await assert.rejects(() => submitInvoiceTransactionOnce({
    submit: async () => {
      submitCalls += 1;
      throw new Error("Non-200 status code: '429'");
    },
    checkState: async () => false,
    wait: async () => {},
    attempts: 2,
    delayMs: 1,
  }), (error) => error.code === "invoice_rpc_submission_unknown");
  assert.equal(submitCalls, 1);

  submitCalls = 0;
  await assert.rejects(() => submitInvoiceTransactionOnce({
    submit: async () => {
      submitCalls += 1;
      throw new Error("execution reverted");
    },
    checkState: async () => {
      throw new Error("must not check permanent failures");
    },
  }), /execution reverted/);
  assert.equal(submitCalls, 1);
```

- [ ] **Step 5: Implement the minimal helpers**

Add these functions inside the `createPaymentVerification` factory:

```js
  function normalizeRpcUrls(primary, fallbacks) {
    const values = [primary, ...(Array.isArray(fallbacks) ? fallbacks : [])];
    return Array.from(new Set(values
      .map((value) => String(value || "").trim())
      .filter((value) => /^https?:\/\//i.test(value))));
  }

  function isRpcRateLimitError(error) {
    const status = Number(error?.status || error?.statusCode);
    const code = Number(error?.code);
    const message = String(error?.message || "").toLowerCase();
    return status === 429
      || code === 429
      || code === -32011
      || message.includes("status code: '429'")
      || message.includes("status code 429")
      || message.includes("too many requests")
      || message.includes("rate limit");
  }

  async function rpcRequestWithFallback(options) {
    const fetchImpl = options.fetchImpl;
    const urls = normalizeRpcUrls("", options.urls);
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    let lastError = new Error("Invoice RPC endpoint is not configured.");

    for (let index = 0; index < urls.length; index += 1) {
      try {
        const response = await fetchImpl(urls[index], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: options.method,
            params: options.params || [],
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.error) {
          const error = new Error(payload.error?.message || `Invoice RPC returned HTTP ${response.status}.`);
          error.status = response.status;
          error.code = payload.error?.code;
          throw error;
        }
        return payload.result;
      } catch (error) {
        lastError = error;
        const transient = isRpcRateLimitError(error)
          || Number(error?.status) >= 500
          || !Number.isFinite(Number(error?.code));
        if (!transient || index === urls.length - 1) throw error;
        await wait(Math.min(250 * (2 ** index), 1000));
      }
    }
    throw lastError;
  }

  async function submitInvoiceTransactionOnce(options) {
    try {
      return { status: "submitted", value: await options.submit() };
    } catch (error) {
      if (!isRpcRateLimitError(error)) throw error;
      const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      const attempts = Math.max(1, Number(options.attempts) || 1);
      const delayMs = Math.max(0, Number(options.delayMs) || 0);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (await options.checkState(attempt)) return { status: "recovered" };
        if (attempt < attempts) await wait(delayMs);
      }
      const unknown = new Error(options.unknownMessage || "The wallet RPC is busy and the transaction status is unknown. Check wallet activity before retrying.");
      unknown.code = "invoice_rpc_submission_unknown";
      unknown.cause = error;
      throw unknown;
    }
  }
```

Add the four functions to the returned API object.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run:

```powershell
node test_invoice_rpc_recovery.js
node test_payment_verification_polling.js
```

Expected: both print `PASS`.

- [ ] **Step 7: Commit the isolated primitives**

```powershell
git add -- payment-verification.js test_invoice_rpc_recovery.js
git commit -m "test: add invoice RPC recovery primitives"
```

### Task 2: Integrate recovery only into direct invoice payment

**Files:**
- Modify: `app.js`
- Modify: `test_invoice_rpc_recovery.js`

**Interfaces:**
- Consumes:
  - `FundlinePaymentVerification.normalizeRpcUrls`
  - `FundlinePaymentVerification.rpcRequestWithFallback`
  - `FundlinePaymentVerification.submitInvoiceTransactionOnce`
- Produces:
  - `getInvoiceRpcUrls(config): string[]`
  - `invoiceRpcCall(config, method, params): Promise<any>`
  - `readInvoiceUsdcAllowance(config, owner, spender): Promise<bigint>`
  - `readInvoiceUsdcDecimals(config): Promise<number>`
  - `waitForInvoiceTx(config, txHash): Promise<object>`
  - direct calls pass `{ invoiceRpcRecovery: true }` to `submitArcPaymentWithProgress`

- [ ] **Step 1: Add a failing scope regression test**

Append to `test_invoice_rpc_recovery.js`:

```js
  const fs = require("fs");
  const appSource = fs.readFileSync("./app.js", "utf8");
  assert.match(
    appSource,
    /submitArcPaymentWithProgress\(invoice, payerWallet, button, progress, \{ invoiceRpcRecovery: true \}\)/,
  );
  assert.match(
    appSource,
    /async function submitArcPaymentWithProgress\(invoice, payerWallet, button, progress, options = \{\}\)/,
  );
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
node test_invoice_rpc_recovery.js
```

Expected: FAIL because the direct invoice option and function signature do not exist.

- [ ] **Step 3: Preserve configured fallback URLs**

In `normalizePublicConfig`, add:

```js
    rpcFallbackUrls: Array.isArray(config.rpcFallbackUrls)
      ? config.rpcFallbackUrls.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
```

This only stores public configuration. No shared call site will consume it.

- [ ] **Step 4: Add invoice-private RPC read helpers**

Place these next to the existing `rpcCall` helper:

```js
function getInvoiceRpcUrls(config) {
  return window.FundlinePaymentVerification.normalizeRpcUrls(
    config.rpcUrl,
    config.rpcFallbackUrls,
  );
}

function invoiceRpcCall(config, method, params) {
  return window.FundlinePaymentVerification.rpcRequestWithFallback({
    fetchImpl: fetch,
    urls: getInvoiceRpcUrls(config),
    method,
    params,
  });
}

async function readInvoiceUsdcAllowance(config, owner, spender) {
  const data = `${ERC20_ALLOWANCE_SELECTOR}${encodeAddress(owner)}${encodeAddress(spender)}`;
  return hexToBigInt(await invoiceRpcCall(
    config,
    "eth_call",
    [{ to: config.usdcTokenAddress, data }, "latest"],
  ));
}

async function readInvoiceUsdcDecimals(config) {
  const result = await invoiceRpcCall(
    config,
    "eth_call",
    [{ to: config.usdcTokenAddress, data: ERC20_DECIMALS_SELECTOR }, "latest"],
  );
  return Number(hexToBigInt(result));
}

async function waitForInvoiceTx(config, txHash) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    await delay(3000);
    const receipt = await invoiceRpcCall(config, "eth_getTransactionReceipt", [txHash]);
    if (!receipt) continue;
    if (receipt.status === "0x0") throw new Error("Transaction reverted on-chain.");
    return receipt;
  }
  throw new Error("Transaction not confirmed after 3 minutes.");
}
```

- [ ] **Step 5: Mark only direct invoice calls as recovery-enabled**

Change the two calls made by `payInvoiceWithWallet` and `_retryDirectPay` to:

```js
await submitArcPaymentWithProgress(
  invoice,
  payerWallet,
  button,
  progress,
  { invoiceRpcRecovery: true },
);
```

Do not change calls made by `bridgeAndPayInvoice` or `_retryBridgePay`.

- [ ] **Step 6: Add submit-once recovery to the shared function behind an explicit option**

Change the signature to:

```js
async function submitArcPaymentWithProgress(invoice, payerWallet, button, progress, options = {}) {
```

At the start, define:

```js
  const invoiceRpcRecovery = options.invoiceRpcRecovery === true;
```

Use invoice reads only when the option is true:

```js
  const onchainDecimals = invoiceRpcRecovery
    ? await readInvoiceUsdcDecimals(config)
    : await readUsdcDecimals(provider, config.usdcTokenAddress);
```

```js
  const allowance = invoiceRpcRecovery
    ? await readInvoiceUsdcAllowance(config, payerWallet, config.paymentRouterAddress)
    : await readUsdcAllowance(provider, config.usdcTokenAddress, payerWallet, config.paymentRouterAddress);
```

For approval, use:

```js
    const approval = invoiceRpcRecovery
      ? await window.FundlinePaymentVerification.submitInvoiceTransactionOnce({
        submit: () => sendUsdcApprove(provider, {
          from: payerWallet,
          token: config.usdcTokenAddress,
          spender: config.paymentRouterAddress,
          amount: amountUnits,
        }),
        checkState: async () => (
          await readInvoiceUsdcAllowance(config, payerWallet, config.paymentRouterAddress)
        ) >= amountUnits,
        attempts: 5,
        delayMs: 2000,
        unknownMessage: "The wallet RPC is busy. The approval status is unknown. Check wallet activity before retrying.",
      })
      : {
        status: "submitted",
        value: await sendUsdcApprove(provider, {
          from: payerWallet,
          token: config.usdcTokenAddress,
          spender: config.paymentRouterAddress,
          amount: amountUnits,
        }),
      };
    if (approval.status === "submitted") {
      setProgressStep(progress, "pay", "active", "Confirming USDC approval...");
      setButtonBusy(button, "Confirming approval...");
      if (invoiceRpcRecovery) {
        await waitForInvoiceTx(config, approval.value);
      } else {
        await waitForArcTx(provider, approval.value);
      }
    }
```

For the payment submission, use:

```js
  const payment = invoiceRpcRecovery
    ? await window.FundlinePaymentVerification.submitInvoiceTransactionOnce({
      submit: () => sendRouterPayment(provider, {
        from: payerWallet,
        router: config.paymentRouterAddress,
        invoiceId: invoice.onchainInvoiceId,
        merchantWallet: invoice.merchantWallet,
        amount: amountUnits,
      }),
      checkState: async () => verifyPaymentAndMarkPaid(
        invoice.id,
        { preventDefault() {} },
        { payerWallet, txHash: "", auto: true, showPendingToast: false },
      ),
      attempts: 10,
      delayMs: 2000,
      unknownMessage: "The wallet RPC is busy. Payment status is unknown. Check wallet activity before retrying.",
    })
    : {
      status: "submitted",
      value: await sendRouterPayment(provider, {
        from: payerWallet,
        router: config.paymentRouterAddress,
        invoiceId: invoice.onchainInvoiceId,
        merchantWallet: invoice.merchantWallet,
        amount: amountUnits,
      }),
    };

  if (payment.status === "recovered") {
    setProgressStep(progress, "pay", "done", "Payment found on-chain");
    setProgressStep(progress, "verify", "done", "Payment verified");
    setProgressStep(progress, "receipt", "done", "Receipt available");
    return true;
  }
  const txHash = payment.value;
```

Continue the existing known-hash verification path unchanged after assigning
`txHash`.

- [ ] **Step 7: Run focused tests and syntax checks**

Run:

```powershell
node test_invoice_rpc_recovery.js
node test_payment_verification_polling.js
node --check payment-verification.js
node --check app.js
```

Expected: all tests print `PASS`; all syntax checks exit 0.

- [ ] **Step 8: Review the diff for scope**

Run:

```powershell
git diff -- app.js payment-verification.js test_invoice_rpc_recovery.js
git diff --check
```

Expected:

- No change to `wallet.js`, `server.js`, workflow, MCP, batch, or contract files.
- Only direct invoice call sites pass `invoiceRpcRecovery: true`.
- No code path retries `sendUsdcApprove` or `sendRouterPayment`.

- [ ] **Step 9: Commit invoice integration**

```powershell
git add -- app.js payment-verification.js test_invoice_rpc_recovery.js
git commit -m "fix: recover invoice payments from RPC limits"
```

### Task 3: Run the final focused regression gate

**Files:**
- Verify only: `app.js`, `payment-verification.js`, `test_invoice_rpc_recovery.js`

**Interfaces:**
- Consumes: completed Task 1 and Task 2 behavior.
- Produces: verification evidence for handoff.

- [ ] **Step 1: Run payment and invoice tests**

Run:

```powershell
node test_invoice_rpc_recovery.js
node test_payment_verification_polling.js
node test_payment_verification_lookup.js
node test_native_transfer_fallback.js
node test_amount_units.js
```

Expected: every command exits 0 and prints its `PASS` message.

- [ ] **Step 2: Run syntax checks**

Run:

```powershell
node --check app.js
node --check payment-verification.js
node --check server.js
```

Expected: every command exits 0 with no output.

- [ ] **Step 3: Confirm no unintended files are staged**

Run:

```powershell
git status --short
git diff HEAD~2..HEAD --stat
git diff HEAD~2..HEAD -- wallet.js server.js workflows.html dashboard.js
```

Expected: the scoped diff for `wallet.js`, `server.js`, `workflows.html`, and
`dashboard.js` is empty.
