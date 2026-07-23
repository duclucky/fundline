"use strict";

const assert = require("assert");
const { executeWorkflowDefinition } = require("./workflow-execution");

async function main() {
  const calls = [];
  const finalizedTypes = [];
  const finalizeResult = async (result, options) => {
    finalizedTypes.push({
      slug: options.slug,
      tier: options.tier,
      runId: options.runId,
    });
    const file = {
      format: "pdf",
      filename: options.slug + ".pdf",
      mimeType: "application/pdf",
      url: "https://fundline.test/d/pdf",
    };
    return { ...result, file, artifacts: [file] };
  };
  const base = {
    tierDef: { models: { FAST: "fast", STRONG: "strong", VERIFY: "verify" } },
    finalModelId: "gpt-5.6-luna",
    input: { prompt: "Build proposal" },
    query: "Build proposal",
    groupRatio: 1,
    today: "2026-07-23",
    callModel: async () => ({}),
    onProgress: () => calls.push(["progress"]),
    executors: {
      engine: {
        runWorkflowGraph: async (options) => {
          calls.push(["graph", options.finalModelId, options.input]);
          return { report: "graph", steps: [], totalCostMicros: 1 };
        },
      },
      cvGig: {
        runCvGigWorkflow: async (options) => {
          calls.push(["cvgig", options.rankModel, options.remoteOnly]);
          return {
            report: "cv",
            steps: [],
            totalCostMicros: 2,
            meta: { sourceCounts: { JSearch: 2 } },
          };
        },
      },
      cryptoDd: {
        runCryptoDdWorkflow: async (options) => {
          calls.push(["cryptodd", options.writerModel, options.verifierModel]);
          return { report: "crypto", steps: [], totalCostMicros: 3 };
        },
      },
      docGen: {
        runDocGenWorkflow: async (options) => {
          calls.push(["docgen", options.writerModel, options.docType]);
          return {
            report: "doc",
            steps: [],
            totalCostMicros: 4,
            file: { base64: "QQ==", filename: "a.pdf", format: "pdf" },
          };
        },
      },
    },
  };

  let jsearchUses = 0;
  const cvResult = await executeWorkflowDefinition({
    ...base,
    def: { type: "cvgig" },
    input: { remoteOnly: true },
    workflowSlug: "cv-gig-match",
    tier: "normal",
    runId: "cv-run",
    finalizeResult,
    onJsearchUsed: () => { jsearchUses += 1; },
  });
  assert.equal(cvResult.report, "cv");
  assert.equal(cvResult.file.mimeType, "application/pdf");
  assert.deepEqual(calls.shift(), ["cvgig", "gpt-5.6-luna", true]);
  assert.equal(jsearchUses, 1);

  base.executors.cvGig.runCvGigWorkflow = async () => ({
    report: "cv-no-jsearch",
    steps: [],
    totalCostMicros: 2,
    meta: { sourceCounts: { RemoteOK: 3 } },
  });
  await executeWorkflowDefinition({
    ...base,
    def: { type: "cvgig" },
    workflowSlug: "cv-gig-match",
    tier: "normal",
    runId: "cv-run-2",
    finalizeResult,
    onJsearchUsed: () => { jsearchUses += 1; },
  });
  assert.equal(jsearchUses, 1);

  await executeWorkflowDefinition({
    ...base,
    def: { type: "cryptodd" },
    input: { chain: "arc", token: "0xtoken" },
    workflowSlug: "crypto-dd",
    tier: "plus",
    runId: "crypto-run",
    finalizeResult,
  });
  assert.deepEqual(calls.shift(), ["cryptodd", "gpt-5.6-luna", "verify"]);

  const docResult = await executeWorkflowDefinition({
    ...base,
    def: { type: "docgen", docType: "proposal" },
    workflowSlug: "proposal-doc",
    tier: "pro",
    runId: "doc-run",
    finalizeResult,
  });
  assert.deepEqual(calls.shift(), ["docgen", "gpt-5.6-luna", "proposal"]);
  assert.deepEqual(docResult.file, {
    format: "pdf",
    filename: "proposal-doc.pdf",
    mimeType: "application/pdf",
    url: "https://fundline.test/d/pdf",
  });

  await executeWorkflowDefinition({
    ...base,
    def: { type: "graph" },
    graph: { nodes: [] },
    mode: "paste",
    pastedSources: ["source"],
    workflowSlug: "client-research",
    tier: "normal",
    runId: "graph-run",
    finalizeResult,
  });
  assert.deepEqual(calls.shift(), ["graph", "gpt-5.6-luna", "Build proposal"]);
  assert.deepEqual(finalizedTypes, [
    { slug: "cv-gig-match", tier: "normal", runId: "cv-run" },
    { slug: "cv-gig-match", tier: "normal", runId: "cv-run-2" },
    { slug: "crypto-dd", tier: "plus", runId: "crypto-run" },
    { slug: "proposal-doc", tier: "pro", runId: "doc-run" },
    { slug: "client-research", tier: "normal", runId: "graph-run" },
  ]);

  console.log("PASS: workflow execution router");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
