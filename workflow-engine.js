"use strict";

// Generic node-graph workflow engine. A workflow is a linear list of nodes; each
// node runs a v98store model (its alias is resolved to a real model id from the
// active tier), a local JS step, or a retrieval step (web search or pasted
// sources). Each node sees the original user input plus every prior node output,
// so later nodes build on earlier ones. The engine mirrors the shape of the
// original research executor (workflow-research.js): it takes an injected
// callModel so it is testable without network, emits onProgress per node for the
// SSE canvas animation, sums cost in integer micro-USD via v98-models, and
// returns { report, steps, totalCostMicros, outputs }.
//
// Node shape (see workflow-defs.js):
//   { id, name, alias, maxTokens, build(ctx)->messages[], parse?(content,ctx),
//     retrieval?:true, run?(ctx)->string (local node), isFinal?:true }
// ctx = { input, today, mode, pastedSources, maxQueries, totalWords,
//         outputs:{id->content}, parsed:{id->value} }

const v98Models = require("./v98-models");
const research = require("./workflow-research");

// opts: {
//   graph: { name, nodes:[...] }, tierModels: { ALIAS -> model label },
//   input, mode ("search"|"paste"), pastedSources, groupRatio, today,
//   maxQueries, totalWords,
//   callModel(modelId, messages, maxTokens) -> { content, usage:{prompt_tokens,completion_tokens} },
//   onProgress({ step, status }) -> void  (step = node.id, status = "running"|"done")
// }
// Returns { report, steps:[{name,model,costMicros}], totalCostMicros, outputs }
async function runWorkflowGraph(opts) {
  const graph = opts.graph;
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
    throw new Error("Workflow graph is empty");
  }
  const tierModels = opts.tierModels || {};
  const groupRatio = opts.groupRatio || 1;
  const callModel = opts.callModel;
  if (typeof callModel !== "function") throw new Error("callModel is required");
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const mode = opts.mode === "paste" ? "paste" : "search";

  const ctx = {
    input: String(opts.input || "").trim(),
    today: opts.today || new Date().toISOString().slice(0, 10),
    mode,
    pastedSources: opts.pastedSources,
    maxQueries: opts.maxQueries || 3,
    totalWords: opts.totalWords || 1000,
    outputs: {},
    parsed: {},
  };

  const steps = [];
  let totalCostMicros = 0;
  function account(name, modelId, usage) {
    const cost = v98Models.computeCostMicros(modelId, usage.prompt_tokens, usage.completion_tokens, groupRatio) || 0;
    totalCostMicros += cost;
    steps.push({ name, model: modelId, costMicros: cost });
    return cost;
  }

  let finalId = null;
  for (const node of graph.nodes) {
    if (!node || !node.id) throw new Error("Each workflow node needs an id");
    onProgress({ step: node.id, status: "running" });

    let content;
    if (node.kind === "local" || typeof node.run === "function") {
      // Local node: no model call, pure JS transform of the context.
      content = String(node.run ? node.run(ctx) : ctx.input || "");
      steps.push({ name: node.name, model: null, costMicros: 0 });
    } else if (node.retrieval && mode === "paste") {
      // Retrieval node in paste mode: use the user-pasted sources, no model call.
      const pasted = research.buildPasteSources(ctx.pastedSources);
      if (!pasted.length) throw new Error("Paste mode needs at least one source");
      content = research.aggregateContext(pasted);
      steps.push({ name: node.name, model: null, costMicros: 0 });
    } else {
      // Model node (incl. retrieval in search mode): resolve the alias to a real
      // model id for the active tier, then call the injected model.
      const label = tierModels[node.alias];
      if (!label) throw new Error("No model configured for alias " + node.alias);
      const modelId = v98Models.resolveModelId(label);
      const messages = node.build(ctx);
      const res = await callModel(modelId, messages, node.maxTokens || 1024);
      account(node.name, modelId, res.usage);
      content = res.content;
    }

    ctx.outputs[node.id] = content;
    if (typeof node.parse === "function") ctx.parsed[node.id] = node.parse(content, ctx);
    if (node.isFinal) finalId = node.id;

    onProgress({ step: node.id, status: "done" });
  }

  if (!finalId) finalId = graph.nodes[graph.nodes.length - 1].id;

  return {
    report: ctx.outputs[finalId] || "",
    steps,
    totalCostMicros,
    outputs: ctx.outputs,
  };
}

module.exports = { runWorkflowGraph };
