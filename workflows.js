"use strict";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const WORKFLOWS = {
  "proposal-writer": {
    name: "Proposal Writer",
    description: "Generate a polished business proposal from a brief project description.",
    longDesc: "Takes a raw project brief and transforms it into a professional business proposal ready to send to clients. Extracts requirements, identifies tone and structure, generates the proposal, then performs a quality pass.",
    category: "Freelance",
    price: "0.04",
    version: "v1.2.0",
    runtime: "~45s",
    modelCount: 4,
    calls: 1247,
    inputLabel: "Project brief",
    inputHint: "Describe the project, client name, budget range, and main goals.",
    outputHint: "Structured business proposal (800-1500 words), ready to copy or export.",
    limits: { inputChars: 2000, outputWords: 1500 },
    steps: [
      { name: "Prompt Builder", model: "gpt-4.1-mini", purpose: "Convert natural language input into a structured workflow prompt.", tokens: "~200" },
      { name: "Requirement Extractor", model: "claude-3-haiku", purpose: "Extract client needs, goals, tone, and constraints.", tokens: "~350" },
      { name: "Proposal Generator", model: "claude-3.5-sonnet", purpose: "Generate the full professional proposal document.", tokens: "~1500" },
      { name: "Quality Check", model: "gpt-4.1-mini", purpose: "Review for clarity, completeness, and missing sections.", tokens: "~400" },
    ],
    pricing: [
      { step: "Prompt Builder", model: "gpt-4.1-mini", inputTokens: 200, outputTokens: 220, cost: "0.0003" },
      { step: "Requirement Extractor", model: "claude-3-haiku", inputTokens: 420, outputTokens: 180, cost: "0.0008" },
      { step: "Proposal Generator", model: "claude-3.5-sonnet", inputTokens: 600, outputTokens: 1240, cost: "0.032" },
      { step: "Quality Check", model: "gpt-4.1-mini", inputTokens: 1240, outputTokens: 320, cost: "0.007" },
    ],
    examplePrompt: "Write a proposal for rebuilding the e-commerce frontend for Acme Corp. Budget is around $15,000. They want faster load times and a modern checkout flow. Deadline is Q3.",
    exampleOutput: "# Business Proposal: E-Commerce Frontend Rebuild\n\n**Prepared for:** Acme Corp\n**Budget:** $15,000\n\n## Executive Summary\n\nWe propose a full rebuild of your e-commerce frontend to improve page load time by 60% and modernize the checkout flow. Total investment: $14,500.\n\n## Problem\n\nYour current frontend loads in 4.2s on mobile (P90) and has a 72% cart abandonment rate. Both are above industry benchmarks.\n\n## Proposed Solution\n\n1. Migrate to React 18 + Vite (edge-cached)\n2. Redesign checkout: 3-step to 1-page\n3. Implement Core Web Vitals budget (LCP < 1.8s)\n4. A/B test new vs. old flow\n\n## Timeline\n\n| Phase | Duration |\n|---|---|\n| Audit & Design | 2 weeks |\n| Development | 4 weeks |\n| QA & Launch | 2 weeks |\n\n## Investment\n\n$14,500 total. 50% at kickoff, 50% on launch.\n\n## Next Steps\n\nReply to schedule a 30-minute kickoff call.",
  },
  "client-research": {
    name: "Client Research",
    description: "Deep-dive research brief on a company or person before a sales call, pitch, or outreach.",
    longDesc: "Aggregates public information about a target company or individual and synthesizes it into a structured brief with background, signals, and recommended angles.",
    category: "Freelance",
    live: true,
    usesRetrieval: true,
    price: "0.05",
    version: "v1.0.1",
    runtime: "~60s",
    modelCount: 2,
    calls: 893,
    inputLabel: "Company or person name",
    inputHint: "Enter the company name and context (e.g. 'sales call', 'investor outreach', 'partnership').",
    outputHint: "Structured research report with background, signals, and cited sources.",
    limits: { inputChars: 500, outputWords: 1500 },
    steps: [
      { name: "Role analysis", model: "gpt-4o-mini", purpose: "Pick the right expert persona for the research topic.", tokens: "~50" },
      { name: "Research plan", model: "gpt-4o-mini", purpose: "Break the request into focused web search queries.", tokens: "~60" },
      { name: "Web research", model: "Tavily", purpose: "Search the web and gather ranked sources.", tokens: "-" },
      { name: "Report writer", model: "gpt-4.1-mini", purpose: "Write a structured, cited research report.", tokens: "~1500" },
    ],
    pricing: [
      { step: "Role analysis", model: "gpt-4o-mini", inputTokens: 50, outputTokens: 20, cost: "0.00002" },
      { step: "Research plan", model: "gpt-4o-mini", inputTokens: 60, outputTokens: 40, cost: "0.00003" },
      { step: "Web research", model: "Tavily", inputTokens: 0, outputTokens: 0, cost: "0.00" },
      { step: "Report writer", model: "gpt-4.1-mini", inputTokens: 1200, outputTokens: 1200, cost: "0.0024" },
    ],
    examplePrompt: "Research Notion Inc for a partnership outreach call. We want to integrate our product with their API.",
    exampleOutput: "# Research Brief: Notion Inc\n\n**Intent:** Partnership outreach - API integration\n\n## Overview\n\nNotion is a productivity platform used by 35M+ users globally. Headquartered in San Francisco. Last round: Series C at $275M (2021).\n\n## Product Signals\n\n- Notion API launched 2021, now at v2. Active developer ecosystem.\n- Recent focus: Notion AI and enterprise SSO.\n- 3 open API positions on their jobs page.\n\n## Talking Points\n\n1. Reference their active API ecosystem as reason for outreach.\n2. Lead with use-case first: show what your integration solves for Notion users.\n3. Avoid cold pitch framing - lean into partnership benefits.\n\n## Recommended Angle\n\nEmail Head of Partnerships with a 3-sentence pitch, link to your integration demo, and a calendar link.",
  },
  "x-thread-writer": {
    name: "X Thread Writer",
    description: "Turn any idea, article, or insight into a high-engagement X/Twitter thread.",
    longDesc: "Takes a topic, article, or insight and generates a structured X thread with hook, content tweets, and a strong CTA. Tuned for clarity over fluff.",
    category: "Content",
    price: "0.02",
    version: "v2.1.0",
    runtime: "~25s",
    modelCount: 3,
    calls: 3102,
    inputLabel: "Topic or article",
    inputHint: "Paste your main idea, a key insight, or the content you want to turn into a thread.",
    outputHint: "8-12 tweet thread with hook, body tweets, and CTA.",
    limits: { inputChars: 3000, outputWords: 600 },
    steps: [
      { name: "Content Extractor", model: "claude-3-haiku", purpose: "Extract core ideas and structure from the input.", tokens: "~300" },
      { name: "Thread Architect", model: "gpt-4.1-mini", purpose: "Plan thread structure: hook, key points, CTA.", tokens: "~200" },
      { name: "Tweet Writer", model: "claude-3.5-sonnet", purpose: "Write each tweet with right length, tone, and hooks.", tokens: "~800" },
    ],
    pricing: [
      { step: "Content Extractor", model: "claude-3-haiku", inputTokens: 800, outputTokens: 300, cost: "0.005" },
      { step: "Thread Architect", model: "gpt-4.1-mini", inputTokens: 300, outputTokens: 200, cost: "0.0004" },
      { step: "Tweet Writer", model: "claude-3.5-sonnet", inputTokens: 500, outputTokens: 700, cost: "0.015" },
    ],
    examplePrompt: "Write a thread about why most developers underestimate the cost of building auth from scratch.",
    exampleOutput: "1/ Most developers think auth is a weekend project.\n\nIt is not. Here is why it destroys teams:\n\n2/ First, you underestimate what auth actually includes:\n\n- Sessions + refresh tokens\n- Password resets / email verify\n- MFA, OAuth (Google, GitHub)\n- Rate limiting\n- Audit logs\n\n3/ You build the happy path in 2 days.\n\nThen spend 6 weeks patching edge cases:\n- Concurrent session conflicts\n- Token invalidation on password change\n- CSRF on every endpoint\n\n4/ The real cost is maintenance.\n\nEvery auth security update is your problem.\nEvery new OAuth provider is your problem.\nEvery compliance audit hits your custom code.\n\n5/ The math:\n\n100h to build + 20h/yr maintenance + compliance risk > $30/mo for a proven solution.\n\n6/ If you are building a startup:\nUse Clerk, Auth0, or Supabase Auth.\n\nSave the custom system for when you have a compliance requirement forcing it.\n\n7/ Ship your product.\n\nNot your auth layer.\n\n8/ Retweet if you have ever lost a week to auth.",
  },
  "seo-article": {
    name: "SEO Article",
    description: "Research and write a full SEO-optimized article on any topic with keyword strategy.",
    longDesc: "Researches a topic, builds a keyword-focused outline, writes the article, and optimizes headings and meta description for search. Outputs publication-ready content.",
    category: "Content",
    price: "0.06",
    version: "v1.1.0",
    runtime: "~70s",
    modelCount: 4,
    calls: 756,
    inputLabel: "Topic and target keyword",
    inputHint: "Describe the article topic and the primary keyword you want to rank for.",
    outputHint: "1000-2000 word article with headings, meta description, and link suggestions.",
    limits: { inputChars: 1000, outputWords: 2000 },
    steps: [
      { name: "Keyword Planner", model: "gpt-4.1-mini", purpose: "Identify primary and secondary keywords and search intent.", tokens: "~200" },
      { name: "Outline Builder", model: "claude-3-haiku", purpose: "Create an SEO-optimized outline with H2/H3 structure.", tokens: "~400" },
      { name: "Article Writer", model: "claude-3.5-sonnet", purpose: "Write the full article following the outline.", tokens: "~2000" },
      { name: "SEO Optimizer", model: "gpt-4.1-mini", purpose: "Optimize title, meta description, and heading structure.", tokens: "~400" },
    ],
    pricing: [
      { step: "Keyword Planner", model: "gpt-4.1-mini", inputTokens: 200, outputTokens: 220, cost: "0.0003" },
      { step: "Outline Builder", model: "claude-3-haiku", inputTokens: 400, outputTokens: 400, cost: "0.006" },
      { step: "Article Writer", model: "claude-3.5-sonnet", inputTokens: 800, outputTokens: 1800, cost: "0.048" },
      { step: "SEO Optimizer", model: "gpt-4.1-mini", inputTokens: 1800, outputTokens: 400, cost: "0.005" },
    ],
    examplePrompt: "Write an SEO article about 'USDC stablecoin for freelancers'. Primary keyword: 'get paid in USDC'. Audience: freelancers new to crypto.",
    exampleOutput: "# How to Get Paid in USDC as a Freelancer (2026 Guide)\n\n**Meta:** Learn how freelancers can get paid in USDC stablecoins, avoid currency risk, and receive instant cross-border payments.\n\n---\n\n## What Is USDC and Why Freelancers Are Switching\n\nUSDC is a dollar-backed stablecoin issued by Circle. One USDC equals one US dollar, always. For freelancers, that stability matters. You invoice in dollars, get paid in dollars, and cash out to your bank at any time.\n\n## How to Set Up Your USDC Wallet\n\nTwo options:\n\n**1. Custodial (easiest)** - Use Coinbase. Create an account, complete KYC, share your USDC deposit address.\n\n**2. Self-custody (most control)** - Use MetaMask or Rabby. Generate a wallet, back up your seed phrase.\n\n## How to Invoice Clients in USDC\n\nUse a tool like Fundline.xyz to create a USDC invoice with a payment link. Your client pays directly to your wallet.\n\n## Conclusion\n\nGetting paid in USDC removes currency fees, speeds up international payments, and keeps your income stable.",
  },
  "crypto-research-report": {
    name: "Crypto Research Report",
    description: "Structured due-diligence report on any crypto project: tokenomics, team, tech, and risks.",
    longDesc: "Builds a comprehensive research report on a crypto project from public information. Ideal for investors, analysts, or content creators covering Web3.",
    category: "Crypto",
    price: "0.07",
    version: "v1.0.0",
    runtime: "~80s",
    modelCount: 4,
    calls: 412,
    inputLabel: "Project name",
    inputHint: "Enter the project name and any specific angle you want covered (e.g. 'focus on tokenomics').",
    outputHint: "Structured 1500-word research report with risk rating.",
    limits: { inputChars: 800, outputWords: 2000 },
    steps: [
      { name: "Project Scanner", model: "gpt-4.1-mini", purpose: "Identify key aspects of the project to research.", tokens: "~200" },
      { name: "Tokenomics Analyst", model: "claude-3-haiku", purpose: "Analyze token supply, distribution, and emission schedule.", tokens: "~500" },
      { name: "Research Synthesizer", model: "claude-3.5-sonnet", purpose: "Write the full research report with analysis.", tokens: "~2000" },
      { name: "Risk Assessor", model: "gpt-4.1-mini", purpose: "Assign a risk rating and flag red flags.", tokens: "~400" },
    ],
    pricing: [
      { step: "Project Scanner", model: "gpt-4.1-mini", inputTokens: 200, outputTokens: 300, cost: "0.0004" },
      { step: "Tokenomics Analyst", model: "claude-3-haiku", inputTokens: 500, outputTokens: 500, cost: "0.008" },
      { step: "Research Synthesizer", model: "claude-3.5-sonnet", inputTokens: 800, outputTokens: 1800, cost: "0.051" },
      { step: "Risk Assessor", model: "gpt-4.1-mini", inputTokens: 1800, outputTokens: 400, cost: "0.010" },
    ],
    examplePrompt: "Write a research report on Circle's Arc blockchain and USDC as native gas token.",
    exampleOutput: "# Research Report: Arc Network by Circle\n\n**Risk Rating:** Low-Medium\n\n## Overview\n\nArc is a high-throughput EVM-compatible blockchain where USDC is the native gas token. This eliminates multi-token friction common to most EVM chains.\n\n## Key Metrics\n\n- Finality: < 1 second\n- Gas token: USDC (6 decimals ERC-20)\n- CCTP support: Native\n\n## Tokenomics\n\nNo governance token. Gas is paid in USDC, flowing to validators. The model is fee-based rather than speculative.\n\n## Risks\n\n1. Centralization: Circle controls USDC minting and chain governance.\n2. Regulatory: USDC is subject to US regulatory actions.\n3. Ecosystem depth: Currently testnet.\n\n## Verdict\n\nArc is purpose-built for USDC-native applications. Primary risk is regulatory. Suitable for payment-focused applications.",
  },
  "code-review": {
    name: "Code Review",
    description: "Get a detailed code review: bugs, security issues, performance problems, and fixes.",
    longDesc: "A multi-pass review pipeline that checks for correctness, security vulnerabilities, performance, and code style. Returns a structured report with prioritized findings and suggested fixes.",
    category: "Code",
    price: "0.03",
    version: "v1.3.0",
    runtime: "~35s",
    modelCount: 3,
    calls: 1834,
    inputLabel: "Code snippet",
    inputHint: "Paste the code you want reviewed. Include the language (e.g. '// JavaScript') or specify in your prompt.",
    outputHint: "Structured review with prioritized findings, severity labels, and suggested fixes.",
    limits: { inputChars: 8000, outputWords: 1500 },
    steps: [
      { name: "Code Parser", model: "gpt-4.1-mini", purpose: "Identify language, framework, and code structure.", tokens: "~150" },
      { name: "Security Scanner", model: "claude-3.5-sonnet", purpose: "Check for XSS, injection, auth issues, and vulnerabilities.", tokens: "~800" },
      { name: "Quality Reviewer", model: "gpt-4.1-mini", purpose: "Review performance, style, error handling, and maintainability.", tokens: "~600" },
    ],
    pricing: [
      { step: "Code Parser", model: "gpt-4.1-mini", inputTokens: 600, outputTokens: 200, cost: "0.0006" },
      { step: "Security Scanner", model: "claude-3.5-sonnet", inputTokens: 800, outputTokens: 700, cost: "0.023" },
      { step: "Quality Reviewer", model: "gpt-4.1-mini", inputTokens: 1500, outputTokens: 500, cost: "0.006" },
    ],
    examplePrompt: "Review this Node.js function that handles user login and returns a JWT token.",
    exampleOutput: "# Code Review Report\n\n**Language:** Node.js\n**Findings:** 1 Critical, 2 High, 3 Medium\n\n---\n\n## Critical\n\n**[C1] Timing attack on password comparison**\nUsing `===` for passwords is vulnerable to timing attacks.\n\n```js\n// Fix: use crypto.timingSafeEqual\nconst crypto = require('crypto');\nif (!crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b))) { ... }\n```\n\n## High\n\n**[H1] JWT secret hardcoded** - Move to `process.env.JWT_SECRET`.\n\n**[H2] No rate limiting** - Add `express-rate-limit` to the login endpoint.\n\n## Medium\n\n**[M1]** Missing `httpOnly` flag on cookie if JWT is stored client-side.\n**[M2]** No input validation on email format.\n**[M3]** Error messages reveal whether email exists.\n\n## Suggestions\n\n- Add `zod` or `joi` for schema validation\n- Log failed login attempts for audit trail",
  },
};

