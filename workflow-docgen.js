"use strict";

// Document generation executor: input -> a document-spec (JSON) -> a rendered file (PDF).
// The LLM (via injected callModel) does the document intelligence: it turns the caller's
// content/brief into a complete, structured document-spec; rendering is delegated to
// doc-render.js (backend A, in-process pdfkit). Optional research mode pulls live sources
// (injected searchWeb). Custom executor like workflow-cvgig.js / workflow-cryptodd.js:
// dependency-injected so it is testable offline, and fits the workflow runner/billing.
// See .claude/workflow-doc-gen-spec.md.

const docRender = require("./doc-render");
const v98Models = require("./v98-models");

const DOC_TYPES = { proposal: "proposal", report: "report" };

function stripFence(s) {
  let t = String(s || "").trim();
  // Remove a leading ```json / ``` fence and a trailing ``` if the model wrapped the JSON.
  t = t.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  return t.trim();
}

// Parse the model output into a validated document-spec, or null if unusable.
function parseDocSpec(content) {
  const raw = stripFence(content);
  let obj = null;
  try { obj = JSON.parse(raw); } catch { obj = null; }
  if (!obj || typeof obj !== "object") return null;
  const sections = Array.isArray(obj.sections) ? obj.sections.filter((s) => s && s.heading) : [];
  if (!sections.length) return null;
  // Keep only blocks the renderer understands; drop anything malformed.
  const cleanSections = sections.map((s) => ({
    heading: String(s.heading),
    blocks: (Array.isArray(s.blocks) ? s.blocks : []).map(cleanBlock).filter(Boolean),
  }));
  const meta = (obj.meta && typeof obj.meta === "object") ? obj.meta : {};
  const spec = {
    docType: obj.docType || "",
    meta: {
      title: String(meta.title || ""),
      subtitle: meta.subtitle ? String(meta.subtitle) : "",
      sender: meta.sender ? String(meta.sender) : "",
      recipient: meta.recipient ? String(meta.recipient) : "",
      date: meta.date ? String(meta.date) : "",
    },
    sections: cleanSections,
  };
  if (Array.isArray(obj.sources) && obj.sources.length) {
    spec.sources = obj.sources
      .filter((x) => x && (x.title || x.url))
      .map((x) => ({ title: String(x.title || ""), url: String(x.url || "") }));
  }
  return spec;
}

function cleanBlock(b) {
  if (!b || typeof b !== "object") return null;
  if (b.type === "paragraph" && b.text != null) return { type: "paragraph", text: String(b.text) };
  if (b.type === "list" && Array.isArray(b.items)) return { type: "list", items: b.items.map((x) => String(x)) };
  if (b.type === "keyvalue" && Array.isArray(b.pairs)) {
    return { type: "keyvalue", pairs: b.pairs.filter((p) => p && p.k != null).map((p) => ({ k: String(p.k), v: String(p.v != null ? p.v : "") })) };
  }
  if (b.type === "table" && Array.isArray(b.columns) && Array.isArray(b.rows)) {
    return { type: "table", columns: b.columns.map((c) => String(c)), rows: b.rows.map((r) => (Array.isArray(r) ? r.map((c) => String(c)) : [])) };
  }
  return null;
}

function sectionHintFor(docType) {
  if (docType === "report") {
    return "For a report use sections such as: Executive summary, Introduction and scope, Findings (one or more), Analysis, Recommendations. Add a Sources section only if sources are provided.";
  }
  return "For a proposal use sections such as: Executive summary, Understanding the need, Proposed solution, Scope and deliverables, Timeline, Pricing, Terms and assumptions, Next steps.";
}

