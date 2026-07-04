# Remote MCP server spec (x402, hosted at fundline.xyz/mcp)

Status: DRAFT, not built. Decision locked with user 2026-07: host a REMOTE MCP server
so agents connect by URL + Fundline API key (no local files), and pay per run with
their OWN wallet via x402 (Fundline never holds agent funds). Non-custodial preserved.

## Goal

An MCP endpoint at `POST /mcp` on the Fundline server. Any MCP client (Claude Desktop,
Cursor, Hermes Agent, OpenClaw) that supports remote/HTTP MCP connects with:

```json
{ "fundline": { "url": "https://fundline.xyz/mcp",
    "headers": { "Authorization": "Bearer fdl_live_..." } } }
```

The API key identifies + authorizes the Fundline account (rate limits, receipts). It
holds no money. Payment is the agent's own wallet via x402.

## Tools

- `list_workflows({ query? })` -> discovery menu (reuses the /api/workflows logic).
- `run_workflow({ slug, tier?, prompt, payment? })`:
  - No `payment` -> return the x402 quote (price, payTo treasury, asset, network) as
    text/structured content, telling the agent to pay then call again.
  - `payment = { payerWallet, txHash }` -> verify + run (reuses the x402 settle path in
    handleWorkflowRun) and return the output.
  The agent transfers USDC from its OWN wallet between the two calls (its wallet is the
  agent framework's capability, not Fundline's).
- (optional) `get_quote({ slug, tier? })` -> the escrow runId + price for agents that
  prefer the escrow path.

## Auth

Bearer API key in the HTTP header (reuse requireAgentApiKey / optionalAgentApiKey). Key
maps to the seller; rate-limited per key (WORKFLOW_KEY_LIMITS), global budget backstop.

## Payment (x402, non-custodial)

The MCP server holds NO wallet. run_workflow drives the existing x402 flow:
challenge -> agent pays treasury from its own wallet -> settle with the txHash. Same
verification + one-run-per-txHash guard + treasury-refund-on-failure already built.

## Transport DECISION (the one real sub-decision)

MCP over HTTP is the "Streamable HTTP" transport (JSON-RPC 2.0 over POST; SSE optional).
Two ways to implement inside the hand-rolled Node http server:

- Option T1: HAND-ROLLED minimal Streamable HTTP. Implement JSON-RPC dispatch for
  `initialize`, `notifications/initialized`, `tools/list`, `tools/call`, returning a
  single JSON response per POST (no SSE, stateless, no session id). PRO: keeps the app
  buildless/zero-dependency (the repo principle); no cPanel npm install. CON: we are
  responsible for protocol compliance; some strict clients that require SSE or session
  headers may not connect (need testing per client). Lower risk than it sounds for
  tools-only request/response.
- Option T2: use `@modelcontextprotocol/sdk` StreamableHTTPServerTransport. PRO:
  guaranteed protocol compliance across clients. CON: adds a RUNTIME dependency to the
  deployed server (the app is deliberately buildless with only ethers/solc/acorn), and
  node_modules is FTP-excluded so the dep must be `npm install`-ed on cPanel + the Node
  app restarted. A real deviation from the no-dependency stance.

Recommendation: T1 (hand-rolled minimal) to preserve the buildless principle, and
test against the target clients (Claude Desktop remote, Hermes, OpenClaw). Fall back to
T2 only if a required client rejects the minimal transport.

## Build outline (after approval)

1. `mcp-http.js` module: pure JSON-RPC dispatch (initialize/tools-list/tools-call ->
   handlers), transport-agnostic, unit-testable with fake requests.
2. server.js: route `POST /mcp` (and `GET /mcp` -> 405 or a small info page). Auth via
   the API key; dispatch to mcp-http with a tool registry that calls the existing
   workflow list + run (x402) logic in-process (no self-HTTP).
3. The tool handlers reuse handleWorkflowList data + the x402 branch of handleWorkflowRun
   (may need a small internal helper so both the HTTP route and the MCP tool share the
   run logic without faking req/res).
4. docs.html: a "Remote MCP" section with the URL + client config.
5. Tests: mcp-http dispatch (initialize, tools/list, tools/call for list_workflows and
   the run challenge/settle shapes) with injected fakes.

## Non-goals (this phase)

- Prepaid on-chain credit balance ("just API key, no wallet") - deferred; needs a new
  deposit/withdraw/debit contract.
- SSE streaming of run progress over MCP (return the final result only).
- Holding any agent wallet or funds (custodial) - rejected.

## Hard rules

English, no em dashes, no emojis, CommonJS, 2-space, double quotes. No secret committed.
USDC 6 decimals. Non-custodial: Fundline never holds the agent's wallet or funds.
