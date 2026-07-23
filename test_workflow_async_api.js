"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createWorkflowJobStore } = require("./workflow-job-store");

process.env.FUNDLINE_NO_LISTEN = "1";
const serverModule = require("./server.js");

const PAYER = "0x" + "11".repeat(20);
const JOB_ID = "0x" + "22".repeat(32);

async function main() {
  const serverSource = fs.readFileSync("server.js", "utf8");
  assert.match(serverSource, /ARC_RPC_FALLBACK_URLS/);
  assert.match(serverSource, /rpcFallbackUrls:/);
  assert.match(serverSource, /workflowAsyncEnabled:\s*WORKFLOW_MCP_ASYNC_ENABLED/);
  assert.equal(typeof serverModule.buildWorkflowJobResponse, "function");
  assert.equal(typeof serverModule.workflowJobAuthorized, "function");
  assert.equal(typeof serverModule.queueAsyncWorkflowRun, "function");
  assert.equal(typeof serverModule.hydrateWorkflowResumeInput, "function");
  assert.equal(typeof serverModule.workflowJobRequestInput, "function");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fundline-async-api-"));
  const store = createWorkflowJobStore({ baseDir: root });
  const quote = store.createQuote({
    jobId: JOB_ID,
    ownerRateKey: "key:test",
    request: {
      slug: "client-research",
      tier: "normal",
      input: { prompt: "Acme" },
    },
    payment: { mode: "escrow", reference: JOB_ID, amount: "10000" },
  });
  let reservations = 0;
  const queueOptions = {
    store,
    jobId: JOB_ID,
    ownerRateKey: "key:test",
    recoveryToken: quote.recoveryToken,
    limiterKey: "key:test",
    payment: {
      mode: "escrow",
      reference: JOB_ID,
      payer: PAYER,
      amount: "10000",
    },
    request: {
      slug: "client-research",
      tier: "normal",
      input: { prompt: "Acme" },
    },
    reserve: () => {
      reservations += 1;
      return { ok: true, remaining: 9, resetsAt: "2026-07-24T00:00:00.000Z" };
    },
  };

  const queued = await serverModule.queueAsyncWorkflowRun(queueOptions);
  assert.equal(queued.statusCode, 202);
  assert.equal(queued.body.status, "queued");
  assert.equal(queued.body.jobId, JOB_ID);
  assert.equal(queued.duplicate, false);

  const retry = await serverModule.queueAsyncWorkflowRun(queueOptions);
  assert.equal(retry.body.jobId, queued.body.jobId);
  assert.equal(retry.duplicate, true);
  assert.equal(reservations, 1);

  const nonTerminal = serverModule.buildWorkflowJobResponse(store, store.getJob(JOB_ID));
  assert.equal(nonTerminal.statusCode, 202);
  assert.equal(nonTerminal.body.retryAfterSeconds > 0, true);
  assert.equal(Object.hasOwn(nonTerminal.body, "owner"), false);
  assert.equal(Object.hasOwn(nonTerminal.body.request, "input"), false);

  const claimed = store.claimNext({ workerId: "test-worker", leaseMs: 60000 });
  assert.equal(claimed.jobId, JOB_ID);
  const lease = {
    workerId: claimed.execution.workerId,
    leaseToken: claimed.execution.leaseToken,
  };
  store.storeResult(JOB_ID, { output: "# Durable result", steps: [] }, lease);
  store.transition(JOB_ID, ["processing"], "settlement_pending", {}, lease);
  const pendingResult = serverModule.buildWorkflowJobResponse(store, store.getJob(JOB_ID));
  assert.equal(pendingResult.statusCode, 202);
  assert.equal(pendingResult.body.status, "settlement_pending");
  assert.equal(pendingResult.body.resultReady, true);
  assert.equal(pendingResult.body.result.output, "# Durable result");
  assert.equal(Object.hasOwn(pendingResult.body, "owner"), false);
  assert.equal(Object.hasOwn(pendingResult.body.request, "input"), false);
  store.transition(JOB_ID, ["settlement_pending"], "succeeded", {
    completedAt: new Date().toISOString(),
  }, lease);
  const terminal = serverModule.buildWorkflowJobResponse(store, store.getJob(JOB_ID));
  assert.equal(terminal.statusCode, 200);
  assert.equal(terminal.body.result.output, "# Durable result");

  const secondId = "0x" + "33".repeat(32);
  store.createQuote({
    jobId: secondId,
    request: { slug: "client-research", tier: "normal", input: { prompt: "Beta" } },
    payment: { mode: "escrow", reference: secondId, amount: "10000" },
  });
  const denied = await serverModule.queueAsyncWorkflowRun({
    ...queueOptions,
    jobId: secondId,
    ownerRateKey: "",
    recoveryToken: "wrong",
    payment: { ...queueOptions.payment, reference: secondId },
    request: { ...queueOptions.request, input: { prompt: "Beta" } },
  });
  assert.equal(denied.statusCode, 403);

  assert.deepEqual(serverModule.workflowJobRequestInput({
    async: true,
    resume: true,
    jobId: JOB_ID,
    runId: JOB_ID,
    recoveryToken: "secret",
  }), {});
  const resumed = serverModule.hydrateWorkflowResumeInput({
    async: true,
    resume: true,
    recoveryToken: "secret",
  }, {
    jobId: JOB_ID,
    request: {
      tier: "normal",
      input: { prompt: "Private prompt", mode: "search" },
    },
    payment: { reference: JOB_ID },
  });
  assert.equal(resumed.prompt, "Private prompt");
  assert.equal(resumed.mode, "search");
  assert.equal(resumed.jobId, JOB_ID);
  assert.equal(resumed.runId, JOB_ID);
  assert.equal(resumed.resume, true);

  console.log("PASS: workflow async API helpers");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
