# MCP Durable Async Runs Design

## Summary

Fundline's deployed Remote MCP currently holds a Streamable HTTP tool call open while a
paid workflow executes. The underlying workflow endpoint returns one JSON response for MCP
and API clients, while the browser uses SSE. Neither path durably stores the Markdown or
JSON result. If the caller disconnects after payment and the server finishes successfully,
the payment can settle while the caller loses the only copy of the output.

This change makes Remote MCP workflow execution asynchronous and recoverable without
changing the existing browser SSE experience. Fundline will create a durable job before
accepting a paid execution, return HTTP 202 with a job identifier, execute the job through a
disk-backed worker, persist the result before settlement, and expose polling through both an
HTTP endpoint and a new MCP tool.

## Goals

- Return quickly from paid Remote MCP workflow calls instead of holding the MCP request open.
- Make completed Markdown, JSON, and generated-file references recoverable after disconnects.
- Make retries idempotent by escrow run ID or x402 transaction hash.
- Persist a successful result before releasing escrowed USDC.
- Resume or reconcile interrupted jobs after a Passenger restart.
- Preserve current browser SSE behavior and existing payment-verification checks.
- Preserve compatibility with legacy x402 MCP callers while making escrow the preferred MCP
  payment path.

## Non-Goals

- No PostgreSQL, Supabase, MongoDB, Redis, BullMQ, or external worker service in this phase.
- No workflow-result webhook in this phase. Polling is the recovery contract for MCP clients.
- No smart contract change or redeployment. The existing one-hour `claimRefund` backstop stays.
- No redesign of workflow prompts, model routing, pricing, or CheapKey fallback.
- No migration of the browser workflow UI from SSE to polling in this phase.

## Constraints and Deployment Assumptions

- Production runs on Node.js 20 under cPanel Phusion Passenger.
- The repository uses CommonJS, two-space indentation, and double quotes.
- The deployed app currently has no configured external database or message queue.
- The FTP deployment excludes `data/`, so disk-backed job data survives code deploys.
- More than one Passenger process may exist. Job writes and claims must therefore be safe
  across processes, not only within one Node.js process.
- USDC amounts remain raw six-decimal base units.
- Public transaction hashes and on-chain run IDs are not authorization secrets.

## Current Behavior

The Remote MCP `run_workflow` handler forwards a paid request to
`POST /api/workflows/:slug/run` and awaits the final JSON response. The workflow endpoint
executes model calls, settles payment, records limited run metadata, and only then returns the
output. `GET /api/workflows/runs` and the MCP `list_runs` tool return metadata such as slug,
tier, price, and settlement transaction, but not the generated output or execution status.

Remote MCP currently prefers direct x402 payment to the treasury. The separate local MCP
example defaults to FundlineRunEscrow. The existing workflow endpoint also supports escrow
run IDs and Circle Gateway authorizations.

## Chosen Architecture

### Durable job store

Add a focused job-store module backed by individual JSON files under
`data/workflow-jobs/`. Each job has one metadata file and, after successful generation, one
result file. Separate files avoid rewriting a single large JSON database whenever output
changes.

Writes use a temporary file in the same directory followed by an atomic rename. Job mutation
uses lock files created with exclusive create semantics. A stale lock carries a timestamp and
may be reclaimed after its lease expires. The store exposes a narrow interface so a future
PostgreSQL adapter can replace it without changing MCP or workflow execution code.

The store also maintains payment-reference records so an escrow run ID or Arc x402
transaction hash maps to exactly one job. Creating the same mapping twice returns the existing
job. It never creates a second execution for the same payment.

### Job worker

Add a worker module that claims queued jobs with a lease, runs at a bounded concurrency of one,
and renews its lease between workflow stages. Every Passenger process may start a worker, but
the disk claim ensures that only one process owns a job at a time.

At startup and on each scan, the worker treats a `processing` job with an expired lease as
recoverable. Recovery depends on the last durable stage:

- No result exists: return the job to `queued` and execute it again.
- A result exists and settlement is incomplete: skip all model calls and reconcile settlement.
- On-chain settlement already completed: record the observed terminal state without sending a
  duplicate transaction.

### Existing synchronous execution

Extract the workflow execution and settlement logic from the HTTP response lifecycle into a
callable service. The current browser `/run` handler will call that service synchronously and
continue emitting SSE progress. The async worker will call the same service with a durable job
context and no HTTP response dependency.

This shared service prevents prompt-chain, cost-accounting, payment, and refund logic from
drifting between synchronous browser runs and asynchronous MCP runs.

## Job Data Model

Each metadata file has this logical shape:

