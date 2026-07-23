"use strict";

const assert = require("assert");
const { EventEmitter } = require("events");
const https = require("https");
const { callV98Chat } = require("./v98-client");

async function main() {
  const originalRequest = https.request;
  let capturedTimeoutMs = 0;

  https.request = (_options, onResponse) => {
    const request = new EventEmitter();
    request.setTimeout = (timeoutMs) => { capturedTimeoutMs = timeoutMs; };
    request.write = () => {};
    request.end = () => {
      const response = new EventEmitter();
      response.statusCode = 200;
      onResponse(response);
      process.nextTick(() => {
        response.emit("data", JSON.stringify({
          model: "gpt-5.6-luna",
          choices: [{ message: { content: "ok" } }],
          usage: { total_tokens: 1 },
        }));
        response.emit("end");
      });
    };
    request.destroy = (error) => request.emit("error", error);
    return request;
  };

  try {
    const result = await callV98Chat({
      apiKey: "test-key",
      baseUrl: "https://v98store.com/v1",
      timeoutMs: 300000,
    }, {
      model: "gpt-5.6-luna",
      messages: [{ role: "user", content: "test" }],
      maxTokens: 32,
      maxRetries: 0,
    });
    assert.equal(result.content, "ok");
    assert.equal(capturedTimeoutMs, 300000);
    console.log("PASS: v98 client uses configured timeout");
  } finally {
    https.request = originalRequest;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
