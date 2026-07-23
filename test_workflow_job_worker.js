"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorkflowJobStore } = require("./workflow-job-store");
const { createWorkflowJobWorker } = require("./workflow-job-worker");

function createStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fundline-worker-"));
  let clock = Date.parse("2026-07-23T00:00:00.000Z");
  const store = createWorkflowJobStore({ baseDir: root, now: () => clock });
  store.advanceClock = (milliseconds) => { clock += milliseconds; };
  return store;
}

function createQueuedJob(store, jobId) {
  store.createQuote({
    jobId,
    request: {
      slug: "client-research",
      tier: "normal",
      input: { prompt: "Acme" },
    },
    payment: { mode: "escrow", reference: jobId, amount: "10000" },
  });
  store.transition(jobId, ["awaiting_payment"], "queued", {});
  return jobId;
}

async function testSuccessfulExecutionOrder() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "11".repeat(32));
  const events = [];
  const worker = createWorkflowJobWorker({
    store,
    workerId: "worker-a",
    leaseMs: 60000,
    executeJob: async (_job, hooks) => {
      events.push("execute");
      hooks.onProgress();
      return { output: "done", steps: [] };
    },
    settleJob: async (_job, result, hooks) => {
      events.push(store.getResult(jobId) ? "settle-after-result" : "settle-before-result");
      hooks.onSubmitted("0x" + "44".repeat(32));
      result.releaseTx = "0x" + "44".repeat(32);
      return { txHash: "0x" + "44".repeat(32), confirmed: true };
    },
    refundJob: async () => {
      throw new Error("must not refund a successful result");
    },
  });

  assert.equal(await worker.runOnce(), true);
  assert.deepEqual(events, ["execute", "settle-after-result"]);
  assert.equal(store.getJob(jobId).status, "succeeded");
  assert.equal(store.getJob(jobId).settlement.status, "confirmed");
  assert.equal(store.getResult(jobId).releaseTx, "0x" + "44".repeat(32));
}

async function testSettlementRetryState() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "22".repeat(32));
  const worker = createWorkflowJobWorker({
    store,
    workerId: "worker-b",
    executeJob: async () => ({ output: "stored", steps: [] }),
    settleJob: async () => {
      throw new Error("rpc unavailable");
    },
    refundJob: async () => {
      throw new Error("must not refund a successful result");
    },
  });

  await worker.runOnce();
  assert.equal(store.getJob(jobId).status, "settlement_pending");
  assert.equal(store.getJob(jobId).execution.errorCode, "settlement_pending");
  assert.equal(store.getResult(jobId).output, "stored");
}

async function testSettlementRetrySchedule() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "23".repeat(32));
  let executions = 0;
  let settlements = 0;
  const worker = createWorkflowJobWorker({
    store,
    workerId: "retry-worker",
    leaseMs: 60000,
    settlementRetryMs: 5000,
    executeJob: async () => {
      executions += 1;
      return { output: "stored once", steps: [] };
    },
    settleJob: async () => {
      settlements += 1;
      if (settlements === 1) throw new Error("receipt pending");
      return { txHash: "0x" + "24".repeat(32), confirmed: true };
    },
    refundJob: async () => ({ txHash: "", confirmed: true }),
  });
  assert.equal(await worker.runOnce(), true);
  assert.equal(store.getJob(jobId).status, "settlement_pending");
  store.advanceClock(4999);
  assert.equal(await worker.runOnce(), false);
  store.advanceClock(1);
  assert.equal(await worker.runOnce(), true);
  assert.equal(executions, 1);
  assert.equal(settlements, 2);
  assert.equal(store.getJob(jobId).status, "succeeded");
}

async function testExecutionFailureRefundOrder() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "33".repeat(32));
  const events = [];
  const originalTransition = store.transition;
  store.transition = (...args) => {
    const next = originalTransition(...args);
    events.push("state:" + next.status);
    return next;
  };
  const worker = createWorkflowJobWorker({
    store,
    workerId: "worker-c",
    executeJob: async () => {
      const error = new Error("provider failed");
      error.code = "provider_failed";
      throw error;
    },
    settleJob: async () => {
      throw new Error("must not settle a failed execution");
    },
    refundJob: async (job, hooks) => {
      events.push("refund-observed:" + job.status);
      hooks.updateJob({ owner: { rollbackRecorded: true } });
      hooks.onSubmitted("0x" + "55".repeat(32));
      return { txHash: "0x" + "55".repeat(32), confirmed: true };
    },
  });

  await worker.runOnce();
  assert.deepEqual(events, [
    "state:failed",
    "state:refunding",
    "refund-observed:refunding",
    "state:refunded",
  ]);
  assert.equal(store.getJob(jobId).status, "refunded");
  assert.equal(store.getJob(jobId).execution.errorCode, "provider_failed");
  assert.equal(store.getJob(jobId).owner.rollbackRecorded, true);
}

