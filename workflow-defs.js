"use strict";

// Workflow graph definitions: the per-node chain logic and prompts for each
// runnable workflow, consumed by workflow-engine.js. This is the single source of
// truth for what each workflow DOES. Pricing and the per-tier alias -> model map
// live separately in server.js WORKFLOW_RUN_DEFS (deployment config), while the
// frontend WORKFLOWS catalog mirrors only the display metadata.
//
// Each node: { id, name, alias, maxTokens, build(ctx)->messages[], parse?, retrieval?, isFinal?, kind?, run? }
// Model aliases used across workflows (resolved per tier in server.js):
//   FAST      - extract, classify, clean, format, validate
//   STRONG    - main generation, proposals, reports, reasoning
//   RESEARCH  - web/search-aware retrieval (search models, or pasted sources)
//   CODE      - code review and PR review
//   FORMATTER - final Markdown + JSON assembly
// A node picks the alias that fits its function; the tier decides the concrete
// model. See .claude/skills/v98store-api for the id map.

const research = require("./workflow-research");

// --- helpers ---------------------------------------------------------------

// Read a prior node output (empty string if not produced).
function out(ctx, id) {
  return ctx.outputs[id] || "";
}

// Build an LLM (or local) node from a compact spec.
// spec: { id, name, alias, maxTokens, system, user(ctx), retrieval, parse, isFinal, run }
function step(spec) {
  const node = { id: spec.id, name: spec.name, alias: spec.alias, maxTokens: spec.maxTokens || 1200 };
  if (typeof spec.run === "function") {
    node.kind = "local";
    node.run = spec.run;
  } else {
    node.build = (ctx) => [
      { role: "system", content: spec.system },
      { role: "user", content: spec.user(ctx) },
    ];
  }
  if (spec.retrieval) node.retrieval = true;
  if (typeof spec.parse === "function") node.parse = spec.parse;
  if (spec.isFinal) node.isFinal = true;
  return node;
}

// Standard instruction appended to every final formatter node so the deliverable
// is a clean client-ready Markdown document that also carries machine-readable
// JSON at the end (Markdown + JSON in one output).
const FORMATTER_SYSTEM = "You are a meticulous editor. You assemble the working notes from earlier steps into a single, clean, client-ready Markdown document. Do not invent facts beyond the notes. Use #, ##, ### headers and tables where helpful. After the Markdown, append a fenced code block labelled json containing a structured summary of the key fields. Output only the document.";

// --- 1. Client Call Recap & Action Plan -----------------------------------
const callRecap = {
  name: "Client Call Recap & Action Plan",
  nodes: [
    step({ id: "transcript_cleaner", name: "Transcript Cleaner", alias: "FAST", maxTokens: 1500,
      system: "You clean raw meeting transcripts. Fix obvious transcription noise, remove filler, and label speakers (Speaker A/B or names if clear). Keep all substantive content. Output only the cleaned transcript.",
      user: (ctx) => `Raw transcript / call notes:\n${ctx.input}` }),
    step({ id: "meeting_summary", name: "Meeting Summarizer", alias: "STRONG", maxTokens: 700,
      system: "You summarize client calls for a freelancer or agency. Be concise and concrete.",
      user: (ctx) => `Summarize this call in 5-8 bullet points covering context, what was discussed, and outcomes.\n\nTranscript:\n${out(ctx, "transcript_cleaner")}` }),
    step({ id: "decision_extractor", name: "Decision Extractor", alias: "FAST", maxTokens: 500,
      system: "You extract only the decisions that were firmly agreed on the call. If none, say so.",
      user: (ctx) => `List the confirmed decisions as bullets. Quote the basis briefly.\n\nSummary:\n${out(ctx, "meeting_summary")}\n\nTranscript:\n${out(ctx, "transcript_cleaner")}` }),
    step({ id: "action_items", name: "Action Item Extractor", alias: "FAST", maxTokens: 600,
      system: "You turn a call into actionable tasks. Each task has an owner, a deadline (or 'TBD'), and a priority (High/Medium/Low).",
      user: (ctx) => `Produce a Markdown table of action items with columns Task | Owner | Deadline | Priority.\n\nSummary:\n${out(ctx, "meeting_summary")}\n\nTranscript:\n${out(ctx, "transcript_cleaner")}` }),
    step({ id: "risk_blocker", name: "Risk & Blocker Detector", alias: "STRONG", maxTokens: 500,
      system: "You spot risks, open questions, and blockers a freelancer should not miss.",
      user: (ctx) => `List risks, open questions, and blockers as bullets, each with a one-line suggested mitigation.\n\nSummary:\n${out(ctx, "meeting_summary")}\n\nTranscript:\n${out(ctx, "transcript_cleaner")}` }),
    step({ id: "followup_email", name: "Follow-up Email Generator", alias: "STRONG", maxTokens: 700,
      system: "You write a concise, professional follow-up email to the client after a call. Friendly, clear, no fluff.",
      user: (ctx) => `Write a follow-up email recapping the call and confirming next steps.\n\nSummary:\n${out(ctx, "meeting_summary")}\n\nDecisions:\n${out(ctx, "decision_extractor")}\n\nAction items:\n${out(ctx, "action_items")}` }),
    step({ id: "billables", name: "Suggested Billables Detector", alias: "FAST", maxTokens: 400,
      system: "You identify work discussed on the call that could become a billable line item or invoice. Be conservative; only flag clear scope.",
      user: (ctx) => `List suggested billable items as bullets (description + rough basis). If nothing is clearly billable, say so.\n\nAction items:\n${out(ctx, "action_items")}\n\nTranscript:\n${out(ctx, "transcript_cleaner")}` }),
    step({ id: "formatter", name: "Final Output Formatter", alias: "FORMATTER", maxTokens: 2000, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Call Recap & Action Plan document with sections: Summary, Decisions, Action Items (keep the table), Risks & Blockers, Suggested Billables, and the Follow-up Email.\n\nSummary:\n${out(ctx, "meeting_summary")}\n\nDecisions:\n${out(ctx, "decision_extractor")}\n\nAction items:\n${out(ctx, "action_items")}\n\nRisks:\n${out(ctx, "risk_blocker")}\n\nBillables:\n${out(ctx, "billables")}\n\nFollow-up email:\n${out(ctx, "followup_email")}` }),
  ],
};

// --- 2. Proposal & Scope of Work Builder ----------------------------------
const proposalSow = {
  name: "Proposal & Scope of Work Builder",
  nodes: [
    step({ id: "requirement_extractor", name: "Requirement Extractor", alias: "FAST", maxTokens: 700,
      system: "You extract requirements, goals, and constraints from a project brief for a freelancer or agency.",
      user: (ctx) => `From this brief, extract: client + project, goals, requirements, constraints, budget, timeline. Use labelled bullets; mark anything missing as 'Not specified'.\n\nBrief:\n${ctx.input}` }),
    step({ id: "context_synth", name: "Client Context Synthesizer", alias: "STRONG", maxTokens: 600,
      system: "You synthesize any provided client/research context into a short positioning note. Use only what is given; do not fabricate facts about the client.",
      user: (ctx) => `Write a short context note: who the client likely is, what they value, and how to position this proposal. If little context is given, keep it generic and say so.\n\nExtracted requirements:\n${out(ctx, "requirement_extractor")}\n\nOriginal brief:\n${ctx.input}` }),
    step({ id: "proposal_generator", name: "Proposal Generator", alias: "STRONG", maxTokens: 1800,
      system: "You write client-ready freelance/agency proposals: executive summary, understanding of the problem, proposed approach, and why-us. Professional and specific.",
      user: (ctx) => `Write the proposal body (no scope/milestones yet; those come later).\n\nRequirements:\n${out(ctx, "requirement_extractor")}\n\nContext:\n${out(ctx, "context_synth")}` }),
    step({ id: "sow_generator", name: "SOW Generator", alias: "STRONG", maxTokens: 1000,
      system: "You write a precise Scope of Work: deliverables, in-scope, and explicit out-of-scope items to prevent scope creep.",
      user: (ctx) => `Write a Scope of Work with three sections: Deliverables, In Scope, Out of Scope.\n\nRequirements:\n${out(ctx, "requirement_extractor")}\n\nProposal:\n${out(ctx, "proposal_generator")}` }),
    step({ id: "milestone_builder", name: "Milestone Builder", alias: "FAST", maxTokens: 600,
      system: "You break a SOW into milestones with a rough timeline and a payment-schedule hint per milestone.",
      user: (ctx) => `Produce a Markdown table: Milestone | Deliverable | Est. Duration | Payment Hint.\n\nSOW:\n${out(ctx, "sow_generator")}\n\nRequirements:\n${out(ctx, "requirement_extractor")}` }),
    step({ id: "risk_assumption", name: "Risk & Assumption Checker", alias: "STRONG", maxTokens: 500,
      system: "You review a proposal for gaps. List assumptions made, acceptance criteria, and questions to confirm with the client.",
      user: (ctx) => `List Assumptions, Acceptance Criteria, and Open Questions as three bullet sections.\n\nProposal:\n${out(ctx, "proposal_generator")}\n\nSOW:\n${out(ctx, "sow_generator")}` }),
    step({ id: "formatter", name: "Final Document Formatter", alias: "FORMATTER", maxTokens: 2200, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a single proposal document: Proposal, Scope of Work, Milestones & Payment (keep the table), Assumptions & Acceptance Criteria, Open Questions.\n\nProposal:\n${out(ctx, "proposal_generator")}\n\nSOW:\n${out(ctx, "sow_generator")}\n\nMilestones:\n${out(ctx, "milestone_builder")}\n\nRisks/Assumptions:\n${out(ctx, "risk_assumption")}` }),
  ],
};