const CATEGORY_COLORS = {
  Freelance: "var(--gold)",
  Content: "#6df7a0",
  Research: "#7eb8f7",
  Code: "#b388ff",
  Crypto: "#ffbd67",
  Business: "#ff9a8b",
};

// In-session run history; persisted to sessionStorage so sidebar navigation (which
// reloads the page) does not wipe it. Populated via pushRunHistory().
const RUN_HISTORY_KEY = "fundline_wf_run_history";
const RUN_HISTORY = (() => {
  try {
    const saved = sessionStorage.getItem(RUN_HISTORY_KEY);
    return saved ? JSON.parse(saved) : [];
  } catch (_) { return []; }
})();
function pushRunHistory(entry) {
  RUN_HISTORY.unshift(entry);
  try { sessionStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(RUN_HISTORY.slice(0, 50))); } catch (_) {}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function randId() {
  return "wfr_" + Math.random().toString(36).slice(2, 10);
}

// ─── Router ──────────────────────────────────────────────────────────────────

function getRoute() {
  const path = window.location.pathname.replace(/\/$/, "") || "/workflows";
  if (path === "/workflows") return { page: "explore" };
  if (path === "/workflows/runs") return { page: "runs" };
  if (path === "/workflows/settings") return { page: "settings" };
  const m = path.match(/^\/workflows\/([^/]+)$/);
  if (m) return { page: "detail", slug: m[1] };
  return { page: "explore" };
}

