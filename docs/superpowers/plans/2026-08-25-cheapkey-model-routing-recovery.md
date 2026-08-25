# CheapKeyAI Model Routing Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route workflow final steps through CheapKeyAI aliases supported by the production key group and restore the run action after terminal refunds or failures.

**Architecture:** Keep model IDs and costs centralized in `cheapkey-models.js`, with server defaults and `.env.example` using the same aliases. Add a pure terminal button-state mapper to the existing browser runtime so the page can apply and unit-test recovery behavior without a DOM dependency.

**Tech Stack:** CommonJS Node.js, vanilla browser JavaScript, standalone `node test_*.js` tests.

## Global Constraints

- Do not run a paid CheapKeyAI completion during implementation.
- Do not change escrow settlement, refund, or fixed 6-decimal USDC pricing behavior.
- Do not automatically create, fund, or rerun a workflow after failure.
- Code, comments, tests, and UI copy remain English with no em dash or emoji.
- Preserve unrelated untracked user files.

---

### Task 1: Route final models through group-compatible aliases

**Files:**
- Modify: `test_cheapkey_cost.js`
- Modify: `test_cheapkey_cutover.js`
- Modify: `test_workflow_model_provider.js`
- Modify: `cheapkey-models.js`
- Modify: `server.js`
- Modify: `.env.example`
- Modify: `.agents/skills/cheapkeyai-api/SKILL.md`

**Interfaces:**
- Consumes: `cheapkeyModels.getPrice(modelId)` and `workflowModelProvider.finalModelForTier(tier)`.
- Produces: final model defaults `normal=cheap-5.6-sol`, `plus=cheap-5.6-terra`, `pro=cheap-5.6-sol`.

- [ ] **Step 1: Write the failing routing and registry assertions**

Add assertions that `cheap-5.6-sol` and `cheap-5.6-terra` have registered prices. Change provider fixtures and cutover source checks to expect the new aliases and reject default `gpt-5.6-*` values.

```js
assert(cheapkeyModels.getPrice("cheap-5.6-sol"));
assert(cheapkeyModels.getPrice("cheap-5.6-terra"));
assert.equal(provider.finalModelForTier("normal"), "cheap-5.6-sol");
assert.equal(provider.finalModelForTier("plus"), "cheap-5.6-terra");
assert.equal(provider.finalModelForTier("pro"), "cheap-5.6-sol");
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```powershell
node test_cheapkey_cost.js
node test_cheapkey_cutover.js
node test_workflow_model_provider.js
```

Expected: at least the new alias assertions fail because production defaults and registry entries are missing.

- [ ] **Step 3: Implement the alias registry and defaults**

Add conservative price records to `cheapkey-models.js`:

```js
"cheap-5.6-sol": { inputPer1M: 5.00, outputPer1M: 30.00 },
"cheap-5.6-terra": { inputPer1M: 2.00, outputPer1M: 12.00 },
```

Set server and `.env.example` defaults:

```js
normal: String(process.env.WORKFLOW_FINAL_MODEL_NORMAL || "cheap-5.6-sol").trim(),
plus: String(process.env.WORKFLOW_FINAL_MODEL_PLUS || "cheap-5.6-terra").trim(),
pro: String(process.env.WORKFLOW_FINAL_MODEL_PRO || "cheap-5.6-sol").trim(),
```

Update the CheapKeyAI skill model list to describe these aliases as Fundline's default final routes.

- [ ] **Step 4: Run routing tests and verify GREEN**

Run the three tests from Step 2 plus:

```powershell
node test_preflight.js
node --check server.js
```

Expected: every command exits zero.

- [ ] **Step 5: Commit model routing**

```powershell
git add -- test_cheapkey_cost.js test_cheapkey_cutover.js test_workflow_model_provider.js cheapkey-models.js server.js .env.example .agents/skills/cheapkeyai-api/SKILL.md
git commit -m "fix: route workflows through supported CheapKeyAI models"
```

### Task 2: Restore the action after terminal failure

**Files:**
- Modify: `test_workflow_browser_runtime.js`
- Modify: `workflow-browser-runtime.js`
- Modify: `workflows.js`

**Interfaces:**
- Produces: `terminalRunButtonState(status) -> { disabled: false, text: string } | null`.
- Consumes: the helper through `window.FundlineWorkflowRuntime` in `pollDurableWorkflow`.

- [ ] **Step 1: Write the failing terminal-state assertions**

```js
assert.deepEqual(runtime.terminalRunButtonState("succeeded"), { disabled: false, text: "Run again" });
assert.deepEqual(runtime.terminalRunButtonState("refunded"), { disabled: false, text: "Try again" });
assert.deepEqual(runtime.terminalRunButtonState("failed"), { disabled: false, text: "Try again" });
assert.equal(runtime.terminalRunButtonState("refunding"), null);
```

- [ ] **Step 2: Run the browser runtime test and verify RED**

Run:

```powershell
node test_workflow_browser_runtime.js
```

Expected: FAIL because `terminalRunButtonState` does not exist.

- [ ] **Step 3: Implement and consume the pure mapper**

Add to `workflow-browser-runtime.js`:

```js
function terminalRunButtonState(status) {
  if (status === "succeeded") return { disabled: false, text: "Run again" };
  if (status === "refunded" || status === "failed") {
    return { disabled: false, text: "Try again" };
  }
  return null;
}
```

Export it and add a small `applyTerminalRunButtonState(status)` helper in `workflows.js` that applies the returned state to `#wfRunBtn`. Call it before returning from the succeeded, refunded, and failed branches.

- [ ] **Step 4: Run UI and durable-job tests and verify GREEN**

```powershell
node test_workflow_browser_runtime.js
node test_workflow_async_api.js
node test_workflow_job_worker.js
node test_workflow_job_settlement.js
node test_workflow_pdf_ui.js
node --check workflows.js
```

Expected: every command exits zero.

- [ ] **Step 5: Commit terminal UI recovery**

```powershell
git add -- test_workflow_browser_runtime.js workflow-browser-runtime.js workflows.js
git commit -m "fix: restore workflow action after refund"
```

### Task 3: Verify and release

**Files:**
- Review only: all files changed in Tasks 1 and 2.

**Interfaces:**
- Consumes: committed routing and terminal UI behavior.
- Produces: a predeploy GO verdict and a deployed `main` commit.

- [ ] **Step 1: Run focused verification**

Run syntax checks for `app.js`, `server.js`, `workflows.js`, `cheapkey-client.js`, and `workflow-browser-runtime.js`, then all tests named in Tasks 1 and 2 plus workflow engine, execution, research, and limiter tests.

- [ ] **Step 2: Run the Fundline predeploy gate**

Confirm no secret, em dash, emoji UI, 18-decimal USDC payment assumption, or custodial withdrawal path was added. Expected verdict: GO.

- [ ] **Step 3: Push, merge, and monitor deployment**

Push `codex/mcp-durable-runs`, fast-forward it to `main`, then watch the `Deploy Fundline to cPanel` GitHub Actions run until it succeeds.

- [ ] **Step 4: Verify production configuration**

Fetch `https://fundline.xyz/api/config` and confirm `workflowFinalModels` contains the group-compatible aliases. Fetch Client Research preflight for each tier and confirm every response returns `ok: true`.
