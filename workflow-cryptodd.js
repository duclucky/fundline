"use strict";

// Crypto Due-Diligence Pack executor.
// Crew: intake (deterministic + FAST resolve) -> parallel fetch (DexScreener market
// + GoPlus security) -> news (Tavily + FAST) -> risk engine (DETERMINISTIC scoring,
// not the LLM) -> report writer (STRONG, narrative only) -> verifier (STRONG,
// adversarial data-check). The objective numbers are computed in code so the
// "expert" output is reproducible and not hallucinated; the LLM writes the prose
// and a second LLM checks it against the raw data. See .claude/workflow-crypto-dd-spec.md.
// EVM chains only in v1. Data sources are free + keyless; only news uses Tavily.
// Returns { report, riskJson, steps, sources, totalCostMicros, meta }.

const v98Models = require("./v98-models");
const cryptoData = require("./crypto-data");

// --- JSON helpers ---

function extractJsonArray(text) {
  const raw = String(text || "");
  const i = raw.indexOf("[");
  const j = raw.lastIndexOf("]");
  return i >= 0 && j > i ? raw.slice(i, j + 1) : raw;
}
function extractJsonObject(text) {
  const raw = String(text || "");
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  return i >= 0 && j > i ? raw.slice(i, j + 1) : raw;
}
function safeParse(text, extractor) {
  try { return JSON.parse(extractor(text)); } catch { return null; }
}

// --- deterministic risk engine ---

function severityFor(score) {
  if (score == null) return "unknown";
  if (score >= 85) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "medium";
  return "low";
}

function dimHoneypotTax(security) {
  const src = "GoPlus";
  const key = "honeypot_tax";
  const label = "Honeypot and trading tax";
  if (!security) return { key, label, score: null, severity: "unknown", rationale: "No security data available.", evidence: "", source: src };
  if (security.isHoneypot === true) {
    return { key, label, score: 100, severity: "critical", rationale: "Flagged as a honeypot: buyers may be unable to sell.", evidence: "is_honeypot = yes", source: src };
  }
  const buy = security.buyTaxPct == null ? 0 : security.buyTaxPct;
  const sell = security.sellTaxPct == null ? 0 : security.sellTaxPct;
  const tax = Math.max(buy, sell);
  let score;
  if (tax >= 50) score = 95;
  else if (tax >= 10) score = 80;
  else if (tax >= 5) score = 55;
  else score = Math.round(tax * 4);
  return {
    key, label, score, severity: severityFor(score),
    rationale: tax >= 5 ? `High trading tax (buy ${buy}%, sell ${sell}%).` : `Trading tax is low (buy ${buy}%, sell ${sell}%).`,
    evidence: `buy_tax ${buy}%, sell_tax ${sell}%`, source: src,
  };
}

function dimOwnership(security) {
  const src = "GoPlus";
  const key = "ownership_control";
  const label = "Ownership and admin controls";
  if (!security) return { key, label, score: null, severity: "unknown", rationale: "No security data available.", evidence: "", source: src };
  let score = 0;
  const controls = [];
  if (security.selfdestruct === true) { score += 45; controls.push("self-destruct"); }
  if (security.hiddenOwner === true) { score += 45; controls.push("hidden owner"); }
  if (security.canTakeBackOwnership === true) { score += 30; controls.push("can reclaim ownership"); }
  if (security.isMintable === true) { score += 30; controls.push("mintable"); }
  if (security.transferPausable === true) { score += 25; controls.push("transfers pausable"); }
  if (security.isBlacklisted === true) { score += 25; controls.push("blacklist"); }
  if (security.ownerRenounced === false && controls.length) score += 15;
  if (security.ownerRenounced === true && !controls.length) score = Math.min(score, 12);
  score = Math.min(100, score);
  const rationale = controls.length
    ? `Active admin controls: ${controls.join(", ")}${security.ownerRenounced === false ? " (owner not renounced)" : ""}.`
    : (security.ownerRenounced === true ? "Ownership renounced; no dangerous admin controls found." : "No dangerous admin controls found.");
  return { key, label, score, severity: severityFor(score), rationale, evidence: `owner ${security.ownerRenounced === true ? "renounced" : (security.ownerAddress || "unknown")}`, source: src };
}