function navigate(href) {
  window.history.pushState({}, "", href);
  render();
}

// Server-reported config (/api/config). Until it loads, every workflow shows as
// "coming soon" (safe to deploy the frontend before the server flag/keys are on).
let WF_RUNNER_ENABLED = false;
let WF_CONFIG = {};
function isWorkflowLive(wf) {
  return Boolean(wf && wf.live && WF_RUNNER_ENABLED);
}
// Billing is on only when the workflow is live AND the server has the escrow +
// treasury configured. When off, runs use the free beta path (no on-chain pay).
function isBillingEnabled(wf) {
  return Boolean(isWorkflowLive(wf) && WF_CONFIG && WF_CONFIG.workflowBillingEnabled);
}

// --- Minimal EIP-1193 wallet helpers for escrow funding (billing path) ---
const ARC_CHAIN_ID_HEX = "0x4cef52"; // 5042002
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const ERC20_ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ESCROW_FUND_SELECTOR = "0xe46bbc9e"; // fund(bytes32,uint256)
const MAX_UINT256 = (2n ** 256n) - 1n; // one-time approval cap

function getEthProvider() {
  return (typeof window !== "undefined" && window.ethereum) ? window.ethereum : null;
}
function encAddr(a) { return String(a).toLowerCase().replace(/^0x/, "").padStart(64, "0"); }
function encUint(n) { return BigInt(n).toString(16).padStart(64, "0"); }
function encBytes32(h) { return String(h).toLowerCase().replace(/^0x/, "").padStart(64, "0"); }

async function ensureArcChain(provider) {
  const current = await provider.request({ method: "eth_chainId" });
  if (String(current).toLowerCase() === ARC_CHAIN_ID_HEX) return;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
  } catch (err) {
    throw new Error("Switch your wallet to Arc Testnet to pay.");
  }
}
async function readAllowance(provider, usdc, owner, spender) {
  const data = ERC20_ALLOWANCE_SELECTOR + encAddr(owner) + encAddr(spender);
  const res = await provider.request({ method: "eth_call", params: [{ to: usdc, data }, "latest"] });
  return BigInt(res || "0x0");
}
async function sendWalletTx(provider, from, to, data) {
  return provider.request({ method: "eth_sendTransaction", params: [{ from, to, data, value: "0x0" }] });
}
async function waitWalletTx(provider, hash) {
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 3000));
    const rcpt = await provider.request({ method: "eth_getTransactionReceipt", params: [hash] });
    if (rcpt) {
      if (rcpt.status === "0x0") throw new Error("Transaction reverted on-chain.");
      return rcpt;
    }
  }
  throw new Error("Transaction not confirmed in time.");
}

