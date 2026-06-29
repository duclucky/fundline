---
name: create-workflow
description: End-to-end procedure to design and ship a new Fundline AI workflow - a multi-step v98store prompt-chain run behind the rate-limited /run endpoint, billed per run through the non-custodial FundlineRunEscrow. Use whenever the user asks to create, add, or design a new workflow. Most of the machinery is SHARED and already built (wallet session, escrow billing, rate-limit/budget, result modal, receipt, canvas); a new workflow is mainly an executor module + one WORKFLOW_RUN_DEFS entry + one frontend WORKFLOWS entry. Triggers on: create workflow, new workflow, add workflow, design workflow, build a workflow.
---

# Create a Fundline workflow

A Fundline workflow is a multi-step LLM prompt chain: user input -> sequential v98store
calls (each a role with its own prompt; output feeds the next; optional web retrieval) ->
final output, run server-side behind `POST /api/workflows/:slug/run` and paid per run via
the escrow. Do NOT invent steps from scratch: adapt a publicly shared, community-accepted
chain so the quality is proven.

Read first (do not duplicate; build on them):
- `.claude/skills/v98store-api/SKILL.md` - provider contract, model-id map, price table, cost formula.
- `.claude/workflow-rate-limit-spec.md` - per-IP + global v98-cost caps (shared limiter).
- `.claude/workflow-billing-spec.md` - the per-run escrow billing design (shared).
- `.claude/workflow-sources.md` - curated shortlist of community workflows to adapt.
- `.claude/workflow-gpt-researcher.md` - a fully worked example (the research chain) with verbatim prompts.
- Reference code: `workflow-engine.js` (generic node-graph executor) + `workflow-defs.js`
  (the graph definitions), `workflow-research.js` (research prompt builders), `tavily-client.js`
  (web search), `v98-models.js`, `v98-client.js`, `workflow-limiter.js`, `run-escrow-client.js`,
  `wallet.js`, and `memo-util.js` (`buildWorkflowMemoText`). In `server.js`: `WORKFLOW_RUN_DEFS`,
  `handleWorkflowQuote`, `handleWorkflowRun`. In `workflows.js`: the `WORKFLOWS` entry,
  `renderRunPanel`, `runWorkflow`, `fundWorkflowRun`, `openResultModal`.

## What is already SHARED (do NOT rebuild for a new workflow)

- Wallet session: one dApp-wide connect/disconnect in the sidebar (`wallet.js` / window.FundlineWallet).
  A run requires a connected wallet, same as creating an invoice.
- Billing escrow: FundlineRunEscrow (deployed + Arcscan-verified) + `run-escrow-client.js`.
  The shared run flow is: client `POST /quote` -> approve USDC + `fund(runId, price)` from the
  user wallet -> `POST /run` which verifies the funded run on-chain, runs the chain, then the
  treasury `release`s the escrow (emitting an InvoiceMemo receipt via `buildWorkflowMemoText`)
  on success or `refund`s on failure (node fails after 3 retries). claimRefund is the stuck-funds backstop.
- Limiter: per-IP (3 runs + 3 gens + USD 0.50/day) and a global USD 10/day budget, all measured
  in REAL v98 cost (`recordCost`), NOT the testnet USDC the user pays. Keep both ON.
- Frontend run UX: canvas animation, "Pay X USDC and run" button, the View-result modal
  (`openResultModal` + `renderMarkdown`), and the receipt (charged + invoice memo tx link).

So a NEW workflow is essentially: (1) an executor module, (2) one `WORKFLOW_RUN_DEFS` entry
with a price, (3) one frontend `WORKFLOWS` entry. The rest plugs in.

## Hard rules

English only, no em dashes, no emojis in UI text, CommonJS, two-space indent, double quotes.
Two separate money systems, keep them distinct: (a) the USDC the user PAYS = a FIXED price per
workflow in 6-decimal base units (0.05 USDC = 50000), held/settled by the escrow; (b) our REAL
v98 API cost = integer micro-USD via `computeCostMicros` (apply `V98STORE_GROUP_RATIO`), tracked
by the limiter for the budget caps. Secrets (V98/treasury keys) live in `.env` + cPanel
env, never committed, never client-side.

## Process

1. Pick the source chain. Choose from `.claude/workflow-sources.md` (or research a new
   community-vetted one and add it there). Capture the real step structure and verbatim prompts
   where given. Note the license (MIT/Apache are safe to adapt; keep an attribution comment).

2. Decide retrieval. Needs live web data? Add a retrieval node (set `retrieval: true`, optional
   `searchQueries(ctx)`). The engine fetches real sources via Tavily (injected `searchWeb`) - real
   URLs + citations, ~$0.008/search (much cheaper than v98's search-preview at ~$0.20/call; the
   dedicated v98 search models 503). Downstream nodes read the aggregated sources and cite them.
   The engine also supports a paste-your-sources fallback. Self-contained (writing, code review,
   transformation) -> no retrieval; input is the user prompt. A no-retrieval variant must forbid
   inventing URLs/stats (otherwise the model fabricates citations).