// --- 4. Market Pain Point Research (retrieval) -----------------------------
const marketPain = {
  name: "Market Pain Point Research",
  nodes: [
    step({ id: "source_cleaner", name: "Source Context Cleaner", alias: "FAST", maxTokens: 800,
      system: "You normalize messy community/forum/social/web text into clean, deduplicated notes. Keep concrete complaints and quotes.",
      user: (ctx) => `Clean and condense the following input for analysis. Keep specific pains and quotes.\n\nTopic / audience / sources:\n${ctx.input}` }),
    step({ id: "web_research", name: "Web/Community Research", alias: "RESEARCH", maxTokens: 3500, retrieval: true,
      system: "You are a market research assistant with web search capability.",
      user: (ctx) => `Research real market signals, complaints, and unmet needs for this topic and audience. Provide concrete findings with source URLs inline where available. Assume today is ${ctx.today}.\n\nTopic / audience:\n${ctx.input}\n\nCleaned context:\n${out(ctx, "source_cleaner")}` }),
    step({ id: "pain_clusterer", name: "Pain Point Clusterer", alias: "FAST", maxTokens: 700,
      system: "You cluster raw pains into named groups with a frequency/intensity sense.",
      user: (ctx) => `Group the pains into 4-8 named clusters; for each give a one-line description and example evidence.\n\nFindings:\n${out(ctx, "web_research")}` }),
    step({ id: "objection_extractor", name: "Objection Extractor", alias: "STRONG", maxTokens: 600,
      system: "You extract objections, complaints, and repeated needs that block buying or adoption.",
      user: (ctx) => `List the top objections and repeated needs as bullets, ranked by apparent frequency.\n\nClusters:\n${out(ctx, "pain_clusterer")}\n\nFindings:\n${out(ctx, "web_research")}` }),
    step({ id: "opportunity_mapper", name: "Opportunity Mapper", alias: "STRONG", maxTokens: 800,
      system: "You convert pains into concrete product/service opportunities.",
      user: (ctx) => `For each major pain cluster, propose an opportunity: the offer, who it serves, and why it wins. Use a table Pain | Opportunity | Why it wins.\n\nClusters:\n${out(ctx, "pain_clusterer")}\n\nObjections:\n${out(ctx, "objection_extractor")}` }),
    step({ id: "idea_generator", name: "Content/Outreach Idea Generator", alias: "STRONG", maxTokens: 700,
      system: "You generate content and outreach ideas grounded in real pains.",
      user: (ctx) => `Produce 6-10 content ideas and 3 outreach angles tied to specific pains.\n\nOpportunities:\n${out(ctx, "opportunity_mapper")}\n\nObjections:\n${out(ctx, "objection_extractor")}` }),
    step({ id: "formatter", name: "Final Research Formatter", alias: "FORMATTER", maxTokens: 2200, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Market Pain Point Research brief: Pain Clusters, Objections & Repeated Needs, Opportunity Map (keep the table), Content & Outreach Ideas, and a Sources list (URLs found during research).\n\nClusters:\n${out(ctx, "pain_clusterer")}\n\nObjections:\n${out(ctx, "objection_extractor")}\n\nOpportunities:\n${out(ctx, "opportunity_mapper")}\n\nIdeas:\n${out(ctx, "idea_generator")}\n\nFindings (for sources):\n${out(ctx, "web_research")}` }),
  ],
};

// --- 5. Code Review Report -------------------------------------------------
const codeReview = {
  name: "Code Review Report",
  nodes: [
    step({ id: "code_normalizer", name: "Code Normalizer", alias: "FAST", maxTokens: 600,
      system: "You detect the programming language and summarize the structure of a code snippet. Note entry points and any obvious noise.",
      user: (ctx) => `Identify the language and outline the structure (functions, classes, key flows). Note the review focus if the user gave one.\n\nCode / context:\n${ctx.input}` }),
    step({ id: "logic_review", name: "Logic Review", alias: "CODE", maxTokens: 1200,
      system: "You are a senior engineer reviewing for correctness: bugs, edge cases, off-by-one, null/undefined, race conditions, incorrect assumptions.",
      user: (ctx) => `List correctness issues. For each: location, problem, impact, and a concrete fix. If none, say so.\n\nStructure:\n${out(ctx, "code_normalizer")}\n\nCode:\n${ctx.input}` }),
    step({ id: "security_review", name: "Security Review", alias: "CODE", maxTokens: 1000,
      system: "You review code for security: injection, XSS, auth/authz, secrets, unsafe deserialization, SSRF, insecure crypto.",
      user: (ctx) => `List security findings with severity (Critical/High/Medium/Low), the risk, and remediation. If none, say so.\n\nCode:\n${ctx.input}` }),
    step({ id: "perf_review", name: "Performance Review", alias: "CODE", maxTokens: 800,
      system: "You review code for performance and complexity issues.",
      user: (ctx) => `List performance/complexity issues with the cost and a suggested optimization. If none, say so.\n\nCode:\n${ctx.input}` }),
    step({ id: "fix_suggestions", name: "Fix Suggestion Generator", alias: "CODE", maxTokens: 1000,
      system: "You propose concrete patches for the most important findings, with short code snippets.",
      user: (ctx) => `Propose fixes for the top findings as small code patches with a one-line rationale each.\n\nLogic:\n${out(ctx, "logic_review")}\n\nSecurity:\n${out(ctx, "security_review")}\n\nPerformance:\n${out(ctx, "perf_review")}` }),
    step({ id: "formatter", name: "Score & Severity Formatter", alias: "FORMATTER", maxTokens: 2000, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Code Review Report: an overall score (0-100) and a severity summary table (counts by severity), then sections Correctness, Security, Performance, and Suggested Fixes (keep code blocks).\n\nLogic:\n${out(ctx, "logic_review")}\n\nSecurity:\n${out(ctx, "security_review")}\n\nPerformance:\n${out(ctx, "perf_review")}\n\nFixes:\n${out(ctx, "fix_suggestions")}` }),
  ],
};

