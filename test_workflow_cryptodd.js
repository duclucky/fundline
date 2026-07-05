"use strict";

// Offline unit test for workflow-cryptodd.js: deterministic risk engine + orchestrator
// with injected callModel / fetchData / searchWeb (no network, no v98).

const assert = require("assert");
const dd = require("./workflow-cryptodd");

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed += 1; }

// --- risk engine: honeypot dominates ---
const honeypotSec = { isHoneypot: true, buyTaxPct: 0, sellTaxPct: 0, ownerRenounced: true, top10Percent: 5, isOpenSource: true };
const rHoney = dd.computeRisk({ liquidityUsd: 5000000, pairAgeDays: 400 }, honeypotSec);
check("honeypot -> critical dimension 100", rHoney.dimensions[0].score === 100 && rHoney.dimensions[0].severity === "critical");
check("honeypot -> high overall", rHoney.overallScore >= 85 && /High risk/.test(rHoney.verdict));
check("honeypot -> critical flag listed", rHoney.criticalFlags.length >= 1);

// --- risk engine: clean blue-chip -> low ---
const cleanSec = { isHoneypot: false, buyTaxPct: 0, sellTaxPct: 0, isMintable: false, ownerRenounced: true, canTakeBackOwnership: false, transferPausable: false, top10Percent: 12, isOpenSource: true, lpLockedPercent: 100 };
const rClean = dd.computeRisk({ liquidityUsd: 20000000, pairAgeDays: 800 }, cleanSec);
check("clean -> low overall", rClean.overallScore != null && rClean.overallScore < 35);
check("clean -> lower/moderate verdict", /Lower risk|Moderate risk/.test(rClean.verdict));
check("clean -> no critical flags", rClean.criticalFlags.length === 0);

// --- risk engine: concentration + unrenounced + high tax ---
const riskySec = { isHoneypot: false, buyTaxPct: 12, sellTaxPct: 15, isMintable: true, ownerRenounced: false, canTakeBackOwnership: true, transferPausable: false, top10Percent: 65, isOpenSource: false, lpLockedPercent: 0 };
const rRisky = dd.computeRisk({ liquidityUsd: 30000, pairAgeDays: 3 }, riskySec);
check("high tax -> high sev", rRisky.dimensions[0].score >= 80);
check("ownership controls scored", rRisky.dimensions[1].score >= 60);
check("concentration 65% -> high", rRisky.dimensions[2].score >= 75);
check("low liquidity + no lock -> high", rRisky.dimensions[3].score >= 75);
check("unverified + new -> high", rRisky.dimensions[4].score >= 80);
check("risky -> high overall", rRisky.overallScore >= 75);

// --- risk engine: missing data -> unknown dims, overall from available ---
const rNoSec = dd.computeRisk({ liquidityUsd: 500000, pairAgeDays: 100 }, null);
check("no security -> honeypot unknown", rNoSec.dimensions[0].score === null && rNoSec.dimensions[0].severity === "unknown");
check("no security -> liquidity still scored", rNoSec.dimensions[3].score != null);
check("overall from available dims", rNoSec.overallScore != null);
const rNone = dd.computeRisk(null, null);
check("no data at all -> insufficient", rNone.overallScore === null && rNone.verdict === "Insufficient data");

// --- orchestrator with injected fakes ---
function fakeCall(script) {
  // script: ordered array of {match, content}; returns matching content by call order fallback
  let i = 0;
  return async (modelId, messages, maxTokens) => {
    const content = typeof script === "function" ? script(messages, i) : script[i];
    i += 1;
    return { content, usage: { prompt_tokens: 100, completion_tokens: 50 } };
  };
}

(async () => {
  const market = { chain: "ethereum", name: "Pepe", symbol: "PEPE", address: "0xAaa", dex: "uniswap", priceUsd: 0.000002, liquidityUsd: 19978779, volume24h: 800000, fdv: 1e9, marketCap: 1.1e9, pairUrl: "https://d/x", pairAgeDays: 800, pairCount: 3 };
  const security = cleanSec;
  const fetchData = async () => ({ market, security, sourceCounts: { DexScreener: 1, GoPlus: 1 }, errors: [] });
  const searchWeb = async () => ([{ title: "Pepe review", url: "https://news/1", content: "no major issues found" }]);
  // call order: news(JSON), writer(md), verifier(JSON [])
  const callModel = fakeCall([
    JSON.stringify({ summary: "No major incidents reported.", redFlags: [], positives: ["large community"] }),
    "## Summary\nPEPE shows deep liquidity and renounced ownership.\n\n## What the data shows\nLiquidity is strong.",
    JSON.stringify([]),
  ]);

  const out = await dd.runCryptoDdWorkflow({
    chain: "ethereum", address: "0x6982508145454ce325dDbE47a25d4ec3d2311933",
    callModel, fetchData, searchWeb, generatedAt: "2026-07-05 10:00 UTC",
  });

  check("report has title", /Crypto due-diligence: Pepe/.test(out.report));
  check("report has overall risk line", /Overall risk:/.test(out.report));
  check("report has risk table", /\| Dimension \| Score \| Severity \| Basis \|/.test(out.report));
  check("report includes writer narrative", /What the data shows/.test(out.report));
  check("report has verification section", /## Verification/.test(out.report));
  check("clean verify -> all checked line", /checked against the fetched/.test(out.report));
  check("report has sources + disclaimer", /DexScreener/.test(out.report) && /not financial advice/.test(out.report));
  check("riskJson shape", out.riskJson && out.riskJson.symbol === "PEPE" && Array.isArray(out.riskJson.dimensions) && out.riskJson.overallScore != null);
  check("cost summed across 3 llm calls", out.totalCostMicros > 0 && out.steps.filter((s) => s.model).length === 3);
  check("data-fetch step present (no model)", out.steps.some((s) => s.name === "On-chain and market data" && s.model === null));

  // verifier flags an unsupported claim -> appears in report
  const callModel2 = fakeCall([
    JSON.stringify({ summary: "", redFlags: [], positives: [] }),
    "## Summary\nThe team is doxxed and audited by CertiK.",
    JSON.stringify([{ statement: "audited by CertiK", issue: "no audit in the data" }]),
  ]);
  const out2 = await dd.runCryptoDdWorkflow({ chain: "ethereum", address: "0x6982508145454ce325dDbE47a25d4ec3d2311933", callModel: callModel2, fetchData, searchWeb, generatedAt: "2026-07-05 10:00 UTC" });
  check("verifier flag surfaces in report", /audited by CertiK \(no audit in the data\)/.test(out2.report));
  check("verifierNotes in riskJson", out2.riskJson.verifierNotes.length === 1);

  // no data at all -> throws (billing refund path)
  let threw = false;
  try {
    await dd.runCryptoDdWorkflow({ chain: "ethereum", address: "0x6982508145454ce325dDbE47a25d4ec3d2311933", callModel: fakeCall(["", "", "[]"]), fetchData: async () => ({ market: null, security: null, sourceCounts: {}, errors: [] }), searchWeb: null, generatedAt: "x" });
  } catch (_) { threw = true; }
  check("no data -> throws", threw);

  console.log("crypto dd workflow test: " + passed + " passed, 0 failed");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
