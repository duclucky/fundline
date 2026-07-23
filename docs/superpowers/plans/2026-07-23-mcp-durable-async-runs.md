# MCP Durable Async Runs Implementation Plan

**Status:** Implemented and verified locally on 2026-07-23. Production enablement remains disabled pending a live Arc Testnet lifecycle pass.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paid Remote MCP workflow runs return durable asynchronous jobs whose results survive disconnects and Passenger restarts, while preserving the existing browser SSE and legacy x402 behavior.

**Architecture:** Add a disk-backed per-job store with atomic writes, cross-process lock files, payment-reference idempotency, and lease recovery. Extract provider execution from the HTTP response lifecycle, run async jobs through a bounded worker, persist output before settlement, and expose status through an authenticated HTTP endpoint plus an MCP `get_run` tool.

**Tech Stack:** Node.js 20, CommonJS, built-in `fs`/`path`/`crypto`, plain Node standalone tests, existing ethers-based RunEscrow client, existing MCP SDK, no new dependency or external database.

## Global Constraints

- Production runs on Node.js 20 under cPanel Phusion Passenger.
- Use CommonJS, two-space indentation, double quotes, and English code/comments/docs.
- Do not use long em dashes or website emoji.
- Do not add a framework, formatter, database, Redis, BullMQ, or build step.
- Keep all job paths inside `data/workflow-jobs/`; `data/` stays gitignored and FTP-excluded.
- Keep USDC values as integer six-decimal base units.
- Preserve the non-custodial invariant and the existing one-hour `claimRefund()` contract backstop.
- Never log prompts, outputs, API keys, recovery tokens, or private payment authorizations.
- Public run IDs and transaction hashes are not authorization credentials.
- New async behavior is gated by `WORKFLOW_MCP_ASYNC_ENABLED=false` until live verification.
- Do not change workflow prompts, pricing, model routing, or CheapKey fallback.

## File Structure

- Create `workflow-job-store.js`: durable metadata/result files, locks, leases, authorization, retention, and payment-reference lookup.
- Create `workflow-job-worker.js`: bounded polling worker and state/settlement ordering.
- Create `workflow-execution.js`: provider and workflow orchestration extracted from `server.js`, with injected side effects.
- Create `workflow-job-settlement.js`: idempotent escrow/x402 settlement and refund reconciliation.
- Create `workflow-mcp-tools.js`: MCP schemas and tool-call handlers for quote, enqueue, status, and legacy compatibility.
- Modify `run-escrow-client.js`: expose transaction submission callbacks and receipt status reads.
- Modify `server.js`: configure modules, add routes, enqueue branch, job executor, recovery startup, and preserve synchronous behavior.
- Modify `.env.example`: document async job flags and retention settings.
- Modify `docs.html`: publish only the integrator-facing async MCP contract.
- Create `test_workflow_job_store.js`, `test_workflow_job_worker.js`, `test_workflow_execution.js`, `test_workflow_job_settlement.js`, `test_workflow_mcp_tools.js`, and `test_workflow_async_api.js`.

---

### Task 1: Durable Job Store

**Files:**
- Create: `workflow-job-store.js`
- Create: `test_workflow_job_store.js`

**Interfaces:**
- Consumes: `{ baseDir, now?, randomBytes?, lockLeaseMs? }` configuration.
- Produces: `createWorkflowJobStore(config)` with `createQuote`, `getJob`, `findByPayment`, `bindPayment`, `transition`, `update`, `claimNext`, `renewLease`, `storeResult`, `getResult`, `authorize`, `publicJob`, and `sweep`.
- Job IDs are lowercase `0x` plus 64 hexadecimal characters.
- `authorize(job, { rateKey, recoveryToken })` accepts the stored API-key fingerprint or the original recovery token.

- [ ] **Step 1: Write the failing store tests**

Create a temporary directory with `fs.mkdtempSync(path.join(os.tmpdir(), "fundline-jobs-"))`. Add assertions for quote creation, raw-token non-persistence, result separation, invalid job IDs, legal transitions, terminal immutability, payment idempotency, authorization, claim contention, expired-lease recovery, and retention:

```js
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
  request: { slug: "client-research", tier: "normal", input: { prompt: "Acme" } },
  payment: { mode: "escrow", reference: "0x" + "11".repeat(32), amount: "10000" },
});
assert.equal(quote.job.status, "awaiting_payment");
assert.equal(quote.recoveryToken.length, 64);
assert.equal(JSON.stringify(store.getJob(quote.job.jobId)).includes(quote.recoveryToken), false);
assert.equal(store.authorize(quote.job, { rateKey: "key:test" }), true);
assert.equal(store.authorize(quote.job, { recoveryToken: quote.recoveryToken }), true);
assert.equal(store.authorize(quote.job, { recoveryToken: "wrong" }), false);

store.bindPayment(quote.job.jobId, { mode: "escrow", reference: quote.job.jobId, payer: "0x" + "22".repeat(20) });
assert.equal(store.findByPayment("escrow", quote.job.jobId).jobId, quote.job.jobId);
const second = store.createQuote({
  jobId: "0x" + "33".repeat(32),
  request: { slug: "client-research", tier: "normal", input: { prompt: "Beta" } },
  payment: { mode: "escrow", reference: "0x" + "33".repeat(32), amount: "10000" },
});
assert.throws(() => store.bindPayment(second.job.jobId, { mode: "escrow", reference: quote.job.jobId }), /already bound/);

store.transition(quote.job.jobId, ["awaiting_payment"], "queued", {});
const first = store.claimNext({ workerId: "worker-a", leaseMs: 1000 });
assert.equal(first.jobId, quote.job.jobId);
assert.equal(store.claimNext({ workerId: "worker-b", leaseMs: 1000 }), null);
clock += 1001;
const recovered = store.claimNext({ workerId: "worker-b", leaseMs: 1000 });
assert.equal(recovered.jobId, quote.job.jobId);
assert.equal(recovered.execution.workerId, "worker-b");

store.storeResult(quote.job.jobId, { output: "# Durable", steps: [] });
assert.equal(store.getResult(quote.job.jobId).output, "# Durable");
assert.equal(store.getJob(quote.job.jobId).execution.resultStored, true);
assert.throws(() => store.getJob("../../.env"), /Invalid job ID/);

store.transition(quote.job.jobId, ["processing"], "settlement_pending", {});
store.transition(quote.job.jobId, ["settlement_pending"], "succeeded", { completedAt: new Date(clock).toISOString() });
assert.throws(() => store.transition(quote.job.jobId, ["succeeded"], "queued", {}), /terminal/);

console.log("PASS: workflow job store");
```

- [ ] **Step 2: Run the store test and confirm the RED state**

Run: `node test_workflow_job_store.js`

Expected: FAIL with `Cannot find module './workflow-job-store'`.

- [ ] **Step 3: Implement the store module**

Implement these constants and helpers exactly, then implement each exported method around them:

```js
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOB_ID_RE = /^0x[0-9a-f]{64}$/;
const TERMINAL = new Set(["succeeded", "refunded"]);
const TRANSITIONS = {
  awaiting_payment: new Set(["queued"]),
  queued: new Set(["processing"]),
  processing: new Set(["queued", "settlement_pending", "failed"]),
  settlement_pending: new Set(["succeeded"]),
  failed: new Set(["refunding"]),
  refunding: new Set(["refunded"]),
  succeeded: new Set(),
  refunded: new Set(),
};

function validateJobId(jobId) {
  const value = String(jobId || "").toLowerCase();
  if (!JOB_ID_RE.test(value)) throw new Error("Invalid job ID");
  return value;
}

function atomicWriteJson(filePath, value) {
  const tempPath = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(value));
  fs.renameSync(tempPath, filePath);
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}
```

Use one metadata file `<jobId-without-0x>.json`, one result file `<id>.result.json`, and one lock file `<id>.lock`. `createQuote` returns the raw 32-byte random recovery token once and stores only `tokenHash(recoveryToken)`. `findByPayment` scans metadata files and compares normalized `{mode,reference}`. `bindPayment` runs under the job lock and refuses a reference already owned by another job. `transition` changes status only when both the current-state precondition and `TRANSITIONS` allow it. `update` merges a patch without changing status and requires the current status to be in its allowed list. `claimNext` sorts candidates by `createdAt`; it claims `queued`, reclaims `processing` only when `leaseUntil <= now`, and also claims recoverable `failed`, `refunding`, and `settlement_pending` jobs for reconciliation. `publicJob` omits `owner`, raw request input, worker ID, and internal exception text.

Export:

```js
module.exports = {
  createWorkflowJobStore,
  JOB_ID_RE,
  TRANSITIONS,
};
```

- [ ] **Step 4: Run the store test and confirm GREEN**

Run: `node test_workflow_job_store.js`

Expected: `PASS: workflow job store` and exit code 0.

- [ ] **Step 5: Commit the store**

```bash
git add workflow-job-store.js test_workflow_job_store.js
git commit -m "Add durable workflow job store"
```

---

### Task 2: Lease-Based Job Worker

**Files:**
- Create: `workflow-job-worker.js`
- Create: `test_workflow_job_worker.js`

**Interfaces:**
- Consumes: store interface from Task 1 and injected `executeJob`, `settleJob`, `refundJob`, timer, clock, worker ID, poll interval, and lease duration.
- Produces: `createWorkflowJobWorker(options)` with `runOnce`, `start`, and `stop`.
- `executeJob(job, { onProgress })` returns the complete result payload.
- `settleJob(job, result, { onSubmitted })` and `refundJob(job, { onSubmitted })` return `{ txHash, confirmed }`.

- [ ] **Step 1: Write failing worker-order tests**

Use a real temporary Task 1 store and injected fakes. Assert the exact event ordering for success, execution failure, settlement failure, and restart after result persistence:

