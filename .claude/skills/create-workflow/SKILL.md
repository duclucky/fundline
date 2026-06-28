---
name: create-workflow
description: End-to-end procedure to design and ship a new Fundline AI workflow - a multi-step v98store prompt-chain executed behind the rate-limited /run endpoint. Use whenever the user asks to create, add, or design a new workflow. Covers picking a community-vetted chain, adapting it to a v98store sequential executor, the retrieval choice (Tavily search vs paste sources), backend wiring into WORKFLOW_RUN_DEFS, the shared quota/cost limiter, the frontend WORKFLOWS entry and live gating, tests, live verification, and deploy. Triggers on: create workflow, new workflow, add workflow, design workflow, build a workflow.
---

# Create a Fundline workflow

A Fundline workflow is a multi-step LLM prompt chain: user input -> sequential
v98store calls (each a role with its own prompt, output feeds the next, optional web
retrieval) -> final output. It runs server-side behind the rate-limited
`POST /api/workflows/:slug/run`. Do NOT invent steps from scratch: adapt a publicly
shared, community-accepted chain so the quality is proven.

Read first (do not duplicate them, build on them):
- `.claude/skills/v98store-api/SKILL.md` - provider contract, model-id map, price table, cost formula.
- `.claude/workflow-rate-limit-spec.md` - the quota + budget limiter design (shared by all workflows).
- `.claude/workflow-sources.md` - curated shortlist of community workflows to adapt.
- `.claude/workflow-gpt-researcher.md` - a fully worked example (the research chain), with verbatim prompts.
- Reference code: `workflow-research.js` (executor pattern), `v98-models.js`, `v98-client.js`,
  `tavily-client.js`, `workflow-limiter.js`; in `server.js` see `WORKFLOW_RUN_DEFS` +
  `handleWorkflowRun`; in `workflows.js` see the `WORKFLOWS` entry, `renderRunPanel`, `runWorkflow`.

Hard rules (always): English only, no em dashes, no emojis in UI text, CommonJS, two-space
indent, double quotes. Money is integer micro-USD via v98-models `computeCostMicros` (never
float-drift); apply `V98STORE_GROUP_RATIO`. Secrets (API keys) live in `.env` + cPanel env,
never committed, never client-side. The runner is gated by `WORKFLOW_RATE_LIMIT_ENABLED`.

## Process

1. Pick the source chain. Choose from `.claude/workflow-sources.md` (or research a new
   community-vetted one and add it there). Capture the real step structure and, where the
   source provides them, the verbatim prompts. Note the license (MIT/Apache are safe to adapt;
   keep an attribution comment in code).

2. Decide retrieval. Does the chain need live web data?
   - Needs the web -> use Tavily (`tavily-client.js`) for the search/retrieve step, plus a
     paste-your-sources fallback. Without retrieval the model fabricates citations.
   - Self-contained (writing, code review, transformation) -> no retrieval; input is the user prompt.
   Be honest about a no-retrieval variant: drop citation requirements and label it un-sourced.

3. Build the executor (server-side, testable). Mirror `workflow-research.js`: pure helper
   functions (prompt builders, parsers, aggregation) plus an orchestrator that takes INJECTED
   `callModel(modelId, messages, maxTokens)` and (if needed) `searchWeb(query)` so it unit-tests
   without network. Map every step model through `v98Models.resolveModelId` (labels are not real
   ids; Claude needs the date suffix). Sum cost per step with `computeCostMicros`. Keep prompts
   close to the source. Cheap model for planning/summarizing (gpt-4o-mini), stronger for the
   final writer.

4. Wire `/run`. Add the slug to `WORKFLOW_RUN_DEFS` in `server.js` with its chain type, and
   branch in `handleWorkflowRun` (or a generic dispatcher) to the executor. The handler already:
   checks the flag + provider key, parses { prompt, mode, sources }, reserves one run via the
   limiter, runs the chain with real `callV98Chat` / `searchTavily`, records the summed cost,
   and rolls back the reservation on failure. Reuse it; do not re-implement quota logic.

5. Frontend (`workflows.js`). Add or update the `WORKFLOWS[slug]` entry: set `live: true`, list
   the REAL steps (name, model, purpose) so the canvas matches the chain, set `usesRetrieval`
   if it has a search/paste step, and a representative `pricing` display. Non-live workflows
   automatically show "Coming soon". The shared `renderRunPanel` + `runWorkflow` already call
   the real endpoints, animate the canvas against the live response, render the report + receipt
   (sources, est. cost, remaining quota) with Copy/Download, and show server error messages.
   Live behavior is gated by `isWorkflowLive` = `wf.live && WF_RUNNER_ENABLED` (the latter from
   `/api/config.workflowRunnerEnabled`), so shipping ahead of the server flag is safe.

6. Tests. Add a standalone `node test_*.js` for the executor using injected fakes (no network):
   prompt/parse helpers, cost summation, dedup, mode handling, and error paths. Pattern:
   `test_workflow_research.js`. Keep source files ASCII (use `\u` escapes for any emoji fixtures).

7. Verify. `node --check` the changed served JS + modules; run the new + existing `test_*.js`.
   Then ONE live run with real keys (costs a few cents) to confirm real output, cost recorded
   in both `data/workflow-usage.json` (per-IP) and `workflow-budget.json` (global), and quota
   decrement. Ask the user before spending real money.

8. Ship. Run `/predeploy-check`. The keys and `WORKFLOW_RATE_LIMIT_ENABLED` are NOT in the repo;
   to go live the user must set them (plus any provider key like `TAVILY_API_KEY`, and
   `V98STORE_GROUP_RATIO` if not 1x) in the cPanel Node app env and restart. Until then the
   workflow shows "Coming soon" on prod.

## Red flags

- Inventing a chain instead of adapting a proven one -> low quality. Start from the shortlist.
- Sending a model label without mapping to the real v98store id (Claude needs the date suffix).
- Forgetting `max_tokens` (Claude requires it) or letting cost math drift off integer micro-USD.
- Re-implementing quota/cost instead of reusing `workflow-limiter` + `handleWorkflowRun`.
- A retrieval-less "research" workflow that still demands citations -> fabricated URLs.
- Marking a workflow `live` without a server-side `WORKFLOW_RUN_DEFS` entry -> /run returns 501.
- Committing an API key, or a literal emoji in any source file.

## Verification checklist

- [ ] Executor unit-tested with injected fakes; cost summation correct.
- [ ] Slug in `WORKFLOW_RUN_DEFS`; `handleWorkflowRun` routes to it.
- [ ] `WORKFLOWS[slug]` has `live: true`, real steps, retrieval flag, pricing display.
- [ ] `node --check` clean; all `test_*.js` pass; one live run verified (with user OK).
- [ ] No em dash, no emoji, English copy, micro-USD cost, no committed secrets.
- [ ] `/predeploy-check` GO; cPanel env steps communicated to the user.
