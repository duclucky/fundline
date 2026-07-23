"use strict";

const assert = require("assert");
const {
  finalizeWorkflowResult,
  markdownToDocumentSpec,
  renderWorkflowResultPdf,
  sanitizeFilePart,
} = require("./workflow-result-artifacts");

async function main() {
  const spec = markdownToDocumentSpec({
    slug: "client-research",
    tier: "normal",
    completedAt: "2026-07-23T12:00:00.000Z",
    report: "# Market Review\n\n## Findings\n\n- First\n- Second\n\n| Item | Value |\n| --- | --- |\n| Score | 92 |",
    structured: { score: 92 },
  });
  assert.equal(spec.meta.title, "Market Review");
  assert.equal(spec.sections.some((section) => section.heading === "Findings"), true);
  assert.equal(spec.sections.some((section) =>
    section.blocks.some((block) => block.type === "table")), true);
  assert.equal(spec.sections.some((section) =>
    section.blocks.some((block) => block.type === "code")), true);

  assert.equal(sanitizeFilePart("../../Bad Name"), "bad-name");

  const rendered = await renderWorkflowResultPdf({
    slug: "client-research",
    tier: "normal",
    runId: "0x" + "ab".repeat(32),
    completedAt: "2026-07-23T12:00:00.000Z",
    report: "# Report\n\nBody",
  });
  assert.equal(rendered.format, "pdf");
  assert.equal(rendered.mimeType, "application/pdf");
  assert.match(rendered.filename, /^client-research-2026-07-23-abababab\.pdf$/);
  const renderedBuffer = Buffer.from(rendered.base64, "base64");
  assert.equal(renderedBuffer.subarray(0, 5).toString("latin1"), "%PDF-");
  assert.equal((renderedBuffer.toString("latin1").match(/\/Type\s*\/Page\b/g) || []).length, 1);

  let renders = 0;
  const persistDocument = async (file) => ({
    format: file.format,
    filename: file.filename,
    mimeType: file.mimeType,
    url: "https://fundline.test/d/pdf",
  });
  const finalized = await finalizeWorkflowResult({
    report: "# Result",
    riskJson: { score: 7 },
  }, {
    slug: "crypto-dd",
    tier: "plus",
    completedAt: "2026-07-23T12:00:00.000Z",
    renderPdf: async () => {
      renders += 1;
      return Buffer.from("%PDF-generated");
    },
    persistDocument,
  });
  assert.equal(renders, 1);
  assert.equal(finalized.file.url, "https://fundline.test/d/pdf");
  assert.equal(finalized.file.mimeType, "application/pdf");
  assert.equal(finalized.artifacts.length, 1);

  const original = {
    format: "pdf",
    filename: "proposal.pdf",
    mimeType: "application/pdf",
    base64: Buffer.from("%PDF-original").toString("base64"),
  };
  renders = 0;
  const preserved = await finalizeWorkflowResult({
    report: "# Proposal",
    file: original,
    artifacts: [{
      kind: "file",
      role: "deliverable",
      filename: "sources.csv",
      format: "csv",
      mimeType: "text/csv",
      url: "https://fundline.test/d/sources",
    }],
  }, {
    slug: "proposal-doc",
    renderPdf: async () => {
      renders += 1;
      return Buffer.from("%PDF-wrong");
    },
    persistDocument,
  });
  assert.equal(renders, 0);
  assert.equal(preserved.file.filename, "proposal.pdf");
  assert.equal(preserved.artifacts.length, 2);
  assert.equal(preserved.artifacts[1].filename, "sources.csv");

  const warned = await finalizeWorkflowResult({ report: "# Kept" }, {
    slug: "client-research",
    renderPdf: async () => { throw new Error("renderer internals"); },
  });
  assert.equal(warned.report, "# Kept");
  assert.equal(warned.file, null);
  assert.equal(warned.artifactWarning, "The PDF deliverable could not be generated.");
  assert.equal(JSON.stringify(warned).includes("renderer internals"), false);

  console.log("PASS: workflow result artifacts");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