function dimConcentration(security) {
  const src = "GoPlus";
  const key = "holder_concentration";
  const label = "Holder concentration";
  if (!security || security.top10Percent == null) return { key, label, score: null, severity: "unknown", rationale: "No holder data available.", evidence: "", source: src };
  const top10 = security.top10Percent;
  let score;
  if (top10 >= 70) score = 90;
  else if (top10 >= 50) score = 75;
  else if (top10 >= 30) score = 50;
  else if (top10 >= 15) score = 30;
  else score = 15;
  if (security.creatorPercent != null && security.creatorPercent >= 20) score = Math.min(100, score + 15);
  return {
    key, label, score, severity: severityFor(score),
    rationale: `Top 10 holders control ${top10}% of supply${security.creatorPercent != null ? `; creator holds ${security.creatorPercent}%` : ""}.`,
    evidence: `top10 ${top10}%`, source: src,
  };
}

function dimLiquidity(market, security) {
  const src = "DexScreener";
  const key = "liquidity";
  const label = "Liquidity depth and LP lock";
  if (!market || market.liquidityUsd == null) return { key, label, score: null, severity: "unknown", rationale: "No liquidity data available.", evidence: "", source: src };
  const liq = market.liquidityUsd;
  let score;
  if (liq < 10000) score = 90;
  else if (liq < 50000) score = 75;
  else if (liq < 200000) score = 50;
  else if (liq < 1000000) score = 30;
  else score = 12;
  let lpNote = "";
  if (security && security.lpLockedPercent != null && security.lpLockedPercent < 50) {
    score = Math.min(100, score + 20);
    lpNote = ` LP locked only ${security.lpLockedPercent}%.`;
  }
  return {
    key, label, score, severity: severityFor(score),
    rationale: `Liquidity is $${Math.round(liq).toLocaleString("en-US")}.${lpNote}`,
    evidence: `liquidity $${Math.round(liq)}`, source: security && security.lpLockedPercent != null ? "DexScreener + GoPlus" : src,
  };
}

function dimTransparency(market, security) {
  const src = "GoPlus + DexScreener";
  const key = "contract_transparency";
  const label = "Contract verification and age";
  const openSource = security ? security.isOpenSource : null;
  const age = market ? market.pairAgeDays : null;
  if (openSource == null && age == null) return { key, label, score: null, severity: "unknown", rationale: "No contract data available.", evidence: "", source: src };
  let score = 0;
  const notes = [];
  if (openSource === false) { score += 80; notes.push("source code not verified"); }
  else if (openSource === true) { notes.push("source verified"); }
  if (age != null) {
    if (age < 2) { score += 30; notes.push(`pair is ${age} day(s) old`); }
    else if (age < 7) { score += 15; notes.push(`pair is ${age} days old`); }
    else if (age < 30) { score += 5; notes.push(`pair is ${age} days old`); }
    else notes.push(`pair is ${age} days old`);
  }
  score = Math.min(100, score);
  return { key, label, score, severity: severityFor(score), rationale: notes.join("; ") + ".", evidence: `open_source ${openSource === true ? "yes" : openSource === false ? "no" : "unknown"}${age != null ? ", age " + age + "d" : ""}`, source: src };
}

