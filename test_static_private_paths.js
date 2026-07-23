"use strict";

const assert = require("assert");
const fs = require("fs");

process.env.FUNDLINE_NO_LISTEN = "1";
const server = require("./server");

assert.equal(typeof server.isPrivateStaticPath, "function");
assert.equal(server.isPrivateStaticPath("/docs/superpowers/specs/internal.md"), true);
assert.equal(server.isPrivateStaticPath("/docs/superpowers"), true);
assert.equal(server.isPrivateStaticPath("/docs.html"), false);

const deploy = fs.readFileSync(".github/workflows/deploy.yml", "utf8");
assert.equal(deploy.includes("**/docs/superpowers/**"), true);

console.log("PASS: internal design docs are not deployable or statically served");
