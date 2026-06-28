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
  let calls = 0;
  const usageRole = { prompt_tokens: 50, completion_tokens: 20 };
  const usagePlan = { prompt_tokens: 30, completion_tokens: 15 };
  const usageWrite = { prompt_tokens: 500, completion_tokens: 300 };
  function fakeCall(modelId, messages, maxTokens) {
    calls += 1;
    if (calls === 1) return Promise.resolve({ content: '{"server":"\u{1F4B0} Finance Agent","agent_role_prompt":"You are a finance analyst."}', usage: usageRole });
    if (calls === 2) return Promise.resolve({ content: '["q1","q2","q3"]', usage: usagePlan });
    return Promise.resolve({ content: "# Report\nFinding ([A](http://a))\n\n## References\n[http://a](http://a)", usage: usageWrite });
  }
  function fakeSearch(q) {
    return Promise.resolve([
      { title: "A", url: "http://a", content: "alpha facts", score: 0.9 },
      { title: "B", url: "http://b", content: "beta facts", score: 0.5 },
    ]);
  }

  const res = await R.runResearchWorkflow({
    query: "Research Acme Corp for a partnership",
    mode: "search",
    cheapModel: "gpt-4o-mini",
    writerModel: "gpt-4.1-mini",
    groupRatio: 1,
    today: "2026-06-28",
    callModel: fakeCall,
    searchWeb: fakeSearch,
  });

  check("report produced", res.report.indexOf("# Report") === 0);
  eq("persona resolved + emoji stripped", res.persona.server, "Finance Agent");
  eq("queries parsed", res.queries.length, 3);
  check("sources returned", res.sources.length === 2 && res.sources[0].url === "http://a");
  // cost: role 50*0.15+20*0.60=19.5->20; plan 30*0.15+15*0.60=13.5->14; write 500*0.40+300*1.60=680; total 714
  eq("total cost micros", res.totalCostMicros, 714);
  eq("step count (role, plan, web, writer)", res.steps.length, 4);

  // paste mode does not call search
  let searched = false;
  const res2 = await R.runResearchWorkflow({
    query: "Summarize these",
    mode: "paste",
    pastedSources: [{ title: "Doc", url: "http://d", content: "important data" }],
    callModel: fakeCall,
    searchWeb: () => { searched = true; return Promise.resolve([]); },
    today: "2026-06-28",
  });
  check("paste mode produced report", typeof res2.report === "string" && res2.report.length > 0);
  check("paste mode did not search", searched === false);

  // zero sources in search mode throws
  let threw = false;
  try {
    await R.runResearchWorkflow({
      query: "x", mode: "search", callModel: fakeCall, searchWeb: () => Promise.resolve([]), today: "2026-06-28",
    });
  } catch (e) { threw = true; }
  check("zero sources throws", threw === true);

  console.log(`\nresearch executor test: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
})();
