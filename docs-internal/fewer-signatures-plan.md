# Plan: cut the USDC pay flow to 1 wallet signature

Internal design note. NOT deployed (docs-internal/ is excluded from the cPanel FTP deploy).
Keep this out of the public docs.html per the Docs publishing policy in CLAUDE.md.

Status: direction approved, decisions locked. No code written yet.

## Goal

The payer signs too many times. Current counts:

- Same-chain (already has USDC on Arc): 2 signatures (approve + payInvoice), or 1 if the
  allowance is preset.
- Cross-chain (CCTP bridge-and-pay from Sepolia/Base): up to 5 signatures
  (approve source + depositForBurn + receiveMessage mint + approve Arc + payInvoice)
  plus 2 network switches.

Target: 1 signature for the payer in both cases, while preserving the non-custodial
invariant (no owner/admin path can withdraw user or escrowed funds).

Two approaches, both verified against Arc/Circle docs and on-chain:

- B. Arc Multicall3From for same-chain Arc payments (batch approve + payInvoice in one
  signed tx).
- A. Circle Gateway (unified USDC balance) for cross-chain payments.

## Locked decisions

- B (same-chain): use ARC MULTICALL3FROM, not EIP-3009. On Arc the gas token IS USDC, so
  the payer already holds the gas asset; "gasless" buys little, while EIP-3009 would force
  either a merchant Collect step or a Fundline relayer. Multicall3From gives 1 signature,
  instant settlement, no Collect, no relayer, no Fundline hot key, and NO new contract
  (reuses the live PaymentRouter v1).
- A (cross-chain): Circle Gateway. Credentials NOT yet obtained; registration steps are in
  Part A below.
- Build order: B first (client-only, low risk), then A.

## Verified facts (on-chain + docs.arc.io, June 2026)

- Multicall3From: 0x522fAf9A91c41c443c66765030741e4AaCe147D0 (deployed on Arc testnet,
  confirmed via eth_getCode, ~3180 bytes). Batches subcalls while PRESERVING the original
  msg.sender, routed through the Arc CallFrom precompile (0x1800.. range). Docs explicitly
  cite "batch token approvals" as the use case.
- PaymentRouter v1: 0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24 (still deployed; payInvoice +
  InvoicePaid). No new contract needed for B.
- Permit2 (0x000000000022D473030F116dDEE9F6B43aC78BA3) and Multicall3
  (0xcA11bde05977b3631167028862bE2a173976CA11) are also on Arc, available as fallbacks.
- Circle Gateway is non-custodial (users keep control; Circle cannot move USDC without a
  user-signed burn intent) and Arc is integrated. Source: developers.circle.com/gateway.

---

## Part B. Same-chain Arc via Multicall3From (payer signs once)

No new Solidity. Pure client-side change reusing the live PaymentRouter v1. The payer pays
their own (trivial, USDC-denominated) Arc gas; settlement is instant.

### B1. How it works

Build ONE transaction to Multicall3From batching two subcalls, each executed with the
payer as msg.sender (via CallFrom):

1. USDC.approve(PaymentRouter, amount)        -> sets allowance[payer][router] = amount
2. PaymentRouter.payInvoice(invoiceId, merchant, amount)
   -> inside, USDC.transferFrom(payer, merchant, amount) with spender = router, consuming
      the allowance just set, and emits InvoicePaid.

Because Multicall3From preserves msg.sender for each direct subcall, the approve credits the
payer's allowance and payInvoice runs as the payer, all in one signed tx. The router's
internal transferFrom is a normal call from the router (spender = router), which is exactly
what the allowance authorizes.

### B2. Client (app.js)

- In submitArcPayment / submitArcPaymentWithProgress, replace the sequential
  sendUsdcApprove then sendRouterPayment with a single Multicall3From call:
  - encode the two subcalls in the Multicall3From batch (Multicall3-style tuple array:
    target, allowFailure=false, callData), allowFailure false so the whole batch reverts
    atomically on any failure.
  - one eth_sendTransaction to Multicall3From -> one wallet prompt.
- Optimization: if allowance[payer][router] >= amount already, skip the approve subcall and
  just call payInvoice directly (still 1 signature, no Multicall needed).
- Keep the 6-decimal amount via parseTokenUnits(amount, 6).
- Remove the separate "Approving USDC..." step from the same-chain stepper (now one step).

### B3. Server / verify

- UNCHANGED. The router still emits InvoicePaid; the existing verify path
  (handleVerifyPayment, InvoicePaid match, (chainId, txHash) double-confirm guard) works as
  is. No new endpoint, no new contract, no contract-auditor gate.

### B4. Tests

- test_multicall_pay.js: a standalone node script that builds the Multicall3From calldata
  for [approve, payInvoice] and asserts the encoded batch shape and the 6-decimal amount.
- Testnet dry-run (manual): run one real same-chain payment through Multicall3From on Arc
  testnet and confirm one signature, InvoicePaid emitted, invoice flips to paid.

### B5. Result

Payer: 1 signature, instant settlement, pays only trivial Arc gas (in the USDC they already
hold). No Collect, no relayer, no Fundline hot key, no new contract.

### B6. Alternative kept on the shelf (not chosen)

EIP-3009 transferWithAuthorization (Arc USDC supports it, EIP-7598). Gives the payer a
truly zero-gas signature, but requires a submitter: either a merchant Collect step (awkward:
the receiver must act and pay gas) or a Fundline relayer (a hot key plus gas funding we
chose to avoid). Revisit only if zero-gas-for-payer becomes a hard requirement.

