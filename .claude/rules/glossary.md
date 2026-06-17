# Domain glossary

- PaymentRouter: live Arc contract that routes a USDC `transferFrom` payer->merchant and emits `InvoicePaid`. Holds no funds.
- FundlineEscrow: planned escrow contract for held/milestone payments. Not built or deployed yet; must keep the no-withdraw invariant when it exists.
- x402: HTTP 402-based agent pay-per-call. Server returns a 402 `accepts` quote; client retries with an `X-PAYMENT` header carrying proof of USDC payment.
- CCTP: Circle Cross-Chain Transfer Protocol. Native USDC burn-and-mint (approve, depositForBurn, fetch attestation, receiveMessage) to bridge from Sepolia/Base into Arc, then pay.
- SBT: dynamic soulbound credential token for the future Identity/Reputation layer. Design only.
- Invoice: a stored payment request (`open`, `verifying`, `paid`, `expired`/`overdue`) with line items, a merchant wallet, and a public `/pay/:id` link.
- Settlement event: the on-chain `InvoicePaid` log (plus Arcscan verification) that flips an invoice to `paid` and triggers Telegram + webhooks.