```js
const events = [];
const worker = createWorkflowJobWorker({
  store,
  workerId: "worker-a",
  leaseMs: 60000,
  executeJob: async (job, hooks) => {
    events.push("execute");
    hooks.onProgress();
    return { output: "done", steps: [] };
  },
  settleJob: async (_job, _result, hooks) => {
    events.push(store.getResult(jobId) ? "settle-after-result" : "settle-before-result");
    hooks.onSubmitted("0x" + "44".repeat(32));
    return { txHash: "0x" + "44".repeat(32), confirmed: true };
  },
  refundJob: async () => { events.push("refund"); return { txHash: "0x" + "55".repeat(32), confirmed: true }; },
});
await worker.runOnce();
assert.deepEqual(events, ["execute", "settle-after-result"]);
assert.equal(store.getJob(jobId).status, "succeeded");

const settlementFailure = createQueuedJob(store, "0x" + "66".repeat(32));
const failingSettlementWorker = createWorkflowJobWorker({
  store,
  workerId: "worker-b",
  executeJob: async () => ({ output: "stored", steps: [] }),
  settleJob: async () => { throw new Error("rpc unavailable"); },
  refundJob: async () => { throw new Error("must not refund a successful result"); },
});
await failingSettlementWorker.runOnce();
assert.equal(store.getJob(settlementFailure).status, "settlement_pending");
assert.equal(store.getResult(settlementFailure).output, "stored");
```

Add another job whose `executeJob` throws. Assert `failed` is persisted before the fake refund observes it, and the terminal state becomes `refunded`. Add a `settlement_pending` job with an existing result and assert `executeJob` is never called during recovery.

- [ ] **Step 2: Run the worker test and confirm RED**

Run: `node test_workflow_job_worker.js`

Expected: FAIL with `Cannot find module './workflow-job-worker'`.

- [ ] **Step 3: Implement the worker state machine**

Implement this core ordering:

```js
async function runOnce() {
  const job = store.claimNext({ workerId, leaseMs });
  if (!job) return false;

  const renew = () => store.renewLease(job.jobId, workerId, leaseMs);
  if (job.status === "failed") store.transition(job.jobId, ["failed"], "refunding", {});
  if (job.status === "refunding" || job.status === "failed") {
    try {
      const refunded = await refundJob(store.getJob(job.jobId), {
        onSubmitted: (txHash) => store.update(job.jobId, ["refunding"], {
          settlement: { status: "refund_submitted", txHash },
        }),
      });
      store.transition(job.jobId, ["refunding"], "refunded", {
        settlement: { status: "refund_confirmed", txHash: refunded.txHash || "" },
        completedAt: new Date(now()).toISOString(),
      });
    } catch (_) {}
    return true;
  }
  try {
    let result = store.getResult(job.jobId);
    if (!result) {
      result = await executeJob(job, { onProgress: renew });
      store.storeResult(job.jobId, result);
      store.transition(job.jobId, ["processing"], "settlement_pending", {});
    } else if (store.getJob(job.jobId).status === "processing") {
      store.transition(job.jobId, ["processing"], "settlement_pending", {});
    }
    try {
      const settled = await settleJob(store.getJob(job.jobId), result, {
        onSubmitted: (txHash) => store.update(job.jobId, ["settlement_pending"], {
          settlement: { status: "submitted", txHash },
        }),
      });
      store.transition(job.jobId, ["settlement_pending"], "succeeded", {
        settlement: { status: "confirmed", txHash: settled.txHash || "" },
        completedAt: new Date(now()).toISOString(),
      });
    } catch (error) {
      store.update(job.jobId, ["settlement_pending"], {
        execution: { errorCode: "settlement_pending" },
      });
    }
  } catch (error) {
    store.transition(job.jobId, ["processing"], "failed", {
      execution: { errorCode: String(error.code || "workflow_failed") },
    });
    store.transition(job.jobId, ["failed"], "refunding", {});
    try {
      const refunded = await refundJob(store.getJob(job.jobId), {
        onSubmitted: (txHash) => store.update(job.jobId, ["refunding"], {
          settlement: { status: "refund_submitted", txHash },
        }),
      });
      store.transition(job.jobId, ["refunding"], "refunded", {
        settlement: { status: "refund_confirmed", txHash: refunded.txHash || "" },
        completedAt: new Date(now()).toISOString(),
      });
    } catch (_) {}
  }
  return true;
}
```

The store's patch merge must preserve sibling fields. `start()` schedules the next scan with `setTimeout` only after the current scan finishes. `stop()` clears the timer and prevents rescheduling. A scan drains available jobs one at a time before waiting `pollMs`.

- [ ] **Step 4: Run store and worker tests**

Run: `node test_workflow_job_store.js; node test_workflow_job_worker.js`

Expected: both print `PASS` and exit code 0.

- [ ] **Step 5: Commit the worker**

```bash
git add workflow-job-worker.js test_workflow_job_worker.js
git commit -m "Add recoverable workflow job worker"
```

---

### Task 3: Extract Shared Workflow Execution

**Files:**
- Create: `workflow-execution.js`
- Create: `test_workflow_execution.js`
- Modify: `server.js:2075-2172`

