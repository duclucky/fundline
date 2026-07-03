"use strict";

// Standalone test for gig-sources normalization + orchestration.
// Run: node test_gig_sources.js. Uses injected getJson (fixtures), no network.

const G = require("./gig-sources");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

// --- normalizeFreelancer ---
const flJson = {
  result: {
    projects: [
      {
        title: "Expert Solidity Contract Development",
        seo_url: "solidity/Expert-Solidity-Contract-Development",
        currency: { code: "USD" },
        budget: { minimum: 750, maximum: 1500 },
        preview_description: "Need a <b>Solidity</b> dev for a token.",
        submitdate: 1750000000,
      },
      { title: "" },
    ],
  },
};
const fl = G.normalizeFreelancer(flJson);
eq("freelancer count (empty title skipped)", fl.length, 1);
eq("freelancer source", fl[0].source, "Freelancer.com");
eq("freelancer budget", fl[0].budget, "750 - 1500 USD");
eq("freelancer url", fl[0].url, "https://www.freelancer.com/projects/solidity/Expert-Solidity-Contract-Development");
check("freelancer snippet strips html", fl[0].snippet.indexOf("<b>") === -1);

// --- normalizeHackerNews (seeking filter) ---
const hnJson = {
  hits: [
    { objectID: "1", author: "acme", comment_text: "REMOTE | CONTRACT | Solidity Developer. We are hiring.", created_at: "2026-06-01T00:00:00Z" },
    { objectID: "2", author: "bob", comment_text: "I am a developer available for work. My stack is Go." },
    { objectID: "3", comment_text: "" },
  ],
};
const hn = G.normalizeHackerNews(hnJson);
eq("hn keeps only seeking-like", hn.length, 1);
eq("hn url", hn[0].url, "https://news.ycombinator.com/item?id=1");
eq("hn remote flag", hn[0].remote, true);

// --- normalizeJSearch ---
const jsJson = {
  data: [
    {
      job_title: "Solidity Developer",
      employer_name: "IntellectEU",
      job_is_remote: true,
      job_min_salary: 100000,
      job_max_salary: 150000,
      job_salary_currency: "USD",
      job_apply_link: "https://ziprecruiter.com/x",
      job_description: "Build contracts.",
    },
    { job_title: "" },
  ],
};
const js = G.normalizeJSearch(jsJson);
eq("jsearch count", js.length, 1);
eq("jsearch org", js[0].org, "IntellectEU");
eq("jsearch budget", js[0].budget, "100000 - 150000 USD");
eq("jsearch location remote", js[0].location, "Remote");

// --- mergeAndDedupe ---
const merged = G.mergeAndDedupe([
  [{ title: "A", org: "X", url: "http://a" }],
  [{ title: "A", org: "X", url: "http://a" }, { title: "B", org: "Y", url: "" }],
  [{ title: "b", org: "y", url: "" }],
]);
eq("merge dedupes url and title+org", merged.length, 2);

// --- fetchGigs orchestrator (injected getJson) ---
function fakeGetJson(url) {
  if (url.indexOf("freelancer.com") !== -1) return Promise.resolve({ status: 200, json: flJson });
  if (url.indexOf("hn.algolia.com") !== -1) return Promise.resolve({ status: 200, json: hnJson });
  if (url.indexOf("openwebninja.com") !== -1) return Promise.resolve({ status: 200, json: jsJson });
  return Promise.resolve({ status: 404, json: null });
}

(async () => {
  // Free sources only (no JSearch when useJSearch false).
  const r1 = await G.fetchGigs({ keywords: ["solidity"], getJson: fakeGetJson, useJSearch: false, jsearchKey: "ak_x" });
  check("free-only excludes JSearch", !("JSearch" in r1.sourceCounts));
  eq("free-only gig count", r1.gigs.length, 2);

  // With JSearch top-up.
  const r2 = await G.fetchGigs({ keywords: ["solidity"], getJson: fakeGetJson, useJSearch: true, jsearchKey: "ak_x" });
  check("jsearch included when enabled", ("JSearch" in r2.sourceCounts));
  eq("with-jsearch gig count", r2.gigs.length, 3);

  // A failing source is skipped, not fatal.
  function partialGetJson(url) {
    if (url.indexOf("freelancer.com") !== -1) return Promise.reject(new Error("boom"));
    return fakeGetJson(url);
  }
  const r3 = await G.fetchGigs({ keywords: ["solidity"], getJson: partialGetJson, useJSearch: false });
  eq("failing source recorded", r3.errors.length, 1);
  eq("failing source still returns others", r3.gigs.length, 1);

  // maxGigs cap + dropped count.
  const many = { result: { projects: [] } };
  for (let i = 0; i < 12; i++) many.result.projects.push({ title: "P" + i, seo_url: "p/" + i, currency: { code: "USD" }, budget: {} });
  const r4 = await G.fetchGigs({ keywords: ["x"], getJson: () => Promise.resolve({ status: 200, json: many }), useJSearch: false, maxGigs: 5 });
  eq("maxGigs cap", r4.gigs.length, 5);
  eq("dropped count", r4.dropped, 7);

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
