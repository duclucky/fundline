# Web Workflow Async Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paid browser workflows use configured Arc RPC fallback, bounded transaction confirmation, and the same durable async job recovery contract as MCP.

**Architecture:** Add a dependency-free browser runtime for RPC rotation, receipt waiting, job polling, and wallet-scoped recovery records. The browser quotes the exact workflow request, funds escrow, enqueues the durable job, and polls authorized status instead of holding SSE open. Server changes expose async capability, return stored output during settlement reconciliation, and retry submitted settlement transactions on a short fenced schedule.

**Tech Stack:** Node.js 20, CommonJS, vanilla browser JavaScript, Arc JSON-RPC, existing JSON-backed workflow job store/worker, ethers v6 on the server.

## Global Constraints

- The primary Arc RPC remains the configured `ARC_RPC_URL`; fallback URLs are public, ordered, and non-secret.
- Rotate RPC only on connection timeout, HTTP 429, HTTP 5xx, or JSON-RPC `-32011`.
- Never rebroadcast approval or escrow funding solely because an RPC read failed.
- Browser durable jobs use escrow and preserve `jobId`, `runId`, and recovery capability.
- Recovery tokens never appear in URLs or logs.
- Quote and run request inputs must match exactly after server control fields are removed.
- Store AI output before settlement and never rerun model calls during settlement reconciliation.
- Preserve USDC six-decimal price units and the FundlineRunEscrow non-custodial invariant.
- Do not stage or overwrite the pre-existing changes in `workflow-mcp-tools.js` and `test_workflow_mcp_tools.js`.

---

### Task 1: Testable Browser RPC and Recovery Runtime

**Files:**
- Create: `workflow-browser-runtime.js`
- Create: `test_workflow_browser_runtime.js`
- Modify: `workflows.html:115-119`

**Interfaces:**
- Produces: `normalizeRpcUrls(config) -> string[]`.
- Produces: `createRpcReadProvider({ rpcUrls, fetchImpl, rpcTimeoutMs })`.
- Produces: `waitForReceipt({ request, txHash, timeoutMs, pollMs, now, sleep })`.
- Produces: `createRecoveryStore(storage, key)`.
- Produces: `fetchRunStatus({ fetchImpl, jobId, recoveryToken, timeoutMs })`.

- [ ] **Step 1: Write the failing runtime tests**

Create `test_workflow_browser_runtime.js`:

```js
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
    sleep: async (ms) => { now += ms; },
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
  store.put({
    version: 1,
    jobId: "0x" + "3".repeat(64),
    runId: "0x" + "3".repeat(64),
    recoveryToken: "secret",
    wallet: "0x" + "a".repeat(40),
    slug: "client-research",
    tier: "normal",
    createdAt: "2026-07-23T00:00:00.000Z",
  });
  assert.equal(store.listForWallet("0x" + "a".repeat(40)).length, 1);
  assert.equal(store.listForWallet("0x" + "b".repeat(40)).length, 0);

  const statusCalls = [];
  const status = await runtime.fetchRunStatus({
    fetchImpl: async (url, options) => {
      statusCalls.push({ url, options });
      return response(202, { jobId: "0x" + "3".repeat(64), status: "processing", retryAfterSeconds: 1 });
    },
    jobId: "0x" + "3".repeat(64),
    recoveryToken: "secret",
    timeoutMs: 100,
  });
  assert.equal(status.status, "processing");
  assert.equal(statusCalls[0].options.headers["X-Fundline-Recovery-Token"], "secret");
}

main().then(() => console.log("PASS: workflow browser runtime")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the runtime test and verify RED**

```powershell
node test_workflow_browser_runtime.js
```

Expected: FAIL because `workflow-browser-runtime.js` does not exist.

- [ ] **Step 3: Implement the UMD runtime**

Implement a UMD/CommonJS module. `normalizeRpcUrls` trims, validates `http:`/`https:`, preserves
order, removes duplicates, and falls back to `https://rpc.testnet.arc.network` only when config
contains no usable URL.

