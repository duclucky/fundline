# MCP Deliverable Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every valid workflow-generated file visible to MCP agents as a machine-readable deliverable, a standard MCP resource link, and an explicit user-delivery instruction.

**Architecture:** Add focused artifact-normalization and MCP-presentation helpers to `workflow-mcp-tools.js`. Both synchronous `run_workflow` and asynchronous `get_run` pass their result container through the same helper, which preserves the legacy `file` property, creates a normalized `artifacts` array, appends an action instruction to text content, and emits one `resource_link` block per artifact.

**Tech Stack:** Node.js CommonJS, built-in `URL`, built-in `assert`, MCP tool-result content blocks.

## Global Constraints

- Code, comments, tests, and documentation are in English.
- Use CommonJS, two-space indentation, and double quotes.
- Do not use emoji or long em dashes.
- Preserve the existing `file` field and all artifact-free response behavior.
- Do not embed binary file contents in MCP responses.
- Accept only HTTP or HTTPS artifact capability URLs.
- Use test-first development and observe the regression test fail before changing production code.

---

### Task 1: Present workflow files as deliverable MCP artifacts

**Files:**
- Modify: `test_workflow_mcp_tools.js:6-125`
- Modify: `workflow-mcp-tools.js:13-206`

**Interfaces:**
- Consumes: successful synchronous workflow payloads with `payload.file` or `payload.artifacts`, and successful asynchronous payloads with `payload.result.file` or `payload.result.artifacts`.
- Produces: `structuredContent.artifacts` or `structuredContent.result.artifacts`, plus `content[0]` text containing the delivery instruction and subsequent MCP `resource_link` blocks.
- Preserves: the original singular `file` object and the existing response shape when no valid artifact exists.

- [ ] **Step 1: Write failing synchronous and asynchronous artifact tests**

Add constants after `TX_HASH` in `test_workflow_mcp_tools.js`:

```js
const PDF_URL = "https://fundline.test/d/proposal";
const CSV_URL = "https://fundline.test/d/source-data";
```

Change the completed async response at lines 46-50 to include a legacy singular file:

```js
      response(200, {
        jobId: JOB_ID,
        status: "succeeded",
        result: {
          output: "# Done",
          priceUsdc: "0.010000",
          file: { format: "pdf", filename: "proposal.pdf", url: PDF_URL },
        },
      }),
```

After the existing `done.structuredContent.result.output` assertion, add assertions that prove the async MCP result identifies and instructs delivery of the PDF:

```js
  assert.equal(done.structuredContent.result.file.url, PDF_URL);
  assert.equal(done.structuredContent.result.artifacts.length, 1);
  assert.deepEqual(done.structuredContent.result.artifacts[0], {
    kind: "file",
    role: "deliverable",
    filename: "proposal.pdf",
    format: "pdf",
    mimeType: "application/pdf",
    url: PDF_URL,
    deliveryInstruction: "Download this file and provide it to the requesting user.",
  });
  assert.equal(done.content[0].text.includes("Deliverable files:"), true);
  assert.equal(done.content[0].text.includes("Action required: Download each file and provide it to the requesting user."), true);
  const asyncPdfLink = done.content.find((item) => item.type === "resource_link");
  assert.deepEqual(asyncPdfLink, {
    type: "resource_link",
    uri: PDF_URL,
    name: "proposal.pdf",
    title: "Generated deliverable: proposal.pdf",
    description: "Generated file deliverable. Download it and provide it to the requesting user.",
    mimeType: "application/pdf",
    annotations: { audience: ["assistant", "user"], priority: 1 },
  });
```

Replace the existing legacy synchronous fake response at line 112 with one legacy `file`, one duplicate artifact, one valid CSV artifact, and one malformed artifact:

```js
      response(200, {
        output: "legacy",
        priceUsdc: "0.01",
        releaseTx: TX_HASH,
        file: { format: "pdf", filename: "proposal.pdf", url: PDF_URL },
        artifacts: [
          { format: "pdf", filename: "duplicate.pdf", url: PDF_URL },
          { filename: "sources.csv", url: CSV_URL },
          { filename: "invalid.txt", url: "file:///tmp/invalid.txt" },
        ],
      }),
```

After the existing `legacy.structuredContent.output` assertion, add:

```js
  assert.equal(legacy.structuredContent.file.url, PDF_URL);
  assert.equal(legacy.structuredContent.artifacts.length, 2);
  assert.equal(legacy.structuredContent.artifacts[0].mimeType, "application/pdf");
  assert.equal(legacy.structuredContent.artifacts[1].filename, "sources.csv");
  assert.equal(legacy.structuredContent.artifacts[1].mimeType, "text/csv");
  assert.equal(legacy.structuredContent.artifacts[1].role, "deliverable");
  assert.equal(legacy.content.filter((item) => item.type === "resource_link").length, 2);
  assert.equal(legacy.content[0].text.includes(PDF_URL), true);
  assert.equal(legacy.content[0].text.includes(CSV_URL), true);
```

Finally add an artifact-free synchronous response and call before the final `console.log`:

```js
  calls = [];
  handler = createWorkflowMcpCallHandler({
    selfBase: "https://fundline.test",
    forwardHeaders: () => ({ "Content-Type": "application/json" }),
    fetchImpl: fakeFetch([
      response(200, { output: "text only", priceUsdc: "0.01" }),
    ], calls),
    asyncEnabled: false,
  });
  const textOnly = await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
  });
  assert.deepEqual(textOnly.content, [{ type: "text", text: "text only" }]);
  assert.equal(textOnly.structuredContent.artifacts, undefined);
```

- [ ] **Step 2: Run the MCP tool test and verify the regression fails**

Run:

```powershell
node test_workflow_mcp_tools.js
```

Expected: FAIL at the first `done.structuredContent.result.artifacts.length` assertion because the MCP adapter does not yet normalize or expose artifacts.

- [ ] **Step 3: Implement artifact normalization and content generation**

Add the MIME map and helper functions after `displayError` in `workflow-mcp-tools.js`:

```js
const ARTIFACT_MIME_TYPES = {
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json",
  md: "text/markdown",
  pdf: "application/pdf",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  zip: "application/zip",
};

const ARTIFACT_DELIVERY_INSTRUCTION = "Download this file and provide it to the requesting user.";

function artifactFormat(candidate, filename) {
  const supplied = String(candidate.format || "").trim().toLowerCase();
  if (supplied) return supplied;
  const match = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

function normalizeArtifact(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const url = String(candidate.url || candidate.uri || "").trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  } catch (_) {
    return null;
  }
  const filename = String(candidate.filename || candidate.name || "workflow-deliverable").trim()
    || "workflow-deliverable";
  const format = artifactFormat(candidate, filename);
  const artifact = {
    kind: "file",
    role: "deliverable",
    filename,
    mimeType: String(candidate.mimeType || ARTIFACT_MIME_TYPES[format] || "application/octet-stream"),
    url,
    deliveryInstruction: ARTIFACT_DELIVERY_INSTRUCTION,
  };
  if (format) artifact.format = format;
  return artifact;
}

function collectArtifacts(result) {
  if (!result || typeof result !== "object") return [];
  const candidates = [];
  if (result.file) candidates.push(result.file);
  if (Array.isArray(result.artifacts)) candidates.push(...result.artifacts);
  const seen = new Set();
  return candidates.reduce((artifacts, candidate) => {
    const artifact = normalizeArtifact(candidate);
    if (!artifact || seen.has(artifact.url)) return artifacts;
    seen.add(artifact.url);
    artifacts.push(artifact);
    return artifacts;
  }, []);
}

function artifactResourceLink(artifact) {
  return {
    type: "resource_link",
    uri: artifact.url,
    name: artifact.filename,
    title: "Generated deliverable: " + artifact.filename,
    description: "Generated file deliverable. " + ARTIFACT_DELIVERY_INSTRUCTION,
    mimeType: artifact.mimeType,
    annotations: { audience: ["assistant", "user"], priority: 1 },
  };
}
```

Replace `successResult` with a version that accepts content blocks:

```js
function successResult(payload, text, extraContent) {
  return {
    content: [{ type: "text", text }, ...(extraContent || [])],
    structuredContent: payload,
  };
}

function workflowSuccessResult(payload, text, result) {
  const artifacts = collectArtifacts(result);
  if (!artifacts.length) return successResult(payload, text);
  result.artifacts = artifacts;
  const rows = artifacts.map((artifact) => (
    "- " + artifact.filename + " (" + artifact.mimeType + "): " + artifact.url
  )).join("\n");
  const message = text
    + "\n\nDeliverable files:\n"
    + rows
    + "\nAction required: Download each file and provide it to the requesting user.";
  return successResult(payload, message, artifacts.map(artifactResourceLink));
}
```

Change the successful synchronous return at lines 189-190 to pass the top-level payload as the artifact source:

```js
        const output = payload.result ? payload.result.output : payload.output;
        const result = payload.result || payload;
        return workflowSuccessResult(
          payload,
          output ? String(output) : "Workflow status: " + String(payload.status || "complete"),
          result
        );
```

Change the successful asynchronous return at lines 203-206 to pass `payload.result` as the artifact source when present:

```js
        const text = payload.result && payload.result.output
          ? String(payload.result.output)
          : "Workflow status: " + String(payload.status || "unknown") + ".";
        return workflowSuccessResult(payload, text, payload.result);
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
node test_workflow_mcp_tools.js
```

Expected: `PASS: workflow MCP tools`.

- [ ] **Step 5: Run syntax and adjacent async regression checks**

Run:

```powershell
node --check workflow-mcp-tools.js
node --check server.js
node test_workflow_async_api.js
node test_workflow_execution.js
```

Expected: both syntax checks exit with code 0 and both test scripts print their PASS messages without errors.

- [ ] **Step 6: Review the final diff and commit the implementation**

Run:

```powershell
git diff --check
git diff -- workflow-mcp-tools.js test_workflow_mcp_tools.js
git status --short
```

Confirm that only the two intended implementation files changed, the design and plan commits remain separate, no secrets are present, and unrelated untracked files are untouched. Then run:

```powershell
git add -- workflow-mcp-tools.js test_workflow_mcp_tools.js
git commit -m "Expose workflow files as MCP artifacts"
```
