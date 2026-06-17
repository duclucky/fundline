# Gotchas and "do not touch"

- FundlineEscrow is unaudited and pre-deploy (and not yet present as a file). When it
  arrives, preserve the no-withdraw invariant and treat changes carefully.
- Testnet addresses can be redeployed. The live PaymentRouter address lives in `.env`
  (`ARC_PAYMENT_ROUTER_ADDRESS`), but several addresses (USDC, CCTP contracts, chainId)
  are hardcoded across `server.js` and `app.js`. Prefer a single config/constants source
  and avoid scattering new hardcoded addresses.
- Decimal risk: USDC is 6 decimals on Arc but is also the native gas token. The audit
  (`../../audit_report.md`) flags 6-vs-18 decimal handling as a high-severity open
  question. Double-check any new amount math.
- The x402 handler builds a mock request/response object to reuse `handleVerifyPayment`.
  It is fragile glue; change it deliberately and test `node test_*.js` after.
- `data/` is gitignored and holds live JSON state. Do not commit it. Do not assume a row
  exists; the store can be empty on a fresh machine.
- A sibling app, `../arc-allowance-dashboard` (VaultLens), lives under the same outer
  folder. It is its own server and is not the invoice product. Do not cross-wire them.
- CCTP fast-transfer is not implemented; `CCTP_STANDARD_FINALITY_THRESHOLD` is hardcoded.
