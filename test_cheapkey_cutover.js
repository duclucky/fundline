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

console.log("PASS: server configuration uses only CheapKeyAI");
