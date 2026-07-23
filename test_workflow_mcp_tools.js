"use strict";

const assert = require("assert");
const { createWorkflowMcpCallHandler, MCP_TOOLS } = require("./workflow-mcp-tools");

const JOB_ID = "0x" + "11".repeat(32);
const TOKEN = "22".repeat(32);
const ESCROW = "0x" + "33".repeat(20);
const USDC = "0x3600000000000000000000000000000000000000";
const PAYER = "0x" + "44".repeat(20);
const TX_HASH = "0x" + "55".repeat(32);

function response(status, body) {
  return { status, json: async () => body };
}

function fakeFetch(responses, calls) {
  return async (url, options) => {
    calls.push({ url, options: options || {} });
    const next = responses.shift();
    if (!next) throw new Error("Unexpected fetch");
    return next;
  };
}

async function main() {
  assert.equal(MCP_TOOLS.some((tool) => tool.name === "get_run"), true);

  let calls = [];
  let handler = createWorkflowMcpCallHandler({
    selfBase: "https://fundline.test",
    forwardHeaders: () => ({ "Content-Type": "application/json", "X-API-Key": "test" }),
    fetchImpl: fakeFetch([
      response(200, {
        jobId: JOB_ID,
        runId: JOB_ID,
        recoveryToken: TOKEN,
        status: "awaiting_payment",
        amount: "10000",
        amountUsdc: "0.010000",
        escrowAddress: ESCROW,
        usdc: USDC,
        chainId: 5042002,
      }),
      response(202, { jobId: JOB_ID, status: "queued", retryAfterSeconds: 3 }),
      response(200, {
        jobId: JOB_ID,
        status: "succeeded",
        result: { output: "# Done", priceUsdc: "0.010000" },
      }),
    ], calls),
    asyncEnabled: true,
  });

  const quote = await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
  });
  assert.equal(quote.structuredContent.status, "awaiting_payment");
  assert.equal(quote.structuredContent.recoveryToken, TOKEN);

  const queued = await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
    payment: { runId: JOB_ID, jobId: JOB_ID, recoveryToken: TOKEN },
  });
  assert.equal(queued.structuredContent.status, "queued");

  const done = await handler("get_run", { jobId: JOB_ID, recoveryToken: TOKEN });
  assert.equal(done.structuredContent.result.output, "# Done");
  assert.equal(calls[0].url.endsWith("/api/workflows/client-research/quote"), true);
  assert.equal(JSON.parse(calls[0].options.body).paymentMode, "escrow");
  assert.equal(calls[1].url.endsWith("/api/workflows/client-research/run"), true);
  assert.equal(JSON.parse(calls[1].options.body).async, true);
  assert.equal(calls[2].url.endsWith("/api/workflows/runs/" + JOB_ID), true);
  assert.equal(calls[2].options.headers["X-Fundline-Recovery-Token"], TOKEN);

  calls = [];
  handler = createWorkflowMcpCallHandler({
    selfBase: "https://fundline.test",
    forwardHeaders: () => ({ "Content-Type": "application/json" }),
    fetchImpl: fakeFetch([
      response(200, { jobId: JOB_ID, recoveryToken: TOKEN, status: "awaiting_payment", paymentMode: "x402" }),
      response(202, { jobId: JOB_ID, status: "queued" }),
    ], calls),
    asyncEnabled: true,
  });
  await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
    paymentMode: "x402",
  });
  await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
    payment: { jobId: JOB_ID, recoveryToken: TOKEN, payerWallet: PAYER, txHash: TX_HASH },
  });
  assert.equal(JSON.parse(calls[0].options.body).paymentMode, "x402");
  assert.equal(JSON.parse(calls[1].options.body).jobId, JOB_ID);
  assert.equal(JSON.parse(calls[1].options.body).async, true);
  assert.equal(Boolean(calls[1].options.headers["X-PAYMENT"]), true);

  calls = [];
  handler = createWorkflowMcpCallHandler({
    selfBase: "https://fundline.test",
    forwardHeaders: () => ({ "Content-Type": "application/json" }),
    fetchImpl: fakeFetch([
      response(200, { output: "legacy", priceUsdc: "0.01", releaseTx: TX_HASH }),
    ], calls),
    asyncEnabled: true,
  });
  const legacy = await handler("run_workflow", {
    slug: "client-research",
    tier: "normal",
    prompt: "Acme",
    payment: { payerWallet: PAYER, txHash: TX_HASH },
  });
  assert.equal(legacy.structuredContent.output, "legacy");
  assert.equal(JSON.parse(calls[0].options.body).async, undefined);

  console.log("PASS: workflow MCP tools");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
