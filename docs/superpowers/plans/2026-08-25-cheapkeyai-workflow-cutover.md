# CheapKeyAI Workflow Provider Cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route every Fundline workflow model call, provider health check, and provider balance lookup through CheapKeyAI with verified model IDs and prices, while preserving the existing cPanel key through a compatibility alias.

**Architecture:** Replace the v98store-specific client and model registry with `cheapkey-client.js` and `cheapkey-models.js`. Keep `workflow-model-provider.js` as the provider-neutral boundary, then switch `server.js`, operational scripts, tests, comments, and internal provider guidance to the new modules and `CHEAPKEYAI_*` configuration.

**Tech Stack:** Node.js CommonJS, built-in `https`, standalone Node assertion tests, vanilla Fundline HTTP server.

## Global Constraints

- Use `https://cheapkeyai.shop/v1` as the default provider base URL.
- Use OpenAI-compatible `POST /chat/completions` with bearer authentication.
- Keep the current model assignments and exact model IDs unchanged.
- Read the provider key from `CHEAPKEYAI_API_KEY`, then the compatibility alias `WORKFLOW_FINAL_API_KEY`.
- Never fall back to `V98STORE_API_KEY`.
- Never write, print, commit, transmit, or expose a real API key.
- Keep the default provider timeout at 300,000 milliseconds.
- Preserve integer micro-USD cost accounting and the configurable provider group ratio.
- Preserve CommonJS, two-space indentation, double quotes, English code/comments/docs, no emoji, and no em dash.
- Do not deploy, push, edit cPanel, restart production, or make a paid live model request in this implementation.
- Preserve all unrelated user changes in the dirty worktree.

---

### Task 1: Replace the model and cost registries

**Files:**
- Create: `cheapkey-models.js`
- Modify: `model-cost.js`
- Create: `test_cheapkey_cost.js`
- Delete: `v98-models.js`
- Delete: `premium-models.js`
- Delete: `test_v98_cost.js`
- Delete: `test_premium_cost.js`

**Interfaces:**
- Produces: `CHEAPKEY_MODELS`, `LABEL_TO_ID`, `resolveModelId(label)`, `getPrice(modelId)`, and `computeCostMicros(modelId, promptTokens, completionTokens, groupRatio)` from `cheapkey-models.js`.
- Produces: `costMicros(modelId, promptTokens, completionTokens, groupRatio)` from `model-cost.js`.
- Consumed by: `server.js`, workflow executors, operational measurement scripts, and later tasks.

- [ ] **Step 1: Write the failing CheapKeyAI cost test**

Create `test_cheapkey_cost.js` with explicit assertions for every active model and the verified CheapKeyAI prices:

```js
"use strict";

const assert = require("assert");
const cheapkeyModels = require("./cheapkey-models");
const modelCost = require("./model-cost");

const expectedPrices = {
  "gpt-4o-mini": [0.15, 0.60],
  "gpt-4.1-mini": [0.40, 1.60],
  "deepseek-v3": [2.00, 8.00],
  "deepseek-v3.2": [2.00, 3.00],
  "deepseek-r1": [4.00, 16.00],
  "kimi-k2.7-code": [6.50, 27.00],
  "claude-sonnet-4-6": [3.00, 15.00],
  "gpt-5.6-luna": [0.20, 1.20],
  "gpt-5.6-terra": [2.00, 12.00],
  "gpt-5.6-sol": [5.00, 30.00],
};

Object.entries(expectedPrices).forEach(([id, [inputPer1M, outputPer1M]]) => {
  assert.deepEqual(cheapkeyModels.getPrice(id), { inputPer1M, outputPer1M });
  assert.equal(cheapkeyModels.resolveModelId(id), id);
});

assert.equal(cheapkeyModels.resolveModelId("claude-3-haiku"), "claude-3-haiku-20240307");
assert.equal(cheapkeyModels.resolveModelId("claude-3.5-sonnet"), "claude-3-5-sonnet-20241022");
assert.equal(cheapkeyModels.resolveModelId("unknown-model"), "unknown-model");
assert.equal(cheapkeyModels.getPrice("unknown-model"), null);
assert.equal(cheapkeyModels.computeCostMicros("gpt-4.1-mini", 1000000, 0, 1), 400000);
assert.equal(cheapkeyModels.computeCostMicros("gpt-4.1-mini", 0, 1000000, 1), 1600000);
assert.equal(cheapkeyModels.computeCostMicros("gpt-4.1-mini", 1000000, 0, 2), 800000);
assert.equal(cheapkeyModels.computeCostMicros("unknown-model", 10, 10, 1), null);
assert.equal(modelCost.costMicros("gpt-5.6-luna", 1000000, 0, 1), 200000);
assert.equal(modelCost.costMicros("gpt-5.6-sol", 0, 1000000, 1), 30000000);
assert.equal(modelCost.costMicros("unknown-model", 10, 10, 1), 0);

console.log("PASS: CheapKeyAI model prices and cost accounting");
```