`createRpcReadProvider` sends JSON-RPC with an `AbortController`. For each URL, retry the next URL
only when:

```js
function canRotate(error) {
  return error.code === -32011
    || error.code === "rpc_timeout"
    || error.status === 429
    || Number(error.status) >= 500;
}
```

It returns `{ request({method, params}) }` and never exposes a transaction-send method.

`waitForReceipt` performs the receipt request before sleeping, throws on `status === "0x0"`, returns
on success, and throws an error with `code = "transaction_confirmation_timeout"` after the
wall-clock deadline.

`createRecoveryStore` stores a JSON array. It validates `jobId`, `runId`, wallet, token, slug, and
tier; ignores malformed JSON; upserts by `jobId`; lists only records whose normalized wallet
matches; and removes by `jobId`.

`fetchRunStatus` calls:

```js
fetch(`/api/workflows/runs/${encodeURIComponent(jobId)}`, {
  headers: {
    "Accept": "application/json",
    "X-Fundline-Recovery-Token": recoveryToken,
  },
  signal,
});
```

It accepts HTTP 200 and 202 and throws for other statuses.

- [ ] **Step 4: Load the runtime before the workflow UI**

Add:

```html
<script src="/workflow-browser-runtime.js"></script>
```

immediately before `/workflows.js`.

- [ ] **Step 5: Run the runtime test and syntax checks**

```powershell
node test_workflow_browser_runtime.js
node --check workflow-browser-runtime.js
```

Expected: both pass.

- [ ] **Step 6: Commit the browser runtime**

```powershell
git add workflow-browser-runtime.js test_workflow_browser_runtime.js workflows.html
git commit -m "Add durable workflow browser runtime"
```

### Task 2: Public Async and RPC Fallback Configuration

**Files:**
- Modify: `server.js:80-140`
- Modify: `server.js:968-1009`
- Modify: `.env.example`
- Modify: `test_workflow_async_api.js`

**Interfaces:**
- Consumes: `ARC_RPC_URL`, `WORKFLOW_MCP_ASYNC_ENABLED`.
- Produces: public `rpcFallbackUrls: string[]` and `workflowAsyncEnabled: boolean`.

- [ ] **Step 1: Add failing config source assertions**

Add to `test_workflow_async_api.js`:

```js
const serverSource = fs.readFileSync("server.js", "utf8");
assert.match(serverSource, /ARC_RPC_FALLBACK_URLS/);
assert.match(serverSource, /rpcFallbackUrls:/);
assert.match(serverSource, /workflowAsyncEnabled:\s*WORKFLOW_MCP_ASYNC_ENABLED/);
```

- [ ] **Step 2: Run the async API test and verify RED**

```powershell
node test_workflow_async_api.js
```

Expected: FAIL on missing public config fields.

- [ ] **Step 3: Parse and expose fallback URLs**

Add:

```js
const ARC_RPC_FALLBACK_URLS = String(process.env.ARC_RPC_FALLBACK_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter((value) => /^https?:\/\//i.test(value) && value !== ARC_RPC_URL);
```

Add to `handlePublicConfig`:

```js
rpcFallbackUrls: ARC_RPC_FALLBACK_URLS,
workflowAsyncEnabled: WORKFLOW_MCP_ASYNC_ENABLED,
```

Document:

```dotenv
# Optional comma-separated public Arc RPC read fallbacks. The app rotates only on timeout,
# HTTP 429, HTTP 5xx, or JSON-RPC -32011.
ARC_RPC_FALLBACK_URLS=https://rpc.testnet.arc.network
```

- [ ] **Step 4: Run the async API test and syntax check**

```powershell
node test_workflow_async_api.js
node --check server.js
```

Expected: pass.

- [ ] **Step 5: Commit public workflow reliability config**

