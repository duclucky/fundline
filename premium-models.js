"use strict";

// Premium final-node models served by the separate cheapkey endpoint (WORKFLOW_FINAL_*),
// NOT v98store. Different provider and billing account, so these are kept out of
// v98-models.js on purpose: the v98 price registry stays v98-only. Prices are USD per 1M
// tokens from the cheapkey price table; input and output are billed at the same rate for
// these models. Keep in sync with WORKFLOW_FINAL_MODELS in server.js.
const PREMIUM_MODELS = {
  "gpt-5.6-luna": { inputPer1M: 0.08, outputPer1M: 0.08 },
  "gpt-5.6-terra": { inputPer1M: 0.083, outputPer1M: 0.083 },
  "gpt-5.6-sol": { inputPer1M: 0.092, outputPer1M: 0.092 },
};

function isPremiumModel(modelId) {
  return Object.prototype.hasOwnProperty.call(PREMIUM_MODELS, String(modelId || ""));
}

// Cost of one premium call in integer micro-USD. No group ratio (direct provider price).
// micro-USD = promptTokens * inputPer1M + completionTokens * outputPer1M (the /1e6 from
// "per 1M" cancels the *1e6 conversion to micro-USD, matching v98-models.computeCostMicros).
// Returns null for a non-premium id so the caller can fall back to the v98 price.
function premiumCostMicros(modelId, promptTokens, completionTokens) {
  const price = PREMIUM_MODELS[modelId];
  if (!price) return null;
  const pt = Math.max(0, Number(promptTokens) || 0);
  const ct = Math.max(0, Number(completionTokens) || 0);
  return Math.round(pt * price.inputPer1M + ct * price.outputPer1M);
}

module.exports = {
  PREMIUM_MODELS,
  isPremiumModel,
  premiumCostMicros,
};