**Interfaces:**
- Consumes: `executeWorkflowDefinition(options)` with the resolved definition, graph, tier models, input, injected model/search calls, executor modules, document persistence callback, JSearch callback, group ratio, date, and progress callback.
- Produces: the unchanged workflow result shape `{ report, steps, totalCostMicros, ... }`.
- Does not reserve limits, settle payment, write HTTP, or write job metadata.

- [ ] **Step 1: Write failing execution-router tests**

Create injected fakes for graph, CV/Gig, Crypto DD, and DocGen. Assert final-model routing and side effects without network calls:

```js
const assert = require("assert");
const { executeWorkflowDefinition } = require("./workflow-execution");

const calls = [];
const executors = {
  engine: { runWorkflowGraph: async (o) => { calls.push(["graph", o.finalModelId]); return { report: "graph", steps: [], totalCostMicros: 1 }; } },
  cvGig: { runCvGigWorkflow: async (o) => { calls.push(["cvgig", o.rankModel]); return { report: "cv", steps: [], totalCostMicros: 2, meta: {} }; } },
  cryptoDd: { runCryptoDdWorkflow: async (o) => { calls.push(["cryptodd", o.writerModel]); return { report: "crypto", steps: [], totalCostMicros: 3 }; } },
  docGen: { runDocGenWorkflow: async (o) => { calls.push(["docgen", o.writerModel]); return { report: "doc", steps: [], totalCostMicros: 4, file: { base64: "QQ==", filename: "a.pdf", format: "pdf" } }; } },
};

await executeWorkflowDefinition({
  def: { type: "docgen", docType: "proposal" },
  tierDef: { models: { FAST: "fast", STRONG: "strong" } },
  finalModelId: "gpt-5.6-luna",
  input: { prompt: "Build proposal" },
  executors,
  callModel: async () => ({}),
  persistDocument: () => ({ format: "pdf", filename: "a.pdf", url: "https://fundline.test/d/abc" }),
});
assert.deepEqual(calls[0], ["docgen", "gpt-5.6-luna"]);
```

Add one assertion per custom type and graph type. For CV/Gig, assert `onJsearchUsed` is called only when result metadata contains `JSearch`. For DocGen, assert base64 is replaced with the persisted public file reference.

- [ ] **Step 2: Run the execution test and confirm RED**

Run: `node test_workflow_execution.js`

Expected: FAIL with `Cannot find module './workflow-execution'`.

- [ ] **Step 3: Move orchestration into the new module**

Move the existing branching from `server.js` into:

```js
async function executeWorkflowDefinition(options) {
  const def = options.def;
  const tierDef = options.tierDef;
  const finalModelId = options.finalModelId || "";
  const input = options.input || {};
  const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};

  if (def.type === "cvgig") {
    const result = await options.executors.cvGig.runCvGigWorkflow({
      input: options.query,
      topGigs: 8,
      remoteOnly: !!input.remoteOnly,
      profileModel: tierDef.models.FAST,
      cvModel: tierDef.models.STRONG,
      rankModel: finalModelId || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      jsearchKey: options.jsearchKey,
      jsearchAvailable: options.jsearchAvailable,
      callModel: options.callModel,
      fetchGigs: options.fetchGigs,
      onProgress: progress,
    });
    if (result.meta && result.meta.sourceCounts && Object.prototype.hasOwnProperty.call(result.meta.sourceCounts, "JSearch")) {
      options.onJsearchUsed();
    }
    return result;
  }

  if (def.type === "cryptodd") {
    return options.executors.cryptoDd.runCryptoDdWorkflow({
      input: options.query,
      chain: input.chain,
      address: input.token || input.address,
      intakeModel: tierDef.models.FAST,
      newsModel: tierDef.models.FAST,
      writerModel: finalModelId || tierDef.models.STRONG,
      verifierModel: tierDef.models.VERIFY || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      callModel: options.callModel,
      fetchData: options.fetchData,
      searchToken: options.searchToken,
      searchWeb: options.cryptoSearchWeb,
      onProgress: progress,
    });
  }

  if (def.type === "docgen") {
    const result = await options.executors.docGen.runDocGenWorkflow({
      docType: def.docType || input.docType || "proposal",
      input: options.query,
      brief: input.brief && typeof input.brief === "object" ? input.brief : {},
      research: !!input.research,
      format: "pdf",
      writerModel: finalModelId || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      today: options.today,
      callModel: options.callModel,
      searchWeb: options.searchWeb,
      onProgress: progress,
    });
    if (result.file && result.file.base64) result.file = options.persistDocument(result.file);
    return result;
  }

  return options.executors.engine.runWorkflowGraph({
    graph: options.graph,
    tierModels: tierDef.models,
    finalModelId,
    input: options.query,
    mode: options.mode,
    pastedSources: options.pastedSources,
    searchWeb: options.searchWeb,
    groupRatio: options.groupRatio,
    today: options.today,
    callModel: options.callModel,
    onProgress: progress,
  });
}
```

In `server.js`, construct the same injected values already used by the current code and call this function. Keep `workflowLimiter.recordCost`, payment settlement, response construction, and error/refund handling in their current locations for now.

