"use strict";

// Regression test for amountToUnits (server.js) decimal-to-base-unit conversion.
// USDC on Arc is 6 decimals over the ERC-20 interface and 18 decimals for the
// native gas-token value. The conversion must be exact at both, must truncate
// (not round) like the client, and must match parseTokenUnits in app.js so the
// amount a payer sends equals the amount the server expects when verifying.
//
// Run: node test_amount_units.js

// --- OLD implementation (float-based, the bug being fixed) ---
function amountToUnitsOld(amount, decimals) {
  const normalizedDecimals = Number.isFinite(decimals) ? Math.min(Math.max(decimals, 0), 18) : 6;
  const normalized = Number(amount || 0).toFixed(normalizedDecimals);
  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0");
}

// --- NEW implementation (string-based, exact) - must match server.js ---
function amountToUnitsNew(amount, decimals) {
  const normalizedDecimals = Number.isFinite(decimals) ? Math.min(Math.max(decimals, 0), 18) : 6;
  const text = String(amount || "0").replace(/,/g, "").trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(whole) * 10n ** BigInt(normalizedDecimals) + BigInt(fraction || "0");
}

// --- app.js parseTokenUnits (the client side, must stay in parity) ---
function parseTokenUnits(value, decimals) {
  const normalizedDecimals = Math.min(Math.max(Number(decimals) || 0, 0), 18);
  const text = String(value || "0").replace(/,/g, "").trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(whole) * 10n ** BigInt(normalizedDecimals) + BigInt(fraction || "0");
}

// --- Independent ground truth from the canonical decimal STRING (no float) ---
// Truncating semantics: fraction is cut to `decimals` places, never rounded.
function exactRefFromString(decimalString, decimals) {
  const text = String(decimalString).trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = (wholeRaw || "0").replace(/[^0-9]/g, "") || "0";
  const frac = fractionRaw.replace(/[^0-9]/g, "");
  const truncated = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(truncated || "0");
}

const fractionDigits = (s) => {
  const i = String(s).indexOf(".");
  return i < 0 ? 0 : String(s).length - i - 1;
};

// Canonical decimal strings (<= 15 significant digits so Number<->String round-trips).
const amounts = [
  "0", "0.000001", "0.00001", "0.0001", "0.001", "0.01", "0.1", "0.3", "0.5", "0.7",
  "0.06", "0.07", "1", "1.1", "1.5", "2.2", "2.5", "9.99", "10", "10.5", "10.50",
  "25", "33.33", "99.99", "100", "123.456789", "1000", "12345.67", "999999.99",
  "1000000", "0.123456", "1.000001", "50000.5",
];
const overPrecise = ["0.1234567", "0.0000019", "3.141592653", "9.9999999"]; // > 6 fractional digits
const decimalsList = [0, 6, 12, 18];

let pass = 0;
let fail = 0;
const failures = [];
function check(name, got, want) {
  if (got === want) { pass += 1; return; }
  fail += 1;
  failures.push(`${name}: got ${got} want ${want}`);
}

// 1) NEW is exact vs string ground truth, both for string and Number inputs.
// 2) NEW matches app.js parseTokenUnits (client/server parity).
// 3) NEW(number) == NEW(string) when the Number round-trips.
for (const d of decimalsList) {
  for (const a of amounts) {
    const ref = exactRefFromString(a, d);
    check(`NEW(str "${a}", ${d}) exact`, amountToUnitsNew(a, d), ref);
    check(`NEW(num ${a}, ${d}) exact`, amountToUnitsNew(Number(a), d), ref);
    check(`parity parseTokenUnits("${a}", ${d})`, parseTokenUnits(a, d), amountToUnitsNew(a, d));
  }
}

// 4) No regression on the realistic 6-decimal path: amounts with <= 6 fraction
//    digits must produce the SAME value as the OLD implementation.
for (const a of amounts) {
  if (fractionDigits(a) <= 6) {
    check(`no-regression OLD==NEW("${a}", 6)`, amountToUnitsNew(Number(a), 6), amountToUnitsOld(Number(a), 6));
  }
}

// 5) Headline bug demonstration: at 18 decimals the OLD float path is wrong for
//    values like 0.1, while NEW is exact. Also show NEW restores client parity.
const demo = [];
for (const a of ["0.1", "0.3", "0.7", "1.1", "2.2"]) {
  const ref = exactRefFromString(a, 18);
  const oldVal = amountToUnitsOld(Number(a), 18);
  const newVal = amountToUnitsNew(Number(a), 18);
  demo.push({ a, ref: ref.toString(), old: oldVal.toString(), new: newVal.toString(), oldOk: oldVal === ref, newOk: newVal === ref });
  check(`fix NEW("${a}", 18) exact`, newVal, ref);
}

// 6) Over-precise inputs (> 6 fraction digits): NEW must match the client
//    (parseTokenUnits truncation), which is what actually gets paid. OLD rounded
//    and could diverge from the paid amount.
for (const a of overPrecise) {
  for (const d of [6, 18]) {
    check(`overprecise parity NEW==client("${a}", ${d})`, amountToUnitsNew(a, d), parseTokenUnits(a, d));
  }
}

// 7) Defensive inputs must not throw and must yield 0 like before.
for (const bad of [undefined, null, "", NaN, 0]) {
  let threw = false;
  let val = -1n;
  try { val = amountToUnitsNew(bad, 6); } catch (e) { threw = true; }
  check(`defensive(${String(bad)}) no-throw`, threw, false);
  check(`defensive(${String(bad)}) == 0`, val, 0n);
}

console.log("=== amountToUnits bug demonstration (18 decimals) ===");
for (const r of demo) {
  console.log(`amount=${r.a}  ref=${r.ref}  OLD=${r.old} (${r.oldOk ? "ok" : "WRONG"})  NEW=${r.new} (${r.newOk ? "ok" : "WRONG"})`);
}
console.log("");
console.log(`PASS=${pass} FAIL=${fail}`);
if (fail > 0) {
  console.log("--- FAILURES ---");
  failures.slice(0, 50).forEach((f) => console.log(f));
  process.exit(1);
}
console.log("All amountToUnits assertions passed.");
