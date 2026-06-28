"use strict";

// Research workflow executor, adapted from GPT Researcher (Apache-2.0):
// role select -> plan queries -> web retrieve -> write cited report.
// Prompts kept close to the originals (see .claude/workflow-gpt-researcher.md).
// The orchestrator takes injected callModel/searchWeb so it is testable without
// network. Cost is summed in integer micro-USD via v98-models.

const v98Models = require("./v98-models");

// --- pure helpers (unit tested directly) ---

function extractJsonArray(text) {
  const i = text.indexOf("[");
  const j = text.lastIndexOf("]");
  return i >= 0 && j > i ? text.slice(i, j + 1) : text;
}

// Parse the planner output into a list of search queries, with fallbacks.
function parsePlannerQueries(text, fallbackQuery, maxQueries) {
  const out = [];
  const raw = String(text || "");
  try {
    const arr = JSON.parse(extractJsonArray(raw));
    if (Array.isArray(arr)) {
      arr.forEach((q) => { if (typeof q === "string" && q.trim()) out.push(q.trim()); });
    }
  } catch {
    // fall through to regex
  }
  if (!out.length) {
    const matches = raw.match(/"([^"]+)"/g);
    if (matches) matches.forEach((s) => out.push(s.replace(/"/g, "").trim()));
  }
  if (!out.length && fallbackQuery) out.push(String(fallbackQuery).trim());
  return out.slice(0, Math.max(1, maxQueries || 3));
}

// Parse the role-select output into a persona; strip emoji from the server name.
function parsePersona(text) {
  const raw = String(text || "");
  try {
    const i = raw.indexOf("{");
    const j = raw.lastIndexOf("}");
    if (i >= 0 && j > i) {
      const o = JSON.parse(raw.slice(i, j + 1));
      if (o && o.agent_role_prompt) {
        const server = String(o.server || "Research Agent").replace(/[^\x20-\x7E]/g, "").trim() || "Research Agent";
        return { server, agent_role_prompt: String(o.agent_role_prompt) };
      }
    }
  } catch {
    // fall through
  }
  return null;
}

const FALLBACK_PERSONA = {
  server: "Research Agent",
  agent_role_prompt: "You are a seasoned research analyst AI assistant. Your primary goal is to compose comprehensive, astute, impartial, and methodically arranged reports based on provided data and trends.",
};

// Normalize user-pasted sources (paste mode) into { title, url, content }.
function buildPasteSources(pasted) {
  const list = Array.isArray(pasted) ? pasted : (pasted ? [pasted] : []);
  const out = [];
  list.forEach((item) => {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) out.push({ title: "Pasted source", url: "", content: text, score: 0 });
      return;
    }
    if (item && typeof item === "object") {
      const content = String(item.content || item.text || "").trim();
      if (content) {
        out.push({
          title: String(item.title || "Pasted source"),
          url: String(item.url || ""),
          content,
          score: 0,
        });
      }
    }
  });
  return out;
}

// Keep the top N sources by score, de-duplicated by URL (the same page can be
// returned by several queries). Sources with no URL (pasted) are all kept.
function selectTopSources(sources, maxSources) {
  const arr = (sources || []).filter((s) => s && s.content);
  const sorted = arr.slice().sort((a, b) => (b.score || 0) - (a.score || 0));
  const cap = Math.max(1, maxSources || 6);
  const seen = new Set();
  const out = [];
  for (const s of sorted) {
    if (s.url) {
      if (seen.has(s.url)) continue;
      seen.add(s.url);
    }
    out.push(s);
    if (out.length >= cap) break;
  }
  return out;
}

// Join sources into the context blob handed to the writer, with URLs for citation.
function aggregateContext(sources) {
  return sources.map((s) => {
    const header = s.url ? `Source: ${s.title} (${s.url})` : `Source: ${s.title}`;
    return `${header}\n${s.content}`;
  }).join("\n\n");
}

// --- prompt builders (close to GPT Researcher originals) ---

function buildPersonaMessages(query) {
  const system = "This task involves researching a given topic. Determine the most relevant expert agent to research it, and respond ONLY with a JSON object of the form {\"server\": \"<short agent name, no emoji>\", \"agent_role_prompt\": \"<a one-sentence system persona for writing the report>\"}.";
  return [
    { role: "system", content: system },
    { role: "user", content: `task: "${query}"` },
  ];
}

function buildPlannerMessages(query, maxQueries, today) {
  const content = `Write ${maxQueries} search queries to research the following task: "${query}"\n\n`
    + "Each query must be a plain natural language phrase. Do not use search operator syntax such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT.\n\n"
    + `Assume the current date is ${today} if required.\n\n`
    + "You must respond with a list of strings in the following format: [\"query 1\", \"query 2\", \"query 3\"]. The response should contain ONLY the list.";
  return [{ role: "user", content }];
}

