# GPT-5.6 v98store Cutover Design

Date: 2026-07-23

## Context

Fundline currently treats the GPT-5.6 workflow tiers as a separate provider route. The server selects `gpt-5.6-luna`, `gpt-5.6-terra`, or `gpt-5.6-sol`, then sends those calls through the CheapKey base URL and API key. Other workflow models already use the shared v98store client.

The configured v98store account exposes all three exact GPT-5.6 model IDs. Their metadata lists the OpenAI-compatible endpoint type, so they can use the existing v98store `/chat/completions` client without request-shape changes.

## Goal

Route every GPT-5.6 workflow call through the configured v98store endpoint and API key, including both synchronous execution and durable asynchronous workers, then verify the change with automated tests and one small live request.

## Non-goals

- Change the tier-to-model mapping.
- Change workflow prompts, token limits, retries, or response parsing.
- Replace the existing v98store client.
- Redesign the workflow pricing system.
- Deploy or push the change.

## Design

### Provider configuration

`V98STORE_BASE_URL` and `V98STORE_API_KEY` become the only provider connection used by workflow model calls. The server will remove the separate `WORKFLOW_FINAL_BASE_URL` and `WORKFLOW_FINAL_API_KEY` connection settings and their CheapKey defaults.

The existing tier model overrides remain available:

- `WORKFLOW_FINAL_MODEL_NORMAL`, default `gpt-5.6-luna`
- `WORKFLOW_FINAL_MODEL_PLUS`, default `gpt-5.6-terra`
- `WORKFLOW_FINAL_MODEL_PRO`, default `gpt-5.6-sol`

This preserves deployment-specific model selection while ensuring that changing a model ID cannot silently select another provider.

### Execution paths

Both workflow execution paths will use the same v98store client configuration:

1. Synchronous workflow execution resolves the tier model and passes it to `callV98Chat` with the shared v98store configuration.
2. Durable job execution resolves the same tier model and passes it to `callV98Chat` with the same shared configuration.
3. Non-GPT-5.6 workflow models continue through the same client and configuration, so no alternate provider branch remains.

The public configuration response may continue exposing the available final-tier model mapping when v98store is configured. It must no longer depend on a second API key.

### Pricing behavior

The cutover will preserve the current GPT-5.6 internal cost estimates and spend-cap behavior. v98store's authenticated model registry confirms model availability and endpoint compatibility but does not return pricing metadata for these three custom models, and its public pricing dataset does not list them. Changing estimates without an authoritative value would be less reliable than retaining the known values during this endpoint-only migration.

Pricing normalization can be handled separately when v98store publishes authoritative rates for these model IDs.

### Configuration documentation

`.env.example` will remove the CheapKey endpoint and key settings. Its workflow model section will state that GPT-5.6 tiers run through v98store and will document only the optional model ID overrides.

No secret values will be committed or printed during verification.

## Error handling

GPT-5.6 calls inherit the existing v98store client behavior, including timeout handling, structured HTTP errors, and rate-limit retries. Removing the provider branch also removes failures caused by an absent or inconsistent secondary API key.

The live verification request will fail closed if the v98store key is absent, the requested model is unavailable, or the response is invalid. A failed live test will not trigger a fallback to another endpoint.

## Test strategy

Implementation follows test-driven development:

1. Add a failing regression test that proves GPT-5.6 execution uses the v98store base URL and API key in both execution paths and that the obsolete CheapKey connection settings are absent.
2. Implement the smallest routing and configuration changes required to pass the test.
3. Run syntax checks and the relevant workflow, cost, asynchronous worker, and provider-client tests.
4. Run one live `gpt-5.6-luna` chat completion with a short deterministic prompt and a small output limit.
5. Report only sanitized response metadata, token usage, and whether the expected marker was returned.

## Acceptance criteria

- No server execution path sends GPT-5.6 calls to a CheapKey URL or key.
- Synchronous and durable asynchronous GPT-5.6 calls use `V98STORE_BASE_URL` and `V98STORE_API_KEY`.
- The normal, plus, and pro tier mappings remain unchanged.
- Existing cost controls continue to operate.
- `.env.example` no longer instructs operators to configure CheapKey.
- Relevant automated tests pass.
- One paid, minimal live v98store GPT-5.6 request succeeds.
