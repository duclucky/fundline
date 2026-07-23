"use strict";

const assert = require("assert");
const { waitForConfirmation } = require("./run-escrow-client");

async function main() {
  const receipt = { status: 1 };
  assert.equal(await waitForConfirmation({
    wait: async (confirmations) => {
      assert.equal(confirmations, 1);
      return receipt;
    },
  }, { confirmations: 1, timeoutMs: 100 }), receipt);

  await assert.rejects(async () => {
    try {
      await waitForConfirmation({ wait: async () => new Promise(() => {}) }, {
        confirmations: 1,
        timeoutMs: 5,
      });
    } catch (error) {
      assert.equal(error.code, "transaction_confirmation_timeout");
      throw error;
    }
  }, /confirmation timed out/);
}

main().then(() => {
  console.log("PASS: run escrow confirmation wait");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
