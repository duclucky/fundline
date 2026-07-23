"use strict";

// Fixed internal cost estimates for the GPT-5.6 final-node models. These models run through
// v98store, but its model registry does not currently expose authoritative prices for them.
// Keep the known USD per 1M token estimates here until v98store publishes pricing metadata.
// Keep the model ids in sync with WORKFLOW_FINAL_MODELS in server.js.
const PREMIUM_MODELS = {
  "gpt-5.6-luna": { inputPer1M: 0.08, outputPer1M: 0.08 },
  "gpt-5.6-terra": { inputPer1M: 0.083, outputPer1M: 0.083 },
  "gpt-5.6-sol": { inputPer1M: 0.092, outputPer1M: 0.092 },
};

function isPremiumModel(modelId) {
  return Object.prototype.hasOwnProperty.call(PREMIUM_MODELS, String(modelId || ""));
}

// Estimated cost of one GPT-5.6 call in integer micro-USD. Preserve the existing fixed
// estimates without a group ratio until authoritative v98store pricing is available.
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
