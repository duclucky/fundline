"use strict";

// Offline unit test for crypto-data.js normalizers + fetch orchestrator (injected getJson).

const assert = require("assert");
const cd = require("./crypto-data");

let passed = 0;
function check(name, cond) { assert.ok(cond, name); passed += 1; }

// --- normalizeMarket: pick deepest liquidity on the requested chain ---
const dsTokens = {
  pairs: [
    { chainId: "ethereum", dexId: "uniswap", baseToken: { name: "Pepe", symbol: "PEPE", address: "0xAaa" }, priceUsd: "0.000002", liquidity: { usd: 19978779 }, volume: { h24: 809834 }, fdv: 1118302070, marketCap: 1100000000, pairAddress: "0xpair", url: "https://dexscreener.com/ethereum/0xpair", pairCreatedAt: 1681430400000 },
    { chainId: "ethereum", dexId: "sushiswap", baseToken: { name: "Pepe", symbol: "PEPE", address: "0xAaa" }, priceUsd: "0.000002", liquidity: { usd: 50000 }, volume: { h24: 1000 }, fdv: 1, pairCreatedAt: 1681430400000 },
    { chainId: "bsc", dexId: "pancake", baseToken: { name: "FakePepe", symbol: "PEPE", address: "0xBbb" }, priceUsd: "1", liquidity: { usd: 999999999 }, pairCreatedAt: 1681430400000 },
  ],
};
const mkt = cd.normalizeMarket(dsTokens.pairs, "ethereum");
check("market picks eth deepest pair", mkt && mkt.dex === "uniswap" && mkt.liquidityUsd === 19978779);
check("market ignores other-chain deeper pair", mkt.chain === "ethereum" && mkt.symbol === "PEPE");
check("market pairAgeDays computed", typeof mkt.pairAgeDays === "number" && mkt.pairAgeDays > 0);
check("market pairCount", mkt.pairCount === 3);

// --- normalizeSecurity ---
const gp = {
  is_open_source: "1", is_honeypot: "0", buy_tax: "0.05", sell_tax: "0.4", is_mintable: "1",
  owner_address: "0x1234000000000000000000000000000000000000", can_take_back_ownership: "1",
  hidden_owner: "0", selfdestruct: "0", is_proxy: "0", transfer_pausable: "1", is_blacklisted: "0",
  holder_count: "569632", lp_holder_count: "71", creator_percent: "0.03",
  holders: [{ percent: "0.2" }, { percent: "0.1" }, { percent: "0.05" }],
  lp_holders: [{ percent: "0.6", is_locked: "1" }, { percent: "0.4", is_locked: "0" }],
};
const sec = cd.normalizeSecurity(gp);
check("sec open source", sec.isOpenSource === true);
check("sec honeypot false", sec.isHoneypot === false);
check("sec buy tax 5%", sec.buyTaxPct === 5);
check("sec sell tax 40%", sec.sellTaxPct === 40);
check("sec mintable", sec.isMintable === true);
check("sec owner not renounced", sec.ownerRenounced === false);
check("sec pausable", sec.transferPausable === true);
check("sec top10 sum 35%", sec.top10Percent === 35);
check("sec lp locked 60%", sec.lpLockedPercent === 60);

// renounced owner (0x0) -> ownerRenounced true
const secR = cd.normalizeSecurity(Object.assign({}, gp, { owner_address: "0x0000000000000000000000000000000000000000" }));
check("sec renounced when 0x0", secR.ownerRenounced === true);

// --- fetchTokenData with injected getJson ---
function fakeGetJson(map) {
  return async (url) => {
    for (const k of Object.keys(map)) { if (url.indexOf(k) !== -1) return { status: 200, json: map[k] }; }
    return { status: 404, json: null };
  };
}
(async () => {
  const getJson = fakeGetJson({
    "api.dexscreener.com/latest/dex/tokens/": dsTokens,
    "api.gopluslabs.io/api/v1/token_security/1": { result: { "0xaaa": gp } },
  });
  const data = await cd.fetchTokenData({ chain: "ethereum", address: "0xAaa0000000000000000000000000000000000000", getJson });
  check("fetch returns market", data.market && data.market.symbol === "PEPE");
  check("fetch returns security", data.security && data.security.buyTaxPct === 5);
  check("fetch sourceCounts", data.sourceCounts.DexScreener === 1 && data.sourceCounts.GoPlus === 1);

  // A failing source is skipped, not fatal.
  const getJson2 = fakeGetJson({ "api.dexscreener.com/latest/dex/tokens/": dsTokens });
  const data2 = await cd.fetchTokenData({ chain: "ethereum", address: "0xAaa0000000000000000000000000000000000000", getJson: getJson2 });
  check("fetch tolerates missing GoPlus", data2.market && data2.security === null && data2.sourceCounts.GoPlus === 0);

  // search resolves candidates by liquidity desc, filtered by chain.
  const searchJson = { pairs: [
    { chainId: "ethereum", baseToken: { address: "0xAaa", name: "Pepe", symbol: "PEPE" }, liquidity: { usd: 100 } },
    { chainId: "ethereum", baseToken: { address: "0xCcc", name: "Pepe2", symbol: "PEPE" }, liquidity: { usd: 5000 } },
    { chainId: "bsc", baseToken: { address: "0xDdd", name: "PepeBsc", symbol: "PEPE" }, liquidity: { usd: 9999 } },
  ] };
  const cands = cd.normalizeSearch(searchJson, "ethereum");
  check("search filters by chain + sorts desc", cands.length === 2 && cands[0].address === "0xCcc");

  check("chainInfo maps base", cd.chainInfo("base").goPlusId === "8453");
  check("isEvmAddress", cd.isEvmAddress("0x6982508145454ce325dDbE47a25d4ec3d2311933") && !cd.isEvmAddress("pepe"));

  console.log("crypto data test: " + passed + " passed, 0 failed");
})().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
