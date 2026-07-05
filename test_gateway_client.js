"use strict";

// Offline unit test for gateway-client.js. It injects a fake Circle Gateway
// facilitator (cfg.makeClient) so we exercise the wrapper logic without the real
// @circle-fin/x402-batching SDK or a funded Gateway balance.

const assert = require("assert");
const { createGatewayClient } = require("./gateway-client");

let passed = 0;
function check(name, cond) {
  assert.ok(cond, name);
  passed += 1;
}

const NETWORK = "eip155:5042002";
const USDC = "0x3600000000000000000000000000000000000000";
const SELLER = "0x00000000000000000000000000000000000000a1";
const BATCH_SCHEME = "circle-batching";

// A fake facilitator matching the FacilitatorClient interface.
function makeFakeClient(overrides) {
  const o = overrides || {};
  return {
    getSupportedCalls: 0,
    async getSupported() {
      this.getSupportedCalls += 1;
      if (o.supported) return o.supported;
      return {
        kinds: [
          { x402Version: 2, scheme: BATCH_SCHEME, network: NETWORK, extra: { verifyingContract: "0xBatchWallet" } },
          { x402Version: 2, scheme: BATCH_SCHEME, network: "eip155:8453", extra: {} },
        ],
        extensions: [],
        signers: {},
      };
    },
    async verify(payload, requirements) {
      return o.verify || { isValid: true, payer: "0x00000000000000000000000000000000000000b2" };
    },
    async settle(payload, requirements) {
      return o.settle || { success: true, payer: "0x00000000000000000000000000000000000000b2", transaction: "0xsettletx", network: NETWORK };
    },
  };
}

(async () => {
  // available(): off by default and when misconfigured.
  check("disabled -> unavailable", createGatewayClient({ enabled: false, sellerAddress: SELLER, makeClient: makeFakeClient }).available() === false);
  check("no seller -> unavailable", createGatewayClient({ enabled: true, sellerAddress: "", makeClient: makeFakeClient }).available() === false);
  check("enabled + seller + client -> available", createGatewayClient({ enabled: true, sellerAddress: SELLER, makeClient: makeFakeClient }).available() === true);

  // getSupportedKind: filters by network and caches (getSupported called once).
  const fake = makeFakeClient();
  const gc = createGatewayClient({ enabled: true, sellerAddress: SELLER, network: NETWORK, asset: USDC, batchScheme: BATCH_SCHEME, makeClient: () => fake });
  const kind1 = await gc.getSupportedKind();
  const kind2 = await gc.getSupportedKind();
  check("supported kind is for our network", kind1 && kind1.network === NETWORK);
  check("getSupported cached (called once)", fake.getSupportedCalls === 1);
  check("cached kind identical", kind1 === kind2);

  // buildRequirements: correct shape, echoes extra, sets our seller + amount.
  const req = await gc.buildRequirements({ amount: "20000", slug: "cv-gig-match", tier: "normal" });
  check("req scheme", req.scheme === BATCH_SCHEME);
  check("req network", req.network === NETWORK);
  check("req asset", req.asset === USDC);
  check("req amount", req.amount === "20000");
  check("req payTo is seller", req.payTo === SELLER);
  check("req extra echoes verifyingContract", req.extra.verifyingContract === "0xBatchWallet");
  check("req extra carries slug/tier", req.extra.slug === "cv-gig-match" && req.extra.tier === "normal");

  // buildRequirements returns null when the facilitator does not support our network.
  const gcUnsupported = createGatewayClient({
    enabled: true, sellerAddress: SELLER, network: "eip155:999999", asset: USDC,
    makeClient: () => makeFakeClient(),
  });
  const reqNone = await gcUnsupported.buildRequirements({ amount: "20000" });
  check("unsupported network -> null requirements", reqNone === null);

  // isGatewayPayment: batchScheme fallback matches batch, rejects on-chain scheme.
  check("isGatewayPayment true for batch scheme", gc.isGatewayPayment({ scheme: BATCH_SCHEME }) === true);
  check("isGatewayPayment false for exact scheme", gc.isGatewayPayment({ scheme: "exact" }) === false);

  // verify/settle pass through to the injected client.
  const vr = await gc.verify({ payload: {} }, req);
  check("verify returns isValid", vr.isValid === true && vr.payer);
  const sr = await gc.settle({ payload: {} }, req);
  check("settle returns success + tx", sr.success === true && sr.transaction === "0xsettletx");

  // verify surfaces an invalid authorization.
  const gcBad = createGatewayClient({ enabled: true, sellerAddress: SELLER, network: NETWORK, asset: USDC, makeClient: () => makeFakeClient({ verify: { isValid: false, invalidReason: "insufficient balance" } }) });
  const vrBad = await gcBad.verify({}, {});
  check("verify can be invalid", vrBad.isValid === false && vrBad.invalidReason === "insufficient balance");

  console.log("gateway client test: " + passed + " passed, 0 failed");
})().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
