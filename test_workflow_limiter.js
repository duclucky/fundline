"use strict";

// Standalone test for workflow-limiter. Run: node test_workflow_limiter.js

const fs = require("fs");
const os = require("os");
const path = require("path");
const L = require("./workflow-limiter");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}
function eq(name, got, want) {
  check(`${name} (got ${JSON.stringify(got)}, want ${JSON.stringify(want)})`, got === want);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fundline-limiter-"));
const usagePath = path.join(tmp, "usage.json");
const budgetPath = path.join(tmp, "budget.json");
function reset() {
  try { fs.rmSync(usagePath); } catch {}
  try { fs.rmSync(budgetPath); } catch {}
}

// Fixed instant: 2026-06-28T10:00:00Z
const DAY = Date.UTC(2026, 5, 28, 10, 0, 0);
const NEXT_DAY = Date.UTC(2026, 5, 29, 10, 0, 0);
const limits = { runsPerDay: 3, gensPerDay: 3, spendCapMicros: 500000, dailyBudgetMicros: 10000000 };

// --- day + reset helpers ---
eq("utcDayKey", L.utcDayKey(DAY), "2026-06-28");
eq("nextUtcMidnightIso", L.nextUtcMidnightIso(DAY), "2026-06-29T00:00:00.000Z");

// --- IP normalization ---
eq("ipv4 passthrough", L.normalizeIpKey("203.0.113.7"), "203.0.113.7");
eq("ipv4-mapped ipv6", L.normalizeIpKey("::ffff:203.0.113.7"), "203.0.113.7");
eq("ipv6 /64 key", L.normalizeIpKey("2001:db8:abcd:1234:5678:9abc:def0:1111"), "2001:db8:abcd:1234::/64");
eq("ipv6 loopback /64", L.normalizeIpKey("::1"), "0:0:0:0::/64");

// --- getClientIp by trust mode ---
eq("cloudflare mode", L.getClientIp({ "cf-connecting-ip": "198.51.100.9", "x-forwarded-for": "10.0.0.1" }, "127.0.0.1", "cloudflare"), "198.51.100.9");
eq("xff first entry", L.getClientIp({ "x-forwarded-for": "198.51.100.9, 10.0.0.1" }, "127.0.0.1", "xff"), "198.51.100.9");
eq("none uses socket", L.getClientIp({ "x-forwarded-for": "198.51.100.9" }, "127.0.0.1", "none"), "127.0.0.1");
eq("xff missing falls back to socket", L.getClientIp({}, "203.0.113.50", "xff"), "203.0.113.50");

// --- run cap: 3 then block ---
reset();
const ip = "203.0.113.7";
for (let i = 1; i <= 3; i++) {
  const v = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: DAY });
  check(`run ${i} ok`, v.ok === true);
  eq(`run ${i} remaining`, v.remaining, 3 - i);
}
const blocked = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: DAY });
check("4th run blocked", blocked.ok === false && blocked.error === "daily_limit" && blocked.status === 429);

// --- gen counter is independent of run counter ---
const g1 = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "gen", limits, nowMs: DAY });
check("gen still allowed after runs exhausted", g1.ok === true && g1.remaining === 2);

// --- day reset clears counts ---
const nextDayRun = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: NEXT_DAY });
check("run allowed again next day", nextDayRun.ok === true && nextDayRun.remaining === 2);

// --- rollback restores a unit ---
reset();
L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: DAY });
L.rollbackReserve({ usagePath, ipKey: ip, kind: "run", nowMs: DAY });
const afterRollback = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: DAY });
check("rollback frees the slot", afterRollback.ok === true && afterRollback.remaining === 2);

// --- per-IP spend cap ---
reset();
L.recordCost({ usagePath, budgetPath, ipKey: ip, costMicros: 500000, nowMs: DAY });
const spendBlocked = L.checkAndReserve({ usagePath, budgetPath, ipKey: ip, kind: "run", limits, nowMs: DAY });
check("spend cap blocks", spendBlocked.ok === false && spendBlocked.error === "spend_limit");
// a different IP is unaffected by the first IP spend
const otherIp = L.checkAndReserve({ usagePath, budgetPath, ipKey: "198.51.100.1", kind: "run", limits, nowMs: DAY });
check("other IP unaffected by spend cap", otherIp.ok === true);

// --- global budget backstop (503) ---
reset();
L.recordCost({ usagePath, budgetPath, ipKey: "aaa", costMicros: 10000000, nowMs: DAY });
const budgetBlocked = L.checkAndReserve({ usagePath, budgetPath, ipKey: "bbb", kind: "run", limits, nowMs: DAY });
check("global budget blocks all", budgetBlocked.ok === false && budgetBlocked.error === "service_budget_reached" && budgetBlocked.status === 503);

// cleanup
reset();
try { fs.rmdirSync(tmp); } catch {}

console.log(`\nworkflow limiter test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
