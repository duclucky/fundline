"use strict";

const assert = require("assert");
const fs = require("fs");

const source = fs.readFileSync("workflows.js", "utf8");

assert.match(source, /function workflowFileAvailable\(file\)/);
assert.match(source, /file\.url\s*\|\|\s*file\.base64/);
assert.doesNotMatch(source, /if \(file && file\.base64\)/);
assert.doesNotMatch(source, /if \(data\.file && data\.file\.base64\)/);
assert.match(source, /file:\s*historyWorkflowFile\(result\.file\)/);
assert.match(source, /artifacts:\s*historyWorkflowArtifacts\(result\.artifacts\)/);
assert.match(source, /file:\s*historyWorkflowFile\(data\.file\)/);
assert.match(source, /openResultModal\(run\.output,\s*run\.slug,\s*run\.cvJson,\s*run\.file\)/);

console.log("PASS: workflow PDF UI contract");