```powershell
git add server.js .env.example test_workflow_async_api.js
git commit -m "Expose workflow RPC fallback config"
```

### Task 3: Browser Quote, Fund, Enqueue, Poll, and Resume

**Files:**
- Modify: `workflows.js:1046-1197`
- Modify: `workflows.js:2024-2257`
- Modify: `workflows.js:2492-2517`
- Modify: `test_workflow_browser_runtime.js`

**Interfaces:**
- Consumes: `window.FundlineWorkflowRuntime`, `workflowAsyncEnabled`, existing quote/run/status endpoints.
- Produces: `buildWorkflowRunInput(opts)`, `runDurableWorkflow(slug, wf, opts)`, and `resumeDurableWorkflow(record)`.

- [ ] **Step 1: Extend runtime tests for durable record lifecycle**

Add assertions that:

```js
const record = {
  version: 1,
  jobId: "0x" + "4".repeat(64),
  runId: "0x" + "4".repeat(64),
  recoveryToken: "second-secret",
  wallet: "0x" + "a".repeat(40),
  slug: "client-research",
  tier: "normal",
  createdAt: "2026-07-23T00:01:00.000Z",
};
store.put(record);
store.put({ ...record, tier: "plus" });
assert.equal(store.listForWallet(record.wallet).length, 1);
assert.equal(store.listForWallet(record.wallet)[0].tier, "plus");
store.remove(record.jobId);
assert.equal(store.listForWallet(record.wallet).length, 0);
storage.setItem("fundline-workflow-jobs-v1", "{bad-json");
assert.deepEqual(store.listForWallet(record.wallet), []);
```

Add a `fetchRunStatus` case where HTTP 200 returns `succeeded` with `result.file`, and assert the
result is returned unchanged.

- [ ] **Step 2: Run the runtime test and verify RED**

```powershell
node test_workflow_browser_runtime.js
```

Expected: FAIL until recovery upsert/removal and terminal result behavior are complete.

- [ ] **Step 3: Build one canonical workflow request object**

Extract the existing request-body assembly into:

```js
function buildWorkflowRunInput(opts) {
  const input = {
    prompt: opts.prompt,
    mode: opts.mode,
    tier: opts.tier || "normal",
  };
  if (opts.sources && opts.sources.length) input.sources = opts.sources;
  if (opts.chain) input.chain = opts.chain;
  if (opts.token) input.token = opts.token;
  if (opts.brief && Object.keys(opts.brief).length) input.brief = opts.brief;
  if (opts.research) input.research = opts.research;
  return input;
}
```

Use the exact same `runInput` for quote and enqueue so the server's quote request comparison
remains byte-for-byte equivalent after control fields are removed.

- [ ] **Step 4: Replace hardcoded Circle read RPC and receipt loop**

Replace `circleReadShim()` with:

```js
function circleReadShim() {
  return window.FundlineWorkflowRuntime.createRpcReadProvider({
    rpcUrls: window.FundlineWorkflowRuntime.normalizeRpcUrls(WF_CONFIG),
    fetchImpl: window.fetch.bind(window),
    rpcTimeoutMs: 10000,
  });
}
```

Replace the sixty-iteration `waitWalletTx` loop with:

```js
function waitWalletTx(provider, hash) {
  return window.FundlineWorkflowRuntime.waitForReceipt({
    request: (method, params) => provider.request({ method, params }),
    txHash: hash,
    timeoutMs: 60000,
    pollMs: 2000,
  });
}
```

The helper checks immediately. A confirmation timeout displays the transaction hash and does not
resubmit.

- [ ] **Step 5: Quote and persist before funding**

Change the async quote body to:

```js
const quoteBody = {
  ...runInput,
  async: true,
  paymentMode: "escrow",
};
```

After the quote response and before approve/fund, write:

```js
recoveryStore.put({
  version: 1,
  jobId: quote.jobId,
  runId: quote.runId,
  recoveryToken: quote.recoveryToken,
  wallet: from,
  slug,
  tier: runInput.tier,
  createdAt: new Date().toISOString(),
});
```