- [ ] **Step 4: Verify extraction preserves behavior**

Run:

```bash
node test_workflow_execution.js
node test_workflow_engine.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
node --check server.js
```

Expected: all standalone tests report zero failures and syntax check exits 0.

- [ ] **Step 5: Commit the extraction**

```bash
git add workflow-execution.js test_workflow_execution.js server.js
git commit -m "Extract shared workflow execution"
```

---

### Task 4: Idempotent Settlement Adapter

**Files:**
- Create: `workflow-job-settlement.js`
- Create: `test_workflow_job_settlement.js`
- Modify: `run-escrow-client.js:35-94`
- Modify: `test_run_escrow.js`

**Interfaces:**
- Consumes: job, stored result, `runEscrow`, memo builder, and payment-refund store callbacks.
- Produces: `createWorkflowJobSettlement(options)` with `settle(job, result, hooks)` and `refund(job, hooks)`.
- `runEscrow.release`, `refund`, and `transferUsdc` accept optional `onSubmitted(txHash)` and invoke it before `await tx.wait(1)`.
- `runEscrow.getTransactionStatus(txHash)` returns `"confirmed"`, `"failed"`, or `"pending"`.

- [ ] **Step 1: Write failing settlement tests**

Test already-released escrow, fresh release, refunded escrow rejection, x402 no-op settlement, fresh x402 refund, and submitted-transaction reconciliation:

```js
const calls = [];
const runEscrow = {
  readRun: async () => ({ payer: PAYER, amount: 10000n, released: false, refunded: false }),
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
  getTransactionStatus: async () => "confirmed",
};

const adapter = createWorkflowJobSettlement({
  runEscrow,
  buildMemo: () => "workflow memo",
});
const settled = await adapter.settle(escrowJob, { steps: [] }, { onSubmitted: (h) => calls.push("submitted:" + h) });
assert.equal(settled.confirmed, true);
assert.deepEqual(calls, ["submitted:" + RELEASE_TX, "release"]);
```

For an existing `settlement.txHash`, assert the adapter calls `getTransactionStatus` and does not submit another transaction. For an escrow job whose on-chain state is already released/refunded, assert it returns the observed terminal state without sending.

- [ ] **Step 2: Run the settlement test and confirm RED**

Run: `node test_workflow_job_settlement.js`

Expected: FAIL with `Cannot find module './workflow-job-settlement'`.

- [ ] **Step 3: Add submission callbacks and settlement reconciliation**

Change each sending method in `run-escrow-client.js` to this pattern:

```js
async release(runId, memoText, onSubmitted) {
  const tx = await ensureTreasury().release(runId, toUtf8Bytes(String(memoText || "")));
  if (typeof onSubmitted === "function") onSubmitted(tx.hash);
  await tx.wait(1);
  return tx.hash;
}
```

Add:

```js
async getTransactionStatus(txHash) {
  const receipt = await ensureProvider().getTransactionReceipt(String(txHash || ""));
  if (!receipt) return "pending";
  return Number(receipt.status) === 1 ? "confirmed" : "failed";
}
```

Implement the adapter rules:

- Escrow success: read run, return confirmed if released, reject if refunded, reconcile stored transaction hash, otherwise submit release.
- Escrow failure: read run, return confirmed if refunded, reject if released, reconcile stored transaction hash, otherwise submit refund.
- x402 success: payment was direct, return `{ txHash: payment.reference, confirmed: true }`.
- x402 failure: reconcile stored refund hash or submit `transferUsdc(payer, amount)`.
- Gateway async: throw `gateway_async_unsupported` so it cannot be queued accidentally.

- [ ] **Step 4: Verify settlement and escrow regressions**

Run:

```bash
node test_workflow_job_settlement.js
node test_run_escrow.js
node --check run-escrow-client.js
```

Expected: all report zero failures and syntax check exits 0.

- [ ] **Step 5: Commit settlement changes**

```bash
git add workflow-job-settlement.js test_workflow_job_settlement.js run-escrow-client.js test_run_escrow.js
git commit -m "Add idempotent workflow job settlement"
```

---

### Task 5: Async Workflow HTTP API and Startup Recovery

**Files:**
- Modify: `server.js:97-150`
- Modify: `server.js:729-793`
- Modify: `server.js:838-850`
- Modify: `server.js:1685-2276`
- Create: `test_workflow_async_api.js`

**Interfaces:**
- Consumes: store, worker, execution, and settlement modules from Tasks 1-4.
- Produces: enhanced quote, `POST /run` async branch, `GET /api/workflows/runs/:jobId`, worker startup, and sanitized public job responses.
- Environment: `WORKFLOW_MCP_ASYNC_ENABLED`, `WORKFLOW_JOB_RESULT_TTL_HOURS`, `WORKFLOW_JOB_METADATA_TTL_HOURS`, `WORKFLOW_JOB_LEASE_MS`, and `WORKFLOW_JOB_POLL_MS`.

- [ ] **Step 1: Write failing source/API contract tests**

