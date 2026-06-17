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
- FundlineEscrow.sol is planned but not in progress in this repo yet. No contract file
  exists for it today, and it is NOT deployed. TODO: confirm where escrow work lives.
- Agent marketplace and the SBT (soulbound credential) layer are still in design.