Do not store prompt, sources, result, or artifacts in local storage.

- [ ] **Step 6: Enqueue and poll the durable job**

After funding, POST:

```js
{
  ...runInput,
  async: true,
  jobId: quote.jobId,
  runId: quote.runId,
  recoveryToken: quote.recoveryToken,
  stream: false,
}
```

Treat HTTP 202 as accepted. Poll through `fetchRunStatus`, waiting
`Math.max(1, body.retryAfterSeconds || 1) * 1000`. Update workflow node text for `queued`,
`processing`, `settlement_pending`, and `refunding`.

When `body.result` exists, call the existing `showRunResult` once. If status is
`settlement_pending`, keep the recovery record and continue polling in the background. Remove
the record only for `succeeded`, `refunded`, or `failed`.

- [ ] **Step 7: Resume authorized records after reload**

After public config and wallet session are ready, list records for the connected wallet. For the
record matching the open workflow slug, call the same poll function. Also retry this on a wallet
session change and when the document becomes visible.

If a record is still `awaiting_payment`, show the existing `runId` and a resume action. The resume
action calls `/run` with:

```js
{
  async: true,
  resume: true,
  jobId: record.jobId,
  runId: record.runId,
  recoveryToken: record.recoveryToken,
  tier: record.tier,
  stream: false,
}
```

Server support for this control-only resume is added in Task 4.

- [ ] **Step 8: Keep synchronous SSE as capability fallback**

Use the durable path only when `WF_CONFIG.workflowAsyncEnabled === true`. Keep the existing SSE
function unchanged for older deployments where the capability is false.

Move `maybeSwitchToArc()` into the successful `/api/config` continuation so the embedded read
provider uses configured RPC URLs.

- [ ] **Step 9: Run browser runtime and syntax checks**

```powershell
node test_workflow_browser_runtime.js
node test_workflow_graph.js
node --check workflows.js
```

Expected: all pass.

- [ ] **Step 10: Commit browser async orchestration**

```powershell
git add workflows.js test_workflow_browser_runtime.js
git commit -m "Run web workflows as durable jobs"
```

### Task 4: Resume Enqueue and Result Visibility During Settlement

**Files:**
- Modify: `server.js:1651-1760`
- Modify: `server.js:2075-2155`
- Modify: `server.js:2360-2435`
- Modify: `test_workflow_async_api.js`

**Interfaces:**
- Consumes: existing durable quote owner authorization and stored request.
- Produces: `hydrateWorkflowResumeInput(input, existingJob) -> effectiveInput`.
- Produces: control-only `resume: true` enqueue and `resultReady` on `settlement_pending`.

- [ ] **Step 1: Add failing settlement result assertions**

In `test_workflow_async_api.js`, after storing the result and transitioning to
`settlement_pending`, assert before transitioning to succeeded:

```js
const pendingResult = serverModule.buildWorkflowJobResponse(store, store.getJob(JOB_ID));
assert.equal(pendingResult.statusCode, 202);
assert.equal(pendingResult.body.status, "settlement_pending");
assert.equal(pendingResult.body.resultReady, true);
assert.equal(pendingResult.body.result.output, "# Durable result");
assert.equal(Object.hasOwn(pendingResult.body, "owner"), false);
assert.equal(Object.hasOwn(pendingResult.body.request, "input"), false);
```

Add a source assertion for `resume` being stripped by `workflowJobRequestInput`.
Add a pure helper assertion:

```js
const resumed = serverModule.hydrateWorkflowResumeInput({
  async: true,
  resume: true,
  recoveryToken: "secret",
}, {
  jobId: JOB_ID,
  request: {
    tier: "normal",
    input: { prompt: "Private prompt", mode: "search" },
  },
  payment: { reference: JOB_ID },
});
assert.equal(resumed.prompt, "Private prompt");
assert.equal(resumed.mode, "search");
assert.equal(resumed.jobId, JOB_ID);
assert.equal(resumed.runId, JOB_ID);
assert.equal(resumed.resume, true);
```

