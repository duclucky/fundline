"use strict";

// Provider-agnostic per-call cost in integer micro-USD, used for the daily budget and
// per-key spend caps. Premium (cheapkey) models are billed from premium-models.js; every
// other model from the v98store registry. This keeps the caps counting BOTH providers even
// though they run on different endpoints. Always returns a number (0 for a model in neither
// table) so an unpriced model never yields NaN in a running total; if you add a model to
// neither registry it will silently count as 0, so watch the caps.
const v98Models = require("./v98-models");
const premiumModels = require("./premium-models");

function costMicros(modelId, promptTokens, completionTokens, groupRatio) {
  const premium = premiumModels.premiumCostMicros(modelId, promptTokens, completionTokens);
  if (premium !== null) return premium;
  return v98Models.computeCostMicros(modelId, promptTokens, completionTokens, groupRatio) || 0;
}

module.exports = {
  costMicros,
  isPremiumModel: premiumModels.isPremiumModel,
};
