"use strict";

// Standalone test for the agent API auth helper. Run: node test_agent_api.js
// Sets FUNDLINE_API_KEY before requiring server so the global-key path is testable
// without any data/api-keys.json fixtures.

process.env.FUNDLINE_NO_LISTEN = "1";
process.env.FUNDLINE_API_KEY = "test_global_key_abc123";

const server = require("./server.js");

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL:", name); }
}

function fakeReq(headers) {
  return { headers: headers || {} };
}

// Absent key -> present:false, ok:false.
const a = server.optionalAgentApiKey(fakeReq({}));
check("absent key -> present false", a.present === false);
check("absent key -> ok false", a.ok === false);
check("absent key -> no rateKey", a.rateKey === null);

// Global env key via Authorization: Bearer -> ok, sellerId null (admin), rateKey global.
const b = server.optionalAgentApiKey(fakeReq({ authorization: "Bearer test_global_key_abc123" }));
check("global bearer -> present", b.present === true);
check("global bearer -> ok", b.ok === true);
check("global bearer -> sellerId null (admin)", b.sellerId === null);
check("global bearer -> rateKey global", b.rateKey === "key:global");

// Global env key via x-api-key header -> ok.
const c = server.optionalAgentApiKey(fakeReq({ "x-api-key": "test_global_key_abc123" }));
check("global x-api-key -> ok", c.ok === true);

// Present but wrong key -> present:true, ok:false (does not match global or any record).
const d = server.optionalAgentApiKey(fakeReq({ "x-api-key": "fdl_live_does_not_exist_000" }));
check("invalid key -> present true", d.present === true);
check("invalid key -> ok false", d.ok === false);
check("invalid key -> sellerId null", d.sellerId === null);

// Empty bearer -> treated as absent.
const e = server.optionalAgentApiKey(fakeReq({ authorization: "Bearer " }));
check("empty bearer -> present false", e.present === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