- [ ] **Step 2: Run the async API test and verify RED**

```powershell
node test_workflow_async_api.js
```

Expected: FAIL because pending responses do not include stored results.

- [ ] **Step 3: Return authorized stored results while settlement is pending**

Change `buildWorkflowJobResponse`:

```js
if (job.execution && job.execution.resultStored) {
  const result = store.getResult(job.jobId);
  if (result) {
    body.resultReady = true;
    body.result = result;
  } else {
    body.resultExpired = true;
  }
}
```

Keep HTTP 202 for non-terminal states and HTTP 200 for `succeeded` and `refunded`.

- [ ] **Step 4: Support control-only resume without storing prompt in the browser**

Add `"resume"` to the fields removed by `workflowJobRequestInput`.

Add and export:

```js
function hydrateWorkflowResumeInput(input, existingJob) {
  return {
  ...existingJob.request.input,
  async: true,
  resume: true,
  jobId: existingJob.jobId,
  runId: existingJob.payment.reference,
  recoveryToken: input.recoveryToken,
  stream: false,
  };
}
```

After optional API-key validation and job authorization, when `input.async === true`,
`input.resume === true`, and the existing job is `awaiting_payment`, call this helper. Perform
prompt/tier/payment validation against the result. Queue with
`existingJob.request` rather than a newly reconstructed request. Require the matching recovery
token before reading the stored input. Calls without `resume: true` retain the current strict
quote/request comparison.

- [ ] **Step 5: Add and run resume regression assertions**

Extend `test_workflow_async_api.js` with a quoted `awaiting_payment` job and assert:

```js
assert.equal(serverModule.workflowJobRequestInput({
  async: true,
  resume: true,
  jobId: JOB_ID,
  runId: JOB_ID,
  recoveryToken: "secret",
}), {});
```

Export `workflowJobRequestInput` for this offline assertion.

Run:

```powershell
node test_workflow_async_api.js
node --check server.js
```

Expected: pass.

- [ ] **Step 6: Commit async recovery API behavior**

```powershell
git add server.js test_workflow_async_api.js
git commit -m "Expose workflow results during settlement"
```

### Task 5: Short Fenced Settlement Retry

**Files:**
- Modify: `workflow-job-store.js:314-379`
- Modify: `workflow-job-worker.js:9-18`
- Modify: `workflow-job-worker.js:127-153`
- Modify: `server.js:109-112`
- Modify: `server.js:1948-1961`
- Modify: `.env.example`
- Modify: `test_workflow_job_store.js`
- Modify: `test_workflow_job_worker.js`

**Interfaces:**
- Produces: `store.deferRetry(jobId, allowedStatuses, lease, delayMs)`.
- Consumes: worker settlement catch path and existing lease fencing.

- [ ] **Step 1: Write failing store retry tests**

Add to `test_workflow_job_store.js`:

```js
const claimed = store.claimNext({ workerId: "worker-a", leaseMs: 60000 });
const lease = {
  workerId: claimed.execution.workerId,
  leaseToken: claimed.execution.leaseToken,
};
store.storeResult(jobId, { output: "stored", steps: [] }, lease);
store.transition(jobId, ["processing"], "settlement_pending", {}, lease);
store.deferRetry(jobId, ["settlement_pending"], lease, 5000);
assert.equal(store.claimNext({ workerId: "worker-b", leaseMs: 60000 }), null);
store.advanceClock(4999);
assert.equal(store.claimNext({ workerId: "worker-b", leaseMs: 60000 }), null);
store.advanceClock(1);
assert.equal(store.claimNext({ workerId: "worker-b", leaseMs: 60000 }).jobId, jobId);
assert.throws(
  () => store.deferRetry(jobId, ["settlement_pending"], lease, 5000),
  /lease owner|lease token|state precondition/,
);
```

