"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorkflowJobStore } = require("./workflow-job-store");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fundline-jobs-"));
let clock = Date.parse("2026-07-23T00:00:00.000Z");
const store = createWorkflowJobStore({
  baseDir: root,
  now: () => clock,
  randomBytes: () => Buffer.alloc(32, 7),
  lockLeaseMs: 1000,
});

const quote = store.createQuote({
  jobId: "0x" + "11".repeat(32),
  ownerRateKey: "key:test",
  request: {
    slug: "client-research",
    tier: "normal",
    input: { prompt: "Acme" },
  },
  payment: {
    mode: "escrow",
    reference: "0x" + "11".repeat(32),
    amount: "10000",
  },
});

assert.equal(quote.job.status, "awaiting_payment");
assert.equal(quote.recoveryToken.length, 64);
assert.equal(JSON.stringify(store.getJob(quote.job.jobId)).includes(quote.recoveryToken), false);
assert.equal(store.authorize(quote.job, { rateKey: "key:test" }), true);
assert.equal(store.authorize(quote.job, { recoveryToken: quote.recoveryToken }), true);
assert.equal(store.authorize(quote.job, { recoveryToken: "wrong" }), false);

store.bindPayment(quote.job.jobId, {
  mode: "escrow",
  reference: quote.job.jobId,
  payer: "0x" + "22".repeat(20),
});
assert.equal(store.findByPayment("escrow", quote.job.jobId).jobId, quote.job.jobId);

const second = store.createQuote({
  jobId: "0x" + "33".repeat(32),
  request: {
    slug: "client-research",
    tier: "normal",
    input: { prompt: "Beta" },
  },
  payment: {
    mode: "escrow",
    reference: "0x" + "33".repeat(32),
    amount: "10000",
  },
});
assert.throws(
  () => store.bindPayment(second.job.jobId, {
    mode: "escrow",
    reference: quote.job.jobId,
  }),
  /already bound/
);

store.transition(quote.job.jobId, ["awaiting_payment"], "queued", {});
const first = store.claimNext({ workerId: "worker-a", leaseMs: 1000 });
assert.equal(first.jobId, quote.job.jobId);
assert.equal(store.claimNext({ workerId: "worker-b", leaseMs: 1000 }), null);

clock += 1001;
const recovered = store.claimNext({ workerId: "worker-b", leaseMs: 1000 });
assert.equal(recovered.jobId, quote.job.jobId);
assert.equal(recovered.execution.workerId, "worker-b");
const recoveredLease = {
  workerId: recovered.execution.workerId,
  leaseToken: recovered.execution.leaseToken,
};

store.storeResult(quote.job.jobId, { output: "# Durable", steps: [] }, recoveredLease);
assert.equal(store.getResult(quote.job.jobId).output, "# Durable");
assert.equal(store.getJob(quote.job.jobId).execution.resultStored, true);
assert.throws(() => store.getJob("../../.env"), /Invalid job ID/);

const publicJob = store.publicJob(store.getJob(quote.job.jobId));
assert.equal(Object.hasOwn(publicJob, "owner"), false);
assert.equal(Object.hasOwn(publicJob.request, "input"), false);
assert.equal(Object.hasOwn(publicJob.execution, "workerId"), false);
assert.equal(Object.hasOwn(publicJob.execution, "leaseToken"), false);

store.transition(quote.job.jobId, ["processing"], "settlement_pending", {}, recoveredLease);
assert.equal(store.claimNext({ workerId: "worker-c", leaseMs: 1000 }), null);
clock += 1001;
const settlementClaim = store.claimNext({ workerId: "worker-c", leaseMs: 1000 });
assert.equal(settlementClaim.jobId, quote.job.jobId);
store.transition(quote.job.jobId, ["settlement_pending"], "succeeded", {
  completedAt: new Date(clock).toISOString(),
}, {
  workerId: settlementClaim.execution.workerId,
  leaseToken: settlementClaim.execution.leaseToken,
});
assert.throws(
  () => store.transition(quote.job.jobId, ["succeeded"], "queued", {}),
  /terminal/
);

const fencedJobId = "0x" + "44".repeat(32);
store.createQuote({
  jobId: fencedJobId,
  request: { slug: "client-research", tier: "normal", input: { prompt: "Fence" } },
  payment: { mode: "escrow", reference: fencedJobId, amount: "10000" },
});
store.transition(fencedJobId, ["awaiting_payment"], "queued", {});
const staleClaim = store.claimNext({ workerId: "stale-worker", leaseMs: 1000 });
clock += 1001;
const activeClaim = store.claimNext({ workerId: "active-worker", leaseMs: 1000 });
assert.equal(activeClaim.jobId, fencedJobId);
assert.throws(
  () => store.storeResult(fencedJobId, { output: "stale", steps: [] }, {
    workerId: "stale-worker",
    leaseToken: staleClaim.execution.leaseToken,
  }),
  /lease/i
);

const retryJobId = "0x" + "55".repeat(32);
let retryClock = clock;
const retryStore = createWorkflowJobStore({
  baseDir: fs.mkdtempSync(path.join(os.tmpdir(), "fundline-jobs-retry-")),
  now: () => retryClock,
  randomBytes: () => Buffer.alloc(32, 8),
  lockLeaseMs: 1000,
});
retryStore.createQuote({
  jobId: retryJobId,
  request: { slug: "client-research", tier: "normal", input: { prompt: "Retry" } },
  payment: { mode: "escrow", reference: retryJobId, amount: "10000" },
});
retryStore.transition(retryJobId, ["awaiting_payment"], "queued", {});
const retryClaim = retryStore.claimNext({ workerId: "retry-worker-a", leaseMs: 60000 });
const retryLease = {
  workerId: retryClaim.execution.workerId,
  leaseToken: retryClaim.execution.leaseToken,
};
retryStore.storeResult(retryJobId, { output: "stored", steps: [] }, retryLease);
retryStore.transition(retryJobId, ["processing"], "settlement_pending", {}, retryLease);
retryStore.deferRetry(retryJobId, ["settlement_pending"], retryLease, 5000);
assert.equal(retryStore.claimNext({ workerId: "retry-worker-b", leaseMs: 60000 }), null);
retryClock += 4999;
assert.equal(retryStore.claimNext({ workerId: "retry-worker-b", leaseMs: 60000 }), null);
retryClock += 1;
assert.equal(retryStore.claimNext({ workerId: "retry-worker-b", leaseMs: 60000 }).jobId, retryJobId);
assert.throws(
  () => retryStore.deferRetry(retryJobId, ["settlement_pending"], retryLease, 5000),
  /lease|precondition/i,
);

clock += 2000;
const firstSweep = store.sweep({ resultTtlMs: 1000, metadataTtlMs: 10000 });
assert.equal(firstSweep.resultsDeleted, 1);
assert.equal(store.getResult(quote.job.jobId), null);
assert.notEqual(store.getJob(quote.job.jobId), null);

clock += 9000;
const secondSweep = store.sweep({ resultTtlMs: 1000, metadataTtlMs: 10000 });
assert.equal(secondSweep.metadataDeleted, 1);
assert.equal(store.getJob(quote.job.jobId), null);
assert.notEqual(store.getJob(second.job.jobId), null);

console.log("PASS: workflow job store");
