# Workflow PDF Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every successful Fundline workflow one backend-generated PDF deliverable that the web application can download and MCP can identify as a file for the requesting user.

**Architecture:** Add a focused workflow-result finalizer that converts Markdown and optional structured JSON into the existing document-spec grammar, renders it with PDFKit, and persists it through the current capability URL store. Route every workflow type through that finalizer before result persistence or settlement, preserve workflow-generated PDFs, and expose the same `file` plus `artifacts[]` contract to the web and MCP.

**Tech Stack:** Node.js 20, CommonJS, PDFKit, vanilla browser JavaScript, disk-backed capability files, standalone Node assertion tests, Poppler and pypdf for PDF verification.

## Global Constraints

- Code, comments, UI copy, and docs are in English.
- Use CommonJS, two-space indentation, and double quotes.
- Do not use em dashes, website emoji, or icons attached to UI text.
- Do not rerun a workflow, call another model, or request another payment to create the PDF.
- Preserve an existing workflow-generated PDF exactly.
- Persist the complete result and PDF reference before escrow release.
- A PDF rendering failure preserves the successful AI output and returns `artifactWarning`.
- Do not expose secrets, prompts outside the authorized result, server paths, or predictable file URLs.
- Keep document capability retention at least as long as workflow-result retention.
- Preserve the existing non-custodial and USDC six-decimal payment behavior.
- Preserve unrelated user files and untracked workspace content.

---

### Task 1: Shared Markdown-to-PDF Result Finalizer

**Files:**
- Create: `workflow-result-artifacts.js`
- Create: `test_workflow_result_artifacts.js`
- Modify: `doc-render.js`

**Interfaces:**
- Consumes: `renderDocumentPdf(spec, options) -> Promise<Buffer>` from `doc-render.js`.
- Produces: `markdownToDocumentSpec(options) -> documentSpec`.
- Produces: `renderWorkflowResultPdf(options) -> Promise<{format, filename, mimeType, base64}>`.
- Produces: `finalizeWorkflowResult(result, options) -> Promise<result>`.
- `options` includes `slug`, `tier`, `runId`, `completedAt`, `persistDocument`, and injectable `renderPdf`.

- [ ] **Step 1: Write the failing finalizer tests**

Create `test_workflow_result_artifacts.js` with cases that assert:

```js
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
  assert.equal(Buffer.from(rendered.base64, "base64").subarray(0, 5).toString("latin1"), "%PDF-");

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
```

- [ ] **Step 2: Run the finalizer test and verify RED**

```powershell
node test_workflow_result_artifacts.js
```

Expected: FAIL because `workflow-result-artifacts.js` does not exist.

- [ ] **Step 3: Add code-block rendering to the existing PDF renderer**

Extend `renderBlock` in `doc-render.js`:

```js
  } else if (type === "code") {
    const text = String(block.text || "");
    const padding = 8;
    doc.font("Courier").fontSize(8.5);
    const height = doc.heightOfString(text, { width: width - padding * 2 }) + padding * 2;
    ensureSpace(doc, Math.min(height, 120));
    const y = doc.y;
    doc.save().fillColor(theme.stripe).rect(doc.page.margins.left, y, width, height).fill().restore();
    doc.fillColor(theme.text).font("Courier").fontSize(8.5)
      .text(text, doc.page.margins.left + padding, y + padding, {
        width: width - padding * 2,
        lineGap: 1,
      });
    doc.x = doc.page.margins.left;
    doc.y = y + height;
    doc.moveDown(0.4);
```

- [ ] **Step 4: Implement the focused result-artifact module**

Create `workflow-result-artifacts.js` with:

```js
"use strict";

const { renderDocumentPdf } = require("./doc-render");

const PDF_MIME = "application/pdf";
const ARTIFACT_WARNING = "The PDF deliverable could not be generated.";

function sanitizeFilePart(value) {
  return String(value || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workflow";
}

function pdfFilename(options) {
  const date = String(options.completedAt || new Date().toISOString()).slice(0, 10);
  const runId = String(options.runId || "").replace(/^0x/, "").slice(0, 8).toLowerCase();
  return sanitizeFilePart(options.slug) + "-" + date + (runId ? "-" + runId : "") + ".pdf";
}

function isPdf(file) {
  return !!file && (
    String(file.mimeType || "").toLowerCase() === PDF_MIME
    || String(file.format || "").toLowerCase() === "pdf"
    || /\.pdf$/i.test(String(file.filename || ""))
  );
}

function artifact(file) {
  if (!file || typeof file !== "object") return null;
  return {
    ...file,
    kind: "file",
    role: file.role || "deliverable",
    format: file.format || (isPdf(file) ? "pdf" : ""),
    mimeType: file.mimeType || (isPdf(file) ? PDF_MIME : "application/octet-stream"),
  };
}
```

