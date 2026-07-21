"use strict";

// Offline tests for sanctions-data.js. Injected getJson, no network.
// Run: node test_sanctions_data.js

const s = require("./sanctions-data");

let passed = 0;
let failed = 0;
function assert(name, cond) {
  if (cond) { passed++; } else { failed++; console.error("FAIL: " + name); }
}
async function assertThrows(name, fn, code) {
  try { await fn(); failed++; console.error("FAIL (no throw): " + name); }
  catch (e) {
    if (!code || e.code === code) { passed++; }
    else { failed++; console.error("FAIL (wrong code): " + name + " got " + e.code); }
  }
}

// A well-known OFAC-sanctioned Tornado Cash address (used only as a label; no network here).
const SANCTIONED = "0x8589427373D6D84E98730D7795D8f6f8731FDA16";
const CLEAN = "0x1111111111111111111111111111111111111111";

function stub(handlers) {
  return async (url, headers) => {
    if (url.indexOf("gopluslabs.io") !== -1) return handlers.goplus ? handlers.goplus(url, headers) : { status: 404, json: null };
    if (url.indexOf("public.chainalysis.com") !== -1) return handlers.chainalysis ? handlers.chainalysis(url, headers) : { status: 404, json: null };
    return { status: 404, json: null };
  };
}
function goPlusResult(fields) {
  return { status: 200, json: { code: 1, message: "OK", result: Object.assign({ data_source: "GoPlus" }, fields) } };
}

(async () => {
  // isEvmAddress
  assert("valid address", s.isEvmAddress(SANCTIONED));
  assert("reject short", !s.isEvmAddress("0x123"));
  assert("reject non-hex", !s.isEvmAddress("0xZZ22122dF12D4e14e13Ac3b6895a86e84145b6967"));
  assert("reject empty", !s.isEvmAddress(""));

  // normalizeGoPlus
  const g = s.normalizeGoPlus({ sanctioned: "1", mixer: "1", phishing_activities: "0", data_source: "GoPlus" });
  assert("goplus sanctioned true", g.sanctioned === true);
  assert("goplus risk has sanctioned", g.risks.indexOf("sanctioned") !== -1);
  assert("goplus risk has mixer", g.risks.indexOf("mixer") !== -1);
  assert("goplus risk excludes phishing (0)", g.risks.indexOf("phishing") === -1);
  assert("goplus null on junk", s.normalizeGoPlus(null) === null);

  // normalizeChainalysis
  const c1 = s.normalizeChainalysis({ identifications: [{ category: "sanctions", name: "OFAC SDN", description: "x", url: "y" }] });
  assert("chainalysis sanctioned true", c1.sanctioned === true && c1.identifications.length === 1);
  const c2 = s.normalizeChainalysis({ identifications: [] });
  assert("chainalysis clean", c2.sanctioned === false && c2.identifications.length === 0);
  const c3 = s.normalizeChainalysis({ identifications: [{ category: "info", name: "exchange" }] });
  assert("chainalysis ignores non-sanctions category", c3.sanctioned === false);

  // screenAddress: sanctioned via GoPlus
  const r1 = await s.screenAddress({ address: SANCTIONED, getJson: stub({ goplus: () => goPlusResult({ sanctioned: "1" }) }) });
  assert("screen sanctioned verdict", r1.verdict === "sanctioned");
  assert("screen sanctioned flag", r1.sanctioned === true);
  assert("screen sources has goplus", r1.sources.indexOf("goplus") !== -1);
  assert("screen risk has sanctioned", r1.risk.indexOf("sanctioned") !== -1);
  assert("screen has disclaimer", typeof r1.disclaimer === "string" && r1.disclaimer.length > 0);
  assert("screen address lowercased", r1.address === SANCTIONED.toLowerCase());

  // screenAddress: clean (goplus all zero, no chainalysis key)
  const r2 = await s.screenAddress({ address: CLEAN, getJson: stub({ goplus: () => goPlusResult({ sanctioned: "0", mixer: "0" }) }) });
  assert("screen clean verdict", r2.verdict === "clear");
  assert("screen clean not sanctioned", r2.sanctioned === false);
  assert("screen clean skips chainalysis (no key)", r2.sourceStatus.chainalysis === "empty");
  assert("screen clean sanctionsChecked false (no authority ran)", r2.sanctionsChecked === false);

  // screenAddress: chainalysis sanctioned via key, and key must be forwarded
  const r3 = await s.screenAddress({
    address: SANCTIONED,
    chainalysisApiKey: "test-key",
    getJson: stub({
      goplus: () => goPlusResult({ sanctioned: "0" }),
      chainalysis: (url, headers) => {
        if (!headers || headers["X-API-Key"] !== "test-key") return { status: 401, json: null };
        return { status: 200, json: { identifications: [{ category: "sanctions", name: "OFAC", description: "", url: "" }] } };
      },
    }),
  });
  assert("chainalysis path sanctioned", r3.sanctioned === true && r3.verdict === "sanctioned");
  assert("chainalysis key forwarded", r3.sources.indexOf("chainalysis") !== -1);
  assert("chainalysis sanctionsChecked true", r3.sanctionsChecked === true);

  // risk-only (not sanctioned) verdict
  const r4 = await s.screenAddress({ address: CLEAN, getJson: stub({ goplus: () => goPlusResult({ sanctioned: "0", phishing_activities: "1" }) }) });
  assert("risk verdict", r4.verdict === "risk");
  assert("risk not sanctioned", r4.sanctioned === false);
  assert("risk has phishing", r4.risk.indexOf("phishing") !== -1);

  // source-skip: goplus throws, no key -> unknown, no throw
  const r5 = await s.screenAddress({
    address: CLEAN,
    getJson: async (url) => {
      if (url.indexOf("gopluslabs.io") !== -1) throw new Error("boom");
      return { status: 404, json: null };
    },
  });
  assert("source-skip goplus error recorded", r5.sourceStatus.goplus === "error");
  assert("source-skip unknown verdict", r5.verdict === "unknown");
  assert("source-skip has errors", r5.errors.length === 1 && r5.errors[0].source === "goplus");

  // invalid address throws with code
  await assertThrows("invalid address throws", () => s.screenAddress({ address: "nope" }), "invalid_address");

  console.log((failed === 0 ? "PASS" : "FAIL") + ": " + passed + " passed, " + failed + " failed");
  if (failed > 0) process.exit(1);
})();