```json
{
  "version": 1,
  "jobId": "0x32-byte-id",
  "status": "awaiting_payment",
  "owner": {
    "apiKeyFingerprint": "key:sha256-or-global",
    "recoveryTokenHash": "sha256",
    "payer": "0xaddress"
  },
  "request": {
    "slug": "client-research",
    "tier": "normal",
    "input": {}
  },
  "payment": {
    "mode": "escrow",
    "reference": "0xrunId-or-txHash",
    "amount": "10000",
    "status": "awaiting_payment"
  },
  "execution": {
    "attempts": 0,
    "workerId": "",
    "leaseUntil": "",
    "resultStored": false,
    "errorCode": ""
  },
  "settlement": {
    "status": "pending",
    "txHash": ""
  },
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601",
  "completedAt": ""
}
```

The public job states are:

- `awaiting_payment`: a quote exists but funding has not been verified.
- `queued`: payment is verified and the job is ready for a worker.
- `processing`: a worker owns the current lease.
- `settlement_pending`: a durable result exists but release or capture needs reconciliation.
- `succeeded`: result is durable and payment settlement is complete.
- `failed`: workflow execution failed before a refund was confirmed.
- `refunding`: a refund transaction is being submitted or reconciled.
- `refunded`: failure is durable and the payment was returned or never captured.

The result file stores the existing workflow result payload, including output, public step
metadata, CV or risk JSON where present, generated-file reference, price, memo, and settlement
reference. Internal provider cost and secrets are not exposed.

## API Contract

### Enhanced quote

`POST /api/workflows/:slug/quote` remains backward compatible and adds:

```json
{
  "jobId": "0x32-byte-id",
  "runId": "0x32-byte-id",
  "recoveryToken": "high-entropy-bearer-token",
  "status": "awaiting_payment"
}
```

For escrow, `jobId` and `runId` are the same bytes32 value. The quote is persisted before the
response is sent. Only the SHA-256 hash of `recoveryToken` is stored.

### Async execution

Remote MCP submits the funded run through the existing workflow run endpoint with
`async: true`, `jobId`, `runId`, and `recoveryToken`. After validating input, authentication,
funding, amount, payer, settlement state, and rate limits, the server transitions the existing
job to `queued` and returns HTTP 202:

```json
{
  "jobId": "0x32-byte-id",
  "status": "queued",
  "retryAfterSeconds": 3,
  "statusUrl": "/api/workflows/runs/0x32-byte-id"
}
```

A retry with the same escrow run ID or x402 transaction hash returns the existing job and its
current status. It does not reserve another run or execute another workflow.

Requests without `async: true` retain the current synchronous JSON or SSE behavior.

### Job retrieval

Add `GET /api/workflows/runs/:jobId`. Authorization succeeds when either:

- The request carries the same valid Fundline API-key fingerprint recorded on the job.
- The request carries the original recovery token in `X-Fundline-Recovery-Token`.

A public transaction hash, payer address, or run ID alone never authorizes result access. A
wallet-signature retrieval method may be added later without changing the stored owner shape.

Non-terminal responses include status, timestamps, payment mode, and `retryAfterSeconds`.
Terminal successful responses include the existing result payload. Failed or refunded responses
include a stable error code and a non-sensitive message.

### MCP tools

Change `run_workflow` to prefer escrow:

1. With no payment, create a persisted quote and return structured funding instructions,
   `jobId`, `runId`, and `recoveryToken`.
2. With funded `runId`, `jobId`, and `recoveryToken`, enqueue the job and return structured
   status immediately.

Add `get_run` with `jobId` and `recoveryToken`. It returns the same state and result as the HTTP
status endpoint. Human-readable text remains in `content`; machine-readable state is returned in
`structuredContent`.

Legacy `payment={payerWallet,txHash}` remains accepted through the current synchronous
compatibility path. New asynchronous x402 execution requires a persisted pre-payment quote and
recovery token, so a no-key caller always possesses a recovery credential before paying. New MCP
descriptions and examples present escrow as the recommended path.

## State and Settlement Ordering

### Successful escrow job

1. Verify the funded escrow run and create or resolve its job mapping.
2. Persist `queued` before returning HTTP 202.
3. Claim and persist `processing` with a lease.
4. Execute the workflow and compute its existing cost metadata.
5. Atomically persist the complete result file.
6. Persist `settlement_pending` with `resultStored: true`.
7. Read the escrow run. If unsettled, call `release()` with the existing memo.
8. Read or wait for confirmed on-chain state.
9. Persist settlement transaction and `succeeded`.

No path calls `release()` before step 5 succeeds.

### Failed escrow job

1. Persist the stable execution error and `failed` state.
2. Persist `refunding` before submitting a transaction.
3. Read the escrow run and call `refund()` only if it is still unsettled.
4. Confirm the on-chain state and persist `refunded`.
5. If the treasury cannot submit the refund, leave the job recoverable in `refunding`. The payer
   retains the existing one-hour `claimRefund()` backstop.

### x402 compatibility

