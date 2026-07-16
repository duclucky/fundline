"use strict";

// Standalone test for the webhook SSRF guard (ipIsBlocked / hostnameIsBlocked /
// normalizeWebhookUrl). Run: node test_ssrf_guard.js
const { ipIsBlocked, hostnameIsBlocked, normalizeWebhookUrl } = require("./server");

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log((ok ? "PASS" : "FAIL") + " - " + label + " (got " + actual + ", want " + expected + ")");
}

// IPs that MUST be blocked.
[
  "127.0.0.1", "0.0.0.0", "10.0.0.5", "172.16.0.1", "172.31.255.255",
  "192.168.1.1", "169.254.169.254", "100.64.0.1", "192.0.0.1",
  "198.18.0.1", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "ff02::1",
  "::ffff:127.0.0.1", "::ffff:10.0.0.1",
].forEach((ip) => check("block IP " + ip, ipIsBlocked(ip), true));

// Public IPs that MUST be allowed.
[
  "8.8.8.8", "1.1.1.1", "172.15.0.1", "172.32.0.1", "192.169.0.1",
  "100.63.255.255", "100.128.0.1", "2606:4700:4700::1111",
].forEach((ip) => check("allow IP " + ip, ipIsBlocked(ip), false));

// Hostnames that MUST be blocked.
[
  "localhost", "foo.localhost", "printer.local", "svc.internal",
  "127.0.0.1", "10.1.2.3", "[::1]", "169.254.169.254",
].forEach((h) => check("block host " + h, hostnameIsBlocked(h), true));

// Public hostnames that MUST be allowed (DNS names validated later at send time).
[
  "example.com", "hooks.slack.com", "api.fundline.xyz", "8.8.8.8-nope.example.com",
].forEach((h) => check("allow host " + h, hostnameIsBlocked(h), false));

// normalizeWebhookUrl end-to-end.
function rejects(url) {
  try { normalizeWebhookUrl(url); return false; } catch { return true; }
}
check("reject http://localhost/hook", rejects("http://localhost/hook"), true);
check("reject http://127.0.0.1:5190/x", rejects("http://127.0.0.1:5190/x"), true);
check("reject http://169.254.169.254/latest/meta-data", rejects("http://169.254.169.254/latest/meta-data"), true);
check("reject ftp://example.com/x", rejects("ftp://example.com/x"), true);
check("reject not-a-url", rejects("not-a-url"), true);
check("accept https://hooks.example.com/h", rejects("https://hooks.example.com/h"), false);

if (failures) {
  console.error("\n" + failures + " test(s) FAILED");
  process.exit(1);
}
console.log("\nAll SSRF guard tests passed.");