- [ ] **Step 2: Run the test and verify the missing-module failure**

Run:

```powershell
node test_cheapkey_cost.js
```

Expected: FAIL with `Cannot find module './cheapkey-models'`.

- [ ] **Step 3: Implement the CheapKeyAI model registry**

Create `cheapkey-models.js` with a single price source for all active models plus the two legacy Claude label mappings still accepted by workflow definitions:

```js
"use strict";

const CHEAPKEY_MODELS = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4.1-mini": { inputPer1M: 0.40, outputPer1M: 1.60 },
  "deepseek-v3": { inputPer1M: 2.00, outputPer1M: 8.00 },
  "deepseek-v3.2": { inputPer1M: 2.00, outputPer1M: 3.00 },
  "deepseek-r1": { inputPer1M: 4.00, outputPer1M: 16.00 },
  "kimi-k2.7-code": { inputPer1M: 6.50, outputPer1M: 27.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "gpt-5.6-luna": { inputPer1M: 0.20, outputPer1M: 1.20 },
  "gpt-5.6-terra": { inputPer1M: 2.00, outputPer1M: 12.00 },
  "gpt-5.6-sol": { inputPer1M: 5.00, outputPer1M: 30.00 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.00, outputPer1M: 15.00 },
};

const LABEL_TO_ID = {
  "claude-3-haiku": "claude-3-haiku-20240307",
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
};

function resolveModelId(label) {
  const key = String(label || "").trim();
  return LABEL_TO_ID[key] || key;
}

function getPrice(modelId) {
  return CHEAPKEY_MODELS[String(modelId || "")] || null;
}

function computeCostMicros(modelId, promptTokens, completionTokens, groupRatio) {
  const price = getPrice(modelId);
  if (!price) return null;
  const ratio = Number(groupRatio) > 0 ? Number(groupRatio) : 1;
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const completion = Math.max(0, Number(completionTokens) || 0);
  return Math.round((prompt * price.inputPer1M + completion * price.outputPer1M) * ratio);
}

module.exports = {
  CHEAPKEY_MODELS,
  LABEL_TO_ID,
  resolveModelId,
  getPrice,
  computeCostMicros,
};
```

Replace `model-cost.js` with the provider registry as its only dependency:

```js
"use strict";

const cheapkeyModels = require("./cheapkey-models");

function costMicros(modelId, promptTokens, completionTokens, groupRatio) {
  return cheapkeyModels.computeCostMicros(
    modelId,
    promptTokens,
    completionTokens,
    groupRatio,
  ) || 0;
}

module.exports = { costMicros };
```

Delete the superseded v98store and premium model modules and their tests with `apply_patch`. Do not use filesystem deletion commands.

- [ ] **Step 4: Run the new cost test and affected workflow tests**

Run:

```powershell
node test_cheapkey_cost.js
node test_workflow_engine.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
```

Expected: all five commands print PASS and exit 0.

- [ ] **Step 5: Commit the registry cutover**

```powershell
git add -- cheapkey-models.js model-cost.js test_cheapkey_cost.js v98-models.js premium-models.js test_v98_cost.js test_premium_cost.js
git commit -m "refactor: add CheapKeyAI model registry"
```

### Task 2: Implement the CheapKeyAI HTTP client

**Files:**
- Create: `cheapkey-client.js`
- Create: `test_cheapkey_client.js`
- Delete: `v98-client.js`
- Delete: `test_v98_client_timeout.js`

**Interfaces:**
- Produces: `callCheapKeyChat(config, params) -> { content, usage, model, raw }`.
- Produces: `listCheapKeyModels(config) -> string[]`.
- Produces: `getCheapKeyBalance(config) -> { status, remainingUsd, usageUsd, keyName, keyUnlimitedQuota, keyRemainQuota }`.
- Produces: `getCheapKeyUsage(config, query?) -> { items, total, page, pageSize, scope }`.
- Consumes: `{ apiKey, baseUrl, timeoutMs }` provider config.

- [ ] **Step 1: Write the failing client contract test**

Create `test_cheapkey_client.js`. Stub `https.request` with an `EventEmitter`, capture method, path, headers, body, and timeout, then assert these behaviors:

```js
"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const https = require("https");
const client = require("./cheapkey-client");

function installMock(responses) {
  const calls = [];
  const original = https.request;
  https.request = (options, onResponse) => {
    const call = { options, body: "", timeoutMs: 0 };
    calls.push(call);
    const request = new EventEmitter();
    request.setTimeout = (value) => { call.timeoutMs = value; };
    request.write = (chunk) => { call.body += String(chunk); };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const next = responses.shift();
      const response = new EventEmitter();
      response.statusCode = next.status;
      onResponse(response);
      process.nextTick(() => {
        response.emit("data", JSON.stringify(next.body));
        response.emit("end");
      });
    };
    return request;
  };
  return { calls, restore: () => { https.request = original; } };
}

async function main() {
  const mock = installMock([
    { status: 200, body: { model: "gpt-5.6-luna", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } } },
    { status: 200, body: { data: [{ id: "gpt-5.6-luna" }, { id: "gpt-4o-mini" }] } },
    { status: 200, body: { success: true, data: { user_balance: 12.5, user_used_balance: 3.25, key_name: "Fundline", key_unlimited_quota: true, key_remain_quota: 0 } } },
    { status: 200, body: { success: true, data: { items: [{ model_name: "gpt-5.6-luna", quota: 10 }], total: 1, page: 1, page_size: 20, scope: "key" } } },
  ]);
  const config = { apiKey: "test-key", baseUrl: "https://cheapkeyai.shop/v1", timeoutMs: 300000 };
  try {
    const chat = await client.callCheapKeyChat(config, { model: "gpt-5.6-luna", messages: [{ role: "user", content: "test" }], maxTokens: 32, maxRetries: 0 });
    assert.equal(chat.content, "ok");
    assert.equal(mock.calls[0].options.path, "/v1/chat/completions");
    assert.equal(mock.calls[0].options.headers.Authorization, "Bearer test-key");
    assert.equal(mock.calls[0].timeoutMs, 300000);
    assert.deepEqual(JSON.parse(mock.calls[0].body), { model: "gpt-5.6-luna", messages: [{ role: "user", content: "test" }], max_tokens: 32 });
    assert.deepEqual(await client.listCheapKeyModels(config), ["gpt-5.6-luna", "gpt-4o-mini"]);
    assert.deepEqual(await client.getCheapKeyBalance(config), { status: 200, remainingUsd: 12.5, usageUsd: 3.25, keyName: "Fundline", keyUnlimitedQuota: true, keyRemainQuota: 0 });
    assert.deepEqual(await client.getCheapKeyUsage(config), { items: [{ model_name: "gpt-5.6-luna", quota: 10 }], total: 1, page: 1, pageSize: 20, scope: "key" });
    assert.equal(mock.calls[3].options.path, "/v1/usage/logs");
  } finally {
    mock.restore();
  }
  console.log("PASS: CheapKeyAI client contract");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
```

- [ ] **Step 2: Run the client test and verify it fails**

Run:

```powershell
node test_cheapkey_client.js
```

Expected: FAIL with `Cannot find module './cheapkey-client'`.

- [ ] **Step 3: Implement the client**

Create `cheapkey-client.js` with:

