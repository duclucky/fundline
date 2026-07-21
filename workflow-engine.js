"use strict";

// Generic node-graph workflow engine (hybrid DAG scheduler). A workflow is a set
// of nodes; each node runs a v98store model (its alias is resolved to a real model
// id from the active tier), a local JS step, or a retrieval step (web search or
// pasted sources). Nodes read prior node outputs explicitly (via out(ctx, id) in
// their prompt builder), so the set of ids a node reads IS its dependency set.
//
// The engine detects those dependencies automatically (by probing each node's
// build/searchQueries with a recording proxy), then runs the graph as a DAG:
// independent nodes run concurrently, dependent nodes wait for their inputs, and
// the final node (GPT 5.6, the premium synthesizer) runs last once every step it
// reads is ready. Output and cost are IDENTICAL to the old sequential engine
// (each node still sees exactly the outputs it reads); only wall-clock is lower.
//
// It mirrors the shape of the original research executor: it takes an injected
// callModel so it is testable without network, emits onProgress per node for the
// SSE canvas animation, sums cost in integer micro-USD via v98-models, and
// returns { report, steps, totalCostMicros, outputs }.
//
// Node shape (see workflow-defs.js):
//   { id, name, alias, maxTokens, build(ctx)->messages[], parse?(content,ctx),
//     retrieval?:true, searchQueries?(ctx)->string[], run?(ctx)->string (local),
//     deps?:[ids] (optional explicit override), isFinal?:true }
// ctx = { input, today, mode, pastedSources, maxQueries, totalWords,
//         outputs:{id->content}, parsed:{id->value} }

const v98Models = require("./v98-models");
const modelCost = require("./model-cost");
const research = require("./workflow-research");

// A recording proxy: every string property read is added to `set`, and the read
// returns undefined so callers fall back to their defaults (out() -> "", etc.).
function recordingProxy(set) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (typeof prop === "string") set.add(prop);
        return undefined;
      },
      has() {
        return false;
      },
    }
  );
}

// Determine, for each node, which prior node ids it depends on. Preference order:
//   1. an explicit node.deps array (author override), intersected with prior ids;
//   2. probing node.build / node.searchQueries / node.run against a proxy that
//      records which ctx.outputs / ctx.parsed keys are read;
//   3. on any probe failure, fall back conservatively to ALL prior nodes so a
//      node can never run before something it might read (correctness over speed).
function computeDependencies(nodes, baseCtx) {
  const idToIndex = {};
  nodes.forEach((n, i) => { idToIndex[n.id] = i; });
  const deps = new Array(nodes.length);

  nodes.forEach((node, index) => {
    const priorIds = new Set();
    for (let j = 0; j < index; j++) priorIds.add(nodes[j].id);

    // Explicit override.
    if (Array.isArray(node.deps)) {
      deps[index] = new Set(node.deps.filter((d) => priorIds.has(d)));
      return;
    }

    const reads = new Set();
    const probeCtx = Object.assign({}, baseCtx, {
      outputs: recordingProxy(reads),
      parsed: recordingProxy(reads),
    });
    try {
      if (typeof node.searchQueries === "function") node.searchQueries(probeCtx);
      if (typeof node.build === "function") node.build(probeCtx);
      if (typeof node.run === "function") node.run(probeCtx);
      const found = new Set();
      reads.forEach((id) => { if (priorIds.has(id)) found.add(id); });
      deps[index] = found;
    } catch (_e) {
      // Uncertain: depend on everything before it (behaves like sequential).
      deps[index] = new Set(priorIds);
    }
  });

  return deps;
}

