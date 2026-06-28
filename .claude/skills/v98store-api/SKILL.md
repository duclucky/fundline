---
name: v98store-api
description: Integration contract and model registry for v98store, the LLM provider gateway that powers Fundline AI workflows. Use when adding or changing a workflow's models, wiring the workflow run / build-prompt server endpoints, computing per-call API cost, or debugging v98store calls. Holds the single source of truth for base URL, auth, the workflow-label to model-id map, the per-model price table, and the cost formula. Triggers on: v98store, V98, workflow model, add model, model id, model price, chat completions, run workflow API, token cost, spend cap.
---

# v98store API integration

v98store (https://v98store.com) is the third-party LLM gateway Fundline calls to run AI
workflows. It is OpenAI-compatible: one API key works for every model. This skill is the
single reference so expanding workflows to new models stays consistent. Pair it with the
rate-limit / cost-control design in `.claude/workflow-rate-limit-spec.md`.

Conventions: English, no em dashes, no emojis, CommonJS, two-space indent, double quotes.
Money math in integer micro-USD (mirrors the USDC 6-decimal discipline). The API key is a
secret: it lives in `.env` and the cPanel env only, never client-side, never on public docs.

## Integration contract (confirmed 2026-06-28)

- Base URL: `https://v98store.com/v1` (no api.* subdomain).
- Endpoint: `POST https://v98store.com/v1/chat/completions` for BOTH GPT and Claude (the
  gateway translates to Anthropic internally). One code path, no per-vendor branching.
- Auth header: `Authorization: Bearer <V98STORE_API_KEY>`.
- Request body is standard OpenAI:
  `{ model, messages: [{ role, content }], temperature, max_tokens }`.
- Response is standard OpenAI: `choices[0].message.content` plus
  `usage { prompt_tokens, completion_tokens, total_tokens }`. Read `usage` for cost.
- ALWAYS send `max_tokens`. Claude (via the gateway) requires it; omitting it errors.
- On HTTP 429 (rate limit, undocumented RPM/TPM): retry with exponential backoff.
- env: `V98STORE_API_KEY`, `V98STORE_BASE_URL=https://v98store.com/v1`.

## Model registry (single source of truth)

The model name shown in a workflow definition is a LABEL, not the real model id. Always map
before sending, and Claude ids REQUIRE the date suffix. In code, keep this map and the prices
in ONE server constant (for example `v98-models.js` exporting `V98_MODELS`), so ids and prices
never drift across files.

  label (in WORKFLOWS)   v98store model id              input/1M USD   output/1M USD
  gpt-4.1-mini           gpt-4.1-mini                   0.40           1.60
  claude-3-haiku         claude-3-haiku-20240307        0.25           1.25
  claude-3.5-sonnet      claude-3-5-sonnet-20241022     3.00           15.00

Other available ids and Default-group prices (USD per 1M), handy when picking cheaper models:

  gpt-4o-mini                    0.15   0.60
  gpt-5-mini                     0.25   2.00
  claude-haiku-4-5-20251001      1.00   5.00
  claude-sonnet-4-6              3.00   15.00

Full catalog (~450 models): https://v98store.com/prices

## Cost formula (drives the spend caps)

Per call, from the response `usage`:

  costUSD = (prompt_tokens * inputPrice + completion_tokens * outputPrice) / 1_000_000
  spentMicros += Math.round(costUSD * 1_000_000)   // integer micro-USD

The prices above are the Default group (group_ratio = 1x). v98store uses NewAPI/OneAPI markup;
group_ratio runs from Default 1x up to 16x (Direct Claude). If OUR key sits on a higher group,
real cost = group_ratio x the table, so confirm the key's group and fold group_ratio into the
constant. Credit note: a ~1 USD top-up yields ~8-10 USD of credit, so capping by credit-USD
computed from `usage` is conservative (real cash burn is lower).

These per-call costs feed the rate-limit caps (see the spec): 0.50 USD per IP per day, and a
10 USD per day global ceiling for beta.

## Process: add a new model

1. Find the EXACT model id at https://v98store.com/prices (Claude needs the date suffix,
   e.g. claude-3-5-sonnet-20241022; pin OpenAI ids if you want determinism).
2. Add an entry to `V98_MODELS`: { id, inputPer1M, outputPer1M }.
3. If a workflow exposes a friendly label, map label -> id in the same constant.
4. Nothing else: the call path, usage parsing, and cost math are model-agnostic.

## Process: use a model in a workflow run (server side)

1. For each step in `WORKFLOWS[slug].steps`, resolve the label to a real id via `V98_MODELS`.
2. POST to `/v1/chat/completions` with `{ model: id, messages, temperature, max_tokens }`,
   threading each step output into the next step input.
3. After each response, compute costUSD from `usage` and the model price, add to the per-IP
   `spentMicros` and the global daily ledger BEFORE returning (see the spec for the full
   reserve / rollback / cap-check order).
4. Enforce caps and rate limits per `.claude/workflow-rate-limit-spec.md`. The run endpoint is
   the ONLY place real money is spent, so the limit checks must wrap the real call.

## Red flags

- Sending a Claude label without the date suffix (claude-3.5-sonnet) -> model-not-found error.
  Always map through the registry.
- Forgetting `max_tokens` on a Claude call -> error.
- Hardcoding prices or ids in multiple files -> drift. Keep them in the one constant.
- Trusting the Default-group price when the key is on a higher group -> undercharging the
  internal cost accounting -> caps fire too late. Confirm group_ratio.
- Putting the API key anywhere client-reachable or on public docs.

## Verification

- One real request with the live key: confirm the exact `usage` shape (any
  prompt_tokens_details / cached-token fields), that the billing/balance endpoints work
  (`GET /v1/dashboard/billing/subscription`, `GET /v1/dashboard/billing/usage`), and the key's
  group_ratio. Save the redacted response JSON.
- A unit test (standalone node test_*.js) for the cost function: known token counts x known
  prices -> expected micro-USD, including a non-1x group_ratio case.
