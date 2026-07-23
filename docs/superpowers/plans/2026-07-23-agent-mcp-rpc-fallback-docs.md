# Agent MCP and RPC Fallback Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish complete durable MCP integration guidance and safe Arc RPC fallback rules on both `/docs` and `/llms.txt`.

**Architecture:** Keep the existing public documentation surfaces and add one standalone regression test that reads their source. `docs.html` remains the human-facing guide, while `handleLlmsTxt` in `server.js` emits the compact machine-readable equivalent. No runtime MCP, payment, persistence, or contract behavior changes.

**Tech Stack:** Static HTML, plain Node.js CommonJS, built-in `assert` and `fs`, existing cPanel FTP deployment.

## Global Constraints

- Code, comments, UI copy, and public documentation are in English.
- Do not use long em dashes, emojis, icons attached to text, or secrets.
- Arc Testnet chain ID is `5042002` (`0x4cef52`).
- Canonical Arc USDC is `0x3600000000000000000000000000000000000000` and uses 6 decimals for ERC-20 operations.
- Native Arc gas accounting uses 18 decimals and must not be mixed with ERC-20 USDC amounts.
- Durable escrow is the primary MCP path; x402 remains a compatibility option.
- Do not publish internal verification logic, job-store paths, lock design, server environment variables, or operational keys.
- Do not add a server-side RPC failover implementation in this change.
- Preserve all unrelated user changes and untracked files.

---

## File Structure

- Create `test_agent_mcp_docs.js`: source-level regression test for public MCP and RPC guidance.
- Modify `docs.html`: human-facing MCP lifecycle, x402 compatibility, RPC rotation, and network reference.
- Modify `server.js`: machine-readable `/llms.txt` guidance only, inside `handleLlmsTxt`.
- Do not modify `workflow-mcp-tools.js`, job worker/store modules, contracts, or payment verification.

### Task 1: Publish Durable MCP and RPC Fallback Guidance

**Files:**
- Create: `test_agent_mcp_docs.js`
- Modify: `docs.html:738`
- Modify: `docs.html:850`
- Modify: `server.js:1199`

**Interfaces:**
- Consumes: Existing MCP tools `list_workflows`, `run_workflow`, `get_run`, and `list_runs`.
- Consumes: Existing `handleLlmsTxt(req, res)` string-array response in `server.js`.
- Produces: Public human instructions at `/docs` and matching machine instructions at `/llms.txt`.
- Produces: `node test_agent_mcp_docs.js`, which exits nonzero if either surface loses required safety guidance.

- [ ] **Step 1: Write the failing documentation regression test**

Create `test_agent_mcp_docs.js` with this complete content:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const docs = fs.readFileSync(path.join(__dirname, "docs.html"), "utf8");
const server = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
const surfaces = [
  ["docs.html", docs],
  ["server.js /llms.txt", server],
];

const rpcEndpoints = [
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
  "https://rpc.testnet.arc.network",
];

for (const [name, text] of surfaces) {
  for (const tool of ["list_workflows", "run_workflow", "get_run", "list_runs"]) {
    assert(text.includes(tool), name + " must name MCP tool " + tool);
  }
  for (const endpoint of rpcEndpoints) {
    assert(text.includes(endpoint), name + " must include RPC endpoint " + endpoint);
  }
  for (const token of [
    "awaiting_payment",
    "recoveryToken",
    "retryAfterSeconds",
    "5042002",
    "0x4cef52",
    "0x3600000000000000000000000000000000000000",
    "HTTP 429",
    "HTTP 5xx",
    "-32011",
    "eth_getTransactionByHash",
    "eth_getTransactionReceipt",
  ]) {
    assert(text.includes(token), name + " must include " + token);
  }
}

assert(docs.includes("paymentMode"), "docs.html must show the escrow payment mode");
assert(docs.includes("payment.jobId"), "docs.html must show durable enqueue credentials");
assert(docs.includes("payment.runId"), "docs.html must show the funded run ID");
assert(docs.includes("payment.recoveryToken"), "docs.html must show the recovery credential");
assert(docs.includes("six decimals"), "docs.html must state the USDC decimal rule");
assert(server.includes("six decimals"), "/llms.txt must state the USDC decimal rule");
assert(docs.includes("Legacy direct x402"), "docs.html must label legacy x402 as compatibility behavior");
assert(server.includes("Legacy direct x402"), "/llms.txt must label legacy x402 as compatibility behavior");
assert(docs.includes("same signed raw transaction"), "docs.html must prevent duplicate payment signing");
assert(server.includes("same signed raw transaction"), "/llms.txt must prevent duplicate payment signing");
assert(!docs.includes("data/workflow-jobs"), "public docs must not expose the internal job path");

