"use strict";

// Standalone test for the CV + Gig Match executor.
// Run: node test_workflow_cvgig.js. Injected fake callModel + fetchGigs, no network.

const C = require("./workflow-cvgig");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

// --- parseProfile ---
const prof = C.parseProfile('{"profession":"Dev","seniority":"Senior","skills":["Solidity"," "],"keywords":["solidity dev"],"summary":"x"}');
eq("profile profession", prof.profession, "Dev");
eq("profile skills filtered", prof.skills.length, 1);
check("profile invalid -> null", C.parseProfile("nope") === null);

// --- parseCvJson + normalizeCvJson ---
const cv = C.parseCvJson('{"name":"Jane","summary":"Builder","skills":["Go","Rust"],"experience":[{"role":"Dev","org":"Acme","bullets":["Shipped X"]}],"templateId":"modern"}');
eq("cv name", cv.name, "Jane");
eq("cv skills", cv.skills.length, 2);
eq("cv experience kept", cv.experience.length, 1);
eq("cv empty projects omitted", cv.projects.length, 0);
check("cv invalid -> null", C.parseCvJson("{}") === null);
eq("cv templateId sanitized", C.normalizeCvJson({ name: "x", templateId: "weird" }).templateId, "modern");

// --- selectTemplate ---
eq("dev -> modern", C.selectTemplate({ profession: "Software Engineer", skills: [] }), "modern");
eq("writer -> classic", C.selectTemplate({ profession: "Copywriter", skills: ["Writing"] }), "classic");

// --- parseRanked ---
const gigs = [{ title: "A" }, { title: "B" }, { title: "C" }];
const ranked = C.parseRanked('[{"index":2,"fit":90,"reason":"r","proposal":"p"},{"index":0,"fit":50},{"index":9,"fit":10},{"index":2,"fit":80}]', gigs);
eq("ranked valid indexes only + dedupe", ranked.length, 2);
eq("ranked first is index 2", ranked[0].title, "C");
eq("ranked fit clamped", ranked[0].fit, 90);
check("ranked invalid -> null", C.parseRanked("nope", gigs) === null);

// --- buildReport ---
const report = C.buildReport({ profession: "Dev", skills: ["Go"] }, { templateId: "modern" }, [{ title: "Gig X", url: "http://g", fit: 88, reason: "fits", proposal: "hi" }], { fetched: 3, dropped: 2 });
check("report has gig title", report.indexOf("Gig X") !== -1);
check("report has link", report.indexOf("http://g") !== -1);
check("report notes dropped", report.indexOf("top 1") !== -1);

// --- end-to-end with fakes ---
function makeFakeCall(cvContent) {
  return function (modelId, messages, maxTokens) {
    const sys = (messages[0] && messages[0].content) || "";
    let content = "{}";
    if (sys.indexOf("structured freelancer profile") !== -1) {
      content = '{"profession":"Blockchain Developer","seniority":"Senior","skills":["Solidity","Rust"],"keywords":["solidity developer"],"summary":"s"}';
    } else if (sys.indexOf("expert resume writer") !== -1) {
      content = cvContent;
    } else if (sys.indexOf("match a freelancer") !== -1) {
      content = '[{"index":0,"fit":92,"reason":"match","proposal":"opener"}]';
    }
    return Promise.resolve({ content, usage: { prompt_tokens: 100, completion_tokens: 200 } });
  };
}
function fakeFetchGigs() {
  return Promise.resolve({
    gigs: [{ source: "Freelancer.com", title: "Solidity gig", org: "", budget: "750 - 1500 USD", location: "Remote", remote: true, url: "http://f", snippet: "s" }],
    fetched: 1, dropped: 0, sourceCounts: { "Freelancer.com": 1, "Hacker News": 0 }, errors: [],
  });
}

(async () => {
  const goodCv = '{"name":"Jane Dev","headline":"Solidity Engineer","summary":"Builds contracts","skills":["Solidity","Rust"],"templateId":"modern"}';
  const res = await C.runCvGigWorkflow({
    input: "Senior Solidity dev, built DEX and ERC-20 platforms.",
    profileModel: "gpt-4o-mini",
    cvModel: "gpt-4.1-mini",
    rankModel: "gpt-4.1-mini",
    callModel: makeFakeCall(goodCv),
    fetchGigs: fakeFetchGigs,
  });
  check("e2e report string", typeof res.report === "string" && res.report.length > 0);
  eq("e2e cvJson name", res.cvJson.name, "Jane Dev");
  eq("e2e templateId set from selectTemplate", res.cvJson.templateId, "modern");
  eq("e2e gigs ranked", res.gigs.length, 1);
  eq("e2e gig fit", res.gigs[0].fit, 92);
  check("e2e cost summed > 0", res.totalCostMicros > 0);
  check("e2e steps recorded", res.steps.length >= 3);

  // CV JSON retry path: first CV reply is garbage, retry returns valid JSON.
  let cvCalls = 0;
  function retryCall(modelId, messages) {
    const sys = (messages[0] && messages[0].content) || "";
    if (sys.indexOf("structured freelancer profile") !== -1) {
      return Promise.resolve({ content: '{"profession":"Dev","skills":["Go"],"keywords":["go dev"]}', usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }
    if (sys.indexOf("expert resume writer") !== -1) {
      cvCalls += 1;
      const content = cvCalls === 1 ? "not json at all" : '{"name":"Retry Win","skills":["Go"]}';
      return Promise.resolve({ content, usage: { prompt_tokens: 10, completion_tokens: 10 } });
    }
    return Promise.resolve({ content: "[]", usage: { prompt_tokens: 10, completion_tokens: 10 } });
  }
  const res2 = await C.runCvGigWorkflow({
    input: "Go dev", callModel: retryCall, fetchGigs: fakeFetchGigs,
  });
  eq("cv retry produced valid cv", res2.cvJson.name, "Retry Win");
  eq("cv writer called twice", cvCalls, 2);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
