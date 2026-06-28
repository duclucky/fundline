"use strict";

const https = require("https");

// Tavily Search API client. POST https://api.tavily.com/search with
// Authorization: Bearer <key>. Returns ranked web results with content snippets.
// Used as the retrieval step of the Research workflow. See workflow-gpt-researcher.md.

function postSearch(config, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = https.request(
      {
        hostname: "api.tavily.com",
        port: 443,
        path: "/search",
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
    request.setTimeout(30000, () => {
      request.destroy(new Error("Tavily request timed out"));
    });
    request.on("error", reject);
    request.write(payload);
    request.end();
  });
}

// Runs one search. Returns { results: [{ title, url, content, score }], answer, credits }.
async function searchTavily(config, params) {
  if (!config || !config.apiKey) throw new Error("Tavily API key is not configured");
  if (!params || !params.query) throw new Error("Tavily search needs a query");

  const body = {
    query: String(params.query),
    search_depth: params.searchDepth || "basic",
    max_results: params.maxResults != null ? params.maxResults : 5,
    topic: params.topic || "general",
    include_answer: false,
    include_raw_content: false,
  };

  const result = await postSearch(config, body);
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`Tavily API ${result.status}: ${result.body || "request failed"}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(result.body || "{}");
  } catch {
    throw new Error("Tavily returned invalid JSON");
  }
  const results = Array.isArray(parsed.results) ? parsed.results.map((r) => ({
    title: String(r.title || ""),
    url: String(r.url || ""),
    content: String(r.content || ""),
    score: Number(r.score) || 0,
  })) : [];
  return {
    results,
    answer: String(parsed.answer || ""),
    credits: parsed.usage && parsed.usage.credits != null ? parsed.usage.credits : null,
  };
}

module.exports = { searchTavily };