// Quote -> approve (if needed) -> fund the escrow from the user's wallet.
// statusFn(text) updates the run button label during the wallet steps.
async function fundWorkflowRun(slug, statusFn) {
  const provider = getEthProvider();
  if (!provider) throw new Error("No wallet found. Install a wallet to pay and run.");
  // Single dApp-wide wallet session (sidebar). Connect via it if not connected yet.
  let from = window.FundlineWallet ? window.FundlineWallet.getAddress() : "";
  if (!from) {
    statusFn("Connecting wallet...");
    from = window.FundlineWallet ? await window.FundlineWallet.connect() : "";
    if (!from) throw new Error("Connect your wallet to run this workflow.");
  }
  await ensureArcChain(provider);

  statusFn("Getting quote...");
  const qRes = await fetch(`/api/workflows/${slug}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  const quote = await qRes.json().catch(() => ({}));
  if (!qRes.ok) throw new Error(quote.message || "Could not get a quote.");

  const amount = BigInt(quote.amount);
  const escrow = quote.escrowAddress;
  const usdc = quote.usdc;

  // One-time approval (large allowance) so every later run needs only the single
  // fund signature, not approve + fund.
  const allowance = await readAllowance(provider, usdc, from, escrow);
  if (allowance < amount) {
    statusFn("Approve USDC (one time) in your wallet...");
    const approveData = ERC20_APPROVE_SELECTOR + encAddr(escrow) + encUint(MAX_UINT256);
    const approveHash = await sendWalletTx(provider, from, usdc, approveData);
    statusFn("Confirming approval...");
    await waitWalletTx(provider, approveHash);
  }

  statusFn("Confirm payment in your wallet...");
  const fundData = ESCROW_FUND_SELECTOR + encBytes32(quote.runId) + encUint(amount);
  const fundHash = await sendWalletTx(provider, from, escrow, fundData);
  statusFn("Confirming payment...");
  await waitWalletTx(provider, fundHash);
  return quote.runId;
}

// Show an error in the run result area (funding failures or run failures).
function displayRunError(message) {
  const resultEl = document.getElementById("wfRunResult");
  const receiptEl = document.getElementById("wfRunReceipt");
  if (receiptEl) receiptEl.hidden = true;
  if (!resultEl) return;
  resultEl.hidden = false;
  const label = resultEl.querySelector(".wf-run-result-label");
  if (label) label.textContent = "Could not complete";
  const viewBtn = document.getElementById("wfViewResultBtn");
  if (viewBtn) viewBtn.hidden = true;
  const msg = document.getElementById("wfRunResultMsg");
  if (msg) { msg.hidden = false; msg.textContent = message; }
}

// --- Markdown -> safe HTML (compact, for the result report modal) ---
function mdInline(s) {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, (m, c) => `<code>${c}</code>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label, url) => {
    const safe = /^(https?:\/\/|\/)/i.test(url.trim()) ? url.trim() : "#";
    return `<a href="${safe}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  return t;
}
function mdSplitRow(line) {
  return line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map((c) => c.trim());
}
function renderMarkdown(md) {
  const lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^\s*```/.test(lines[i])) { buf.push(lines[i]); i += 1; }
      i += 1;
      out.push(`<pre class="wf-report-code"><code>${esc(buf.join("\n"))}</code></pre>`);
      continue;
    }
    if (line.indexOf("|") !== -1 && i + 1 < lines.length && lines[i + 1].indexOf("|") !== -1 && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].indexOf("-") !== -1) {
      const header = mdSplitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].indexOf("|") !== -1 && lines[i].trim() !== "") { rows.push(mdSplitRow(lines[i])); i += 1; }
      let t = `<table class="wf-report-table"><thead><tr>${header.map((h) => `<th>${mdInline(h)}</th>`).join("")}</tr></thead><tbody>`;
      t += rows.map((r) => `<tr>${r.map((c) => `<td>${mdInline(c)}</td>`).join("")}</tr>`).join("");
      out.push(`${t}</tbody></table>`);
      continue;
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) { out.push(`<h${h[1].length}>${mdInline(h[2])}</h${h[1].length}>`); i += 1; continue; }
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { out.push("<hr>"); i += 1; continue; }
    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*]\s+/, "")); i += 1; }
      out.push(`<ul>${items.map((it) => `<li>${mdInline(it)}</li>`).join("")}</ul>`);
      continue;
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+\.\s+/, "")); i += 1; }
      out.push(`<ol>${items.map((it) => `<li>${mdInline(it)}</li>`).join("")}</ol>`);
      continue;
    }
    if (line.trim() === "") { i += 1; continue; }
    const para = [];
    while (i < lines.length && lines[i].trim() !== "" && !/^\s*(#{1,6}\s|```|[-*]\s|\d+\.\s)/.test(lines[i]) && lines[i].indexOf("|") === -1) {
      para.push(lines[i]);
      i += 1;
    }
    if (para.length) { out.push(`<p>${mdInline(para.join(" "))}</p>`); } else { out.push(`<p>${mdInline(line)}</p>`); i += 1; }
  }
  return out.join("\n");
}

// --- Result report modal ---
function closeResultModal() {
  const overlay = document.getElementById("wfResultModal");
  if (overlay) overlay.hidden = true;
  document.body.style.overflow = "";
}
function openResultModal(markdown, slug) {
  let overlay = document.getElementById("wfResultModal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "wfResultModal";
    overlay.className = "wf-modal-overlay";
    overlay.hidden = true;
    overlay.innerHTML = `
      <div class="wf-modal" role="dialog" aria-modal="true" aria-label="Workflow result">
        <div class="wf-modal-head">
          <h3 class="wf-modal-title">Result</h3>
          <div class="wf-modal-actions">
            <button class="wf-result-btn" id="wfModalCopy" type="button">Copy</button>
            <button class="wf-result-btn" id="wfModalDownload" type="button">Download .md</button>
            <button class="wf-modal-close" id="wfModalClose" type="button" aria-label="Close">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
        <div class="wf-modal-body wf-report" id="wfModalBody"></div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener("click", (e) => { if (e.target === overlay) closeResultModal(); });
    document.getElementById("wfModalClose").addEventListener("click", closeResultModal);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeResultModal(); });
  }
  document.getElementById("wfModalBody").innerHTML = renderMarkdown(markdown);
  const copyBtn = document.getElementById("wfModalCopy");
  copyBtn.textContent = "Copy";
  copyBtn.onclick = () => {
    navigator.clipboard.writeText(markdown).then(() => {
      copyBtn.textContent = "Copied!";
      setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
    });
  };
  document.getElementById("wfModalDownload").onclick = () => {
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slug || "workflow"}-result.md`;
    a.click();
    URL.revokeObjectURL(url);
  };
  overlay.hidden = false;
  document.body.style.overflow = "hidden";
}

