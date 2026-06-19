// Smoke test for the Phase 0 Telegram long-poll rewrite.
//
// Phase 0 replaced the fixed 8s setInterval short-poll with a self-rescheduling
// long-poll (getUpdates timeout=25) and added a callback_query branch. The poll
// loop runs inside the single server process, so the regression risk is that a
// rewrite bug (or a failing poll) takes the whole HTTP server down.
//
// What this guards:
//   1. The server still boots and serves /api/config after the rewrite.
//   2. startTelegramPolling ran the new path ("starting polling..." in stdout).
//   3. With a bad token the poll fails on every cycle, yet the self-rescheduling
//      error-backoff path keeps the process alive (/api/config still responds).
//
// It uses a clearly fake bot token so the loop exercises its failure path; the
// assertion holds whether getUpdates returns 401 (network up) or errors out
// (network down), since both route through the same backoff-and-reschedule.
//
// Run: node test_telegram_longpoll.js  (starts server.js on a private port)

const { spawn } = require("child_process");
const path = require("path");

const ROOT = __dirname;
const PORT = 5198;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ok   -", msg);
  } else {
    failed++;
    console.error("  FAIL -", msg);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function configOk() {
  try {
    const r = await fetch(`${BASE}/api/config`);
    return Boolean(r && r.status === 200);
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await configOk()) return true;
    await sleep(150);
  }
  return false;
}

async function main() {
  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      HOST: "127.0.0.1",
      // Fake token: forces startTelegramPolling to run and the poll to fail,
      // exercising the self-rescheduling backoff without a valid Telegram bot.
      TELEGRAM_BOT_TOKEN: "111111:FAKE-telegram-token-for-smoke-test",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d.toString()));
  child.stderr.on("data", (d) => (stderr += d.toString()));

  try {
    const up = await waitForServer();
    assert(up, "server boots and /api/config returns 200 after the long-poll rewrite");
    if (!up) {
      console.error("Server did not start. stderr:\n" + stderr);
      return;
    }

    assert(stdout.includes("Telegram bot: starting polling"), "startTelegramPolling ran the rewritten path");

    // Wait past one long-poll/backoff cycle (error path reschedules after 3s).
    await sleep(3500);
    const stillUp = await configOk();
    assert(stillUp, "server survives failing poll cycles (self-rescheduling loop does not crash the process)");
  } catch (err) {
    console.error("Test threw:", err);
    failed++;
  } finally {
    child.kill();
    await sleep(300);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