- [ ] **Step 2: Run store tests and verify RED**

```powershell
node test_workflow_job_store.js
```

Expected: FAIL because `deferRetry` does not exist.

- [ ] **Step 3: Implement fenced retry deferral**

Add:

```js
function deferRetry(jobId, allowedStatuses, lease, delayMs) {
  return mutate(jobId, (job) => {
    if (!allowedStatuses.includes(job.status)) throw new Error("Workflow job state precondition failed");
    assertLease(job, lease);
    return {
      ...job,
      updatedAt: new Date(now()).toISOString(),
      execution: mergePatch(job.execution, {
        leaseUntil: now() + Math.max(1, Number(delayMs) || 1),
      }),
    };
  });
}
```

Expose it on the returned store object.

- [ ] **Step 4: Write the failing worker reconciliation test**

Add a worker test where first settlement throws and second succeeds:

```js
let executions = 0;
let settlements = 0;
const worker = createWorkflowJobWorker({
  store,
  workerId: "retry-worker",
  settlementRetryMs: 5000,
  executeJob: async () => {
    executions += 1;
    return { output: "stored once", steps: [] };
  },
  settleJob: async () => {
    settlements += 1;
    if (settlements === 1) throw new Error("receipt pending");
    return { txHash: "0x" + "9".repeat(64), confirmed: true };
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
```

- [ ] **Step 5: Run worker tests and verify RED**

```powershell
node test_workflow_job_worker.js
```

Expected: FAIL because the worker still leaves the full execution lease.

- [ ] **Step 6: Use a five-second settlement schedule**

Add `settlementRetryMs` option in the worker. After updating the job to
`execution.errorCode = "settlement_pending"`, call:

```js
store.deferRetry(
  job.jobId,
  ["settlement_pending"],
  controls.lease,
  settlementRetryMs,
);
```

Apply the same fenced defer behavior to `refund_pending`.

Add server configuration:

```js
const WORKFLOW_SETTLEMENT_RETRY_MS = Math.max(
  1000,
  Number(process.env.WORKFLOW_SETTLEMENT_RETRY_MS || 5000) || 5000,
);
```

Pass it into `createWorkflowJobWorker`. Document it in `.env.example`.

- [ ] **Step 7: Run job store and worker tests**

```powershell
node test_workflow_job_store.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
```

Expected: all pass; execution count remains one across settlement retries.

- [ ] **Step 8: Commit settlement scheduling**

```powershell
git add workflow-job-store.js workflow-job-worker.js server.js .env.example test_workflow_job_store.js test_workflow_job_worker.js
git commit -m "Retry workflow settlement promptly"
```

### Task 6: Bound Treasury Confirmation Waits

**Files:**
- Modify: `run-escrow-client.js:20-24`
- Modify: `run-escrow-client.js:70-106`
- Modify: `server.js:380-410`
- Modify: `.env.example`
- Create: `test_run_escrow_client_wait.js`
- Modify: `test_run_escrow.js`

**Interfaces:**
- Produces: `waitForConfirmation(tx, { confirmations, timeoutMs })`.
- Consumes: escrow release/refund/transfer submission paths and worker settlement deferral.

- [ ] **Step 1: Write the failing confirmation helper test**

Create `test_run_escrow_client_wait.js`:

```js
"use strict";

const assert = require("assert");
const { waitForConfirmation } = require("./run-escrow-client");

async function main() {
  const receipt = { status: 1 };
  assert.equal(await waitForConfirmation({
    wait: async (confirmations) => {
      assert.equal(confirmations, 1);
      return receipt;
    },
  }, { confirmations: 1, timeoutMs: 100 }), receipt);

  await assert.rejects(async () => {
    try {
      await waitForConfirmation({ wait: async () => new Promise(() => {}) }, {
        confirmations: 1,
        timeoutMs: 5,
      });
    } catch (error) {
      assert.equal(error.code, "transaction_confirmation_timeout");
      throw error;
    }
  }, /confirmation timed out/);
}

main().then(() => console.log("PASS: run escrow confirmation wait")).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the wait test and verify RED**

```powershell
node test_run_escrow_client_wait.js
```

Expected: FAIL because `waitForConfirmation` is missing.

- [ ] **Step 3: Implement bounded confirmation**

Add:

```js
function waitForConfirmation(tx, options = {}) {
  const confirmations = Math.max(1, Number(options.confirmations) || 1);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 30000);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Transaction confirmation timed out.");
      error.code = "transaction_confirmation_timeout";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([tx.wait(confirmations), timeout]).finally(() => clearTimeout(timer));
}
```

Read `confirmationTimeoutMs` from client config and replace all three `tx.wait(1)` calls with
`waitForConfirmation(tx, { confirmations: 1, timeoutMs: confirmationTimeoutMs })`. Preserve the
submission callback before waiting.

Export `waitForConfirmation`.

- [ ] **Step 4: Configure the server timeout**

Add:

```js
const WORKFLOW_SETTLEMENT_CONFIRM_TIMEOUT_MS = Math.max(
  1000,
  Number(process.env.WORKFLOW_SETTLEMENT_CONFIRM_TIMEOUT_MS || 30000) || 30000,
);
```

Pass `confirmationTimeoutMs` into `createRunEscrowClient` and document it in `.env.example`.

- [ ] **Step 5: Run escrow and workflow settlement tests**

```powershell
node test_run_escrow_client_wait.js
node test_run_escrow.js
node test_workflow_job_settlement.js
node test_workflow_job_worker.js
node --check run-escrow-client.js
node --check server.js
```

Expected: all pass and submission hashes are recorded before any timeout.

- [ ] **Step 6: Commit bounded settlement confirmation**

```powershell
git add run-escrow-client.js server.js .env.example test_run_escrow_client_wait.js test_run_escrow.js
git commit -m "Bound workflow settlement confirmation"
```

### Task 7: Workflow Acceptance and Recovery Gate

**Files:**
- Verify: workflow browser, API, store, worker, settlement, escrow, and syntax tests

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: independently shippable durable browser workflow change.

- [ ] **Step 1: Run the complete offline workflow suite**

```powershell
node test_workflow_browser_runtime.js
node test_workflow_async_api.js
node test_workflow_job_store.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
node test_workflow_execution.js
node test_workflow_model_provider.js
node test_run_escrow_client_wait.js
node test_run_escrow.js
node test_workflow_graph.js
node --check workflow-browser-runtime.js
node --check workflows.js
node --check server.js
```

Expected: all pass.

- [ ] **Step 2: Verify the original failure modes**

Confirm from tests and source:

```text
Embedded wallet RPC comes from /api/config.
Receipt check occurs before the first sleep.
Receipt waiting ends after sixty seconds without rebroadcast.
Browser billing quote contains async:true and the exact run input.
HTTP 202 starts authorized polling.
Reload uses the same jobId and recovery token.
settlement_pending exposes the stored result to the authorized caller.
Settlement retries after five seconds and never reruns model execution.
Treasury tx confirmation reaches the retry path after thirty seconds.
```

- [ ] **Step 3: Review the scoped diff and secret safety**

```powershell
git diff HEAD~6 -- .env.example server.js workflows.html workflows.js workflow-browser-runtime.js workflow-job-store.js workflow-job-worker.js run-escrow-client.js test_workflow_browser_runtime.js test_workflow_async_api.js test_workflow_job_store.js test_workflow_job_worker.js test_run_escrow_client_wait.js
git status --short
```

Expected: no recovery tokens, private keys, or operational wallet values are committed. The
pre-existing MCP artifact edits remain unstaged unless separately approved.
