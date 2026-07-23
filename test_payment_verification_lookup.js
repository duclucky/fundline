"use strict";

const assert = require("assert");

process.env.FUNDLINE_NO_LISTEN = "1";
const server = require("./server");

const TX = "0x" + "1".repeat(64);
const criteria = {
  txHash: TX,
  payerWallet: "0x" + "a".repeat(40),
  merchantWallet: "0x" + "b".repeat(40),
  amount: "10",
  onchainInvoiceId: "0x" + "2".repeat(64),
  requireInvoiceReference: true,
};

async function run() {
  let calls = [];
  const routerMatch = { source: "rpc_payment_router_event", txHash: TX };
  let result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch, directMatch: null, routerConflict: false };
    },
    findTokenTransferByTx: async () => {
      calls.push("tokenByTx");
      return null;
    },
    findNativeTransferByTx: async () => {
      calls.push("nativeByTx");
      return null;
    },
    findRecentTokenTransfer: async () => {
      calls.push("recentToken");
      return null;
    },
    findRecentNativeTransfer: async () => {
      calls.push("recentNative");
      return null;
    },
  });
  assert.equal(result, routerMatch);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  const directMatch = { source: "rpc_usdc_transfer_log", txHash: TX };
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch, routerConflict: false };
    },
    findTokenTransferByTx: async () => {
      calls.push("tokenByTx");
      return null;
    },
    findNativeTransferByTx: async () => {
      calls.push("nativeByTx");
      return null;
    },
    findRecentTokenTransfer: async () => {
      calls.push("recentToken");
      return null;
    },
    findRecentNativeTransfer: async () => {
      calls.push("recentNative");
      return null;
    },
  });
  assert.equal(result, directMatch);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch: null, routerConflict: true };
    },
    findTokenTransferByTx: async () => {
      calls.push("tokenByTx");
      return null;
    },
    findNativeTransferByTx: async () => {
      calls.push("nativeByTx");
      return null;
    },
    findRecentTokenTransfer: async () => {
      calls.push("recentToken");
      return null;
    },
    findRecentNativeTransfer: async () => {
      calls.push("recentNative");
      return null;
    },
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ["receipt"]);

  calls = [];
  result = await server.findArcPayment(criteria, {
    inspectPaymentInRpcReceipt: async () => {
      calls.push("receipt");
      return { routerMatch: null, directMatch: null, routerConflict: false };
    },
    findTokenTransferByTx: async () => {
      calls.push("tokenByTx");
      return null;
    },
    findNativeTransferByTx: async () => {
      calls.push("nativeByTx");
      return null;
    },
    findRecentTokenTransfer: async () => {
      calls.push("recentToken");
      return null;
    },
    findRecentNativeTransfer: async () => {
      calls.push("recentNative");
      return null;
    },
  });
  assert.equal(result, null);
  assert.deepEqual(calls, ["receipt", "tokenByTx", "nativeByTx"]);

  const router = server.ARC_PAYMENT_ROUTER_ADDRESS;
  const candidateCriteria = {
    payerWallet: criteria.payerWallet,
    createdAt: new Date("2026-07-23T00:00:00.000Z"),
  };
  const recent = Array.from({ length: 30 }, (_, index) => ({
    hash: "0x" + String(index + 10).padStart(64, "0"),
    from: { hash: candidateCriteria.payerWallet },
    to: { hash: router },
    timestamp: "2026-07-23T00:00:30.000Z",
  }));
  recent.push({
    hash: "0x" + "f".repeat(64),
    from: { hash: candidateCriteria.payerWallet },
    to: { hash: "0x" + "c".repeat(40) },
    timestamp: "2026-07-23T00:00:30.000Z",
  });
  const selected = server.selectRecentRouterCandidates(recent, candidateCriteria, 20);
  assert.equal(selected.length, 20);
  assert.equal(selected.every((item) => server.normalizeAddress(item.to.hash) === router), true);
  assert.deepEqual(selected.map((item) => item.hash), recent.slice(0, 20).map((item) => item.hash));

  const invalid = [
    { ...recent[0], from: { hash: "0x" + "c".repeat(40) } },
    { ...recent[0], timestamp: "2026-07-22T23:00:00.000Z" },
    { ...recent[0], hash: "" },
    { ...recent[0], hash: "not-a-hash" },
  ];
  assert.deepEqual(server.selectRecentRouterCandidates(invalid, candidateCriteria, 20), []);
}

run().then(() => {
  console.log("PASS: payment verification lookup");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
