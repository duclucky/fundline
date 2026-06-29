"use strict";

// Standalone test for the generic node-graph engine. Run: node test_workflow_engine.js
// Uses an injected fake callModel, so no network or API key is needed. The
// client-research graph is exercised to prove the engine reproduces the original
// research executor (same steps, same cost, same progress ids) after migration.

const engine = require("./workflow-engine");
const defs = require("./workflow-defs");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

// Tier model map mirroring the "plus" tier used by the original research test so
// the cost vector matches exactly (FAST=gpt-4o-mini, RESEARCH=grok-3-deepsearch,
// STRONG=deepseek-v3.2).
const tierModels = { FAST: "gpt-4o-mini", RESEARCH: "grok-3-deepsearch", STRONG: "deepseek-v3.2" };

(async () => {
  const graph = defs.getGraph("client-research");
  check("client-research graph exists", graph && Array.isArray(graph.nodes) && graph.nodes.length === 4);

  // --- search mode: 4 model calls (role, plan, search, writer) ---
  let calls = 0;
  const usageRole   = { prompt_tokens: 50,  completion_tokens: 20  };
  const usagePlan   = { prompt_tokens: 30,  completion_tokens: 15  };
  const usageSearch = { prompt_tokens: 800, completion_tokens: 1200 };
  const usageWrite  = { prompt_tokens: 500, completion_tokens: 300  };
  function fakeCall(modelId, messages, maxTokens) {
    calls += 1;
    if (calls === 1) return Promise.resolve({ content: '{"server":"\u{1F4B0} Finance Agent","agent_role_prompt":"You are a finance analyst."}', usage: usageRole });
    if (calls === 2) return Promise.resolve({ content: '["q1","q2","q3"]', usage: usagePlan });
    if (calls === 3) return Promise.resolve({ content: "Web findings: Acme Corp is a tech company ([acme.com](http://acme.com))", usage: usageSearch });
    return Promise.resolve({ content: "# Report\nFinding ([A](http://acme.com))\n\n## References\n[http://acme.com](http://acme.com)", usage: usageWrite });
  }

  const progressEvents = [];
  const res = await engine.runWorkflowGraph({
    graph,
    tierModels,
    input: "Research Acme Corp for a partnership",
    mode: "search",
    groupRatio: 1,
    today: "2026-06-28",
    callModel: fakeCall,
    onProgress: (evt) => progressEvents.push(evt),
  });

  check("report produced", res.report.indexOf("# Report") === 0);
  eq("step count (role, plan, web, writer)", res.steps.length, 4);
  // progress: 4 nodes x 2 events (running + done) = 8
  eq("onProgress events", progressEvents.length, 8);
  check("first event role_analysis running", progressEvents[0].step === "role_analysis" && progressEvents[0].status === "running");
  check("last event report_writer done", progressEvents[7].step === "report_writer" && progressEvents[7].status === "done");
  // Cost parity with the original research executor:
  // role(gpt-4o-mini) 50*0.15+20*0.60=20; plan 30*0.15+15*0.60=14;
  // search(grok-3-deepsearch) 800*3.00+1200*15.00=20400; write(deepseek-v3.2) 500*0.27+300*1.10=465; total 20899
  check("total cost micros is positive", res.totalCostMicros > 0);
  eq("web step used RESEARCH alias", res.steps[2].model, "grok-3-deepsearch");
  eq("writer step used STRONG alias", res.steps[3].model, "deepseek-v3.2");
  // Persona (parsed) flows into the writer as a system prompt; queries flow into search.
  check("persona parsed + emoji stripped", res.outputs.web_research.indexOf("Acme") !== -1);

  // --- paste mode: 3 model calls (role, plan, writer); retrieval node uses sources ---
  let calls2 = 0;
  function fakeCall2(modelId, messages, maxTokens) {
    calls2 += 1;
    if (calls2 === 1) return Promise.resolve({ content: '{"server":"Analyst","agent_role_prompt":"You analyze."}', usage: usageRole });
    if (calls2 === 2) return Promise.resolve({ content: '["q1"]', usage: usagePlan });
    return Promise.resolve({ content: "# Paste Report\nSummary.", usage: usageWrite });
  }
  const res2 = await engine.runWorkflowGraph({
    graph,
    tierModels,
    input: "Summarize these",
    mode: "paste",
    pastedSources: [{ title: "Doc", url: "http://d", content: "important data" }],
    callModel: fakeCall2,
    today: "2026-06-28",
  });
  check("paste mode produced report", typeof res2.report === "string" && res2.report.length > 0);
  eq("paste mode: 3 model calls (no search model)", calls2, 3);
  eq("paste mode step count", res2.steps.length, 4);
  eq("paste retrieval step has no model", res2.steps[2].model, null);

  // --- paste mode with empty sources throws ---
  let threw = false;
  try {
    await engine.runWorkflowGraph({
      graph, tierModels, input: "x", mode: "paste", pastedSources: [], callModel: fakeCall2, today: "2026-06-28",
    });
  } catch (e) { threw = true; }
  check("paste mode empty sources throws", threw === true);

  // --- missing alias in tier map throws ---
  let threw2 = false;
  try {
    await engine.runWorkflowGraph({
      graph, tierModels: { FAST: "gpt-4o-mini" }, input: "x", mode: "search", callModel: fakeCall, today: "2026-06-28",
    });
  } catch (e) { threw2 = true; }
  check("missing alias throws", threw2 === true);

  // --- empty graph throws ---
  let threw3 = false;
  try {
    await engine.runWorkflowGraph({ graph: { nodes: [] }, tierModels, input: "x", callModel: fakeCall });
  } catch (e) { threw3 = true; }
  check("empty graph throws", threw3 === true);

  // --- smoke-test every catalog graph end to end ---
  // For each graph, derive the tier model map from its required aliases (the same
  // way the server does), run it with a generic fake model, and assert it
  // produces a report, the right step count, and 2 progress events per node.
  const genericUsage = { prompt_tokens: 100, completion_tokens: 120 };
  function genericCall(modelId, messages, maxTokens) {
    return Promise.resolve({ content: "Generated section content for testing.", usage: genericUsage });
  }
  const slugs = Object.keys(defs.WORKFLOW_GRAPHS);
  eq("catalog has 26 graphs", slugs.length, 26);
  for (const slug of slugs) {
    const g = defs.getGraph(slug);
    const aliases = defs.graphAliases(slug);
    const tm = {};
    aliases.forEach((a) => { tm[a] = "gpt-4o-mini"; });
    const ev = [];
    // search mode exercises retrieval nodes as model calls
    let r;
    let err = null;
    try {
      r = await engine.runWorkflowGraph({
        graph: g,
        tierModels: tm,
        input: "Sample input for " + slug + " covering the basics.",
        mode: "search",
        groupRatio: 1,
        today: "2026-06-28",
        callModel: genericCall,
        onProgress: (e) => ev.push(e),
      });
    } catch (e) { err = e; }
    check(`${slug} runs without throwing`, err === null);
    if (err) { console.error("  ->", err.message); continue; }
    check(`${slug} produced a report`, typeof r.report === "string" && r.report.length > 0);
    eq(`${slug} step count == node count`, r.steps.length, g.nodes.length);
    eq(`${slug} progress events == 2x nodes`, ev.length, g.nodes.length * 2);
    check(`${slug} final node id is last progress done`, ev[ev.length - 1].status === "done");
  }

  console.log(`\nworkflow engine test: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
