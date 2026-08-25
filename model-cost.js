"use strict";

// Provider-agnostic per-call cost in integer micro-USD, used for the daily budget and
// per-key spend caps. CheapKeyAI catalog prices live in one registry.
const cheapkeyModels = require("./cheapkey-models");

function costMicros(modelId, promptTokens, completionTokens, groupRatio) {
  return cheapkeyModels.computeCostMicros(
    modelId,
    promptTokens,
    completionTokens,
    groupRatio,
  ) || 0;
}

module.exports = { costMicros };