```js
"use strict";

const https = require("https");

function parseBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  return { hostname: url.hostname, port: url.port || 443, basePath: url.pathname.replace(/\/$/, "") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requestJson(config, method, pathSuffix, body) {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath } = parseBaseUrl(config.baseUrl);
    const payload = body == null ? "" : JSON.stringify(body);
    const headers = { Accept: "application/json", Authorization: `Bearer ${config.apiKey}` };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const request = https.request({ hostname, port, path: `${basePath}${pathSuffix}`, method, headers }, (response) => {
      let responseBody = "";
      response.on("data", (chunk) => { responseBody += chunk; });
      response.on("end", () => resolve({ status: response.statusCode, body: responseBody }));
    });
    const configured = Number(config.timeoutMs);
    const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 300000;
    request.setTimeout(timeoutMs, () => request.destroy(new Error("CheapKeyAI request timed out")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function parseJson(result, label) {
  let parsed;
  try { parsed = JSON.parse(result.body || "{}"); } catch { throw new Error(`CheapKeyAI ${label} returned invalid JSON`); }
  if (result.status < 200 || result.status >= 300) {
    const message = parsed && parsed.error && parsed.error.message ? parsed.error.message : "request failed";
    throw new Error(`CheapKeyAI ${label} ${result.status}: ${message}`);
  }
  return parsed;
}

function requireConfig(config) {
  if (!config || !config.apiKey) throw new Error("CheapKeyAI API key is not configured");
  if (!config.baseUrl) throw new Error("CheapKeyAI base URL is not configured");
}

async function callCheapKeyChat(config, params) {
  requireConfig(config);
  if (!params || !params.model) throw new Error("CheapKeyAI call needs a model id");
  const body = { model: params.model, messages: params.messages || [], max_tokens: params.maxTokens == null ? 4096 : params.maxTokens };
  if (params.temperature != null) body.temperature = params.temperature;
  const maxRetries = params.maxRetries == null ? 5 : params.maxRetries;
  let attempt = 0;
  let lastError;
  while (attempt <= maxRetries) {
    try {
      const result = await requestJson(config, "POST", "/chat/completions", body);
      if (result.status === 429) {
        attempt += 1;
        if (attempt > maxRetries) throw new Error("CheapKeyAI rate limited (429) after retries");
        await sleep(1000 * Math.pow(2, attempt - 1));
        continue;
      }
      const parsed = parseJson(result, "API");
      const choice = parsed.choices && parsed.choices[0];
      return { content: choice && choice.message ? choice.message.content || "" : "", usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, model: parsed.model || params.model, raw: parsed };
    } catch (error) {
      lastError = error;
      if (/CheapKeyAI (API|rate limited)/.test(error.message)) throw error;
      attempt += 1;
      if (attempt > maxRetries) break;
      await sleep(500 * Math.pow(2, attempt - 1));
    }
  }
  throw lastError || new Error("CheapKeyAI request failed");
}

async function listCheapKeyModels(config) {
  requireConfig(config);
  const parsed = parseJson(await requestJson(config, "GET", "/models"), "/models");
  return (Array.isArray(parsed.data) ? parsed.data : []).map((model) => String(model && model.id)).filter(Boolean);
}

async function getCheapKeyBalance(config) {
  requireConfig(config);
  const result = await requestJson(config, "GET", "/balance");
  const parsed = parseJson(result, "/balance");
  const data = parsed.data || {};
  return { status: result.status, remainingUsd: Number(data.user_balance || 0), usageUsd: Number(data.user_used_balance || 0), keyName: String(data.key_name || ""), keyUnlimitedQuota: Boolean(data.key_unlimited_quota), keyRemainQuota: Number(data.key_remain_quota || 0) };
}

async function getCheapKeyUsage(config, query = {}) {
  requireConfig(config);
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => { if (value != null && value !== "") params.set(key, String(value)); });
  const suffix = params.toString() ? `/usage/logs?${params}` : "/usage/logs";
  const parsed = parseJson(await requestJson(config, "GET", suffix), "/usage/logs");
  const data = parsed.data || {};
  return { items: Array.isArray(data.items) ? data.items : [], total: Number(data.total || 0), page: Number(data.page || 1), pageSize: Number(data.page_size || 20), scope: String(data.scope || "key") };
}

module.exports = { callCheapKeyChat, parseBaseUrl, listCheapKeyModels, getCheapKeyBalance, getCheapKeyUsage };
```

Delete `v98-client.js` and `test_v98_client_timeout.js` with `apply_patch` after the new client test passes.

- [ ] **Step 4: Add explicit error and retry cases**

Extend `test_cheapkey_client.js` with separate mocks that assert:

```js
await assert.rejects(
  () => client.callCheapKeyChat({ apiKey: "", baseUrl: "https://cheapkeyai.shop/v1" }, { model: "gpt-4o-mini" }),
  /CheapKeyAI API key is not configured/,
);
await assert.rejects(
  () => client.callCheapKeyChat({ apiKey: "x", baseUrl: "" }, { model: "gpt-4o-mini" }),
  /CheapKeyAI base URL is not configured/,
);
```

Add a 401 mock body `{ error: { message: "Invalid token" } }` and assert `CheapKeyAI API 401: Invalid token`. Add two 429 responses followed by a 200 response, inject or temporarily reduce the sleep function for the test, and assert exactly three requests occurred.

- [ ] **Step 5: Run the complete client test**

Run:

```powershell
node test_cheapkey_client.js
node --check cheapkey-client.js
```

Expected: PASS and both commands exit 0.

- [ ] **Step 6: Commit the client cutover**

```powershell
git add -- cheapkey-client.js test_cheapkey_client.js v98-client.js test_v98_client_timeout.js
git commit -m "refactor: add CheapKeyAI workflow client"
```

### Task 3: Switch the server and provider adapter configuration

**Files:**
- Modify: `server.js`
- Modify: `workflow-model-provider.js`
- Modify: `.env.example`
- Modify: `test_workflow_model_provider.js`
- Create: `test_cheapkey_cutover.js`

**Interfaces:**
- Consumes: `cheapkeyClient.callCheapKeyChat`, `cheapkeyClient.listCheapKeyModels`, `cheapkeyClient.getCheapKeyBalance`, `cheapkeyModels.resolveModelId`, and `modelCost.costMicros`.
- Produces: one immutable `workflowModelProvider` configured with CheapKeyAI.
- Preserves: `finalModelForTier(tier)` and `workflowModelProvider.callModel(modelId, messages, maxTokens)`.

- [ ] **Step 1: Write the failing source/config cutover test**