Implement a line-oriented `markdownToDocumentSpec` parser that:

- Uses the first `# ` line as the document title.
- Starts a new section for `##` through `######` headings.
- Groups plain lines into paragraph blocks.
- Groups ordered and unordered Markdown list lines into list blocks.
- Parses pipe tables only when the second row is a Markdown separator.
- Converts fenced code blocks and pretty-printed structured JSON into `type: "code"` blocks.
- Uses `Workflow result` when no heading exists.
- Caps structured JSON at 20,000 characters.

Implement rendering and finalization:

```js
async function renderWorkflowResultPdf(options) {
  const spec = markdownToDocumentSpec(options);
  const renderPdf = options.renderPdf || renderDocumentPdf;
  const buffer = await renderPdf(spec, { footer: "Generated by Fundline" });
  return {
    format: "pdf",
    filename: pdfFilename(options),
    mimeType: PDF_MIME,
    base64: buffer.toString("base64"),
  };
}

async function finalizeWorkflowResult(result, options) {
  const next = { ...(result || {}) };
  const candidates = [next.file].concat(Array.isArray(next.artifacts) ? next.artifacts : [])
    .map(artifact)
    .filter(Boolean);
  let primary = candidates.find(isPdf) || null;
  try {
    if (!primary) {
      primary = artifact(await renderWorkflowResultPdf({
        ...options,
        report: next.report,
        structured: next.cvJson || next.riskJson || null,
      }));
      candidates.unshift(primary);
    }
    if (primary.base64 && typeof options.persistDocument === "function") {
      const stored = await options.persistDocument(primary);
      if (!stored || !stored.url) throw new Error("PDF persistence failed");
      const persisted = artifact(stored);
      const index = candidates.indexOf(primary);
      candidates[index] = persisted;
      primary = persisted;
    }
    next.file = primary;
    next.artifacts = candidates.filter((item, index, all) =>
      all.findIndex((candidate) =>
        candidate.url && item.url
          ? candidate.url === item.url
          : candidate.filename === item.filename && candidate.mimeType === item.mimeType
      ) === index);
    delete next.artifactWarning;
  } catch (error) {
    if (typeof options.onArtifactError === "function") options.onArtifactError(error);
    next.file = null;
    next.artifacts = candidates.filter((item) => item !== primary && item.url);
    next.artifactWarning = ARTIFACT_WARNING;
  }
  return next;
}
```

Export the five constants/functions needed by tests.

- [ ] **Step 5: Run the finalizer, document, and syntax tests**

```powershell
node test_workflow_result_artifacts.js
node test_workflow_docgen.js
node --check workflow-result-artifacts.js
node --check doc-render.js
```

Expected: all pass.

- [ ] **Step 6: Commit the shared finalizer**

```powershell
git add workflow-result-artifacts.js test_workflow_result_artifacts.js doc-render.js
git commit -m "Add workflow PDF artifact finalizer"
```

### Task 2: Finalize Every Workflow Before Persistence and Settlement

**Files:**
- Modify: `workflow-execution.js`
- Modify: `server.js`
- Modify: `test_workflow_execution.js`
- Modify: `test_workflow_async_api.js`

**Interfaces:**
- Consumes: `finalizeWorkflowResult(result, options)` from Task 1.
- Produces: all workflow types return `file`, `artifacts`, and optional `artifactWarning`.
- Produces: server result payloads preserve those three fields.

- [ ] **Step 1: Add failing workflow-router tests**

Change `test_workflow_execution.js` so graph, CV, crypto, and doc-gen calls inject:

```js
const finalizedTypes = [];
const finalizeResult = async (result, options) => {
  finalizedTypes.push(options.slug);
  return {
    ...result,
    file: { format: "pdf", mimeType: "application/pdf", url: "https://fundline.test/d/pdf" },
    artifacts: [{ format: "pdf", mimeType: "application/pdf", url: "https://fundline.test/d/pdf" }],
  };
};
```

Pass `workflowSlug`, `tier`, `runId`, and `finalizeResult` to each execution. Assert all four
workflow types call the finalizer, and assert the document workflow no longer owns a special
persistence branch.

