# Fundline agent examples

Standalone examples for integrating an AI agent with Fundline. Not part of the app.

- `fundline-agent-core.js` - shared logic (discover + pay + run) used by both examples.
- `circle-agent-demo.js` - a CLI agent (below); escrow + x402 pay modes.
- `gateway-agent-demo.js` - a CLI agent using Circle Gateway (Nanopayments): pre-fund once,
  then pay gas-free, sub-cent, per call (the agent-to-agent / service-payment path).
- `mcp-server/fundline-mcp.js` - an MCP server so MCP clients (Claude, Cursor, Hermes
  Agent, OpenClaw) can discover and run Fundline workflows as tools (see the MCP section).

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

Once set up, the agent DISCOVERS the workflow menu, CHOOSES what to run, then does
quote -> pay -> run with zero human clicks:

```
export CIRCLE_API_KEY=...
export CIRCLE_ENTITY_SECRET=...
export CIRCLE_WALLET_ID=...        # printed by setup
export FUNDLINE_API_KEY=...
export FUNDLINE_BASE_URL=http://127.0.0.1:5190
export PAY_MODE=escrow             # or x402

# Option A: a single chosen workflow
export WORKFLOW_SLUG=client-research
export WORKFLOW_TIER=normal
export WORKFLOW_PROMPT="Research Acme Labs for a partnership call."

# Option B: several DIFFERENT workflows in one go (overrides Option A)
export WORKFLOW_TASKS='[
  {"slug":"client-research","tier":"normal","prompt":"Research Acme Labs"},
  {"slug":"swot-analysis","tier":"normal","prompt":"SWOT for a new SaaS invoicing tool"}
]'

node examples/circle-agent-demo.js run
```

The agent first calls `GET /api/workflows` to see the available workflows and their
prices, then runs the ones you chose, paying for each by itself.

### What is manual vs automatic

- Manual (Phase 1, one time): Circle signup, entity-secret registration, funding
  the wallet, creating a Fundline key. These involve accounts and money, so they
  need a human, exactly like giving an employee a funded company card once.
- Automatic (Phase 2, every run): discover the workflow menu, choose, sign
  approve/fund or the x402 transfer, run the workflow, receive the output. No clicks.

### Payment modes

- `escrow` (default): quote -> approve USDC -> fund the per-run escrow -> run.
  Refund on failure is contract-guaranteed (trustless).
- `x402`: run -> HTTP 402 quote -> transfer USDC to the treasury -> run with an
  `X-PAYMENT` proof. Lighter (one transfer); refund on failure is a treasury transfer.
- `gateway` (Nanopayments, agent-to-agent): pre-fund a Gateway balance ONCE (one on-chain
  deposit), then each run is paid by an off-chain signed authorization that Circle verifies
  and settles in batches. No gas, sub-500ms per call. Best for high-frequency agents. See
  `gateway-agent-demo.js` below.

The Fundline server needs workflow billing configured (escrow + treasury + provider
key) for escrow/x402 to settle. The gateway mode additionally needs the Gateway gate on
(next section).

## gateway-agent-demo.js (Nanopayments)

Pay for runs gas-free, sub-cent, per call via Circle Gateway. The agent pre-funds a Gateway
balance once, then signs off-chain authorizations per run (no gas, batched settlement).
Non-custodial: the pre-funded balance stays in the agent's own Gateway account; a run only
settles the exact price to Fundline's seller balance after the run succeeds.

Server side (one-time, on the Fundline Node app):
```
npm install @circle-fin/x402-batching     # on the cPanel Node app
# cPanel env:
WORKFLOW_GATEWAY_ENABLED=true
GATEWAY_SELLER_ADDRESS=<Fundline seller Gateway address>   # defaults to the treasury
# then restart the Node app
```
When on, `GET /api/config` returns `workflowGatewayEnabled: true` and `/api/workflows/:slug/run`
offers the Gateway option in its 402 challenge.

Agent side:
```
cd examples
npm install @circle-fin/x402-batching
export AGENT_PRIVATE_KEY=0x...            # EOA holding USDC on Arc testnet
export FUNDLINE_BASE=https://fundline.xyz
export WF_SLUG=client-research
export WF_TIER=normal
export WF_PROMPT="Research Acme Labs."
export GATEWAY_DEPOSIT=1                  # one-time: deposit 1 USDC into the Gateway balance
node gateway-agent-demo.js
```
After the first deposit, drop `GATEWAY_DEPOSIT` and each run is paid off-chain from the same
balance until it is spent. Verify the client method names (`deposit`, `pay`) against the
installed `@circle-fin/x402-batching` version; Circle's arc-nanopayments repo is the
reference agent.

## mcp-server/fundline-mcp.js

An MCP (Model Context Protocol) server that exposes Fundline as tools any MCP client
can use: `list_workflows` (discover/search), `run_workflow` (pay + run, returns the
output), and `wallet_info`. Frameworks like Hermes Agent and OpenClaw, plus Claude
Desktop and Cursor, register MCP servers, so this makes Fundline plug-and-play for
them: the model calls the tools, and the server pays per run from your Circle wallet.

Non-custodial: your Circle + Fundline keys live in the MCP server's env (your machine);
Fundline never sees them and cannot move your funds.

### Setup

```
cd examples/mcp-server
npm i @modelcontextprotocol/sdk @circle-fin/developer-controlled-wallets
```

Do the one-time Circle setup + funding from the CLI demo above (it prints a
`CIRCLE_WALLET_ID`). Then register the server with your MCP client, e.g. Claude
Desktop `mcpServers`:

```json
{
  "fundline": {
    "command": "node",
    "args": ["/absolute/path/examples/mcp-server/fundline-mcp.js"],
    "env": {
      "FUNDLINE_BASE_URL": "https://fundline.xyz",
      "FUNDLINE_API_KEY": "...",
      "CIRCLE_API_KEY": "...",
      "CIRCLE_ENTITY_SECRET": "...",
      "CIRCLE_WALLET_ID": "...",
      "PAY_MODE": "escrow"
    }
  }
}
```

After that, the agent can say things like "find a research workflow and run it on
Acme Labs" and the MCP tools discover, pay, and run it autonomously.

