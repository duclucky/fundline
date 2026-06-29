"use strict";

// v98store model registry: maps workflow step labels to the real v98store model
// id, and holds the per-model price (USD per 1M tokens, Default group = 1x).
// Single source of truth for ids and prices. See .claude/skills/v98store-api.
// Prices confirmed from https://v98store.com/prices on 2026-06-28.
// Adapted provider contract; v98store is OpenAI-compatible.

// Real model id -> price in USD per 1,000,000 tokens.
// Prices confirmed from https://v98store.com/prices on 2026-06-28 where available;
// newer models use approximate market rates -- update when confirmed from dashboard.
const V98_MODELS = {
  // GPT series
  "gpt-4o-mini": { inputPer1M: 0.425, outputPer1M: 1.70 },
  "gpt-4.1-mini": { inputPer1M: 1.13, outputPer1M: 4.53 },
  "gpt-4.1": { inputPer1M: 2.00, outputPer1M: 8.00 },
  "gpt-4o": { inputPer1M: 2.50, outputPer1M: 10.00 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.00 },
  "gpt-5-nano": { inputPer1M: 0.10, outputPer1M: 0.40 },
  "gpt-5": { inputPer1M: 15.00, outputPer1M: 60.00 },
  // DeepSeek series
  "deepseek-v3": { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-v3-0324": { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-v3.1": { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-v3.2": { inputPer1M: 0.764, outputPer1M: 3.11 },
  "deepseek-v4-flash": { inputPer1M: 0.20, outputPer1M: 0.80 },
  "deepseek-v4-pro": { inputPer1M: 0.50, outputPer1M: 2.00 },
  "deepseek-chat": { inputPer1M: 0.27, outputPer1M: 1.10 },
  "deepseek-r1": { inputPer1M: 1.557, outputPer1M: 6.198 },
  "deepseek-r1-0528": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "deepseek-r1-searching": { inputPer1M: 0.55, outputPer1M: 2.19 },
  "deepseek-reasoner": { inputPer1M: 0.55, outputPer1M: 2.19 },
  // Grok series (xAI)
  "grok-3": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "grok-3-mini": { inputPer1M: 0.30, outputPer1M: 0.50 },
  "grok-3-deepsearch": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "grok-4": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "grok-4-fast": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "grok-4.1": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "grok-4.2": { inputPer1M: 3.00, outputPer1M: 15.00 },
  // Qwen series (Alibaba)
  "qwen-turbo": { inputPer1M: 0.05, outputPer1M: 0.20 },
  "qwen-plus": { inputPer1M: 0.40, outputPer1M: 1.20 },
  "qwen-max": { inputPer1M: 1.60, outputPer1M: 6.40 },
  "qwen3-8b": { inputPer1M: 0.05, outputPer1M: 0.20 },
  "qwen3-30b-a3b": { inputPer1M: 0.20, outputPer1M: 0.60 },
  "qwen3-32b": { inputPer1M: 0.30, outputPer1M: 1.20 },
  "qwen3-max": { inputPer1M: 1.60, outputPer1M: 6.40 },
  "qwen3-235b-a22b": { inputPer1M: 0.50, outputPer1M: 2.20 },
  // Kimi (Moonshot AI)
  "kimi-k2": { inputPer1M: 0.50, outputPer1M: 2.50 },
  "kimi-k2.5": { inputPer1M: 0.50, outputPer1M: 2.50 },
  "kimi-k2.6": { inputPer1M: 0.50, outputPer1M: 2.50 },
  "kimi-k2.7-code": { inputPer1M: 1.42, outputPer1M: 7.08 },
  // OpenAI web-search models (live browsing). perCallUsd is the web-search tool
  // surcharge per request, which dominates the token cost; confirm against the
  // v98 dashboard. These return real source URLs.
  "gpt-4o-mini-search-preview": { inputPer1M: 0.15, outputPer1M: 0.60, perCallUsd: 0.027 },
  "gpt-4o-search-preview": { inputPer1M: 2.50, outputPer1M: 10.00, perCallUsd: 0.035 },
  "gpt-5-search-api": { inputPer1M: 1.25, outputPer1M: 10.00, perCallUsd: 0.03 },
  // Claude series
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-opus-4-8": { inputPer1M: 15.00, outputPer1M: 75.00 },
};

// Friendly labels used in the workflow definitions -> real v98store model id.
// Claude ids REQUIRE the date suffix, so labels must be mapped before any call.
const LABEL_TO_ID = {
  "gpt-4.1-mini": "gpt-4.1-mini",
  "gpt-4o-mini": "gpt-4o-mini",
  "deepseek-v3.2": "deepseek-v3.2",
  "deepseek-r1": "deepseek-r1",
  "grok-3-deepsearch": "grok-3-deepsearch",
  "kimi-k2": "kimi-k2",
  "qwen3-max": "qwen3-max",
  "claude-3-haiku": "claude-3-haiku-20240307",
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
};

function resolveModelId(label) {
  const key = String(label || "").trim();
  if (LABEL_TO_ID[key]) return LABEL_TO_ID[key];
  if (V98_MODELS[key]) return key;
  return key; // unknown: return as-is; caller decides whether to reject
}

function getPrice(modelId) {
  return V98_MODELS[modelId] || null;
}

// Cost of one call in integer micro-USD. groupRatio scales the Default price
// (v98store NewAPI markup; confirm the key group, default 1x).
// micro-USD = (promptTokens * inputPer1M + completionTokens * outputPer1M) * groupRatio
// (the /1e6 from "per 1M" cancels the *1e6 conversion to micro-USD).
// Returns null for an unknown model id so the caller can decide how to handle it.
function computeCostMicros(modelId, promptTokens, completionTokens, groupRatio) {
  const price = V98_MODELS[modelId];
  if (!price) return null;
  const ratio = Number(groupRatio) > 0 ? Number(groupRatio) : 1;
  const pt = Math.max(0, Number(promptTokens) || 0);
  const ct = Math.max(0, Number(completionTokens) || 0);
  // Some models (web search) charge a per-request surcharge on top of tokens.
  const perCall = price.perCallUsd ? price.perCallUsd * 1000000 : 0;
  const micros = (pt * price.inputPer1M + ct * price.outputPer1M + perCall) * ratio;
  return Math.round(micros);
}

module.exports = {
  V98_MODELS,
  LABEL_TO_ID,
  resolveModelId,
  getPrice,
  computeCostMicros,
};