function computeRisk(market, security) {
  const dimensions = [
    dimHoneypotTax(security),
    dimOwnership(security),
    dimConcentration(security),
    dimLiquidity(market, security),
    dimTransparency(market, security),
  ];
  const scored = dimensions.filter((d) => d.score != null).map((d) => d.score);
  const criticalFlags = dimensions.filter((d) => d.score != null && d.score >= 85).map((d) => d.label);
  let overallScore = null;
  if (scored.length) {
    const max = Math.max.apply(null, scored);
    const avg = scored.reduce((a, b) => a + b, 0) / scored.length;
    overallScore = Math.round(0.6 * max + 0.4 * avg);
    if (criticalFlags.length) overallScore = Math.max(overallScore, max);
  }
  let verdict;
  if (overallScore == null) verdict = "Insufficient data";
  else if (overallScore >= 75) verdict = "High risk";
  else if (overallScore >= 45) verdict = "Elevated risk";
  else if (overallScore >= 20) verdict = "Moderate risk";
  else verdict = "Lower risk";
  if (criticalFlags.length) verdict += ` (${criticalFlags.length} critical flag${criticalFlags.length > 1 ? "s" : ""})`;
  return { overallScore, verdict, criticalFlags, dimensions };
}

// --- prompt builders ---

function buildIntakeMessages(input) {
  const system = "You extract a token reference from a user's request. Respond ONLY with a JSON object: "
    + "{\"chain\":\"\",\"address\":\"\",\"query\":\"\"}. chain is one of ethereum, bsc, base, arbitrum, polygon, "
    + "optimism, avalanche (lowercase) if stated. address is a 0x contract address if present. query is a token "
    + "name or symbol if no address is given. Use only what is in the text; leave fields empty if absent.";
  return [
    { role: "system", content: system },
    { role: "user", content: String(input || "") },
  ];
}

