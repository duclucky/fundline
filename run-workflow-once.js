"use strict";

// Run one workflow ONCE with real v98 calls to (a) review output quality and
// (b) measure real cost. Because output length is governed by per-node directives
// and input is the prior nodes' outputs, the token counts are ~tier-independent:
// we capture real prompt/completion tokens per node from a single run, then
// compute the cost for ALL THREE tiers by applying each tier's model prices.
//
// Usage: node run-workflow-once.js <slug> [tier]
//   tier (default normal) only decides which models actually run this once.
//
// Prints: per-node tokens + output preview, the full final report (for quality
// review), and a cost + suggested-price table for normal/plus/pro.

const fs = require("fs");
const path = require("path");
const defs = require("./workflow-defs");
const engine = require("./workflow-engine");
const v98 = require("./v98-models");
const v98Client = require("./v98-client");

// --- minimal .env loader (first-wins, like server.js) ---
function loadEnv() {
  const p = path.join(__dirname, ".env");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv();

const TIER_MODELS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", RESEARCH: "deepseek-r1-searching", CODE: "deepseek-v3.2", FORMATTER: "gpt-4o-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", RESEARCH: "grok-3-deepsearch", CODE: "kimi-k2.7-code", FORMATTER: "gpt-4o-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6", RESEARCH: "grok-4", CODE: "claude-sonnet-4-6", FORMATTER: "gpt-4o-mini" },
};
const RATIO = Number(process.env.V98STORE_GROUP_RATIO) > 0 ? Number(process.env.V98STORE_GROUP_RATIO) : 1;
const NICE = [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.08, 0.10, 0.12, 0.15, 0.20, 0.25, 0.30, 0.40, 0.50, 0.75, 1.00];
const roundDownNice = (x) => { let v = NICE[0]; for (const n of NICE) if (n <= x) v = n; return v; };

// Representative sample inputs (only the user's first input; everything else is
// produced by the chain). Keep them realistic but modest.
const SAMPLES = {
  "proposal-sow": "Project: redesign and rebuild the marketing website for Acme Corp (a B2B SaaS). Budget around $18,000. Must launch before their Q3 product launch (about 8 weeks away). They want a modern look, faster load times, and a simple CMS so their team can edit pages. Service type: web design + development.",
  "call-recap": "Kickoff call with Acme Corp. Present: Sam (Acme, Head of Marketing) and me. Sam said the current site is slow and outdated and they want a redesign live before the Q3 launch. We agreed on a 6-week build. Sam will send brand assets on Monday. We discussed a monthly maintenance retainer to be quoted separately. Open question: who approves the final design. I will send a proposal and SOW by Friday.",
  "swot-analysis": "A small 3-person design studio that wants to move into Web3 and crypto brand identity work. Strong visual design skills, no existing Web3 client network, limited dev capability. The Web3 branding market is growing but crowded with freelancers.",
};

async function main() {
  const slug = process.argv[2];
  const tier = process.argv[3] || "normal";
  if (!slug || !defs.getGraph(slug)) {
    console.error("Usage: node run-workflow-once.js <slug> [tier]\nKnown slugs:\n  " + Object.keys(defs.WORKFLOW_GRAPHS).join("\n  "));
    process.exit(1);
  }
  if (!process.env.V98STORE_API_KEY) { console.error("V98STORE_API_KEY not set in .env"); process.exit(1); }

  const graph = defs.getGraph(slug);
  const tierModels = TIER_MODELS[tier];
  const input = SAMPLES[slug] || `Sample input for the ${slug} workflow with enough detail to produce a realistic result.`;
  const v98config = { apiKey: process.env.V98STORE_API_KEY, baseUrl: process.env.V98STORE_BASE_URL || "https://v98store.com/v1" };

  // Record the real token usage of each model call, in node order.
  const usages = [];
  const callModel = async (modelId, messages, maxTokens) => {
    const r = await v98Client.callV98Chat(v98config, { model: modelId, messages, maxTokens });
    usages.push({ model: modelId, usage: r.usage });
    return { content: r.content, usage: r.usage };
  };

  console.log(`\nRunning "${slug}" (tier ${tier}) with real v98 calls...\n`);
  const t0 = Date.now();
  const result = await engine.runWorkflowGraph({
    graph, tierModels, input, mode: "search", groupRatio: RATIO,
    today: new Date().toISOString().slice(0, 10), callModel,
    onProgress: (e) => { if (e.status === "running") process.stdout.write(`  - ${e.step} ...\n`); },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // Map recorded usages back to the model nodes (in order) for per-tier costing.
  const modelNodes = graph.nodes.filter((n) => n.build && n.alias);
  console.log(`\n=== Per-node (real tokens) ===`);
  const perNode = [];
  modelNodes.forEach((n, i) => {
    const u = usages[i] ? usages[i].usage : { prompt_tokens: 0, completion_tokens: 0 };
    perNode.push({ alias: n.alias, name: n.name, pt: u.prompt_tokens || 0, ct: u.completion_tokens || 0 });
    console.log(`  ${n.name.padEnd(28)} alias=${String(n.alias).padEnd(9)} in=${String(u.prompt_tokens||0).padStart(5)} out=${String(u.completion_tokens||0).padStart(5)}`);
  });

  console.log(`\n=== Cost + suggested price per tier (group ratio ${RATIO}) ===`);
  const prices = {};
  for (const t of ["normal", "plus", "pro"]) {
    let micros = 0;
    perNode.forEach((nd) => {
      const model = v98.resolveModelId(TIER_MODELS[t][nd.alias] || "");
      micros += v98.computeCostMicros(model, nd.pt, nd.ct, RATIO) || 0;
    });
    const cost = micros / 1e6;
    const price = roundDownNice(cost);
    prices[t] = price;
    console.log(`  ${t.padEnd(7)} cost $${cost.toFixed(4)}  ->  price $${price.toFixed(2)}  (${Math.round(price * 1e6)} units)`);
  }

  console.log(`\n=== FINAL OUTPUT (quality review) ===  [${secs}s]\n`);
  console.log(result.report);
  console.log(`\n=== Suggested price line ===`);
  console.log(`"${slug}": { normal: ${prices.normal.toFixed(2)}, plus: ${prices.plus.toFixed(2)}, pro: ${prices.pro.toFixed(2)} }`);
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
