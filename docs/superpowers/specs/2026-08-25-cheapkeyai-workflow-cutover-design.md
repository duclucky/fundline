# CheapKeyAI Workflow Provider Cutover Design

## Objective

Move every Fundline workflow model call from v98store to CheapKeyAI while preserving the existing workflow graphs, tier behavior, model assignments, rate limits, durable job execution, and non-custodial payment flows.

This change covers application code and configuration only. The CheapKeyAI API key already exists in the production cPanel environment. The migration must not create, reveal, copy, rotate, or transmit any API key and must not modify cPanel during implementation.

## Verified CheapKeyAI Contract

The following details were verified from the signed-in CheapKeyAI dashboard and its official documentation on 2026-08-25:

- Base URL: `https://cheapkeyai.shop/v1`
- Authentication: `Authorization: Bearer <api-key>`
- Chat endpoint: `POST /chat/completions`
- Model discovery: `GET /models`
- Balance endpoint: `GET /balance`
- Usage endpoint: `GET /usage/logs`
- Chat request and response format: OpenAI-compatible
- Chat usage fields: `prompt_tokens`, `completion_tokens`, and `total_tokens`

The balance response stores account and key information under `data`. Relevant fields are:

- `user_balance`: current account balance in provider currency units
- `user_used_balance`: cumulative account usage in provider currency units
- `key_name`: API key name
- `key_remain_quota`: remaining key quota when the key has a quota limit
- `key_unlimited_quota`: whether the key has no separate quota limit

The usage-log response stores entries under `data.items`. Each entry includes the model name, prompt tokens, completion tokens, charged quota, key name, and provider group.

## Verified Model IDs and Prices

Every model currently referenced by a Fundline workflow is present in CheapKeyAI. The migration keeps the model assignments unchanged.

| Model ID | Input USD per 1M tokens | Output USD per 1M tokens | Fundline role |
| --- | ---: | ---: | --- |
| `gpt-4o-mini` | 0.15 | 0.60 | Fast and formatter nodes |
| `gpt-4.1-mini` | 0.40 | 1.60 | Plus/pro fast, strong, and verifier nodes |
| `deepseek-v3` | 2.00 | 8.00 | Client Research normal writer |
| `deepseek-v3.2` | 2.00 | 3.00 | Normal strong and code nodes |
| `deepseek-r1` | 4.00 | 16.00 | Research nodes |
| `kimi-k2.7-code` | 6.50 | 27.00 | Plus code nodes |
| `claude-sonnet-4-6` | 3.00 | 15.00 | Pro strong, code, and verifier nodes |
| `gpt-5.6-luna` | 0.20 | 1.20 | Normal final content node |
| `gpt-5.6-terra` | 2.00 | 12.00 | Plus final content node |
| `gpt-5.6-sol` | 5.00 | 30.00 | Pro final content node |

Prices are the catalog prices shown before provider-group adjustments. Fundline continues to support a configurable group multiplier so internal spend caps can be conservative when the production key uses a group above 1x.

Fundline will not switch to the separate `cheap-5.6-*` aliases. The current `gpt-5.6-*` IDs are verified and preserve the intended Normal, Plus, and Pro quality ladder.

## Chosen Architecture

Use a clean, single-provider cutover. Provider-specific runtime modules and configuration will be renamed from v98store to CheapKeyAI. No v98store fallback remains in the workflow execution path.

The migration introduces these provider-specific units:

- `cheapkey-client.js`: OpenAI-compatible chat calls, model discovery, balance lookup, retry behavior, timeout behavior, response parsing, and CheapKeyAI-specific errors.
- `cheapkey-models.js`: model ID resolution, verified CheapKeyAI catalog prices, and integer micro-USD cost calculation.
- `workflow-model-provider.js`: remains the provider-neutral adapter consumed by workflow execution.

The existing `v98-client.js` and `v98-models.js` files will be removed after all consumers and tests use the CheapKeyAI replacements.

## Configuration

The canonical environment variables become:

```env
CHEAPKEYAI_API_KEY=
CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1
CHEAPKEYAI_GROUP_RATIO=1
CHEAPKEYAI_TIMEOUT_MS=300000
```

To preserve the key already stored on cPanel, runtime key resolution is:

```text
CHEAPKEYAI_API_KEY
WORKFLOW_FINAL_API_KEY
```

`WORKFLOW_FINAL_API_KEY` is a temporary deployment-compatibility alias because Fundline previously used that variable for CheapKeyAI. It is accepted server-side but is not the canonical name in `.env.example`.

The runtime must not fall back to `V98STORE_API_KEY`. A v98store credential sent to CheapKeyAI would fail authentication and could hide an incomplete migration.

The existing workflow model overrides remain unchanged:

```env
WORKFLOW_FINAL_MODEL_NORMAL=gpt-5.6-luna
WORKFLOW_FINAL_MODEL_PLUS=gpt-5.6-terra
WORKFLOW_FINAL_MODEL_PRO=gpt-5.6-sol
WORKFLOW_BUILD_PROMPT_MODEL=gpt-4o-mini
```

## Request and Error Behavior

`cheapkey-client.js` sends OpenAI-compatible chat requests with `model`, `messages`, and `max_tokens`. It includes `temperature` only when a caller provides it.

The client retains the current five-retry exponential backoff for HTTP 429 responses. Network errors also retry with exponential backoff. The default timeout remains 300,000 milliseconds because GPT-5.6 responses can take multiple minutes.

Errors name CheapKeyAI and include the HTTP status without including the API key or request authorization header. Invalid JSON and missing required configuration fail explicitly.

## Health and Billing Behavior

Workflow preflight uses `GET /models` to confirm the provider is reachable and that every model required by the selected workflow tier exists.

The existing v98store billing helper is replaced with a CheapKeyAI balance helper using `GET /balance`. It maps:

```text
remainingUsd = data.user_balance
usageUsd = data.user_used_balance
```

The existing low-balance and preflight behavior continues to consume `remainingUsd`, so callers outside the provider module do not need a new billing interface.

`GET /usage/logs` is implemented as a provider client helper for reconciliation and diagnostics, with key-scoped results by default. Runtime calls do not query usage logs after every model request because that would add latency and create ambiguity under concurrent workflow runs.

## Cost Accounting

Per-call cost remains integer micro-USD:

```text
costMicros = round(
  (promptTokens * inputPricePer1M + completionTokens * outputPricePer1M)
  * CHEAPKEYAI_GROUP_RATIO
)
```

The conversion works because multiplying USD-per-million-token prices by token counts yields micro-USD directly. Unknown model prices return `null` so the caller can reject or conservatively handle an unpriced model instead of silently treating it as free.

This migration updates the registry to the verified CheapKeyAI catalog prices. It does not change Fundline's public USDC workflow prices.

## Source and Documentation Cleanup

Runtime source, configuration examples, tests, comments, operational messages, and internal provider documentation will use CheapKeyAI terminology. Active runtime code must not contain:

- `v98store.com`
- `V98STORE_API_KEY`
- `V98STORE_BASE_URL`
- `V98STORE_GROUP_RATIO`
- `V98STORE_TIMEOUT_MS`
- v98store-specific error text

Historical design documents remain unchanged because they describe decisions made at the time. Public documentation must not expose the CheapKeyAI key or any secret cPanel configuration.

The project-local provider skill will be updated or replaced so future workflow/model changes treat CheapKeyAI as the single source of truth.

## Testing Strategy

Implementation follows test-driven development.

1. Add client tests that fail before `cheapkey-client.js` exists.
2. Verify chat request shape, bearer authentication, timeout, response parsing, HTTP errors, retry behavior, `/models`, `/balance`, and `/usage/logs` using local mock HTTPS behavior or injected transport boundaries. Tests never use a real API key.
3. Add model registry tests for every active model ID and its verified price.
4. Add configuration tests for canonical `CHEAPKEYAI_*` names and the `WORKFLOW_FINAL_API_KEY` compatibility alias.
5. Add source scans proving active runtime code and `.env.example` no longer reference v98store configuration or hostname.
6. Run all workflow engine, execution, async job, durable settlement, research, document generation, CV/gig, Crypto DD, MCP, limiter, and provider tests.
7. Run `node --check` on `server.js` and every changed JavaScript module.

A live paid model request is not required to implement the cutover. If a final live request is desired, it must use the pre-existing production or local CheapKeyAI credential and requires explicit confirmation immediately before spending provider balance.

## Deployment Boundary

This implementation changes and verifies the repository only. It does not push, deploy, edit cPanel variables, restart production, or send a live paid model request.

After code verification, deployment can proceed through the project's normal predeploy gate. Production will work without moving the existing key when cPanel currently stores it as `WORKFLOW_FINAL_API_KEY`. A later maintenance pass may rename the cPanel variable to `CHEAPKEYAI_API_KEY` and remove the compatibility alias after production confirms the canonical variable is present.

## Acceptance Criteria

- All workflow model calls use `https://cheapkeyai.shop/v1` through `cheapkey-client.js`.
- All currently assigned model IDs remain unchanged and exist in the verified CheapKeyAI catalog.
- The production key can be read from either `CHEAPKEYAI_API_KEY` or the existing `WORKFLOW_FINAL_API_KEY` alias.
- Runtime code never uses `V98STORE_API_KEY` as a fallback.
- Preflight uses CheapKeyAI `/models` and `/balance` correctly.
- Cost accounting uses verified CheapKeyAI prices and integer micro-USD math.
- No secret is written to source, tests, logs, or documentation.
- All affected tests and syntax checks pass.
- No deployment or external account mutation occurs as part of implementation.
