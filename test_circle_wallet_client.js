"use strict";

// Offline tests for circle-wallet-client.js. Injects a fake request so no network is touched.
// Run: node test_circle_wallet_client.js

const { createCircleWalletClient, newIdempotencyKey, DEFAULT_BLOCKCHAIN, DEFAULT_ACCOUNT_TYPE } = require("./circle-wallet-client");

let passed = 0;
let failed = 0;
function ok(cond, name) {
  if (cond) { passed += 1; } else { failed += 1; console.error("FAIL: " + name); }
}
function eq(a, b, name) { ok(a === b, name + " (got " + JSON.stringify(a) + ")"); }
async function throwsAsync(fn, name) {
  try { await fn(); ok(false, name + " (did not throw)"); } catch { ok(true, name); }
}

// Fake request: records the last call and returns the next queued response ({status, json}).
function makeFake(responses) {
  const calls = [];
  let i = 0;
  const request = async (args) => {
    calls.push(args);
    const r = responses[i] || responses[responses.length - 1] || { status: 200, json: { data: {} } };
    i += 1;
    return r;
  };
  return { request, calls };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

(async () => {
  // available()
  ok(createCircleWalletClient({ apiKey: "k" }).available() === true, "available true with key");
  ok(createCircleWalletClient({}).available() === false, "available false without key");

  // defaults exposed
  eq(createCircleWalletClient({ apiKey: "k" }).blockchain, DEFAULT_BLOCKCHAIN, "default blockchain ARC-TESTNET");
  eq(createCircleWalletClient({ apiKey: "k" }).accountType, DEFAULT_ACCOUNT_TYPE, "default accountType SCA");

  // idempotency key is a UUID
  ok(UUID_RE.test(newIdempotencyKey()), "idempotency key is a uuid");

  // createEmailDeviceToken: path, method, auth, body, trims email, returns data
  {
    const fake = makeFake([{ status: 200, json: { data: { deviceToken: "dt", deviceEncryptionKey: "dk", otpToken: "ot" } } }]);
    const c = createCircleWalletClient({ apiKey: "test-key", request: fake.request });
    const out = await c.createEmailDeviceToken({ deviceId: "dev1", email: "  User@Fund.xyz " });
    const call = fake.calls[0];
    eq(call.method, "POST", "email token method POST");
    eq(call.path, "/v1/w3s/users/email/token", "email token path");
    eq(call.headers.Authorization, "Bearer test-key", "email token Bearer auth");
    ok(!call.headers["X-User-Token"], "email token has no user token header");
    ok(UUID_RE.test(call.body.idempotencyKey), "email token body has uuid idempotencyKey");
    eq(call.body.deviceId, "dev1", "email token deviceId");
    eq(call.body.email, "User@Fund.xyz", "email token email trimmed");
    eq(out.deviceToken, "dt", "email token returns deviceToken");
    eq(out.otpToken, "ot", "email token returns otpToken");
  }

  // createEmailDeviceToken validation
  {
    const c = createCircleWalletClient({ apiKey: "k", request: makeFake([]).request });
    await throwsAsync(() => c.createEmailDeviceToken({ email: "a@b.c" }), "email token needs deviceId");
    await throwsAsync(() => c.createEmailDeviceToken({ deviceId: "d" }), "email token needs email");
  }

  // initializeWallet: path, user token header, body blockchains + accountType, returns challengeId
  {
    const fake = makeFake([{ status: 201, json: { data: { challengeId: "chal-1" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const out = await c.initializeWallet({ userToken: "utok" });
    const call = fake.calls[0];
    eq(call.method, "POST", "initialize method POST");
    eq(call.path, "/v1/w3s/user/initialize", "initialize path");
    eq(call.headers["X-User-Token"], "utok", "initialize sends user token");
    eq(call.body.blockchains[0], DEFAULT_BLOCKCHAIN, "initialize blockchain ARC-TESTNET");
    eq(call.body.accountType, DEFAULT_ACCOUNT_TYPE, "initialize accountType SCA");
    ok(UUID_RE.test(call.body.idempotencyKey), "initialize has uuid idempotencyKey");
    eq(out.challengeId, "chal-1", "initialize returns challengeId");
  }
  await throwsAsync(
    () => createCircleWalletClient({ apiKey: "k", request: makeFake([]).request }).initializeWallet({}),
    "initialize needs userToken",
  );

  // custom blockchain / accountType respected
  {
    const fake = makeFake([{ status: 200, json: { data: { challengeId: "x" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", blockchain: "ETH-SEPOLIA", accountType: "EOA", request: fake.request });
    await c.initializeWallet({ userToken: "u" });
    eq(fake.calls[0].body.blockchains[0], "ETH-SEPOLIA", "custom blockchain respected");
    eq(fake.calls[0].body.accountType, "EOA", "custom accountType respected");
  }

  // listWallets + getPrimaryWallet
  {
    const wallets = [
      { id: "w1", address: "0xaaa", blockchain: "ETH-SEPOLIA", accountType: "SCA" },
      { id: "w2", address: "0xbbb", blockchain: "ARC-TESTNET", accountType: "SCA" },
    ];
    const fake = makeFake([{ status: 200, json: { data: { wallets } } }, { status: 200, json: { data: { wallets } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const list = await c.listWallets({ userToken: "u" });
    eq(fake.calls[0].method, "GET", "listWallets GET");
    eq(fake.calls[0].path, "/v1/w3s/wallets", "listWallets path");
    eq(list.length, 2, "listWallets returns array");
    const primary = await c.getPrimaryWallet({ userToken: "u" });
    eq(primary.address, "0xbbb", "getPrimaryWallet picks ARC-TESTNET wallet");
    eq(primary.id, "w2", "getPrimaryWallet id");
  }

  // getPrimaryWallet returns null when no wallets
  {
    const fake = makeFake([{ status: 200, json: { data: { wallets: [] } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const primary = await c.getPrimaryWallet({ userToken: "u" });
    eq(primary, null, "getPrimaryWallet null when empty");
  }

  // createUserToken
  {
    const fake = makeFake([{ status: 200, json: { data: { userToken: "ut", encryptionKey: "ek" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const out = await c.createUserToken({ userId: "uid-1" });
    eq(fake.calls[0].path, "/v1/w3s/users/token", "createUserToken path");
    eq(fake.calls[0].body.userId, "uid-1", "createUserToken body userId");
    eq(out.userToken, "ut", "createUserToken returns userToken");
  }

  // getTransaction
  {
    const fake = makeFake([{ status: 200, json: { data: { transaction: { id: "tx1", state: "COMPLETE", txHash: "0xhash" } } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const tx = await c.getTransaction({ userToken: "u", id: "tx1" });
    eq(fake.calls[0].path, "/v1/w3s/transactions/tx1", "getTransaction path with id");
    eq(tx.txHash, "0xhash", "getTransaction returns transaction");
  }

  // error mapping: non-2xx throws with Circle message
  {
    const fake = makeFake([{ status: 401, json: { message: "Malformed authorization" } }]);
    const c = createCircleWalletClient({ apiKey: "bad", request: fake.request });
    await throwsAsync(() => c.listWallets({ userToken: "u" }), "non-2xx throws");
    try { await c.listWallets({ userToken: "u" }); } catch (e) { ok(/401/.test(e.message) && /Malformed/.test(e.message), "error carries status + message"); }
  }

  // no api key -> throws not configured
  {
    const c = createCircleWalletClient({ request: makeFake([{ status: 200, json: { data: {} } }]).request });
    await throwsAsync(() => c.listWallets({ userToken: "u" }), "no api key throws");
  }

  console.log(`\ncircle-wallet-client: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
