"use strict";

const assert = require("assert");
const { createWorkflowJobSettlement } = require("./workflow-job-settlement");

const PAYER = "0x" + "11".repeat(20);
const RUN_ID = "0x" + "22".repeat(32);
const RELEASE_TX = "0x" + "33".repeat(32);
const REFUND_TX = "0x" + "44".repeat(32);

function escrowJob(overrides) {
  return {
    jobId: RUN_ID,
    request: { slug: "client-research", name: "Client Research" },
    payment: { mode: "escrow", reference: RUN_ID, payer: PAYER, amount: "10000" },
    settlement: { status: "pending", txHash: "" },
    ...(overrides || {}),
  };
}

function x402Job(overrides) {
  return {
    jobId: RUN_ID,
    payment: { mode: "x402", reference: RELEASE_TX, payer: PAYER, amount: "10000" },
    settlement: { status: "pending", txHash: "" },
    ...(overrides || {}),
  };
}

function fakeEscrow(state, calls) {
  return {
    readRun: async () => ({
      payer: PAYER,
      amount: 10000n,
      released: false,
      refunded: false,
      ...state,
    }),
    release: async (_runId, _memo, onSubmitted) => {
      onSubmitted(RELEASE_TX);
      calls.push("release");
      return RELEASE_TX;
    },
    refund: async (_runId, onSubmitted) => {
      onSubmitted(REFUND_TX);
      calls.push("refund");
      return REFUND_TX;
    },
    transferUsdc: async (_payer, _amount, onSubmitted) => {
      onSubmitted(REFUND_TX);
      calls.push("transfer");
      return REFUND_TX;
    },
    getTransactionStatus: async (txHash) => {
      calls.push("status:" + txHash);
      return "confirmed";
    },
  };
}

async function main() {
  let calls = [];
  let adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({}, calls),
    buildMemo: () => "workflow memo",
  });
  let settled = await adapter.settle(escrowJob(), { steps: [] }, {
    onSubmitted: (hash) => calls.push("submitted:" + hash),
  });
  assert.equal(settled.confirmed, true);
  assert.deepEqual(calls, ["submitted:" + RELEASE_TX, "release"]);

  calls = [];
  adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({}, calls),
    buildMemo: () => "workflow memo",
    markX402Refunded: (paymentHash, refundHash) => calls.push("marked:" + paymentHash + ":" + refundHash),
  });
  settled = await adapter.settle(escrowJob({
    settlement: { status: "submitted", txHash: RELEASE_TX },
  }), { steps: [] }, { onSubmitted: () => calls.push("unexpected-submit") });
  assert.equal(settled.confirmed, true);
  assert.deepEqual(calls, ["status:" + RELEASE_TX]);

  calls = [];
  adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({ released: true }, calls),
    buildMemo: () => "workflow memo",
  });
  settled = await adapter.settle(escrowJob(), { steps: [] }, {});
  assert.equal(settled.confirmed, true);
  assert.equal(settled.observed, "released");
  assert.deepEqual(calls, []);

  adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({ refunded: true }, []),
    buildMemo: () => "workflow memo",
  });
  await assert.rejects(
    () => adapter.settle(escrowJob(), { steps: [] }, {}),
    /already refunded/
  );

  calls = [];
  adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({}, calls),
    buildMemo: () => "workflow memo",
    markX402Refunded: (paymentHash, refundHash) => calls.push("marked:" + paymentHash + ":" + refundHash),
  });
  settled = await adapter.settle(x402Job(), { steps: [] }, {});
  assert.deepEqual(settled, { txHash: RELEASE_TX, confirmed: true });
  assert.deepEqual(calls, []);

  const refunded = await adapter.refund(x402Job(), {
    onSubmitted: (hash) => calls.push("submitted:" + hash),
  });
  assert.equal(refunded.confirmed, true);
  assert.deepEqual(calls, [
    "submitted:" + REFUND_TX,
    "transfer",
    "marked:" + RELEASE_TX + ":" + REFUND_TX,
  ]);

  calls.length = 0;
  const reconciledRefund = await adapter.refund(x402Job({
    settlement: { status: "refund_submitted", txHash: REFUND_TX },
  }), { onSubmitted: () => calls.push("unexpected-submit") });
  assert.equal(reconciledRefund.confirmed, true);
  assert.deepEqual(calls, ["status:" + REFUND_TX]);

  calls = [];
  adapter = createWorkflowJobSettlement({
    runEscrow: fakeEscrow({}, calls),
    buildMemo: () => "workflow memo",
  });
  const escrowRefund = await adapter.refund(escrowJob(), {
    onSubmitted: (hash) => calls.push("submitted:" + hash),
  });
  assert.equal(escrowRefund.confirmed, true);
  assert.deepEqual(calls, ["submitted:" + REFUND_TX, "refund"]);

  await assert.rejects(
    () => adapter.settle({ payment: { mode: "gateway" } }, {}, {}),
    /gateway async unsupported/
  );

  console.log("PASS: workflow job settlement");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
