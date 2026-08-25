"use strict";

// Standalone test for the research executor. Run: node test_workflow_research.js
// Uses injected fake callModel/searchWeb, so no network or API key is needed.

const R = require("./workflow-research");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

// --- parsePlannerQueries ---
eq("planner json array", JSON.stringify(R.parsePlannerQueries('["a","b","c","d"]', "q", 3)), JSON.stringify(["a", "b", "c"]));
eq("planner quoted fallback", JSON.stringify(R.parsePlannerQueries('1. "alpha" 2. "beta"', "q", 3)), JSON.stringify(["alpha", "beta"]));
eq("planner empty -> fallback query", JSON.stringify(R.parsePlannerQueries("nonsense", "the query", 3)), JSON.stringify(["the query"]));

// --- parsePersona ---
const p1 = R.parsePersona('{"server":"\u{1F4B0} Finance Agent","agent_role_prompt":"You are a finance analyst."}');
eq("persona server emoji stripped", p1.server, "Finance Agent");
eq("persona role prompt", p1.agent_role_prompt, "You are a finance analyst.");
check("persona invalid -> null", R.parsePersona("no json here") === null);

// --- buildPasteSources ---
const ps = R.buildPasteSources(["plain text", { title: "T", url: "http://u", content: "body" }, { content: "" }]);
eq("paste sources count", ps.length, 2);
eq("paste first is string", ps[0].content, "plain text");
eq("paste second title", ps[1].title, "T");

// --- selectTopSources ---
const top = R.selectTopSources([
  { title: "low", url: "x", content: "c", score: 0.1 },
  { title: "high", url: "y", content: "c", score: 0.9 },
  { title: "mid", url: "z", content: "c", score: 0.5 },
], 2);
eq("top sources sorted by score", JSON.stringify(top.map((s) => s.title)), JSON.stringify(["high", "mid"]));

// --- aggregateContext ---
check("context includes url", R.aggregateContext([{ title: "T", url: "http://u", content: "body" }]).indexOf("(http://u)") !== -1);

// --- end-to-end with fakes ---
(async () => {
  // Search mode: 4 callModel calls (role, plan, search model, writer).
  let calls = 0;
  const calledModels = [];
  const usageRole   = { prompt_tokens: 50,  completion_tokens: 20  };
  const usagePlan   = { prompt_tokens: 30,  completion_tokens: 15  };
  const usageSearch = { prompt_tokens: 800, completion_tokens: 1200 };
  const usageWrite  = { prompt_tokens: 500, completion_tokens: 300  };
  function fakeCall(modelId, messages, maxTokens) {
    calls += 1;
    calledModels.push(modelId);
    if (calls === 1) return Promise.resolve({ content: '{"server":"\u{1F4B0} Finance Agent","agent_role_prompt":"You are a finance analyst."}', usage: usageRole });
    if (calls === 2) return Promise.resolve({ content: '["q1","q2","q3"]', usage: usagePlan });
    if (calls === 3) return Promise.resolve({ content: "Web findings: Acme Corp is a tech company ([acme.com](http://acme.com))", usage: usageSearch });
    return Promise.resolve({ content: "# Report\nFinding ([A](http://acme.com))\n\n## References\n[http://acme.com](http://acme.com)", usage: usageWrite });
  }

  // Track which step fired the onProgress events.
  const progressEvents = [];
  const res = await R.runResearchWorkflow({
    query: "Research Acme Corp for a partnership",
    mode: "search",
    cheapModel: "gpt-4o-mini",
    writerModel: "deepseek-v3.2",
    groupRatio: 1,
    today: "2026-06-28",
    callModel: fakeCall,
    onProgress: (evt) => progressEvents.push(evt),
  });

  check("report produced", res.report.indexOf("# Report") === 0);
  eq("persona resolved + emoji stripped", res.persona.server, "Finance Agent");
  eq("queries parsed", res.queries.length, 3);
  eq("step count (role, plan, web, writer)", res.steps.length, 4);
  eq("default search model", calledModels[2], "deepseek-r1");
  // progress: 4 steps x 2 events (running + done) = 8
  eq("onProgress events", progressEvents.length, 8);
  check("first event is role_analysis running", progressEvents[0].step === "role_analysis" && progressEvents[0].status === "running");
  check("last event is report_writer done", progressEvents[7].step === "report_writer" && progressEvents[7].status === "done");
  // cost: role(gpt-4o-mini) 50*0.15+20*0.60=20; plan(gpt-4o-mini) 30*0.15+15*0.60=14;
  //        search(deepseek-r1) 800*4.00+1200*16.00=22400; write(deepseek-v3.2) 500*2.00+300*3.00=1900; total 24334
  eq("total cost micros", res.totalCostMicros, 24334);

  // Paste mode: 3 callModel calls (role, plan, writer) -- search model not called.
  let calls2 = 0;
  function fakeCall2(modelId, messages, maxTokens) {
    calls2 += 1;
    if (calls2 === 1) return Promise.resolve({ content: '{"server":"Analyst","agent_role_prompt":"You analyze."}', usage: usageRole });
    if (calls2 === 2) return Promise.resolve({ content: '["q1"]', usage: usagePlan });
    return Promise.resolve({ content: "# Paste Report\nSummary.", usage: usageWrite });
  }
  const res2 = await R.runResearchWorkflow({
    query: "Summarize these",
    mode: "paste",
    pastedSources: [{ title: "Doc", url: "http://d", content: "important data" }],
    callModel: fakeCall2,
    today: "2026-06-28",
  });
  check("paste mode produced report", typeof res2.report === "string" && res2.report.length > 0);
  eq("paste mode: 3 model calls (no search model)", calls2, 3);
  eq("paste mode step count", res2.steps.length, 4);

  // Paste mode with empty sources throws.
  let threw = false;
  try {
    await R.runResearchWorkflow({
      query: "x", mode: "paste", pastedSources: [], callModel: fakeCall2, today: "2026-06-28",
    });
  } catch (e) { threw = true; }
  check("paste mode empty sources throws", threw === true);

  console.log(`\nresearch executor test: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
