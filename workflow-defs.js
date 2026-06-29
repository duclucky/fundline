"use strict";

// Workflow graph definitions: the per-node chain logic and prompts for each
// runnable workflow, consumed by workflow-engine.js. This is the single source of
// truth for what each workflow DOES. Pricing and the per-tier alias -> model map
// live separately in server.js WORKFLOW_RUN_DEFS (deployment config), while the
// frontend WORKFLOWS catalog mirrors only the display metadata.
//
// Each node: { id, name, alias, maxTokens, build(ctx)->messages[], parse?, retrieval?, isFinal? }
// Model aliases used across workflows (resolved per tier): FAST, STRONG, RESEARCH,
// CODE, FORMATTER. A node picks the alias that fits its function; the tier decides
// the concrete model. See .claude/skills/v98store-api for the id map.

const research = require("./workflow-research");

// --- client-research: adapted GPT Researcher chain (migrated to the engine) ---
// role select (FAST) -> plan queries (FAST) -> web retrieve (RESEARCH, or pasted
// sources) -> write cited report (STRONG). Prompts are the originals from
// workflow-research.js so behavior is unchanged from the bespoke executor.
const clientResearch = {
  name: "Client Research",
  nodes: [
    {
      id: "role_analysis",
      name: "Role analysis",
      alias: "FAST",
      maxTokens: 300,
      build: (ctx) => research.buildPersonaMessages(ctx.input),
      parse: (content) => research.parsePersona(content) || research.FALLBACK_PERSONA,
    },
    {
      id: "research_plan",
      name: "Research plan",
      alias: "FAST",
      maxTokens: 300,
      build: (ctx) => research.buildPlannerMessages(ctx.input, ctx.maxQueries, ctx.today),
      parse: (content, ctx) => research.parsePlannerQueries(content, ctx.input, ctx.maxQueries),
    },
    {
      id: "web_research",
      name: "Web research",
      alias: "RESEARCH",
      maxTokens: 4000,
      retrieval: true,
      build: (ctx) => research.buildSearchMessages(ctx.input, ctx.parsed.research_plan || [ctx.input], ctx.today),
    },
    {
      id: "report_writer",
      name: "Report writer",
      alias: "STRONG",
      maxTokens: 4000,
      isFinal: true,
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
  "client-research": clientResearch,
};

function getGraph(slug) {
  return WORKFLOW_GRAPHS[slug] || null;
}

module.exports = {
  WORKFLOW_GRAPHS,
  getGraph,
};
