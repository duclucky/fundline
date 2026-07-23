# Invoice RPC Self-Recovery Design

## Problem

The public Fundline configuration now advertises
`https://rpc.drpc.testnet.arc.network`, but existing wallet sessions can still
use the older `https://rpc.testnet.arc.network` endpoint. Some wallets expose
Arc Testnet as a locked network and do not allow the user or the dApp to edit
its stored RPC URL.

During invoice payment, read operations can succeed through Fundline's public
RPC while the wallet provider later fails `eth_sendTransaction` with HTTP 429.
The current UI displays the raw provider message and offers a generic retry.
Blindly retrying a send is unsafe because the first request may have reached the
wallet or RPC even when its response was lost.

## Goals

- Apply recovery only to direct Arc invoice payment.
- Retry invoice-specific read-only RPC methods on transient failures using
  ordered fallback endpoints and bounded backoff.
- Detect HTTP 429 and equivalent provider rate-limit errors consistently.
- Never automatically retry a transaction submission.
- Help the user recover without paying an invoice twice.
- Preserve the existing non-custodial payment and verification model.

## Non-Goals

- Modifying a locked network entry inside a third-party wallet.
- Changing shared wallet configuration or `wallet.js`.
- Changing workflow, MCP, batch payment, bridge, or other RPC behavior.
- Adding a relayer, meta-transaction contract, or server-side transaction
  signer.
- Changing PaymentRouter, invoice settlement rules, or payment verification.
- Hiding a wallet approval or signature request from the user.

## Design

### Invoice-Scoped RPC Configuration

The direct invoice payment flow will build an ordered Arc RPC list from:

1. `rpcUrl` returned by `/api/config`.
2. A small list of known public Arc Testnet fallbacks.

The list will remove empty values and duplicates while preserving order. The
helper will be private to the invoice payment flow. Shared wallet defaults and
other product surfaces will remain unchanged.

### Safe Read Retry

Invoice-only reads such as balance, decimals, allowance, and transaction receipt
may rotate through the RPC list when they fail due to:

- HTTP 429
- HTTP 5xx
- request timeout or connection failure
- JSON-RPC rate-limit responses such as code `-32011` or a rate-limit message

Retries will be bounded and use a short exponential backoff. Permanent JSON-RPC
errors will be returned immediately.

Read fallback applies only to direct HTTP RPC calls made by the invoice payment
flow. An injected wallet provider remains controlled by its wallet.

### Transaction Submission Safety

Invoice `approve` and `payInvoice` submissions will still be delegated to
`FundlineWallet`. If the provider returns a rate-limit error:

1. The app will not resend the transaction.
2. After an ambiguous approval error, the app will poll allowance through the
   invoice RPC fallback. If allowance reached the expected value, payment may
   continue. Otherwise the flow stops.
3. After an ambiguous payment error, the app will poll invoice verification
   without a transaction hash. If the on-chain payment is found, the invoice
   completes normally. Otherwise the flow stops.
4. If a transaction hash is already known, the flow will use invoice RPC
   fallback for receipt checks and then move to verification.
5. If no on-chain state change is found, the UI will mark the payment step as
   interrupted and explain that the wallet RPC is busy.

The error message will not claim that a payment failed when submission status
is unknown.

### Existing Locked Wallets

When a wallet is already on Arc Testnet, `wallet_switchEthereumChain` cannot
replace its stored RPC. The app will therefore avoid promising an automatic
network update. It will detect the rate-limit condition and present an
actionable recovery message.

For injected wallets with a locked Arc network, the safe fallback after
invoice-specific recovery is to reconnect or use another wallet. The app will
not disconnect or reconfigure a shared wallet session automatically.

## Files

- `app.js`
  - Add invoice-private RPC endpoint normalization, fallback, retry
    classification, and safe payment error presentation.
  - Route only direct invoice payment reads through the helper.
  - Recover ambiguous approval and payment submissions by polling on-chain
    state, never by resubmitting.
- Existing browser-side test files
  - Add regression coverage for fallback order, rate-limit classification,
    bounded retries, on-chain state recovery, and no retry for transaction
    submission.

## Test Strategy

Tests will be written before production changes and must demonstrate:

- The invoice primary endpoint is tried before fallbacks.
- Duplicate RPC endpoints are removed.
- HTTP 429 and supported transient JSON-RPC errors rotate to the next endpoint.
- Permanent JSON-RPC errors do not rotate.
- Retry count is bounded.
- Invoice approval submission is invoked at most once when the provider returns
  HTTP 429, then allowance is checked.
- Invoice payment submission is invoked at most once when the provider returns
  HTTP 429, then invoice verification is checked.
- A known invoice transaction hash proceeds to verification instead of payment
  retry.
- The UI replaces the raw `Non-200 status code: '429'` message with an
  actionable, non-misleading message.
- Workflow, MCP, batch, bridge, and shared wallet tests remain unchanged.

The final verification will include the focused tests, the full relevant Node
test suite, and `node --check` for `app.js` and `server.js`.

## Acceptance Criteria

- Direct invoice payment reads use `/api/config` RPC first and recover from a
  simulated primary RPC 429 by using a fallback.
- Invoice approval and payment submissions are never automatically repeated
  after an ambiguous 429.
- An approval 429 continues only when the expected allowance is later visible
  on-chain.
- A payment 429 completes only when the matching invoice payment is later
  verified on-chain.
- Locked-wallet users receive a clear recovery path instead of a raw provider
  error.
- Existing payment verification and anti-double-confirm behavior remains
  unchanged.
- Workflow, MCP, batch payment, bridge, and shared wallet behavior remains
  unchanged.
