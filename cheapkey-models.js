"use strict";

// CheapKeyAI model registry. Prices are USD per 1,000,000 tokens before
// provider-group adjustments, verified in the CheapKeyAI dashboard on 2026-08-25.
const CHEAPKEY_MODELS = {
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.60 },
  "gpt-4.1-mini": { inputPer1M: 0.40, outputPer1M: 1.60 },
  "deepseek-v3": { inputPer1M: 2.00, outputPer1M: 8.00 },
  "deepseek-v3.2": { inputPer1M: 2.00, outputPer1M: 3.00 },
  "deepseek-r1": { inputPer1M: 4.00, outputPer1M: 16.00 },
  "kimi-k2.7-code": { inputPer1M: 6.50, outputPer1M: 27.00 },
  "claude-sonnet-4-6": { inputPer1M: 3.00, outputPer1M: 15.00 },
  "gpt-5.6-luna": { inputPer1M: 0.20, outputPer1M: 1.20 },
  "gpt-5.6-terra": { inputPer1M: 2.00, outputPer1M: 12.00 },
  "gpt-5.6-sol": { inputPer1M: 5.00, outputPer1M: 30.00 },
  "cheap-5.6-terra": { inputPer1M: 2.00, outputPer1M: 12.00 },
  "cheap-5.6-sol": { inputPer1M: 5.00, outputPer1M: 30.00 },
  "claude-3-haiku-20240307": { inputPer1M: 0.25, outputPer1M: 1.25 },
  "claude-3-5-sonnet-20241022": { inputPer1M: 3.00, outputPer1M: 15.00 },
};

const LABEL_TO_ID = {
  "claude-3-haiku": "claude-3-haiku-20240307",
  "claude-3.5-sonnet": "claude-3-5-sonnet-20241022",
};

function resolveModelId(label) {
  const key = String(label || "").trim();
  return LABEL_TO_ID[key] || key;
}

function getPrice(modelId) {
  return CHEAPKEY_MODELS[String(modelId || "")] || null;
}

// Prices per 1M tokens become micro-USD directly when multiplied by token counts.
function computeCostMicros(modelId, promptTokens, completionTokens, groupRatio) {
  const price = getPrice(modelId);
  if (!price) return null;
  const ratio = Number(groupRatio) > 0 ? Number(groupRatio) : 1;
  const prompt = Math.max(0, Number(promptTokens) || 0);
  const completion = Math.max(0, Number(completionTokens) || 0);
  return Math.round((prompt * price.inputPer1M + completion * price.outputPer1M) * ratio);
}

module.exports = {
  CHEAPKEY_MODELS,
  LABEL_TO_ID,
  resolveModelId,
  getPrice,
  computeCostMicros,
};