function buildWriterMessages(persona, contextText, query, totalWords, today) {
  const user = `Information: "${contextText}"\n---\n`
    + `Using the above information, answer the following query or task: "${query}" in a detailed report -- `
    + `the report should be well structured, informative, in-depth, and comprehensive, with facts and numbers if available and at least ${totalWords} words.\n\n`
    + "Guidelines:\n"
    + "- Determine your own concrete opinion based on the information; do not defer to vague conclusions.\n"
    + "- Write in markdown using #, ##, ### headers; use tables for structured comparisons.\n"
    + "- Prioritize reliable and recent sources.\n"
    + "- Do NOT include a table of contents.\n"
    + "- Use in-text citations as markdown hyperlinks at the end of the relevant sentence: ([source](url)).\n"
    + "- Add a references list at the end with full URLs, no duplicates, each hyperlinked [url](url).\n"
    + `Write in english. Assume the current date is ${today}.`;
  return [
    { role: "system", content: persona.agent_role_prompt },
    { role: "user", content: user },
  ];
}

// --- orchestrator ---

// opts: {
//   query, mode ("search"|"paste"), pastedSources,
//   cheapModel, writerModel, groupRatio, today,
//   callModel(modelId, messages, maxTokens) -> { content, usage:{prompt_tokens,completion_tokens} },
//   searchWeb(query) -> [{ title, url, content, score }],
//   maxQueries=3, maxResults=5, maxSources=6, totalWords=1000,
// }
// Returns { report, persona, steps:[{name,model,costMicros}], sources:[{title,url}], totalCostMicros, queries }
async function runResearchWorkflow(opts) {
  const query = String(opts.query || "").trim();
  if (!query) throw new Error("A research query is required");
  const mode = opts.mode === "paste" ? "paste" : "search";
  const cheapModel = v98Models.resolveModelId(opts.cheapModel || "gpt-4o-mini");
  const writerModel = v98Models.resolveModelId(opts.writerModel || "gpt-4.1-mini");
  const groupRatio = opts.groupRatio || 1;
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const maxQueries = opts.maxQueries || 3;
  const maxResults = opts.maxResults || 5;
  const maxSources = opts.maxSources || 6;
  const totalWords = opts.totalWords || 1000;
  const callModel = opts.callModel;
  const searchWeb = opts.searchWeb;

  const steps = [];
  let totalCostMicros = 0;
  function account(name, modelId, usage) {
    const cost = v98Models.computeCostMicros(modelId, usage.prompt_tokens, usage.completion_tokens, groupRatio) || 0;
    totalCostMicros += cost;
    steps.push({ name, model: modelId, costMicros: cost });
    return cost;
  }

  // 1. Role select
  const roleRes = await callModel(cheapModel, buildPersonaMessages(query), 300);
  account("Role analysis", cheapModel, roleRes.usage);
  const persona = parsePersona(roleRes.content) || FALLBACK_PERSONA;

  // 2. Plan queries
  const planRes = await callModel(cheapModel, buildPlannerMessages(query, maxQueries, today), 300);
  account("Research plan", cheapModel, planRes.usage);
  const queries = parsePlannerQueries(planRes.content, query, maxQueries);

  // 3. Retrieve sources
  let sources = [];
  if (mode === "paste") {
    sources = buildPasteSources(opts.pastedSources);
    if (!sources.length) throw new Error("Paste mode needs at least one source");
    steps.push({ name: "Sources (pasted)", model: null, costMicros: 0 });
  } else {
    for (const q of queries) {
      const found = await searchWeb(q, maxResults);
      if (Array.isArray(found)) sources = sources.concat(found);
    }
    steps.push({ name: "Web research", model: null, costMicros: 0 });
    if (!sources.length) throw new Error("No sources found for this query");
  }
  const topSources = selectTopSources(sources, maxSources);
  const contextText = aggregateContext(topSources);

  // 4. Write the report
  const writeRes = await callModel(writerModel, buildWriterMessages(persona, contextText, query, totalWords, today), 4000);
  account("Report writer", writerModel, writeRes.usage);

  return {
    report: writeRes.content,
    persona,
    queries,
    sources: topSources.map((s) => ({ title: s.title, url: s.url })),
    steps,
    totalCostMicros,
  };
}

module.exports = {
  parsePlannerQueries,
  parsePersona,
  buildPasteSources,
  selectTopSources,
  aggregateContext,
  buildPersonaMessages,
  buildPlannerMessages,
  buildWriterMessages,
  runResearchWorkflow,
  FALLBACK_PERSONA,
};