// --- 6. Upwork / Job Post Proposal Draft ----------------------------------
const upworkProposal = {
  name: "Upwork / Job Post Proposal Draft",
  nodes: [
    step({ id: "job_parser", name: "Job Post Parser", alias: "FAST", maxTokens: 600,
      system: "You parse a freelance job post into needs, required skills, budget signals, and likely hidden objections.",
      user: (ctx) => `Extract: stated needs, required skills, budget/timeline signals, and likely hidden concerns. The input also contains the freelancer profile and tone preference; separate them.\n\nInput:\n${ctx.input}` }),
    step({ id: "client_need", name: "Client Need Extractor", alias: "STRONG", maxTokens: 500,
      system: "You infer what the client really wants beyond the literal post (the underlying outcome).",
      user: (ctx) => `State the client's real underlying goal and the 2-3 things that will win the job.\n\nParsed post:\n${out(ctx, "job_parser")}` }),
    step({ id: "fit_matcher", name: "Freelancer Fit Matcher", alias: "FAST", maxTokens: 500,
      system: "You match a freelancer's profile and portfolio to a job's needs.",
      user: (ctx) => `Map the freelancer's relevant strengths/portfolio to the job needs. Note the single strongest proof point.\n\nParsed post + profile:\n${out(ctx, "job_parser")}` }),
    step({ id: "hook_generator", name: "Proposal Hook Generator", alias: "STRONG", maxTokens: 400,
      system: "You write personalized opening hooks for proposals that prove the freelancer read the post. No generic openers.",
      user: (ctx) => `Write 2 candidate opening lines, specific to this job.\n\nClient need:\n${out(ctx, "client_need")}\n\nFit:\n${out(ctx, "fit_matcher")}` }),
    step({ id: "proposal_draft", name: "Proposal Draft Generator", alias: "STRONG", maxTokens: 900,
      system: "You write a complete, concise winning freelance proposal in the requested tone. Short paragraphs, outcome-focused, one clear CTA.",
      user: (ctx) => `Write the full proposal using the best hook. Keep it tight and specific.\n\nHook options:\n${out(ctx, "hook_generator")}\n\nClient need:\n${out(ctx, "client_need")}\n\nFit:\n${out(ctx, "fit_matcher")}` }),
    step({ id: "screening_answers", name: "Screening Answer Generator", alias: "STRONG", maxTokens: 600,
      system: "You answer job screening questions crisply if any are present in the post.",
      user: (ctx) => `If the post contains screening questions, answer each concisely. If none, output 'No screening questions detected.'\n\nParsed post:\n${out(ctx, "job_parser")}` }),
    step({ id: "bid_checker", name: "Bid Strategy Checker", alias: "FAST", maxTokens: 400,
      system: "You critique a proposal for being generic and suggest sharpening edits.",
      user: (ctx) => `Rate the proposal's specificity 1-10 and list 3 concrete improvements.\n\nProposal:\n${out(ctx, "proposal_draft")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 1600, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble: the final Proposal (ready to paste), Screening Answers (if any), and a short 'Before you send' checklist from the bid review.\n\nProposal:\n${out(ctx, "proposal_draft")}\n\nScreening:\n${out(ctx, "screening_answers")}\n\nBid review:\n${out(ctx, "bid_checker")}` }),
  ],
};