function buildDocSpecMessages(docType, input, brief, sources, today) {
  const b = brief || {};
  const briefLines = [];
  if (b.audience) briefLines.push("Audience: " + b.audience);
  if (b.goal) briefLines.push("Goal: " + b.goal);
  if (b.tone) briefLines.push("Tone: " + b.tone);
  if (b.sender) briefLines.push("From (sender): " + b.sender);
  if (b.recipient) briefLines.push("To (recipient): " + b.recipient);
  const sourceText = (Array.isArray(sources) && sources.length)
    ? "\n\nResearched sources (cite where relevant):\n" + sources.map((s, i) => `[${i + 1}] ${s.title || ""} ${s.url || ""}\n${String(s.content || "").slice(0, 800)}`).join("\n\n")
    : "";

  const system = "You are a professional document writer. Produce a complete, well-structured "
    + docType + " and return it ONLY as a single JSON object (no prose, no markdown fences) matching this schema:\n"
    + '{"docType":"' + docType + '","meta":{"title":"","subtitle":"","sender":"","recipient":"","date":""},'
    + '"sections":[{"heading":"","blocks":[]}]}\n'
    + "Each block is one of: "
    + '{"type":"paragraph","text":"..."}, '
    + '{"type":"list","items":["...","..."]}, '
    + '{"type":"table","columns":["...","..."],"rows":[["...","..."]]}, '
    + '{"type":"keyvalue","pairs":[{"k":"...","v":"..."}]}.\n'
    + sectionHintFor(docType) + "\n"
    + "Rules: use ONLY the facts the user provides (and the researched sources if given); do NOT invent "
    + "figures, names, dates, or citations. Write in the same language as the user's content. No emojis. "
    + "Output must be valid JSON and nothing else.";

  const user = "Document type: " + docType + "\n"
    + (briefLines.length ? "Brief:\n" + briefLines.join("\n") + "\n\n" : "")
    + "Content / notes provided by the caller:\n" + String(input || "")
    + sourceText
    + (today ? "\n\nToday is " + today + "." : "");

  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// A minimal spec so a run still delivers a file even if the model output was unparseable.
function minimalSpec(docType, input, brief) {
  const b = brief || {};
  return {
    docType: docType,
    meta: { title: (b.goal || (docType === "report" ? "Report" : "Proposal")), sender: b.sender || "", recipient: b.recipient || "", date: "" },
    sections: [{ heading: "Content", blocks: [{ type: "paragraph", text: String(input || "").slice(0, 4000) || "No content was provided." }] }],
  };
}

// A plain-markdown rendering of the spec, so the run also returns readable text output
// (the primary deliverable is the rendered file; this fills the text `output` field).
function specToMarkdown(spec) {
  const lines = [];
  const m = (spec && spec.meta) || {};
  if (m.title) lines.push("# " + m.title);
  if (m.subtitle) lines.push("_" + m.subtitle + "_");
  const bits = [];
  if (m.sender) bits.push("From: " + m.sender);
  if (m.recipient) bits.push("To: " + m.recipient);
  if (m.date) bits.push("Date: " + m.date);
  if (bits.length) lines.push(bits.join("  |  "));
  ((spec && spec.sections) || []).forEach((s) => {
    lines.push("\n## " + s.heading);
    (s.blocks || []).forEach((b) => {
      if (b.type === "paragraph") lines.push(b.text);
      else if (b.type === "list") (b.items || []).forEach((it) => lines.push("- " + it));
      else if (b.type === "keyvalue") (b.pairs || []).forEach((p) => lines.push("**" + p.k + ":** " + p.v));
      else if (b.type === "table" && b.columns && b.columns.length) {
        lines.push("| " + b.columns.join(" | ") + " |");
        lines.push("| " + b.columns.map(() => "---").join(" | ") + " |");
        (b.rows || []).forEach((r) => lines.push("| " + r.join(" | ") + " |"));
      }
    });
  });
  return lines.join("\n");
}

// opts:
//   docType ("proposal"|"report"), input (string), brief (object, optional),
//   research (bool), format ("pdf"), today,
//   writerModel, searchModel, groupRatio,
//   callModel(modelId, messages, maxTokens) -> { content, usage },
//   searchWeb(query) -> [{ title, url, content }] (optional; required if research),
//   onProgress(evt)
// Returns { documentSpec, file:{format,filename,base64}, outline, sources, steps, totalCostMicros, meta }.
async function runDocGenWorkflow(opts) {
  const options = opts || {};
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : () => {};
  const callModel = options.callModel;
  if (typeof callModel !== "function") throw new Error("callModel is required");

  const docType = DOC_TYPES[String(options.docType || "").toLowerCase()] || "proposal";
  const input = String(options.input || "").trim();
  if (!input) { const e = new Error("input content is required"); e.code = "missing_input"; throw e; }
  const brief = options.brief || {};
  const groupRatio = options.groupRatio || 1;
  const writerModel = options.writerModel || "gpt-4.1-mini";
  const searchModel = options.searchModel || writerModel;

  const steps = [];
  let totalCostMicros = 0;
  function account(name, model, usage) {
    const u = usage || {};
    const cost = v98Models.computeCostMicros(model, u.prompt_tokens || 0, u.completion_tokens || 0, groupRatio);
    steps.push({ name: name, model: model, costMicros: cost });
    totalCostMicros += cost;
  }

  // 1. Optional research (report mode): gather live sources for the writer.
  let sources = [];
  if (options.research && typeof options.searchWeb === "function") {
    onProgress({ step: "research", status: "running" });
    try {
      const found = await options.searchWeb(input);
      sources = Array.isArray(found) ? found.slice(0, 8) : [];
    } catch (_) { sources = []; }
    steps.push({ name: "Research", model: null, costMicros: 0 });
    onProgress({ step: "research", status: "done" });
  }

  // 2. Generate the document-spec (LLM does intake + structure + drafting in one JSON output).
  onProgress({ step: "document", status: "running" });
  let spec = null;
  const first = await callModel(writerModel, buildDocSpecMessages(docType, input, brief, sources, options.today), 8192);
  account("Document writer", writerModel, first.usage);
  spec = parseDocSpec(first.content);
  if (!spec) {
    const retry = await callModel(writerModel, buildDocSpecMessages(docType, input, brief, sources, options.today), 8192);
    account("Document writer (retry)", writerModel, retry.usage);
    spec = parseDocSpec(retry.content);
  }
  if (!spec) spec = minimalSpec(docType, input, brief);
  if (!spec.docType) spec.docType = docType;
  if (sources.length && !spec.sources) spec.sources = sources.map((s) => ({ title: s.title || "", url: s.url || "" }));
  onProgress({ step: "document", status: "done" });

  // 3. Render to a file (backend A). Only PDF in v1; DOCX comes later from the same spec.
  onProgress({ step: "render", status: "running" });
  const footer = spec.meta && spec.meta.title ? spec.meta.title : (docType === "report" ? "Report" : "Proposal");
  const pdfBuffer = await docRender.renderDocumentPdf(spec, { footer: footer });
  steps.push({ name: "Render", model: null, costMicros: 0 });
  onProgress({ step: "render", status: "done" });

  const filename = (spec.meta && spec.meta.title ? spec.meta.title : docType).replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() + ".pdf";

  return {
    documentSpec: spec,
    report: specToMarkdown(spec),
    file: { format: "pdf", filename: filename, base64: pdfBuffer.toString("base64") },
    outline: spec.sections.map((s) => s.heading),
    sources: spec.sources || [],
    steps: steps,
    totalCostMicros: totalCostMicros,
    meta: { docType: docType, sectionCount: spec.sections.length, researched: sources.length },
  };
}

module.exports = {
  DOC_TYPES,
  stripFence,
  parseDocSpec,
  cleanBlock,
  buildDocSpecMessages,
  minimalSpec,
  specToMarkdown,
  runDocGenWorkflow,
};
