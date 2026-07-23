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

function rpcExample() {
  const match = docs.match(/<pre id="mcp-rpc-fallback"><code>([\s\S]*?)<\/code><\/pre>/);
  assert(match, "docs.html must include the executable RPC fallback example");
  const source = match[1]
    .replaceAll("&gt;", ">")
    .replaceAll("&lt;", "<")
    .replaceAll("&amp;", "&");
  return (fetchImpl) => Function("fetch", source + "\nreturn arcRpc;")(fetchImpl);
}

async function main() {
  const makeRpc = rpcExample();
  let semanticCalls = 0;
  const semanticRpc = makeRpc(async () => {
    semanticCalls += 1;
    return {
      status: 200,
      json: async () => ({ error: { code: -32000, message: "execution reverted" } }),
    };
  });
  await assert.rejects(() => semanticRpc("eth_call"), /execution reverted/);
  assert.equal(semanticCalls, 1, "semantic RPC errors must not rotate endpoints");

  let retryableCalls = 0;
  const retryableRpc = makeRpc(async () => {
    retryableCalls += 1;
    return retryableCalls === 1
      ? { status: 200, json: async () => ({ error: { code: -32011, message: "request limit reached" } }) }
      : { status: 200, json: async () => ({ result: "0x4cef52" }) };
  });
  assert.equal(await retryableRpc("eth_chainId"), "0x4cef52");
  assert.equal(retryableCalls, 2, "rate-limit errors must rotate to the next endpoint");

  console.log("PASS: agent MCP and RPC fallback docs");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