Create `test_cheapkey_cutover.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");

const server = fs.readFileSync("server.js", "utf8");
const env = fs.readFileSync(".env.example", "utf8");
const provider = fs.readFileSync("workflow-model-provider.js", "utf8");

assert(server.includes('require("./cheapkey-client")'));
assert(server.includes('require("./cheapkey-models")'));
assert(server.includes('process.env.CHEAPKEYAI_API_KEY || process.env.WORKFLOW_FINAL_API_KEY'));
assert(server.includes('"https://cheapkeyai.shop/v1"'));
assert(server.includes("CHEAPKEYAI_TIMEOUT_MS"));
assert(server.includes("CHEAPKEYAI_GROUP_RATIO"));
assert(server.includes("getCheapKeyModelSet"));
assert(server.includes("getCheapKeyBalanceCached"));
assert.equal(server.includes("V98STORE_"), false);
assert.equal(server.includes("v98Client"), false);
assert.equal(server.includes("v98Models"), false);
assert(env.includes("CHEAPKEYAI_API_KEY="));
assert(env.includes("CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1"));
assert(env.includes("CHEAPKEYAI_GROUP_RATIO=1"));
assert(env.includes("CHEAPKEYAI_TIMEOUT_MS=300000"));
assert.equal(env.includes("V98STORE_"), false);
assert.equal(provider.includes("v98"), false);

console.log("PASS: server configuration uses only CheapKeyAI");
```

- [ ] **Step 2: Run the cutover test and verify it fails**

Run:

```powershell
node test_cheapkey_cutover.js
```

Expected: FAIL because `server.js` still imports and configures v98store.

- [ ] **Step 3: Replace the server provider imports and constants**

In `server.js`, replace the v98 imports with:

```js
const cheapkeyClient = require("./cheapkey-client");
const cheapkeyModels = require("./cheapkey-models");
const modelCost = require("./model-cost");
```

Replace the provider constants and provider construction with:

```js
const CHEAPKEYAI_API_KEY = String(
  process.env.CHEAPKEYAI_API_KEY || process.env.WORKFLOW_FINAL_API_KEY || "",
).trim();
const CHEAPKEYAI_BASE_URL = String(
  process.env.CHEAPKEYAI_BASE_URL || "https://cheapkeyai.shop/v1",
).trim();
const CHEAPKEYAI_GROUP_RATIO = Number(process.env.CHEAPKEYAI_GROUP_RATIO || 1) || 1;
const CHEAPKEYAI_TIMEOUT_MS = Number(process.env.CHEAPKEYAI_TIMEOUT_MS || 300000) || 300000;
const WORKFLOW_FINAL_MODELS = {
  normal: String(process.env.WORKFLOW_FINAL_MODEL_NORMAL || "gpt-5.6-luna").trim(),
  plus: String(process.env.WORKFLOW_FINAL_MODEL_PLUS || "gpt-5.6-terra").trim(),
  pro: String(process.env.WORKFLOW_FINAL_MODEL_PRO || "gpt-5.6-sol").trim(),
};
const workflowModelProvider = createWorkflowModelProvider({
  apiKey: CHEAPKEYAI_API_KEY,
  baseUrl: CHEAPKEYAI_BASE_URL,
  timeoutMs: CHEAPKEYAI_TIMEOUT_MS,
  models: WORKFLOW_FINAL_MODELS,
  callChat: cheapkeyClient.callCheapKeyChat,
});
```

Update all provider-configured guards and public config flags from `V98STORE_API_KEY` to `CHEAPKEYAI_API_KEY`.

- [ ] **Step 4: Switch build-prompt execution and cost accounting**

In `handleWorkflowBuildPrompt`, resolve and call the provider with:

```js
const modelId = cheapkeyModels.resolveModelId(WORKFLOW_BUILD_PROMPT_MODEL);
const result = await cheapkeyClient.callCheapKeyChat(
  { apiKey: CHEAPKEYAI_API_KEY, baseUrl: CHEAPKEYAI_BASE_URL, timeoutMs: CHEAPKEYAI_TIMEOUT_MS },
  { model: modelId, maxTokens: 600, temperature: 0.7, messages: [/* keep existing messages unchanged */] },
);
const cost = modelCost.costMicros(
  modelId,
  result.usage.prompt_tokens,
  result.usage.completion_tokens,
  CHEAPKEYAI_GROUP_RATIO,
);
```

Keep the existing prompt messages byte-for-byte unchanged. Update the comment to say one CheapKeyAI call.

- [ ] **Step 5: Switch preflight model and balance caches**

Rename `_v98ModelsCache`, `_v98BillingCache`, `getV98ModelSet`, and `getV98BillingCached` to CheapKeyAI terminology. Implement the two provider calls as:

```js
const ids = await cheapkeyClient.listCheapKeyModels({
  apiKey: CHEAPKEYAI_API_KEY,
  baseUrl: CHEAPKEYAI_BASE_URL,
  timeoutMs: CHEAPKEYAI_TIMEOUT_MS,
});
```

and:

```js
const data = await cheapkeyClient.getCheapKeyBalance({
  apiKey: CHEAPKEYAI_API_KEY,
  baseUrl: CHEAPKEYAI_BASE_URL,
  timeoutMs: CHEAPKEYAI_TIMEOUT_MS,
});
```

Preserve the current 60-second cache, healthy-only preflight cache, missing-model behavior, `remainingUsd > 0.05` credit threshold, and soft-failure treatment for an unreachable balance endpoint.

- [ ] **Step 6: Update `.env.example`**

Replace the v98store block with:

```env
# CheapKeyAI OpenAI-compatible workflow provider. Keep the real key in cPanel or .env only.
CHEAPKEYAI_API_KEY=
CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1
# Catalog prices are before provider-group adjustment. Set the production key multiplier here.
CHEAPKEYAI_GROUP_RATIO=1
# GPT-5.6 responses can take several minutes.
CHEAPKEYAI_TIMEOUT_MS=300000
# Temporary production compatibility: runtime also accepts the existing
# WORKFLOW_FINAL_API_KEY, but CHEAPKEYAI_API_KEY is the canonical name.
```

Do not add a placeholder value for `WORKFLOW_FINAL_API_KEY`; document it only as the temporary server-side alias.

- [ ] **Step 7: Update the provider adapter test**

Change `test_workflow_model_provider.js` fixtures and assertions to use `cheapkey-test-key`, `https://cheapkeyai.shop/v1`, and the CheapKeyAI success label. Remove assertions that CheapKeyAI must be absent. Keep assertions for tier selection, empty-key disabling, timeout propagation, and request model forwarding.

- [ ] **Step 8: Run server/config tests**

Run:

```powershell
node test_cheapkey_cutover.js
node test_workflow_model_provider.js
node test_preflight.js
node test_workflow_async_api.js
node test_workflow_job_worker.js
node --check server.js
node --check workflow-model-provider.js
```

Expected: all commands exit 0.

- [ ] **Step 9: Commit the server cutover**

```powershell
git add -- server.js workflow-model-provider.js .env.example test_workflow_model_provider.js test_cheapkey_cutover.js
git commit -m "refactor: route workflows through CheapKeyAI"
```

### Task 4: Update workflow terminology and operational scripts

**Files:**
- Modify: `workflow-engine.js`
- Modify: `workflow-research.js`
- Modify: `workflow-cvgig.js`
- Modify: `workflow-cryptodd.js`
- Modify: `workflow-docgen.js`
- Modify: `workflow-defs.js`
- Modify: `measure-all.js`
- Modify: `measure-cryptodd.js`
- Modify: `measure-cvgig.js`
- Modify: `measure-real-cost.js`
- Modify: `run-workflow-once.js`

**Interfaces:**
- Consumes: `cheapkey-client.js`, `cheapkey-models.js`, and `CHEAPKEYAI_*` variables.
- Preserves: workflow executor function signatures, output shapes, progress events, and measurement script CLI arguments.

- [ ] **Step 1: Write a failing active-source terminology test**

Extend `test_cheapkey_cutover.js` to scan the active files listed above and reject these case-sensitive patterns:

```js
const activeFiles = [
  "server.js",
  "model-cost.js",
  "workflow-engine.js",
  "workflow-research.js",
  "workflow-cvgig.js",
  "workflow-cryptodd.js",
  "workflow-docgen.js",
  "workflow-defs.js",
  "measure-all.js",
  "measure-cryptodd.js",
  "measure-cvgig.js",
  "measure-real-cost.js",
  "run-workflow-once.js",
];
const activeSource = activeFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
["v98store", "V98STORE_", "v98Client", "v98Models", "callV98", "listV98", "getV98"].forEach((pattern) => {
  assert.equal(activeSource.includes(pattern), false, `active source still contains ${pattern}`);
});
```

- [ ] **Step 2: Run the scan and verify it fails**

Run:

```powershell
node test_cheapkey_cutover.js
```

Expected: FAIL and name at least one operational file with stale v98store terminology.

- [ ] **Step 3: Update workflow comments without changing behavior**

In the workflow executor and definition files, replace provider-specific comments only:

```text
v98store -> CheapKeyAI
v98 cost -> provider cost
v98 call -> CheapKeyAI call
```

Do not change graph definitions, prompts, aliases, token limits, model IDs, prices, control flow, or exported interfaces.

- [ ] **Step 4: Update operational script dependencies and environment names**

Apply this exact mapping in all five operational scripts:

```text
require("./v98-client") -> require("./cheapkey-client")
require("./v98-models") -> require("./cheapkey-models")
callV98Chat -> callCheapKeyChat
V98STORE_API_KEY -> CHEAPKEYAI_API_KEY, with WORKFLOW_FINAL_API_KEY as fallback
V98STORE_BASE_URL -> CHEAPKEYAI_BASE_URL
https://v98store.com/v1 -> https://cheapkeyai.shop/v1
V98STORE_GROUP_RATIO -> CHEAPKEYAI_GROUP_RATIO
v98 cost -> CheapKeyAI cost
```

