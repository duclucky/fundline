"use strict";

// Unified freelance gig fetcher for the CV + Gig Match workflow.
// Three sources, all validated live 2026-06-30:
//   - Freelancer.com active projects (free, no auth) = PRIMARY
//   - Hacker News via Algolia (free, no auth)        = SECONDARY
//   - JSearch / OpenWeb Ninja (key, ~200/month)      = ON-DEMAND top-up
// Every source is normalized to one shape and merged/deduped. A source that
// errors or is empty is skipped, never fails the whole fetch. See
// .claude/workflow-cv-gigmatch-spec.md sections 5 and 8.
//
// Excluded by platform API limits (not our choice): Upwork, Fiverr, Facebook,
// LinkedIn. Grok/X is a documented phase-2 enhancement.

const https = require("https");

// Unified gig shape returned to the executor:
// { source, title, org, budget, location, remote, url, postedAt, snippet }

// --- HTTP (injected in tests) ---

function httpGetJson(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const request = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method: "GET",
        headers: Object.assign({ "Accept": "application/json", "User-Agent": "Fundline/1.0" }, headers || {}),
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => { body += chunk; });
        response.on("end", () => {
          let json = null;
          try { json = JSON.parse(body || "null"); } catch { json = null; }
          resolve({ status: response.statusCode, json });
        });
      },
    );
    request.setTimeout(20000, () => { request.destroy(new Error("gig source request timed out")); });
    request.on("error", reject);
    request.end();
  });
}

// --- helpers ---

function stripHtml(text) {
  return String(text || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/&#x2F;/g, "/")
    .replace(/\s+/g, " ")
    .trim();
}

function snippet(text, max) {
  const clean = stripHtml(text);
  const cap = max || 240;
  return clean.length > cap ? clean.slice(0, cap - 1).trimEnd() + "…" : clean;
}

function firstKeyword(keywords) {
  const arr = Array.isArray(keywords) ? keywords : [keywords];
  const kw = arr.find((k) => k && String(k).trim());
  return kw ? String(kw).trim() : "";
}

// --- normalizers (pure, unit tested with fixtures) ---

function normalizeFreelancer(json) {
  const result = json && json.result;
  const projects = (result && Array.isArray(result.projects)) ? result.projects : [];
  const out = [];
  projects.forEach((p) => {
    if (!p || !p.title) return;
    const budget = p.budget || {};
    const cur = (p.currency && p.currency.code) || "";
    const min = budget.minimum != null ? budget.minimum : null;
    const max = budget.maximum != null ? budget.maximum : null;
    let budgetText = "";
    if (min != null && max != null) budgetText = `${min} - ${max} ${cur}`.trim();
    else if (min != null) budgetText = `${min}+ ${cur}`.trim();
    const seo = p.seo_url ? `https://www.freelancer.com/projects/${p.seo_url}` : "";
    out.push({
      source: "Freelancer.com",
      title: stripHtml(p.title),
      org: "",
      budget: budgetText,
      location: "Remote",
      remote: true,
      url: seo,
      postedAt: p.submitdate ? new Date(p.submitdate * 1000).toISOString().slice(0, 10) : "",
      snippet: snippet(p.preview_description || p.description || ""),
    });
  });
  return out;
}

function normalizeHackerNews(json) {
  const hits = (json && Array.isArray(json.hits)) ? json.hits : [];
  const out = [];
  hits.forEach((h) => {
    const text = h.comment_text || h.story_text || "";
    if (!text) return;
    const clean = stripHtml(text);
    // Keep posts that read like a company seeking help, not a freelancer advert.
    const looksSeeking = /\b(seeking|hiring|need|looking for|wanted|contract|freelanc)/i.test(clean);
    if (!looksSeeking) return;
    // A rough title from the first line/segment of the post.
    const title = clean.split(/[.|\n]/)[0].slice(0, 90).trim() || "Hacker News gig";
    out.push({
      source: "Hacker News",
      title,
      org: h.author ? `by ${h.author}` : "",
      budget: "",
      location: /remote/i.test(clean) ? "Remote" : "",
      remote: /remote/i.test(clean),
      url: h.objectID ? `https://news.ycombinator.com/item?id=${h.objectID}` : "",
      postedAt: h.created_at ? String(h.created_at).slice(0, 10) : "",
      snippet: snippet(clean),
    });
  });
  return out;
}

function normalizeJSearch(json) {
  const data = (json && Array.isArray(json.data)) ? json.data : [];
  const out = [];
  data.forEach((j) => {
    if (!j || !j.job_title) return;
    const min = j.job_min_salary;
    const max = j.job_max_salary;
    const cur = j.job_salary_currency || "USD";
    let budgetText = "";
    if (min != null && max != null) budgetText = `${min} - ${max} ${cur}`.trim();
    const city = j.job_city || "";
    const country = j.job_country || "";
    const loc = j.job_is_remote ? "Remote" : [city, country].filter(Boolean).join(", ");
    out.push({
      source: "JSearch",
      title: stripHtml(j.job_title),
      org: j.employer_name || "",
      budget: budgetText,
      location: loc,
      remote: !!j.job_is_remote,
      url: j.job_apply_link || (j.apply_options && j.apply_options[0] && j.apply_options[0].apply_link) || "",
      postedAt: j.job_posted_at_datetime_utc ? String(j.job_posted_at_datetime_utc).slice(0, 10) : "",
      snippet: snippet(j.job_description || ""),
    });
  });
  return out;
}

// --- merge + dedupe ---

function dedupeKey(gig) {
  if (gig.url) return "u:" + gig.url.toLowerCase();
  return "t:" + String(gig.title || "").toLowerCase().trim() + "|" + String(gig.org || "").toLowerCase().trim();
}

function mergeAndDedupe(lists) {
  const seen = new Set();
  const out = [];
  (lists || []).forEach((list) => {
    (list || []).forEach((gig) => {
      if (!gig || !gig.title) return;
      const key = dedupeKey(gig);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(gig);
    });
  });
  return out;
}

// --- per-source fetchers (take injected getJson for testing) ---

async function fetchFreelancer(keywords, opts, getJson) {
  const kw = firstKeyword(keywords);
  if (!kw) return [];
  const limit = (opts && opts.limit) || 15;
  const url = `https://www.freelancer.com/api/projects/0.1/projects/active/?query=${encodeURIComponent(kw)}&limit=${limit}&job_details=true`;
  const res = await getJson(url, null);
  if (!res || res.status !== 200) return [];
  return normalizeFreelancer(res.json);
}

async function fetchHackerNews(keywords, opts, getJson) {
  const kw = firstKeyword(keywords);
  if (!kw) return [];
  const limit = (opts && opts.limit) || 15;
  const url = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(kw)}&tags=comment&hitsPerPage=${limit}`;
  const res = await getJson(url, null);
  if (!res || res.status !== 200) return [];
  return normalizeHackerNews(res.json);
}

async function fetchJSearch(keywords, opts, getJson, apiKey) {
  const kw = firstKeyword(keywords);
  if (!kw || !apiKey) return [];
  const params = new URLSearchParams({
    query: kw,
    page: "1",
    num_pages: "1",
    date_posted: "month",
  });
  if (opts && opts.remoteOnly) params.set("remote_jobs_only", "true");
  const url = `https://api.openwebninja.com/jsearch/v1/search?${params.toString()}`;
  const res = await getJson(url, { "x-api-key": apiKey });
  if (!res || res.status !== 200) return [];
  return normalizeJSearch(res.json);
}