function switchToTab(name) {
  const tabsEl = document.querySelector(".wf-tabs");
  if (!tabsEl) return;
  tabsEl.querySelectorAll(".wf-tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  document.querySelectorAll(".wf-tab-panel").forEach((p) => p.classList.toggle("is-active", p.dataset.panel === name));
}

function setNodeState(idx, state) {
  const node = document.querySelector(`.wfg2-node[data-node-idx="${idx}"]`);
  if (!node) return;
  node.classList.remove("wfg2-node--pending", "wfg2-node--running", "wfg2-node--completed", "wfg2-node--failed");
  if (state) node.classList.add("wfg2-node--" + state);
}

function setStepRowState(idx, state) {
  const row = document.querySelector(`tr[data-step-row="${idx}"]`);
  if (!row) return;
  const badge = row.querySelector(".wfg-step-status");
  if (badge) {
    badge.className = "wfg-step-status wfg-step-status--" + state;
    const labels = { pending: "Pending", running: "Running", completed: "Done", failed: "Failed" };
    badge.textContent = labels[state] || state;
  }
  row.classList.toggle("wfg-row--running", state === "running");
}

function render() {
  const route = getRoute();
  const root = document.getElementById("wfRoot");
  if (!root) return;
  const loadingEl = document.getElementById("wfLoading");
  if (loadingEl) loadingEl.hidden = true;

  setSidebarActive(route);

  if (route.page === "explore") {
    document.title = "Explore Workflows - Fundline";
    root.innerHTML = renderExplore();
    bindExplore();
  } else if (route.page === "detail") {
    const wf = WORKFLOWS[route.slug];
    if (!wf) { root.innerHTML = render404(); return; }
    document.title = wf.name + " - Fundline Workflows";
    root.innerHTML = renderDetail(route.slug, wf);
    bindDetail(route.slug, wf);
  } else if (route.page === "runs") {
    document.title = "Run History - Fundline";
    root.innerHTML = renderRuns();
    bindRuns();
  } else if (route.page === "settings") {
    document.title = "Workflow Settings - Fundline";
    root.innerHTML = renderSettings();
  }
}

function setSidebarActive(route) {
  document.querySelectorAll(".nav-item[href]").forEach((link) => {
    const href = link.getAttribute("href");
    let active = false;
    if (href === "/workflows") active = route.page === "explore" || route.page === "detail";
    else if (href === "/workflows/runs") active = route.page === "runs";
    else if (href === "/workflows/settings") active = route.page === "settings";
    link.classList.toggle("is-active", active);
  });
}

// ─── Explore Page ─────────────────────────────────────────────────────────────

function renderExplore() {
  const cards = Object.entries(WORKFLOWS).map(([slug, wf]) => renderWorkflowCard(slug, wf)).join("");
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">AI Workflows</p>
        <h1>Explore Workflows</h1>
      </div>
    </header>
    <div class="wf-explore-body">
      <div class="wf-explore-top">
        <div class="wf-search-wrap">
          <svg viewBox="0 0 24 24" aria-hidden="true" class="wf-search-icon"><circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M21 21l-4.35-4.35" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
          <input type="search" class="wf-search" id="wfSearch" placeholder="Search workflows..." autocomplete="off" />
        </div>
        <div class="wf-filters" id="wfFilters" role="group" aria-label="Category filters">
          ${["All","Freelance","Content","Research","Code","Crypto","Business"].map((c) =>
            `<button class="wf-filter-btn${c==="All"?" is-active":""}" data-cat="${c}" type="button">${c}</button>`
          ).join("")}
        </div>
      </div>
      <div class="wf-grid" id="wfGrid">${cards}</div>
    </div>`;
}

function renderWorkflowCard(slug, wf) {
  const catColor = CATEGORY_COLORS[wf.category] || "var(--gold)";
  return `
    <article class="wf-card" data-cat="${esc(wf.category)}" data-slug="${esc(slug)}">
      <div class="wf-card-top">
        <span class="wf-cat-badge" style="color:${catColor};border-color:${catColor}22;background:${catColor}12">${esc(wf.category)}</span>
        <span class="wf-price">${esc(wf.price)} <span class="wf-price-unit">USDC / call</span></span>
      </div>
      <h3 class="wf-card-name">${esc(wf.name)}</h3>
      <p class="wf-card-desc">${esc(wf.description)}</p>
      <div class="wf-card-meta">
        <span class="wf-meta-pill">${esc(wf.version)}</span>
        <span class="wf-meta-pill">${esc(wf.runtime)}</span>
        <span class="wf-meta-pill">${wf.modelCount} models</span>
        <span class="wf-meta-pill">${wf.calls.toLocaleString()} runs</span>
      </div>
      <button class="wf-card-btn" data-slug="${esc(slug)}" type="button">View workflow</button>
    </article>`;
}

function bindExplore() {
  const grid = document.getElementById("wfGrid");
  const search = document.getElementById("wfSearch");
  const filters = document.getElementById("wfFilters");
  let activeCat = "All";

  function filterCards() {
    const q = (search.value || "").toLowerCase();
    grid.querySelectorAll(".wf-card").forEach((card) => {
      const cat = card.dataset.cat;
      const slug = card.dataset.slug;
      const wf = WORKFLOWS[slug];
      const matchCat = activeCat === "All" || cat === activeCat;
      const matchQ = !q || wf.name.toLowerCase().includes(q) || wf.description.toLowerCase().includes(q) || cat.toLowerCase().includes(q);
      card.hidden = !(matchCat && matchQ);
    });
    const anyVisible = [...grid.querySelectorAll(".wf-card")].some((c) => !c.hidden);
    let empty = grid.querySelector(".wf-empty");
    if (!anyVisible) {
      if (!empty) { empty = document.createElement("p"); empty.className = "wf-empty"; grid.appendChild(empty); }
      empty.textContent = "No workflows match your search.";
    } else if (empty) {
      empty.remove();
    }
  }

  filters.addEventListener("click", (e) => {
    const btn = e.target.closest(".wf-filter-btn");
    if (!btn) return;
    activeCat = btn.dataset.cat;
    filters.querySelectorAll(".wf-filter-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
    filterCards();
  });

  search.addEventListener("input", filterCards);

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-slug]");
    if (!btn) return;
    navigate("/workflows/" + btn.dataset.slug);
  });
}

// ─── Detail Page ──────────────────────────────────────────────────────────────

function renderDetail(slug, wf) {
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">
          <a href="/workflows" class="wf-back-link" data-nav="/workflows">Workflows</a>
          <svg viewBox="0 0 24 24" aria-hidden="true" style="width:12px;height:12px;vertical-align:middle;margin:0 4px"><path d="M9 18l6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${esc(wf.category)}
        </p>
        <h1>${esc(wf.name)}</h1>
      </div>
    </header>
    <div class="wf-detail-body">
      <div class="wf-detail-hero">
        <p class="wf-detail-desc">${esc(wf.longDesc)}</p>
        <div class="wf-stat-bar">
          <div class="wf-stat"><span class="wf-stat-val">${esc(wf.price)} USDC</span><span class="wf-stat-lbl">per call</span></div>
          <div class="wf-stat"><span class="wf-stat-val">${esc(wf.version)}</span><span class="wf-stat-lbl">version</span></div>
          <div class="wf-stat"><span class="wf-stat-val">${esc(wf.runtime)}</span><span class="wf-stat-lbl">est. runtime</span></div>
          <div class="wf-stat"><span class="wf-stat-val">${wf.modelCount}</span><span class="wf-stat-lbl">models</span></div>
          <div class="wf-stat"><span class="wf-stat-val">${wf.calls.toLocaleString()}</span><span class="wf-stat-lbl">total runs</span></div>
        </div>
      </div>

      <div class="wf-detail-layout">
        <div class="wf-detail-main">
          <div class="wf-tabs" role="tablist">
            ${["Overview","Workflow Steps","Example Output","API"].map((t, i) =>
              `<button class="wf-tab${i===0?" is-active":""}" role="tab" data-tab="${t}" type="button">${t}</button>`
            ).join("")}
          </div>
          <div class="wf-tab-panels">
            ${renderTabOverview(wf)}
            ${renderTabSteps(wf)}
            ${renderTabExample(wf)}
            ${renderTabApi(slug, wf)}
          </div>
        </div>
        <aside class="wf-run-panel" id="wfRunPanel">
          ${renderRunPanel(slug, wf)}
        </aside>
      </div>
    </div>`;
}

function renderTabOverview(wf) {
  return `<div class="wf-tab-panel is-active" data-panel="Overview">
    <div class="wf-overview-grid">
      <div class="wf-overview-block">
        <h4>Input</h4>
        <p class="wf-overview-label">${esc(wf.inputLabel)}</p>
        <p class="wf-muted">${esc(wf.inputHint)}</p>
      </div>
      <div class="wf-overview-block">
        <h4>Output</h4>
        <p class="wf-muted">${esc(wf.outputHint)}</p>
      </div>
      <div class="wf-overview-block wf-overview-full">
        <h4>Limits</h4>
        <div class="wf-limits-row">
          <div class="wf-limit-item"><span class="wf-limit-lbl">Max input</span><span class="wf-limit-val">${wf.limits.inputChars.toLocaleString()} characters</span></div>
          <div class="wf-limit-item"><span class="wf-limit-lbl">Max output</span><span class="wf-limit-val">${wf.limits.outputWords.toLocaleString()} words</span></div>
          <div class="wf-limit-item"><span class="wf-limit-lbl">Max concurrent calls</span><span class="wf-limit-val">5</span></div>
        </div>
      </div>
    </div>
  </div>`;
}

function wfgNodeIcon(type) {
  if (type === "input") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  }
  if (type === "output") {
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  }
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="13.5" r="1" fill="currentColor"/><circle cx="15" cy="13.5" r="1" fill="currentColor"/></svg>';
}

function renderCanvasNode(node, gCol, gRow) {
  const cls = node.type === "input" ? "wfg2-node--input wfg2-node--io"
    : node.type === "output" ? "wfg2-node--output wfg2-node--io"
    : "wfg2-node--ai";
  const step = node.type === "input" ? "INPUT"
    : node.type === "output" ? "OUTPUT"
    : "STEP " + String(node.stepNum).padStart(2, "0");
  const model = node.model ? `<span class="wfg2-model">${esc(node.model)}</span>` : "";
  const state = `<span class="wfg2-state">`
    + `<span class="wfg2-state-dot"></span>`
    + `<span class="wfg2-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`
    + `</span>`;
  return `<div class="wfg2-node ${cls}" data-node-idx="${node.idx}" style="grid-column:${gCol};grid-row:${gRow}">
    <div class="wfg2-node-top">
      <span class="wfg2-ico">${wfgNodeIcon(node.type)}</span>
      <span class="wfg2-step">${step}</span>
      ${state}
    </div>
    <div class="wfg2-name">${esc(node.name)}</div>
    ${model}
  </div>`;
}