function buildNewsMessages(name, symbol, searchText) {
  const system = "You summarize crypto news and community signal for a due-diligence report. You are given real "
    + "search results. Respond ONLY with a JSON object: {\"summary\":\"2-3 sentences\",\"redFlags\":[],\"positives\":[]}. "
    + "Use ONLY facts present in the results; never invent audits, partnerships, or incidents. If the results are thin, "
    + "say so in summary and keep the arrays short or empty. No emojis.";
  const user = `Token: ${name || symbol || "unknown"} (${symbol || ""}).\n\nSearch results:\n${searchText || "(none)"}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function dataSheet(market, security, risk) {
  const lines = [];
  if (market) {
    lines.push(`Market: price $${market.priceUsd}, liquidity $${market.liquidityUsd}, 24h volume $${market.volume24h}, FDV $${market.fdv}, market cap $${market.marketCap}, DEX ${market.dex}, pair age ${market.pairAgeDays} days.`);
  }
  if (security) {
    lines.push(`Security: honeypot ${security.isHoneypot}, buy tax ${security.buyTaxPct}%, sell tax ${security.sellTaxPct}%, mintable ${security.isMintable}, owner renounced ${security.ownerRenounced}, can reclaim ownership ${security.canTakeBackOwnership}, pausable ${security.transferPausable}, source verified ${security.isOpenSource}, holders ${security.holderCount}, top10 ${security.top10Percent}%, LP locked ${security.lpLockedPercent}%.`);
  }
  lines.push(`Computed risk: overall ${risk.overallScore}/100 (${risk.verdict}).`);
  risk.dimensions.forEach((d) => lines.push(`- ${d.label}: ${d.score == null ? "unknown" : d.score + "/100"} (${d.severity}) - ${d.rationale}`));
  return lines.join("\n");
}

function buildWriterMessages(name, symbol, sheet, news) {
  const system = "You are a crypto risk analyst writing the narrative of a due-diligence report. You are given a data "
    + "sheet with computed risk scores. Write concise markdown with these sections only: '## Summary' (3-4 sentences on "
    + "the overall picture and the biggest risks) and '## What the data shows' (a short paragraph per notable dimension). "
    + "Rules: use ONLY the numbers and facts in the data sheet and news; do NOT invent addresses, dates, figures, audits, "
    + "or partnerships; do NOT restate the full scores table (it is added separately); do NOT give buy/sell advice. No emojis.";
  const user = `Token: ${name || symbol}.\n\nData sheet:\n${sheet}\n\nNews summary: ${news && news.summary ? news.summary : "(none)"}`
    + `${news && news.redFlags && news.redFlags.length ? "\nNews red flags: " + news.redFlags.join("; ") : ""}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

function buildVerifierMessages(narrative, sheet, newsContext) {
  const system = "You are an adversarial fact-checker. You are given an analyst's narrative, the underlying data sheet, "
    + "and the news summary the writer was given. List ONLY statements in the narrative that are NOT supported by EITHER "
    + "the data sheet OR the news summary (invented figures, claims with no backing, or contradictions). News-derived "
    + "statements that match the news summary are supported. Respond ONLY with a JSON array: [{\"statement\":\"\",\"issue\":\"\"}]. "
    + "If every statement is supported, respond with []. Default to flagging when a specific numeric claim has no matching data.";
  const user = `Data sheet:\n${sheet}\n\nNews summary provided to the writer:\n${newsContext || "(none)"}\n\nNarrative to check:\n${narrative}`;
  return [{ role: "system", content: system }, { role: "user", content: user }];
}

// --- report assembly (deterministic around the writer narrative) ---

function scoreBar(score) {
  if (score == null) return "n/a";
  return `${score}/100`;
}

function buildReport(ctx) {
  const { name, symbol, chain, address, risk, narrative, verifierNotes, news, market, security, generatedAt } = ctx;
  const lines = [];
  const title = name || symbol || address;
  lines.push(`# Crypto due-diligence: ${title}${symbol && name ? " (" + symbol + ")" : ""}`);
  lines.push("");
  lines.push(`**Overall risk: ${risk.overallScore == null ? "insufficient data" : risk.overallScore + "/100"} - ${risk.verdict}**`);
  lines.push("");
  lines.push(`Chain: ${chain} | Contract: ${address}`);
  lines.push("");
  // Deterministic risk table.
  lines.push(`## Risk scores`);
  lines.push("");
  lines.push(`| Dimension | Score | Severity | Basis |`);
  lines.push(`|---|---|---|---|`);
  risk.dimensions.forEach((d) => {
    lines.push(`| ${d.label} | ${scoreBar(d.score)} | ${d.severity} | ${d.rationale.replace(/\|/g, "/")} |`);
  });
  lines.push("");
  // Writer narrative.
  if (narrative) { lines.push(narrative.trim()); lines.push(""); }
  // News.
  if (news && (news.summary || (news.redFlags && news.redFlags.length))) {
    lines.push(`## News and community signal`);
    lines.push("");
    if (news.summary) { lines.push(news.summary); lines.push(""); }
    if (news.redFlags && news.redFlags.length) { lines.push(`Red flags: ${news.redFlags.join("; ")}`); lines.push(""); }
  }
  // Verification section (the adversarial gate's output).
  lines.push(`## Verification`);
  lines.push("");
  if (verifierNotes && verifierNotes.length) {
    lines.push(`The following statements were not fully supported by the fetched data and should be treated with caution:`);
    verifierNotes.forEach((v) => { lines.push(""); lines.push(`- ${v.statement} (${v.issue})`); });
  } else {
    lines.push(`All statements in this report were checked against the fetched on-chain and market data.`);
  }
  lines.push("");
  // Sources + provenance.
  lines.push(`## Data sources`);
  lines.push("");
  lines.push(`- Market and liquidity: DexScreener${market && market.pairUrl ? ` ([pair](${market.pairUrl}))` : ""}`);
  lines.push(`- Security and holders: GoPlus Security`);
  if (news && news.sources && news.sources.length) {
    news.sources.slice(0, 6).forEach((s) => { if (s && s.url) lines.push(`- News: [${s.title || s.url}](${s.url})`); });
  }
  lines.push("");
  lines.push(`_Generated ${generatedAt}. This is an automated risk summary from public data, not financial advice. On-chain data can be incomplete for very new tokens._`);
  return lines.join("\n");
}

// --- orchestrator ---

// opts: {
//   input, chain, address, topNews=6,
//   intakeModel, newsModel, writerModel, verifierModel, groupRatio,
//   callModel(modelId, messages, maxTokens) -> { content, usage },
//   fetchData({chain, address}) -> { market, security, sourceCounts, errors },
//   searchToken(query, chain) -> [{chain, address, name, symbol, liquidityUsd}],
//   searchWeb(query) -> [{title, url, content}] | null,
//   onProgress({step, status}) -> void,
//   generatedAt (ISO string; injected so it is deterministic in tests),
// }
async function runCryptoDdWorkflow(opts) {
  const groupRatio = opts.groupRatio || 1;
  const intakeModel = v98Models.resolveModelId(opts.intakeModel || "gpt-4o-mini");
  const newsModel = v98Models.resolveModelId(opts.newsModel || "gpt-4o-mini");
  const writerModel = v98Models.resolveModelId(opts.writerModel || "gpt-4.1-mini");
  const verifierModel = v98Models.resolveModelId(opts.verifierModel || "gpt-4.1-mini");
  const callModel = opts.callModel;
  const fetchData = opts.fetchData;
  const searchWeb = typeof opts.searchWeb === "function" ? opts.searchWeb : null;
  const searchToken = typeof opts.searchToken === "function" ? opts.searchToken : null;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const generatedAt = opts.generatedAt || new Date().toISOString().slice(0, 16).replace("T", " ") + " UTC";

  const steps = [];
  let totalCostMicros = 0;
  function account(name, modelId, usage) {
    const cost = v98Models.computeCostMicros(modelId, usage.prompt_tokens, usage.completion_tokens, groupRatio) || 0;
    totalCostMicros += cost;
    steps.push({ name, model: modelId, costMicros: cost });
    return cost;
  }

  // 1. Intake: resolve chain + address.
  onProgress({ step: "intake", status: "running" });
  let chain = String(opts.chain || "").trim().toLowerCase();
  let address = String(opts.address || "").trim();
  let query = "";
  if (!cryptoData.isEvmAddress(address) || !cryptoData.chainInfo(chain)) {
    // Ask the FAST model to parse the free-text input into chain/address/query.
    const intakeRes = await callModel(intakeModel, buildIntakeMessages(opts.input || `${chain} ${address}`.trim()), 200);
    account("Intake", intakeModel, intakeRes.usage);
    const parsed = safeParse(intakeRes.content, extractJsonObject) || {};
    if (!cryptoData.chainInfo(chain)) chain = String(parsed.chain || "").trim().toLowerCase();
    if (!cryptoData.isEvmAddress(address)) address = String(parsed.address || "").trim();
    query = String(parsed.query || "").trim();
  }
  // Resolve a name/symbol to the deepest-liquidity token when no address was given.
  let candidates = [];
  if (!cryptoData.isEvmAddress(address) && query && searchToken) {
    candidates = await searchToken(query, cryptoData.chainInfo(chain) ? chain : "");
    if (candidates.length) {
      address = candidates[0].address;
      if (!cryptoData.chainInfo(chain)) chain = String(candidates[0].chain || "").toLowerCase();
    }
  }
  if (!cryptoData.chainInfo(chain)) throw new Error("Unsupported or missing chain. Use one of: ethereum, bsc, base, arbitrum, polygon, optimism, avalanche.");
  if (!cryptoData.isEvmAddress(address)) throw new Error("Could not resolve a token contract address. Provide a 0x address or a clearer token name.");
  onProgress({ step: "intake", status: "done" });

  // 2. Fetch market + security (parallel, free APIs).
  onProgress({ step: "fetch", status: "running" });
  const data = await fetchData({ chain, address });
  const market = data.market;
  const security = data.security;
  steps.push({ name: "On-chain and market data", model: null, costMicros: 0 });
  onProgress({ step: "fetch", status: "done" });
  if (!market && !security) {
    throw new Error("No on-chain data found for this token; check the chain and address.");
  }
  const name = (market && market.name) || (candidates[0] && candidates[0].name) || "";
  const symbol = (market && market.symbol) || (candidates[0] && candidates[0].symbol) || "";

  // 3. News + narrative (retrieval + FAST).
  onProgress({ step: "news", status: "running" });
  let news = { summary: "", redFlags: [], positives: [], sources: [] };
  if (searchWeb) {
    let results = [];
    try {
      const q = `${name || symbol || address} token audit rug scam review`;
      results = (await searchWeb(q)) || [];
    } catch (_) { results = []; }
    const searchText = results.slice(0, opts.topNews || 6).map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${String(r.content || "").slice(0, 400)}`).join("\n\n");
    news.sources = results.slice(0, opts.topNews || 6).map((r) => ({ title: r.title, url: r.url }));
    if (searchText) {
      const newsRes = await callModel(newsModel, buildNewsMessages(name, symbol, searchText), 500);
      account("News and narrative", newsModel, newsRes.usage);
      const parsed = safeParse(newsRes.content, extractJsonObject);
      if (parsed) {
        news.summary = String(parsed.summary || "").trim();
        news.redFlags = Array.isArray(parsed.redFlags) ? parsed.redFlags.map((x) => String(x).trim()).filter(Boolean) : [];
        news.positives = Array.isArray(parsed.positives) ? parsed.positives.map((x) => String(x).trim()).filter(Boolean) : [];
      }
    }
  }
  onProgress({ step: "news", status: "done" });

  // 4. Risk engine (deterministic).
  const risk = computeRisk(market, security);
  const sheet = dataSheet(market, security, risk);

  // 5. Writer narrative (STRONG).
  onProgress({ step: "writer", status: "running" });
  const writeRes = await callModel(writerModel, buildWriterMessages(name, symbol, sheet, news), 1200);
  account("Report writer", writerModel, writeRes.usage);
  const narrative = String(writeRes.content || "").trim();
  onProgress({ step: "writer", status: "done" });

  // 6. Verifier (STRONG, adversarial data-check).
  onProgress({ step: "verifier", status: "running" });
  let verifierNotes = [];
  const newsContext = news && (news.summary || (news.redFlags && news.redFlags.length))
    ? `${news.summary || ""}${news.redFlags && news.redFlags.length ? "\nRed flags: " + news.redFlags.join("; ") : ""}`
    : "";
  const verifyRes = await callModel(verifierModel, buildVerifierMessages(narrative, sheet, newsContext), 600);
  account("Verifier", verifierModel, verifyRes.usage);
  const parsedNotes = safeParse(verifyRes.content, extractJsonArray);
  if (Array.isArray(parsedNotes)) {
    verifierNotes = parsedNotes
      .filter((n) => n && n.statement)
      .map((n) => ({ statement: String(n.statement).trim(), issue: String(n.issue || "unsupported").trim() }));
  }
  onProgress({ step: "verifier", status: "done" });

  const report = buildReport({ name, symbol, chain, address, risk, narrative, verifierNotes, news, market, security, generatedAt });

  const riskJson = {
    chain, address, name, symbol,
    overallScore: risk.overallScore,
    verdict: risk.verdict,
    criticalFlags: risk.criticalFlags,
    dimensions: risk.dimensions,
    market: market || null,
    security: security || null,
    news: { summary: news.summary, redFlags: news.redFlags, positives: news.positives, sources: news.sources },
    verifierNotes,
    generatedAt,
    disclaimer: "Automated risk summary from public data, not financial advice.",
  };

  return {
    report,
    riskJson,
    steps,
    sources: (news.sources || []).map((s) => s.url).filter(Boolean),
    totalCostMicros,
    meta: { sourceCounts: data.sourceCounts || {}, errors: data.errors || [], candidates },
  };
}

module.exports = {
  extractJsonArray,
  extractJsonObject,
  safeParse,
  severityFor,
  dimHoneypotTax,
  dimOwnership,
  dimConcentration,
  dimLiquidity,
  dimTransparency,
  computeRisk,
  buildIntakeMessages,
  buildNewsMessages,
  dataSheet,
  buildWriterMessages,
  buildVerifierMessages,
  buildReport,
  runCryptoDdWorkflow,
};
