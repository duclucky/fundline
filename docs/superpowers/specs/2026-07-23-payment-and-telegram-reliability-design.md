# Payment and Telegram Reliability Design

## Summary

Fundline currently has three user-visible reliability gaps:

1. Saving a Telegram chat ID creates a pending link, while the web UI reports success as if
   the bot were ready to create invoices.
2. Invoice verification can fall through from a transaction-scoped lookup into broad,
   sequential Arcscan and RPC scans that take minutes.
3. The web workflow page still confirms payment and runs the workflow through a long-lived
   synchronous browser connection. Enabling durable MCP jobs does not change this browser
   path, and embedded wallets still read Arc through a hardcoded RPC URL.

This change makes each state explicit and recoverable. Telegram remains user-confirmed through
`/start`; invoice verification uses a bounded transaction-first path; and the web workflow page
uses the existing durable async job API rather than holding an SSE request open.

## Goals

- Show the real Telegram link state as `not_linked`, `pending`, or `active`.
- Require a Telegram `/start` confirmation before enabling bot invoice creation.
- Repair missing or mismatched pending Telegram link records when settings are saved.
- Keep PaymentRouter event verification as the highest-priority invoice payment proof.
- Make a supplied transaction hash a strictly transaction-scoped verification path.
- Bound no-hash invoice discovery so one request cannot scan an unbounded number of receipts.
- Remove fixed ten-second invoice verification delays and replace them with immediate,
  deadline-bounded receipt checks.
- Use the RPC URL returned by `GET /api/config`, with the documented Arc RPC fallback policy,
  instead of a workflow-specific hardcoded endpoint.
- Move browser workflow runs onto the existing durable `202 Accepted` job contract.
- Persist enough browser-side recovery data to resume a paid run after reload or disconnect.
- Preserve six-decimal ERC-20 USDC handling and the non-custodial escrow invariant.

## Non-Goals

- No Telegram webhook migration in this change. Long polling remains the inbound transport.
- No PostgreSQL, Redis, BullMQ, or external worker service.
- No smart contract modification or redeployment.
- No workflow model, prompt, tier, or price changes.
- No change to the MCP tool contract beyond sharing reliability helpers where appropriate.
- No change to CCTP domains or bridge settlement.
- No automatic activation of a Telegram link from an outbound test message.

## Approaches Considered

### Approach A: Minimal UI and timeout hotfix

Update Telegram copy, stop broad invoice scanning when a hash is present, and shorten frontend
poll intervals. Keep browser workflow execution on synchronous SSE.

This has the smallest diff, but a paid workflow is still tied to one browser connection and
cannot be recovered reliably after a reload.

### Approach B: Reuse durable jobs across MCP and web

Keep the existing Telegram confirmation boundary, make invoice verification deterministic, and
move the web workflow page onto the durable quote, enqueue, and polling APIs already used by MCP.

This is the selected approach. It fixes the observed waits without adding new infrastructure and
keeps one workflow execution and recovery contract for both agents and people.

### Approach C: External queue, database, and Telegram webhook

Move jobs and Telegram updates to externally managed services with multi-worker concurrency.

This is the long-term production architecture, but it materially expands deployment scope and is
not required to correct the current logic.

## Telegram Link Design

### State contract

Authenticated seller settings responses include:

```json
{
  "settings": {
    "telegramChatId": "123456789"
  },
  "telegramLinkStatus": "pending"
}
```

The status values are:

- `not_linked`: no chat ID is saved or no claim belongs to the seller.
- `pending`: the seller saved the chat ID, but that Telegram chat has not confirmed it.
- `active`: the chat sent `/start` after the claim and can use the invoice menu.

The status is derived from the Telegram link store. It is not inferred from whether an outbound
test message succeeded.

### Save and repair behavior

When an authenticated seller saves a non-empty chat ID, the backend ensures that the link store
contains a claim for that seller and chat. It creates or repairs the claim when:

- the chat ID changed;
- the record is missing;
- the record points to a different seller; or
- the seller record and link record disagree.

An already active, matching link remains active when unrelated settings are saved. Clearing the
chat ID removes the seller's claim without affecting another seller.

### Activation and UI behavior

Only an inbound `/start` from the claimed chat transitions `pending` to `active`. This preserves
proof that the user controls the Telegram chat.

After a pending save, the UI displays:

> Saved. Open @Fundline_bot and send /start to finish linking.

It provides a normal Telegram link to the bot. The button currently named `Verify Telegram`
becomes a test-message action. Its success copy says only that a test message was delivered.
It never claims that linking or alerts are active.

The settings page refreshes the authenticated settings after a save or test and renders the
server-provided status. Bot invoice creation is documented as available only in the active state.

### Inbound transport diagnostics

