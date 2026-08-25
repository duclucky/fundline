"use strict";

const assert = require("assert");
const fs = require("fs");

const server = fs.readFileSync("server.js", "utf8");
const env = fs.readFileSync(".env.example", "utf8");
const provider = fs.readFileSync("workflow-model-provider.js", "utf8");

assert(server.includes('require("./cheapkey-client")'));
assert(server.includes('require("./cheapkey-models")'));
assert(server.includes("process.env.CHEAPKEYAI_API_KEY || process.env.WORKFLOW_FINAL_API_KEY"));
assert(server.includes('"https://cheapkeyai.shop/v1"'));
assert(server.includes("CHEAPKEYAI_TIMEOUT_MS"));
assert(server.includes("CHEAPKEYAI_GROUP_RATIO"));
assert(server.includes("getCheapKeyModelSet"));
assert(server.includes("getCheapKeyBalanceCached"));
assert.equal(server.includes("V98STORE_"), false);
assert.equal(server.includes("v98Client"), false);
assert.equal(server.includes("v98Models"), false);
assert(env.includes("CHEAPKEYAI_API_KEY="));
assert(env.includes("CHEAPKEYAI_BASE_URL=https://cheapkeyai.shop/v1"));
assert(env.includes("CHEAPKEYAI_GROUP_RATIO=1"));
assert(env.includes("CHEAPKEYAI_TIMEOUT_MS=300000"));
assert.equal(env.includes("V98STORE_"), false);
assert.equal(provider.includes("v98"), false);

const activeFiles = [
  "server.js",
  "model-cost.js",
  "workflow-engine.js",
  "workflow-research.js",
  "workflow-cvgig.js",
  "workflow-cryptodd.js",
  "workflow-docgen.js",
  "workflow-defs.js",
];
const optionalLocalScripts = [
  "estimate-workflow-cost.js",
  "measure-all.js",
  "measure-cryptodd.js",
  "measure-cvgig.js",
  "measure-real-cost.js",
  "run-workflow-once.js",
];
const activeSource = activeFiles.concat(optionalLocalScripts.filter((file) => fs.existsSync(file)))
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
["v98store", "V98STORE_", "v98Client", "v98Models", "callV98", "listV98", "getV98"].forEach((pattern) => {
  assert.equal(activeSource.includes(pattern), false, `active source still contains ${pattern}`);
});
[
  "v98-client.js",
  "v98-models.js",
  "test_v98_client_timeout.js",
  "test_v98_cost.js",
].forEach((file) => assert.equal(fs.existsSync(file), false, `${file} should be removed`));

const guidanceFiles = [
  "AGENTS.md",
  ".agents/skills/create-workflow/SKILL.md",
  ".agents/skills/cheapkeyai-api/SKILL.md",
];
guidanceFiles.forEach((file) => assert(fs.existsSync(file), `${file} should exist`));
const guidance = guidanceFiles.map((file) => fs.readFileSync(file, "utf8")).join("\n");
assert(guidance.includes("CheapKeyAI"));
assert.equal(/v98store|V98STORE_|v98Models|v98-client|v98-models/i.test(guidance), false);

console.log("PASS: server configuration uses only CheapKeyAI");
