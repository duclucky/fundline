"use strict";

// On-chain + market data for the Crypto Due-Diligence workflow.
// Two sources, both free and keyless, validated live 2026-07-05:
//   - DexScreener  https://api.dexscreener.com  = price, liquidity, volume, FDV, pair age
//   - GoPlus       https://api.gopluslabs.io     = honeypot, taxes, ownership, holders, LP
// EVM chains only in v1. Each source is normalized to one shape; a source that
// errors or is empty is skipped, never fails the whole fetch (like gig-sources.js).
// See .claude/workflow-crypto-dd-spec.md.

const https = require("https");

// EVM chains: our slug -> { goPlusId (numeric chainId), dsChain (DexScreener chainId slug) }.
const CHAINS = {
  ethereum: { goPlusId: "1", dsChain: "ethereum", label: "Ethereum" },
  bsc: { goPlusId: "56", dsChain: "bsc", label: "BNB Chain" },
  base: { goPlusId: "8453", dsChain: "base", label: "Base" },
  arbitrum: { goPlusId: "42161", dsChain: "arbitrum", label: "Arbitrum" },
  polygon: { goPlusId: "137", dsChain: "polygon", label: "Polygon" },
  optimism: { goPlusId: "10", dsChain: "optimism", label: "Optimism" },
  avalanche: { goPlusId: "43114", dsChain: "avalanche", label: "Avalanche" },
};

function chainInfo(chain) {
  return CHAINS[String(chain || "").toLowerCase()] || null;
}

function isEvmAddress(s) {
  return /^0x[0-9a-fA-F]{40}$/.test(String(s || "").trim());
}

// --- HTTP (injected in tests) ---

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const request = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: Object.assign({ "Accept": "application/json", "User-Agent": "Fundline/1.0" }, headers || {}),
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          let json = null;
          try { json = JSON.parse(body || "null"); } catch { json = null; }
          resolve({ status: response.statusCode, json });
        });
      },
    );
    request.setTimeout(20000, () => { request.destroy(new Error("crypto data request timed out")); });
    request.on("error", reject);
    request.end();
  });
}

// --- numeric helpers ---

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// GoPlus returns fractions as strings ("0.1" = 10%). Return a percent number.
function pct(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n * 100 : null;
}

function daysSince(ms) {
  if (!ms) return null;
  const d = (Date.now() - ms) / 86400000;
  return d >= 0 ? Math.floor(d) : null;
}

// --- DexScreener ---

// Choose the pair with the deepest liquidity on the requested chain (fallback: any chain).
function pickBestPair(pairs, dsChain) {
  const list = Array.isArray(pairs) ? pairs.filter((p) => p && p.liquidity) : [];
  const onChain = dsChain ? list.filter((p) => String(p.chainId) === dsChain) : list;
  const pool = onChain.length ? onChain : list;
  let best = null;
  pool.forEach((p) => {
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    if (!best || liq > (num(best.liquidity && best.liquidity.usd) || 0)) best = p;
  });
  return best;
}

function normalizeMarket(pairs, dsChain) {
  const best = pickBestPair(pairs, dsChain);
  if (!best) return null;
  const base = best.baseToken || {};
  const createdMs = num(best.pairCreatedAt);
  return {
    chain: best.chainId || "",
    name: base.name || "",
    symbol: base.symbol || "",
    address: base.address || "",
    dex: best.dexId || "",
    priceUsd: num(best.priceUsd),
    liquidityUsd: num(best.liquidity && best.liquidity.usd),
    volume24h: num(best.volume && best.volume.h24),
    fdv: num(best.fdv),
    marketCap: num(best.marketCap),
    pairAddress: best.pairAddress || "",
    pairUrl: best.url || "",
    pairCreatedAt: createdMs ? new Date(createdMs).toISOString().slice(0, 10) : "",
    pairAgeDays: daysSince(createdMs),
    pairCount: Array.isArray(pairs) ? pairs.length : 0,
  };
}