Extend `test_workflow_async_api.js` stored result fixture:

```js
const artifact = {
  kind: "file",
  role: "deliverable",
  format: "pdf",
  filename: "client-research.pdf",
  mimeType: "application/pdf",
  url: "https://fundline.test/d/pdf",
};
store.storeResult(JOB_ID, {
  output: "# Durable result",
  steps: [],
  file: artifact,
  artifacts: [artifact],
}, lease);
```

Assert `buildWorkflowJobResponse` returns both fields unchanged.

- [ ] **Step 2: Run workflow tests and verify RED**

```powershell
node test_workflow_execution.js
node test_workflow_async_api.js
```

Expected: `test_workflow_execution.js` fails because only doc-gen persistence is currently
special-cased and no common finalizer exists.

- [ ] **Step 3: Route every executor result through the finalizer**

In `workflow-execution.js`, import `finalizeWorkflowResult`. Refactor branch returns into a local
`result`, then finish with:

```js
  const finalize = options.finalizeResult || finalizeWorkflowResult;
  return finalize(result, {
    slug: options.workflowSlug || "workflow",
    tier: options.tier || "",
    runId: options.runId || "",
    completedAt: options.completedAt || new Date().toISOString(),
    persistDocument: options.persistDocument,
    onArtifactError: options.onArtifactError,
  });
```

Remove the doc-gen-only `result.file.base64` persistence branch.

- [ ] **Step 4: Pass finalization context from both server paths**

In `executeDurableWorkflowJob`, pass:

```js
    workflowSlug: slug,
    tier,
    runId: job.payment.mode === "escrow" ? job.payment.reference : job.jobId,
    onArtifactError: (error) => console.error("[Workflow PDF] async error:", error.message),
```

In the synchronous run handler, pass:

```js
      workflowSlug: slug,
      tier,
      runId: runId || x402TxHash || "",
      onArtifactError: (error) => console.error("[Workflow PDF] error:", error.message),
```

Update both `persistDocument` callbacks to return:

```js
{
  format: file.format || "pdf",
  filename: file.filename,
  mimeType: file.mimeType || "application/pdf",
  url: baseUrl + "/d/" + docId,
}
```

Add these fields to both durable and synchronous result payloads:

```js
    file: result.file || null,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
    artifactWarning: result.artifactWarning || null,
```

- [ ] **Step 5: Run execution, async, worker, and syntax tests**

```powershell
node test_workflow_execution.js
node test_workflow_async_api.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
node --check workflow-execution.js
node --check server.js
```

Expected: all pass, and the existing worker ordering test still proves result storage precedes
settlement.

- [ ] **Step 6: Commit workflow integration**

```powershell
git add workflow-execution.js server.js test_workflow_execution.js test_workflow_async_api.js
git commit -m "Attach PDFs to every workflow result"
```

### Task 3: Align Artifact Retention with Durable Results

**Files:**
- Modify: `doc-store.js`
- Create: `test_doc_store.js`

**Interfaces:**
- Produces: `resolveDocTtlMs(env) -> number`.
- Preserves: `putDoc`, `getDoc`, `sweep`, `DOCS_DIR`, and `TTL_MS`.

- [ ] **Step 1: Write the failing retention tests**

Create `test_doc_store.js`:

```js
"use strict";

const assert = require("assert");
const { resolveDocTtlMs, TTL_MS } = require("./doc-store");

const hour = 60 * 60 * 1000;
assert.equal(resolveDocTtlMs({}), 168 * hour);
assert.equal(resolveDocTtlMs({ WORKFLOW_JOB_RESULT_TTL_HOURS: "240" }), 240 * hour);
assert.equal(resolveDocTtlMs({
  WORKFLOW_JOB_RESULT_TTL_HOURS: "168",
  WORKFLOW_DOC_TTL_HOURS: "48",
}), 168 * hour);
assert.equal(resolveDocTtlMs({
  WORKFLOW_JOB_RESULT_TTL_HOURS: "168",
  WORKFLOW_DOC_TTL_HOURS: "336",
}), 336 * hour);
assert.equal(TTL_MS >= 168 * hour, true);

console.log("PASS: document store retention");
```

- [ ] **Step 2: Run the retention test and verify RED**

```powershell
node test_doc_store.js
```

Expected: FAIL because `resolveDocTtlMs` does not exist and `TTL_MS` is 48 hours.

- [ ] **Step 3: Implement retention resolution**

