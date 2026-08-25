---
name: cheapkeyai-api
description: Integrate or maintain CheapKeyAI as Fundline's OpenAI-compatible workflow model provider. Use when changing workflow models, provider requests, model costs, preflight checks, or CheapKeyAI configuration.
---

# CheapKeyAI API integration

Fundline runs every AI workflow through CheapKeyAI. Keep provider code server-side and use the shared modules instead of adding direct HTTP calls.

## Contract

- Base URL: `https://cheapkeyai.shop/v1`
- Chat: `POST /chat/completions`
- Models: `GET /models`
- Balance: `GET /balance`
- Usage: `GET /usage/logs`
- Auth: `Authorization: Bearer <CHEAPKEYAI_API_KEY>`
- Request format: OpenAI-compatible `{ model, messages, temperature, max_tokens }`
- Response content: `choices[0].message.content`
- Token usage: `usage.prompt_tokens` and `usage.completion_tokens`

Use `cheapkey-client.js` for network calls, `cheapkey-models.js` for model IDs and prices, and `model-cost.js` for cost accounting. Always send `max_tokens`. Retry transient network failures and HTTP 429 responses through the shared client.

## Configuration

Use these server environment variables:

- `CHEAPKEYAI_API_KEY`
- `CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1`
- `CHEAPKEYAI_GROUP_RATIO=1`
- `CHEAPKEYAI_TIMEOUT_MS=300000`

`WORKFLOW_FINAL_API_KEY` is a temporary API-key compatibility fallback. Do not read old provider keys. Never expose provider keys to browser code or public documentation.

## Supported models

The authoritative registry is `cheapkey-models.js`. Current workflow model IDs are:

- `gpt-4o-mini`
- `gpt-4.1-mini`
- `deepseek-v3`
- `deepseek-v3.2`
- `deepseek-r1`
- `kimi-k2.7-code`
- `claude-sonnet-4-6`
- `gpt-5.6-luna`
- `gpt-5.6-terra`
- `gpt-5.6-sol`

Before adding a model, verify the exact ID through `GET /models`, then add its price in one place in `cheapkey-models.js`. Do not duplicate model prices in workflow executors.

## Cost and safety

Compute provider spend in integer micro-USD from response usage. Apply `CHEAPKEYAI_GROUP_RATIO` through the shared cost function. Keep provider cost separate from the fixed 6-decimal USDC price paid into workflow escrow.

Unit tests must inject fake model callers and must not spend provider balance. Ask the user before any live request, deployment, or cPanel change.

## Verification

- Run `node test_cheapkey_client.js` and `node test_cheapkey_cost.js`.
- Run workflow executor and preflight tests affected by the change.
- Confirm active source has no old provider imports, environment variables, or model IDs.
- Scan the diff for committed secrets before shipping.
