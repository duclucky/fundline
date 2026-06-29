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
const tavily = require("./tavily-client");

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
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", RESEARCH: "deepseek-r1", CODE: "deepseek-v3.2", FORMATTER: "gpt-4o-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", RESEARCH: "deepseek-r1", CODE: "kimi-k2.7-code", FORMATTER: "gpt-4o-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6", RESEARCH: "deepseek-r1", CODE: "claude-sonnet-4-6", FORMATTER: "gpt-4o-mini" },
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
  "client-research": "Research Notion Inc for a partnership outreach call. We want to integrate our USDC invoicing product with their API.",
  "market-pain-research": "Research the pain points of solo freelancers getting paid by international clients. Focus on payment delays, fees, and trust. Audience: freelancers new to crypto.",
  "code-review": "Review this Node.js login handler:\n\nfunction login(req, res) {\n  const { email, password } = req.body;\n  const user = db.users.find(u => u.email === email);\n  if (!user) return res.json({ error: 'no user' });\n  if (user.password === password) {\n    const token = jwt.sign({ id: user.id }, 'secret123');\n    res.cookie('token', token);\n    return res.json({ ok: true });\n  }\n  return res.json({ error: 'wrong password' });\n}",
  "upwork-proposal": "Job post: Need an experienced React developer to rebuild our slow checkout flow into a fast one-page checkout. Budget $3-5k, start ASAP. My profile: 6 years React, shipped 3 e-commerce checkouts that cut abandonment by 20%+. Portfolio: react-dev.example.com. Tone: friendly and confident.",
  "rfp-proposal": "RFP: Build an internal analytics dashboard with 4 data-source integrations (Stripe, HubSpot, Postgres, Google Analytics), role-based access, and SSO. Deliver in 10 weeks. We prefer milestone-based pricing. Our capability: full-stack team of 3, strong in React and Node.",
  "cold-outreach": "Prospect: heads of marketing at Series A B2B SaaS startups. Offer: a 2-week landing-page CRO sprint that lifts conversion. Tone: direct, no fluff. CTA: book a 15-minute call.",
  "follow-up-nurture": "I sent a $12k proposal to a client two weeks ago and they have gone quiet after saying they were interested. I want to re-engage without being pushy and find out if budget or timing is the blocker. Friendly, professional tone.",
  "timeline-from-sow": "SOW: Build a mobile app MVP with user auth, profiles, a content feed, and in-app payments. Team size: 2 developers. Deadline: 10 weeks. Work style: weekly sprints.",
  "handover-report": "Completed work for client Acme Corp: redesigned and shipped 8 marketing pages, set up a CMS, and configured analytics. Staging link: staging.acme.example.com. Remaining: final DNS cutover (client action). Project: Acme website redesign.",
  "seo-content-brief": "Keyword: 'get paid in USDC'. Region: US. Language: English. Content type: how-to guide for freelancers new to crypto. Competitor notes: most ranking pages are exchange blogs.",
  "seo-audit": "Audit the homepage at https://example-saas.com. Focus on technical SEO and content gaps for a B2B SaaS. Standard depth. (No HTML pasted.)",
  "keyword-strategy": "Keyword list: usdc payments, crypto invoicing, get paid in stablecoin, freelance crypto payments, usdc wallet, stablecoin payroll, accept usdc, crypto invoice template, usdc vs paypal fees, send usdc to bank.",
  "pr-diff-review": "PR description: Add a coupon code field to checkout that applies a percentage discount before tax.\n\nDiff:\n--- a/checkout.js\n+++ b/checkout.js\n@@\n-  const total = subtotal + tax;\n+  let total = subtotal + tax;\n+  if (req.body.coupon) {\n+    const pct = COUPONS[req.body.coupon];\n+    total = total - (total * pct);\n+  }\n   return total;",
  "x-thread-writer": "Write a thread about why most developers underestimate the cost of building authentication from scratch, and when to use a provider instead.",
  "newsletter-writer": "Newsletter issue for freelancers about getting paid faster with USDC: why it helps, how to start, and one practical tip. Friendly, practical tone.",
  "linkedin-post": "A post about a lesson I learned shipping my first SaaS: I waited too long to charge, and adding a price taught me what customers actually valued. Audience: indie founders.",
  "crypto-research": "Research report on Arc by Circle (an EVM chain where USDC is the native gas token). Focus on the USDC-as-gas model, tech, and risks.",
  "tokenomics-analyzer": "Token: 1,000,000,000 max supply. Allocation: 20% team (1-year cliff, 4-year vest), 15% investors (1-year cliff, 3-year vest), 40% community/ecosystem, 15% treasury, 10% liquidity. Utility: gas fees and staking rewards. Emissions taper over 4 years.",
  "whitepaper-summary": "Summarize this whitepaper for a busy investor:\n\nGridCompute is a decentralized compute marketplace that matches idle consumer GPUs with AI training and inference workloads. Providers stake the GRID token and earn fees for verified compute. A proof-of-compute system validates work before on-chain settlement. The GRID token is used to pay for compute and to reward providers; a portion of fees is burned. The team claims 10x lower cost than centralized cloud GPUs.",
  "narrative-scan": "Scan the on-chain AI agents narrative: which projects are building, the main trends and catalysts, and the key risks. Not financial advice.",
  "competitor-analysis": "Analyze competitors for a USDC invoicing tool aimed at freelancers. Known competitors: Request Finance, Coinbase Commerce, traditional tools like PayPal and Wise. Our edge: instant USDC settlement with a simple, fiat-grade UX.",
  "gtm-plan": "Go-to-market plan for a USDC payroll tool aimed at remote-first startups (10-50 staff) that pay international contractors. Goal: 50 paying teams in 6 months.",
  "lean-canvas": "Business idea: a tool that automatically generates and sends a USDC invoice to a client the moment a project milestone is marked done in the freelancer's project board. Target: solo freelancers who chase payments.",
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
  const tavilyKey = process.env.TAVILY_API_KEY;
  const searchWeb = tavilyKey
    ? (q) => tavily.searchTavily({ apiKey: tavilyKey }, { query: q, maxResults: 5 }).then((r) => r.results)
    : null;
  const result = await engine.runWorkflowGraph({
    graph, tierModels, input, mode: "search", groupRatio: RATIO, searchWeb,
    today: new Date().toISOString().slice(0, 10), callModel,
    onProgress: (e) => { if (e.status === "running") process.stdout.write(`  - ${e.step} ...\n`); },
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  // Map recorded usages to the nodes that actually called the model. Retrieval
  // nodes go to Tavily (when a key is set), so they make no model call and are
  // excluded here; their cost is added separately below.
  const usedTavily = Boolean(searchWeb);
  const modelNodes = graph.nodes.filter((n) => n.build && n.alias && !(n.retrieval && usedTavily));
  const tavilyMicros = (result.steps || []).filter((s) => s.model === "tavily").reduce((a, s) => a + (s.costMicros || 0), 0);
  console.log(`\n=== Per-node (real tokens) ===`);
  const perNode = [];
  modelNodes.forEach((n, i) => {
    const u = usages[i] ? usages[i].usage : { prompt_tokens: 0, completion_tokens: 0 };
    perNode.push({ alias: n.alias, name: n.name, pt: u.prompt_tokens || 0, ct: u.completion_tokens || 0 });
    console.log(`  ${n.name.padEnd(28)} alias=${String(n.alias).padEnd(9)} in=${String(u.prompt_tokens||0).padStart(5)} out=${String(u.completion_tokens||0).padStart(5)}`);
  });

  console.log(`\n=== Cost + suggested price per tier (group ratio ${RATIO}) ===`);
  const prices = {};
  if (tavilyMicros) console.log(`  (web search: $${(tavilyMicros / 1e6).toFixed(4)} added to every tier)`);
  for (const t of ["normal", "plus", "pro"]) {
    let micros = tavilyMicros;
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
