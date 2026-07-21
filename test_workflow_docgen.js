"use strict";

// Offline test for workflow-docgen.js. Injected callModel + searchWeb; renders a real PDF
// (pdfkit) so it exercises the full input -> document-spec -> file path.
// Run: node test_workflow_docgen.js

const D = require("./workflow-docgen");

let passed = 0;
let failed = 0;
function assert(name, cond) { if (cond) { passed++; } else { failed++; console.error("FAIL: " + name); } }
async function assertThrows(name, fn, code) {
  try { await fn(); failed++; console.error("FAIL (no throw): " + name); }
  catch (e) { if (!code || e.code === code) { passed++; } else { failed++; console.error("FAIL (code): " + name + " got " + e.code); } }
}

const VALID = '{"docType":"proposal","meta":{"title":"Test Proposal","sender":"Fundline","recipient":"Acme"},'
  + '"sections":[{"heading":"Executive summary","blocks":[{"type":"paragraph","text":"Summary text here."},'
  + '{"type":"list","items":["a","b"]}]},{"heading":"Pricing","blocks":[{"type":"table","columns":["Item","Amount"],'
  + '"rows":[["X","100"],["Total","100"]]}]}]}';
const usage = { prompt_tokens: 400, completion_tokens: 800 };

function isPdf(b64) { return Buffer.from(b64, "base64").slice(0, 5).toString("latin1") === "%PDF-"; }
function once(content) { return () => Promise.resolve({ content: content, usage: usage }); }

(async () => {
  // parseDocSpec
  assert("parse valid", !!D.parseDocSpec(VALID));
  assert("parse fenced", !!D.parseDocSpec("```json\n" + VALID + "\n```"));
  assert("parse garbage null", D.parseDocSpec("not json") === null);
  assert("parse no sections null", D.parseDocSpec('{"meta":{}}') === null);
  const dropped = D.parseDocSpec('{"sections":[{"heading":"H","blocks":[{"type":"paragraph","text":"ok"},{"type":"bogus","x":1}]}]}');
  assert("parse drops bad block", dropped && dropped.sections[0].blocks.length === 1);
  assert("parse salvages prose-wrapped json", !!D.parseDocSpec("Here is your proposal:\n\n" + VALID + "\n\nHope this helps!"));

  // happy path -> real PDF
  const r1 = await D.runDocGenWorkflow({ docType: "proposal", input: "Build X for Acme, 3 phases, 11000 USDC", callModel: once(VALID) });
  assert("file is pdf", r1.file.format === "pdf" && isPdf(r1.file.base64));
  assert("outline 2 sections", r1.outline.length === 2);
  assert("spec parsed sections", r1.documentSpec.sections.length === 2);
  assert("cost accounted", r1.totalCostMicros > 0);
  assert("filename .pdf", /\.pdf$/.test(r1.file.filename));
  assert("one writer step", r1.steps.filter((s) => s.name.indexOf("Document writer") === 0).length === 1);
  assert("report markdown has title", typeof r1.report === "string" && r1.report.indexOf("# Test Proposal") === 0);

  // retry: first garbage, second valid
  let c2 = 0;
  const fakeRetry = () => { c2 += 1; return Promise.resolve({ content: c2 === 1 ? "garbage" : VALID, usage: usage }); };
  const r2 = await D.runDocGenWorkflow({ docType: "proposal", input: "x", callModel: fakeRetry });
  assert("retry used valid spec", r2.documentSpec.meta.title === "Test Proposal");
  assert("retry two writer steps", r2.steps.filter((s) => s.name.indexOf("Document writer") === 0).length === 2);

  // fallback: both garbage -> minimal spec, still a file
  const r3 = await D.runDocGenWorkflow({ docType: "report", input: "some content", callModel: once("still garbage") });
  assert("fallback still pdf", isPdf(r3.file.base64));
  assert("fallback has a section", r3.documentSpec.sections.length >= 1);

  // research mode: searchWeb called, sources included
  let searched = false;
  const r4 = await D.runDocGenWorkflow({
    docType: "report", input: "Research Acme", research: true,
    searchWeb: () => { searched = true; return Promise.resolve([{ title: "S1", url: "http://s1", content: "data" }]); },
    callModel: once('{"sections":[{"heading":"Findings","blocks":[{"type":"paragraph","text":"f"}]}]}'),
  });
  assert("research called", searched === true);
  assert("research sources in result", r4.sources.length === 1 && r4.sources[0].url === "http://s1");

  // missing input throws
  await assertThrows("missing input throws", () => D.runDocGenWorkflow({ docType: "proposal", input: "", callModel: once(VALID) }), "missing_input");

  // invalid docType defaults to proposal
  const r5 = await D.runDocGenWorkflow({ docType: "weird", input: "x", callModel: once(VALID) });
  assert("invalid docType -> proposal", r5.meta.docType === "proposal");

  console.log((failed === 0 ? "PASS" : "FAIL") + ": " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
})();
