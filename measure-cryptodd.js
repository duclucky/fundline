"use strict";

// Live measurement for crypto-dd: one real run per tier (real v98 + real DexScreener +
// GoPlus + Tavily) to confirm real cost and eyeball output quality before pricing.
// No secret in this file; keys are read from .env. Run: node measure-cryptodd.js

const fs = require("fs");
const v98Client = require("./v98-client");
const v98Models = require("./v98-models");
const tavilyClient = require("./tavily-client");
const cryptoData = require("./crypto-data");
const cryptoDd = require("./workflow-cryptodd");

// Minimal .env loader (first-wins, like the server), only for this script.
try {
  fs.readFileSync(".env", "utf8").split(/\r?\n/).forEach((line) => {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  });
} catch (_) {}

const V98_KEY = process.env.V98STORE_API_KEY;
const V98_URL = process.env.V98STORE_BASE_URL || "https://v98store.com/v1";
const TAVILY_KEY = process.env.TAVILY_API_KEY;
const GROUP = Number(process.env.V98STORE_GROUP_RATIO || 1);

const TIERS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", VERIFY: "gpt-4.1-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", VERIFY: "gpt-4.1-mini" },
  pro: { FAST: "gpt-4o-mini", STRONG: "claude-sonnet-4-6", VERIFY: "claude-sonnet-4-6" },
};

const TOKEN = { chain: "ethereum", address: "0x6982508145454ce325dDbE47a25d4ec3d2311933" }; // PEPE

const callModel = (modelId, messages, maxTokens) =>
  v98Client.callV98Chat({ apiKey: V98_KEY, baseUrl: V98_URL }, { model: modelId, messages, maxTokens })
    .then((r) => ({ content: r.content, usage: r.usage }));
const searchWeb = TAVILY_KEY
  ? (q) => tavilyClient.searchTavily({ apiKey: TAVILY_KEY }, { query: q, maxResults: 6 }).then((r) => r.results)
  : null;

function priceFloor(usd) {
  // Cost-based, user-favorable: round the real cost to a clean USDC value, floor 0.01.
  const cents = Math.max(1, Math.ceil(usd * 100));
  return (cents / 100).toFixed(2);
}

(async () => {
  for (const tier of Object.keys(TIERS)) {
    const models = TIERS[tier];
    const t0 = Date.now();
    const out = await cryptoDd.runCryptoDdWorkflow({
      chain: TOKEN.chain,
      address: TOKEN.address,
      intakeModel: models.FAST,
      newsModel: models.FAST,
      writerModel: models.STRONG,
      verifierModel: models.VERIFY || models.STRONG,
      groupRatio: GROUP,
      callModel,
      fetchData: (o) => cryptoData.fetchTokenData(o),
      searchToken: (q, c) => cryptoData.searchToken(q, c && cryptoData.chainInfo(c) ? cryptoData.chainInfo(c).dsChain : ""),
      searchWeb,
    });
    const usd = out.totalCostMicros / 1e6;
    console.log("\n===== TIER: " + tier + " =====");
    console.log("wall: " + ((Date.now() - t0) / 1000).toFixed(1) + "s | real v98 cost: $" + usd.toFixed(6) + " | suggested price: " + priceFloor(usd) + " USDC");
    out.steps.forEach((s) => console.log("  - " + s.name + (s.model ? " [" + s.model + "]" : "") + ": $" + ((s.costMicros || 0) / 1e6).toFixed(6)));
    console.log("  risk: " + out.riskJson.overallScore + "/100 " + out.riskJson.verdict + " | verifier flags: " + out.riskJson.verifierNotes.length + " | sources: " + out.sources.length);
    console.log("  --- report (first 40 lines) ---");
    console.log(out.report.split("\n").slice(0, 40).map((l) => "  | " + l).join("\n"));
  }
})().catch((e) => { console.error("MEASURE FAILED:", e.message); process.exit(1); });