The current long-poll transport remains unchanged. If `/start` does not move a known pending link
to active, the operational diagnostic remains the polling startup and failure logs. A webhook or
cross-process polling leader is a separate deployment project.

## Invoice Verification Design

### Verification priority and correctness

The verifier preserves this priority:

1. A successful PaymentRouter `InvoicePaid` event bound to the invoice ID.
2. A canonical Arc USDC ERC-20 `Transfer` with exact payer, merchant, and six-decimal amount.
3. The existing native-USDC fallback, with exact payer, merchant, and amount.

All accepted paths require a transaction hash. The existing `(chainId, txHash)` reuse guard and
paid-transition idempotency remain mandatory.

### Transaction-hash fast path

When `criteria.txHash` is present:

1. Read the receipt immediately through the configured Arc RPC.
2. Check the PaymentRouter event and canonical USDC transfer logs.
3. If required for legacy explorer-shaped data, query only transaction-scoped Arcscan endpoints.
4. Return the matching payment or `null`.

The function must not continue into recent transaction, token-transfer, or native-transfer scans.
A caller retry repeats only this bounded path.

### No-hash discovery path

Manual verification without a hash remains supported, but is explicitly bounded:

- Fetch at most two recent transaction pages.
- Before requesting a receipt, filter candidates to transactions whose destination is the
  configured PaymentRouter.
- Request receipts for at most twenty filtered candidates.
- Preserve the existing bounded token-transfer and native-transfer fallbacks.

The response distinguishes `not_indexed`, `not_found`, `rpc_timeout`, and `explorer_timeout`
internally so the UI does not present every infrastructure failure as an indexing delay.

### Browser polling

Wallet payment verification performs an immediate first check, then polls with a short interval
until a wall-clock deadline. It does not sleep ten seconds before the first attempt.

Every browser fetch and EIP-1193 RPC read used by verification has an application timeout.
When the deadline expires, the UI retains the transaction hash and offers a retry. It does not
submit another payment or imply that the transaction failed on chain.

The initial target is:

- immediate first check;
- two-second retry interval;
- sixty-second verification deadline;
- ten-second timeout for each browser network operation.

These values are constants so tests can use shorter injected timing.

## Web Workflow Async Design

### Shared RPC configuration

The workflow page reads `rpcUrl` and `rpcFallbackUrls` from `GET /api/config`. The primary URL
remains the configured dRPC endpoint. Public fallback URLs are supplied through the non-secret
`ARC_RPC_FALLBACK_URLS` server setting and returned in their configured order. The Circle and
Privy read shim uses that configuration. No workflow code hardcodes
`https://rpc.testnet.arc.network`.

RPC rotation is allowed only for connection timeout, HTTP 429, HTTP 5xx, or JSON-RPC `-32011`.
Before rebroadcasting any transaction, the wallet logic checks the transaction by hash on the
next RPC. The browser never sends a duplicate fund transaction solely because one RPC read
failed.

### Bounded transaction confirmation

Approval and escrow funding use one shared confirmation helper:

- check the receipt immediately;
- apply a timeout to every RPC read;
- poll at a short interval until a sixty-second wall-clock deadline;
- report `approval_submitted`, `approval_confirming`, `funding_submitted`, or
  `funding_confirming`;
- preserve the transaction hash on timeout for recovery.

Embedded Circle wallets must not run a second full sixty-iteration confirmation loop after the
wallet adapter has already returned a transaction hash.

### Durable quote and enqueue

The browser requests a quote with:

```json
{
  "tier": "normal",
  "async": true,
  "paymentMode": "escrow",
  "prompt": "request-specific input"
}
```

The browser stores `jobId`, `runId`, `recoveryToken`, workflow slug, tier, and non-sensitive UI
metadata in local storage before asking the wallet to fund the run. The recovery token is a
capability secret and is not logged, placed in a URL, or sent anywhere except the Fundline job
endpoints.

After funding is confirmed, the browser calls `/api/workflows/:slug/run` with `async: true`,
`jobId`, `runId`, and `recoveryToken`. HTTP 202 is the expected success response.

### Polling and recovery

The browser polls `GET /api/workflows/runs/:jobId` with
`X-Fundline-Recovery-Token`. It honors `retryAfterSeconds` and renders:

- `awaiting_payment`;
- `queued`;
- `processing`;
- `settlement_pending`;
- `refunding`;
- `succeeded`;
- `refunded`; or
- `failed`.

On reload, the workflow page finds unfinished local records and resumes polling. It never creates
or funds a replacement job to recover a paid run. A terminal response updates run history and
removes the recovery token from local storage after the result is rendered.

Successful results use the existing result modal and artifact handling. Markdown, structured
JSON, and every generated file artifact remain visible to the user and recoverable from the
durable result.

### Settlement pending behavior

