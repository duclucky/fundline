# Agent API spec: create invoices + run workflows (v1)

Status: DRAFT, building. Goal: let an AI agent (headless code with an Arc wallet)
(1) create invoices and (2) run workflows via HTTP with an API key. Decisions locked
with user 2026-07 (payment for runs = escrow-fund headless).

Non-custodial invariant holds: the agent funds its OWN per-run escrow from its OWN
wallet; the treasury only releases to itself as the workflow provider (identical to
the human browser flow). No new custody, no owner-withdraw.

## Auth

- Per-seller API keys, already implemented: `requireAgentApiKey` (Authorization: Bearer
  <key> OR `X-API-Key`), SHA-256 hashed in data/api-keys.json, scoped to the seller wallet
  (`req.agentSellerId`). Global env key (FUNDLINE_API_KEY / ARC_INVOICE_API_KEY) = admin.
- GAP: the issuance handlers (`handleDashboardApiKeys` / `handleDashboardApiKeyById`) exist
  but are NOT routed. Wire them under the existing wallet-signature seller auth
  (`requireSellerAuth`) so a user mints/lists/revokes keys from the dashboard.

## Part 1: Invoices (mostly done)

`POST /api/agent/invoices` already works: X-API-Key auth, idempotency (Idempotency-Key),
merchantWallet forced to the key's seller, returns `{ invoice }` with `paymentLink`.
GET list/by-id, PATCH, DELETE also present. Action items: (a) wire key issuance so users
can get a key; (b) document it publicly. No handler changes needed.

## Part 2: Workflow runs (the gap)

Agent flow (escrow-fund headless):
1. `GET /api/config` -> runEscrowAddress, usdcTokenAddress, chainId, workflowPrices, workflowBillingEnabled.
2. `POST /api/workflows/:slug/quote` -> `{ runId, tier, amount, amountUsdc, escrowAddress, usdc, chainId }`.
3. Agent signs, from its own Arc wallet: USDC `approve(escrow, amount)` (once, can be max) then
   `fund(runId, amount)` on FundlineRunEscrow. (Standard ERC-20 + contract call; any agent with
   a key can do this with ethers/viem.)
4. `POST /api/workflows/:slug/run` with `X-API-Key`, body `{ slug fields..., runId, tier }`,
   header `Accept: application/json` -> ONE JSON response (not SSE):
   `{ output, cvJson?, steps, costUsd, releaseTx, memo, runId }`.

### Changes to build

- `optionalAgentApiKey(req)`: validate an API key IF present (same logic as requireAgentApiKey
  but returns `{ ok, sellerId }` and never writes a 401). Absent key -> `{ ok:false }` and the
  endpoint keeps its current IP-based browser behavior. This keeps the browser frontend working
  (it calls /quote and /run with no key).
- `/run` JSON mode: if `Accept: application/json` (or body `stream === false`), buffer the run
  and return a single JSON object instead of the SSE stream. Same billing/verify/release path;
  only the transport differs. Progress events are dropped in JSON mode (agents want the result).
- Rate limiting: when a valid key is present, key the limiter on `key:<sellerId-or-hash>` instead
  of the client IP, using `WORKFLOW_KEY_LIMITS` (high per-key runsPerDay so paying agents are not
  blocked by the free-tier count) while KEEPING the global daily v98 budget backstop (real cost
  guard; beta bills testnet USDC but v98 cost is real). No key -> unchanged IP limits.
- `/quote`: accept the key optionally (for symmetry / future per-key quoting). Leave open otherwise;
  it only issues a runId and reads config, no cost.
- Non-JSON, no-key path: unchanged (browser SSE).

### What is explicitly reused (no new code)

Escrow verify (`runEscrow.readRun`: payer set, amount==price, not settled), the executor dispatch
(engine or cvgig), `workflowLimiter.recordCost`, treasury `release`/`refund` with InvoiceMemo,
the response fields. Only auth + transport + limiter key change.

## Dashboard UI

Add an "API keys" section (dashboard.html/js): create (name -> show secret once), list
(prefix + created + lastUsed), revoke. Reuses `/api/dashboard/api-keys` routes under seller auth.

## Public docs

docs.html/docs.js: an "Agent API" section: auth (X-API-Key), create invoice (curl example with
placeholder key + wallet), run workflow (config -> quote -> fund -> run JSON). Placeholders only,
no real keys/wallets. Keep the internal verification recipe out (docs policy).

## Rate/cost notes

- Global `WORKFLOW_DAILY_BUDGET_USD` ($10) stays ON as the real-cost backstop even for paid runs
  (beta: user pays testnet USDC, v98 cost is real USD).
- Per-key run count high in beta; revisit when moving to real revenue + x402/prepaid options.

## Future (not v1)

- x402 for workflow runs (402 + X-PAYMENT direct pay) as a lighter alternative to escrow-fund.
- Prepaid on-chain credit balance per key (fund once, run many) to cut per-run tx overhead.

## Tests

- `optionalAgentApiKey`: present-valid, present-invalid, absent -> correct {ok, sellerId}.
- JSON-mode selection: Accept header / stream flag chooses JSON vs SSE (unit-test the predicate).
- Reuse existing escrow/billing dry-run tests for the settlement path (unchanged).

## Hard rules

English, no em dashes, no emojis, CommonJS, 2-space, double quotes. No secret committed. USDC 6
decimals. Non-custodial preserved.
