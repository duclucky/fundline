"use strict";

const https = require("https");

function parseBaseUrl(baseUrl) {
  const url = new URL(baseUrl);
  return {
    hostname: url.hostname,
    port: url.port || 443,
    basePath: url.pathname.replace(/\/$/, ""),
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requireConfig(config) {
  if (!config || !config.apiKey) throw new Error("CheapKeyAI API key is not configured");
  if (!config.baseUrl) throw new Error("CheapKeyAI base URL is not configured");
}

function requestJson(config, method, pathSuffix, body) {
  return new Promise((resolve, reject) => {
    const { hostname, port, basePath } = parseBaseUrl(config.baseUrl);
    const payload = body == null ? "" : JSON.stringify(body);
    const headers = {
      "Accept": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
    };
    if (payload) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(payload);
    }
    const request = https.request(
      { hostname, port, path: `${basePath}${pathSuffix}`, method, headers },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => resolve({ status: response.statusCode, body: responseBody }));
      },
    );
    const configured = Number(config.timeoutMs);
    const timeoutMs = Number.isFinite(configured) && configured > 0 ? configured : 300000;
    request.setTimeout(timeoutMs, () => request.destroy(new Error("CheapKeyAI request timed out")));
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function parseJson(result, label) {
  let parsed;
  try {
    parsed = JSON.parse(result.body || "{}");
  } catch {
    throw new Error(`CheapKeyAI ${label} returned invalid JSON`);
  }
  if (result.status < 200 || result.status >= 300) {
    const message = parsed && parsed.error && parsed.error.message
      ? parsed.error.message
      : "request failed";
    throw new Error(`CheapKeyAI ${label} ${result.status}: ${message}`);
  }
  return parsed;
}

async function callCheapKeyChat(config, params) {
  requireConfig(config);
  if (!params || !params.model) throw new Error("CheapKeyAI call needs a model id");
  const body = {
    model: params.model,
    messages: params.messages || [],
    max_tokens: params.maxTokens == null ? 4096 : params.maxTokens,
  };
  if (params.temperature != null) body.temperature = params.temperature;

  const maxRetries = params.maxRetries == null ? 5 : params.maxRetries;
  const retryBaseMs = params.retryBaseMs == null ? 1000 : Math.max(0, Number(params.retryBaseMs) || 0);
  let attempt = 0;
  while (attempt <= maxRetries) {
    let result;
    try {
      result = await requestJson(config, "POST", "/chat/completions", body);
    } catch (error) {
      attempt += 1;
      if (attempt > maxRetries) throw error;
      await sleep(Math.max(1, Math.floor(retryBaseMs / 2)) * Math.pow(2, attempt - 1));
      continue;
    }

    if (result.status === 429) {
      attempt += 1;
      if (attempt > maxRetries) throw new Error("CheapKeyAI rate limited (429) after retries");
      await sleep(retryBaseMs * Math.pow(2, attempt - 1));
      continue;
    }

    const parsed = parseJson(result, "API");
    const choice = parsed.choices && parsed.choices[0];
    return {
      content: choice && choice.message ? choice.message.content || "" : "",
      usage: parsed.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      model: parsed.model || params.model,
      raw: parsed,
    };
  }
  throw new Error("CheapKeyAI request failed");
}

async function listCheapKeyModels(config) {
  requireConfig(config);
  const parsed = parseJson(await requestJson(config, "GET", "/models"), "/models");
  const data = Array.isArray(parsed.data) ? parsed.data : [];
  return data.map((model) => String(model && model.id)).filter(Boolean);
}

async function getCheapKeyBalance(config) {
  requireConfig(config);
  const result = await requestJson(config, "GET", "/balance");
  const parsed = parseJson(result, "/balance");
  const data = parsed.data || {};
  return {
    status: result.status,
    remainingUsd: Number(data.user_balance || 0),
    usageUsd: Number(data.user_used_balance || 0),
    keyName: String(data.key_name || ""),
    keyUnlimitedQuota: Boolean(data.key_unlimited_quota),
    keyRemainQuota: Number(data.key_remain_quota || 0),
  };
}

async function getCheapKeyUsage(config, query = {}) {
  requireConfig(config);
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value != null && value !== "") params.set(key, String(value));
  });
  const suffix = params.toString() ? `/usage/logs?${params.toString()}` : "/usage/logs";
  const parsed = parseJson(await requestJson(config, "GET", suffix), "/usage/logs");
  const data = parsed.data || {};
  return {
    items: Array.isArray(data.items) ? data.items : [],
    total: Number(data.total || 0),
    page: Number(data.page || 1),
    pageSize: Number(data.page_size || 20),
    scope: String(data.scope || "key"),
  };
}

module.exports = {
  callCheapKeyChat,
  parseBaseUrl,
  listCheapKeyModels,
  getCheapKeyBalance,
  getCheapKeyUsage,
};
