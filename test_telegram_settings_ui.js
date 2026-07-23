"use strict";

const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("app.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

assert.match(html, /id="telegramLinkStatus"/);
assert.match(html, />Send test message</);
assert.doesNotMatch(html, />Verify Telegram</);
assert.match(app, /telegramLinkStatus/);
assert.match(app, /Send \/start in Telegram to finish linking\./);
assert.match(app, /Test message delivered to Telegram\./);
assert.doesNotMatch(server, /Your payment alerts are active\./);
assert.doesNotMatch(server, /Fundline is connected\./);

console.log("PASS: Telegram settings UI contract");
