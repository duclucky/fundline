"use strict";

const assert = require("assert");
const {
  pollPaymentVerification,
  fetchWithTimeout,
} = require("./payment-verification");

async function main() {
  let now = 0;
  const events = [];
  const result = await pollPaymentVerification({
    attempt: async (attempt) => {
      events.push("attempt:" + attempt);
      return attempt === 3;
    },
    wait: async (ms) => {
      events.push("wait:" + ms);
      now += ms;
    },
    now: () => now,
    retryDelayMs: 2000,
    deadlineMs: 60000,
  });
  assert.equal(result.verified, true);
  assert.deepEqual(events, ["attempt:1", "wait:2000", "attempt:2", "wait:2000", "attempt:3"]);

  now = 0;
  let attempts = 0;
  await assert.rejects(() => pollPaymentVerification({
    attempt: async () => {
      attempts += 1;
      const error = new Error("request timed out");
      error.code = "verification_timeout";
      throw error;
    },
    wait: async () => {
      throw new Error("must not wait after timeout");
    },
    now: () => now,
    retryDelayMs: 2000,
    deadlineMs: 60000,
  }), /request timed out/);
  assert.equal(attempts, 1);

  let capturedSignal;
  await assert.rejects(() => fetchWithTimeout(
    (_input, init) => {
      capturedSignal = init.signal;
      return new Promise((resolve, reject) => {
        init.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      });
    },
    "/slow",
    {},
    5,
  ), /timed out/);
  assert.equal(capturedSignal.aborted, true);
}

main().then(() => {
  console.log("PASS: payment verification polling");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