Replace the fixed TTL with:

```js
function positiveHours(value, fallback) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : fallback;
}

function resolveDocTtlMs(env) {
  const source = env || {};
  const resultHours = positiveHours(source.WORKFLOW_JOB_RESULT_TTL_HOURS, 168);
  const documentHours = positiveHours(source.WORKFLOW_DOC_TTL_HOURS, resultHours);
  return Math.max(resultHours, documentHours) * 60 * 60 * 1000;
}

const TTL_MS = resolveDocTtlMs(process.env);
```

Export `resolveDocTtlMs`.

- [ ] **Step 4: Run retention and syntax tests**

```powershell
node test_doc_store.js
node --check doc-store.js
```

Expected: pass.

- [ ] **Step 5: Commit retention alignment**

```powershell
git add doc-store.js test_doc_store.js
git commit -m "Align workflow artifact retention"
```

### Task 4: Web PDF Download and History Restoration

**Files:**
- Modify: `workflows.js`
- Create: `test_workflow_pdf_ui.js`

**Interfaces:**
- Consumes: result `file.url`, `file.base64`, and `artifacts[]`.
- Produces: `workflowFileAvailable(file) -> boolean`.
- Preserves: `downloadWorkflowFile(file)` and `openResultModal(markdown, slug, cvJson, file)`.

- [ ] **Step 1: Write the failing UI contract test**

Create `test_workflow_pdf_ui.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("workflows.js", "utf8");

assert.match(source, /function workflowFileAvailable\(file\)/);
assert.match(source, /file\.url\s*\|\|\s*file\.base64/);
assert.doesNotMatch(source, /if \(file && file\.base64\)/);
assert.doesNotMatch(source, /if \(data\.file && data\.file\.base64\)/);
assert.match(source, /file:\s*result\.file\s*\|\|\s*null/);
assert.match(source, /artifacts:\s*Array\.isArray\(result\.artifacts\)/);
assert.match(source, /openResultModal\(run\.output,\s*run\.slug,\s*run\.cvJson,\s*run\.file\)/);

console.log("PASS: workflow PDF UI contract");
```

- [ ] **Step 2: Run the UI test and verify RED**

```powershell
node test_workflow_pdf_ui.js
```

Expected: FAIL because URL-backed files are hidden and history does not retain artifact metadata.

- [ ] **Step 3: Make URL and base64 files visible**

Add:

```js
function workflowFileAvailable(file) {
  return !!(file && (file.url || file.base64));
}
```

Use it in both `openResultModal` and the synchronous receipt:

```js
if (workflowFileAvailable(file)) {
```

```js
if (workflowFileAvailable(data.file)) {
```

Keep `downloadWorkflowFile` URL-first so capability URLs open without decoding.

- [ ] **Step 4: Persist file metadata in session history**

Add these fields to successful durable and synchronous `pushRunHistory` entries:

```js
    cvJson: result.cvJson || null,
    file: result.file || null,
    artifacts: Array.isArray(result.artifacts) ? result.artifacts : [],
```

Use `data` instead of `result` in the synchronous block. Change the run-history click handler to:

```js
if (run && run.output) openResultModal(run.output, run.slug, run.cvJson, run.file);
```

Do not store base64 payloads in session history. Before `pushRunHistory`, normalize a file with
`base64` but no URL to `null`; normal production responses are URL-backed.

- [ ] **Step 5: Run UI and browser checks**

```powershell
node test_workflow_pdf_ui.js
node test_workflow_browser_runtime.js
node test_workflow_graph.js
node --check workflows.js
```

Expected: all pass.

- [ ] **Step 6: Commit web PDF support**

```powershell
git add workflows.js test_workflow_pdf_ui.js
git commit -m "Expose workflow PDFs on the web"
```

### Task 5: Finish MCP JSON and PDF Deliverable Contract

**Files:**
- Modify: `workflow-mcp-tools.js`
- Modify: `test_workflow_mcp_tools.js`

**Interfaces:**
- Consumes: the backend `file` and `artifacts[]` contract from Task 2.
- Produces: legacy synchronous request body with `stream: false`.
- Preserves: MCP resource links, MIME types, and delivery instruction text.

- [ ] **Step 1: Confirm the pending MCP regression assertion**

The existing working-tree test must contain:

```js
assert.equal(JSON.parse(calls[0].options.body).stream, false);
```

- [ ] **Step 2: Run the MCP test and verify the implementation pair**