AI output is stored before settlement. A submitted release or refund transaction is reconciled
without rerunning model calls.

Settlement receipt retries use their own short retry schedule rather than waiting for the
fifteen-minute execution lease. A pending settlement response includes an appropriate
`retryAfterSeconds`, and worker reconciliation rechecks the submitted transaction with bounded
RPC reads. This work does not change who may release or refund funds.

For an authorized caller, a `settlement_pending` response includes `resultReady: true` and the
stored result. The UI renders that result immediately while separately showing that on-chain
settlement is pending. This matches the synchronous path, which already delivers successful
output when an escrow release submission cannot be confirmed. The recovery token remains
required for every result read.

## Error Handling

- A Telegram test-message failure does not change link state.
- A Telegram poller failure does not mark a pending link active.
- Invoice RPC and explorer timeouts return retryable errors without changing an invoice to paid.
- A wrong amount, recipient, asset, invoice reference, reverted receipt, or reused transaction
  leaves the invoice unpaid.
- A workflow payment confirmation timeout preserves `jobId`, `runId`, and transaction hash.
- A duplicate workflow enqueue returns the existing job.
- A browser disconnect does not cancel a queued or processing job.
- A workflow execution failure follows the existing escrow refund path.
- Settlement retries never rerun the paid model workflow.

## Security and Privacy

- Telegram link status is returned only through authenticated seller settings.
- `/start` remains the proof-of-chat-control action.
- Recovery tokens are bearer capabilities; only their hashes are stored server-side.
- Public run IDs and transaction hashes do not authorize result retrieval.
- USDC remains six-decimal integer math throughout invoice and workflow billing.
- No owner or admin withdrawal path is introduced.
- No private key, API key, recovery token, or operational wallet is exposed in public docs or UI.

## Testing Strategy

All behavioral changes follow test-first development.

### Telegram tests

- Saving a new chat ID returns `pending`.
- Re-saving an unchanged active link preserves `active`.
- Re-saving an unchanged chat ID repairs a missing or mismatched claim.
- A test message does not activate a pending link.
- `/start` transitions the correct pending link to active and creates the main-menu session.
- Settings responses expose the correct link status without exposing link-store internals.

### Invoice verification tests

- A supplied hash never calls recent-list scanners after transaction-scoped checks fail.
- No-hash router discovery filters candidates by PaymentRouter destination and enforces the cap.
- Wrong amount, recipient, asset, reference, reverted receipt, and reused hash remain rejected.
- Six-decimal exact amounts continue to pass.
- The browser verifier checks immediately, respects the deadline, and retains the hash on timeout.

### Workflow tests

- The browser quote requests `async: true` and stores recovery credentials before funding.
- The browser enqueue handles HTTP 202 as success.
- Polling honors `retryAfterSeconds` and resumes after a simulated reload.
- Terminal results use the existing Markdown, JSON, and file artifact rendering.
- The receipt helper checks immediately, rotates RPC only for allowed errors, and stops at the
  wall-clock deadline.
- Circle and Privy reads use config RPCs and do not contain a hardcoded Arc RPC.
- Settlement-pending jobs reconcile on the settlement schedule without rerunning execution.

### Regression checks

- Telegram link, long-poll, session, and invoice tests.
- Invoice amount, native-transfer fallback, memo payment, and payment reuse tests.
- Workflow async API, store, worker, settlement, execution, model-provider, and MCP tests.
- `node --check app.js`, `node --check workflows.js`, and `node --check server.js`.

## Deployment and Observability

The change uses existing environment configuration and does not require a new secret. Production
must keep `WORKFLOW_MCP_ASYNC_ENABLED=true`; the name remains for compatibility even though the
same durable path is now used by the web page.

Operational logs must distinguish:

- Telegram polling failures;
- invoice RPC timeout versus explorer timeout;
- workflow enqueue, execution, and settlement reconciliation failures.

No sensitive recovery token or private key may appear in logs.

## Acceptance Criteria

- A seller who saves a Telegram chat ID sees `pending` until that chat sends `/start`.
- After `/start`, the bot displays the invoice menu and settings report `active`.
- A supplied invoice transaction hash never triggers a broad recent-history scan.
- A normal Arc transaction is checked immediately and either confirms or reaches a bounded,
  retryable timeout.
- Workflow payment reads use the configured dRPC endpoint and allowed fallback policy.
- Starting a browser workflow returns control through a durable job instead of a long-lived SSE
  run request.
- Reloading the page resumes the same paid job and does not create a second payment.
- Completed workflow Markdown, JSON, and generated artifacts render through the existing result
  UI.
- Settlement reconciliation does not rerun model calls and does not wait for the execution lease.
- Payment matching, six-decimal math, anti-reuse protection, and non-custodial escrow behavior
  remain intact.
