"use strict";

function createWorkflowModelProvider(options = {}) {
  const config = Object.freeze({
    apiKey: String(options.apiKey || "").trim(),
    baseUrl: String(options.baseUrl || "").trim(),
  });
  const models = { ...(options.models || {}) };
  const callChat = options.callChat;
  if (typeof callChat !== "function") throw new Error("callChat is required");

  function finalModelForTier(tier) {
    if (!config.apiKey || !config.baseUrl) return "";
    return String(models[tier] || "").trim();
  }

  async function callModel(modelId, messages, maxTokens) {
    const response = await callChat(config, { model: modelId, messages, maxTokens });
    return { content: response.content, usage: response.usage };
  }

  return Object.freeze({ finalModelForTier, callModel });
}

module.exports = { createWorkflowModelProvider };