function renderTabSteps(wf) {
  const pricing = wf.pricing || [];

  const nodes = [
    { type: "input", idx: 0, name: "User Input", purpose: wf.inputHint || "Your prompt or instructions" },
    ...wf.steps.map((s, i) => ({ type: "ai", idx: i + 1, stepNum: i + 1, name: s.name, model: s.model, purpose: s.purpose })),
    { type: "output", idx: wf.steps.length + 1, name: "Final Output", purpose: wf.outputHint || "Ready to use result" },
  ];

  const total = nodes.length;
  const nodeCols = total <= 3 ? total : Math.ceil(total / 2);
  const twoRows = total > 3;

  // Build grid template: node columns are flexible, connector columns are fixed width.
  const colParts = [];
  for (let c = 0; c < nodeCols; c++) {
    if (c > 0) colParts.push("44px");
    colParts.push("minmax(0, 1fr)");
  }
  const rowTpl = twoRows ? "auto 42px auto" : "auto";

  // Snake placement: row 0 left to right, row 1 right to left.
  function colIndexOf(n) {
    const row = Math.floor(n / nodeCols);
    const pos = n % nodeCols;
    return row % 2 === 0 ? pos : (nodeCols - 1 - pos);
  }

  const cells = [];
  nodes.forEach((node, n) => {
    const row = Math.floor(n / nodeCols);
    const colIdx = colIndexOf(n);
    const gCol = colIdx * 2 + 1;
    const gRow = row * 2 + 1;
    cells.push(renderCanvasNode(node, gCol, gRow));
    if (n < nodes.length - 1) {
      const nextRow = Math.floor((n + 1) / nodeCols);
      if (nextRow === row) {
        const nextColIdx = colIndexOf(n + 1);
        const connCol = Math.min(colIdx, nextColIdx) * 2 + 2;
        const dir = row % 2 === 0 ? "right" : "left";
        cells.push(`<div class="wfg2-conn wfg2-conn--h wfg2-conn--${dir}" style="grid-column:${connCol};grid-row:${gRow}" aria-hidden="true"></div>`);
      } else {
        cells.push(`<div class="wfg2-conn wfg2-conn--v" style="grid-column:${gCol};grid-row:${gRow + 1}" aria-hidden="true"></div>`);
      }
    }
  });

  const summaryRows = nodes.map((node) => {
    const label = node.type === "input" ? "Input" : node.type === "output" ? "Output" : "Step " + String(node.stepNum).padStart(2, "0");
    return { label, name: node.name, model: node.model || null, purpose: node.purpose };
  });

  const summaryHtml = summaryRows.map((r, i) => `
    <tr data-step-row="${i}">
      <td><span class="wfg-row-label">${esc(r.label)}</span><span class="wfg-row-name">${esc(r.name)}</span></td>
      <td>${r.model ? `<span class="wf-graph-model-tag">${esc(r.model)}</span>` : '<span class="wf-muted">-</span>'}</td>
      <td class="wf-muted" style="font-size:12px;line-height:1.5">${esc(r.purpose)}</td>
      <td><span class="wfg-step-status wfg-step-status--pending">Pending</span></td>
    </tr>`).join("");

  return `<div class="wf-tab-panel" data-panel="Workflow Steps">
    <div class="wfg-canvas">
      <div class="wfg-canvas-head">
        <div>
          <div class="wfg-canvas-title">Workflow Structure</div>
          <div class="wfg-canvas-sub">Transparent execution steps and models.</div>
        </div>
        <div class="wfg-chips">
          <span class="wfg-chip">${total} nodes</span>
          <span class="wfg-chip">${wf.modelCount} AI models</span>
          <span class="wfg-chip">${esc(wf.runtime)}</span>
        </div>
      </div>
      <div class="wfg2-board">
        <div class="wfg2-grid" style="grid-template-columns:${colParts.join(" ")};grid-template-rows:${rowTpl}">
          ${cells.join("")}
        </div>
      </div>
      <div class="wfg-summary">
        <div class="wfg-summary-hd">Execution Summary</div>
        <div class="wf-table-wrap">
          <table class="wfg-sum-table">
            <thead><tr><th>Step</th><th>Model</th><th>Purpose</th><th>Status</th></tr></thead>
            <tbody>${summaryHtml}</tbody>
          </table>
        </div>
      </div>
    </div>
  </div>`;
}


function renderTabExample(wf) {
  const lines = wf.exampleOutput.split("\n").map((l) => esc(l)).join("\n");
  return `<div class="wf-tab-panel" data-panel="Example Output">
    <div class="wf-example-prompt">
      <div class="wf-example-label">Example prompt</div>
      <p class="wf-muted">${esc(wf.examplePrompt)}</p>
    </div>
    <div class="wf-example-label">Output</div>
    <pre class="wf-example-output">${lines}</pre>
  </div>`;
}

function renderTabApi(slug, wf) {
  const endpoint = `https://fundline.xyz/api/workflows/${slug}/run`;
  const code = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"prompt": "${wf.examplePrompt.slice(0, 60)}..."}'`;
  const resp = `{
  "runId": "wfr_a1b2c3d4",
  "status": "completed",
  "workflow": "${slug}",
  "version": "${wf.version}",
  "output": "...",
  "cost": "${wf.price}",
  "currency": "USDC",
  "txHash": "0x..."
}`;
  return `<div class="wf-tab-panel" data-panel="API">
    <div class="wf-api-note">API access requires an API key from the Developers section. <span class="wf-api-soon">Coming soon.</span></div>
    <div class="wf-api-pair">
      <div>
        <div class="wf-example-label">Request</div>
        <pre class="wf-code-block"><code>${esc(code)}</code></pre>
      </div>
      <div>
        <div class="wf-example-label">Response</div>
        <pre class="wf-code-block"><code>${esc(resp)}</code></pre>
      </div>
    </div>
  </div>`;
}

function renderRunPanel(slug, wf) {
  if (!isWorkflowLive(wf)) {
    return `
    <div class="wf-run-header">
      <h3>Run this workflow</h3>
      <div class="wf-run-price-tag">Coming soon</div>
    </div>
    <p class="wf-run-hint wf-muted">Live runs for this workflow are coming soon. Explore the steps and example output in the meantime.</p>
    <button class="wf-btn-run" type="button" disabled>Coming soon</button>`;
  }

  const retrieval = wf.usesRetrieval ? `
    <div class="wf-run-retrieval" role="group" aria-label="Sources">
      <label class="wf-run-label">Sources</label>
      <div class="wf-run-modes" id="wfRetrModes">
        <button class="wf-run-mode-btn is-active" data-retr="search" type="button">Search the web</button>
        <button class="wf-run-mode-btn" data-retr="paste" type="button">Paste my sources</button>
      </div>
      <div id="wfPastePanel" class="wf-run-mode-panel" hidden>
        <p class="wf-run-hint wf-muted">Paste URLs or text, one source per blank-line-separated block.</p>
        <textarea id="wfPasteSources" class="wf-run-textarea" rows="4" placeholder="https://example.com/page&#10;&#10;Or paste source text here..."></textarea>
      </div>
    </div>` : "";

  return `
    <div class="wf-run-header">
      <h3>Run this workflow</h3>
      <div class="wf-run-price-tag">${esc(wf.price)} USDC / call</div>
    </div>
    <div class="wf-run-modes" id="wfInputModes" role="group" aria-label="Input mode">
      <button class="wf-run-mode-btn is-active" data-mode="own" type="button">Write prompt</button>
      <button class="wf-run-mode-btn" data-mode="build" type="button">Generate prompt</button>
    </div>

    <div id="wfModeOwn" class="wf-run-mode-panel">
      <label class="wf-run-label" for="wfOwnPrompt">${esc(wf.inputLabel)}</label>
      <p class="wf-run-hint wf-muted">${esc(wf.inputHint)}</p>
      <textarea id="wfOwnPrompt" class="wf-run-textarea" rows="5" placeholder="Enter your prompt..."></textarea>
    </div>

    <div id="wfModeBuild" class="wf-run-mode-panel" hidden>
      <label class="wf-run-label" for="wfBuildDesc">Describe what you want</label>
      <textarea id="wfBuildDesc" class="wf-run-textarea" rows="3" placeholder="e.g. Research a company before a partnership call..."></textarea>
      <button class="wf-btn-secondary" id="wfGenPrompt" type="button">Generate professional prompt</button>
      <div id="wfGenResult" hidden>
        <label class="wf-run-label" for="wfGenPromptEdit" style="margin-top:14px">Generated prompt (editable)</label>
        <textarea id="wfGenPromptEdit" class="wf-run-textarea" rows="5"></textarea>
      </div>
    </div>

    ${retrieval}

    ${isBillingEnabled(wf) ? `<p class="wf-run-hint wf-muted">Pay ${esc(wf.price)} USDC per run from your connected wallet (sidebar). Refunded if the run fails.</p>` : ""}

    <button class="wf-btn-run" id="wfRunBtn" type="button" data-slug="${esc(slug)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
      ${isBillingEnabled(wf) ? `Pay ${esc(wf.price)} USDC and run` : "Run Workflow"}
    </button>
    <p class="wf-run-quota wf-muted" id="wfRunQuota" hidden></p>

    <div id="wfRunState" hidden>
      <div class="wf-run-progress" id="wfRunProgress"></div>
    </div>
    <div id="wfRunResult" hidden>
      <div class="wf-result-header">
        <div class="wf-run-result-label">Result</div>
        <button class="wf-btn-secondary" id="wfViewResultBtn" type="button" hidden>View result</button>
      </div>
      <p class="wf-run-result-msg wf-muted" id="wfRunResultMsg" hidden></p>
    </div>
    <div id="wfRunReceipt" hidden>
      ${renderReceiptShell()}
    </div>`;
}

