"use strict";

// Measure the REAL v98 cost of one workflow run by diffing the billing usage
// before/after (this captures the actual group_ratio and any web-search surcharge,
// unlike the token-based estimate). Usage: node measure-real-cost.js <slug> [tier]
// total_usage from /dashboard/billing/usage is in US cents.

const fs = require("fs");
const path = require("path");
const https = require("https");
const defs = require("./workflow-defs");
const engine = require("./workflow-engine");
const v98 = require("./v98-models");
const v98Client = require("./v98-client");

(function loadEnv() {
  const p = path.join(__dirname, ".env");
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
})();

const TIER_MODELS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", RESEARCH: "gpt-4o-mini-search-preview", CODE: "deepseek-v3.2", FORMATTER: "gpt-4o-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", RESEARCH: "gpt-4o-mini-search-preview", CODE: "kimi-k2.7-code", FORMATTER: "gpt-4o-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6", RESEARCH: "gpt-4o-mini-search-preview", CODE: "claude-sonnet-4-6", FORMATTER: "gpt-4o-mini" },
};
const RATIO = Number(process.env.V98STORE_GROUP_RATIO) > 0 ? Number(process.env.V98STORE_GROUP_RATIO) : 1;
const base = (process.env.V98STORE_BASE_URL || "https://v98store.com/v1").replace(/\/$/, "");
const key = process.env.V98STORE_API_KEY;

function billingUsage() {
  return new Promise((res, rej) => {
    const today = "2026-07-01";
    const u = new URL(base + "/dashboard/billing/usage?start_date=2026-06-01&end_date=" + today);
    https.get({ hostname: u.hostname, path: u.pathname + u.search, headers: { Authorization: "Bearer " + key } }, (r) => {
      let b = ""; r.on("data", (c) => b += c); r.on("end", () => { try { res(JSON.parse(b).total_usage); } catch (e) { rej(new Error(b)); } });
    }).on("error", rej);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const slug = process.argv[2];
  const tier = process.argv[3] || "normal";
  const graph = defs.getGraph(slug);
  if (!graph) { console.error("unknown slug"); process.exit(1); }
  const SAMPLES = {
    "proposal-sow": "Project: redesign and rebuild the marketing website for Acme Corp (a B2B SaaS). Budget around $18,000. Must launch before their Q3 product launch (about 8 weeks away). They want a modern look, faster load times, and a simple CMS. Service type: web design + development.",
    "client-research": "Research Notion Inc for a partnership outreach call. We want to integrate our USDC invoicing product with their API.",
    "swot-analysis": "A small 3-person design studio moving into Web3 brand identity. Strong design, no Web3 network, limited dev capability.",
  };
  const input = SAMPLES[slug] || ("Sample input for the " + slug + " workflow with enough detail to produce a realistic result.");

  const v98config = { apiKey: key, baseUrl: base };
  let estMicros = 0;
  const callModel = async (modelId, messages, maxTokens) => {
    const r = await v98Client.callV98Chat(v98config, { model: modelId, messages, maxTokens });
    estMicros += v98.computeCostMicros(modelId, r.usage.prompt_tokens, r.usage.completion_tokens, RATIO) || 0;
    return { content: r.content, usage: r.usage };
  };

  const before = await billingUsage();
  console.log(`Running ${slug} (${tier})... billing before = ${before} cents`);
  await engine.runWorkflowGraph({ graph, tierModels: TIER_MODELS[tier], input, mode: "search", groupRatio: RATIO, today: "2026-06-30", callModel, onProgress: () => {} });

  // Poll until billing reflects the run (NewAPI can lag a few seconds).
  let after = before;
  for (let i = 0; i < 8; i++) { await sleep(4000); after = await billingUsage(); if (after > before) break; }

  const realCents = after - before;
  const realUsd = realCents / 100;
  const estUsd = estMicros / 1e6;
  console.log(`billing after  = ${after} cents`);
  console.log(`REAL cost  = ${realCents.toFixed(4)} cents = $${realUsd.toFixed(6)}`);
  console.log(`EST (token)= $${estUsd.toFixed(6)}  (ratio ${RATIO})`);
  console.log(`real / est = ${estUsd > 0 ? (realUsd / estUsd).toFixed(2) : "n/a"}x`);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
