"use strict";

const assert = require("assert");
const { resolveDocTtlMs, TTL_MS } = require("./doc-store");

const hour = 60 * 60 * 1000;
assert.equal(resolveDocTtlMs({}), 168 * hour);
assert.equal(resolveDocTtlMs({ WORKFLOW_JOB_RESULT_TTL_HOURS: "240" }), 240 * hour);
assert.equal(resolveDocTtlMs({
  WORKFLOW_JOB_RESULT_TTL_HOURS: "168",
  WORKFLOW_DOC_TTL_HOURS: "48",
}), 168 * hour);
assert.equal(resolveDocTtlMs({
  WORKFLOW_JOB_RESULT_TTL_HOURS: "168",
  WORKFLOW_DOC_TTL_HOURS: "336",
}), 336 * hour);
assert.equal(TTL_MS >= 168 * hour, true);

console.log("PASS: document store retention");
