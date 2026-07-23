"use strict";

// Tests the fixed GPT-5.6 estimates in premium-models.js and the provider-agnostic
// model-cost.js aggregator that feeds the daily budget and per-key caps.

const premium = require("./premium-models");
const modelCost = require("./model-cost");
const v98 = require("./v98-models");

let passed = 0;
let failed = 0;
function eq(name, got, want) {
  if (got === want) { passed++; }
  else { failed++; console.error("FAIL: " + name + " -> got " + got + ", want " + want); }
}
function ok(name, cond) {
  if (cond) { passed++; }
  else { failed++; console.error("FAIL: " + name); }
}

// The retained GPT-5.6 estimates are flat (input == output).
eq("luna 1M in only", premium.premiumCostMicros("gpt-5.6-luna", 1000000, 0), 80000);
eq("luna 1M out only", premium.premiumCostMicros("gpt-5.6-luna", 0, 1000000), 80000);
eq("luna 1000 in 500 out", premium.premiumCostMicros("gpt-5.6-luna", 1000, 500), 120); // 1500 * 0.08
eq("terra 1M in", premium.premiumCostMicros("gpt-5.6-terra", 1000000, 0), 83000);
eq("sol 1M in", premium.premiumCostMicros("gpt-5.6-sol", 1000000, 0), 92000);
// The measured doc-gen run: 368 prompt + 956 completion = 1324 tokens * 0.08 = 105.92 -> 106.
eq("luna measured doc-gen run", premium.premiumCostMicros("gpt-5.6-luna", 368, 956), 106);
eq("non-premium id -> null", premium.premiumCostMicros("gpt-4o-mini", 1000, 500), null);
eq("garbage in -> 0 tokens", premium.premiumCostMicros("gpt-5.6-luna", -5, "x"), 0);

ok("isPremiumModel luna", premium.isPremiumModel("gpt-5.6-luna") === true);
ok("isPremiumModel v98 id", premium.isPremiumModel("gpt-4o-mini") === false);
ok("isPremiumModel empty", premium.isPremiumModel("") === false);

// model-cost: premium first, then v98, then 0 for a fully unknown id.
eq("aggregator routes premium", modelCost.costMicros("gpt-5.6-luna", 1000000, 0, 1), 80000);
eq("fixed GPT-5.6 estimate ignores group ratio", modelCost.costMicros("gpt-5.6-luna", 1000000, 0, 5), 80000);
// v98 models delegate to computeCostMicros (robust to price-table drift).
eq("aggregator delegates v98",
  modelCost.costMicros("gpt-4o-mini", 1000, 500, 1),
  v98.computeCostMicros("gpt-4o-mini", 1000, 500, 1));
ok("aggregator v98 result > 0", modelCost.costMicros("gpt-4o-mini", 1000, 500, 1) > 0);
eq("aggregator unknown id -> 0", modelCost.costMicros("no-such-model-xyz", 1000, 500, 1), 0);
ok("aggregator always a number", typeof modelCost.costMicros("gpt-5.6-sol", 10, 10, 1) === "number");

console.log((failed === 0 ? "PASS" : "FAIL") + ": " + passed + " passed, " + failed + " failed");
if (failed > 0) process.exit(1);
