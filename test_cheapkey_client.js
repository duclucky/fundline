"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const https = require("https");
const client = require("./cheapkey-client");

function installMock(responses) {
  const calls = [];
  const original = https.request;
  https.request = (options, onResponse) => {
    const call = { options, body: "", timeoutMs: 0 };
    calls.push(call);
    const request = new EventEmitter();
    request.setTimeout = (value) => { call.timeoutMs = value; };
    request.write = (chunk) => { call.body += String(chunk); };
    request.destroy = (error) => request.emit("error", error);
    request.end = () => {
      const next = responses.shift();
      const response = new EventEmitter();
      response.statusCode = next.status;
      onResponse(response);
      process.nextTick(() => {
        response.emit("data", typeof next.body === "string" ? next.body : JSON.stringify(next.body));
        response.emit("end");
      });
    };
    return request;
  };
  return { calls, restore: () => { https.request = original; } };
}

async function testContract() {
  const mock = installMock([
    { status: 200, body: { model: "gpt-5.6-luna", choices: [{ message: { content: "ok" } }], usage: { prompt_tokens: 2, completion_tokens: 3, total_tokens: 5 } } },
    { status: 200, body: { data: [{ id: "gpt-5.6-luna" }, { id: "gpt-4o-mini" }] } },
    { status: 200, body: { success: true, data: { user_balance: 12.5, user_used_balance: 3.25, key_name: "Fundline", key_unlimited_quota: true, key_remain_quota: 0 } } },
    { status: 200, body: { success: true, data: { items: [{ model_name: "gpt-5.6-luna", quota: 10 }], total: 1, page: 1, page_size: 20, scope: "key" } } },
  ]);
  const config = { apiKey: "test-key", baseUrl: "https://cheapkeyai.shop/v1", timeoutMs: 300000 };
  try {
    const chat = await client.callCheapKeyChat(config, {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 32,
      maxRetries: 0,
    });
    assert.equal(chat.content, "ok");
    assert.equal(mock.calls[0].options.path, "/v1/chat/completions");
    assert.equal(mock.calls[0].options.headers.Authorization, "Bearer test-key");
    assert.equal(mock.calls[0].timeoutMs, 300000);
    assert.deepEqual(JSON.parse(mock.calls[0].body), {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "test" }],
      max_tokens: 32,
    });
    assert.deepEqual(await client.listCheapKeyModels(config), ["gpt-5.6-luna", "gpt-4o-mini"]);
    assert.deepEqual(await client.getCheapKeyBalance(config), {
      status: 200,
      remainingUsd: 12.5,
      usageUsd: 3.25,
      keyName: "Fundline",
      keyUnlimitedQuota: true,
      keyRemainQuota: 0,
    });
    assert.deepEqual(await client.getCheapKeyUsage(config), {
      items: [{ model_name: "gpt-5.6-luna", quota: 10 }],
      total: 1,
      page: 1,
      pageSize: 20,
      scope: "key",
    });
    assert.equal(mock.calls[3].options.path, "/v1/usage/logs");
  } finally {
    mock.restore();
  }
}

async function testErrorsAndRetry() {
  await assert.rejects(
    () => client.callCheapKeyChat({ apiKey: "", baseUrl: "https://cheapkeyai.shop/v1" }, { model: "gpt-4o-mini" }),
    /CheapKeyAI API key is not configured/,
  );
  await assert.rejects(
    () => client.callCheapKeyChat({ apiKey: "x", baseUrl: "" }, { model: "gpt-4o-mini" }),
    /CheapKeyAI base URL is not configured/,
  );

  const unauthorized = installMock([{ status: 401, body: { error: { message: "Invalid token" } } }]);
  try {
    await assert.rejects(
      () => client.callCheapKeyChat({ apiKey: "x", baseUrl: "https://cheapkeyai.shop/v1" }, { model: "gpt-4o-mini", maxRetries: 0 }),
      /CheapKeyAI API 401: Invalid token/,
    );
  } finally {
    unauthorized.restore();
  }

  const limited = installMock([
    { status: 429, body: { error: { message: "slow down" } } },
    { status: 200, body: { choices: [{ message: { content: "recovered" } }], usage: {} } },
  ]);
  try {
    const recovered = await client.callCheapKeyChat(
      { apiKey: "x", baseUrl: "https://cheapkeyai.shop/v1" },
      { model: "gpt-4o-mini", maxRetries: 1, retryBaseMs: 1 },
    );
    assert.equal(recovered.content, "recovered");
    assert.equal(limited.calls.length, 2);
  } finally {
    limited.restore();
  }
}

async function main() {
  await testContract();
  await testErrorsAndRetry();
  console.log("PASS: CheapKeyAI client contract, errors, and retry");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