```powershell
node test_workflow_mcp_tools.js
```

Expected before the production edit: FAIL because the legacy request does not explicitly disable
streaming. If the current working tree already contains both pending lines, temporarily confirm
the test fails against `HEAD` with `git show HEAD:test_workflow_mcp_tools.js` inspection instead
of reverting user work.

- [ ] **Step 3: Finish the legacy request body**

Keep the pending production change:

```js
const body = { tier, prompt: input.prompt, stream: false };
```

Do not alter the async quote, enqueue, recovery-token, or artifact-normalization behavior.

- [ ] **Step 4: Run MCP and public contract tests**

```powershell
node test_workflow_mcp_tools.js
node test_agent_mcp_docs.js
node --check workflow-mcp-tools.js
```

Expected: all pass. Completed PDF results contain visible deliverable text and one
`resource_link` for each valid artifact.

- [ ] **Step 5: Commit only the two pending MCP files**

```powershell
git add workflow-mcp-tools.js test_workflow_mcp_tools.js
git commit -m "Force JSON responses for legacy MCP runs"
```

### Task 6: PDF Visual QA and Full Release Gate

**Files:**
- Verify: all files from Tasks 1-5
- Update: `.Codex/memory.md`

**Interfaces:**
- Consumes: the completed implementation.
- Produces: verified PDF bytes, rendered page images, and an implementation record.

- [ ] **Step 1: Generate a representative PDF**

Use `renderWorkflowResultPdf` with a report containing headings, long paragraphs, lists, a table,
and a fenced JSON block. Write the temporary output outside the repository or under an ignored
temporary directory, never into tracked source.

Expected: the file starts with `%PDF-`, has at least one page, and uses the expected filename.

- [ ] **Step 2: Parse and render the PDF**

Use the workspace PDF runtime and Poppler:

```powershell
pdftoppm -png -r 144 <temporary-pdf> <temporary-output-prefix>
```

Use pypdf to assert that extracted text contains the report title, `Findings`, and the structured
appendix.

Expected: parsing succeeds and at least one PNG page is produced.

- [ ] **Step 3: Inspect every rendered page**

Open every PNG page and verify:

```text
No clipped headings or body text.
Long tables paginate without overlap.
Code blocks remain inside page margins.
Page numbers are present.
No secrets or internal filesystem paths appear.
```

If a defect appears, add a regression assertion, fix the renderer, rerun Tasks 1 and 6, and
inspect again.

- [ ] **Step 4: Run the focused offline suite**

```powershell
node test_workflow_result_artifacts.js
node test_workflow_execution.js
node test_workflow_docgen.js
node test_doc_store.js
node test_workflow_async_api.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
node test_workflow_pdf_ui.js
node test_workflow_browser_runtime.js
node test_workflow_mcp_tools.js
node test_agent_mcp_docs.js
node --check doc-render.js
node --check workflow-result-artifacts.js
node --check workflow-execution.js
node --check doc-store.js
node --check workflows.js
node --check workflow-mcp-tools.js
node --check server.js
```

Expected: every command passes.

- [ ] **Step 5: Run the project predeploy gate**

Use the repository `predeploy-check` skill. It must inspect syntax, relevant tests, UI text,
USDC invariants, secrets, the scoped diff, and the nested repository location.

Expected: GO. Resolve every NO-GO item before continuing.

- [ ] **Step 6: Update project memory**

Add one dated entry to `.Codex/memory.md`:

```text
- Every successful workflow now finalizes a backend PDF artifact before result persistence and
  settlement. Existing document PDFs are preserved, web history retains URL-backed artifacts,
  MCP exposes them as deliverable resource links, and document TTL is no shorter than result TTL.
```

- [ ] **Step 7: Review final diff and working tree**

```powershell
git diff --check HEAD~5
git status --short
git log -7 --oneline
```

Expected: no secrets, generated PDFs, rendered PNGs, package changes, or unrelated user files are
staged. Only the scoped implementation commits and the pre-existing untracked user content remain.

- [ ] **Step 8: Run one real workflow acceptance test**

After local/offline checks pass, call one low-cost workflow through MCP, poll it to completion, and
verify:

```text
The result contains application/pdf.
The MCP response includes a resource_link and delivery instruction.
The capability URL returns HTTP 200 with Content-Type application/pdf.
The same result shape makes the web Download PDF action visible.
No second workflow execution or payment occurs.
```

Do not publish, push, or expose any private key without separate authorization.