// --- orchestrator ---

// opts: {
//   keywords: string[] (used first keyword per source),
//   jsearchKey, useJSearch (bool; call JSearch only when true, e.g. free two thin),
//   remoteOnly, limit, maxGigs (default 10),
//   getJson (injected for tests; defaults to real https),
// }
// Returns { gigs, fetched, dropped, sourceCounts, errors }.
async function fetchGigs(opts) {
  const options = opts || {};
  const getJson = options.getJson || httpGetJson;
  const keywords = options.keywords || [];
  const maxGigs = options.maxGigs || 10;
  const errors = [];
  const sourceCounts = {};

  async function safe(name, fn) {
    try {
      const list = await fn();
      sourceCounts[name] = list.length;
      return list;
    } catch (error) {
      errors.push({ source: name, message: error.message });
      sourceCounts[name] = 0;
      return [];
    }
  }

  const lists = [];
  lists.push(await safe("Freelancer.com", () => fetchFreelancer(keywords, options, getJson)));
  lists.push(await safe("Hacker News", () => fetchHackerNews(keywords, options, getJson)));
  if (options.useJSearch && options.jsearchKey) {
    lists.push(await safe("JSearch", () => fetchJSearch(keywords, options, getJson, options.jsearchKey)));
  }

  const merged = mergeAndDedupe(lists);
  const fetched = merged.length;
  const gigs = merged.slice(0, maxGigs);
  const dropped = Math.max(0, fetched - gigs.length);
  return { gigs, fetched, dropped, sourceCounts, errors };
}

module.exports = {
  httpGetJson,
  stripHtml,
  snippet,
  normalizeFreelancer,
  normalizeHackerNews,
  normalizeJSearch,
  mergeAndDedupe,
  dedupeKey,
  fetchFreelancer,
  fetchHackerNews,
  fetchJSearch,
  fetchGigs,
};
