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

  // createContractExecution: path, headers, callData mode, defaults, returns challengeId
  {
    const fake = makeFake([{ status: 201, json: { data: { challengeId: "chal-tx" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const out = await c.createContractExecution({ userToken: "u", walletId: "wal1", contractAddress: "0xrouter", callData: "0xabcdef", amount: "0x0", refId: "ref-1" });
    const call = fake.calls[0];
    eq(call.method, "POST", "contractExecution POST");
    eq(call.path, "/v1/w3s/user/transactions/contractExecution", "contractExecution path");
    eq(call.headers["X-User-Token"], "u", "contractExecution user token");
    ok(UUID_RE.test(call.headers["X-Request-Id"]), "contractExecution has X-Request-Id uuid");
    ok(UUID_RE.test(call.body.idempotencyKey), "contractExecution idempotencyKey uuid");
    eq(call.body.contractAddress, "0xrouter", "contractExecution contractAddress");
    eq(call.body.callData, "0xabcdef", "contractExecution callData");
    eq(call.body.walletId, "wal1", "contractExecution walletId");
    eq(call.body.feeLevel, "MEDIUM", "contractExecution default feeLevel MEDIUM");
    eq(call.body.refId, "ref-1", "contractExecution refId");
    ok(!("amount" in call.body), "contractExecution omits amount when 0x0");
    eq(out.challengeId, "chal-tx", "contractExecution returns challengeId");
  }

  // createContractExecution with walletAddress falls back to address + blockchain
  {
    const fake = makeFake([{ status: 200, json: { data: { challengeId: "x" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    await c.createContractExecution({ userToken: "u", walletAddress: "0xabc", contractAddress: "0xr", callData: "0x01" });
    eq(fake.calls[0].body.walletAddress, "0xabc", "contractExecution uses walletAddress");
    eq(fake.calls[0].body.blockchain, DEFAULT_BLOCKCHAIN, "contractExecution sets blockchain with walletAddress");
    ok(!("walletId" in fake.calls[0].body), "contractExecution no walletId when using address");
  }

  // createContractExecution validation
  {
    const c = createCircleWalletClient({ apiKey: "k", request: makeFake([]).request });
    await throwsAsync(() => c.createContractExecution({ walletId: "w", contractAddress: "0xr", callData: "0x1" }), "contractExecution needs userToken");
    await throwsAsync(() => c.createContractExecution({ userToken: "u", walletId: "w", callData: "0x1" }), "contractExecution needs contractAddress");
    await throwsAsync(() => c.createContractExecution({ userToken: "u", walletId: "w", contractAddress: "0xr" }), "contractExecution needs callData");
    await throwsAsync(() => c.createContractExecution({ userToken: "u", contractAddress: "0xr", callData: "0x1" }), "contractExecution needs wallet id or address");
  }

  // listTransactions: path with refId, returns array
  {
    const txs = [{ id: "t1", txHash: "0xhh", state: "CONFIRMED", refId: "ref-9" }];
    const fake = makeFake([{ status: 200, json: { data: { transactions: txs } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const list = await c.listTransactions({ userToken: "u", refId: "ref-9" });
    eq(fake.calls[0].method, "GET", "listTransactions GET");
    eq(fake.calls[0].path, "/v1/w3s/transactions?refId=ref-9", "listTransactions path with refId");
    eq(list.length, 1, "listTransactions returns array");
    eq(list[0].txHash, "0xhh", "listTransactions txHash");
  }

  // restorePin: path, user token, idempotencyKey, returns challengeId
  {
    const fake = makeFake([{ status: 200, json: { data: { challengeId: "chal-restore" } } }]);
    const c = createCircleWalletClient({ apiKey: "k", request: fake.request });
    const out = await c.restorePin({ userToken: "u" });
    eq(fake.calls[0].method, "POST", "restorePin POST");
    eq(fake.calls[0].path, "/v1/w3s/user/pin/restore", "restorePin path");
    eq(fake.calls[0].headers["X-User-Token"], "u", "restorePin user token");
    ok(UUID_RE.test(fake.calls[0].body.idempotencyKey), "restorePin idempotencyKey uuid");
    eq(out.challengeId, "chal-restore", "restorePin returns challengeId");
  }
  await throwsAsync(() => createCircleWalletClient({ apiKey: "k", request: makeFake([]).request }).restorePin({}), "restorePin needs userToken");

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
