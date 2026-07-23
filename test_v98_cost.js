"use strict";

// Standalone test for v98-models cost + id mapping. Run: node test_v98_cost.js

const { resolveModelId, computeCostMicros, getPrice } = require("./v98-models");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${got}, want ${want})`, got === want);
}

// --- id mapping (labels must map to real ids with date suffixes) ---
eq("label gpt-4.1-mini", resolveModelId("gpt-4.1-mini"), "gpt-4.1-mini");
eq("label claude-3-haiku", resolveModelId("claude-3-haiku"), "claude-3-haiku-20240307");
eq("label claude-3.5-sonnet", resolveModelId("claude-3.5-sonnet"), "claude-3-5-sonnet-20241022");
eq("already a real id passes through", resolveModelId("claude-sonnet-4-6"), "claude-sonnet-4-6");
eq("unknown returns as-is", resolveModelId("totally-unknown"), "totally-unknown");

// --- pricing present ---
check("price exists for gpt-4.1-mini", getPrice("gpt-4.1-mini") !== null);
check("price null for unknown", getPrice("nope") === null);

// --- cost math (micro-USD = pt*inPer1M + ct*outPer1M, times group ratio) ---
// gpt-4.1-mini: measured v98 billing is in 1.13 / out 4.53 per 1M.
eq("1M input only", computeCostMicros("gpt-4.1-mini", 1000000, 0, 1), 1130000);
eq("1M output only", computeCostMicros("gpt-4.1-mini", 0, 1000000, 1), 4530000);
eq("mixed small (9 in, 10 out)", computeCostMicros("gpt-4.1-mini", 9, 10, 1), 55);
eq("group ratio 2x doubles", computeCostMicros("gpt-4.1-mini", 1000000, 0, 2), 2260000);
eq("group ratio default when 0", computeCostMicros("gpt-4.1-mini", 1000000, 0, 0), 1130000);
eq("unknown model -> null", computeCostMicros("nope", 100, 100, 1), null);
// claude-3-5-sonnet: in 3.00 / out 15.00 per 1M -> 1000 in + 500 out = 3000 + 7500 = 10500 micro
eq("sonnet 1000 in 500 out", computeCostMicros("claude-3-5-sonnet-20241022", 1000, 500, 1), 10500);

console.log(`\nv98 cost test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
