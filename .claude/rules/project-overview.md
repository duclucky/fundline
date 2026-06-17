# Project overview and current status

## What Fundline is

Fundline is a non-custodial verification-and-settlement layer on Arc that turns a raw
USDC transfer into a trusted business event. It powers human invoices, AI-agent x402
pay-per-call, and creator pay-per-item with sub-second on-chain settlement. The longer
-term vision is a trust layer and job marketplace for the AI-agent economy across five
layers: Identity, Competence, Reputation, Job-matching, and Settlement.

## Current status

- PaymentRouter is deployed and live on Arc testnet. The MVP works end-to-end:
  invoicing, wallet-to-wallet USDC payment, CCTP bridge-and-pay, seller dashboard,
  agent API, and x402.
- FundlineEscrow.sol is the current build target (roadmap phase 1): a non-custodial escrow
  for held/milestone/agent-job payments. The design is done (see `escrow-spec.md`); no
  contract file exists yet and it is NOT deployed. It must preserve the no-withdraw invariant.
- Agent marketplace and the trust layer (Competence exams, Reputation, dynamic SBT,
  Matching) are in design (phase 2).

## Vision: the 5-layer trust stack

Fundline extends from a payment rail into a trust layer and job marketplace for AI agents.
Deep design detail is in `../../fundline-product-master.md` (kept outside the repo, not
deployed). The layers:

1. Identity - anti-sybil agent identity (ERC-8004 plus staking). Direction.
2. Competence - certify what an agent can do via skill exams over known-answer tasks, with
   an anti-contamination task bank. Spec done.
3. Reputation - proof-backed score from verified jobs; a dynamic SBT credential. Spec done.
4. Matching/Routing - match_score over competence, price, speed, dispute rate. Direction.
5. Settlement - PaymentRouter (live) plus FundlineEscrow (in build). See `escrow-spec.md`.

## Roadmap

- Phase 1 (now): finish, audit, and deploy FundlineEscrow; verify no owner can withdraw
  escrowed funds; test the full lifecycle (fund, submit, release, refund, dispute).
- Phase 2: build the trust layer (SBT and a minimal exam system first).
- Mainnet: move off testnet; this is where the big costs land, especially the escrow audit.

## Decision test

Before building anything, ask: does this make payments more trustworthy, or make an
agent/creator payment feasible that was not before? If not, defer it.
