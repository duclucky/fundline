# Circle Wallet integration spec (agent-side, v1)

Status: DRAFT, not built. Decisions locked with user 2026-07: agents pay for workflow
runs (and hold USDC) using their OWN Circle Developer-Controlled Wallet; Fundline does
NOT provision or custody agent wallets (non-custodial preserved). Write spec first.

## Goal

Let an AI agent fund and run Fundline workflows using a Circle Developer-Controlled
Wallet (DCW) on Arc, instead of managing a raw private key. This is purely the agent's
funding method: it plugs into the existing agent API (`/quote` -> fund escrow -> `/run`)
with NO change to Fundline's server. Fundline's deliverables are docs + a runnable demo
agent + publishing the escrow ABI/addresses (already in GET /api/config).

## Why no server change

`/api/workflows/:slug/run` verifies a funded run on-chain via `runEscrow.readRun(runId)`
(payer set, amount == price, not settled). It does not care HOW the run was funded (browser
wallet, ethers, or Circle DCW). So Circle Wallet support is entirely agent-side. Confirmed
by the agent-api build already shipped.

## Non-custodial stance

The agent's Circle API key + entity secret are the AGENT'S and live in the agent's own
environment. Fundline never sees them and never holds agent funds. The per-run escrow keeps
its invariant: a funded run can only release to the treasury (workflow provider) on success
or refund to the agent's wallet on failure; the agent can `claimRefund(runId)` after the
~1h window if the treasury goes silent. Circle DCW custody is the agent's own, not Fundline's.

## Circle facts (researched 2026-07)

- SDK: `@circle-fin/developer-controlled-wallets`. Init with `{ apiKey, entitySecret }`.
  Entity secret is registered once in the Circle developer console.
- Arc is supported: `createWallets({ blockchains: ["ARC-TESTNET"], count, walletSetId })`
  (mainnet enum when Arc mainnet ships). USDC is the Arc gas token.
- Contract calls: `createContractExecutionTransaction({ walletId, contractAddress,
  abiFunctionSignature, abiParameters, fee: { type:"level", config:{ feeLevel:"LOW" } } })`.
  Returns `{ id, state:"INITIATED" }`; poll `getTransaction({ id })` until
  `state === "COMPLETE"`, which carries the txHash.
- Circle Agent Stack adds user-defined spend controls on agent wallets (time-bound USDC
  limits, allowlists/blocklists, x402 service limits) enforced before execution. An agent
  owner can restrict the wallet to only pay the Fundline escrow, which pairs well with this.

## Agent run flow with a Circle DCW

Contract addresses + price come from `GET /api/config` (`runEscrowAddress`,
`usdcTokenAddress`, `chainId`, `workflowPrices`). ABIs (verified against
contracts/FundlineRunEscrow.sol):
- USDC: `approve(address spender, uint256 amount)`
- FundlineRunEscrow: `fund(bytes32 runId, uint256 amount)`,
  `claimRefund(bytes32 runId)` (agent backstop).
- Amounts are 6-decimal USDC base units as strings (0.03 USDC = "30000").

Steps:
1. `POST /api/workflows/:slug/quote` with `X-API-Key` -> `{ runId, amount, escrowAddress, usdc, chainId }`.
2. Circle: `approve(escrowAddress, amount)` on `usdc` (once; may approve a large amount to
   skip re-approving each run). Poll to COMPLETE.
3. Circle: `fund(runId, amount)` on `escrowAddress`. Poll to COMPLETE.
4. `POST /api/workflows/:slug/run` with `X-API-Key`, `Accept: application/json`, body
   `{ runId, tier, ...workflow inputs }` -> JSON `{ output, cvJson?, steps, costUsd,
   releaseTx, memo, runId }`.
On failure the server refunds automatically; else the agent may `claimRefund(runId)` after
the window.

## Deliverables (build after this spec is approved)

1. `examples/circle-agent-demo.js` (or `agent-examples/`): a runnable Node script using
   `@circle-fin/developer-controlled-wallets`. Reads the AGENT's own creds from env
   (`CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `FUNDLINE_API_KEY`, `FUNDLINE_BASE_URL`,
   `WORKFLOW_SLUG`). Does: config -> quote -> approve (if needed) -> fund -> run -> print
   the result + releaseTx. Includes a short comment on registering the entity secret and
   funding the Circle wallet from the Arc testnet faucet (10 USDC/hr). NOT wired into the
   server; a standalone example. `@circle-fin/developer-controlled-wallets` is a demo-only
   dependency (do NOT add it to the app package.json; the demo has its own note to
   `npm i` it, keeping the buildless app dependency-free).
2. docs.html #agent-api: a "Pay with a Circle Wallet" subsection showing the same flow with
   the Circle SDK snippets (approve + fund + run), placeholders only, and a link to Circle's
   DCW docs. Note the non-custodial point and spend controls.
3. Publish the escrow `fund`/`claimRefund` ABI in the docs so agents using any signer (not
   just Circle) can fund. Addresses already come from /api/config.
4. Optional: a `GET /api/config` addition of the escrow ABI fragment or a static
   `contracts/FundlineRunEscrow.abi.json` link, so agents do not hand-write the ABI. (The
   ABI JSON already exists in the repo; just reference it in docs.)

## Explicitly NOT in scope

- Fundline provisioning/holding Circle wallets or entity secrets for agents (rejected:
  custodial).
- Any change to `/quote`, `/run`, escrow, or billing (none needed).
- Circle Gateway nanopayments / x402 path (future; separate from escrow-fund).
- Adding the Circle SDK as an app runtime dependency (demo-only).

## Testing

- The demo requires live Circle creds + a funded Arc testnet Circle wallet, so it cannot run
  offline. Provide it as a documented, runnable example; do a single live end-to-end run with
  the user's Circle creds when available (quote -> approve -> fund -> run -> release).
- No new server unit tests (server unchanged). Re-run test_agent_api.js to confirm the run
  path still accepts a funded runId regardless of signer.

## Hard rules

English, no em dashes, no emojis, CommonJS, 2-space, double quotes. Secrets (Circle key +
entity secret, Fundline key) come from env, NEVER committed. USDC 6 decimals. Non-custodial
preserved: Fundline never holds the agent's Circle credentials or funds.
