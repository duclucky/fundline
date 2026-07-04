# Fundline agent examples

Standalone examples for integrating an AI agent with Fundline. Not part of the app.

## circle-agent-demo.js

An agent that pays for Fundline workflow runs from its own Circle
Developer-Controlled Wallet on Arc. Non-custodial: your Circle API key and entity
secret stay in your environment; Fundline never sees them.

There are two phases. Only Phase 1 needs a human; Phase 2 is fully autonomous.

### Phase 1: one-time setup (human)

These steps create the accounts and money the agent will use. No API can do them
for you (they involve signing up, a security registration, and funding a wallet).

1. Create a Circle developer account and get a TESTNET API key.
2. Generate an entity secret and register it in the Circle console:
   https://developers.circle.com/wallets/dev-controlled/register-entity-secret
3. Install the Circle SDK (demo-only, not part of the app):
   ```
   npm i @circle-fin/developer-controlled-wallets
   ```
4. Create a Fundline API key in the dashboard (API keys tab).
5. Create the agent wallet and fund it:
   ```
   export CIRCLE_API_KEY=...
   export CIRCLE_ENTITY_SECRET=...
   node examples/circle-agent-demo.js setup
   ```
   This prints a `CIRCLE_WALLET_ID` and an address. Fund the address with USDC from
   the Arc testnet faucet (https://faucet.circle.com, 10 USDC/hour).

### Phase 2: the agent runs autonomously

Once set up, the agent does quote -> pay -> run with zero human clicks, repeatable:

```
export CIRCLE_API_KEY=...
export CIRCLE_ENTITY_SECRET=...
export CIRCLE_WALLET_ID=...        # printed by setup
export FUNDLINE_API_KEY=...
export FUNDLINE_BASE_URL=http://127.0.0.1:5190
export WORKFLOW_SLUG=client-research
export WORKFLOW_TIER=normal
export PAY_MODE=escrow             # or x402
export RUN_COUNT=1                 # run the workflow N times back to back

node examples/circle-agent-demo.js run
```

Every run signs and pays on-chain by itself and returns the result. Set
`RUN_COUNT` higher to watch it run many times with no human in the loop.

### What is manual vs automatic

- Manual (Phase 1, one time): Circle signup, entity-secret registration, funding
  the wallet, creating a Fundline key. These involve accounts and money, so they
  need a human, exactly like giving an employee a funded company card once.
- Automatic (Phase 2, every run): discover price, sign approve/fund or the x402
  transfer, run the workflow, receive the output. No clicks.

### Payment modes

- `escrow` (default): quote -> approve USDC -> fund the per-run escrow -> run.
  Refund on failure is contract-guaranteed (trustless).
- `x402`: run -> HTTP 402 quote -> transfer USDC to the treasury -> run with an
  `X-PAYMENT` proof. Lighter (one transfer); refund on failure is a treasury transfer.

The Fundline server needs workflow billing configured (escrow + treasury + provider
key) for either mode to settle.
