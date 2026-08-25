"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const envExample = fs.readFileSync(path.join(root, ".env.example"), "utf8");

assert.equal(serverSource.includes("WORKFLOW_FINAL_API_KEY"), true);
assert.equal(serverSource.includes("WORKFLOW_FINAL_BASE_URL"), false);
assert.equal((serverSource.match(/workflowModelProvider\.callModel/g) || []).length, 2);
assert.equal(serverSource.includes("timeoutMs: CHEAPKEYAI_TIMEOUT_MS"), true);
assert.equal(serverSource.includes("cheapkeyai.shop"), true);
assert.equal(envExample.includes("WORKFLOW_FINAL_API_KEY"), true);
assert.equal(envExample.includes("CHEAPKEYAI_TIMEOUT_MS=300000"), true);

const { createWorkflowModelProvider } = require("./workflow-model-provider");

async function main() {
  const calls = [];
  const provider = createWorkflowModelProvider({
    apiKey: "cheapkey-test-key",
    baseUrl: "https://cheapkeyai.shop/v1",
    timeoutMs: 300000,
    models: {
      normal: "cheap-5.6-sol",
      plus: "cheap-5.6-terra",
      pro: "cheap-5.6-sol",
    },
    callChat: async (config, request) => {
      calls.push({ config, request });
      return { content: "ok", usage: { total_tokens: 3 } };
    },
  });

  assert.equal(provider.finalModelForTier("normal"), "cheap-5.6-sol");
  assert.equal(provider.finalModelForTier("plus"), "cheap-5.6-terra");
  assert.equal(provider.finalModelForTier("pro"), "cheap-5.6-sol");
  assert.equal(provider.finalModelForTier("unknown"), "");

  const result = await provider.callModel(
    "cheap-5.6-sol",
    [{ role: "user", content: "test" }],
    32
  );
  assert.deepEqual(result, { content: "ok", usage: { total_tokens: 3 } });
  assert.deepEqual(calls[0].config, {
    apiKey: "cheapkey-test-key",
    baseUrl: "https://cheapkeyai.shop/v1",
    timeoutMs: 300000,
  });
  assert.equal(calls[0].request.model, "cheap-5.6-sol");

  const disabled = createWorkflowModelProvider({
    apiKey: "",
    baseUrl: "https://cheapkeyai.shop/v1",
    models: { normal: "cheap-5.6-sol" },
    callChat: async () => ({ content: "", usage: {} }),
  });
  assert.equal(disabled.finalModelForTier("normal"), "");
  console.log("PASS: workflow model provider uses CheapKeyAI");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