console.log("PASS: agent MCP and RPC fallback docs");
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node test_agent_mcp_docs.js
```

Expected: FAIL on the first missing fallback RPC, durable field, or transaction-recovery token.

- [ ] **Step 3: Expand the human-facing Remote MCP section**

In `docs.html`, keep the current MCP client configuration and replace the short durable subsection
with the following structure and copy. Preserve the existing code-card markup pattern and copy
buttons.

```html
<h4>Durable asynchronous run</h4>
<p>
  Treat quote, payment, enqueue, and polling as one logical run. Save the
  <code>jobId</code>, <code>runId</code>, and <code>recoveryToken</code> before sending
  USDC. The recovery token authorizes result access, so do not log, commit, or share it.
</p>
<ol>
  <li>Call <code>list_workflows</code> and select a valid slug and tier.</li>
  <li>Call <code>run_workflow</code> without payment and set <code>paymentMode</code> to <code>escrow</code>.</li>
  <li>Verify chain ID <code>5042002</code>, canonical USDC, escrow address, and the exact quoted amount.</li>
  <li>Approve only that amount and call <code>fund(runId, amount)</code> from the payer wallet.</li>
  <li>Call <code>run_workflow</code> with <code>payment.jobId</code>, <code>payment.runId</code>, and <code>payment.recoveryToken</code>.</li>
  <li>Poll <code>get_run</code>, honoring <code>retryAfterSeconds</code>, until <code>succeeded</code>, <code>refunded</code>, or <code>failed</code>.</li>
</ol>
```

Add a copyable JSON-RPC card immediately after the list. Use placeholder values only:

```html
<div class="code-card">
  <div class="code-head"><span>Durable MCP sequence</span><button data-copy="#mcp-durable-sequence" type="button">Copy</button></div>
  <pre id="mcp-durable-sequence"><code># 1. Quote. POST each JSON-RPC request to https://fundline.xyz/mcp
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"run_workflow","arguments":{"slug":"proposal-doc","tier":"normal","prompt":"Create a concise proposal","paymentMode":"escrow"}}}
# -> { "status":"awaiting_payment", "jobId":"0x...", "runId":"0x...",
#      "recoveryToken":"keep-private", "amount":"10000", "chainId":5042002, ... }

# 2. After approve + fund(runId, amount), enqueue the same job.
{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"run_workflow","arguments":{"slug":"proposal-doc","tier":"normal","prompt":"Create a concise proposal","payment":{"jobId":"0x...","runId":"0x...","recoveryToken":"keep-private"}}}}
# -> { "status":"queued", "jobId":"0x...", "retryAfterSeconds":1 }

# 3. Poll without paying again.
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_run","arguments":{"jobId":"0x...","recoveryToken":"keep-private"}}}
# -> processing | settling | succeeded | refunding | refunded | failed</code></pre>
</div>
```

Follow the card with recovery and compatibility copy:

```html
<p>
  If the MCP connection times out, call <code>get_run</code> again with the same credentials.
  Do not create or fund another job. Successful results remain retrievable for seven days by
  default.
</p>
<p>
  <strong>Legacy direct x402:</strong> older clients may obtain an HTTP 402 challenge from the
  workflow <code>/run</code> endpoint, pay it, then call MCP <code>run_workflow</code> with only
  <code>payment.payerWallet</code> and <code>payment.txHash</code>. New MCP clients that need x402
  should request <code>paymentMode: "x402"</code> so they receive durable job credentials before paying.
  Escrow remains recommended because refunds are contract-backed.
</p>
```

- [ ] **Step 4: Add the RPC fallback policy and safe example to `docs.html`**

After the Remote MCP recovery copy, add:

```html
<h4>RPC fallback for agent wallets</h4>
<p>
  Verify every RPC returns Arc Testnet chain ID <code>5042002</code> (<code>0x4cef52</code>)
  before signing. Use canonical USDC at
  <code>0x3600000000000000000000000000000000000000</code> with six decimals.
  Try RPCs in this order:
</p>
<ol>
  <li><code>https://rpc.drpc.testnet.arc.network</code></li>
  <li><code>https://rpc.blockdaemon.testnet.arc.network</code></li>
  <li><code>https://rpc.quicknode.testnet.arc.network</code></li>
  <li><code>https://rpc.testnet.arc.network</code></li>
</ol>
<p>
  Rotate only after a connection timeout, HTTP 429, HTTP 5xx, or JSON-RPC
  <code>-32011</code>. Do not rotate and blindly retry a contract revert, insufficient funds,
  invalid input, bad signature, or wrong chain response.
</p>
<div class="code-card">
  <div class="code-head"><span>Read-only RPC rotation</span><button data-copy="#mcp-rpc-fallback" type="button">Copy</button></div>
  <pre id="mcp-rpc-fallback"><code>const ARC_RPCS = [
  "https://rpc.drpc.testnet.arc.network",
  "https://rpc.blockdaemon.testnet.arc.network",
  "https://rpc.quicknode.testnet.arc.network",
  "https://rpc.testnet.arc.network",
];

async function arcRpc(method, params = []) {
  let lastError;
  for (const url of ARC_RPCS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (response.status === 429 || response.status >= 500) continue;
      const body = await response.json();
      if (body.error?.code === -32011) continue;
      if (body.error) throw new Error(body.error.message);
      return body.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("All Arc RPC endpoints are unavailable");
}</code></pre>
</div>
<p>
  For <code>eth_sendRawTransaction</code>, sign once and retain the transaction hash. After an
  ambiguous timeout, query <code>eth_getTransactionByHash</code> and
  <code>eth_getTransactionReceipt</code> through another RPC before rebroadcasting the same signed
  raw transaction. Never create a second payment with a new nonce just because one RPC lost its response.
</p>
```

In the `Network` table, replace the single RPC row with an `RPC order` row containing the same four
endpoints in the same order. Leave the explorer and USDC rows unchanged.

- [ ] **Step 5: Mirror the operational guidance in `/llms.txt`**

In the `lines` array inside `handleLlmsTxt` in `server.js`, replace the current generic RPC warning
and expand the durable MCP section with these exact lines:

```js
    "## Durable MCP run flow (recommended)",
    "1. Call list_workflows and choose a valid slug and tier.",
    "2. Call run_workflow without payment and set paymentMode to escrow. Save jobId, runId,",
    "   and recoveryToken BEFORE sending USDC. The token authorizes result access; keep it private.",
    "3. Verify chainId 5042002, canonical USDC 0x3600000000000000000000000000000000000000,",
    "   the escrow address, and the exact six-decimal amount. Approve only that amount, then fund runId.",
    "4. Call run_workflow with payment.jobId, payment.runId, and payment.recoveryToken.",
    "5. Poll get_run with the same credentials. Honor retryAfterSeconds until succeeded, refunded, or failed.",
    "6. On timeout or disconnect, resume get_run. Never create and pay for a replacement job.",
    "Successful results remain retrievable for seven days by default.",
    "",
    "## Arc RPC fallback for agent wallets",
    "Verify every RPC returns chainId 5042002 (0x4cef52) before signing. Try in order:",
    "1. https://rpc.drpc.testnet.arc.network",
    "2. https://rpc.blockdaemon.testnet.arc.network",
    "3. https://rpc.quicknode.testnet.arc.network",
    "4. https://rpc.testnet.arc.network",
    "Rotate only for connection timeout, HTTP 429, HTTP 5xx, or JSON-RPC -32011.",
    "Do not rotate and blindly retry contract reverts, insufficient funds, invalid input, bad",
    "signatures, or wrong-chain responses. USDC contract amounts use six decimals; native gas uses 18.",
    "For eth_sendRawTransaction, sign once and retain its hash. After an ambiguous response, query",
    "eth_getTransactionByHash and eth_getTransactionReceipt on another RPC before rebroadcasting",
    "the same signed raw transaction. Never create a second payment with a new nonce.",
```

Replace the old direct-x402 compatibility sentence with:

```js
    "Legacy direct x402: obtain an HTTP 402 challenge from the workflow /run endpoint, pay it,",
    "then call MCP run_workflow with payment.payerWallet and payment.txHash. New MCP x402 clients",
    "should request paymentMode x402 first so they receive durable job credentials before paying.",
    "Escrow remains recommended because its refund behavior is contract-backed.",
```

- [ ] **Step 6: Run the focused tests and verify GREEN**

Run:

```bash
node test_agent_mcp_docs.js
node test_workflow_mcp_tools.js
node test_static_private_paths.js
node --check server.js
node --check docs.js
git diff --check
```

Expected:

```text
PASS: agent MCP and RPC fallback docs
PASS: workflow MCP tools
PASS: private static paths
```

All syntax checks and `git diff --check` must exit 0.

- [ ] **Step 7: Inspect the rendered docs**

Start the local server with its existing command:

```bash
npm start
```

Open `http://127.0.0.1:5190/docs` and verify:

- The MCP sequence fits within its code card without overlapping adjacent content.
- Copy buttons target `#mcp-durable-sequence` and `#mcp-rpc-fallback`.
- RPC endpoints wrap or scroll on narrow screens without widening the page.
- The sidebar and on-page navigation still select the Agent API and Network sections.
- No private key, recovery credential, internal path, or server environment variable appears.

Stop the local server after inspection.

- [ ] **Step 8: Commit the documentation implementation**

```bash
git add test_agent_mcp_docs.js docs.html server.js
git commit -m "Document durable MCP RPC fallback"
```

Expected: one focused commit containing only the test and two public documentation surfaces.

### Task 2: Predeploy, Publish, and Verify Production

**Files:**
- Verify only: `test_agent_mcp_docs.js`
- Verify only: `docs.html`
- Verify only: `server.js`
- Verify only: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: Task 1 commit and the existing push-to-`main` cPanel deployment workflow.
- Produces: Updated production `/docs` and `/llms.txt` with no MCP runtime behavior change.

- [ ] **Step 1: Run the Fundline predeploy gate**

Invoke the repository `predeploy-check` procedure. At minimum, run:

```bash
node --check app.js
node --check server.js
node test_agent_mcp_docs.js
node test_workflow_mcp_tools.js
node test_workflow_async_api.js
node test_workflow_job_store.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
git diff --check
```

Expected: every command exits 0 and the predeploy verdict is `GO`.

- [ ] **Step 2: Review the outgoing commit range**

```bash
git fetch origin main
git log --oneline origin/main..HEAD
git diff --stat origin/main..HEAD
git diff --name-only origin/main..HEAD
```

Expected: the range contains the approved design, implementation plan if committed, regression
test, `docs.html`, and the `/llms.txt` copy in `server.js`. It must not contain `.env`, `data/`,
private keys, or unrelated untracked files.

- [ ] **Step 3: Push to production**

```bash
git push origin HEAD:main
```

Expected: the push fast-forwards `main` and triggers `Deploy Fundline to cPanel`.

- [ ] **Step 4: Monitor deployment**

Locate and watch the newest deployment run for `main`:

```powershell
$deployRunId = gh run list --workflow deploy.yml --branch main --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $deployRunId --exit-status
```

Expected: checkout, dependency install, syntax check, Passenger restart file, and FTP deploy all pass.

- [ ] **Step 5: Verify production documentation and MCP activation**

Fetch the public surfaces and assert the deployed markers:

```powershell
@'
const assert = require("assert");
(async () => {
  const docs = await fetch("https://fundline.xyz/docs").then((r) => r.text());
  const llms = await fetch("https://fundline.xyz/llms.txt").then((r) => r.text());
  for (const text of [docs, llms]) {
    assert(text.includes("https://rpc.drpc.testnet.arc.network"));
    assert(text.includes("https://rpc.blockdaemon.testnet.arc.network"));
    assert(text.includes("https://rpc.quicknode.testnet.arc.network"));
    assert(text.includes("-32011"));
    assert(text.includes("eth_getTransactionByHash"));
  }
  console.log("PASS: production MCP docs");
})().catch((error) => { console.error(error); process.exit(1); });
'@ | node -
```

Then make one unpaid MCP `run_workflow` quote and verify it returns `awaiting_payment`, `jobId`,
`runId`, and `recoveryToken`. Redact the token from all output. Do not fund the probe job.

Expected: documentation assertions pass and durable MCP remains enabled after Passenger restart.

- [ ] **Step 6: Record the outcome**

Report the implementation commit, deployment workflow URL, production verification result, and the
fact that the activation probe did not send a payment transaction. If deployment or live verification
fails, stop and diagnose before claiming the docs are published.
