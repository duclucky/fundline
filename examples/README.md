# Fundline agent examples

Standalone examples for integrating an AI agent with Fundline. These are NOT part
of the Fundline app and are not required to run the server.

## circle-agent-demo.js

An agent that pays for a Fundline workflow run using its own Circle
Developer-Controlled Wallet on Arc. Non-custodial: the Circle API key and entity
secret belong to you and stay in your environment; Fundline never sees them.

### Setup

1. Create a Circle developer account and get a TESTNET API key.
2. Generate an entity secret and register it in the Circle console:
   https://developers.circle.com/wallets/dev-controlled/register-entity-secret
3. Install the Circle SDK (demo-only dependency, not in the app):
   ```
   npm i @circle-fin/developer-controlled-wallets
   ```
4. Create a Fundline API key in the dashboard (API keys tab).

### Run

Set env vars (never commit secrets), then run the script:

```
export CIRCLE_API_KEY=...          # your Circle testnet API key
export CIRCLE_ENTITY_SECRET=...    # your registered entity secret
export FUNDLINE_API_KEY=...        # your Fundline API key
export FUNDLINE_BASE_URL=http://127.0.0.1:5190
export WORKFLOW_SLUG=client-research
export WORKFLOW_TIER=normal
export PAY_MODE=escrow              # or x402

node examples/circle-agent-demo.js
```

First run without `CIRCLE_WALLET_ID` creates a wallet, prints its address, and
asks you to fund it from the Arc testnet faucet (10 USDC/hour). Fund it, then
re-run with `CIRCLE_WALLET_ID=<the printed id>`.

### Payment modes

- `escrow` (default): quote -> approve USDC -> fund the per-run escrow -> run.
  Trustless refund on failure (contract-guaranteed).
- `x402`: run -> HTTP 402 quote -> transfer USDC to the treasury -> run with an
  `X-PAYMENT` proof. Lighter (one transfer); refund on failure is a treasury transfer.

The Fundline server needs workflow billing configured (escrow + treasury + provider
key) for either mode to settle.
