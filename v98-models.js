"use strict";

// v98store model registry: maps workflow step labels to the real v98store model
// id, and holds the per-model price (USD per 1M tokens, Default group = 1x).
// Single source of truth for ids and prices. See .claude/skills/v98store-api.
// Prices confirmed from https://v98store.com/prices on 2026-06-28.
// Adapted provider contract; v98store is OpenAI-compatible.

// Real model id -> price in USD per 1,000,000 tokens.
const V98_MODELS = {
  "gpt-4.1-mini": { inputPer1M: 0.40, outputPer1M: 1.60 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-5-mini": { inputPer1M: 0.25, outputPer1M: 2.00 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "claude-haiku-4-5-20251001": { inputPer1M: 1.00, outputPer1M: 5.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
};

// Friendly labels used in the workflow definitions -> real v98store model id.
// Claude ids REQUIRE the date suffix, so labels must be mapped before any call.
const LABEL_TO_ID = {
  "gpt-4.1-mini": "gpt-4.1-mini",
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
  const micros = (pt * price.inputPer1M + ct * price.outputPer1M) * ratio;
  return Math.round(micros);
}

module.exports = {
  V98_MODELS,
  LABEL_TO_ID,
  resolveModelId,
  getPrice,
  computeCostMicros,
};
