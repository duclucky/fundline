"use strict";

// ─── Mock Data ────────────────────────────────────────────────────────────────

const WORKFLOWS = {
  "client-research": {
    name: "Client Research",
    description: "Deep-dive research brief on a company or person before a sales call, pitch, or outreach.",
    longDesc: "Aggregates public information about a target company or individual and synthesizes it into a structured brief with background, signals, and recommended angles.",
    category: "Freelance",
    live: true,
    usesRetrieval: true,
    price: "0.03",
    version: "v1.0.1",
    runtime: "~60s",
    modelCount: 2,
    calls: 893,
    inputLabel: "Company or person name",
    inputHint: "Enter the company name and context (e.g. 'sales call', 'investor outreach', 'partnership').",
    outputHint: "Structured research report with background, signals, and cited sources.",
    limits: { inputChars: 500, outputWords: 1500 },
    // Default steps = normal tier (used for initial canvas render before JS applies a tier).
    steps: [
      { serverKey: "role_analysis", name: "Role analysis", model: "gpt-4o-mini", purpose: "Pick the right expert persona for the research topic.", tokens: "~50" },
      { serverKey: "research_plan", name: "Research plan", model: "gpt-4o-mini", purpose: "Break the request into focused search angles.", tokens: "~60" },
      { serverKey: "web_research", name: "Web research", model: "deepseek-r1-searching", purpose: "Search the web and gather findings with citations.", tokens: "~1500" },
      { serverKey: "report_writer", name: "Report writer", model: "deepseek-v3", purpose: "Write a structured, cited research report.", tokens: "~1500" },
    ],
    tiers: {
      normal: {
        price: "0.03",
        steps: [
          { serverKey: "role_analysis", name: "Role analysis", model: "gpt-4o-mini", purpose: "Pick the right expert persona for the research topic.", tokens: "~50" },
          { serverKey: "research_plan", name: "Research plan", model: "gpt-4o-mini", purpose: "Break the request into focused search angles.", tokens: "~60" },
          { serverKey: "web_research", name: "Web research", model: "deepseek-r1-searching", purpose: "Search the web and gather findings with citations.", tokens: "~1500" },
          { serverKey: "report_writer", name: "Report writer", model: "deepseek-v3", purpose: "Write a structured, cited research report.", tokens: "~1500" },
        ],
      },
      plus: {
        price: "0.05",
        steps: [
          { serverKey: "role_analysis", name: "Role analysis", model: "gpt-4o-mini", purpose: "Pick the right expert persona for the research topic.", tokens: "~50" },
          { serverKey: "research_plan", name: "Research plan", model: "gpt-4o-mini", purpose: "Break the request into focused search angles.", tokens: "~60" },
          { serverKey: "web_research", name: "Web research", model: "grok-3-deepsearch", purpose: "Search the web and gather findings with citations.", tokens: "~1500" },
          { serverKey: "report_writer", name: "Report writer", model: "deepseek-v3.2", purpose: "Write a structured, cited research report.", tokens: "~1500" },
        ],
      },
      pro: {
        price: "0.10",
        steps: [
          { serverKey: "role_analysis", name: "Role analysis", model: "gpt-4o-mini", purpose: "Pick the right expert persona for the research topic.", tokens: "~50" },
          { serverKey: "research_plan", name: "Research plan", model: "gpt-4o-mini", purpose: "Break the request into focused search angles.", tokens: "~60" },
          { serverKey: "web_research", name: "Web research", model: "grok-4", purpose: "Search the web and gather findings with citations.", tokens: "~1500" },
          { serverKey: "report_writer", name: "Report writer", model: "claude-sonnet-4-6", purpose: "Write a structured, cited research report.", tokens: "~1500" },
        ],
      },
    },
    pricing: [
      { step: "Role analysis", model: "gpt-4o-mini", inputTokens: 50, outputTokens: 20, cost: "0.00002" },
      { step: "Research plan", model: "gpt-4o-mini", inputTokens: 60, outputTokens: 40, cost: "0.00003" },
      { step: "Web research", model: "grok-3-deepsearch", inputTokens: 800, outputTokens: 1200, cost: "0.025" },
      { step: "Report writer", model: "deepseek-v3.2", inputTokens: 1200, outputTokens: 1200, cost: "0.0015" },
    ],
    examplePrompt: "Research Notion Inc for a partnership outreach call. We want to integrate our product with their API.",
    exampleOutput: "# Research Brief: Notion Inc\n\n**Intent:** Partnership outreach - API integration\n\n## Overview\n\nNotion is a productivity platform used by 35M+ users globally. Headquartered in San Francisco. Last round: Series C at $275M (2021).\n\n## Product Signals\n\n- Notion API launched 2021, now at v2. Active developer ecosystem.\n- Recent focus: Notion AI and enterprise SSO.\n- 3 open API positions on their jobs page.\n\n## Talking Points\n\n1. Reference their active API ecosystem as reason for outreach.\n2. Lead with use-case first: show what your integration solves for Notion users.\n3. Avoid cold pitch framing - lean into partnership benefits.\n\n## Recommended Angle\n\nEmail Head of Partnerships with a 3-sentence pitch, link to your integration demo, and a calendar link.",
  },
};

// ─── Live workflow catalog (graph-driven, server-backed) ───────────────────
// Each entry below is built from a compact spec. The per-tier model labels mirror
// server.js WORKFLOW_TIER_MODELS so the canvas shows the model each node uses on
// the selected tier. Node `key` MUST match the node id in workflow-defs.js so the
// SSE progress animation lines up. Display only; the server runs the real chain.
const WF_TIER_MODELS = {
  normal: { FAST: "gpt-4o-mini", STRONG: "deepseek-v3.2", RESEARCH: "deepseek-r1-searching", CODE: "deepseek-v3.2", FORMATTER: "gpt-4o-mini" },
  plus: { FAST: "gpt-4o-mini", STRONG: "gpt-4.1-mini", RESEARCH: "grok-3-deepsearch", CODE: "kimi-k2.7-code", FORMATTER: "gpt-4o-mini" },
  pro: { FAST: "gpt-4.1-mini", STRONG: "claude-sonnet-4-6", RESEARCH: "grok-4", CODE: "claude-sonnet-4-6", FORMATTER: "gpt-4o-mini" },
};
const WF_PRICE_BANDS = {
  light: { normal: "0.03", plus: "0.05", pro: "0.10" },
  medium: { normal: "0.04", plus: "0.06", pro: "0.12" },
  heavy: { normal: "0.05", plus: "0.08", pro: "0.15" },
};
function wfTierSteps(specs, tier) {
  return specs.map((s) => ({ serverKey: s.key, name: s.name, model: WF_TIER_MODELS[tier][s.alias], purpose: s.purpose, tokens: s.tokens || "~" }));
}
function makeWorkflow(meta, specs) {
  const prices = WF_PRICE_BANDS[meta.band];
  const tiers = {
    normal: { price: prices.normal, steps: wfTierSteps(specs, "normal") },
    plus: { price: prices.plus, steps: wfTierSteps(specs, "plus") },
    pro: { price: prices.pro, steps: wfTierSteps(specs, "pro") },
  };
  const distinct = new Set(specs.map((s) => WF_TIER_MODELS.normal[s.alias]));
  return {
    name: meta.name, description: meta.description, longDesc: meta.longDesc,
    category: meta.category, live: true,
    usesRetrieval: specs.some((s) => s.alias === "RESEARCH"),
    price: prices.normal, version: "v1.0.0", runtime: meta.runtime || "~60s",
    modelCount: distinct.size, calls: meta.calls || 0,
    inputLabel: meta.inputLabel, inputHint: meta.inputHint, outputHint: meta.outputHint,
    limits: meta.limits || { inputChars: 6000, outputWords: 2000 },
    steps: tiers.normal.steps, tiers,
    pricing: tiers.normal.steps.map((s) => ({ step: s.name, model: s.model, inputTokens: 0, outputTokens: 0, cost: "" })),
    examplePrompt: meta.examplePrompt || "",
    exampleOutput: meta.exampleOutput || "",
  };
}