Follow the existing `FUNDLINE_NO_LISTEN=1` test pattern. Export only focused helpers needed by the test: `buildWorkflowJobResponse`, `workflowJobAuthorized`, and `queueAsyncWorkflowRun`. Test with a temporary injected store and fake payment/execution dependencies:

```js
process.env.FUNDLINE_NO_LISTEN = "1";
const serverModule = require("./server.js");

assert.equal(typeof serverModule.buildWorkflowJobResponse, "function");
assert.equal(typeof serverModule.queueAsyncWorkflowRun, "function");

const queued = await serverModule.queueAsyncWorkflowRun({
  store,
  jobId,
  ownerRateKey: "key:test",
  recoveryToken,
  payment: { mode: "escrow", reference: jobId, payer: PAYER, amount: "10000" },
  request: { slug: "client-research", tier: "normal", input: { prompt: "Acme" } },
  reserve: () => ({ ok: true, remaining: 9, resetsAt: "2026-07-24T00:00:00.000Z" }),
});
assert.equal(queued.statusCode, 202);
assert.equal(queued.body.status, "queued");

const retry = await serverModule.queueAsyncWorkflowRun(/* same payment reference */);
assert.equal(retry.body.jobId, queued.body.jobId);
assert.equal(retry.duplicate, true);
```

Add assertions that wrong recovery token returns 403, terminal result returns output, non-terminal result returns `retryAfterSeconds`, and no result exposes owner/request input.

- [ ] **Step 2: Run the async API test and confirm RED**

Run: `node test_workflow_async_api.js`

Expected: FAIL because `queueAsyncWorkflowRun` is not exported.

- [ ] **Step 3: Configure the job system and add routes**

At server configuration, parse:

```js
const WORKFLOW_MCP_ASYNC_ENABLED = /^(1|true|yes|on)$/i.test(String(process.env.WORKFLOW_MCP_ASYNC_ENABLED || ""));
const WORKFLOW_JOB_RESULT_TTL_HOURS = Number(process.env.WORKFLOW_JOB_RESULT_TTL_HOURS || 168) || 168;
const WORKFLOW_JOB_METADATA_TTL_HOURS = Number(process.env.WORKFLOW_JOB_METADATA_TTL_HOURS || 720) || 720;
const WORKFLOW_JOB_LEASE_MS = Number(process.env.WORKFLOW_JOB_LEASE_MS || 900000) || 900000;
const WORKFLOW_JOB_POLL_MS = Number(process.env.WORKFLOW_JOB_POLL_MS || 1000) || 1000;
```

Create the store under `path.join(DATA_DIR, "workflow-jobs")`. Add the detail route before `/api/workflows/runs`:

```js
const workflowRunDetailMatch = url.pathname.match(/^\/api\/workflows\/runs\/(0x[0-9a-fA-F]{64})$/);
if (workflowRunDetailMatch) {
  handleWorkflowJobStatus(req, res, workflowRunDetailMatch[1]);
  return;
}
```

Enhance `/quote` to accept `paymentMode: "escrow" | "x402"`, defaulting to escrow. Both modes create an `awaiting_payment` job and return `jobId`, `recoveryToken`, and status. Escrow also returns `runId`, escrow address, and the existing funding fields. Quoted x402 returns an `accepts` entry with canonical Arc USDC, exact amount, treasury recipient, and network; its payment reference remains empty until the retry supplies a verified transaction hash. Pass the validated optional API-key `rateKey` into the owner record.

- [ ] **Step 4: Add async enqueue and worker execution**

After existing payment validation but before rate reservation and synchronous transport setup, branch when `input.async === true && WORKFLOW_MCP_ASYNC_ENABLED`:

```js
const queued = await queueAsyncWorkflowRun({
  store: workflowJobStore,
  jobId: String(input.jobId || runId),
  recoveryToken: String(input.recoveryToken || req.headers["x-fundline-recovery-token"] || ""),
  ownerRateKey: agentAuth.ok ? agentAuth.rateKey : "",
  payment: resolvedPayment,
  request: { slug, tier, input },
  reserve: () => workflowLimiter.checkAndReserve({ ...paths, ipKey, kind: "run", limits: runLimits }),
});
sendJson(res, queued.statusCode, queued.body);
return;
```

`queueAsyncWorkflowRun` must first resolve an existing job by payment reference. A duplicate returns its current public status before reserving limits. For a new payment, bind payment and persist `queued` before consuming x402 or returning 202.

Construct the worker with:

- `executeJob`: call `executeWorkflowDefinition` with stored request data, renew lease on progress, record provider cost only after execution returns, and build the same result payload as synchronous runs.
- `settleJob`: call the Task 4 adapter.
- `refundJob`: roll back the reserved limiter unit, then call the Task 4 adapter.

Start it inside the existing successful `server.listen` callback next to Telegram and overdue jobs. Also start it when Passenger invokes the callback. Stop scheduling when the process is shutting down.

- [ ] **Step 5: Preserve synchronous browser and API behavior**

