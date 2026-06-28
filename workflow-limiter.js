"use strict";

const fs = require("fs");
const path = require("path");

// Per-IP daily quota plus a global daily spend backstop for AI workflow runs.
// Anonymous abuse control: counts are per client IP per UTC day. All money is
// integer micro-USD. JSON file store, synchronous read-modify-write (atomic per
// process). See .claude/workflow-rate-limit-spec.md.

function utcDayKey(nowMs) {
  const d = new Date(nowMs);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function nextUtcMidnightIso(nowMs) {
  const d = new Date(nowMs);
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0);
  return new Date(next).toISOString();
}

// Expand an IPv6 address to its full 8 groups so we can key by the /64 prefix.
function expandIpv6(addr) {
  let a = addr;
  if (a.indexOf("::") !== -1) {
    const halves = a.split("::");
    const headParts = halves[0] ? halves[0].split(":") : [];
    const tailParts = halves[1] ? halves[1].split(":") : [];
    const missing = 8 - (headParts.length + tailParts.length);
    const mid = new Array(Math.max(0, missing)).fill("0");
    a = headParts.concat(mid, tailParts).join(":");
  }
  const parts = a.split(":").map((p) => (p === "" ? "0" : p));
  while (parts.length < 8) parts.push("0");
  return parts.slice(0, 8);
}

// Normalize a client IP to a stable per-user key. IPv4 -> the address.
// IPv6 -> the /64 prefix (first 4 groups), since one user often holds a whole /64.
function normalizeIpKey(rawIp) {
  let ip = String(rawIp || "").trim();
  if (!ip) return "";
  ip = ip.replace(/^\[/, "").replace(/\]$/, "").split("%")[0];
  const mapped = ip.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  if (mapped) ip = mapped[1];
  if (ip.indexOf(":") === -1) return ip; // IPv4 or a plain token
  const groups = expandIpv6(ip);
  return `${groups.slice(0, 4).join(":")}::/64`;
}

// Pick the client IP from request headers per the trust-proxy mode, then key it.
// mode: "cloudflare" (CF-Connecting-IP), "xff" (first X-Forwarded-For), else socket.
function getClientIp(headers, socketRemoteAddress, trustProxy) {
  const h = headers || {};
  const mode = trustProxy || "xff";
  let candidate = "";
  if (mode === "cloudflare") {
    candidate = h["cf-connecting-ip"] || "";
  } else if (mode === "xff") {
    candidate = String(h["x-forwarded-for"] || "").split(",")[0].trim();
  }
  if (!candidate) candidate = socketRemoteAddress || "";
  return normalizeIpKey(candidate);
}

function loadDb(filePath, fallback) {
  try {
    if (!fs.existsSync(filePath)) return fallback();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : fallback();
  } catch {
    return fallback();
  }
}

function saveDb(filePath, db) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(db, null, 2)}\n`);
}

function loadUsage(filePath) {
  const db = loadDb(filePath, () => ({ ips: {} }));
  if (!db.ips || typeof db.ips !== "object") db.ips = {};
  return db;
}

function loadBudget(filePath) {
  return loadDb(filePath, () => ({ date: "", spentMicros: 0, runs: 0 }));
}

function ipEntryForToday(usage, ipKey, dayKey) {
  let entry = usage.ips[ipKey];
  if (!entry || entry.date !== dayKey) {
    entry = { date: dayKey, runCount: 0, genCount: 0, spentMicros: 0 };
    usage.ips[ipKey] = entry;
  }
  return entry;
}

function budgetForToday(budget, dayKey) {
  if (budget.date !== dayKey) {
    budget.date = dayKey;
    budget.spentMicros = 0;
    budget.runs = 0;
  }
  return budget;
}

// Drop IP entries from previous days so the file does not grow unbounded.
function pruneUsage(usage, dayKey) {
  Object.keys(usage.ips).forEach((k) => {
    if (usage.ips[k].date !== dayKey) delete usage.ips[k];
  });
}

// Check all caps and, if ok, reserve one unit. Returns a verdict object.
// opts: { usagePath, budgetPath, ipKey, kind: "run"|"gen", limits, nowMs? }
// limits: { runsPerDay, gensPerDay, spendCapMicros, dailyBudgetMicros }
function checkAndReserve(opts) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const dayKey = utcDayKey(nowMs);
  const resetsAt = nextUtcMidnightIso(nowMs);
  const kind = opts.kind === "gen" ? "gen" : "run";
  const limits = opts.limits;

  const budget = budgetForToday(loadBudget(opts.budgetPath), dayKey);
  if (budget.spentMicros >= limits.dailyBudgetMicros) {
    return { ok: false, status: 503, error: "service_budget_reached", resetsAt };
  }

  const usage = loadUsage(opts.usagePath);
  pruneUsage(usage, dayKey);
  const entry = ipEntryForToday(usage, opts.ipKey, dayKey);

  if (entry.spentMicros >= limits.spendCapMicros) {
    return { ok: false, status: 429, error: "spend_limit", remaining: 0, resetsAt };
  }

  if (kind === "run") {
    if (entry.runCount >= limits.runsPerDay) {
      return { ok: false, status: 429, error: "daily_limit", remaining: 0, resetsAt };
    }
    entry.runCount += 1;
    saveDb(opts.usagePath, usage);
    return { ok: true, remaining: Math.max(0, limits.runsPerDay - entry.runCount), resetsAt };
  }

  if (entry.genCount >= limits.gensPerDay) {
    return { ok: false, status: 429, error: "gen_limit", remaining: 0, resetsAt };
  }
  entry.genCount += 1;
  saveDb(opts.usagePath, usage);
  return { ok: true, remaining: Math.max(0, limits.gensPerDay - entry.genCount), resetsAt };
}

// Undo a reservation when the downstream API call failed (do not burn a free unit).
function rollbackReserve(opts) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const dayKey = utcDayKey(nowMs);
  const kind = opts.kind === "gen" ? "gen" : "run";
  const usage = loadUsage(opts.usagePath);
  const entry = usage.ips[opts.ipKey];
  if (!entry || entry.date !== dayKey) return;
  if (kind === "run" && entry.runCount > 0) entry.runCount -= 1;
  if (kind === "gen" && entry.genCount > 0) entry.genCount -= 1;
  saveDb(opts.usagePath, usage);
}

// Record real cost (micro-USD) against the IP and the global daily budget.
function recordCost(opts) {
  const nowMs = opts.nowMs != null ? opts.nowMs : Date.now();
  const dayKey = utcDayKey(nowMs);
  const costMicros = Math.max(0, Math.round(Number(opts.costMicros) || 0));

  const usage = loadUsage(opts.usagePath);
  const entry = ipEntryForToday(usage, opts.ipKey, dayKey);
  entry.spentMicros += costMicros;
  saveDb(opts.usagePath, usage);

  const budget = budgetForToday(loadBudget(opts.budgetPath), dayKey);
  budget.spentMicros += costMicros;
  budget.runs += 1;
  saveDb(opts.budgetPath, budget);
}

module.exports = {
  utcDayKey,
  nextUtcMidnightIso,
  expandIpv6,
  normalizeIpKey,
  getClientIp,
  loadUsage,
  loadBudget,
  checkAndReserve,
  rollbackReserve,
  recordCost,
};
