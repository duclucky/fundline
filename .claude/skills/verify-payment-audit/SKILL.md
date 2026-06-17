---
name: verify-payment-audit
description: Audit Fundline's on-chain payment verification path for settlement integrity. Use when changing or reviewing payment verification, the arcscan verify endpoint, x402 settle, or CCTP bridge-and-pay, or when an invoice is wrongly marked paid or unpaid or a double-spend is suspected. It traces the verify flow and checks event-source priority, asset/amount/recipient match at 6 decimals, and the (chainId, txHash) anti-double-confirm guard.
---

# verify-payment-audit

Settlement correctness is the core product promise: a payment must bind to the right
invoice, for the right amount, exactly once. This skill audits that path. It is read and
review oriented; it reports findings, it does not send transactions.

Trace first, then check. To locate the flow without loading the big files into context,
delegate to the fundline-explorer agent (embed `.claude/agents/fundline-explorer.md`; project
subagents are not usable as `subagent_type` here). Key spots: `/api/arcscan/verify-payment`
and the verify helper in server.js, the x402 handler that reuses it, and the CCTP
bridge-and-pay flow in app.js. Reference: `.claude/rules/onchain-reference.md` (verify
priority) and `.claude/rules/gotchas.md`.

## Checklist

1. Event-source priority. The verifier should prefer the PaymentRouter `InvoicePaid` event
   (it carries the invoiceId). For a direct USDC transfer, it should fall back to parsing the
   ERC-20 `Transfer(from, to, value)` and matching on it. Flag any path that marks an invoice
   paid without a matching on-chain event.
2. Match correctness. Confirm it checks: receipt status is success; asset is USDC on Arc
   (`0x3600000000000000000000000000000000000000`); recipient equals the invoice merchant
   wallet; amount equals the invoice total at 6 decimals. Flag any 18-decimal assumption
   (`1e18`, `parseEther`); amounts must use 6-decimal math.
3. Anti-double-confirm. A given `(chainId, txHash)` pair must be able to settle only one
   invoice. Confirm the store (payment-attempts / events) records used txs and rejects reuse.
   This is the double-spend guard; treat a gap here as High severity.
4. Idempotency. Re-verifying the same tx must not double-count revenue or re-fire webhooks
   and Telegram. Confirm the paid transition is guarded.
5. CCTP bridge-and-pay. A bridged payment must still land a verifiable settlement on Arc and
   go through the same checks. Confirm domains are correct (Ethereum Sepolia 0, Base Sepolia
   6, Arc 26) and the final Arc-side payment is what gets verified, not the burn on the source
   chain.
6. Failure modes. Confirm a wrong amount, wrong recipient, wrong asset, or reused tx leaves
   the invoice unpaid and does not fire notifications.

## Output

Findings ranked High / Medium / Low, each with file:line and a concrete fix. Call out
explicitly whether the double-spend guard (step 3) holds. If the audit touches code that
changed, hand off to predeploy-check before any push.