function renderReceiptShell() {
  return `<div class="wf-receipt">
    <div class="wf-receipt-header">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4M7 3H5a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
      Receipt
    </div>
    <div class="wf-receipt-body" id="wfReceiptBody"></div>
  </div>`;
}

function bindDetail(slug, wf) {
  // Tab switching
  const tabsEl = document.querySelector(".wf-tabs");
  const panels = document.querySelectorAll(".wf-tab-panel");
  tabsEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".wf-tab");
    if (!tab) return;
    tabsEl.querySelectorAll(".wf-tab").forEach((t) => t.classList.remove("is-active"));
    panels.forEach((p) => p.classList.remove("is-active"));
    tab.classList.add("is-active");
    const target = document.querySelector(`.wf-tab-panel[data-panel="${tab.dataset.tab}"]`);
    if (target) target.classList.add("is-active");
  });

  // Run-panel bindings (only for live workflows; the coming-soon panel has none)
  if (isWorkflowLive(wf)) {
    let retrievalMode = "search";

    function flashOutline(el) {
      el.focus();
      el.style.outline = "1.5px solid var(--red)";
      setTimeout(() => { el.style.outline = ""; }, 2000);
    }
    function showQuotaMsg(text) {
      const q = document.getElementById("wfRunQuota");
      if (!q) return;
      q.hidden = false;
      q.textContent = text;
    }

    // Input mode toggle (write vs generate)
    const inputModes = document.getElementById("wfInputModes");
    inputModes.addEventListener("click", (e) => {
      const btn = e.target.closest(".wf-run-mode-btn");
      if (!btn) return;
      inputModes.querySelectorAll(".wf-run-mode-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
      document.getElementById("wfModeOwn").hidden = btn.dataset.mode !== "own";
      document.getElementById("wfModeBuild").hidden = btn.dataset.mode !== "build";
    });

    // Retrieval toggle (search the web vs paste sources)
    const retrModes = document.getElementById("wfRetrModes");
    if (retrModes) {
      retrModes.addEventListener("click", (e) => {
        const btn = e.target.closest(".wf-run-mode-btn");
        if (!btn) return;
        retrModes.querySelectorAll(".wf-run-mode-btn").forEach((b) => b.classList.toggle("is-active", b === btn));
        retrievalMode = btn.dataset.retr;
        document.getElementById("wfPastePanel").hidden = retrievalMode !== "paste";
      });
    }

    // Generate prompt (real call to /build-prompt)
    document.getElementById("wfGenPrompt").addEventListener("click", () => {
      const descEl = document.getElementById("wfBuildDesc");
      const desc = descEl.value.trim();
      if (!desc) { flashOutline(descEl); return; }
      const btn = document.getElementById("wfGenPrompt");
      btn.disabled = true;
      btn.textContent = "Generating...";
      fetch(`/api/workflows/${slug}/build-prompt`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: desc, category: wf.category }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || "Could not generate a prompt.");
          return data;
        })
        .then((data) => {
          document.getElementById("wfGenPromptEdit").value = data.prompt || "";
          document.getElementById("wfGenResult").hidden = false;
          btn.disabled = false;
          btn.textContent = "Regenerate prompt";
        })
        .catch((err) => {
          btn.disabled = false;
          btn.textContent = "Generate professional prompt";
          showQuotaMsg(err.message);
        });
    });

    // Run workflow (real call to /run)
    document.getElementById("wfRunBtn").addEventListener("click", () => {
      const mode = inputModes.querySelector(".wf-run-mode-btn.is-active").dataset.mode;
      let prompt = "";
      if (mode === "own") {
        prompt = document.getElementById("wfOwnPrompt").value.trim();
      } else {
        const edit = document.getElementById("wfGenPromptEdit");
        prompt = edit.value.trim() || document.getElementById("wfBuildDesc").value.trim();
      }
      if (!prompt) {
        flashOutline(mode === "own" ? document.getElementById("wfOwnPrompt") : document.getElementById("wfBuildDesc"));
        return;
      }
      let sources = null;
      if (retrievalMode === "paste") {
        const pasteEl = document.getElementById("wfPasteSources");
        sources = (pasteEl.value || "").trim().split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
        if (!sources.length) { flashOutline(pasteEl); return; }
      }
      switchToTab("Workflow Steps");

      if (isBillingEnabled(wf)) {
        // Pay first: quote -> approve -> fund the escrow, then run with the runId.
        const runBtn = document.getElementById("wfRunBtn");
        const runIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
        runBtn.disabled = true;
        document.getElementById("wfRunResult").hidden = true;
        document.getElementById("wfRunReceipt").hidden = true;
        fundWorkflowRun(slug, (text) => { runBtn.innerHTML = esc(text); })
          .then((runId) => runWorkflow(slug, wf, { prompt, mode: retrievalMode, sources, runId }))
          .catch((err) => {
            runBtn.disabled = false;
            runBtn.innerHTML = `${runIcon} Run Workflow`;
            displayRunError(err.message || "Payment was not completed.");
          });
      } else {
        runWorkflow(slug, wf, { prompt, mode: retrievalMode, sources });
      }
    });
  }

  // Back navigation
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });
}