async function testRecoverySkipsExecution() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "66".repeat(32));
  const crashedClaim = store.claimNext({ workerId: "crashed-worker", leaseMs: 60000 });
  const crashedLease = {
    workerId: crashedClaim.execution.workerId,
    leaseToken: crashedClaim.execution.leaseToken,
  };
  store.storeResult(jobId, { output: "already durable", steps: [] }, crashedLease);
  store.transition(jobId, ["processing"], "settlement_pending", {}, crashedLease);
  store.advanceClock(60001);
  let executions = 0;
  let settlements = 0;
  const worker = createWorkflowJobWorker({
    store,
    workerId: "recovery-worker",
    executeJob: async () => {
      executions += 1;
      return { output: "duplicate", steps: [] };
    },
    settleJob: async () => {
      settlements += 1;
      return { txHash: "0x" + "77".repeat(32), confirmed: true };
    },
    refundJob: async () => ({ txHash: "", confirmed: true }),
  });

  await worker.runOnce();
  assert.equal(executions, 0);
  assert.equal(settlements, 1);
  assert.equal(store.getJob(jobId).status, "succeeded");
  assert.equal(store.getResult(jobId).output, "already durable");
}

async function testExpiredProcessingRestartsExecution() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "88".repeat(32));
  store.claimNext({ workerId: "crashed-worker", leaseMs: 1000 });
  store.advanceClock(1001);
  let executions = 0;
  const worker = createWorkflowJobWorker({
    store,
    workerId: "restart-worker",
    leaseMs: 1000,
    executeJob: async () => {
      executions += 1;
      return { output: "restarted", steps: [] };
    },
    settleJob: async () => ({ txHash: "0x" + "99".repeat(32), confirmed: true }),
    refundJob: async () => ({ txHash: "", confirmed: true }),
  });

  await worker.runOnce();
  assert.equal(executions, 1);
  assert.equal(store.getJob(jobId).status, "succeeded");
  assert.equal(store.getResult(jobId).output, "restarted");
}

async function testSchedulerSurvivesScanError() {
  const callbacks = [];
  let errors = 0;
  const worker = createWorkflowJobWorker({
    store: { claimNext: () => { throw new Error("temporary disk error"); } },
    executeJob: async () => ({}),
    settleJob: async () => ({}),
    refundJob: async () => ({}),
    setTimeout: (callback) => { callbacks.push(callback); return callbacks.length; },
    clearTimeout: () => {},
    onError: () => { errors += 1; },
  });

  worker.start();
  assert.equal(callbacks.length, 1);
  await callbacks.shift()();
  assert.equal(errors, 1);
  assert.equal(callbacks.length, 1);
  worker.stop();
}

async function testHeartbeatPreventsSecondWorkerClaim() {
  const store = createStore();
  const jobId = createQueuedJob(store, "0x" + "aa".repeat(32));
  const heartbeatCallbacks = [];
  let contenderClaim = "not-checked";
  const worker = createWorkflowJobWorker({
    store,
    workerId: "heartbeat-worker",
    leaseMs: 1000,
    heartbeatMs: 300,
    setInterval: (callback) => {
      heartbeatCallbacks.push(callback);
      return callback;
    },
    clearInterval: () => {},
    executeJob: async () => {
      store.advanceClock(800);
      heartbeatCallbacks[0]();
      store.advanceClock(300);
      contenderClaim = store.claimNext({ workerId: "contender", leaseMs: 1000 });
      return { output: "single execution", steps: [] };
    },
    settleJob: async () => ({ txHash: "0x" + "bb".repeat(32), confirmed: true }),
    refundJob: async () => ({ txHash: "", confirmed: true }),
  });

  assert.equal(await worker.runOnce(), true);
  assert.equal(contenderClaim, null);
  assert.equal(store.getJob(jobId).status, "succeeded");
}

async function main() {
  await testSuccessfulExecutionOrder();
  await testSettlementRetryState();
  await testSettlementRetrySchedule();
  await testExecutionFailureRefundOrder();
  await testRecoverySkipsExecution();
  await testExpiredProcessingRestartsExecution();
  await testSchedulerSurvivesScanError();
  await testHeartbeatPreventsSecondWorkerClaim();
  console.log("PASS: workflow job worker");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