---

## Part A. Circle Gateway cross-chain (payer signs once per payment)

Confirmed: Circle Gateway is non-custodial, deposits accept EIP-2612 permit or EIP-3009, and
Arc is integrated. The destination mint on Arc is performed by Circle's Gateway system, so
Fundline runs no relayer and pays no gas for A.

### A0. Circle Gateway registration (credentials not yet obtained)

1. Create a Circle Developer account at https://console.circle.com (use the Fundline ops
   email). Start in the testnet/sandbox environment.
2. In the Circle Console, create an API key for the sandbox environment. Treat it as a
   server-only secret.
3. Enable / confirm access to the Gateway product. Confirm Arc testnet is a supported
   Gateway blockchain and note the Gateway Wallet contract address on Arc testnet and on the
   source chains (Ethereum Sepolia, Base Sepolia). See
   developers.circle.com/gateway/references/supported-blockchains.
4. Read the EVM quickstart: developers.circle.com/gateway/quickstarts/unified-balance-evm
   and the technical guide: developers.circle.com/gateway/concepts/technical-guide.
5. Add the key to server config as CIRCLE_GATEWAY_API_KEY (plus any base URL var). Put a
   placeholder in .env.example (CIRCLE_GATEWAY_API_KEY=replace_with_circle_gateway_api_key);
   never commit the real key, never expose it client-side or in public docs.
6. Constraints flagged in research: Arc is testnet-only as of mid 2026 (mainnet date
   unknown); Gateway/Nanopayments early-access terms and fees may change. Re-confirm before
   any mainnet use.

### A1. One-time deposit (onboarding)

- The payer deposits USDC into the non-custodial Gateway Wallet contract on a source chain
  (Sepolia/Base). The deposit can use an EIP-2612 permit so it is a single action. One-time
  per payer, not per invoice.

### A2. Per-payment flow (1 payer signature)

1. Client builds a Gateway burn intent (EIP-712 typed data) with recipient = the merchant
   wallet on Arc and value = invoice total. Payer signs once (off-chain).
2. Fundline server calls the Gateway transfer API (POST /v1/transfer per Circle docs) with
   the signed burn intent, using CIRCLE_GATEWAY_API_KEY.
3. Circle verifies and mints USDC to the merchant on Arc within ~500 ms (Circle handles the
   mint and its gas).
4. Fundline detects the settlement on Arc and marks the invoice paid, then fires Telegram
   and webhooks as today.

### A3. Server work

- Gateway client module (server-side) that forwards the signed burn intent and handles
  Gateway responses and errors.
- Settlement detection: confirm whether the Gateway mint to the merchant appears as a
  standard USDC Transfer the current verify path can match, or whether a settlement contract
  is needed to emit InvoicePaid (see Facts to verify).

### A4. Client work

- A one-time "Fund your Gateway balance" UX (deposit), then per-payment burn-intent signing
  on the pay page.

### A5. Result

Per payment: 1 payer signature (after a one-time deposit). Replaces the 5-signature CCTP
bridge-and-pay flow.

---

## Build order

1. B (Multicall3From, same-chain): client batching in app.js -> test_multicall_pay.js ->
   testnet dry-run -> ship. No contract, no audit gate, no server change.
2. A (Gateway, cross-chain): obtain credentials (A0) -> server Gateway module -> settlement
   detection -> client deposit + burn-intent signing.

Keep CCTP bridge-and-pay as the cross-chain path until A is proven on testnet.

## Facts to verify before coding

1. Multicall3From ABI: confirm the exact batch method (Multicall3-style aggregate3 tuple
   array: (address target, bool allowFailure, bytes callData)[]) and that a value-less batch
   of [USDC.approve, PaymentRouter.payInvoice] settles with the payer as msg.sender for BOTH
   subcalls. Confirm by a single Arc testnet dry-run before shipping (this is the one risky
   assumption; do not ship B without it).
2. Allowance behavior: confirm USDC.approve inside the batch credits allowance[payer][router]
   before payInvoice's transferFrom reads it (sequential subcalls in one tx; expected yes).
3. A: Gateway transfer API endpoint and request shape; Gateway Wallet addresses (Arc +
   source chains); that the Fundline account has Gateway access; whether mint-to-merchant is
   allowed as the burn-intent recipient.
4. A: does a Gateway mint to the merchant surface as a USDC Transfer the current verify path
   can match, or is a settlement contract required to emit InvoicePaid.

## Non-custodial and security checklist

- B: no new contract. PaymentRouter v1 is already non-custodial (pull payer -> merchant,
  holds no balance, no owner, no fee). Multicall3From only batches the payer's own calls
  with the payer as msg.sender; it cannot move funds the payer did not authorize. The
  approve in the batch is scoped to exactly amount for the router.
- A: Gateway Wallet is Circle's non-custodial contract; the user authorizes every transfer
  with a signed burn intent.
- Server never holds a payer private key. B has no relayer; A relies on Circle for the mint.
- Keep USDC amounts in 6-decimal base units via the shared parse helpers so client and
  server agree.
- Keep CIRCLE_GATEWAY_API_KEY server-side only; placeholder in .env.example; never in
  client code or public docs.

## Open questions for the user

- A: register the Circle Gateway account now (A0), or defer A until B ships.