function runWorkflow(slug, wf, opts) {
  const runBtn = document.getElementById("wfRunBtn");
  const stateEl = document.getElementById("wfRunState");
  const resultEl = document.getElementById("wfRunResult");
  const receiptEl = document.getElementById("wfRunReceipt");
  const quotaEl = document.getElementById("wfRunQuota");

  if (stateEl) stateEl.hidden = true;
  resultEl.hidden = true;
  receiptEl.hidden = true;
  if (quotaEl) quotaEl.hidden = true;
  runBtn.disabled = true;
  const runIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
  runBtn.innerHTML = `${runIcon} Running...`;

  // Node layout: 0 = User Input, 1..N = steps, N+1 = Final Output
  const stepCount = wf.steps.length;
  const outputIdx = stepCount + 1;
  const totalNodes = stepCount + 2;
  for (let j = 0; j < totalNodes; j++) {
    setNodeState(j, "pending");
    setStepRowState(j, "pending");
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Fire the real request immediately; the canvas animation paces against it.
  const reqBody = { prompt: opts.prompt, mode: opts.mode };
  if (opts.sources && opts.sources.length) reqBody.sources = opts.sources;
  if (opts.runId) reqBody.runId = opts.runId;
  const fetchPromise = fetch(`/api/workflows/${slug}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reqBody),
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  }, (err) => ({ ok: false, status: 0, data: { message: err.message } }));

  (async () => {
    setNodeState(0, "completed");
    setStepRowState(0, "completed");
    // Animate steps 1..N; hold the last node "running" until the real response lands.
    for (let k = 1; k <= stepCount; k += 1) {
      setNodeState(k, "running");
      setStepRowState(k, "running");
      if (k < stepCount) {
        await sleep(650);
        setNodeState(k, "completed");
        setStepRowState(k, "completed");
      }
    }
    const out = await fetchPromise;
    if (!out.ok) {
      setNodeState(stepCount, "failed");
      setStepRowState(stepCount, "failed");
      showRunError(out.data);
      restoreBtn();
      return;
    }
    setNodeState(stepCount, "completed");
    setStepRowState(stepCount, "completed");
    setNodeState(outputIdx, "completed");
    setStepRowState(outputIdx, "completed");
    showRunResult(out.data);
    restoreBtn();
  })();

  function restoreBtn() {
    runBtn.disabled = false;
    runBtn.innerHTML = `${runIcon} Run again`;
  }

  function showRunError(data) {
    const msg = (data && (data.message || data.error)) || "The workflow could not complete.";
    pushRunHistory({
      id: opts.runId || randId(),
      slug: slug,
      workflow: wf.name,
      status: "failed",
      at: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      output: null,
      releaseTx: null,
      charged: wf.price,
    });
    displayRunError(msg);
  }

  function showRunResult(data) {
    const output = String(data.output || "");
    pushRunHistory({
      id: opts.runId || randId(),
      slug: slug,
      workflow: wf.name,
      status: "completed",
      at: new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }),
      output: output,
      releaseTx: data.releaseTx || null,
      charged: wf.price,
    });
    resultEl.hidden = false;
    const label = resultEl.querySelector(".wf-run-result-label");
    if (label) label.textContent = "Result";
    const resultMsg = document.getElementById("wfRunResultMsg");
    if (resultMsg) resultMsg.hidden = true;
    const viewBtn = document.getElementById("wfViewResultBtn");
    if (viewBtn) {
      viewBtn.hidden = false;
      viewBtn.onclick = () => openResultModal(output, slug);
    }
    // Open the report immediately so the user sees it right away.
    openResultModal(output, slug);

    receiptEl.hidden = false;
    const sources = Array.isArray(data.sources) ? data.sources : [];
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const stepRows = steps.map((s) =>
      `<div class="wf-receipt-step"><span>${esc(s.name)}</span><span class="wf-graph-model-tag">${s.model ? esc(s.model) : "-"}</span></div>`
    ).join("");
    document.getElementById("wfReceiptBody").innerHTML = `
      <div class="wf-receipt-row"><span>Workflow</span><span>${esc(wf.name)}</span></div>
      <div class="wf-receipt-row"><span>Status</span><span class="wf-status-done">Completed</span></div>
      <div class="wf-receipt-steps">${stepRows}</div>
      <div class="wf-receipt-row"><span>Sources</span><span>${sources.length}</span></div>
      <div class="wf-receipt-row"><span>Charged</span><span class="wf-receipt-price">${esc(wf.price)} USDC</span></div>
      ${data.releaseTx
      ? `<div class="wf-receipt-row"><span>Invoice memo tx</span><a class="wf-link wf-mono" href="${esc((WF_CONFIG.explorerBase || "https://testnet.arcscan.app") + "/tx/" + data.releaseTx)}" target="_blank" rel="noopener">${esc(data.releaseTx.slice(0, 10) + "…" + data.releaseTx.slice(-8))}</a></div>`
      : `<div class="wf-receipt-row"><span>Settlement</span><span class="wf-muted">Pending on-chain (Arc Testnet)</span></div>`}`;

    if (quotaEl && data.remaining != null) {
      quotaEl.hidden = false;
      quotaEl.textContent = `${data.remaining} runs remaining today (daily limit). Resets 00:00 UTC.`;
    }
  }
}

// ─── Run History Page ─────────────────────────────────────────────────────────

function renderRuns() {
  const header = `
    <header class="topbar">
      <div>
        <p class="eyebrow">Workflows</p>
        <h1>Run History</h1>
      </div>
    </header>`;

  if (!RUN_HISTORY.length) {
    return header + `
    <div class="wf-explore-body">
      <div class="wf-settings-placeholder">
        <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
        <h3>No runs yet</h3>
        <p>Open a workflow and run it to see your history here.</p>
      </div>
    </div>`;
  }

  const rows = RUN_HISTORY.map((r, idx) => {
    const tx = r.releaseTx
      ? `<a class="wf-link wf-mono" href="${esc((WF_CONFIG.explorerBase || "https://testnet.arcscan.app") + "/tx/" + r.releaseTx)}" target="_blank" rel="noopener">${esc(r.releaseTx.slice(0, 8) + "..." + r.releaseTx.slice(-6))}</a>`
      : `<span class="wf-muted">-</span>`;
    const viewBtn = r.output
      ? `<button class="wf-receipt-btn" type="button" data-idx="${idx}">View</button>`
      : `<button class="wf-receipt-btn" type="button" disabled style="opacity:0.4;cursor:default">View</button>`;
    return `<tr>
      <td class="wf-mono" style="font-size:12px">${esc(r.id)}</td>
      <td><a href="/workflows/${esc(r.slug)}" class="wf-link" data-nav="/workflows/${esc(r.slug)}">${esc(r.workflow)}</a></td>
      <td>${tx}</td>
      <td class="wf-num">${esc(r.charged)}</td>
      <td><span class="wf-run-status ${r.status === "completed" ? "wf-status-done" : "wf-status-failed"}">${r.status}</span></td>
      <td class="wf-muted" style="font-size:12px">${esc(r.at)}</td>
      <td>${viewBtn}</td>
    </tr>`;
  }).join("");

  return header + `
    <div class="wf-explore-body">
      <div class="wf-table-wrap">
        <table class="wf-runs-table">
          <thead><tr>
            <th>Run ID</th><th>Workflow</th><th>Transaction</th>
            <th class="wf-num">Charged (USDC)</th><th>Status</th><th>Date</th><th></th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

function bindRuns() {
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });
  document.querySelectorAll(".wf-receipt-btn[data-idx]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const run = RUN_HISTORY[parseInt(btn.dataset.idx, 10)];
      if (run && run.output) openResultModal(run.output, run.slug);
    });
  });
}

// ─── Settings Page ────────────────────────────────────────────────────────────

function renderSettings() {
  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">Workflows</p>
        <h1>Workflow Settings</h1>
      </div>
    </header>
    <div class="wf-explore-body">
      <div class="wf-settings-placeholder">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h12M6 16h12M9 5v6M15 13v6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>
        <h3>Workflow Settings</h3>
        <p>Billing defaults, model preferences, and API settings will appear here.</p>
        <span class="soon-badge" style="margin-top:8px">Coming soon</span>
      </div>
    </div>`;
}

// ─── 404 ──────────────────────────────────────────────────────────────────────

function render404() {
  return `<div class="wf-404"><h2>Workflow not found</h2><a href="/workflows" data-nav="/workflows" class="wf-btn-secondary">Back to Explore</a></div>`;
}

// ─── Sidebar Toggle ───────────────────────────────────────────────────────────

function bindSidebarToggles() {
  document.querySelectorAll(".nav-group-toggle").forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const group = toggle.closest(".nav-group");
      if (!group) return;
      const open = group.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

window.addEventListener("popstate", () => render());

window.addEventListener("DOMContentLoaded", () => {
  bindSidebarToggles();
  fetch("/api/config")
    .then((r) => r.json())
    .then((c) => { WF_CONFIG = c || {}; WF_RUNNER_ENABLED = Boolean(c && c.workflowRunnerEnabled); })
    .catch(() => {})
    .finally(() => render());

  // Delegate all data-nav clicks (including dynamically rendered content)
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-nav]");
    if (!el) return;
    e.preventDefault();
    navigate(el.dataset.nav);
  });

  // Intercept sidebar nav-item anchor clicks so they use SPA navigation instead
  // of a full page reload (which would reset the in-memory RUN_HISTORY).
  document.addEventListener("click", (e) => {
    const link = e.target.closest(".nav-item[href]");
    if (!link) return;
    const href = link.getAttribute("href");
    if (!href || !href.startsWith("/workflows")) return;
    e.preventDefault();
    navigate(href);
  });
});
