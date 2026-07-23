"use strict";

const assert = require("assert");
const runtime = require("./workflow-browser-runtime");

function response(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

async function main() {
  assert.deepEqual(runtime.normalizeRpcUrls({
    rpcUrl: "https://primary.test",
    rpcFallbackUrls: ["https://fallback.test", "https://primary.test"],
  }), ["https://primary.test", "https://fallback.test"]);

  const rpcCalls = [];
  const provider = runtime.createRpcReadProvider({
    rpcUrls: ["https://primary.test", "https://fallback.test"],
    fetchImpl: async (url) => {
      rpcCalls.push(url);
      if (url.includes("primary")) return response(429, { error: { message: "limited" } });
      return response(200, { jsonrpc: "2.0", id: 1, result: "0x4cef52" });
    },
    rpcTimeoutMs: 100,
  });
  assert.equal(await provider.request({ method: "eth_chainId", params: [] }), "0x4cef52");
  assert.deepEqual(rpcCalls, ["https://primary.test", "https://fallback.test"]);

  let receiptChecks = 0;
  let now = 0;
  const receipt = await runtime.waitForReceipt({
    request: async () => {
      receiptChecks += 1;
      return receiptChecks === 1 ? { status: "0x1" } : null;
    },
    txHash: "0x" + "1".repeat(64),
    timeoutMs: 60000,
    pollMs: 2000,
    now: () => now,
    sleep: async (ms) => {
      now += ms;
    },
  });
  assert.equal(receipt.status, "0x1");
  assert.equal(receiptChecks, 1);

  await assert.rejects(() => runtime.waitForReceipt({
    request: async () => ({ status: "0x0" }),
    txHash: "0x" + "2".repeat(64),
    timeoutMs: 60000,
    pollMs: 2000,
  }), /reverted/);

  const memory = new Map();
  const storage = {
    getItem: (key) => memory.has(key) ? memory.get(key) : null,
    setItem: (key, value) => memory.set(key, value),
    removeItem: (key) => memory.delete(key),
  };
  const store = runtime.createRecoveryStore(storage, "fundline-workflow-jobs-v1");
  const first = {
    version: 1,
    jobId: "0x" + "3".repeat(64),
    runId: "0x" + "3".repeat(64),
    recoveryToken: "secret",
    wallet: "0x" + "a".repeat(40),
    slug: "client-research",
    tier: "normal",
    createdAt: "2026-07-23T00:00:00.000Z",
  };
  store.put(first);
  assert.equal(store.listForWallet(first.wallet).length, 1);
  assert.equal(store.listForWallet("0x" + "b".repeat(40)).length, 0);

  const record = {
    ...first,
    jobId: "0x" + "4".repeat(64),
    runId: "0x" + "4".repeat(64),
    recoveryToken: "second-secret",
    createdAt: "2026-07-23T00:01:00.000Z",
  };
  store.put(record);
  store.put({ ...record, tier: "plus" });
  assert.equal(store.listForWallet(record.wallet).length, 2);
  assert.equal(store.listForWallet(record.wallet).find((item) => item.jobId === record.jobId).tier, "plus");
  store.remove(record.jobId);
  assert.equal(store.listForWallet(record.wallet).length, 1);
  storage.setItem("fundline-workflow-jobs-v1", "{bad-json");
  assert.deepEqual(store.listForWallet(record.wallet), []);

  const statusCalls = [];
  const status = await runtime.fetchRunStatus({
    fetchImpl: async (url, options) => {
      statusCalls.push({ url, options });
      return response(202, { jobId: first.jobId, status: "processing", retryAfterSeconds: 1 });
    },
    jobId: first.jobId,
    recoveryToken: "secret",
    timeoutMs: 100,
  });
  assert.equal(status.status, "processing");
  assert.equal(statusCalls[0].options.headers["X-Fundline-Recovery-Token"], "secret");

  const succeeded = await runtime.fetchRunStatus({
    fetchImpl: async () => response(200, {
      jobId: first.jobId,
      status: "succeeded",
      result: { file: { name: "report.pdf" } },
    }),
    jobId: first.jobId,
    recoveryToken: "secret",
    timeoutMs: 100,
  });
  assert.equal(succeeded.result.file.name, "report.pdf");
}

main().then(() => {
  console.log("PASS: workflow browser runtime");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