Keep requests without `async: true` on the existing path. The browser must still receive `text/event-stream`; synchronous API-key/x402 requests must still receive one JSON result. Use the extracted execution function from Task 3 for both paths.

Do not add the async Gateway path. If `input.async === true` resolves to Gateway, return HTTP 409 with `{ error: "gateway_async_unsupported" }` and leave the current synchronous Gateway flow unchanged.

- [ ] **Step 6: Run API and core regressions**

Run:

```bash
node test_workflow_async_api.js
node test_agent_api.js
node test_preflight.js
node test_premium_cost.js
node test_workflow_engine.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
node test_run_escrow.js
node --check server.js
```

Expected: all tests report zero failures and syntax check exits 0.

- [ ] **Step 7: Commit the async HTTP API**

```bash
git add server.js test_workflow_async_api.js
git commit -m "Add durable async workflow API"
```

---

### Task 6: Remote MCP Quote, Enqueue, and Poll Tools

**Files:**
- Create: `workflow-mcp-tools.js`
- Create: `test_workflow_mcp_tools.js`
- Modify: `server.js:1142-1474`

**Interfaces:**
- Consumes: `{ selfBase, forwardHeaders, fetchImpl, asyncEnabled }`.
- Produces: `MCP_TOOLS` and `createWorkflowMcpCallHandler(options)`.
- Adds `get_run({ jobId, recoveryToken })`.
- Returns human-readable `content` plus exact JSON `structuredContent` for quote, queued, non-terminal, successful, failed, and refunded states.

- [ ] **Step 1: Write failing MCP handler tests**

Use an injected fetch that records URLs and returns deterministic responses:

```js
const responses = [
  response(200, { jobId: JOB_ID, runId: JOB_ID, recoveryToken: TOKEN, status: "awaiting_payment", amount: "10000", amountUsdc: "0.010000", escrowAddress: ESCROW, usdc: USDC, chainId: 5042002 }),
  response(202, { jobId: JOB_ID, status: "queued", retryAfterSeconds: 3 }),
  response(200, { jobId: JOB_ID, status: "succeeded", result: { output: "# Done", priceUsdc: "0.010000" } }),
];
const handler = createWorkflowMcpCallHandler({ selfBase: "https://fundline.test", forwardHeaders: () => ({ "X-API-Key": "test" }), fetchImpl: fakeFetch(responses), asyncEnabled: true });

const quote = await handler("run_workflow", { slug: "client-research", tier: "normal", prompt: "Acme" });
assert.equal(quote.structuredContent.status, "awaiting_payment");
assert.equal(quote.structuredContent.recoveryToken, TOKEN);

const queued = await handler("run_workflow", { slug: "client-research", tier: "normal", prompt: "Acme", payment: { runId: JOB_ID, jobId: JOB_ID, recoveryToken: TOKEN } });
assert.equal(queued.structuredContent.status, "queued");

const done = await handler("get_run", { jobId: JOB_ID, recoveryToken: TOKEN });
assert.equal(done.structuredContent.result.output, "# Done");
```

Assert the first call targets `/quote`, the second targets `/run` with `async:true`, and the third targets `/api/workflows/runs/:jobId` with `X-Fundline-Recovery-Token`. Add a quoted-x402 case that first requests `paymentMode:"x402"` and then enqueues with `jobId`, `recoveryToken`, `payerWallet`, and `txHash`. Add a separate legacy `{payerWallet,txHash}` case without job credentials proving the existing synchronous `/run` flow remains accepted.

- [ ] **Step 2: Run MCP tests and confirm RED**

Run: `node test_workflow_mcp_tools.js`

Expected: FAIL with `Cannot find module './workflow-mcp-tools'`.

- [ ] **Step 3: Implement tool schemas and handler**

Define `run_workflow.paymentMode` as optional enum `escrow | x402` with escrow as the default. Define `run_workflow.payment` with optional `runId`, `jobId`, `recoveryToken`, `payerWallet`, and `txHash`. Add:

```js
{
  name: "get_run",
  description: "Read the status or durable result of an asynchronous Fundline workflow run.",
  inputSchema: {
    type: "object",
    properties: {
      jobId: { type: "string", description: "The jobId returned before payment." },
      recoveryToken: { type: "string", description: "The recovery token returned with the quote. Optional when the same Fundline API key owns the job." },
    },
    required: ["jobId"],
  },
}
```

Handler behavior:

- Async enabled, no payment: POST `/quote` with `{tier,async:true,prompt,paymentMode:args.paymentMode||"escrow"}`.
- Escrow payment: POST `/run` with `{tier,prompt,async:true,jobId,runId,recoveryToken}`.
- Quoted x402 payment: POST `/run` with `{tier,prompt,async:true,jobId,recoveryToken}` and the existing `X-PAYMENT` proof header.
- `get_run`: GET the job endpoint and forward recovery header when provided.
- Legacy x402 payment without job credentials: preserve current synchronous call and response.
- Async disabled: preserve all current MCP behavior.

All 2xx states return `structuredContent`. HTTP 202 is a successful MCP tool result, not `isError`. HTTP 401/403/409/5xx returns `isError: true` with a stable message.

