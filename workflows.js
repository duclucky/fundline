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
    price: "0.05",
    version: "v1.0.1",
    runtime: "~60s",
    modelCount: 3,
    calls: 893,
    inputLabel: "Company or person name",
    inputHint: "Enter the company name and context (e.g. 'sales call', 'investor outreach', 'partnership').",
    outputHint: "Structured research brief with background, signals, and talking points.",
    limits: { inputChars: 500, outputWords: 1200 },
    steps: [
      { name: "Research Planner", model: "gpt-4.1-mini", purpose: "Identify what signals to look for based on research intent.", tokens: "~150" },
      { name: "Info Synthesizer", model: "claude-3.5-sonnet", purpose: "Compile and structure all available public information.", tokens: "~1200" },
      { name: "Brief Writer", model: "claude-3-haiku", purpose: "Format into a concise, scannable research brief.", tokens: "~600" },
    ],
    pricing: [
      { step: "Research Planner", model: "gpt-4.1-mini", inputTokens: 150, outputTokens: 200, cost: "0.0003" },
      { step: "Info Synthesizer", model: "claude-3.5-sonnet", inputTokens: 350, outputTokens: 900, cost: "0.036" },
      { step: "Brief Writer", model: "claude-3-haiku", inputTokens: 900, outputTokens: 500, cost: "0.014" },
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

const MOCK_RUNS = [
  { id: "wfr_a1b2c3d4", workflow: "Proposal Writer", slug: "proposal-writer", version: "v1.2.0", models: "gpt-4.1-mini, claude-3.5-sonnet", cost: "0.0403", status: "completed", at: "2026-06-28 14:32" },
  { id: "wfr_e5f6g7h8", workflow: "X Thread Writer", slug: "x-thread-writer", version: "v2.1.0", models: "claude-3-haiku, claude-3.5-sonnet", cost: "0.0201", status: "completed", at: "2026-06-28 13:10" },
  { id: "wfr_i9j0k1l2", workflow: "Code Review", slug: "code-review", version: "v1.3.0", models: "gpt-4.1-mini, claude-3.5-sonnet", cost: "0.0296", status: "completed", at: "2026-06-28 11:55" },
  { id: "wfr_m3n4o5p6", workflow: "Client Research", slug: "client-research", version: "v1.0.1", models: "gpt-4.1-mini, claude-3.5-sonnet", cost: "0.0503", status: "completed", at: "2026-06-27 17:20" },
  { id: "wfr_q7r8s9t0", workflow: "SEO Article", slug: "seo-article", version: "v1.1.0", models: "claude-3-haiku, claude-3.5-sonnet", cost: "0.0597", status: "failed", at: "2026-06-27 09:44" },
  { id: "wfr_u1v2w3x4", workflow: "Crypto Research Report", slug: "crypto-research-report", version: "v1.0.0", models: "gpt-4.1-mini, claude-3.5-sonnet", cost: "0.0694", status: "completed", at: "2026-06-26 21:18" },
];

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
    document.title = "Workflow Runs - Fundline";
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
            ${["Overview","Workflow Steps","Pricing","Example Output","API"].map((t, i) =>
              `<button class="wf-tab${i===0?" is-active":""}" role="tab" data-tab="${t}" type="button">${t}</button>`
            ).join("")}
          </div>
          <div class="wf-tab-panels">
            ${renderTabOverview(wf)}
            ${renderTabSteps(wf)}
            ${renderTabPricing(wf)}
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

function renderTabSteps(wf) {
  const nodes = wf.steps.map((s, i) => `
    <div class="wf-graph-node-wrap">
      ${i > 0 ? '<div class="wf-graph-connector"></div>' : ""}
      <div class="wf-graph-node">
        <div class="wf-graph-badge">${i + 1}</div>
        <div class="wf-graph-node-body">
          <div class="wf-graph-node-name">${esc(s.name)}</div>
          <span class="wf-graph-model-tag">${esc(s.model)}</span>
          <div class="wf-graph-node-purpose">${esc(s.purpose)}</div>
        </div>
      </div>
    </div>`).join("");

  const steps = wf.steps.map((s, i) => `
    <div class="wf-step-item">
      <div class="wf-step-num">Step ${i + 1}</div>
      <div class="wf-step-name">${esc(s.name)}</div>
      <div class="wf-step-row"><span class="wf-step-key">Model</span><span class="wf-graph-model-tag">${esc(s.model)}</span></div>
      <div class="wf-step-row"><span class="wf-step-key">Purpose</span><span class="wf-muted">${esc(s.purpose)}</span></div>
      <div class="wf-step-row"><span class="wf-step-key">Est. tokens</span><span class="wf-muted">${esc(s.tokens)}</span></div>
    </div>`).join("");

  return `<div class="wf-tab-panel" data-panel="Workflow Steps">
    <div class="wf-steps-split">
      <div class="wf-graph-scroll">
        <div class="wf-graph">
          <div class="wf-graph-node-wrap">
            <div class="wf-graph-node wf-graph-endpoint">
              <div class="wf-graph-badge wf-graph-badge-io">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3 9H3l9-13z M12 22v-8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="wf-graph-node-body">
                <div class="wf-graph-node-name">User Input</div>
                <div class="wf-graph-node-purpose wf-muted">Your prompt or instructions</div>
              </div>
            </div>
          </div>
          ${nodes}
          <div class="wf-graph-node-wrap">
            <div class="wf-graph-connector"></div>
            <div class="wf-graph-node wf-graph-endpoint wf-graph-endpoint-out">
              <div class="wf-graph-badge wf-graph-badge-io">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22l-3-9h18L12 22z M12 2v8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
              </div>
              <div class="wf-graph-node-body">
                <div class="wf-graph-node-name">Final Output</div>
                <div class="wf-graph-node-purpose wf-muted">Ready to use result</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div class="wf-step-list">${steps}</div>
    </div>
  </div>`;
}

function renderTabPricing(wf) {
  let total = 0;
  const rows = wf.pricing.map((p) => {
    total += parseFloat(p.cost);
    return `<tr>
      <td>${esc(p.step)}</td>
      <td><span class="wf-graph-model-tag">${esc(p.model)}</span></td>
      <td class="wf-num">${p.inputTokens.toLocaleString()}</td>
      <td class="wf-num">${p.outputTokens.toLocaleString()}</td>
      <td class="wf-num">~$${p.cost}</td>
    </tr>`;
  }).join("");
  return `<div class="wf-tab-panel" data-panel="Pricing">
    <p class="wf-muted" style="margin-bottom:20px">Pricing below reflects typical usage. Actual cost depends on input length. You are charged the fixed rate of <strong>${esc(wf.price)} USDC per call</strong>.</p>
    <div class="wf-table-wrap">
      <table class="wf-pricing-table">
        <thead><tr><th>Step</th><th>Model</th><th class="wf-num">In tokens</th><th class="wf-num">Out tokens</th><th class="wf-num">Model cost</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4"><strong>Total model cost</strong></td><td class="wf-num"><strong>~$${total.toFixed(4)}</strong></td></tr></tfoot>
      </table>
    </div>
    <div class="wf-pricing-note">
      <strong>You pay:</strong> ${esc(wf.price)} USDC flat per call. Platform fee and model cost are included.
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
  return `
    <div class="wf-run-header">
      <h3>Run this workflow</h3>
      <div class="wf-run-price-tag">${esc(wf.price)} USDC / call</div>
    </div>
    <div class="wf-run-modes" role="group" aria-label="Input mode">
      <button class="wf-run-mode-btn is-active" data-mode="own" type="button">Write my own</button>
      <button class="wf-run-mode-btn" data-mode="build" type="button">Build for me</button>
    </div>

    <div id="wfModeOwn" class="wf-run-mode-panel">
      <label class="wf-run-label" for="wfOwnPrompt">${esc(wf.inputLabel)}</label>
      <p class="wf-run-hint wf-muted">${esc(wf.inputHint)}</p>
      <textarea id="wfOwnPrompt" class="wf-run-textarea" rows="5" placeholder="Enter your prompt..."></textarea>
    </div>

    <div id="wfModeBuild" class="wf-run-mode-panel" hidden>
      <label class="wf-run-label" for="wfBuildDesc">Describe what you want</label>
      <textarea id="wfBuildDesc" class="wf-run-textarea" rows="3" placeholder="e.g. A proposal for redesigning a restaurant website..."></textarea>
      <button class="wf-btn-secondary" id="wfGenPrompt" type="button">Generate professional prompt</button>
      <div id="wfGenResult" hidden>
        <label class="wf-run-label" for="wfGenPromptEdit" style="margin-top:14px">Generated prompt (editable)</label>
        <textarea id="wfGenPromptEdit" class="wf-run-textarea" rows="5"></textarea>
      </div>
    </div>

    <button class="wf-btn-run" id="wfRunBtn" type="button" data-slug="${esc(slug)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
      Run Workflow
    </button>

    <div id="wfRunState" hidden>
      <div class="wf-run-progress" id="wfRunProgress"></div>
    </div>
    <div id="wfRunResult" hidden>
      <div class="wf-run-result-label">Result</div>
      <pre class="wf-run-result-body" id="wfRunResultBody"></pre>
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

  // Mode toggle
  const panel = document.getElementById("wfRunPanel");
  panel.querySelector(".wf-run-modes").addEventListener("click", (e) => {
    const btn = e.target.closest(".wf-run-mode-btn");
    if (!btn) return;
    panel.querySelectorAll(".wf-run-mode-btn").forEach((b) => b.classList.remove("is-active"));
    btn.classList.add("is-active");
    document.getElementById("wfModeOwn").hidden = btn.dataset.mode !== "own";
    document.getElementById("wfModeBuild").hidden = btn.dataset.mode !== "build";
  });

  // Generate prompt
  document.getElementById("wfGenPrompt").addEventListener("click", () => {
    const desc = document.getElementById("wfBuildDesc").value.trim();
    const btn = document.getElementById("wfGenPrompt");
    btn.disabled = true;
    btn.textContent = "Generating...";
    setTimeout(() => {
      const generated = desc
        ? "You are a professional " + wf.category.toLowerCase() + " specialist.\n\nTask: " + desc + "\n\nRequirements:\n- Be thorough and professional\n- Use industry-standard formatting\n- Include all necessary sections\n- Optimize for clarity and impact"
        : wf.examplePrompt;
      const edit = document.getElementById("wfGenPromptEdit");
      edit.value = generated;
      document.getElementById("wfGenResult").hidden = false;
      btn.disabled = false;
      btn.textContent = "Regenerate prompt";
    }, 1200);
  });

  // Run workflow
  document.getElementById("wfRunBtn").addEventListener("click", () => {
    const mode = panel.querySelector(".wf-run-mode-btn.is-active").dataset.mode;
    let prompt = "";
    if (mode === "own") {
      prompt = document.getElementById("wfOwnPrompt").value.trim();
    } else {
      const edit = document.getElementById("wfGenPromptEdit");
      prompt = edit.value.trim() || document.getElementById("wfBuildDesc").value.trim();
    }
    if (!prompt) {
      const ta = mode === "own" ? document.getElementById("wfOwnPrompt") : document.getElementById("wfBuildDesc");
      ta.focus();
      ta.style.outline = "1.5px solid var(--red)";
      setTimeout(() => ta.style.outline = "", 2000);
      return;
    }
    runWorkflow(slug, wf, prompt);
  });

  // Back navigation
  document.querySelectorAll("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      navigate(el.dataset.nav);
    });
  });
}

