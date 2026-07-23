"use strict";

const assert = require("assert");
const fs = require("fs");
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

  const appSource = fs.readFileSync("./app.js", "utf8");
  assert.match(
    appSource,
    /async function submitArcPaymentWithProgress\(invoice, payerWallet, button, progress, options = \{\}\)/,
  );
  assert.match(
    appSource,
    /async function ensureInvoicePaymentNetwork\(provider, config\)/,
  );
  assert.match(
    appSource,
    /invoiceRpcRecovery\s*\?\s*await ensureInvoicePaymentNetwork\(provider, config\)/,
  );
  assert.equal(
    (appSource.match(/\{ invoiceRpcRecovery: true \}/g) || []).length,
    2,
    "only the two direct invoice call sites should enable RPC recovery",
  );
}

main().then(() => {
  console.log("PASS: invoice RPC recovery");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
