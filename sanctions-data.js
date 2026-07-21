"use strict";

// Sanctions + address-risk screening for a crypto wallet address.
// Two sources, both permissive for commercial redistribution (verified 2026-07-20):
//   - GoPlus       https://api.gopluslabs.io        = keyless address risk (sanctioned, mixer,
//                                                     phishing, money laundering, ...)
//   - Chainalysis  https://public.chainalysis.com   = OFAC/EU/UN sanctioned-address oracle,
//                                                     no commercial licence required (free API key)
// EVM addresses only in v1. Each source is normalized to one shape; a source that errors,
// is empty, or is not configured is skipped, never failing the whole screen (like crypto-data.js).
//
// SCREENING IS INFORMATIONAL / BEST-EFFORT: lists can be incomplete or stale. This is not legal
// or compliance advice; the caller (agent) stays responsible for its own compliance decisions.

const https = require("https");

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
    request.setTimeout(20000, () => { request.destroy(new Error("sanctions screen request timed out")); });
    request.on("error", reject);
    request.end();
  });
}

const DISCLAIMER = "Informational and best-effort only. Sanctions and risk lists may be incomplete or stale. This is not legal or compliance advice; the caller remains responsible for its own compliance decisions.";

// --- GoPlus address security (keyless) ---

// GoPlus address_security flags we surface, mapped to readable risk labels. Each source field
// is "1" (flagged) or "0". See https://docs.gopluslabs.io/reference/api-overview
const GOPLUS_RISK_FLAGS = {
  sanctioned: "sanctioned",
  blacklist_doubt: "blacklist",
  phishing_activities: "phishing",
  stealing_attack: "stealing_attack",
  blackmail_activities: "blackmail",
  cybercrime: "cybercrime",
  money_laundering: "money_laundering",
  financial_crime: "financial_crime",
  darkweb_transactions: "darkweb",
  mixer: "mixer",
  fake_kyc: "fake_kyc",
  malicious_mining_activities: "malicious_mining",
  honeypot_related_address: "honeypot_related",
};

function isFlagOn(v) {
  return String(v) === "1";
}

function normalizeGoPlus(result) {
  if (!result || typeof result !== "object") return null;
  const risks = [];
  Object.keys(GOPLUS_RISK_FLAGS).forEach((key) => {
    if (isFlagOn(result[key])) risks.push(GOPLUS_RISK_FLAGS[key]);
  });
  return {
    sanctioned: isFlagOn(result.sanctioned),
    risks,
    dataSource: result.data_source || "",
  };
}

async function fetchGoPlus(address, chainId, getJson) {
  if (!isEvmAddress(address)) return null;
  const q = chainId ? `?chain_id=${encodeURIComponent(chainId)}` : "";
  const url = `https://api.gopluslabs.io/api/v1/address_security/${address.toLowerCase()}${q}`;
  const res = await getJson(url, null);
  if (!res || res.status !== 200 || !res.json || String(res.json.code) !== "1" || !res.json.result) return null;
  return normalizeGoPlus(res.json.result);
}

// --- Chainalysis sanctions oracle (free API key via CHAINALYSIS_API_KEY) ---

function normalizeChainalysis(json) {
  const ids = (json && Array.isArray(json.identifications)) ? json.identifications : [];
  const sanctions = ids.filter((i) => i && String(i.category || "").toLowerCase() === "sanctions");
  return {
    sanctioned: sanctions.length > 0,
    identifications: sanctions.map((i) => ({
      name: i.name || "",
      description: i.description || "",
      url: i.url || "",
    })),
  };
}

async function fetchChainalysis(address, apiKey, getJson) {
  if (!isEvmAddress(address) || !apiKey) return null;
  const url = `https://public.chainalysis.com/api/v1/address/${address.toLowerCase()}`;
  const res = await getJson(url, { "X-API-Key": apiKey });
  if (!res || res.status !== 200 || !res.json) return null;
  return normalizeChainalysis(res.json);
}

// --- orchestrator ---

// opts: { address, chainId, getJson, chainalysisApiKey }
// Returns { address, verdict, sanctioned, risk[], sources[], detail, sourceStatus, errors, disclaimer }.
// verdict: "sanctioned" | "risk" | "clear" | "unknown" (no source could answer).
async function screenAddress(opts) {
  const options = opts || {};
  const getJson = options.getJson || httpGetJson;
  const address = String(options.address || "").trim();
  const errors = [];
  const sourceStatus = {};

  if (!isEvmAddress(address)) {
    const err = new Error("A valid EVM address (0x + 40 hex) is required");
    err.code = "invalid_address";
    throw err;
  }

  async function safe(name, fn) {
    try {
      const out = await fn();
      sourceStatus[name] = out ? "ok" : "empty";
      return out;
    } catch (error) {
      errors.push({ source: name, message: error.message });
      sourceStatus[name] = "error";
      return null;
    }
  }

  const goPlus = await safe("goplus", () => fetchGoPlus(address, options.chainId, getJson));
  const chainalysis = await safe("chainalysis", () => fetchChainalysis(address, options.chainalysisApiKey, getJson));

  const sources = [];
  if (goPlus) sources.push("goplus");
  if (chainalysis) sources.push("chainalysis");

  // A positive from either source counts, but only an authoritative sanctions source
  // (Chainalysis today; OFAC SDN later) makes a negative trustworthy. GoPlus keyless is
  // reliable for risk labels, NOT for OFAC sanctions coverage (verified 2026-07-20: a known
  // OFAC-sanctioned Tornado Cash address returns all-clear from GoPlus).
  const sanctioned = Boolean((goPlus && goPlus.sanctioned) || (chainalysis && chainalysis.sanctioned));
  const sanctionsChecked = Boolean(chainalysis);
  const risk = goPlus ? goPlus.risks.slice() : [];
  if (sanctioned && risk.indexOf("sanctioned") === -1) risk.unshift("sanctioned");

  // verdict reflects only the sources that answered; check sanctionsChecked to know whether an
  // authoritative sanctions source was among them. "clear" = nothing flagged by consulted sources.
  let verdict;
  if (!sources.length) verdict = "unknown";
  else if (sanctioned) verdict = "sanctioned";
  else if (risk.length) verdict = "risk";
  else verdict = "clear";

  return {
    address: address.toLowerCase(),
    verdict,
    sanctioned,
    sanctionsChecked,
    risk,
    sources,
    detail: { goplus: goPlus, chainalysis: chainalysis },
    sourceStatus,
    errors,
    disclaimer: DISCLAIMER,
  };
}

module.exports = {
  isEvmAddress,
  httpGetJson,
  DISCLAIMER,
  GOPLUS_RISK_FLAGS,
  isFlagOn,
  normalizeGoPlus,
  fetchGoPlus,
  normalizeChainalysis,
  fetchChainalysis,
  screenAddress,
};