async function fetchMarket(address, dsChain, getJson) {
  if (!isEvmAddress(address)) return null;
  const res = await getJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`, null);
  if (!res || res.status !== 200 || !res.json) return null;
  return normalizeMarket(res.json.pairs, dsChain);
}

// Resolve a name/symbol to candidate tokens, best (deepest liquidity) first.
function normalizeSearch(json, dsChain) {
  const pairs = (json && Array.isArray(json.pairs)) ? json.pairs : [];
  const byToken = new Map();
  pairs.forEach((p) => {
    if (!p || !p.baseToken || !p.baseToken.address) return;
    if (dsChain && String(p.chainId) !== dsChain) return;
    const key = String(p.chainId) + ":" + p.baseToken.address.toLowerCase();
    const liq = num(p.liquidity && p.liquidity.usd) || 0;
    const prev = byToken.get(key);
    if (!prev || liq > prev.liquidityUsd) {
      byToken.set(key, {
        chain: p.chainId, address: p.baseToken.address,
        name: p.baseToken.name || "", symbol: p.baseToken.symbol || "",
        liquidityUsd: liq,
      });
    }
  });
  return Array.from(byToken.values()).sort((a, b) => b.liquidityUsd - a.liquidityUsd);
}

async function searchToken(query, dsChain, getJson) {
  const q = String(query || "").trim();
  if (!q) return [];
  const res = await getJson(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, null);
  if (!res || res.status !== 200 || !res.json) return [];
  return normalizeSearch(res.json, dsChain);
}

// --- GoPlus ---

function sumTopHolders(holders, n) {
  const list = Array.isArray(holders) ? holders.slice(0, n || 10) : [];
  let total = 0;
  list.forEach((h) => { const p = pct(h && h.percent); if (p != null) total += p; });
  return list.length ? Math.round(total * 100) / 100 : null;
}

// A locked LP percent from the lp_holders array (is_locked == 1 or a lock tag).
function lockedLpPercent(lpHolders) {
  const list = Array.isArray(lpHolders) ? lpHolders : [];
  let locked = 0;
  let any = false;
  list.forEach((h) => {
    if (!h) return;
    any = true;
    const isLocked = String(h.is_locked) === "1" || /lock/i.test(String(h.tag || ""));
    if (isLocked) { const p = pct(h.percent); if (p != null) locked += p; }
  });
  return any ? Math.round(locked * 100) / 100 : null;
}

const DEAD_OWNERS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
]);

function normalizeSecurity(result) {
  if (!result || typeof result !== "object") return null;
  const flag = (v) => (v == null || v === "") ? null : String(v) === "1";
  const owner = String(result.owner_address || "").toLowerCase();
  const ownerRenounced = owner === "" ? null : DEAD_OWNERS.has(owner);
  return {
    isOpenSource: flag(result.is_open_source),
    isHoneypot: flag(result.is_honeypot),
    buyTaxPct: pct(result.buy_tax),
    sellTaxPct: pct(result.sell_tax),
    isMintable: flag(result.is_mintable),
    ownerAddress: result.owner_address || "",
    ownerRenounced,
    canTakeBackOwnership: flag(result.can_take_back_ownership),
    hiddenOwner: flag(result.hidden_owner),
    selfdestruct: flag(result.selfdestruct),
    isProxy: flag(result.is_proxy),
    transferPausable: flag(result.transfer_pausable),
    isBlacklisted: flag(result.is_blacklisted),
    isAntiWhale: flag(result.is_anti_whale),
    holderCount: num(result.holder_count),
    lpHolderCount: num(result.lp_holder_count),
    top10Percent: sumTopHolders(result.holders, 10),
    lpLockedPercent: lockedLpPercent(result.lp_holders),
    creatorPercent: pct(result.creator_percent),
  };
}

async function fetchSecurity(goPlusId, address, getJson) {
  if (!isEvmAddress(address) || !goPlusId) return null;
  const url = `https://api.gopluslabs.io/api/v1/token_security/${goPlusId}?contract_addresses=${address.toLowerCase()}`;
  const res = await getJson(url, null);
  if (!res || res.status !== 200 || !res.json || !res.json.result) return null;
  const key = Object.keys(res.json.result)[0];
  if (!key) return null;
  return normalizeSecurity(res.json.result[key]);
}

// --- orchestrator ---

// opts: { chain, address, getJson }
// Returns { chain, address, market, security, sourceCounts, errors }.
async function fetchTokenData(opts) {
  const options = opts || {};
  const getJson = options.getJson || httpGetJson;
  const info = chainInfo(options.chain);
  const address = String(options.address || "").trim();
  const errors = [];
  const sourceCounts = {};

  async function safe(name, fn) {
    try {
      const out = await fn();
      sourceCounts[name] = out ? 1 : 0;
      return out;
    } catch (error) {
      errors.push({ source: name, message: error.message });
      sourceCounts[name] = 0;
      return null;
    }
  }

  const market = await safe("DexScreener", () => fetchMarket(address, info && info.dsChain, getJson));
  const security = await safe("GoPlus", () => fetchSecurity(info && info.goPlusId, address, getJson));

  return { chain: options.chain, address, market, security, sourceCounts, errors };
}

module.exports = {
  CHAINS,
  chainInfo,
  isEvmAddress,
  httpGetJson,
  num,
  pct,
  daysSince,
  pickBestPair,
  normalizeMarket,
  fetchMarket,
  normalizeSearch,
  searchToken,
  sumTopHolders,
  lockedLpPercent,
  normalizeSecurity,
  fetchSecurity,
  fetchTokenData,
};
