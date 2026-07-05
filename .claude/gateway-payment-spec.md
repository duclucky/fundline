# Circle Gateway (Nanopayments) parallel payment gate

Status: BUILT, dormant (flag off + optional dep absent). NOT live-tested (needs the
SDK installed + a funded Gateway balance). On-chain x402 and escrow gates unchanged.

## What it is

A third, OPTIONAL payment gate for `POST /api/workflows/:slug/run`, alongside the
existing on-chain x402 (direct USDC transfer to treasury) and escrow (FundlineRunEscrow)
gates. The agent picks a gate from the 402 `accepts[]` challenge; we accept it on
whichever gate it arrives through.

Circle Gateway = pre-funded balance + off-chain signed authorizations settled in
batches. The agent deposits USDC into Gateway once, then signs per-call authorizations
that Circle verifies and later settles on-chain in batches. This makes gas-free,
sub-cent, high-frequency M2M payments viable (the on-chain x402 path costs a full
transfer + verify per call, uneconomical below ~1 cent).

Non-custodial: Fundline never holds the agent's funds. The agent's balance lives in its
own Gateway account; settle moves it to Fundline's SELLER Gateway balance, which
Fundline later withdraws to its payout wallet. Trust shift (be honest about it):
settlement is Circle-intermediated (batched) rather than one Arcscan-verifiable tx per
call. The pure-on-chain proof story belongs to the x402/escrow gates; use those for the
higher-value outcome runs and Gateway for the micro-priced agent-call tier.

## Flow: verify -> run -> settle

Unlike x402/escrow (paid up front), Gateway captures AFTER the run:
1. Agent retries with `X-PAYMENT` = a signed Gateway authorization (no txHash).
2. Server routes by shape: no txHash + gate available -> Gateway. `verify()` proves the
   authorization is valid and funds are available BEFORE running.
3. Run the workflow.
4. On success: `settle()` captures the payment; `settle.transaction` is the settlement
   reference (releaseTx + explorerUrl). On failure: we never settle, so the agent is NOT
   charged (cleaner than an on-chain refund).

Rate limited on `gw:<payer>` with WORKFLOW_KEY_LIMITS. History recorded with mode
"gateway".

## Files

- `gateway-client.js` - lazy-require wrapper over `@circle-fin/x402-batching/server`
  (BatchFacilitatorClient). available()/getSupportedKind()/buildRequirements()/
  isGatewayPayment()/verify()/settle(). 503-safe: if the SDK is absent, available()
  is false and the gate is simply not offered. Test hook: cfg.makeClient.
- `server.js` handleWorkflowRun - the third gate (detection, 402 accepts entry,
  verify->run->settle, rate-limit key, history, error message). /api/config exposes
  `workflowGatewayEnabled`.
- `test_gateway_client.js` - 19 offline assertions with a fake facilitator.

## Enabling (deliberate, needs deps + funded balance)

1. Install the SDK + peers on the server (heavy: viem + @x402/core + @x402/evm):
   `npm install @circle-fin/x402-batching @x402/core @x402/evm viem`
   NOT added to package.json (kept out so a failed optional resolve cannot break
   `npm ci`/deploy; the code lazy-loads it). Add to package.json only once it installs
   cleanly in CI.
2. Set env: `WORKFLOW_GATEWAY_ENABLED=true`, `GATEWAY_SELLER_ADDRESS=<Fundline seller
   Gateway address>`, optionally `GATEWAY_API_URL` (testnet
   https://gateway-api-testnet.circle.com) and `GATEWAY_ARC_PRIVATE_MAINNET`.
3. Restart the Node app. `/api/config workflowGatewayEnabled` should read true and the
   402 challenge should carry a second `accepts[]` entry.
4. LIVE VERIFY (not done yet): fund a Gateway balance, run a real agent pay -> confirm
   verify/settle round-trip and the settlement tx. Confirm the batch scheme name and
   `extra` shape match what buildRequirements echoes.

## Open items

- Live verify/settle round-trip untested (no funded Gateway balance).
- Confirm `getSupported()` returns an Arc-testnet kind and its `extra` contract.
- Mainnet endpoint/terms TBD (testnet only today).
