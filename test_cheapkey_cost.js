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
  "cheap-5.6-terra": [2.00, 12.00],
  "cheap-5.6-sol": [5.00, 30.00],
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
assert.equal(modelCost.costMicros("cheap-5.6-terra", 1000, 500, 1), 8000);
assert.equal(modelCost.costMicros("cheap-5.6-sol", 1000, 500, 1), 20000);
assert.equal(modelCost.costMicros("unknown-model", 10, 10, 1), 0);

console.log("PASS: CheapKeyAI model prices and cost accounting");