const WF_CATALOG = {
  "call-recap": {
    meta: {
      name: "Client Call Recap & Action Plan", category: "Client Communication", band: "light", runtime: "~50s",
      description: "Turn a client call transcript into a recap, decisions, action items, risks, and a follow-up email.",
      longDesc: "Cleans a raw call transcript, summarizes it, extracts confirmed decisions and owned action items, flags risks and blockers, drafts a follow-up email, and suggests what could be invoiced.",
      inputLabel: "Call transcript or notes",
      inputHint: "Paste the call transcript or your notes. Include who said what if you can.",
      outputHint: "Recap with decisions, action items, risks, suggested billables, and a ready-to-send follow-up email.",
      limits: { inputChars: 12000, outputWords: 1500 },
      examplePrompt: "Transcript of a kickoff call with Acme Corp about a website redesign. They want it live before their Q3 launch and asked about ongoing maintenance.",
      exampleOutput: "# Call Recap: Acme Corp Kickoff\n\n## Summary\n- Redesign scoped for the marketing site, live before Q3 launch.\n- Client wants a maintenance retainer after launch.\n\n## Decisions\n- Proceed with a 6-week build.\n- Monthly retainer to be quoted separately.\n\n## Action Items\n| Task | Owner | Deadline | Priority |\n|---|---|---|---|\n| Send proposal + SOW | You | Fri | High |\n| Share brand assets | Client | Mon | High |\n\n## Risks & Blockers\n- Q3 deadline is tight; brand assets are a dependency.\n\n## Suggested Billables\n- Discovery workshop, design, build, maintenance retainer.\n\n## Follow-up Email\nHi Sam, great speaking today. To recap...",
    },
    specs: [
      { key: "transcript_cleaner", name: "Transcript Cleaner", alias: "FAST", purpose: "Clean the transcript and label speakers.", tokens: "~600" },
      { key: "meeting_summary", name: "Meeting Summarizer", alias: "STRONG", purpose: "Summarize the call in bullet points.", tokens: "~400" },
      { key: "decision_extractor", name: "Decision Extractor", alias: "FAST", purpose: "Extract the decisions that were agreed.", tokens: "~300" },
      { key: "action_items", name: "Action Item Extractor", alias: "FAST", purpose: "Create action items with owner, deadline, priority.", tokens: "~400" },
      { key: "risk_blocker", name: "Risk & Blocker Detector", alias: "STRONG", purpose: "Detect risks, open questions, and blockers.", tokens: "~300" },
      { key: "followup_email", name: "Follow-up Email Generator", alias: "STRONG", purpose: "Write a follow-up email to the client.", tokens: "~400" },
      { key: "billables", name: "Suggested Billables Detector", alias: "FAST", purpose: "Flag work that could be invoiced.", tokens: "~250" },
      { key: "formatter", name: "Final Output Formatter", alias: "FORMATTER", purpose: "Assemble the recap as Markdown + JSON.", tokens: "~1200" },
    ],
  },
  "proposal-sow": {
    meta: {
      name: "Proposal & Scope of Work Builder", category: "Proposal", band: "medium", runtime: "~60s",
      description: "Turn a project brief into a client-ready proposal with a precise scope of work and milestones.",
      longDesc: "Extracts requirements, synthesizes any client context, writes the proposal and a tight scope of work (in and out of scope), builds milestones with payment hints, and checks assumptions and acceptance criteria.",
      inputLabel: "Project brief",
      inputHint: "Describe the project, client, goals, budget, timeline, and service type.",
      outputHint: "Proposal + scope of work + milestones + assumptions, ready to send.",
      limits: { inputChars: 4000, outputWords: 2000 },
      examplePrompt: "Proposal for a 6-week marketing website redesign for Acme Corp. Budget ~$18k, must launch before Q3, wants a modern look and faster load times.",
      exampleOutput: "# Proposal: Acme Corp Website Redesign\n\n## Executive Summary\nA 6-week redesign to modernize the marketing site and improve load times ahead of the Q3 launch.\n\n## Scope of Work\n**In scope:** design, build, content migration.\n**Out of scope:** ongoing maintenance (separate retainer).\n\n## Milestones\n| Milestone | Deliverable | Duration | Payment Hint |\n|---|---|---|---|\n| Design | Approved mockups | 2 wks | 40% |\n| Build | Live site | 3 wks | 40% |\n| Launch | Handover | 1 wk | 20% |\n\n## Assumptions\n- Brand assets provided by week 1.",
    },
    specs: [
      { key: "requirement_extractor", name: "Requirement Extractor", alias: "FAST", purpose: "Extract requirements, goals, and constraints.", tokens: "~400" },
      { key: "context_synth", name: "Client Context Synthesizer", alias: "STRONG", purpose: "Synthesize provided client context into a positioning note.", tokens: "~400" },
      { key: "proposal_generator", name: "Proposal Generator", alias: "STRONG", purpose: "Write the client-ready proposal.", tokens: "~1200" },
      { key: "sow_generator", name: "SOW Generator", alias: "STRONG", purpose: "Define deliverables, in-scope, and out-of-scope.", tokens: "~700" },
      { key: "milestone_builder", name: "Milestone Builder", alias: "FAST", purpose: "Build milestones with timeline and payment hints.", tokens: "~400" },
      { key: "risk_assumption", name: "Risk & Assumption Checker", alias: "STRONG", purpose: "Check assumptions and acceptance criteria.", tokens: "~350" },
      { key: "formatter", name: "Final Document Formatter", alias: "FORMATTER", purpose: "Assemble the document as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "market-pain-research": {
    meta: {
      name: "Market Pain Point Research", category: "Research", band: "heavy", runtime: "~80s",
      description: "Research a market or audience to surface pains, objections, and service opportunities.",
      longDesc: "Cleans community and web signals, runs web research, clusters pain points, extracts objections and repeated needs, maps them to opportunities, and generates content and outreach ideas.",
      inputLabel: "Topic and audience",
      inputHint: "Describe the topic and audience. Optionally paste community/forum text or a source URL.",
      outputHint: "Pain clusters, objections, an opportunity map, and content/outreach ideas with sources.",
      limits: { inputChars: 8000, outputWords: 2000 },
      examplePrompt: "Research pain points of solo freelancers getting paid by international clients. Focus on payment delays and fees.",
      exampleOutput: "# Market Pain Research: Freelancer Payments\n\n## Pain Clusters\n- Slow international transfers\n- High FX and platform fees\n- Chargeback and trust issues\n\n## Objections\n- \"Crypto is too complex.\"\n- \"Clients will not switch tools.\"\n\n## Opportunity Map\n| Pain | Opportunity | Why it wins |\n|---|---|---|\n| Slow transfers | Instant USDC payout | Settles in seconds |\n\n## Content & Outreach Ideas\n- \"How freelancers lose 7% to payment fees\"\n\n## Sources\n- (URLs gathered during research)",
    },
    specs: [
      { key: "source_cleaner", name: "Source Context Cleaner", alias: "FAST", purpose: "Clean community/forum/web text for analysis.", tokens: "~700" },
      { key: "web_research", name: "Web/Community Research", alias: "RESEARCH", purpose: "Find market signals and complaints online.", tokens: "~2500" },
      { key: "pain_clusterer", name: "Pain Point Clusterer", alias: "FAST", purpose: "Group pains into named clusters.", tokens: "~600" },
      { key: "objection_extractor", name: "Objection Extractor", alias: "STRONG", purpose: "Extract objections and repeated needs.", tokens: "~500" },
      { key: "opportunity_mapper", name: "Opportunity Mapper", alias: "STRONG", purpose: "Turn pains into service opportunities.", tokens: "~700" },
      { key: "idea_generator", name: "Content/Outreach Idea Generator", alias: "STRONG", purpose: "Generate content and outreach angles.", tokens: "~600" },
      { key: "formatter", name: "Final Research Formatter", alias: "FORMATTER", purpose: "Assemble the brief as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "code-review": {
    meta: {
      name: "Code Review Report", category: "Code", band: "heavy", runtime: "~60s",
      description: "Multi-pass code review: correctness, security, performance, and suggested fixes with a score.",
      longDesc: "Normalizes the code, reviews logic and edge cases, scans for security issues, checks performance and complexity, proposes concrete patches, and outputs a scored severity report.",
      inputLabel: "Code snippet",
      inputHint: "Paste the code to review. Mention the language and any review focus.",
      outputHint: "Scored review with severity table, findings by category, and suggested fixes.",
      limits: { inputChars: 12000, outputWords: 1800 },
      examplePrompt: "Review this Node.js login handler that compares passwords and signs a JWT.",
      exampleOutput: "# Code Review Report\n\n**Score:** 62/100\n\n| Severity | Count |\n|---|---|\n| Critical | 1 |\n| High | 2 |\n\n## Correctness\n- Missing await on the async hash compare.\n\n## Security\n- [Critical] Timing-unsafe password comparison; use a constant-time compare.\n- [High] JWT secret read from a literal; move to env.\n\n## Performance\n- Synchronous bcrypt on the request path.\n\n## Suggested Fixes\n```js\nconst ok = crypto.timingSafeEqual(a, b);\n```",
    },
    specs: [
      { key: "code_normalizer", name: "Code Normalizer", alias: "FAST", purpose: "Detect language and outline structure.", tokens: "~400" },
      { key: "logic_review", name: "Logic Review", alias: "CODE", purpose: "Find bugs, edge cases, and correctness issues.", tokens: "~900" },
      { key: "security_review", name: "Security Review", alias: "CODE", purpose: "Find security risks and unsafe patterns.", tokens: "~700" },
      { key: "perf_review", name: "Performance Review", alias: "CODE", purpose: "Find performance and complexity issues.", tokens: "~500" },
      { key: "fix_suggestions", name: "Fix Suggestion Generator", alias: "CODE", purpose: "Propose concrete patches for top findings.", tokens: "~700" },
      { key: "formatter", name: "Score & Severity Formatter", alias: "FORMATTER", purpose: "Assemble a scored report as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "upwork-proposal": {
    meta: {
      name: "Upwork / Job Post Proposal Draft", category: "Proposal", band: "medium", runtime: "~55s",
      description: "Turn a freelance job post into a personalized, high-conversion proposal draft.",
      longDesc: "Parses the job post, infers the client's real need, matches the freelancer's profile, writes a personalized hook and full proposal, answers screening questions, and checks the draft is not generic.",
      inputLabel: "Job post + your profile",
      inputHint: "Paste the job post, then your profile highlights, portfolio, and preferred tone.",
      outputHint: "A ready-to-paste proposal, screening answers, and a pre-send checklist.",
      limits: { inputChars: 8000, outputWords: 1200 },
      examplePrompt: "Job post: need a React dev to rebuild a checkout flow. My profile: 6 years React, shipped 3 e-commerce checkouts, friendly tone.",
      exampleOutput: "# Proposal Draft\n\nHi - I noticed you want a faster, cleaner checkout. I have rebuilt three e-commerce checkouts that cut abandonment by double digits.\n\nHere is how I would approach yours:\n1. Audit the current flow and Core Web Vitals.\n2. Rebuild to a one-page checkout in React.\n3. A/B test old vs new.\n\nHappy to share a 5-minute Loom walking through a past rebuild. When can we talk?\n\n## Screening Answers\n- Availability: 20 hrs/week, starting Monday.",
    },
    specs: [
      { key: "job_parser", name: "Job Post Parser", alias: "FAST", purpose: "Extract needs, skills, budget, and hidden objections.", tokens: "~400" },
      { key: "client_need", name: "Client Need Extractor", alias: "STRONG", purpose: "Identify what the client really wants.", tokens: "~350" },
      { key: "fit_matcher", name: "Freelancer Fit Matcher", alias: "FAST", purpose: "Match profile and portfolio to the job.", tokens: "~350" },
      { key: "hook_generator", name: "Proposal Hook Generator", alias: "STRONG", purpose: "Write a personalized opening hook.", tokens: "~250" },
      { key: "proposal_draft", name: "Proposal Draft Generator", alias: "STRONG", purpose: "Write the full proposal.", tokens: "~700" },
      { key: "screening_answers", name: "Screening Answer Generator", alias: "STRONG", purpose: "Answer screening questions if present.", tokens: "~400" },
      { key: "bid_checker", name: "Bid Strategy Checker", alias: "FAST", purpose: "Check the draft is specific, not generic.", tokens: "~250" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the proposal as Markdown + JSON.", tokens: "~1200" },
    ],
  },
  "rfp-proposal": {
    meta: {
      name: "RFP / Job Post to Proposal & Estimate", category: "Proposal", band: "medium", runtime: "~65s",
      description: "Convert an RFP or detailed job post into a proposal outline, scope, and effort estimate.",
      longDesc: "Parses the RFP into requirements and deliverables, estimates complexity and risk, builds scope and an estimate in your preferred pricing model, drafts a proposal outline, and lists clarifying questions.",
      inputLabel: "RFP or job post",
      inputHint: "Paste the RFP or detailed job post, plus capability notes and pricing preference.",
      outputHint: "Proposal outline, scope, estimate, timeline, risks, and clarifying questions.",
      limits: { inputChars: 12000, outputWords: 2000 },
      examplePrompt: "RFP for a data dashboard with 4 integrations and SSO. We prefer milestone-based pricing.",
      exampleOutput: "# Bid Package: Data Dashboard\n\n## Proposal Outline\n1. Understanding\n2. Approach\n3. Team\n\n## Scope\n**In:** dashboard, 4 integrations, SSO.\n**Out:** custom data pipelines.\n\n## Estimate (milestones)\n| Deliverable | Effort | Risk |\n|---|---|---|\n| Integrations | 10-14 d | Med |\n| SSO | 4-6 d | Low |\n\n## Clarifying Questions\n- Which identity provider for SSO?",
    },
    specs: [
      { key: "rfp_parser", name: "RFP Parser", alias: "STRONG", purpose: "Extract requirements, deliverables, constraints.", tokens: "~600" },
      { key: "complexity_estimator", name: "Complexity Estimator", alias: "STRONG", purpose: "Estimate effort, timeline, and risk.", tokens: "~600" },
      { key: "scope_builder", name: "Scope Builder", alias: "STRONG", purpose: "Define in-scope and out-of-scope.", tokens: "~500" },
      { key: "estimate_generator", name: "Estimate Generator", alias: "STRONG", purpose: "Produce the estimate in the preferred model.", tokens: "~500" },
      { key: "proposal_outline", name: "Proposal Outline Generator", alias: "STRONG", purpose: "Build the proposal structure.", tokens: "~500" },
      { key: "missing_info", name: "Risk & Missing Info Checker", alias: "FAST", purpose: "List must-ask clarifying questions.", tokens: "~350" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the bid package as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "cold-outreach": {
    meta: {
      name: "Cold Outreach Pack", category: "Sales", band: "medium", runtime: "~60s",
      description: "Generate a full cold outreach pack: positioning, email sequence, subject lines, and a LinkedIn DM.",
      longDesc: "Analyzes the prospect and persona, maps the offer to their pains, writes a value proposition, a 3-email sequence, subject lines, a LinkedIn DM, and optimized CTAs.",
      inputLabel: "Prospect, offer, and tone",
      inputHint: "Describe the prospect/persona, your offer, the desired tone, and your CTA.",
      outputHint: "Positioning, 3-email sequence, subject lines, LinkedIn DM, and CTA options.",
      limits: { inputChars: 4000, outputWords: 1500 },
      examplePrompt: "Prospect: heads of marketing at Series A SaaS. Offer: landing page CRO sprint. Tone: direct. CTA: book a 15-min call.",
      exampleOutput: "# Cold Outreach Pack\n\n## Positioning\nWe turn your highest-traffic landing pages into higher-converting ones in two weeks.\n\n## Email 1\nSubject: quick idea for {{company}}\nHi {{name}}, I looked at your pricing page...\n\n## Email 2 (follow-up)\n...\n\n## LinkedIn DM\nHi {{name}}, saw you lead marketing at {{company}} - mind if I share one CRO idea?\n\n## Subject Lines\n- quick idea for {{company}}\n- 2-week CRO sprint",
    },
    specs: [
      { key: "prospect_analyzer", name: "Prospect Context Analyzer", alias: "STRONG", purpose: "Analyze the prospect and persona.", tokens: "~500" },
      { key: "pain_mapper", name: "Pain Point Mapper", alias: "STRONG", purpose: "Map the offer to the prospect's pains.", tokens: "~400" },
      { key: "offer_positioning", name: "Offer Positioning Generator", alias: "STRONG", purpose: "Write the value proposition.", tokens: "~400" },
      { key: "email_sequence", name: "Email Sequence Generator", alias: "STRONG", purpose: "Write a 3-email cold sequence.", tokens: "~800" },
      { key: "subject_lines", name: "Subject Line Generator", alias: "FAST", purpose: "Write high-open-rate subject lines.", tokens: "~200" },
      { key: "linkedin_dm", name: "LinkedIn DM Generator", alias: "STRONG", purpose: "Write a short LinkedIn DM.", tokens: "~250" },
      { key: "cta_optimizer", name: "CTA Optimizer", alias: "FAST", purpose: "Sharpen the CTAs.", tokens: "~200" },
      { key: "formatter", name: "Final Pack Formatter", alias: "FORMATTER", purpose: "Assemble the pack as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "follow-up-nurture": {
    meta: {
      name: "Automated Follow-up & Nurture", category: "Client Communication", band: "light", runtime: "~45s",
      description: "Draft the right follow-up sequence based on where a deal or conversation stands.",
      longDesc: "Reads the prior conversation to determine the deal state, picks the right follow-up objective, handles objections or silence, writes a short sequence, and suggests send timing.",
      inputLabel: "Prior conversation + goal",
      inputHint: "Paste the previous conversation, the client status, your desired outcome, and tone.",
      outputHint: "A situation read, objective, message sequence, and send timing.",
      limits: { inputChars: 8000, outputWords: 1200 },
      examplePrompt: "Client went quiet after I sent a quote two weeks ago. I want to re-engage without being pushy. Friendly tone.",
      exampleOutput: "# Follow-up Plan\n\n## Situation\nQuote sent 2 weeks ago, no reply. Client owes the next move.\n\n## Objective\nRe-open the conversation and surface any blocker.\n\n## Message Sequence\n**1 (now):** Hi {{name}}, circling back on the quote - is the scope still right for you?\n**2 (in 4 days):** Sharing a quick case study in case it helps.\n\n## Timing\nSend message 1 today, message 2 in 4 days.",
    },
    specs: [
      { key: "state_extractor", name: "Conversation State Extractor", alias: "FAST", purpose: "Determine the deal/project state.", tokens: "~400" },
      { key: "intent_planner", name: "Intent Planner", alias: "STRONG", purpose: "Choose the follow-up objective.", tokens: "~300" },
      { key: "objection_handler", name: "Objection Handler", alias: "STRONG", purpose: "Handle objection or silence.", tokens: "~400" },
      { key: "sequence_generator", name: "Follow-up Sequence Generator", alias: "STRONG", purpose: "Write the follow-up sequence.", tokens: "~700" },
      { key: "timing_suggestion", name: "Timing Suggestion Generator", alias: "FAST", purpose: "Suggest send timing and cadence.", tokens: "~200" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the plan as Markdown + JSON.", tokens: "~1000" },
    ],
  },
  "timeline-from-sow": {
    meta: {
      name: "Project Timeline & Milestone from SOW", category: "Operations", band: "medium", runtime: "~60s",
      description: "Turn a scope of work into a realistic timeline, milestones, dependencies, and payment schedule.",
      longDesc: "Parses the SOW into deliverables and dependencies, breaks work into tasks by milestone, maps dependencies, builds a realistic timeline, adds risk buffers, and suggests payment milestones.",
      inputLabel: "Scope of work",
      inputHint: "Paste the SOW, plus the deadline, team size, and work style.",
      outputHint: "Milestones, tasks, a timeline table, dependencies, risks, and a payment schedule.",
      limits: { inputChars: 8000, outputWords: 1800 },
      examplePrompt: "SOW for a mobile app MVP: auth, profiles, feed, payments. 2 developers, deadline in 10 weeks.",
      exampleOutput: "# Project Plan: App MVP\n\n## Milestones & Tasks\n- M1 Auth + Profiles\n- M2 Feed\n- M3 Payments\n\n## Timeline\n| Milestone | Tasks | Duration | Target |\n|---|---|---|---|\n| M1 | Auth, profiles | 3 wks | Wk 3 |\n| M2 | Feed | 3 wks | Wk 6 |\n| M3 | Payments | 3 wks | Wk 9 |\n\n## Dependencies & Risks\n- Payments depend on auth. Buffer 1 week.\n\n## Payment Schedule\n- 30% / 40% / 30% by milestone.",
    },
    specs: [
      { key: "sow_parser", name: "SOW Parser", alias: "FAST", purpose: "Extract deliverables, constraints, dependencies.", tokens: "~500" },
      { key: "task_breakdown", name: "Task Breakdown Generator", alias: "STRONG", purpose: "Break work into tasks by milestone.", tokens: "~700" },
      { key: "dependency_mapper", name: "Dependency Mapper", alias: "STRONG", purpose: "Identify dependencies and blockers.", tokens: "~500" },
      { key: "timeline_builder", name: "Timeline Builder", alias: "STRONG", purpose: "Build a realistic timeline.", tokens: "~600" },
      { key: "risk_buffer", name: "Risk Buffer Planner", alias: "FAST", purpose: "Add buffers and risk notes.", tokens: "~300" },
      { key: "invoice_hint", name: "Invoice Milestone Hint Generator", alias: "FAST", purpose: "Suggest payment milestones.", tokens: "~300" },
      { key: "formatter", name: "Final Plan Formatter", alias: "FORMATTER", purpose: "Assemble the plan as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "handover-report": {
    meta: {
      name: "Delivery / Handover Report Generator", category: "Delivery", band: "medium", runtime: "~55s",
      description: "Generate a professional client handover report from a summary of completed work.",
      longDesc: "Cleans the completed-work summary, maps it to deliverables, writes a handover report and usage notes, detects pending items, and checks whether the work is ready to invoice.",
      inputLabel: "Completed work summary",
      inputHint: "Describe the completed work, links/files, and the project/client name.",
      outputHint: "A handover report, usage notes, pending items, and invoice readiness.",
      limits: { inputChars: 8000, outputWords: 1500 },
      examplePrompt: "Finished the Acme website redesign: 8 pages, CMS setup, analytics. Staging link included. Need a handover doc.",
      exampleOutput: "# Handover Report: Acme Website\n\n## Delivered Work\n- 8 redesigned pages, CMS, analytics.\n\n## How It Meets Goals\n- Faster load times, modern design before Q3.\n\n## Usage & Maintenance\n- Edit content in the CMS under Pages.\n\n## Pending Items\n- Final DNS cutover (client action).\n\n## Invoice Readiness\nReady to invoice once DNS is switched.",
    },
    specs: [
      { key: "work_cleaner", name: "Work Summary Cleaner", alias: "FAST", purpose: "Normalize the completed-work description.", tokens: "~500" },
      { key: "deliverable_mapper", name: "Deliverable Mapper", alias: "STRONG", purpose: "Map work to deliverables/milestones.", tokens: "~500" },
      { key: "handover_writer", name: "Handover Report Generator", alias: "STRONG", purpose: "Write the handover report.", tokens: "~900" },
      { key: "usage_notes", name: "Usage Notes Generator", alias: "STRONG", purpose: "Write usage and maintenance notes.", tokens: "~500" },
      { key: "pending_items", name: "Pending Items Detector", alias: "FAST", purpose: "Identify remaining items.", tokens: "~300" },
      { key: "invoice_readiness", name: "Invoice Readiness Checker", alias: "FAST", purpose: "Assess readiness to invoice.", tokens: "~250" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the report as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "seo-content-brief": {
    meta: {
      name: "SEO Content Brief Generator", category: "SEO", band: "heavy", runtime: "~75s",
      description: "Research a keyword and produce an actionable SEO content brief with outline and FAQs.",
      longDesc: "Classifies search intent, researches what ranks, analyzes competitor structure, finds content gaps, and produces a brief with title, meta, outline, entities, and FAQs, then QA-checks it against intent.",
      inputLabel: "Target keyword",
      inputHint: "Enter the keyword, region, language, content type, and any competitor notes.",
      outputHint: "Intent, title/meta, H2/H3 outline, entities, FAQs, gaps, and sources.",
      limits: { inputChars: 4000, outputWords: 2000 },
      examplePrompt: "Keyword: 'get paid in USDC'. Region: US. Content type: how-to guide for freelancers.",
      exampleOutput: "# SEO Content Brief: get paid in USDC\n\n## Intent\nInformational, freelancers new to crypto.\n\n## Title & Meta\n- Title: How to Get Paid in USDC (2026 Guide)\n- Meta: Step-by-step guide for freelancers...\n\n## Outline\n## What is USDC\n## How to set up a wallet\n## How to invoice in USDC\n\n## FAQs\n- Is USDC safe?\n\n## Sources\n- (URLs gathered during research)",
    },
    specs: [
      { key: "intent_classifier", name: "Keyword Intent Classifier", alias: "FAST", purpose: "Classify search intent and the searcher.", tokens: "~300" },
      { key: "serp_research", name: "SERP/Web Research", alias: "RESEARCH", purpose: "Research what currently ranks.", tokens: "~2000" },
      { key: "competitor_analyzer", name: "Competitor Structure Analyzer", alias: "RESEARCH", purpose: "Analyze competitor headings and angles.", tokens: "~800" },
      { key: "gap_analyzer", name: "Content Gap Analyzer", alias: "STRONG", purpose: "Find gaps and opportunities.", tokens: "~500" },
      { key: "brief_generator", name: "Brief Generator", alias: "STRONG", purpose: "Write title, meta, outline, and FAQs.", tokens: "~900" },
      { key: "seo_qa", name: "SEO QA Checker", alias: "FAST", purpose: "Verify the brief matches intent.", tokens: "~300" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the brief as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "seo-audit": {
    meta: {
      name: "Website / SEO Audit Report", category: "SEO", band: "heavy", runtime: "~80s",
      description: "Audit a page or site for technical and content SEO with prioritized, client-ready recommendations.",
      longDesc: "Normalizes the input, researches the page/site, analyzes technical and content SEO, prioritizes issues by severity and effort, and writes prioritized recommendations.",
      inputLabel: "Website URL",
      inputHint: "Enter the URL, optionally paste page HTML/text, and set the audit depth.",
      outputHint: "Executive summary, technical and content findings, a priority table, and recommendations.",
      limits: { inputChars: 12000, outputWords: 2000 },
      examplePrompt: "Audit https://example.com homepage. Focus on technical SEO and content gaps. Standard depth.",
      exampleOutput: "# SEO Audit: example.com\n\n## Executive Summary\nSolid foundation; missing meta descriptions and a clear H1 strategy.\n\n## Technical SEO\n- Missing meta description (Medium).\n- Multiple H1 tags (Medium).\n\n## Content SEO\n- Thin homepage copy; no clear value proposition.\n\n## Prioritized Issues\n| Issue | Severity | Impact | Effort |\n|---|---|---|---|\n| Meta description | Med | Med | Low |\n\n## Recommendations\n1. Add unique meta descriptions (quick win).",
    },
    specs: [
      { key: "input_normalizer", name: "URL/HTML Normalizer", alias: "FAST", purpose: "Normalize the URL and any pasted content.", tokens: "~400" },
      { key: "page_research", name: "Web/Page Research", alias: "RESEARCH", purpose: "Research the page/site and competitors.", tokens: "~2000" },
      { key: "technical_seo", name: "Technical SEO Analyzer", alias: "STRONG", purpose: "Analyze title, meta, headings, indexing.", tokens: "~600" },
      { key: "content_seo", name: "Content SEO Analyzer", alias: "STRONG", purpose: "Analyze content, positioning, gaps.", tokens: "~600" },
      { key: "issue_prioritizer", name: "Issue Prioritizer", alias: "FAST", purpose: "Prioritize by severity, impact, effort.", tokens: "~400" },
      { key: "recommendation_writer", name: "Recommendation Writer", alias: "STRONG", purpose: "Write client-ready recommendations.", tokens: "~700" },
      { key: "formatter", name: "Final Audit Formatter", alias: "FORMATTER", purpose: "Assemble the audit as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "keyword-strategy": {
    meta: {
      name: "Keyword Strategy Map", category: "SEO", band: "light", runtime: "~55s",
      description: "Turn a raw keyword list into clusters, a hub-and-spoke architecture, and a content roadmap.",
      longDesc: "Cleans and deduplicates keywords, classifies intent, clusters them semantically, designs a hub-and-spoke architecture, scores priority, and produces a content roadmap.",
      inputLabel: "Keyword list",
      inputHint: "Paste your keyword list (text or CSV).",
      outputHint: "Clusters, an intent map, hub/spoke architecture, priorities, and a roadmap.",
      limits: { inputChars: 8000, outputWords: 1800 },
      examplePrompt: "Keywords: usdc payments, crypto invoicing, get paid in stablecoin, freelance crypto payments, usdc wallet.",
      exampleOutput: "# Keyword Strategy Map\n\n## Clusters\n- USDC payments\n- Crypto invoicing\n\n## Intent Map\n| Keyword | Intent |\n|---|---|\n| get paid in stablecoin | Informational |\n\n## Hub/Spoke\n- Hub: USDC payments guide\n- Spokes: invoicing, wallets\n\n## Priorities\n| Cluster | Impact | Effort | Priority |\n|---|---|---|---|\n| USDC payments | 5 | 3 | High |\n\n## Roadmap\n1. Publish the hub first.",
    },
    specs: [
      { key: "keyword_cleaner", name: "Keyword Cleaner", alias: "FAST", purpose: "Dedupe and normalize keywords.", tokens: "~500" },
      { key: "intent_classifier", name: "Intent Classifier", alias: "FAST", purpose: "Classify each keyword's intent.", tokens: "~500" },
      { key: "semantic_clusterer", name: "Semantic Clusterer", alias: "STRONG", purpose: "Group keywords into clusters.", tokens: "~600" },
      { key: "hub_spoke", name: "Hub/Spoke Planner", alias: "STRONG", purpose: "Design a content architecture.", tokens: "~600" },
      { key: "priority_scorer", name: "Priority Scorer", alias: "FAST", purpose: "Score clusters by impact and effort.", tokens: "~400" },
      { key: "roadmap_generator", name: "Content Roadmap Generator", alias: "STRONG", purpose: "Produce a phased content roadmap.", tokens: "~500" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the map as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "pr-diff-review": {
    meta: {
      name: "PR Code Review / Diff Review", category: "Code", band: "heavy", runtime: "~65s",
      description: "Review a pasted git diff: correctness, security, tests, per-file comments, and a merge verdict.",
      longDesc: "Parses the diff and PR description, reviews correctness and security of the changes, suggests tests, writes per-file review comments, and gives a merge-readiness verdict. Paste-diff fallback (no GitHub OAuth needed).",
      inputLabel: "Git diff",
      inputHint: "Paste the git diff and the PR description. Repo context is optional.",
      outputHint: "Verdict and risk summary, findings by category, tests to add, and per-file comments.",
      limits: { inputChars: 16000, outputWords: 1800 },
      examplePrompt: "PR: adds a coupon code field to checkout. Diff included. Description: apply percentage discount before tax.",
      exampleOutput: "# PR Review\n\n**Verdict:** Request changes\n\n## Risk Summary\nDiscount applied after tax in one path; needs a test.\n\n## Correctness\n- checkout.js: discount order is wrong for taxed regions.\n\n## Security\n- No server-side validation of the coupon code.\n\n## Tests to Add\n- Coupon applied before tax for a taxed region.\n\n## Per-file Comments\n- checkout.js: move discount before tax calculation.",
    },
    specs: [
      { key: "diff_parser", name: "Diff Parser", alias: "FAST", purpose: "Split files and flag risk areas.", tokens: "~500" },
      { key: "context_summary", name: "Context Summarizer", alias: "FAST", purpose: "Summarize the PR goal.", tokens: "~250" },
      { key: "logic_review", name: "Logic Review", alias: "CODE", purpose: "Review correctness and edge cases.", tokens: "~800" },
      { key: "security_review", name: "Security Review", alias: "CODE", purpose: "Review secrets, auth, validation.", tokens: "~600" },
      { key: "test_review", name: "Test Coverage Review", alias: "CODE", purpose: "Suggest tests to add.", tokens: "~500" },
      { key: "pr_comments", name: "PR Comment Generator", alias: "CODE", purpose: "Write per-file review comments.", tokens: "~700" },
      { key: "merge_scorer", name: "Merge Readiness Scorer", alias: "STRONG", purpose: "Give a merge verdict and risk summary.", tokens: "~400" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the review as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "x-thread-writer": {
    meta: {
      name: "X / Twitter Thread Writer", category: "Content", band: "light", runtime: "~40s",
      description: "Turn an idea, article, or insight into a high-engagement X/Twitter thread.",
      longDesc: "Extracts the core idea, plans a hook and beats, writes a numbered thread, and offers alternative hooks.",
      inputLabel: "Idea or article",
      inputHint: "Paste your idea, insight, or the content to turn into a thread.",
      outputHint: "A numbered, ready-to-post thread plus alternative hooks.",
      limits: { inputChars: 6000, outputWords: 700 },
      examplePrompt: "Write a thread on why most devs underestimate the cost of building auth from scratch.",
      exampleOutput: "# X Thread\n\n1/ Most developers think auth is a weekend project. It is not.\n\n2/ The happy path takes 2 days. The edge cases take 6 weeks: token invalidation, MFA, OAuth, rate limiting.\n\n3/ The real cost is maintenance: every security update and new provider is your problem.\n\n4/ Use a proven solution and ship your product, not your auth layer.\n\n## Alternative Hooks\n- Auth is the most underestimated build in software.",
    },
    specs: [
      { key: "content_extractor", name: "Content Extractor", alias: "FAST", purpose: "Extract core ideas and the sharpest angle.", tokens: "~400" },
      { key: "thread_architect", name: "Thread Architect", alias: "FAST", purpose: "Plan hook, beats, and CTA.", tokens: "~300" },
      { key: "tweet_writer", name: "Tweet Writer", alias: "STRONG", purpose: "Write the numbered thread.", tokens: "~800" },
      { key: "hook_optimizer", name: "Hook Optimizer", alias: "FAST", purpose: "Offer alternative hooks.", tokens: "~250" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble thread + hooks as Markdown + JSON.", tokens: "~1000" },
    ],
  },
  "newsletter-writer": {
    meta: {
      name: "Newsletter Issue Writer", category: "Content", band: "medium", runtime: "~60s",
      description: "Turn a topic or notes into a polished, skimmable newsletter issue.",
      longDesc: "Extracts the brief, outlines the issue, writes and polishes the draft, and generates subject lines and preview text.",
      inputLabel: "Topic or notes",
      inputHint: "Describe the topic, audience, key points, and goal of the issue.",
      outputHint: "Subject line options, preview text, and a ready-to-send newsletter body.",
      limits: { inputChars: 6000, outputWords: 1500 },
      examplePrompt: "Newsletter issue for freelancers about getting paid faster with USDC. Friendly, practical.",
      exampleOutput: "# Newsletter Issue\n\n## Subject Lines\n- Get paid in seconds, not weeks\n- The fee that eats 7% of your invoices\n\n## Preview Text\nA faster way to get paid across borders.\n\n## Body\nHey there,\n\nIf international payments take a week and cost a fortune, this one is for you...\n\n### Why USDC\nStable, instant, low fees.\n\n### How to start\n1. Set up a wallet. 2. Invoice in USDC. 3. Get paid.",
    },
    specs: [
      { key: "brief_extractor", name: "Brief Extractor", alias: "FAST", purpose: "Extract topic, audience, key points, goal.", tokens: "~300" },
      { key: "outline_builder", name: "Outline Builder", alias: "FAST", purpose: "Outline subject, intro, sections, CTA.", tokens: "~300" },
      { key: "draft_writer", name: "Draft Writer", alias: "STRONG", purpose: "Write the full newsletter draft.", tokens: "~1100" },
      { key: "subject_lines", name: "Subject Line Generator", alias: "FAST", purpose: "Subject lines and preview text.", tokens: "~200" },
      { key: "polish_editor", name: "Polish Editor", alias: "STRONG", purpose: "Tighten for clarity and skimmability.", tokens: "~800" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble issue as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "linkedin-post": {
    meta: {
      name: "LinkedIn Post Writer", category: "Content", band: "light", runtime: "~35s",
      description: "Turn an idea into a professional, high-engagement LinkedIn post.",
      longDesc: "Extracts the angle, writes scroll-stopping hooks and a full post, and suggests hashtags and CTAs.",
      inputLabel: "Idea or message",
      inputHint: "Describe what you want to say, your audience, and your goal.",
      outputHint: "A ready-to-paste post plus alternative hooks and hashtag/CTA options.",
      limits: { inputChars: 4000, outputWords: 500 },
      examplePrompt: "A post about a lesson learned shipping my first SaaS: charge earlier than feels comfortable.",
      exampleOutput: "# LinkedIn Post\n\nI waited 6 months to charge for my SaaS. Big mistake.\n\nHere is what I learned:\n\nFree users are not customers. They give different feedback.\n\nThe day I added a price, I learned what people actually valued.\n\nCharge earlier than feels comfortable.\n\n## Hashtags & CTA\n#SaaS #Startups - What is the earliest you have charged?",
    },
    specs: [
      { key: "angle_extractor", name: "Angle Extractor", alias: "FAST", purpose: "Extract core message, audience, goal.", tokens: "~250" },
      { key: "hook_writer", name: "Hook Writer", alias: "FAST", purpose: "Write scroll-stopping opening lines.", tokens: "~200" },
      { key: "post_writer", name: "Post Writer", alias: "STRONG", purpose: "Write the full LinkedIn post.", tokens: "~600" },
      { key: "hashtag_cta", name: "Hashtag & CTA Helper", alias: "FAST", purpose: "Suggest hashtags and CTAs.", tokens: "~200" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble post as Markdown + JSON.", tokens: "~900" },
    ],
  },
  "crypto-research": {
    meta: {
      name: "Crypto Project Research Report", category: "Crypto", band: "heavy", runtime: "~85s",
      description: "Due-diligence report on a crypto project: overview, tokenomics, team, tech, risks, and a rating.",
      longDesc: "Plans the scope, researches the project online, analyzes tokenomics and tech/team, assesses risk with a rating, and assembles a cited report.",
      inputLabel: "Project name",
      inputHint: "Enter the project name and any angle to focus on (e.g. 'focus on tokenomics').",
      outputHint: "A structured report with risk rating, tokenomics, team/tech, and cited sources.",
      limits: { inputChars: 2000, outputWords: 2000 },
      examplePrompt: "Research report on Arc by Circle, focus on the USDC-as-gas model and risks.",
      exampleOutput: "# Crypto Research Report: Arc by Circle\n\n**Risk Rating:** Low-Medium\n\n## Overview\nArc is an EVM chain where USDC is the native gas token.\n\n## Tokenomics\nNo speculative governance token; fees paid in USDC.\n\n## Tech & Team\nBacked by Circle; sub-second finality, CCTP native.\n\n## Risk Rating & Red Flags\nCentralization around Circle; regulatory exposure of USDC.\n\n## Sources\n- (URLs gathered during research)",
    },
    specs: [
      { key: "scope_planner", name: "Scope Planner", alias: "FAST", purpose: "Frame the due-diligence questions.", tokens: "~300" },
      { key: "web_research", name: "Web Research", alias: "RESEARCH", purpose: "Research the project online.", tokens: "~2500" },
      { key: "tokenomics_analyst", name: "Tokenomics Analyst", alias: "STRONG", purpose: "Analyze supply, distribution, utility.", tokens: "~700" },
      { key: "tech_team_analyst", name: "Tech & Team Analyst", alias: "STRONG", purpose: "Assess technology and team/backers.", tokens: "~600" },
      { key: "risk_assessor", name: "Risk Assessor", alias: "STRONG", purpose: "Risk rating and red flags.", tokens: "~600" },
      { key: "formatter", name: "Final Report Formatter", alias: "FORMATTER", purpose: "Assemble the report as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "tokenomics-analyzer": {
    meta: {
      name: "Tokenomics Analyzer", category: "Crypto", band: "medium", runtime: "~55s",
      description: "Analyze a token's supply, distribution, vesting, utility, and dilution risk.",
      longDesc: "Structures the tokenomics data, analyzes supply/emissions, distribution/vesting, and utility/demand, then summarizes risks with a rating.",
      inputLabel: "Tokenomics details",
      inputHint: "Paste the tokenomics (supply, allocations, vesting, utility) or a link's content.",
      outputHint: "Analysis of supply, distribution, utility, and a risk rating.",
      limits: { inputChars: 6000, outputWords: 1500 },
      examplePrompt: "Token: 1B max supply, 20% team (4y vest, 1y cliff), 15% investors, 40% community, utility = gas + staking.",
      exampleOutput: "# Tokenomics Analysis\n\n## Supply & Emissions\n1B max; emissions taper over 4 years.\n\n## Distribution & Vesting\nTeam 20% (1y cliff, 4y vest) reduces early dump risk.\n\n## Utility & Demand\nGas + staking create recurring demand.\n\n## Risks & Rating\nModerate unlock pressure in year 2. Rating: Medium.",
    },
    specs: [
      { key: "input_normalizer", name: "Input Normalizer", alias: "FAST", purpose: "Structure the tokenomics data.", tokens: "~400" },
      { key: "supply_analyst", name: "Supply Analyst", alias: "STRONG", purpose: "Analyze supply and emissions.", tokens: "~500" },
      { key: "distribution_analyst", name: "Distribution Analyst", alias: "STRONG", purpose: "Analyze allocation, vesting, unlock risk.", tokens: "~600" },
      { key: "utility_demand", name: "Utility & Demand Analyst", alias: "STRONG", purpose: "Analyze utility and demand drivers.", tokens: "~500" },
      { key: "risk_rating", name: "Risk & Rating", alias: "FAST", purpose: "Summarize risks and rate.", tokens: "~400" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble analysis as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "whitepaper-summary": {
    meta: {
      name: "Whitepaper Summarizer", category: "Crypto", band: "medium", runtime: "~55s",
      description: "Turn a long whitepaper into a structured summary with claims to verify.",
      longDesc: "Splits the whitepaper into sections, summarizes the thesis and the mechanism/tokenomics, and flags notable claims and assumptions.",
      inputLabel: "Whitepaper text",
      inputHint: "Paste the whitepaper text (or the key sections).",
      outputHint: "A structured summary: thesis, mechanism, tokenomics, and claims to verify.",
      limits: { inputChars: 16000, outputWords: 1500 },
      examplePrompt: "Summarize this whitepaper (text pasted) for a busy investor.",
      exampleOutput: "# Whitepaper Summary\n\n## Thesis\nA decentralized compute marketplace matching idle GPUs with AI workloads.\n\n## Problem & Solution\nGPU scarcity; a token-incentivized network of providers.\n\n## Mechanism\nProof-of-compute validation; on-chain settlement.\n\n## Tokenomics\nToken pays for compute and rewards providers.\n\n## Claims to Verify\n- Provider supply at launch; validation cost; real demand.",
    },
    specs: [
      { key: "section_splitter", name: "Section Splitter", alias: "FAST", purpose: "Identify sections and central claims.", tokens: "~400" },
      { key: "core_summary", name: "Core Summary", alias: "STRONG", purpose: "Summarize thesis, problem, solution.", tokens: "~700" },
      { key: "mechanism_summary", name: "Mechanism & Token Summary", alias: "STRONG", purpose: "Summarize mechanism and tokenomics.", tokens: "~700" },
      { key: "claims_flags", name: "Claims & Flags", alias: "FAST", purpose: "List claims and things to verify.", tokens: "~400" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble summary as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "narrative-scan": {
    meta: {
      name: "Narrative / Sector Scan", category: "Crypto", band: "heavy", runtime: "~85s",
      description: "Research a crypto narrative or sector: key projects, trends, catalysts, and risks.",
      longDesc: "Frames the narrative, researches it online, maps the key projects, identifies trends and catalysts, and gives a balanced take with sources.",
      inputLabel: "Narrative or sector",
      inputHint: "Name the narrative or sector (e.g. 'restaking', 'RWA', 'AI agents on-chain').",
      outputHint: "Key projects, trends, catalysts, risks, opportunities, and sources.",
      limits: { inputChars: 2000, outputWords: 2000 },
      examplePrompt: "Scan the on-chain AI agents narrative: who is building, trends, and risks.",
      exampleOutput: "# Narrative Scan: On-chain AI Agents\n\n## Overview\nAgents that hold wallets and transact autonomously.\n\n## Key Projects\n| Project | What it does | Edge |\n|---|---|---|\n| Example | Agent payments | First mover |\n\n## Trends & Catalysts\nAgent payment rails, x402 adoption.\n\n## Risks\nHype, thin revenue, security of autonomous spend.\n\n## Sources\n- (URLs gathered during research)",
    },
    specs: [
      { key: "narrative_framer", name: "Narrative Framer", alias: "FAST", purpose: "Frame the narrative and questions.", tokens: "~300" },
      { key: "web_research", name: "Web Research", alias: "RESEARCH", purpose: "Research projects, trends, catalysts.", tokens: "~2500" },
      { key: "project_mapper", name: "Project Mapper", alias: "STRONG", purpose: "Map key projects and their edge.", tokens: "~700" },
      { key: "trend_catalyst", name: "Trends & Catalysts", alias: "STRONG", purpose: "Identify trends, catalysts, risks.", tokens: "~600" },
      { key: "opportunity_take", name: "Opportunity & Take", alias: "STRONG", purpose: "Opportunities and a balanced take.", tokens: "~600" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble scan as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "competitor-analysis": {
    meta: {
      name: "Competitor Analysis", category: "Business", band: "heavy", runtime: "~80s",
      description: "Research competitors and produce a positioning comparison, gaps, and a SWOT.",
      longDesc: "Identifies the competitors, researches them online, builds a comparison matrix, finds market gaps, and writes a SWOT relative to the competition.",
      inputLabel: "Your company + competitors",
      inputHint: "Describe your company/product and name competitors (or the market to scan).",
      outputHint: "A comparison table, market gaps, a SWOT, and cited sources.",
      limits: { inputChars: 4000, outputWords: 2000 },
      examplePrompt: "Analyze competitors for a USDC invoicing tool for freelancers vs Request, Coinbase Commerce.",
      exampleOutput: "# Competitor Analysis\n\n## Comparison\n| Competitor | Offering | Pricing | Strengths | Weaknesses |\n|---|---|---|---|---|\n| Request | Crypto invoicing | Free/fee | Brand | UX |\n\n## Market Gaps\nFiat-grade UX with instant USDC settlement.\n\n## SWOT\nStrengths: speed. Threats: incumbents.\n\n## Sources\n- (URLs gathered during research)",
    },
    specs: [
      { key: "scope_extractor", name: "Scope Extractor", alias: "FAST", purpose: "Identify company, market, competitors.", tokens: "~300" },
      { key: "web_research", name: "Web Research", alias: "RESEARCH", purpose: "Research competitors online.", tokens: "~2500" },
      { key: "positioning_map", name: "Positioning Map", alias: "STRONG", purpose: "Build the comparison matrix.", tokens: "~700" },
      { key: "gap_finder", name: "Gap Finder", alias: "STRONG", purpose: "Find gaps and differentiation.", tokens: "~500" },
      { key: "swot", name: "SWOT vs Competitors", alias: "STRONG", purpose: "SWOT relative to competition.", tokens: "~500" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble analysis as Markdown + JSON.", tokens: "~1600" },
    ],
  },
  "gtm-plan": {
    meta: {
      name: "Go-to-Market Plan", category: "Business", band: "medium", runtime: "~65s",
      description: "Turn a product into a GTM plan: segments, positioning, channels, and milestones.",
      longDesc: "Extracts the product and goals, defines target segments and ICP, writes positioning and messaging, plans channels and tactics, and sets milestones and KPIs.",
      inputLabel: "Product + goals",
      inputHint: "Describe the product, target audience, and launch goals.",
      outputHint: "Segments and ICP, positioning, channels, and milestones with KPIs.",
      limits: { inputChars: 4000, outputWords: 2000 },
      examplePrompt: "GTM plan for a USDC payroll tool aimed at remote-first startups.",
      exampleOutput: "# Go-to-Market Plan\n\n## Segments & ICP\nRemote-first startups, 10-50 staff, paying contractors globally.\n\n## Positioning & Messaging\nPay your global team in minutes, not days.\n\n## Channels & Tactics\nFounder communities, content, partnerships.\n\n## Milestones & KPIs\nBeta 20 teams; activation rate; payroll volume.",
    },
    specs: [
      { key: "product_extractor", name: "Product Extractor", alias: "FAST", purpose: "Extract product, audience, goals.", tokens: "~300" },
      { key: "segment_targeting", name: "Segment & Targeting", alias: "STRONG", purpose: "Define segments and ICP.", tokens: "~600" },
      { key: "positioning_messaging", name: "Positioning & Messaging", alias: "STRONG", purpose: "Positioning and messages per segment.", tokens: "~600" },
      { key: "channel_plan", name: "Channel Plan", alias: "STRONG", purpose: "Channels and tactics.", tokens: "~600" },
      { key: "milestones_metrics", name: "Milestones & Metrics", alias: "FAST", purpose: "Milestones and KPIs.", tokens: "~400" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the plan as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "lean-canvas": {
    meta: {
      name: "Lean Canvas / Business Model", category: "Business", band: "medium", runtime: "~55s",
      description: "Turn an idea into a Lean Canvas with riskiest assumptions and validation experiments.",
      longDesc: "Extracts the idea, fills all nine Lean Canvas blocks, surfaces the riskiest assumptions, and proposes cheap experiments to validate them.",
      inputLabel: "Business idea",
      inputHint: "Describe the idea, the customer, and the problem it solves.",
      outputHint: "A filled Lean Canvas, riskiest assumptions, and validation experiments.",
      limits: { inputChars: 4000, outputWords: 1800 },
      examplePrompt: "Lean canvas for a tool that auto-invoices freelancers in USDC when a milestone is marked done.",
      exampleOutput: "# Lean Canvas\n\n| Block | Notes |\n|---|---|\n| Problem | Freelancers chase payments |\n| Solution | Auto-invoice on milestone |\n| UVP | Get paid the moment work is done |\n| Segments | Solo freelancers |\n| Revenue | Small fee per invoice |\n\n## Riskiest Assumptions\nFreelancers will let a tool trigger invoices.\n\n## Experiments\nLanding page + 20 interviews.",
    },
    specs: [
      { key: "idea_extractor", name: "Idea Extractor", alias: "FAST", purpose: "Extract idea, customer, problem.", tokens: "~300" },
      { key: "canvas_builder", name: "Canvas Builder", alias: "STRONG", purpose: "Fill the nine Lean Canvas blocks.", tokens: "~900" },
      { key: "assumptions_risks", name: "Assumptions & Risks", alias: "STRONG", purpose: "Surface riskiest assumptions.", tokens: "~500" },
      { key: "experiments", name: "Validation Experiments", alias: "FAST", purpose: "Propose cheap experiments.", tokens: "~400" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the canvas as Markdown + JSON.", tokens: "~1400" },
    ],
  },
  "swot-analysis": {
    meta: {
      name: "SWOT Analysis", category: "Business", band: "light", runtime: "~45s",
      description: "Produce a SWOT plus SO/WO/ST/WT strategies and prioritized actions.",
      longDesc: "Extracts the context, produces a specific SWOT, derives strategies for each quadrant pairing, and lists prioritized actions.",
      inputLabel: "Company or product",
      inputHint: "Describe the company/product and any relevant context.",
      outputHint: "A SWOT matrix, strategies, and prioritized actions.",
      limits: { inputChars: 4000, outputWords: 1500 },
      examplePrompt: "SWOT for a small design studio moving into Web3 branding.",
      exampleOutput: "# SWOT Analysis\n\n| | Helpful | Harmful |\n|---|---|---|\n| Internal | Strong design craft | No Web3 network |\n| External | Growing Web3 demand | Crowded freelancers |\n\n## Strategies\nSO: showcase Web3 case studies. WT: niche down.\n\n## Prioritized Actions\n1. Publish 2 Web3 brand case studies.",
    },
    specs: [
      { key: "context_extractor", name: "Context Extractor", alias: "FAST", purpose: "Extract company/product and context.", tokens: "~300" },
      { key: "swot_generator", name: "SWOT Generator", alias: "STRONG", purpose: "Produce a specific SWOT.", tokens: "~700" },
      { key: "strategy_actions", name: "Strategies & Actions", alias: "STRONG", purpose: "Derive strategies and actions.", tokens: "~600" },
      { key: "formatter", name: "Final Formatter", alias: "FORMATTER", purpose: "Assemble the SWOT as Markdown + JSON.", tokens: "~1200" },
    ],
  },
};
// Measured per-run display prices, mirroring server.js WORKFLOW_PRICE_OVERRIDES.
// Filled in as each workflow is run and finalized (real cost rounded to a clean
// value). Overrides the band price for the explore card and tier selector.
const WF_PRICE_OVERRIDES = {
  "call-recap": { normal: "0.01", plus: "0.01", pro: "0.02" },
};
Object.keys(WF_CATALOG).forEach((slug) => {
  WORKFLOWS[slug] = makeWorkflow(WF_CATALOG[slug].meta, WF_CATALOG[slug].specs);
  const ov = WF_PRICE_OVERRIDES[slug];
  if (ov) {
    const wf = WORKFLOWS[slug];
    ["normal", "plus", "pro"].forEach((t) => { if (wf.tiers[t] && ov[t]) wf.tiers[t].price = ov[t]; });
    if (ov.normal) wf.price = ov.normal;
  }
});

const CATEGORY_COLORS = {
  Freelance: "var(--gold)",
  "Client Communication": "#6df7a0",
  Proposal: "#f2d27a",
  Research: "#7eb8f7",
  Sales: "#ff9a8b",
  Operations: "#9ad0ff",
  Delivery: "#7af2c2",
  SEO: "#b388ff",
  Code: "#b388ff",
  Content: "#6df7a0",
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
async function fundWorkflowRun(slug, statusFn, tier) {
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
    body: JSON.stringify({ tier: tier || "normal" }),
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

// Build a professional, Word-compatible document (.doc) from the markdown result.
// Uses the HTML-as-Word approach (no external library): the report is rendered to
// HTML, wrapped in a Word XML/HTML shell with print styles, fonts, headings, and
// bordered tables. MS Word, Google Docs, and Pages all open it with formatting.
function buildWordDoc(markdown, title) {
  const body = renderMarkdown(markdown);
  const safeTitle = esc(title || "Workflow Result");
  let date = "";
  try { date = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }); } catch (_) {}
  return "<!DOCTYPE html>\n"
    + "<html xmlns:o=\"urn:schemas-microsoft-com:office:office\" xmlns:w=\"urn:schemas-microsoft-com:office:word\" xmlns=\"http://www.w3.org/TR/REC-html40\">\n"
    + "<head><meta charset=\"utf-8\"><title>" + safeTitle + "</title>\n"
    + "<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom><w:DoNotOptimizeForBrowser/></w:WordDocument></xml><![endif]-->\n"
    + "<style>\n"
    + "@page { size: A4; margin: 2.2cm; }\n"
    + "body { font-family: Calibri, 'Segoe UI', Arial, sans-serif; font-size: 11pt; color: #1a1a1a; line-height: 1.5; }\n"
    + ".doc-header { border-bottom: 2px solid #b8860b; padding-bottom: 10px; margin-bottom: 22px; }\n"
    + ".doc-title { font-size: 22pt; font-weight: 700; color: #14110a; margin: 0 0 4px 0; }\n"
    + ".doc-meta { font-size: 9.5pt; color: #6b6b6b; }\n"
    + "h1 { font-size: 18pt; color: #14110a; margin: 20px 0 8px; }\n"
    + "h2 { font-size: 14pt; color: #14110a; border-bottom: 1px solid #e5e0d5; padding-bottom: 3px; margin: 18px 0 8px; }\n"
    + "h3 { font-size: 12pt; color: #3a3320; margin: 14px 0 6px; }\n"
    + "h4, h5, h6 { font-size: 11pt; color: #3a3320; margin: 12px 0 6px; }\n"
    + "p { margin: 0 0 10px; }\n"
    + "ul, ol { margin: 0 0 10px 22px; }\n"
    + "li { margin: 0 0 4px; }\n"
    + "table { border-collapse: collapse; width: 100%; margin: 10px 0 16px; font-size: 10pt; }\n"
    + "th, td { border: 1px solid #c9c2b2; padding: 6px 9px; text-align: left; vertical-align: top; }\n"
    + "th { background: #f5efdf; font-weight: 700; }\n"
    + "pre { background: #f4f1ea; border: 1px solid #ddd6c5; padding: 10px; font-family: Consolas, 'Courier New', monospace; font-size: 9.5pt; white-space: pre-wrap; }\n"
    + "code { font-family: Consolas, 'Courier New', monospace; }\n"
    + "a { color: #9a7a16; }\n"
    + "hr { border: none; border-top: 1px solid #e5e0d5; margin: 16px 0; }\n"
    + ".doc-footer { margin-top: 26px; padding-top: 10px; border-top: 1px solid #e5e0d5; font-size: 8.5pt; color: #8a8a8a; }\n"
    + "</style></head>\n"
    + "<body>\n"
    + "<div class=\"doc-header\"><div class=\"doc-title\">" + safeTitle + "</div>"
    + "<div class=\"doc-meta\">Generated by Fundline" + (date ? " on " + esc(date) : "") + "</div></div>\n"
    + body + "\n"
    + "<div class=\"doc-footer\">Created with Fundline Workflows - fundline.xyz</div>\n"
    + "</body></html>";
}

function slugifyForFile(str) {
  return String(str || "workflow").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "workflow";
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
            <button class="wf-result-btn" id="wfModalDownload" type="button">Download .doc</button>
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
    const title = (WORKFLOWS[slug] && WORKFLOWS[slug].name) || "Workflow Result";
    const doc = buildWordDoc(markdown, title);
    // UTF-8 BOM so Word reads accented characters correctly.
    const blob = new Blob(["﻿", doc], { type: "application/msword" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugifyForFile(title)}-result.doc`;
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
          ${["All"].concat(Array.from(new Set(Object.values(WORKFLOWS).map((wf) => wf.category))).sort()).map((c) =>
            `<button class="wf-filter-btn${c==="All"?" is-active":""}" data-cat="${esc(c)}" type="button">${esc(c)}</button>`
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
        <span class="wf-price">${esc(wf.price)} <span class="wf-price-unit">USDC / run</span></span>
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

// Build the canvas node list and grid HTML for a given set of steps.
// Returns { nodes, total, colParts, rowTpl, cellsHtml, summaryHtml }.
// Called by renderTabSteps (initial render) and by the tier-switch handler (redraw).
function buildCanvasLayout(steps, inputHint, outputHint) {
  const nodes = [
    { type: "input", idx: 0, name: "User Input", purpose: inputHint || "Your prompt or instructions" },
    ...steps.map((s, i) => ({ type: "ai", idx: i + 1, stepNum: i + 1, name: s.name, model: s.model, purpose: s.purpose })),
    { type: "output", idx: steps.length + 1, name: "Final Output", purpose: outputHint || "Ready to use result" },
  ];

  const total = nodes.length;
  const nodeCols = total <= 3 ? total : Math.ceil(total / 2);
  const twoRows = total > 3;

  const colParts = [];
  for (let c = 0; c < nodeCols; c++) {
    if (c > 0) colParts.push("44px");
    colParts.push("minmax(0, 1fr)");
  }
  const rowTpl = twoRows ? "auto 42px auto" : "auto";

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

  const summaryHtml = nodes.map((node, i) => {
    const label = node.type === "input" ? "Input" : node.type === "output" ? "Output" : "Step " + String(node.stepNum).padStart(2, "0");
    return `
    <tr data-step-row="${i}">
      <td><span class="wfg-row-label">${esc(label)}</span><span class="wfg-row-name">${esc(node.name)}</span></td>
      <td>${node.model ? `<span class="wf-graph-model-tag">${esc(node.model)}</span>` : '<span class="wf-muted">-</span>'}</td>
      <td class="wf-muted" style="font-size:12px;line-height:1.5">${esc(node.purpose)}</td>
      <td><span class="wfg-step-status wfg-step-status--pending">Pending</span></td>
    </tr>`;
  }).join("");

  return { nodes, total, colParts, rowTpl, cellsHtml: cells.join(""), summaryHtml };
}

function renderTabSteps(wf) {
  const layout = buildCanvasLayout(wf.steps, wf.inputHint, wf.outputHint);
  return `<div class="wf-tab-panel" data-panel="Workflow Steps">
    <div class="wfg-canvas">
      <div class="wfg-canvas-head">
        <div>
          <div class="wfg-canvas-title">Workflow Structure</div>
          <div class="wfg-canvas-sub">Transparent execution steps and models.</div>
        </div>
        <div class="wfg-chips">
          <span class="wfg-chip">${layout.total} nodes</span>
          <span class="wfg-chip">${wf.modelCount} AI models</span>
          <span class="wfg-chip">${esc(wf.runtime)}</span>
        </div>
      </div>
      <div class="wfg2-board">
        <div class="wfg2-grid" id="wfCanvasGrid" style="grid-template-columns:${layout.colParts.join(" ")};grid-template-rows:${layout.rowTpl}">
          ${layout.cellsHtml}
        </div>
      </div>
      <div class="wfg-summary">
        <div class="wfg-summary-hd">Execution Summary</div>
        <div class="wf-table-wrap">
          <table class="wfg-sum-table">
            <thead><tr><th>Step</th><th>Model</th><th>Purpose</th><th>Status</th></tr></thead>
            <tbody id="wfSummaryTbody">${layout.summaryHtml}</tbody>
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

  const initPrice = wf.tiers ? wf.tiers.normal.price : wf.price;
  const tierSelector = wf.tiers ? `
    <div class="wf-tier-selector" id="wfTierSelector">
      <button class="wf-tier-btn is-active" data-tier="normal" type="button">Normal</button>
      <button class="wf-tier-btn" data-tier="plus" type="button">Plus</button>
      <button class="wf-tier-btn" data-tier="pro" type="button">Pro</button>
    </div>` : `<h3>Run this workflow</h3>`;

  return `
    <div class="wf-run-header">
      ${tierSelector}
      <div class="wf-run-price-tag" id="wfPriceTag">${esc(initPrice)} USDC / run</div>
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

    ${isBillingEnabled(wf) ? `<p class="wf-run-hint wf-muted" id="wfBillingHint">Pay ${esc(initPrice)} USDC per run from your connected wallet (sidebar). Refunded if the run fails.</p>` : ""}

    <button class="wf-btn-run" id="wfRunBtn" type="button" data-slug="${esc(slug)}">
      <svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>
      ${isBillingEnabled(wf) ? `Pay ${esc(initPrice)} USDC and run` : "Run Workflow"}
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
    let activeTier = "normal";

    // Tier selector: Normal / Plus / Pro
    const tierSel = document.getElementById("wfTierSelector");
    if (tierSel && wf.tiers) {
      tierSel.addEventListener("click", (e) => {
        const btn = e.target.closest(".wf-tier-btn");
        if (!btn || btn.dataset.tier === activeTier) return;
        activeTier = btn.dataset.tier;

        tierSel.querySelectorAll(".wf-tier-btn").forEach((b) => b.classList.toggle("is-active", b === btn));

        const tierDef = wf.tiers[activeTier];
        const tierPrice = tierDef.price;

        const priceTag = document.getElementById("wfPriceTag");
        if (priceTag) priceTag.textContent = `${tierPrice} USDC / run`;

        const billingHint = document.getElementById("wfBillingHint");
        if (billingHint) billingHint.textContent = `Pay ${tierPrice} USDC per run from your connected wallet (sidebar). Refunded if the run fails.`;

        const runBtn = document.getElementById("wfRunBtn");
        if (runBtn && !runBtn.disabled) {
          const runIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/></svg>`;
          runBtn.innerHTML = `${runIcon} ${isBillingEnabled(wf) ? `Pay ${tierPrice} USDC and run` : "Run Workflow"}`;
        }

        // Redraw the canvas and summary table with the selected tier's steps.
        const layout = buildCanvasLayout(tierDef.steps, wf.inputHint, wf.outputHint);
        const canvasGrid = document.getElementById("wfCanvasGrid");
        if (canvasGrid) {
          canvasGrid.style.gridTemplateColumns = layout.colParts.join(" ");
          canvasGrid.style.gridTemplateRows = layout.rowTpl;
          canvasGrid.innerHTML = layout.cellsHtml;
        }
        const summaryTbody = document.getElementById("wfSummaryTbody");
        if (summaryTbody) summaryTbody.innerHTML = layout.summaryHtml;

        switchToTab("Workflow Steps");
      });
    }

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
        fundWorkflowRun(slug, (text) => { runBtn.innerHTML = esc(text); }, activeTier)
          .then((runId) => runWorkflow(slug, wf, { prompt, mode: retrievalMode, sources, runId, tier: activeTier }))
          .catch((err) => {
            runBtn.disabled = false;
            runBtn.innerHTML = `${runIcon} Run Workflow`;
            displayRunError(err.message || "Payment was not completed.");
          });
      } else {
        runWorkflow(slug, wf, { prompt, mode: retrievalMode, sources, tier: activeTier });
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

  // Use the selected tier's steps for node indexing; fall back to wf.steps (normal tier).
  const tier = opts.tier || "normal";
  const tierDef = wf.tiers && wf.tiers[tier];
  const activeSteps = tierDef ? tierDef.steps : wf.steps;
  const tierPrice = tierDef ? tierDef.price : wf.price;

  // Node layout: 0 = User Input, 1..N = steps, N+1 = Final Output
  const stepCount = activeSteps.length;
  const outputIdx = stepCount + 1;
  const totalNodes = stepCount + 2;
  for (let j = 0; j < totalNodes; j++) {
    setNodeState(j, "pending");
    setStepRowState(j, "pending");
  }

  // Build serverKey -> node index map so SSE progress events update the right node.
  const keyToIdx = {};
  activeSteps.forEach((s, i) => {
    if (s.serverKey) keyToIdx[s.serverKey] = i + 1;
  });

  const reqBody = { prompt: opts.prompt, mode: opts.mode, tier };
  if (opts.sources && opts.sources.length) reqBody.sources = opts.sources;
  if (opts.runId) reqBody.runId = opts.runId;

  (async () => {
    setNodeState(0, "completed");
    setStepRowState(0, "completed");

    let response;
    try {
      response = await fetch(`/api/workflows/${slug}/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(reqBody),
      });
    } catch (err) {
      showRunError({ message: err.message });
      restoreBtn();
      return;
    }

    // Pre-stream errors (billing, rate limit, etc.) arrive as normal JSON.
    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      setNodeState(1, "failed");
      setStepRowState(1, "failed");
      showRunError(errData);
      restoreBtn();
      return;
    }

    // Consume the SSE stream and drive node states from real server events.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let resultData = null;
    let errorData = null;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE events are separated by double newlines.
        const parts = buffer.split("\n\n");
        buffer = parts.pop() || "";

        for (const part of parts) {
          if (!part.trim()) continue;
          let evName = "message";
          let evData = "";
          for (const line of part.split("\n")) {
            if (line.startsWith("event: ")) evName = line.slice(7).trim();
            else if (line.startsWith("data: ")) evData = line.slice(6);
          }
          if (!evData) continue;
          let parsed;
          try { parsed = JSON.parse(evData); } catch { continue; }

          if (evName === "progress") {
            const nodeIdx = keyToIdx[parsed.step];
            if (nodeIdx != null) {
              if (parsed.status === "running") {
                setNodeState(nodeIdx, "running");
                setStepRowState(nodeIdx, "running");
              } else if (parsed.status === "done") {
                setNodeState(nodeIdx, "completed");
                setStepRowState(nodeIdx, "completed");
              }
            }
          } else if (evName === "result") {
            resultData = parsed;
          } else if (evName === "error") {
            errorData = parsed;
          }
        }
      }
    } catch (streamErr) {
      errorData = { message: streamErr.message };
    }

    if (errorData) {
      // Mark any node still in running state as failed.
      for (let k = 1; k <= stepCount; k++) {
        const node = document.querySelector(`.wfg2-node[data-node-idx="${k}"]`);
        if (node && node.classList.contains("wfg2-node--running")) {
          setNodeState(k, "failed");
          setStepRowState(k, "failed");
        }
      }
      showRunError(errorData);
      restoreBtn();
      return;
    }

    if (resultData) {
      setNodeState(outputIdx, "completed");
      setStepRowState(outputIdx, "completed");
      showRunResult(resultData);
      restoreBtn();
    }
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
      charged: tierPrice,
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
      charged: tierPrice,
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
    const steps = Array.isArray(data.steps) ? data.steps : [];
    const stepRows = steps.map((s) =>
      `<div class="wf-receipt-step"><span>${esc(s.name)}</span><span class="wf-graph-model-tag">${s.model ? esc(s.model) : "-"}</span></div>`
    ).join("");
    document.getElementById("wfReceiptBody").innerHTML = `
      <div class="wf-receipt-row"><span>Workflow</span><span>${esc(wf.name)}</span></div>
      <div class="wf-receipt-row"><span>Status</span><span class="wf-status-done">Completed</span></div>
      <div class="wf-receipt-steps">${stepRows}</div>
      <div class="wf-receipt-row"><span>Charged</span><span class="wf-receipt-price">${esc(tierPrice)} USDC</span></div>
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

  const explorer = WF_CONFIG.explorerBase || "https://testnet.arcscan.app";
  const rows = RUN_HISTORY.map((r, idx) => {
    // Shorten run ID: "0x6d8f...b60e" or keep short randId as-is
    const shortId = r.id.startsWith("0x")
      ? r.id.slice(0, 6) + "..." + r.id.slice(-4)
      : r.id;
    const tx = r.releaseTx
      ? `<a class="wf-link wf-mono" href="${esc(explorer + "/tx/" + r.releaseTx)}" target="_blank" rel="noopener">${esc(r.releaseTx.slice(0, 6) + "..." + r.releaseTx.slice(-4))}</a>`
      : `<span class="wf-muted">-</span>`;
    const statusCls = r.status === "completed" ? "wf-status-done" : "wf-status-failed";
    const viewBtn = r.output
      ? `<button class="wf-receipt-btn" type="button" data-idx="${idx}">View</button>`
      : `<button class="wf-receipt-btn" type="button" disabled style="opacity:0.35;cursor:default">View</button>`;
    return `<tr>
      <td><div class="wf-hist-cell">
        <span class="wf-hist-workflow" data-nav="/workflows/${esc(r.slug)}">${esc(r.workflow)}</span>
        <span class="wf-hist-id wf-mono">${esc(shortId)}</span>
      </div></td>
      <td>${tx}</td>
      <td class="wf-hist-charged">${esc(r.charged)} <span class="wf-muted" style="font-size:11px;font-weight:400">USDC</span></td>
      <td><span class="wf-run-status ${statusCls}">${r.status}</span></td>
      <td class="wf-hist-date">${esc(r.at)}</td>
      <td>${viewBtn}</td>
    </tr>`;
  }).join("");

  return header + `
    <div class="wf-explore-body">
      <p class="wf-hist-meta">${RUN_HISTORY.length} run${RUN_HISTORY.length === 1 ? "" : "s"} this session</p>
      <div class="wf-table-wrap">
        <table class="wf-runs-table">
          <thead><tr>
            <th>Workflow</th><th>Transaction</th>
            <th>Charged</th><th>Status</th><th>Date</th><th></th>
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