// --- 7. RFP / Job Post -> Proposal & Estimate -----------------------------
const rfpProposal = {
  name: "RFP / Job Post to Proposal & Estimate",
  nodes: [
    step({ id: "rfp_parser", name: "RFP Parser", alias: "STRONG", maxTokens: 800,
      system: "You parse an RFP or detailed job post into requirements, deliverables, and constraints.",
      user: (ctx) => `Extract requirements, deliverables, constraints, and evaluation criteria. The input may also contain capability notes and pricing preference; separate them.\n\nInput:\n${ctx.input}` }),
    step({ id: "complexity_estimator", name: "Complexity Estimator", alias: "STRONG", maxTokens: 700,
      system: "You estimate effort, timeline, and risk for delivery work. Be realistic and show your reasoning briefly.",
      user: (ctx) => `Estimate effort (person-days range), timeline, and key risks per deliverable. Use a table Deliverable | Effort | Risk.\n\nParsed RFP:\n${out(ctx, "rfp_parser")}` }),
    step({ id: "scope_builder", name: "Scope Builder", alias: "STRONG", maxTokens: 700,
      system: "You write scope and out-of-scope sections for a bid.",
      user: (ctx) => `Write In Scope and Out of Scope sections.\n\nParsed RFP:\n${out(ctx, "rfp_parser")}\n\nEstimate:\n${out(ctx, "complexity_estimator")}` }),
    step({ id: "estimate_generator", name: "Estimate Generator", alias: "STRONG", maxTokens: 700,
      system: "You produce a clear price estimate honoring the user's pricing preference (fixed/hourly/milestone). Show assumptions.",
      user: (ctx) => `Produce the estimate in the preferred model. Include a total and a brief assumptions note.\n\nEffort estimate:\n${out(ctx, "complexity_estimator")}\n\nParsed RFP (for pricing preference):\n${out(ctx, "rfp_parser")}` }),
    step({ id: "proposal_outline", name: "Proposal Outline Generator", alias: "STRONG", maxTokens: 700,
      system: "You produce a strong proposal structure tailored to the RFP's evaluation criteria.",
      user: (ctx) => `Produce a proposal outline (section headings + one line each) aligned to the evaluation criteria.\n\nParsed RFP:\n${out(ctx, "rfp_parser")}\n\nScope:\n${out(ctx, "scope_builder")}` }),
    step({ id: "missing_info", name: "Risk & Missing Info Checker", alias: "FAST", maxTokens: 500,
      system: "You list the clarifying questions a bidder must ask before committing.",
      user: (ctx) => `List the must-ask clarifying questions and any red-flag risks.\n\nParsed RFP:\n${out(ctx, "rfp_parser")}\n\nEstimate:\n${out(ctx, "complexity_estimator")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 2000, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a bid package: Proposal Outline, Scope (In/Out), Estimate (keep tables), Timeline & Risks, and Clarifying Questions.\n\nOutline:\n${out(ctx, "proposal_outline")}\n\nScope:\n${out(ctx, "scope_builder")}\n\nEstimate:\n${out(ctx, "estimate_generator")}\n\nComplexity:\n${out(ctx, "complexity_estimator")}\n\nQuestions:\n${out(ctx, "missing_info")}` }),
  ],
};

