"use strict";

const https = require("https");

// Minimal v98store (OpenAI-compatible) chat client. One key works for all models.
// POST {baseUrl}/chat/completions with Authorization: Bearer <apiKey>.
// Always pass max_tokens (Claude via the gateway requires it). Retries on 429.
// See .claude/skills/v98store-api for the integration contract.

function parseBaseUrl(baseUrl) {
  const u = new URL(baseUrl);
  return {
    hostname: u.hostname,
    port: u.port || 443,
    basePath: u.pathname.replace(/\/$/, ""),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function postChat(config, body) {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath } = parseBaseUrl(config.baseUrl);
    const payload = JSON.stringify(body);
    const request = https.request(
      {
        hostname,
        port,
        path: `${basePath}/chat/completions`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${config.apiKey}`,
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => {
          resolve({ status: response.statusCode, body: responseBody });
        });
      },
    );
    request.setTimeout(60000, () => {
      request.destroy(new Error("v98store request timed out"));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

// Calls chat completions and returns { content, usage, model, raw }.
// Retries up to maxRetries on HTTP 429 with exponential backoff.
async function callV98Chat(config, params) {
  if (!config || !config.apiKey) throw new Error("v98store API key is not configured");
  if (!params || !params.model) throw new Error("v98store call needs a model id");

  const body = {
    model: params.model,
    messages: params.messages || [],
    max_tokens: params.maxTokens != null ? params.maxTokens : 1024,
  };
  if (params.temperature != null) body.temperature = params.temperature;

  const maxRetries = params.maxRetries != null ? params.maxRetries : 5;
  let attempt = 0;
  let lastError = null;

  while (attempt <= maxRetries) {
    let result;
    try {
      result = await postChat(config, body);
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt > maxRetries) break;
      await sleep(500 * Math.pow(2, attempt - 1));
      continue;
    }

    if (result.status === 429) {
      attempt += 1;
      if (attempt > maxRetries) throw new Error("v98store rate limited (429) after retries");
      // Longer backoff for 429: web-search models rate-limit harder (1s,2s,4s,8s,16s).
      await sleep(1000 * Math.pow(2, attempt - 1));
      continue;
    }

    if (result.status < 200 || result.status >= 300) {
      throw new Error(`v98store API ${result.status}: ${result.body || "request failed"}`);
    }

    let parsed;
    try {
      parsed = JSON.parse(result.body || "{}");
    } catch {
      throw new Error("v98store returned invalid JSON");
    }

    const choice = parsed.choices && parsed.choices[0];
    const content = choice && choice.message ? choice.message.content : "";
    return {
      content: content || "",
      usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: parsed.model || params.model,
      raw: parsed,
    };
  }

  throw lastError || new Error("v98store request failed");
}

module.exports = { callV98Chat, parseBaseUrl };