For new asynchronous x402 calls, the server persists a quote and recovery token before the caller
pays. The job mapping is persisted before the x402 transaction is marked consumed. A failed
execution uses the existing treasury USDC refund path and records `refunding` before submission.
If a retry arrives with a consumed transaction that already maps to a job, the server returns that
job instead of `already_settled`.

An old MCP client that submits only `payment={payerWallet,txHash}` without a pre-issued job and
recovery token continues through the existing synchronous path. This compatibility path does not
claim disconnect recovery for anonymous callers. A valid API-key caller may still bind its legacy
x402 run to that key fingerprint.

### Gateway compatibility

Gateway remains capture-after-success. Async Gateway authorization is outside the first MCP
cutover unless its signed authorization can be safely retained. Existing synchronous Gateway
behavior is unchanged.

## Retention and Privacy

- Successful and failed result files are retained for seven days by default.
- Job metadata is retained for thirty days by default.
- Configure retention with `WORKFLOW_JOB_RESULT_TTL_HOURS` and
  `WORKFLOW_JOB_METADATA_TTL_HOURS`.
- Cleanup never deletes a non-terminal job.
- Prompts and outputs remain under the existing server-only `data/` directory and are excluded
  from FTP deployment and git.
- Logs may include job ID, state, and sanitized error code, but never prompts, outputs, API keys,
  recovery tokens, or private payment authorizations.

## Failure Handling

- Atomic write failure before enqueue: return an error and do not consume the payment reference.
- Client disconnect after HTTP 202: job execution is unaffected and the result remains pollable.
- Process crash before result persistence: an expired lease requeues the job.
- Process crash after result persistence: reconciliation skips model execution and settles only.
- Ambiguous settlement transaction: read on-chain state before retrying release or refund.
- Result persistence succeeds but settlement repeatedly fails: expose `settlement_pending` and keep
  retrying without rerunning the workflow.
- Both execution and refund fail: expose `refunding`; never report `refunded` without confirmed
  on-chain evidence.
- A stale or revoked API key cannot read a job unless the caller also has its recovery token.

## Security and Payment Integrity

- Keep the existing exact payer, recipient, canonical Arc USDC address, six-decimal amount, and
  receipt-success verification for x402.
- Keep the existing escrow checks for payer, exact tier amount, and unreleased/unrefunded state.
- Preserve the Arc-only transaction-hash anti-reuse guard and bind each hash to one durable job.
- Use constant-time comparison for recovery-token hashes.
- Validate every job ID before using it in a filesystem path.
- Lock and temporary file paths stay inside `data/workflow-jobs/`.
- Do not add an owner, admin-withdraw, fee, or alternate escrow recipient path.

## Test Strategy

Add standalone Node.js tests following the repository convention:

- Job-store create, read, atomic update, invalid path rejection, stale-lock recovery, and cleanup.
- Cross-process-style claim contention: two workers cannot claim the same queued job.
- State transition validation and terminal-state immutability.
- Idempotent mapping for escrow run ID and x402 transaction hash.
- Recovery of an expired `processing` lease with and without a stored result.
- Successful ordering assertion: result write completes before the fake release call.
- Failed ordering assertion: error persists before the fake refund call.
- Settlement reconciliation reads chain state before submitting a duplicate transaction.
- API-key fingerprint and recovery-token authorization, including revoked and wrong credentials.
- HTTP 202 enqueue response and `GET /api/workflows/runs/:jobId` polling responses.
- MCP `run_workflow` quote and enqueue structured data plus `get_run` terminal output.
- Regression tests for synchronous browser SSE, JSON agent runs, x402 exact-payment verification,
  anti-reuse behavior, escrow refund, and workflow cost accounting.

## Rollout

1. Deploy the durable store, shared execution service, worker, polling endpoint, and MCP tools with
   async MCP disabled by default behind `WORKFLOW_MCP_ASYNC_ENABLED=false`.
2. Run offline tests and a local restart-recovery test using fake providers and fake settlement.
3. Run one live Arc Testnet escrow lifecycle: quote, fund, enqueue, restart during processing,
   poll, persist result, and release.
4. Enable async MCP in production while retaining legacy x402 compatibility.
5. Monitor queued age, lease recovery, settlement-pending age, refund-pending age, and disk usage.
6. Add workflow-result webhooks only after polling and recovery are stable.

## Acceptance Criteria

- A new escrow-first or quoted-x402 Remote MCP call returns a durable job response without waiting
  for workflow completion.
- Disconnecting the MCP client cannot destroy a result that the backend completed.
- The same escrow run ID or x402 transaction hash never runs or charges twice.
- Escrow release never occurs before the complete result is durably stored.
- A Passenger restart recovers queued work and reconciles post-result settlement.
- Authorized polling returns the exact stored Markdown/JSON result.
- Unauthorized polling by public run ID or transaction hash is rejected.
- Existing browser SSE and synchronous API behavior continue to pass their regression tests.
- Existing one-hour payer `claimRefund()` remains available and unchanged.