// --- 8. Cold Outreach Pack -------------------------------------------------
const coldOutreach = {
  name: "Cold Outreach Pack",
  nodes: [
    step({ id: "prospect_analyzer", name: "Prospect Context Analyzer", alias: "STRONG", maxTokens: 600,
      system: "You analyze a prospect/persona from the context provided. Use only given facts; do not invent details about the specific company.",
      user: (ctx) => `Summarize who the prospect is, their likely priorities, and how to approach them. The input contains client context, persona, offer, tone, and CTA; separate them.\n\nInput:\n${ctx.input}` }),
    step({ id: "pain_mapper", name: "Pain Point Mapper", alias: "STRONG", maxTokens: 500,
      system: "You map the offer to the prospect's likely pains.",
      user: (ctx) => `List the 3-4 pains this offer addresses for this prospect, each tied to a benefit.\n\nProspect:\n${out(ctx, "prospect_analyzer")}` }),
    step({ id: "offer_positioning", name: "Offer Positioning Generator", alias: "STRONG", maxTokens: 500,
      system: "You write a sharp value proposition.",
      user: (ctx) => `Write a one-sentence value proposition plus 3 supporting proof points.\n\nPains:\n${out(ctx, "pain_mapper")}\n\nProspect:\n${out(ctx, "prospect_analyzer")}` }),
    step({ id: "email_sequence", name: "Email Sequence Generator", alias: "STRONG", maxTokens: 1000,
      system: "You write a 3-email cold sequence (initial, follow-up, breakup). Short, personal, one CTA each, in the requested tone.",
      user: (ctx) => `Write the 3 emails. Use the offer's CTA.\n\nPositioning:\n${out(ctx, "offer_positioning")}\n\nPains:\n${out(ctx, "pain_mapper")}` }),
    step({ id: "subject_lines", name: "Subject Line Generator", alias: "FAST", maxTokens: 300,
      system: "You write high-open-rate subject lines: specific, low-hype, under 6 words.",
      user: (ctx) => `Write 6 subject line options for email 1.\n\nPositioning:\n${out(ctx, "offer_positioning")}` }),
    step({ id: "linkedin_dm", name: "LinkedIn DM Generator", alias: "STRONG", maxTokens: 400,
      system: "You write a short, non-salesy LinkedIn DM.",
      user: (ctx) => `Write a 2-3 sentence LinkedIn connection DM.\n\nPositioning:\n${out(ctx, "offer_positioning")}\n\nProspect:\n${out(ctx, "prospect_analyzer")}` }),
    step({ id: "cta_optimizer", name: "CTA Optimizer", alias: "FAST", maxTokens: 300,
      system: "You sharpen CTAs to be low-friction and specific.",
      user: (ctx) => `Suggest 3 improved CTA variants for the sequence.\n\nEmails:\n${out(ctx, "email_sequence")}` }),
    step({ id: "formatter", name: "Final Pack Formatter", alias: "FORMATTER", maxTokens: 1800, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Cold Outreach Pack: Positioning, Subject Lines, Email Sequence (3 emails), LinkedIn DM, and CTA options.\n\nPositioning:\n${out(ctx, "offer_positioning")}\n\nSubjects:\n${out(ctx, "subject_lines")}\n\nEmails:\n${out(ctx, "email_sequence")}\n\nDM:\n${out(ctx, "linkedin_dm")}\n\nCTAs:\n${out(ctx, "cta_optimizer")}` }),
  ],
};

// --- 9. Automated Follow-up & Nurture -------------------------------------
const followUp = {
  name: "Automated Follow-up & Nurture",
  nodes: [
    step({ id: "state_extractor", name: "Conversation State Extractor", alias: "FAST", maxTokens: 500,
      system: "You determine the current state of a deal/project from a prior conversation.",
      user: (ctx) => `State where things stand: stage, last action, who owes the next move, and any stated objection or silence. The input also gives client status, desired outcome, and tone.\n\nInput:\n${ctx.input}` }),
    step({ id: "intent_planner", name: "Intent Planner", alias: "STRONG", maxTokens: 400,
      system: "You choose the right follow-up objective given the deal state and desired outcome.",
      user: (ctx) => `State the follow-up objective and the single best angle to achieve it.\n\nState:\n${out(ctx, "state_extractor")}` }),
    step({ id: "objection_handler", name: "Objection Handler", alias: "STRONG", maxTokens: 500,
      system: "You address objections or silence with a respectful, value-adding response.",
      user: (ctx) => `Draft the core message that handles the objection or breaks the silence without being pushy.\n\nObjective:\n${out(ctx, "intent_planner")}\n\nState:\n${out(ctx, "state_extractor")}` }),
    step({ id: "sequence_generator", name: "Follow-up Sequence Generator", alias: "STRONG", maxTokens: 900,
      system: "You write a 2-3 message follow-up sequence in the requested tone, escalating gently.",
      user: (ctx) => `Write the follow-up sequence (2-3 messages).\n\nCore message:\n${out(ctx, "objection_handler")}\n\nObjective:\n${out(ctx, "intent_planner")}` }),
    step({ id: "timing_suggestion", name: "Timing Suggestion Generator", alias: "FAST", maxTokens: 300,
      system: "You suggest realistic send timing/cadence for a follow-up sequence.",
      user: (ctx) => `Suggest when to send each message (relative cadence) and one trigger to watch for.\n\nSequence:\n${out(ctx, "sequence_generator")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 1400, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Follow-up Plan: Situation, Objective, Message Sequence, and Send Timing.\n\nState:\n${out(ctx, "state_extractor")}\n\nObjective:\n${out(ctx, "intent_planner")}\n\nSequence:\n${out(ctx, "sequence_generator")}\n\nTiming:\n${out(ctx, "timing_suggestion")}` }),
  ],
};

// --- 10. Project Timeline & Milestone from SOW ----------------------------
const timelineFromSow = {
  name: "Project Timeline & Milestone from SOW",
  nodes: [
    step({ id: "sow_parser", name: "SOW Parser", alias: "FAST", maxTokens: 700,
      system: "You extract deliverables, constraints, and dependencies from a Scope of Work.",
      user: (ctx) => `Extract deliverables, constraints, and dependencies. The input also gives deadline, team size, and work style.\n\nInput:\n${ctx.input}` }),
    step({ id: "task_breakdown", name: "Task Breakdown Generator", alias: "STRONG", maxTokens: 900,
      system: "You break deliverables into tasks grouped by milestone.",
      user: (ctx) => `Break the work into milestones, each with its tasks.\n\nParsed SOW:\n${out(ctx, "sow_parser")}` }),
    step({ id: "dependency_mapper", name: "Dependency Mapper", alias: "STRONG", maxTokens: 600,
      system: "You identify task dependencies and likely blockers.",
      user: (ctx) => `List dependencies (X before Y) and blockers.\n\nTasks:\n${out(ctx, "task_breakdown")}` }),
    step({ id: "timeline_builder", name: "Timeline Builder", alias: "STRONG", maxTokens: 800,
      system: "You build a realistic timeline honoring the deadline and team size.",
      user: (ctx) => `Produce a timeline table: Milestone | Tasks | Duration | Target Date. Respect the deadline.\n\nTasks:\n${out(ctx, "task_breakdown")}\n\nDependencies:\n${out(ctx, "dependency_mapper")}\n\nParsed SOW (deadline/team):\n${out(ctx, "sow_parser")}` }),
    step({ id: "risk_buffer", name: "Risk Buffer Planner", alias: "FAST", maxTokens: 400,
      system: "You add buffer and risk notes to a timeline.",
      user: (ctx) => `Suggest buffers and the top schedule risks with mitigations.\n\nTimeline:\n${out(ctx, "timeline_builder")}` }),
    step({ id: "invoice_hint", name: "Invoice Milestone Hint Generator", alias: "FAST", maxTokens: 400,
      system: "You suggest payment milestones aligned to deliverables.",
      user: (ctx) => `Suggest a payment schedule tied to milestones (percent or amount hints).\n\nTimeline:\n${out(ctx, "timeline_builder")}` }),
    step({ id: "formatter", name: "Final Plan Formatter", alias: "FORMATTER", maxTokens: 1800, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Project Plan: Milestones & Tasks, Timeline (keep the table), Dependencies & Risks, and Payment Schedule.\n\nTasks:\n${out(ctx, "task_breakdown")}\n\nTimeline:\n${out(ctx, "timeline_builder")}\n\nDependencies:\n${out(ctx, "dependency_mapper")}\n\nRisk buffers:\n${out(ctx, "risk_buffer")}\n\nPayment hints:\n${out(ctx, "invoice_hint")}` }),
  ],
};

// --- 11. Delivery / Handover Report Generator ------------------------------
const handoverReport = {
  name: "Delivery / Handover Report Generator",
  nodes: [
    step({ id: "work_cleaner", name: "Work Summary Cleaner", alias: "FAST", maxTokens: 700,
      system: "You normalize a description of completed work into clear bullets.",
      user: (ctx) => `Clean and structure the completed-work description. Keep links/files referenced. The input also gives project/client name.\n\nInput:\n${ctx.input}` }),
    step({ id: "deliverable_mapper", name: "Deliverable Mapper", alias: "STRONG", maxTokens: 700,
      system: "You map completed work to deliverables/milestones if any are referenced.",
      user: (ctx) => `Map each completed item to its deliverable/milestone (or 'unmapped').\n\nCleaned work:\n${out(ctx, "work_cleaner")}` }),
    step({ id: "handover_writer", name: "Handover Report Generator", alias: "STRONG", maxTokens: 1200,
      system: "You write a professional client handover report: what was delivered, how it meets the goals, and access/links.",
      user: (ctx) => `Write the handover report body.\n\nDeliverables map:\n${out(ctx, "deliverable_mapper")}\n\nCleaned work:\n${out(ctx, "work_cleaner")}` }),
    step({ id: "usage_notes", name: "Usage Notes Generator", alias: "STRONG", maxTokens: 700,
      system: "You write concise usage and maintenance notes for the delivered work.",
      user: (ctx) => `Write usage/maintenance notes a client can follow.\n\nReport:\n${out(ctx, "handover_writer")}` }),
    step({ id: "pending_items", name: "Pending Items Detector", alias: "FAST", maxTokens: 400,
      system: "You identify remaining or follow-up items.",
      user: (ctx) => `List any pending or follow-up items. If none, say 'No pending items.'\n\nDeliverables map:\n${out(ctx, "deliverable_mapper")}\n\nCleaned work:\n${out(ctx, "work_cleaner")}` }),
    step({ id: "invoice_readiness", name: "Invoice Readiness Checker", alias: "FAST", maxTokens: 400,
      system: "You assess whether the work is ready to invoice.",
      user: (ctx) => `State 'Ready to invoice' or list what remains first, briefly.\n\nDeliverables map:\n${out(ctx, "deliverable_mapper")}\n\nPending:\n${out(ctx, "pending_items")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 1800, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Delivery / Handover Report: Summary of Delivered Work, How It Meets Goals, Usage & Maintenance, Pending Items, and Invoice Readiness.\n\nReport:\n${out(ctx, "handover_writer")}\n\nUsage:\n${out(ctx, "usage_notes")}\n\nPending:\n${out(ctx, "pending_items")}\n\nInvoice readiness:\n${out(ctx, "invoice_readiness")}` }),
  ],
};

// --- 12. SEO Content Brief Generator (retrieval) ---------------------------
const seoContentBrief = {
  name: "SEO Content Brief Generator",
  nodes: [
    step({ id: "intent_classifier", name: "Keyword Intent Classifier", alias: "FAST", maxTokens: 400,
      system: "You classify search intent (informational/commercial/transactional/navigational) and the likely searcher.",
      user: (ctx) => `Classify the intent and describe the searcher. The input gives keyword, region, language, content type, and competitor notes.\n\nInput:\n${ctx.input}` }),
    step({ id: "serp_research", name: "SERP/Web Research", alias: "RESEARCH", maxTokens: 3000, retrieval: true,
      system: "You are an SEO research assistant with web search capability.",
      user: (ctx) => `Research what currently ranks for this keyword: common angles, headings, entities, and content gaps. Include source URLs inline. Assume today is ${ctx.today}.\n\nKeyword + context:\n${ctx.input}\n\nIntent:\n${out(ctx, "intent_classifier")}` }),
    step({ id: "competitor_analyzer", name: "Competitor Structure Analyzer", alias: "RESEARCH", maxTokens: 900,
      system: "You analyze competitor content structure and angles from research findings.",
      user: (ctx) => `Summarize the dominant heading structures and angles competitors use.\n\nFindings:\n${out(ctx, "serp_research")}` }),
    step({ id: "gap_analyzer", name: "Content Gap Analyzer", alias: "STRONG", maxTokens: 600,
      system: "You find gaps and opportunities competitors miss.",
      user: (ctx) => `List content gaps and differentiation opportunities.\n\nCompetitor structures:\n${out(ctx, "competitor_analyzer")}\n\nFindings:\n${out(ctx, "serp_research")}` }),
    step({ id: "brief_generator", name: "Brief Generator", alias: "STRONG", maxTokens: 1200,
      system: "You write an actionable SEO content brief.",
      user: (ctx) => `Produce: suggested title, meta description, target word count, H2/H3 outline, entities/keywords to include, and 5 FAQs.\n\nIntent:\n${out(ctx, "intent_classifier")}\n\nGaps:\n${out(ctx, "gap_analyzer")}\n\nCompetitor structures:\n${out(ctx, "competitor_analyzer")}` }),
    step({ id: "seo_qa", name: "SEO QA Checker", alias: "FAST", maxTokens: 400,
      system: "You verify a brief matches the search intent and flag mismatches.",
      user: (ctx) => `Check the brief against the intent; list any fixes. If solid, say so.\n\nIntent:\n${out(ctx, "intent_classifier")}\n\nBrief:\n${out(ctx, "brief_generator")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 2000, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble an SEO Content Brief: Intent, Title & Meta, Outline (H2/H3), Entities/Keywords, FAQs, Gaps to Exploit, QA Notes, and a Sources list.\n\nIntent:\n${out(ctx, "intent_classifier")}\n\nBrief:\n${out(ctx, "brief_generator")}\n\nGaps:\n${out(ctx, "gap_analyzer")}\n\nQA:\n${out(ctx, "seo_qa")}\n\nFindings (sources):\n${out(ctx, "serp_research")}` }),
  ],
};

// --- 13. Website / SEO Audit Report (retrieval) ----------------------------
const seoAudit = {
  name: "Website / SEO Audit Report",
  nodes: [
    step({ id: "input_normalizer", name: "URL/HTML Normalizer", alias: "FAST", maxTokens: 600,
      system: "You normalize an audit request: the target URL, any pasted HTML/text, and the requested audit depth.",
      user: (ctx) => `Identify the target URL, summarize any pasted page content, and note the audit depth.\n\nInput:\n${ctx.input}` }),
    step({ id: "page_research", name: "Web/Page Research", alias: "RESEARCH", maxTokens: 3000, retrieval: true,
      system: "You are an SEO auditor with web search capability.",
      user: (ctx) => `Research the target page/site: visible title/meta/headings, positioning, and how it compares to competitors. Include source URLs inline. Assume today is ${ctx.today}.\n\nTarget + context:\n${ctx.input}\n\nNormalized:\n${out(ctx, "input_normalizer")}` }),
    step({ id: "technical_seo", name: "Technical SEO Analyzer", alias: "STRONG", maxTokens: 800,
      system: "You analyze technical SEO from available context: title, meta, H1, canonical, indexing signals, and basic issues. Be explicit when something cannot be verified from the given data.",
      user: (ctx) => `List technical SEO findings with severity. Mark unverifiable items clearly.\n\nResearch:\n${out(ctx, "page_research")}\n\nNormalized:\n${out(ctx, "input_normalizer")}` }),
    step({ id: "content_seo", name: "Content SEO Analyzer", alias: "STRONG", maxTokens: 800,
      system: "You analyze content SEO: positioning, depth, missing sections, and relevance to intent.",
      user: (ctx) => `List content SEO findings and missing sections.\n\nResearch:\n${out(ctx, "page_research")}` }),
    step({ id: "issue_prioritizer", name: "Issue Prioritizer", alias: "FAST", maxTokens: 600,
      system: "You prioritize findings by severity, impact, and effort.",
      user: (ctx) => `Produce a priority table: Issue | Severity | Impact | Effort.\n\nTechnical:\n${out(ctx, "technical_seo")}\n\nContent:\n${out(ctx, "content_seo")}` }),
    step({ id: "recommendation_writer", name: "Recommendation Writer", alias: "STRONG", maxTokens: 900,
      system: "You write client-ready, prioritized recommendations.",
      user: (ctx) => `Write prioritized recommendations (quick wins first), each with the expected benefit.\n\nPriorities:\n${out(ctx, "issue_prioritizer")}` }),
    step({ id: "formatter", name: "Final Audit Formatter", alias: "FORMATTER", maxTokens: 2200, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Website / SEO Audit Report: Executive Summary, Technical SEO, Content SEO, Prioritized Issues (keep the table), Recommendations, and Sources.\n\nTechnical:\n${out(ctx, "technical_seo")}\n\nContent:\n${out(ctx, "content_seo")}\n\nPriorities:\n${out(ctx, "issue_prioritizer")}\n\nRecommendations:\n${out(ctx, "recommendation_writer")}\n\nResearch (sources):\n${out(ctx, "page_research")}` }),
  ],
};

// --- 14. Keyword Strategy Map ---------------------------------------------
const keywordStrategy = {
  name: "Keyword Strategy Map",
  nodes: [
    step({ id: "keyword_cleaner", name: "Keyword Cleaner", alias: "FAST", maxTokens: 700,
      system: "You normalize and deduplicate a keyword list (text or CSV).",
      user: (ctx) => `Clean and deduplicate the keywords into a simple list.\n\nInput:\n${ctx.input}` }),
    step({ id: "intent_classifier", name: "Intent Classifier", alias: "FAST", maxTokens: 700,
      system: "You classify each keyword's intent (informational/commercial/transactional/navigational).",
      user: (ctx) => `Classify each keyword. Output a table Keyword | Intent.\n\nKeywords:\n${out(ctx, "keyword_cleaner")}` }),
    step({ id: "semantic_clusterer", name: "Semantic Clusterer", alias: "STRONG", maxTokens: 800,
      system: "You group keywords into semantic clusters/topics.",
      user: (ctx) => `Group the keywords into named clusters with their members.\n\nClassified keywords:\n${out(ctx, "intent_classifier")}` }),
    step({ id: "hub_spoke", name: "Hub/Spoke Planner", alias: "STRONG", maxTokens: 800,
      system: "You design a hub-and-spoke content architecture from keyword clusters.",
      user: (ctx) => `For each cluster, define a hub (pillar) page and spoke (supporting) pages.\n\nClusters:\n${out(ctx, "semantic_clusterer")}` }),
    step({ id: "priority_scorer", name: "Priority Scorer", alias: "FAST", maxTokens: 600,
      system: "You score clusters by likely impact vs effort.",
      user: (ctx) => `Score each cluster Impact (1-5) and Effort (1-5) with a one-line rationale. Table Cluster | Impact | Effort | Priority.\n\nArchitecture:\n${out(ctx, "hub_spoke")}` }),
    step({ id: "roadmap_generator", name: "Content Roadmap Generator", alias: "STRONG", maxTokens: 700,
      system: "You turn a prioritized keyword architecture into a content roadmap.",
      user: (ctx) => `Produce a phased content roadmap (what to publish first and why).\n\nArchitecture:\n${out(ctx, "hub_spoke")}\n\nPriorities:\n${out(ctx, "priority_scorer")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 1800, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a Keyword Strategy Map: Clusters, Intent Map (keep the table), Hub/Spoke Architecture, Priorities (keep the table), and Content Roadmap.\n\nIntent map:\n${out(ctx, "intent_classifier")}\n\nClusters:\n${out(ctx, "semantic_clusterer")}\n\nArchitecture:\n${out(ctx, "hub_spoke")}\n\nPriorities:\n${out(ctx, "priority_scorer")}\n\nRoadmap:\n${out(ctx, "roadmap_generator")}` }),
  ],
};

// --- 15. PR Code Review / Diff Review --------------------------------------
const prDiffReview = {
  name: "PR Code Review / Diff Review",
  nodes: [
    step({ id: "diff_parser", name: "Diff Parser", alias: "FAST", maxTokens: 700,
      system: "You parse a git diff into changed files and changed blocks, and flag risk areas (auth, payments, migrations, deletions).",
      user: (ctx) => `List changed files and summarize each change. Flag risky areas. The input may include a PR description and repo context.\n\nInput:\n${ctx.input}` }),
    step({ id: "context_summary", name: "Context Summarizer", alias: "FAST", maxTokens: 400,
      system: "You summarize the intent/goal of a PR.",
      user: (ctx) => `State the PR's goal in 2-3 sentences.\n\nParsed diff + description:\n${out(ctx, "diff_parser")}` }),
    step({ id: "logic_review", name: "Logic Review", alias: "CODE", maxTokens: 1100,
      system: "You review a diff for correctness and edge cases, focusing only on the changed code and its immediate effects.",
      user: (ctx) => `List correctness issues introduced by this change, each with file and a concrete fix.\n\nPR goal:\n${out(ctx, "context_summary")}\n\nDiff:\n${ctx.input}` }),
    step({ id: "security_review", name: "Security Review", alias: "CODE", maxTokens: 800,
      system: "You review a diff for security regressions: secrets, auth/authz, input validation, unsafe calls.",
      user: (ctx) => `List security findings with severity and remediation. If none, say so.\n\nDiff:\n${ctx.input}` }),
    step({ id: "test_review", name: "Test Coverage Review", alias: "CODE", maxTokens: 700,
      system: "You identify tests that should accompany a change.",
      user: (ctx) => `List the tests that should be added/updated for this diff, with what each asserts.\n\nLogic findings:\n${out(ctx, "logic_review")}\n\nDiff:\n${ctx.input}` }),
    step({ id: "pr_comments", name: "PR Comment Generator", alias: "CODE", maxTokens: 900,
      system: "You write reviewer comments. Reference file (and line if line numbers are present in the diff). Constructive and specific.",
      user: (ctx) => `Write per-file PR comments for the key findings.\n\nLogic:\n${out(ctx, "logic_review")}\n\nSecurity:\n${out(ctx, "security_review")}\n\nTests:\n${out(ctx, "test_review")}` }),
    step({ id: "merge_scorer", name: "Merge Readiness Scorer", alias: "STRONG", maxTokens: 500,
      system: "You give a merge verdict: Approve / Request changes / Comment, with a one-paragraph risk summary.",
      user: (ctx) => `Give a verdict and risk summary.\n\nLogic:\n${out(ctx, "logic_review")}\n\nSecurity:\n${out(ctx, "security_review")}\n\nTests:\n${out(ctx, "test_review")}` }),
    step({ id: "formatter", name: "Final Formatter", alias: "FORMATTER", maxTokens: 2000, isFinal: true,
      system: FORMATTER_SYSTEM,
      user: (ctx) => `Assemble a PR Review: Verdict & Risk Summary, PR Goal, Correctness, Security, Test Coverage, and Per-file Comments (keep code refs).\n\nVerdict:\n${out(ctx, "merge_scorer")}\n\nGoal:\n${out(ctx, "context_summary")}\n\nLogic:\n${out(ctx, "logic_review")}\n\nSecurity:\n${out(ctx, "security_review")}\n\nTests:\n${out(ctx, "test_review")}\n\nComments:\n${out(ctx, "pr_comments")}` }),
  ],
};

// --- 3. Client Research Brief: adapted GPT Researcher chain (proven, live) --
// role select (FAST) -> plan queries (FAST) -> web retrieve (RESEARCH, or pasted
// sources) -> write cited report (STRONG). Prompts are the originals from
// workflow-research.js so behavior is unchanged from the bespoke executor.
// Uses the original research prompt builders directly (richer than the generic
// helper) so the proven chain stays byte-identical to the migrated version.
const clientResearch = {
  name: "Client Research",
  nodes: [
  {
    id: "role_analysis", name: "Role analysis", alias: "FAST", maxTokens: 300,
    build: (ctx) => research.buildPersonaMessages(ctx.input),
    parse: (content) => research.parsePersona(content) || research.FALLBACK_PERSONA,
  },
  {
    id: "research_plan", name: "Research plan", alias: "FAST", maxTokens: 300,
    build: (ctx) => research.buildPlannerMessages(ctx.input, ctx.maxQueries, ctx.today),
    parse: (content, ctx) => research.parsePlannerQueries(content, ctx.input, ctx.maxQueries),
  },
  {
    id: "web_research", name: "Web research", alias: "RESEARCH", maxTokens: 4000, retrieval: true,
    build: (ctx) => research.buildSearchMessages(ctx.input, ctx.parsed.research_plan || [ctx.input], ctx.today),
  },
  {
    id: "report_writer", name: "Report writer", alias: "STRONG", maxTokens: 4000, isFinal: true,
    build: (ctx) => research.buildWriterMessages(
      ctx.parsed.role_analysis || research.FALLBACK_PERSONA,
      ctx.outputs.web_research || "",
      ctx.input,
      ctx.totalWords,
      ctx.today,
    ),
  },
  ],
};

const WORKFLOW_GRAPHS = {
  "call-recap": callRecap,
  "proposal-sow": proposalSow,
  "client-research": clientResearch,
  "market-pain-research": marketPain,
  "code-review": codeReview,
  "upwork-proposal": upworkProposal,
  "rfp-proposal": rfpProposal,
  "cold-outreach": coldOutreach,
  "follow-up-nurture": followUp,
  "timeline-from-sow": timelineFromSow,
  "handover-report": handoverReport,
  "seo-content-brief": seoContentBrief,
  "seo-audit": seoAudit,
  "keyword-strategy": keywordStrategy,
  "pr-diff-review": prDiffReview,
};

function getGraph(slug) {
  return WORKFLOW_GRAPHS[slug] || null;
}

// The distinct model aliases a graph's nodes require (model nodes only; local
// nodes have no model). Used by the server to build a tier model map that always
// covers exactly what the graph needs.
function graphAliases(slug) {
  const g = WORKFLOW_GRAPHS[slug];
  if (!g) return [];
  const set = new Set();
  g.nodes.forEach((n) => { if (n.alias && typeof n.build === "function") set.add(n.alias); });
  return Array.from(set);
}

module.exports = {
  WORKFLOW_GRAPHS,
  getGraph,
  graphAliases,
};