// opts: {
//   graph: { name, nodes:[...] }, tierModels: { ALIAS -> model label },
//   input, mode ("search"|"paste"), pastedSources, groupRatio, today,
//   maxQueries, totalWords, maxConcurrency,
//   callModel(modelId, messages, maxTokens) -> { content, usage:{prompt_tokens,completion_tokens} },
//   onProgress({ step, status }) -> void  (step = node.id, status = "running"|"done")
// }
// Returns { report, steps:[{name,model,costMicros}], totalCostMicros, outputs }
async function runWorkflowGraph(opts) {
  const graph = opts.graph;
  if (!graph || !Array.isArray(graph.nodes) || !graph.nodes.length) {
    throw new Error("Workflow graph is empty");
  }
  const nodes = graph.nodes;
  nodes.forEach((n) => { if (!n || !n.id) throw new Error("Each workflow node needs an id"); });

  const tierModels = opts.tierModels || {};
  const groupRatio = opts.groupRatio || 1;
  const callModel = opts.callModel;
  if (typeof callModel !== "function") throw new Error("callModel is required");
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
  const mode = opts.mode === "paste" ? "paste" : "search";
  // Optional real web-search provider (e.g. Tavily): searchWeb(query) -> results[]
  // (each { title, url, content, score }). When present, retrieval nodes fetch real
  // sources instead of asking a model. tavilyCostMicros is the per-search cost.
  const searchWeb = typeof opts.searchWeb === "function" ? opts.searchWeb : null;
  const maxSearches = opts.maxSearches || 3;
  const tavilyCostMicros = opts.tavilyCostMicros != null ? opts.tavilyCostMicros : 8000;
  // Cap on concurrent model calls (mirrors the "Max concurrent calls" shown in the UI).
  const maxConcurrency = Math.max(1, opts.maxConcurrency || 5);

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

  const idToIndex = {};
  nodes.forEach((n, i) => { idToIndex[n.id] = i; });
  const deps = computeDependencies(nodes, {
    input: ctx.input, today: ctx.today, mode: ctx.mode,
    pastedSources: ctx.pastedSources, maxQueries: ctx.maxQueries, totalWords: ctx.totalWords,
  });

  // Cost + step accounting. steps are stored by node index so the receipt shows
  // them in definition order regardless of the order they finished in.
  const stepsByIndex = new Array(nodes.length);
  let totalCostMicros = 0;
  function account(index, name, modelId, usage) {
    const cost = modelCost.costMicros(modelId, usage.prompt_tokens, usage.completion_tokens, groupRatio) || 0;
    totalCostMicros += cost;
    stepsByIndex[index] = { name, model: modelId, costMicros: cost };
    return cost;
  }

  // A tiny concurrency gate so many independent nodes do not all hit the provider
  // at once. A node acquires a slot only AFTER its dependencies resolve, so it
  // never holds a slot while waiting on another node (no deadlock).
  let active = 0;
  const waiters = [];
  function acquire() {
    if (active < maxConcurrency) { active += 1; return Promise.resolve(); }
    return new Promise((resolve) => waiters.push(resolve));
  }
  function release() {
    active -= 1;
    const next = waiters.shift();
    if (next) { active += 1; next(); }
  }

  async function runOneNode(node, index) {
    onProgress({ step: node.id, status: "running" });

    let content;
    if (node.kind === "local" || typeof node.run === "function") {
      // Local node: no model call, pure JS transform of the context.
      content = String(node.run ? node.run(ctx) : ctx.input || "");
      stepsByIndex[index] = { name: node.name, model: null, costMicros: 0 };
    } else if (node.retrieval && mode === "paste") {
      // Retrieval node in paste mode: use the user-pasted sources, no model call.
      const pasted = research.buildPasteSources(ctx.pastedSources);
      if (!pasted.length) throw new Error("Paste mode needs at least one source");
      content = research.aggregateContext(pasted);
      stepsByIndex[index] = { name: node.name, model: null, costMicros: 0 };
    } else if (node.retrieval && searchWeb) {
      // Retrieval node in search mode with a real web-search provider (Tavily):
      // gather real sources (title/url/snippet) and aggregate them with URLs so the
      // downstream nodes can cite them. No model call here.
      const wanted = (typeof node.searchQueries === "function" ? node.searchQueries(ctx) : [ctx.input]) || [];
      const qs = wanted.filter(Boolean).slice(0, maxSearches);
      const queries = qs.length ? qs : [ctx.input];
      let found = [];
      for (const q of queries) {
        try { const r = await searchWeb(String(q)); if (Array.isArray(r)) found = found.concat(r); } catch (_) {}
      }
      const top = research.selectTopSources(found, 8);
      content = top.length ? research.aggregateContext(top) : "No web results were found for this query.";
      const cost = tavilyCostMicros * queries.length;
      totalCostMicros += cost;
      stepsByIndex[index] = { name: node.name, model: "tavily", costMicros: cost };
    } else {
      // Model node (incl. retrieval in search mode with no provider): resolve the
      // alias to a real model id for the active tier, then call the injected model.
      // The final node (whose output is the deliverable) uses the premium model id
      // when one is provided; callModel routes that id to the premium endpoint.
      const useFinal = node.isFinal && opts.finalModelId;
      const label = tierModels[node.alias];
      if (!label && !useFinal) throw new Error("No model configured for alias " + node.alias);
      const modelId = useFinal ? opts.finalModelId : v98Models.resolveModelId(label);
      const messages = node.build(ctx);
      const res = await callModel(modelId, messages, node.maxTokens || 1024);
      account(index, node.name, modelId, res.usage);
      content = res.content;
    }

    ctx.outputs[node.id] = content;
    if (typeof node.parse === "function") ctx.parsed[node.id] = node.parse(content, ctx);

    onProgress({ step: node.id, status: "done" });
  }

  // Schedule every node: each waits for its dependency promises, then acquires a
  // concurrency slot and runs. Independent nodes start immediately and run in
  // parallel; the final synthesizer resolves last once its inputs are all ready.
  const done = {};
  nodes.forEach((node, index) => {
    done[node.id] = (async () => {
      const myDeps = deps[index];
      if (myDeps && myDeps.size) {
        await Promise.all(Array.from(myDeps).map((d) => done[d]));
      }
      await acquire();
      try {
        await runOneNode(node, index);
      } finally {
        release();
      }
    })();
  });

  await Promise.all(nodes.map((n) => done[n.id]));

  let finalNode = nodes.find((n) => n.isFinal);
  const finalId = finalNode ? finalNode.id : nodes[nodes.length - 1].id;

  const steps = stepsByIndex.filter(Boolean);

  return {
    report: ctx.outputs[finalId] || "",
    steps,
    totalCostMicros,
    outputs: ctx.outputs,
  };
}

module.exports = { runWorkflowGraph, computeDependencies };