function runWorkflow(slug, wf, prompt) {
  const runBtn = document.getElementById("wfRunBtn");
  const stateEl = document.getElementById("wfRunState");
  const resultEl = document.getElementById("wfRunResult");
  const receiptEl = document.getElementById("wfRunReceipt");
  const progressEl = document.getElementById("wfRunProgress");

  runBtn.disabled = true;
  stateEl.hidden = false;
  resultEl.hidden = true;
  receiptEl.hidden = true;
  progressEl.innerHTML = "";

  const steps = wf.steps;
  let i = 0;

  function addStep(done) {
    const item = document.createElement("div");
    item.className = "wf-progress-step";
    if (done) {
      item.classList.add("is-done");
      item.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg> ${esc(steps[i].name)} <span class="wf-muted">(${esc(steps[i].model)})</span>`;
    } else {
      item.innerHTML = `<span class="wf-progress-spinner"></span> ${esc(steps[i].name)} <span class="wf-muted">(${esc(steps[i].model)})</span>`;
    }
    progressEl.appendChild(item);
  }

  function tick() {
    if (i >= steps.length) {
      const runId = randId();
      setTimeout(() => showResult(wf, runId), 400);
      return;
    }
    addStep(false);
    const delay = 600 + Math.random() * 700;
    setTimeout(() => {
      progressEl.lastChild.remove();
      addStep(true);
      i++;
      tick();
    }, delay);
  }

  tick();

  function showResult(wf, runId) {
    resultEl.hidden = false;
    document.getElementById("wfRunResultBody").textContent = wf.exampleOutput;

    receiptEl.hidden = false;
    const tokenIn = wf.pricing.reduce((s, p) => s + p.inputTokens, 0);
    const tokenOut = wf.pricing.reduce((s, p) => s + p.outputTokens, 0);
    const stepRows = wf.pricing.map((p) =>
      `<div class="wf-receipt-step"><span>${esc(p.step)}</span><span class="wf-muted">${p.inputTokens}in / ${p.outputTokens}out</span><span class="wf-graph-model-tag">${esc(p.model)}</span></div>`
    ).join("");
    document.getElementById("wfReceiptBody").innerHTML = `
      <div class="wf-receipt-row"><span>Receipt ID</span><span class="wf-mono">${runId}</span></div>
      <div class="wf-receipt-row"><span>Workflow</span><span>${esc(wf.name)}</span></div>
      <div class="wf-receipt-row"><span>Version</span><span>${esc(wf.version)}</span></div>
      <div class="wf-receipt-row"><span>Status</span><span class="wf-status-done">Completed</span></div>
      <div class="wf-receipt-steps">${stepRows}</div>
      <div class="wf-receipt-row"><span>Total tokens</span><span>${tokenIn.toLocaleString()} in / ${tokenOut.toLocaleString()} out</span></div>
      <div class="wf-receipt-row wf-receipt-total"><span>Charged</span><span class="wf-receipt-price">${esc(wf.price)} USDC</span></div>
      <div class="wf-receipt-row"><span>Settlement</span><span class="wf-muted">Pending on-chain (Arc Testnet)</span></div>`;

    runBtn.disabled = false;
    runBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg> Run again`;
  }
}

// ─── Runs Page ────────────────────────────────────────────────────────────────

function renderRuns() {
  const rows = MOCK_RUNS.map((r) => `
    <tr>
      <td class="wf-mono">${esc(r.id)}</td>
      <td><a href="/workflows/${esc(r.slug)}" class="wf-link" data-nav="/workflows/${esc(r.slug)}">${esc(r.workflow)}</a></td>
      <td class="wf-muted">${esc(r.version)}</td>
      <td class="wf-muted" style="font-size:12px">${esc(r.models)}</td>
      <td class="wf-num wf-price-val">${esc(r.cost)}</td>
      <td><span class="wf-run-status ${r.status === "completed" ? "wf-status-done" : "wf-status-failed"}">${r.status}</span></td>
      <td class="wf-muted">${esc(r.at)}</td>
      <td><button class="wf-receipt-btn" type="button" data-id="${esc(r.id)}">View</button></td>
    </tr>`).join("");

  return `
    <header class="topbar">
      <div>
        <p class="eyebrow">Workflows</p>
        <h1>Workflow Runs</h1>
      </div>
    </header>
    <div class="wf-explore-body">
      <div class="wf-table-wrap">
        <table class="wf-runs-table">
          <thead><tr>
            <th>Run ID</th><th>Workflow</th><th>Version</th><th>Models</th>
            <th class="wf-num">Cost (USDC)</th><th>Status</th><th>Date</th><th></th>
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
  document.querySelectorAll(".wf-receipt-btn").forEach((btn) => {
    btn.addEventListener("click", () => alert("Receipt " + btn.dataset.id + ":\nFull receipt view coming soon."));
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
  render();

  // Delegate all data-nav clicks (including dynamically rendered content)
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-nav]");
    if (!el) return;
    e.preventDefault();
    navigate(el.dataset.nav);
  });
});