- [ ] **Step 4: Replace embedded server MCP workflow logic**

Require the new module, use its `MCP_TOOLS`, and delegate CallTool requests to its handler. Keep server-specific `selfBase`, forwarded auth headers, and SDK transport setup in `server.js`. Remove only duplicated list/run/list-history logic now owned by the module.

- [ ] **Step 5: Verify MCP and API regressions**

Run:

```bash
node test_workflow_mcp_tools.js
node test_workflow_async_api.js
node test_agent_api.js
node --check server.js
```

Expected: all tests report zero failures and syntax check exits 0.

- [ ] **Step 6: Commit MCP changes**

```bash
git add workflow-mcp-tools.js test_workflow_mcp_tools.js server.js
git commit -m "Add asynchronous MCP workflow tools"
```

---

### Task 7: Configuration, Public Integration Docs, and Full Verification

**Files:**
- Modify: `.env.example:19-48`
- Modify: `docs.html:581-762`
- Modify: `server.js:1200-1260`
- Modify: `docs/superpowers/plans/2026-07-23-mcp-durable-async-runs.md`
- Test: all new and relevant existing `test_*.js` files

**Interfaces:**
- Documents the exact production flags and MCP quote/enqueue/poll sequence.
- Public docs expose only integrator-facing endpoints, fields, authentication, recovery, and retention. They do not expose lock paths, internal worker leases, anti-double-spend internals, secrets, or server file locations.

- [ ] **Step 1: Add environment documentation**

Add these values to `.env.example` next to workflow configuration:

```dotenv
# Durable asynchronous Remote MCP jobs. Keep false until the live Arc testnet recovery pass.
WORKFLOW_MCP_ASYNC_ENABLED=false
# Durable result and metadata retention. Non-terminal jobs are never removed.
WORKFLOW_JOB_RESULT_TTL_HOURS=168
WORKFLOW_JOB_METADATA_TTL_HOURS=720
# Worker lease and idle poll timing in milliseconds.
WORKFLOW_JOB_LEASE_MS=900000
WORKFLOW_JOB_POLL_MS=1000
```

- [ ] **Step 2: Update public MCP documentation**

Document this public flow in `docs.html` and generated `/llms.txt` copy:

```text
1. Call run_workflow without payment to receive jobId, runId, price, escrow address, and recoveryToken.
2. Fund the quoted runId through FundlineRunEscrow.
3. Call run_workflow again with jobId, runId, and recoveryToken. The tool returns queued immediately.
4. Call get_run with jobId and recoveryToken until status is succeeded, refunded, or failed.
5. Keep the recovery token private. A runId or transaction hash alone cannot read the output.
```

State that results remain retrievable for seven days. Keep legacy x402 documented as compatibility, not the recommended long-running MCP path. Do not publish internal verification or lock implementation details.

- [ ] **Step 3: Run the complete relevant verification suite**

Run:

```bash
node --check app.js
node --check server.js
node --check workflow-job-store.js
node --check workflow-job-worker.js
node --check workflow-execution.js
node --check workflow-job-settlement.js
node --check workflow-mcp-tools.js
node test_workflow_job_store.js
node test_workflow_job_worker.js
node test_workflow_execution.js
node test_workflow_job_settlement.js
node test_workflow_async_api.js
node test_workflow_mcp_tools.js
node test_agent_api.js
node test_preflight.js
node test_premium_cost.js
node test_workflow_engine.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
node test_workflow_limiter.js
node test_run_escrow.js
node test_ssrf_guard.js
```

Expected: every syntax check exits 0 and every standalone test reports zero failures.

- [ ] **Step 4: Run a local restart-recovery test with fakes**

Start a fake-provider job, stop the worker after it persists `processing`, advance the injected clock beyond the lease, create a second worker, and assert it completes. Repeat with a pre-existing result and assert the second worker calls settlement but not model execution.

Run: `node test_workflow_job_worker.js`

Expected: restart scenarios report `PASS` with zero failures.

- [ ] **Step 5: Review the complete diff against Fundline rules**

Run:

```bash
git diff --check
git diff --stat backup/pre-mcp-upgrade-20260723...HEAD
git diff backup/pre-mcp-upgrade-20260723...HEAD -- . ':!package-lock.json'
```

Confirm no secrets, em dashes, emoji UI copy, public internal-verification details, 18-decimal USDC assumptions, unrelated formatting, or user-owned untracked files entered the diff. Use the project `diff-reviewer` agent for the mandatory read-only pre-commit review.

- [ ] **Step 6: Commit documentation and verification updates**

```bash
git add .env.example docs.html server.js docs/superpowers/plans/2026-07-23-mcp-durable-async-runs.md
git commit -m "Document durable MCP run recovery"
```

- [ ] **Step 7: Keep deployment disabled pending live approval**

Do not push and do not set `WORKFLOW_MCP_ASYNC_ENABLED=true`. Report the exact local test evidence, commits, remaining live Arc Testnet lifecycle step, and the rollback branch `backup/pre-mcp-upgrade-20260723` to the user.