3. Build the executor (server-side, testable). Mirror `workflow-research.js`: pure helpers
   (prompt builders, parsers, aggregation) + an orchestrator taking INJECTED
   `callModel(modelId, messages, maxTokens)` and (if needed) `searchWeb(query)` so it unit-tests
   without network. Map every step model through `v98Models.resolveModelId` (labels are not real
   ids; Claude needs the date suffix; always send max_tokens). Return `{ report, steps, sources,
   totalCostMicros }`; `steps` is `[{ name, model }]` (used for the memo). Cheap model for
   planning/summarizing (gpt-4o-mini), stronger for the writer.

4. Register server-side. Add the slug to `WORKFLOW_RUN_DEFS` in `server.js`:
   `{ type: "<chainType>", name: "<Display Name>", priceUnits: <fixed price, 6-dec USDC base units> }`.
   Dispatch the new `type` in `handleWorkflowRun` to your executor (mirror the research branch).
   The handler already does: flag/key checks, on-chain funded-run verification (payer set,
   amount == priceUnits, not settled), limiter reserve, run, `recordCost`, treasury release with
   the memo on success / refund on failure, and the response shape. Reuse it; do not reimplement
   billing, quota, or escrow.

5. Frontend `WORKFLOWS[slug]` (in `workflows.js`). Set `live: true`, `usesRetrieval: true` if it
   has a search/paste step, the REAL `steps` (name, model, purpose - include the "Web research"
   retrieval step), a representative `pricing` display, and `modelCount`. The shared
   `renderRunPanel` / `runWorkflow` / `fundWorkflowRun` handle wallet connect (sidebar), quote +
   approve + fund, the canvas, the View-result modal, and the receipt. Non-live workflows show
   "Coming soon"; live ones are gated by `isWorkflowLive` (wf.live && /api/config
   workflowRunnerEnabled) and billing by `isBillingEnabled` (also workflowBillingEnabled).

6. Tests. Add a standalone `node test_*.js` for the executor with injected fakes (no network):
   prompt/parse helpers, cost summation, dedup, mode handling, error paths. Pattern:
   `test_workflow_research.js`. The escrow/billing path itself is already proven by
   `test_run_escrow_dryrun.js` + `test_billing_e2e_dryrun.js` - reuse, do not rebuild. Keep
   source files ASCII (use `\u` escapes for any emoji fixtures).

7. Verify. `node --check` the changed served JS + modules; run the new + existing `test_*.js`.
   Then ONE live billing e2e (quote -> fund -> run -> release) with real keys (costs the fixed
   price + a few cents of v98) to confirm real output, on-chain release + memo, and quota/budget
   accounting. Ask the user before spending.

8. Ship. Run `/predeploy-check`. To go live the cPanel Node env must have:
   `WORKFLOW_RATE_LIMIT_ENABLED=true`, `V98STORE_API_KEY`, `V98STORE_BASE_URL`, `TAVILY_API_KEY`
   (for retrieval workflows), `ARC_RUN_ESCROW_ADDRESS`, `ARC_TREASURY_ADDRESS`,
   `ARC_TREASURY_PRIVATE_KEY` (+ `V98STORE_GROUP_RATIO` if not 1x), then restart. Until then the
   workflow shows "Coming soon".

## Red flags

- Inventing a chain instead of adapting a proven one -> low quality. Start from the shortlist.
- Forgetting `priceUnits` (or wrong decimals: USDC is 6, so 0.05 = 50000) in `WORKFLOW_RUN_DEFS`.
- Rebuilding wallet / escrow / limiter / result-modal per workflow - they are SHARED.
- Conflating the two money systems: the fixed USDC price the user pays is NOT the v98 cost; the
  budget caps track v98 real cost only.
- Sending a model label without mapping to the real v98store id, or forgetting max_tokens.
- A retrieval-less "research" workflow that still demands citations -> fabricated URLs.
- Marking a workflow `live` without a `WORKFLOW_RUN_DEFS` entry -> /run returns 501.
- Committing a key, or a literal emoji in any source file.

## Verification checklist

- [ ] Executor unit-tested with injected fakes; cost summation correct.
- [ ] `WORKFLOW_RUN_DEFS[slug]` has type + name + priceUnits (6-dec USDC); handleWorkflowRun dispatches it.
- [ ] `WORKFLOWS[slug]` has `live: true`, real steps, retrieval flag, pricing display, modelCount.
- [ ] Run requires a connected wallet; pay -> run -> release works in one live e2e (with user OK).
- [ ] v98 cost (micro-USD) recorded separately from the USDC paid; budget caps unaffected.
- [ ] `node --check` clean; all `test_*.js` pass.
- [ ] No em dash, no emoji, English copy, no committed secrets.
- [ ] `/predeploy-check` GO; cPanel env (incl escrow + treasury key) communicated to the user.