For every script, resolve the key exactly as:

```js
const key = process.env.CHEAPKEYAI_API_KEY || process.env.WORKFLOW_FINAL_API_KEY || "";
```

Keep measurement output fields provider-neutral where data is consumed programmatically: use `providerUsd` instead of `v98Usd`, and calculate `realUsd = providerUsd + tavilyUsd`.

For `measure-real-cost.js`, replace the v98store dashboard subscription/usage delta with CheapKeyAI `/balance` data:

```js
const before = await cheapkeyClient.getCheapKeyBalance(config);
// Preserve the existing workflow execution.
const after = await cheapkeyClient.getCheapKeyBalance(config);
const providerUsd = Math.max(0, before.remainingUsd - after.remainingUsd);
```

- [ ] **Step 5: Run terminology, syntax, and executor tests**

Run:

```powershell
node test_cheapkey_cutover.js
node --check measure-all.js
node --check measure-cryptodd.js
node --check measure-cvgig.js
node --check measure-real-cost.js
node --check run-workflow-once.js
node test_workflow_engine.js
node test_workflow_execution.js
node test_workflow_research.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
```

Expected: all commands exit 0. Do not run any measurement script because those commands make paid provider calls.

- [ ] **Step 6: Commit the operational cleanup**

```powershell
git add -- workflow-engine.js workflow-research.js workflow-cvgig.js workflow-cryptodd.js workflow-docgen.js workflow-defs.js measure-all.js measure-cryptodd.js measure-cvgig.js measure-real-cost.js run-workflow-once.js test_cheapkey_cutover.js
git commit -m "chore: update workflow provider terminology"
```

### Task 5: Update internal provider guidance and project memory

**Files:**
- Create: `.agents/skills/cheapkeyai-api/SKILL.md`
- Modify: `.agents/skills/create-workflow/SKILL.md`
- Modify: `.agents/skills/v98store-api/SKILL.md`
- Modify: `AGENTS.md`
- Modify: `.codex/memory.md`

**Interfaces:**
- Produces: one authoritative CheapKeyAI provider skill for future workflow changes.
- Preserves: historical specs and plans as immutable decision records.

- [ ] **Step 1: Extend the terminology test to current guidance**

Add these current guidance files to the source scan in `test_cheapkey_cutover.js`:

```js
const guidanceFiles = [
  "AGENTS.md",
  ".agents/skills/create-workflow/SKILL.md",
  ".agents/skills/cheapkeyai-api/SKILL.md",
];
```

Assert that all three exist and contain no active instruction to use v98store. Do not scan historical files under `docs/superpowers/specs` or `docs/superpowers/plans`.

- [ ] **Step 2: Run the test and verify the missing/stale guidance failure**

Run:

```powershell
node test_cheapkey_cutover.js
```

Expected: FAIL because the CheapKeyAI skill is missing and the existing workflow guidance names v98store.

- [ ] **Step 3: Create the CheapKeyAI provider skill**

Create `.agents/skills/cheapkeyai-api/SKILL.md` with the verified contract from the design spec:

```markdown
---
name: cheapkeyai-api
description: Integration contract and model registry for the CheapKeyAI gateway that powers Fundline workflows. Use for workflow model calls, model IDs, provider pricing, balance checks, usage reconciliation, and spend caps.
---

# CheapKeyAI API integration

CheapKeyAI is Fundline's single OpenAI-compatible workflow model provider.

## Contract

- Base URL: `https://cheapkeyai.shop/v1`
- Chat: `POST /chat/completions`
- Models: `GET /models`
- Balance: `GET /balance`
- Usage: `GET /usage/logs`
- Auth: `Authorization: Bearer <CHEAPKEYAI_API_KEY>`
- Always send `max_tokens`.
- Keep the key server-side in `.env` and cPanel only.

## Configuration

Use `CHEAPKEYAI_API_KEY`, `CHEAPKEYAI_BASE_URL`, `CHEAPKEYAI_GROUP_RATIO`, and `CHEAPKEYAI_TIMEOUT_MS`. Runtime temporarily accepts `WORKFLOW_FINAL_API_KEY` as a compatibility alias. Never use `V98STORE_API_KEY` as a fallback.

## Model registry

Use `cheapkey-models.js` as the single source of truth for exact IDs and catalog prices. Unknown prices must not be treated as free. Keep cost arithmetic in integer micro-USD.

## Verification

