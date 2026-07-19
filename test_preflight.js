"use strict";

// Unit test for the preflight helper. Requires server.js WITHOUT booting it (the listen
// and Telegram polling are gated on FUNDLINE_NO_LISTEN), so this does not touch the bot.
process.env.FUNDLINE_NO_LISTEN = "1";
const { requiredModelsForRun } = require("./server");
const { peek } = require("./workflow-limiter");

let failures = 0;
function eq(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log((ok ? "PASS" : "FAIL") + " - " + label + (ok ? "" : ` (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`));
}

// requiredModelsForRun: distinct, non-empty model ids for a tier.
eq("distinct + deduped",
  requiredModelsForRun({ tiers: { normal: { models: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", FMT: "gpt-4o-mini" } } } }, "normal").sort(),
  ["deepseek-v3.2", "gpt-4o-mini"]);
eq("filters empty ids",
  requiredModelsForRun({ tiers: { pro: { models: { A: "claude-sonnet-4-6", B: "" } } } }, "pro"),
  ["claude-sonnet-4-6"]);
eq("unknown tier -> []", requiredModelsForRun({ tiers: {} }, "normal"), []);
eq("no def -> []", requiredModelsForRun(null, "normal"), []);
eq("no models map -> []", requiredModelsForRun({ tiers: { normal: {} } }, "normal"), []);

// peek: read-only headroom, does not throw and returns an ok flag.
const p = peek({
  usagePath: "/nonexistent/usage.json",
  budgetPath: "/nonexistent/budget.json",
  ipKey: "test:1.2.3.4",
  kind: "run",
  limits: { dailyBudgetMicros: 10_000_000, spendCapMicros: 2_000_000, runsPerDay: 100, gensPerDay: 100 },
});
eq("peek ok on fresh store", p.ok, true);
eq("peek does not reserve (remaining full)", p.remaining, 100);

if (failures) {
  console.error("\n" + failures + " test(s) FAILED");
  process.exit(1);
}
console.log("\nAll preflight tests passed.");
