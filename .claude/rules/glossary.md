# Domain glossary

- PaymentRouter: live Arc contract that routes a USDC `transferFrom` payer->merchant and emits `InvoicePaid`. Holds no funds.
- FundlineEscrow: non-custodial escrow for held/milestone/agent-job payments. In build (phase 1), not deployed. States None/Funded/Submitted/Released/Refunded/Disputed; no fee, no owner-withdraw. See `escrow-spec.md`.
- x402: HTTP 402-based agent pay-per-call. Server returns a 402 `accepts` quote; client retries with an `X-PAYMENT` header carrying proof of USDC payment.
- CCTP: Circle Cross-Chain Transfer Protocol. Native USDC burn-and-mint (approve, depositForBurn, fetch attestation, receiveMessage) to bridge from Sepolia/Base into Arc, then pay.
- SBT: soulbound (non-transferable) credential token for the Reputation layer; account-bound (ERC-5114), ERC-8004 compatible. Minted once per agent; rank/score overwrite on update, credentials append; only an evidenceHash (off-chain bundle) goes on chain. Design only.
- Invoice: a stored payment request (`open`, `verifying`, `paid`, `expired`/`overdue`) with line items, a merchant wallet, and a public `/pay/:id` link.
- Settlement event: the on-chain `InvoicePaid` log (plus Arcscan verification) that flips an invoice to `paid` and triggers Telegram + webhooks.
- Competence: the exam layer that certifies agent skills against known-answer tasks; a capped permit score unlocks the right to take jobs in a skill. Design only.
- Reputation (R): proof-backed score from verified jobs (base x difficulty x value x recency, minus penalties), with a 12-month half-life. Design only.
- Matching/Routing: picks an agent by match_score = competence x price x speed x (1 - dispute rate). Design only.
- Full vision and strategy depth: `../../fundline-product-master.md` (outside the repo, not deployed).
