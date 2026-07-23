# Workflow PDF Artifacts Design

## Objective

Give every successful Fundline workflow a durable PDF deliverable that is visible and
downloadable from both the web application and MCP. PDF creation must not rerun the workflow,
call another model, or initiate another payment.

## Current Problem

Document workflows can already return a generated PDF. The server persists that PDF and replaces
its base64 payload with a capability URL. The web result modal, however, only shows its PDF button
when `file.base64` exists, so the normal persisted `file.url` result is hidden.

Other workflows return Markdown and optional structured JSON without any file artifact. MCP can
expose file artifacts correctly, but it cannot expose a PDF that the backend never created.

Artifact retention also differs from workflow-result retention. Document capability URLs expire
after 48 hours while durable workflow results are retained for 168 hours by default.

## Chosen Approach

The backend is the canonical PDF producer for every successful workflow.

- Preserve an existing workflow-generated PDF exactly as produced.
- When no PDF exists, deterministically render the completed Markdown result into a PDF.
- Persist the PDF before publishing the final workflow result.
- Return the PDF through the existing `file` compatibility field and the normalized `artifacts`
  array.
- Let the web application and MCP consume the same persisted capability URL.

Browser-only PDF generation is not used because it would make the web and MCP outputs differ,
would not survive a disconnected client, and would duplicate rendering logic.

## Result Finalization

Add one shared finalization step after workflow execution and before the successful result is
stored or returned.

The finalizer receives the workflow slug, tier, report Markdown, optional structured result,
existing file metadata, and run identifier when available. It performs the following:

1. Normalize existing `file` and `artifacts` entries.
2. Detect whether a valid PDF artifact already exists.
3. Preserve the existing PDF without re-rendering it.
4. Otherwise render the report into a new PDF.
5. Persist every base64-backed artifact through the document store.
6. Return a backwards-compatible `file` field pointing to the primary PDF plus an `artifacts`
   array containing every deliverable.

The synchronous browser/API path and the durable asynchronous worker must call the same finalizer.
For durable runs, finalization completes before the result file is persisted and before escrow
release. For synchronous paid runs, finalization completes before settlement and the final
response.

## PDF Rendering

Use the repository's existing Node PDF stack so production does not depend on a browser or an
external conversion service.

The generated PDF contains:

- Fundline workflow title and workflow identifier.
- Tier and completion timestamp.
- The completed Markdown report with headings, paragraphs, lists, tables, code blocks, and page
  breaks rendered into a readable document.
- A structured-result appendix when a workflow has useful JSON but no complete Markdown
  representation.
- Page numbers and a small generation footer.

Rendering is deterministic and does not call an AI provider. User-provided Markdown is treated as
text and formatting input, never as executable HTML.

Generated filenames use a sanitized workflow slug, UTC date, and a short run identifier when one
is available, for example:

```text
client-research-2026-07-23-a1b2c3d4.pdf
```

## Artifact Contract

The existing singular `file` field remains available for current web and API clients:

```json
{
  "format": "pdf",
  "filename": "client-research-2026-07-23-a1b2c3d4.pdf",
  "mimeType": "application/pdf",
  "url": "https://fundline.xyz/d/example"
}
```

Every successful result also exposes the primary PDF in `artifacts`:

```json
[
  {
    "kind": "file",
    "role": "deliverable",
    "format": "pdf",
    "filename": "client-research-2026-07-23-a1b2c3d4.pdf",
    "mimeType": "application/pdf",
    "url": "https://fundline.xyz/d/example"
  }
]
```

If a future workflow returns additional non-PDF files, the finalizer preserves them and adds the
generated PDF instead of replacing them. Artifact deduplication uses the persisted URL first and
the filename plus MIME type as a fallback before persistence.

## Web Behavior

The workflow result modal shows **Download PDF** whenever the primary file has either a valid
`url` or `base64` payload. URL-backed files use the existing capability URL. Base64 remains a
compatibility fallback for responses that have not been persisted.