Use local mock credentials in tests. A live model request spends provider balance and requires explicit action-time approval.
```

- [ ] **Step 4: Update current workflow guidance**

In `.agents/skills/create-workflow/SKILL.md` and `AGENTS.md`, change the provider reference to `cheapkeyai-api`, replace module references with `cheapkey-client.js` and `cheapkey-models.js`, and replace environment names with `CHEAPKEYAI_*`. Preserve all payment, escrow, 6-decimal USDC, rate-limit, and deployment rules.

Replace `.agents/skills/v98store-api/SKILL.md` with a short deprecation redirect that contains no active v98store integration instructions:

```markdown
---
name: v98store-api
description: Deprecated compatibility pointer for the former Fundline workflow provider. Use cheapkeyai-api for all current workflow model integration work.
---

# Deprecated provider skill

Fundline no longer routes workflow model calls through this provider. Use `../cheapkeyai-api/SKILL.md` as the current integration contract. Historical design records remain under `docs/superpowers/`.
```

- [ ] **Step 5: Update memory with the cutover decision**

Replace the superseded v98store decision entries in `.codex/memory.md` with a dated note stating:

```markdown
- 2026-08-25: Fundline workflow model calls use CheapKeyAI at `https://cheapkeyai.shop/v1`. Canonical env names are `CHEAPKEYAI_*`; runtime temporarily accepts `WORKFLOW_FINAL_API_KEY` for the cPanel key. The verified final-node IDs remain `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol`. No v98store fallback remains.
```

- [ ] **Step 6: Run guidance checks and commit**

Run:

```powershell
node test_cheapkey_cutover.js
git diff --check
```

Expected: PASS, no whitespace errors, no secret-shaped values added.

Commit only the listed guidance files and test:

```powershell
git add -- AGENTS.md .agents/skills/cheapkeyai-api/SKILL.md .agents/skills/create-workflow/SKILL.md .agents/skills/v98store-api/SKILL.md .codex/memory.md test_cheapkey_cutover.js
git commit -m "docs: make CheapKeyAI the workflow provider"
```

### Task 6: Run the full migration verification gate

**Files:**
- Verify only: all files changed in Tasks 1 through 5

**Interfaces:**
- Consumes: the completed CheapKeyAI client, registry, server wiring, operational scripts, and guidance.
- Produces: fresh evidence that the cutover is syntactically valid, behaviorally compatible, secret-safe, and free of active v98store runtime references.

- [ ] **Step 1: Run syntax checks**

```powershell
node --check server.js
node --check cheapkey-client.js
node --check cheapkey-models.js
node --check model-cost.js
node --check workflow-model-provider.js
```

Expected: every command exits 0 without output.

- [ ] **Step 2: Run the focused provider and workflow suite**

```powershell
node test_cheapkey_client.js
node test_cheapkey_cost.js
node test_cheapkey_cutover.js
node test_workflow_model_provider.js
node test_preflight.js
node test_workflow_engine.js
node test_workflow_execution.js
node test_workflow_research.js
node test_workflow_cvgig.js
node test_workflow_cryptodd.js
node test_workflow_docgen.js
node test_workflow_async_api.js
node test_workflow_job_store.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
node test_workflow_limiter.js
node test_workflow_mcp_tools.js
```

Expected: every test prints PASS and exits 0.

- [ ] **Step 3: Scan active source for stale provider references and secrets**

Run:

```powershell
rg -n "V98STORE_|v98store\.com|v98Client|v98Models|callV98|listV98|getV98" server.js .env.example cheapkey-client.js cheapkey-models.js model-cost.js workflow-model-provider.js workflow-*.js measure-*.js run-workflow-once.js AGENTS.md .agents/skills .codex/memory.md
rg -n "sk-[A-Za-z0-9]{12,}|Bearer sk-" server.js .env.example cheapkey-client.js cheapkey-models.js test_cheapkey_*.js AGENTS.md .agents/skills .codex/memory.md
```

Expected: the stale-provider scan returns no active integration references except the intentional deprecated skill name/path and its statement that no fallback remains. The secret scan returns no matches.

- [ ] **Step 4: Review the complete diff**

```powershell
git diff HEAD~4 --stat
git diff HEAD~4 --check
git status --short
```

Confirm:

- No workflow prompt, tier, price, model assignment, settlement logic, or payment logic changed.
- No real key or cPanel value appears in the diff.
- Only the files listed in this plan were staged or committed.
- Existing unrelated untracked files remain untouched.

- [ ] **Step 5: Record final verification evidence**

If verification reveals a defect, add a failing regression test before the fix and commit the fix separately. If verification passes, do not create an empty commit. Report the exact passing commands and note that no paid live request, deployment, push, or cPanel change occurred.

## Execution Notes

- Use `apply_patch` for every source edit and deletion.
- Do not run `measure-*.js` or `run-workflow-once.js`; they spend provider balance.
- Do not use the signed-in browser to reveal, copy, create, rotate, disable, or edit API keys.
- A future production deployment should run the project `predeploy-check` skill before any push.
