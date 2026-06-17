# FundlineEscrow spec (in development, not deployed)

This is the active build target (roadmap phase 1). FundlineEscrow is a non-custodial
escrow contract for held / milestone / agent-job payments. No contract file exists yet;
when it lands it MUST preserve the no-withdraw invariant. Hand the result to the
contract-auditor agent before any deploy.

## State machine

Agreement states: None, Funded, Submitted, Released, Refunded, Disputed.

Happy path: None -> (fund) -> Funded -> (submitDeliverable) -> Submitted ->
(confirmAndRelease or releaseAfterReviewWindow) -> Released.
Alternatives: Funded -> (refund) -> Refunded; Submitted -> (raiseDispute) -> Disputed ->
(resolveDispute) -> Released or Refunded.

## Functions

- fund: buyer deposits USDC into escrow for an agreement.
- submitDeliverable: seller (agent) submits the result / marks delivery.
- confirmAndRelease: buyer confirms, funds release to seller. Emits a buyer_confirmed event.
- releaseAfterReviewWindow: auto-release to seller after the review window if the buyer is
  silent. Emits a review_timeout event.
- refund: return funds to buyer.
- raiseDispute and resolveDispute(bool releaseToSeller): open and settle a dispute.
- getAgreement: read agreement data.

## Core security invariant (non-negotiable)

- NO owner / admin / privileged path may withdraw, seize, or redirect escrowed funds.
  Funds move only buyer -> escrow -> (seller on release | buyer on refund) per the state
  machine. This is the make-or-break property; if it is violated the non-custodial value
  proposition collapses. The contract-auditor agent must verify this after the code exists.
- NO fee mechanism. Use minimal IERC20 only.
- USDC on Arc is 6 decimals and is ALSO the native gas token. Use parseUnits(amount, 6).
  Decide deliberately whether to hold funds via IERC20.transferFrom or msg.value and
  document the choice; the 6-vs-18 question is a live hazard (see ../../audit_report.md).

## Integration

- Add a deploy script that mirrors scripts/deploy-payment-router.js (compile with solc,
  no Hardhat/Foundry, write the address back to .env).
- New env var: ARC_ESCROW_ADDRESS.
- Return escrowAddress in GET /api/config alongside the existing paymentRouterAddress and
  usdcTokenAddress.

Conventions: English only, no em dashes, no emojis. CommonJS, two-space indent, double
quotes for the deploy script and any server wiring.
