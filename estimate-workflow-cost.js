"use strict";

// Offline cost estimator for every workflow/tier. For each node it predicts:
//   output tokens  = node.outWords (the length directive) -> tokens
//   input tokens   = fixed prompt text + the outWords of the prior nodes it reads
//                    (+ an assumed user-input size for nodes that read ctx.input)
// then cost = computeCostMicros(model, inTok, outTok, groupRatio), summed per
// workflow per tier. Prints a table and a price suggestion (price = base cost x
// markup, rounded DOWN to a clean USDC value -> in the user's favor).
//
// Run: node estimate-workflow-cost.js   (env: V98STORE_GROUP_RATIO, MARKUP)
// The per-node input deps are discovered by calling node.build with a recording
// Proxy for ctx.outputs, so the estimate tracks the real chain accumulation.

const defs = require("./workflow-defs");
const v98 = require("./v98-models");

// Mirror server.js WORKFLOW_TIER_MODELS (alias -> model per tier).
const TIER_MODELS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", RESEARCH: "deepseek-r1", CODE: "deepseek-v3.2", FORMATTER: "gpt-4o-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", RESEARCH: "deepseek-r1", CODE: "kimi-k2.7-code", FORMATTER: "gpt-4o-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6", RESEARCH: "deepseek-r1", CODE: "claude-sonnet-4-6", FORMATTER: "gpt-4o-mini" },
};

const GROUP_RATIO = Number(process.env.V98STORE_GROUP_RATIO) > 0 ? Number(process.env.V98STORE_GROUP_RATIO) : 1;
const MARKUP = Number(process.env.MARKUP) > 0 ? Number(process.env.MARKUP) : 1;

// Assumed user-input size (words) per workflow, for nodes that read ctx.input.
// Paste-heavy workflows (code, diffs, whitepapers, transcripts) assume larger input.
const ASSUMED_INPUT_WORDS = {
  "code-review": 1200, "pr-diff-review": 1500, "whitepaper-summary": 3000,
  "call-recap": 1500, "handover-report": 600, "timeline-from-sow": 600,
  "proposal-sow": 400, "rfp-proposal": 800, "seo-audit": 800,
};
const DEFAULT_INPUT_WORDS = 400;

const TOKENS_PER_WORD = 1.333;   // ~0.75 words per token (English)
const CHARS_PER_TOKEN = 4;       // rough English token size
const wordsToTokens = (w) => Math.round((w || 0) * TOKENS_PER_WORD);
const charsToTokens = (c) => Math.round((c || 0) / CHARS_PER_TOKEN);

// Round a USDC amount DOWN to a clean value (favors the user).
const NICE = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.00];
function roundDownNice(x) {
  let v = NICE[0];
  for (const n of NICE) { if (n <= x) v = n; }
  return v;
}

function estimateNode(node, slug, outWordsMap, tierModels) {
  // Local / no-model nodes cost nothing.
  if (!node.build || !node.alias) return { model: null, inTok: 0, outTok: 0, micros: 0 };

  const SENT = "IN";
  const deps = new Set();
  const ctx = {
    input: SENT,
    today: "2026-06-29",
    maxQueries: 3,
    totalWords: node.outWords || 1000,
    outputs: new Proxy({}, { get(_t, k) { if (typeof k === "string") deps.add(k); return ""; } }),
    parsed: new Proxy({}, { get() { return ""; } }),
  };
  let text = node.build(ctx).map((m) => m.content).join("\n");
  const usesInput = text.indexOf(SENT) !== -1;
  text = text.split(SENT).join("");

  const fixedTok = charsToTokens(text.length);
  let depTok = 0;
  deps.forEach((id) => { depTok += wordsToTokens(outWordsMap[id] || 0); });
  const inputTok = usesInput ? wordsToTokens(ASSUMED_INPUT_WORDS[slug] || DEFAULT_INPUT_WORDS) : 0;

  const inTok = fixedTok + depTok + inputTok;
  const outTok = wordsToTokens(node.outWords || 0);
  const model = v98.resolveModelId(tierModels[node.alias] || "");
  const micros = v98.computeCostMicros(model, inTok, outTok, GROUP_RATIO) || 0;
  return { model, inTok, outTok, micros };
}

function estimateWorkflow(slug, tier) {
  const g = defs.getGraph(slug);
  const tierModels = TIER_MODELS[tier];
  const outWordsMap = {};
  g.nodes.forEach((n) => { outWordsMap[n.id] = n.outWords || 0; });
  let micros = 0;
  g.nodes.forEach((n) => { micros += estimateNode(n, slug, outWordsMap, tierModels).micros; });
  return micros;
}

const slugs = Object.keys(defs.WORKFLOW_GRAPHS);
const serverPrices = {};
const frontendPrices = {};

console.log(`Group ratio: ${GROUP_RATIO}  Markup: ${MARKUP}x  (price = base cost x markup, rounded down to a clean value)\n`);
console.log("workflow".padEnd(24) + "  " + ["normal", "plus", "pro"].map((t) => `${t} cost->price`.padEnd(22)).join(""));
console.log("-".repeat(24 + 2 + 22 * 3));

for (const slug of slugs) {
  const row = { normal: 0, plus: 0, pro: 0 };
  const cells = [];
  serverPrices[slug] = {};
  frontendPrices[slug] = {};
  for (const tier of ["normal", "plus", "pro"]) {
    const micros = estimateWorkflow(slug, tier);
    const costUsd = micros / 1e6;
    const price = roundDownNice(costUsd * MARKUP);
    serverPrices[slug][tier] = Math.round(price * 1e6); // 6-decimal USDC base units
    frontendPrices[slug][tier] = price.toFixed(2);
    cells.push(`$${costUsd.toFixed(4)}->$${price.toFixed(2)}`.padEnd(22));
  }
  console.log(slug.padEnd(24) + "  " + cells.join(""));
}

console.log("\n// ---- server.js: WORKFLOW_PRICE_TABLE (priceUnits, 6-decimal USDC) ----");
console.log("const WORKFLOW_PRICE_TABLE = " + JSON.stringify(serverPrices, null, 2) + ";");
console.log("\n// ---- workflows.js: WF_PRICE_TABLE (display strings) ----");
console.log("const WF_PRICE_TABLE = " + JSON.stringify(frontendPrices, null, 2) + ";");