Workflow history stores the file and artifact metadata with the Markdown output. Reopening a
history entry restores the same download action without rerunning the workflow.

The web application does not create a second client-side PDF and does not make a second paid
workflow request.

## MCP Behavior

The existing artifact normalization remains the MCP presentation layer. Because every successful
backend result now contains a PDF, both synchronous `run_workflow` and asynchronous `get_run`
return:

- Machine-readable artifact metadata.
- An MCP `resource_link` with `application/pdf`.
- Visible text instructing the agent to download the deliverable and provide it to the requesting
  user.

The legacy synchronous MCP request explicitly sends `stream: false` so it always receives the JSON
artifact contract instead of an SSE response. The existing MCP regression test will lock this
request behavior.

## Retention

PDF capability retention must be at least as long as durable workflow-result retention. The
default document TTL changes from 48 hours to 168 hours and follows the configured workflow-result
TTL unless a longer document-specific value is configured.

Cleanup remains opportunistic and never exposes predictable filenames or filesystem locations.
Capability identifiers remain unguessable.

## Failure Handling

PDF generation is a delivery enhancement after the paid model work has succeeded. A renderer or
document-store failure must not discard the completed AI result or trigger a duplicate execution.

On artifact failure:

- Preserve the successful Markdown and structured result.
- Record a sanitized server-side error.
- Return a stable `artifactWarning` that states the PDF could not be generated.
- Do not expose filesystem paths, stack traces, prompts, or provider details.
- Do not claim that a PDF exists when persistence failed.

Existing workflow execution, payment verification, settlement, and refund behavior otherwise
remain unchanged.

## Security and Privacy

- Do not embed API keys, private keys, recovery tokens, internal provider metadata, or server
  paths in the PDF.
- Escape or render user Markdown as text rather than executable HTML.
- Keep capability URLs unguessable and TTL-limited.
- Preserve current authorization rules for durable result polling.
- Do not add a public file-listing endpoint.

## Test Strategy

Add tests before production changes for:

- A Markdown-only workflow receives a valid PDF artifact.
- A workflow-generated PDF is preserved and not rendered twice.
- Existing non-PDF artifacts remain present alongside the generated PDF.
- Structured JSON is included when Markdown is absent or incomplete.
- Generated filenames are sanitized and stable.
- Artifact persistence produces `file.url` and `artifacts[]`.
- A renderer failure preserves the workflow result and returns `artifactWarning`.
- Durable result persistence occurs before escrow release.
- The web modal displays the PDF action for both URL and base64 files.
- Workflow history restores file and artifact metadata.
- MCP synchronous requests send `stream: false`.
- MCP `run_workflow` and `get_run` expose the PDF resource link and delivery instruction.
- Document retention defaults to at least the workflow-result retention period.

Generate one representative PDF fixture, parse it, render its pages to images, and inspect the
result for clipped text, broken pagination, unreadable tables, and missing characters.

## Rollout

1. Add the failing unit and contract tests.
2. Add the shared PDF renderer and result finalizer.
3. Integrate finalization into synchronous and durable workflow success paths.
4. Update the web result modal and workflow history.
5. Finish the pending MCP non-streaming request change and regression test.
6. Run syntax checks, workflow tests, MCP tests, PDF parsing, and visual PDF inspection.
7. Run one real workflow and verify the same PDF is downloadable from web-compatible result data
   and visible as an MCP resource link.

## Acceptance Criteria

- Every successful workflow returns one primary `application/pdf` deliverable.
- Existing workflow-generated PDFs are preserved exactly.
- Markdown-only workflows receive a backend-generated PDF without another model call or payment.
- The web result modal can download URL-backed and base64-backed PDFs.
- Reopened workflow history retains the PDF download metadata.
- MCP clearly identifies the PDF as a deliverable for the requesting user.
- Durable workflow results persist the PDF reference before settlement.
- Artifact lifetime is not shorter than the default durable-result lifetime.
- PDF generation failure never causes a duplicate paid workflow execution.
- Existing payment, settlement, refund, Markdown, and structured-result behavior remains compatible.
