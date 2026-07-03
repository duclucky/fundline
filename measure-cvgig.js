"use strict";

// Live measurement for the CV + Gig Match workflow. Runs the real chain (v98
// LLM calls + real gig APIs) once per tier and prints the real v98 cost, so the
// per-tier USDC price can be set (process rule: measure before publishing).
// Run: node measure-cvgig.js   (uses .env V98 key; JSEARCH_API_KEY via env or flag)

const fs = require("fs");
const v98Client = require("./v98-client");
const gigSources = require("./gig-sources");
const cvGig = require("./workflow-cvgig");

// Minimal .env loader (first-wins, same spirit as server.js).
try {
  fs.readFileSync(".env", "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim();
  });
} catch (_) {}

const V98_CONFIG = { apiKey: process.env.V98STORE_API_KEY, baseUrl: process.env.V98STORE_BASE_URL || "https://v98store.com/v1" };
const GROUP_RATIO = Number(process.env.V98STORE_GROUP_RATIO || 1) || 1;
const JSEARCH_KEY = process.env.JSEARCH_API_KEY || "";

const TIER_MODELS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6" },
};

const INPUT = "Senior Solidity developer, 5 years experience. Built a decentralized exchange and several ERC-20 token platforms. "
  + "Skills: Solidity, Hardhat, Foundry, React, TypeScript, The Graph. Portfolio: github.com/example, site example.dev. "
  + "Based in Vietnam, work remotely. Looking for remote smart-contract audit and development contracts. English fluent.";

function callModel(modelId, messages, maxTokens) {
  return v98Client.callV98Chat(V98_CONFIG, { model: modelId, messages, maxTokens })
    .then((r) => ({ content: r.content, usage: r.usage }));
}

async function measureTier(tier) {
  const models = TIER_MODELS[tier];
  const started = Date.now();
  const res = await cvGig.runCvGigWorkflow({
    input: INPUT,
    topGigs: 8,
    profileModel: models.FAST,
    cvModel: models.STRONG,
    rankModel: models.STRONG,
    groupRatio: GROUP_RATIO,
    jsearchKey: JSEARCH_KEY,
    jsearchAvailable: !!JSEARCH_KEY,
    callModel,
    fetchGigs: (o) => gigSources.fetchGigs(o),
  });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const usd = (res.totalCostMicros / 1000000);
  console.log(`\n===== TIER ${tier.toUpperCase()} =====`);
  console.log(`v98 cost: $${usd.toFixed(6)}  (${res.totalCostMicros} micro-USD)  | ${secs}s`);
  console.log("steps:", res.steps.map((s) => `${s.name}=${s.model || "-"}:${s.costMicros}`).join("  "));
  console.log("gig sources:", JSON.stringify(res.meta.sourceCounts), res.meta.errors.length ? ("errors " + JSON.stringify(res.meta.errors)) : "");
  console.log("gigs ranked:", res.gigs.length, "| template:", res.cvJson.templateId, "| cv name:", JSON.stringify(res.cvJson.name));
  console.log("top gig:", res.gigs[0] ? `${res.gigs[0].title} | ${res.gigs[0].budget || "no budget"} | ${res.gigs[0].url}` : "(none)");
  console.log("cv skills:", (res.cvJson.skills || []).join(", "));
  return { tier, usd, gigs: res.gigs.length, secs };
}

(async () => {
  if (!V98_CONFIG.apiKey) { console.error("V98STORE_API_KEY not set"); process.exit(1); }
  console.log("JSearch key:", JSEARCH_KEY ? "present" : "ABSENT (free sources only)");
  const summary = [];
  for (const tier of ["normal", "plus", "pro"]) {
    try { summary.push(await measureTier(tier)); }
    catch (e) { console.error(`TIER ${tier} FAILED:`, e.message); }
  }
  console.log("\n===== SUMMARY (real v98 cost per run) =====");
  summary.forEach((s) => console.log(`${s.tier.padEnd(7)} $${s.usd.toFixed(6)}  gigs=${s.gigs}  ${s.secs}s`));
})();
