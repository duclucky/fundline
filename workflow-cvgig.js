"use strict";

// CV + Freelance Gig Match executor.
// Chain: profile extract (LLM) -> template select (deterministic) -> CV content
// (LLM, structured JSON) -> gig fetch (3 real sources) -> rank + proposal (LLM).
// Adapts the step structure of srbhr/Resume-Matcher (skill/keyword extract + match
// scoring) and abhineetgupta/ai-resume-builder (tailor to target role); MIT/Apache.
// The orchestrator takes injected callModel + fetchGigs so it is testable offline.
// Returns { report, cvJson, gigs, steps, totalCostMicros }. See
// .claude/workflow-cv-gigmatch-spec.md.

const v98Models = require("./v98-models");

// --- JSON extraction helpers ---

function extractJsonObject(text) {
  const raw = String(text || "");
  const i = raw.indexOf("{");
  const j = raw.lastIndexOf("}");
  return i >= 0 && j > i ? raw.slice(i, j + 1) : raw;
}

function extractJsonArray(text) {
  const raw = String(text || "");
  const i = raw.indexOf("[");
  const j = raw.lastIndexOf("]");
  return i >= 0 && j > i ? raw.slice(i, j + 1) : raw;
}

function safeParse(text, extractor) {
  try {
    return JSON.parse(extractor(text));
  } catch {
    return null;
  }
}

// --- parsers (pure) ---

function parseProfile(text) {
  const o = safeParse(text, extractJsonObject);
  if (!o || typeof o !== "object") return null;
  const toArr = (v) => Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean) : [];
  return {
    profession: String(o.profession || "").trim(),
    seniority: String(o.seniority || "").trim(),
    skills: toArr(o.skills),
    keywords: toArr(o.keywords),
    summary: String(o.summary || "").trim(),
  };
}

function fallbackProfile(input) {
  const words = String(input || "").split(/\s+/).filter(Boolean);
  return {
    profession: "Freelancer",
    seniority: "",
    skills: [],
    keywords: [words.slice(0, 3).join(" ") || "freelance"],
    summary: "",
  };
}

function parseCvJson(text) {
  const o = safeParse(text, extractJsonObject);
  if (!o || typeof o !== "object") return null;
  if (!o.name && !o.summary && !(Array.isArray(o.skills) && o.skills.length)) return null;
  return normalizeCvJson(o);
}

function normalizeCvJson(o) {
  const arr = (v) => Array.isArray(v) ? v : [];
  const str = (v) => String(v == null ? "" : v).trim();
  return {
    name: str(o.name),
    headline: str(o.headline),
    location: str(o.location),
    contact: {
      email: str(o.contact && o.contact.email),
      phone: str(o.contact && o.contact.phone),
      website: str(o.contact && o.contact.website),
    },
    profiles: arr(o.profiles).map((p) => ({ network: str(p.network), url: str(p.url) })).filter((p) => p.url),
    summary: str(o.summary),
    skills: arr(o.skills).map(str).filter(Boolean),
    projects: arr(o.projects).map((p) => ({ name: str(p.name), desc: str(p.desc), link: str(p.link) })).filter((p) => p.name),
    experience: arr(o.experience).map((e) => ({
      role: str(e.role), org: str(e.org), period: str(e.period),
      bullets: arr(e.bullets).map(str).filter(Boolean),
    })).filter((e) => e.role || e.org),
    education: arr(o.education).map((e) => ({ degree: str(e.degree), school: str(e.school), period: str(e.period) })).filter((e) => e.degree || e.school),
    certifications: arr(o.certifications).map((c) => ({ name: str(c.name), issuer: str(c.issuer), date: str(c.date) })).filter((c) => c.name),
    languages: arr(o.languages).map((l) => ({ name: str(l.name), level: str(l.level) })).filter((l) => l.name),
    templateId: (o.templateId === "modern" || o.templateId === "classic") ? o.templateId : "modern",
  };
}

// Deterministic profession -> template map. Skill-forward roles get the
// two-column "modern" sidebar; everything else gets single-column "classic".
function selectTemplate(profile) {
  const hay = ((profile && profile.profession) || "").toLowerCase()
    + " " + (((profile && profile.skills) || []).join(" ").toLowerCase());
  const modern = /(develop|engineer|program|software|web3|blockchain|solidity|data|designer|ux|ui|devops|ml|ai|technical)/;
  return modern.test(hay) ? "modern" : "classic";
}

function parseRanked(text, gigs) {
  const arr = safeParse(text, extractJsonArray);
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  arr.forEach((r) => {
    if (!r || typeof r !== "object") return;
    const idx = Number(r.index);
    if (!Number.isInteger(idx) || idx < 0 || idx >= gigs.length || seen.has(idx)) return;
    seen.add(idx);
    const fit = Math.max(0, Math.min(100, Number(r.fit) || 0));
    out.push(Object.assign({}, gigs[idx], {
      fit,
      reason: String(r.reason || "").trim(),
      proposal: String(r.proposal || "").trim(),
    }));
  });
  return out.length ? out : null;
}

// --- prompt builders ---

function buildProfileMessages(input) {
  const system = "You extract a structured freelancer profile from raw text. Respond ONLY with a JSON object: "
    + "{\"profession\":\"\",\"seniority\":\"\",\"skills\":[],\"keywords\":[],\"summary\":\"\"}. "
    + "keywords are 2 to 4 short job-search phrases derived from the strongest skills (used to search gig boards). "
    + "Use only facts present in the text; do not invent anything.";
  return [
    { role: "system", content: system },
    { role: "user", content: `Freelancer background:\n${input}` },
  ];
}

function buildCvMessages(input, profile, templateId) {
  const system = "You are an expert resume writer. Produce a polished CV as a JSON object only, no prose. "
    + "Schema: {\"name\":\"\",\"headline\":\"\",\"location\":\"\",\"contact\":{\"email\":\"\",\"phone\":\"\",\"website\":\"\"},"
    + "\"profiles\":[{\"network\":\"\",\"url\":\"\"}],\"summary\":\"\",\"skills\":[],"
    + "\"projects\":[{\"name\":\"\",\"desc\":\"\",\"link\":\"\"}],"
    + "\"experience\":[{\"role\":\"\",\"org\":\"\",\"period\":\"\",\"bullets\":[]}],"
    + "\"education\":[{\"degree\":\"\",\"school\":\"\",\"period\":\"\"}],"
    + "\"certifications\":[{\"name\":\"\",\"issuer\":\"\",\"date\":\"\"}],"
    + "\"languages\":[{\"name\":\"\",\"level\":\"\"}]}. "
    + "Rules: use ONLY facts the user provided; never invent employers, dates, links, or metrics. "
    + "Write a strong 2 to 3 sentence summary and concise achievement-focused experience bullets from the given facts. "
    + "Leave a field as an empty string or empty array if the user did not provide it. No emojis.";
  const user = `Detected profession: ${profile.profession || "Freelancer"}; seniority: ${profile.seniority || "n/a"}.\n`
    + `Target template: ${templateId}.\n\nFreelancer background:\n${input}`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

function buildCvRetryMessages(input, profile, templateId) {
  const msgs = buildCvMessages(input, profile, templateId);
  msgs.push({ role: "user", content: "Your previous reply was not valid JSON. Reply again with ONLY the JSON object, no code fence, no commentary." });
  return msgs;
}

function compactGig(gig, index) {
  const parts = [`[${index}] ${gig.title}`];
  if (gig.org) parts.push(gig.org);
  if (gig.budget) parts.push(gig.budget);
  if (gig.location) parts.push(gig.location);
  parts.push(`(${gig.source})`);
  const head = parts.join(" | ");
  return `${head}\n${gig.snippet || ""}`.trim();
}

function buildRankMessages(profile, gigs, topN) {
  const list = gigs.map((g, i) => compactGig(g, i)).join("\n\n");
  const skills = (profile.skills || []).join(", ") || profile.summary || profile.profession;
  const system = "You match a freelancer to real gig postings. You are given a numbered list of REAL gigs. "
    + "Rank the best matches for this freelancer. Respond ONLY with a JSON array of objects: "
    + "[{\"index\":<number from the list>,\"fit\":<0-100>,\"reason\":\"one sentence why it fits\",\"proposal\":\"a 2 to 3 sentence tailored proposal opener\"}]. "
    + "Only use indexes that appear in the list; never invent gigs. Order by fit descending. No emojis.";
  const user = `Freelancer profile: ${profile.profession || "Freelancer"} (${profile.seniority || "n/a"}). Skills: ${skills}.\n\n`
    + `Gigs:\n${list}\n\nReturn the top ${topN} matches.`;
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

// --- report assembly ---

function buildReport(profile, cvJson, ranked, meta) {
  const lines = [];
  lines.push(`# CV and matched gigs`);
  lines.push("");
  lines.push(`## Your profile`);
  lines.push(`- Profession: ${profile.profession || "Freelancer"}${profile.seniority ? " (" + profile.seniority + ")" : ""}`);
  if (profile.skills && profile.skills.length) lines.push(`- Skills: ${profile.skills.join(", ")}`);
  lines.push("");
  lines.push(`## Your CV`);
  lines.push(`A styled CV is ready (template: ${cvJson.templateId}). Use the "View CV" button to open it and save as PDF from your browser.`);
  lines.push("");
  lines.push(`## Matched gigs (${ranked.length})`);
  if (!ranked.length) {
    lines.push("No gigs matched your skills right now. Try broader keywords or run again later.");
  }
  ranked.forEach((g, i) => {
    // Blank lines between each field so the renderer shows them on separate lines
    // (single newlines collapse into one paragraph). The link is a real markdown
    // link so it is clickable and opens in a new tab.
    lines.push("");
    lines.push(`### ${i + 1}. ${g.title}${g.fit ? " (" + g.fit + "% fit)" : ""}`);
    const meta2 = [g.org, g.budget, g.location, g.source].filter(Boolean).join(", ");
    if (meta2) { lines.push(""); lines.push(meta2); }
    if (g.url) { lines.push(""); lines.push(`**Link:** [${g.url}](${g.url})`); }
    if (g.reason) { lines.push(""); lines.push(`**Why:** ${g.reason}`); }
    if (g.proposal) { lines.push(""); lines.push(`**Proposal opener:** ${g.proposal}`); }
  });
  if (meta && meta.dropped) {
    lines.push("");
    lines.push(`_${meta.fetched} gigs fetched; showing the top ${ranked.length}._`);
  }
  return lines.join("\n");
}

// --- orchestrator ---

// opts: {
//   input, topGigs=8, remoteOnly, jsearchKey, jsearchAvailable,
//   profileModel, cvModel, rankModel, groupRatio, minGigsBeforeJSearch=5,
//   callModel(modelId, messages, maxTokens) -> { content, usage },
//   fetchGigs({keywords, jsearchKey, useJSearch, remoteOnly, maxGigs, limit}) -> { gigs, fetched, dropped, sourceCounts, errors },
//   onProgress({ step, status }) -> void,
// }
async function runCvGigWorkflow(opts) {
  const input = String(opts.input || "").trim();
  if (!input) throw new Error("Freelancer background is required");
  const topGigs = opts.topGigs || 8;
  const groupRatio = opts.groupRatio || 1;
  const profileModel = v98Models.resolveModelId(opts.profileModel || "gpt-4o-mini");
  const cvModel = v98Models.resolveModelId(opts.cvModel || "gpt-4.1-mini");
  const rankModel = v98Models.resolveModelId(opts.rankModel || "gpt-4.1-mini");
  const callModel = opts.callModel;
  const fetchGigs = opts.fetchGigs;
  const minBeforeJSearch = opts.minGigsBeforeJSearch != null ? opts.minGigsBeforeJSearch : 5;
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};

  const steps = [];
  let totalCostMicros = 0;
  function account(name, modelId, usage) {
    const cost = v98Models.computeCostMicros(modelId, usage.prompt_tokens, usage.completion_tokens, groupRatio) || 0;
    totalCostMicros += cost;
    steps.push({ name, model: modelId, costMicros: cost });
    return cost;
  }

  // 1. Profile extract
  onProgress({ step: "profile", status: "running" });
  const profRes = await callModel(profileModel, buildProfileMessages(input), 400);
  account("Profile analysis", profileModel, profRes.usage);
  const profile = parseProfile(profRes.content) || fallbackProfile(input);
  onProgress({ step: "profile", status: "done" });

  // 2. Template select (deterministic, no cost)
  const templateId = selectTemplate(profile);

  // 3. CV content (JSON, retry once on parse failure)
  onProgress({ step: "cv_writer", status: "running" });
  const cvRes = await callModel(cvModel, buildCvMessages(input, profile, templateId), 3000);
  account("CV writer", cvModel, cvRes.usage);
  let cvJson = parseCvJson(cvRes.content);
  if (!cvJson) {
    const retryRes = await callModel(cvModel, buildCvRetryMessages(input, profile, templateId), 3000);
    account("CV writer (retry)", cvModel, retryRes.usage);
    cvJson = parseCvJson(retryRes.content);
  }
  if (!cvJson) {
    // Last-resort minimal CV so the run still delivers something useful.
    cvJson = normalizeCvJson({ summary: profile.summary, skills: profile.skills, templateId });
  }
  cvJson.templateId = templateId;
  onProgress({ step: "cv_writer", status: "done" });

  // 4. Gig fetch (free sources first; JSearch on-demand top-up)
  onProgress({ step: "gig_search", status: "running" });
  const keywords = (profile.keywords && profile.keywords.length) ? profile.keywords : [profile.profession || input.slice(0, 40)];
  let gigResult = await fetchGigs({
    keywords,
    remoteOnly: !!opts.remoteOnly,
    maxGigs: Math.max(topGigs * 2, 20),
    limit: 15,
    useJSearch: false,
    jsearchKey: opts.jsearchKey,
  });
  // Top up with JSearch only when the free sources are thin and JSearch is available.
  if (gigResult.gigs.length < minBeforeJSearch && opts.jsearchAvailable && opts.jsearchKey) {
    const topped = await fetchGigs({
      keywords,
      remoteOnly: !!opts.remoteOnly,
      maxGigs: Math.max(topGigs * 2, 20),
      limit: 15,
      useJSearch: true,
      jsearchKey: opts.jsearchKey,
    });
    if (topped.gigs.length > gigResult.gigs.length) gigResult = topped;
  }
  steps.push({ name: "Gig search", model: null, costMicros: 0 });
  onProgress({ step: "gig_search", status: "done" });

  const fetchedGigs = gigResult.gigs || [];

  // 5. Rank + proposal
  onProgress({ step: "ranking", status: "running" });
  let ranked = [];
  if (fetchedGigs.length) {
    const rankRes = await callModel(rankModel, buildRankMessages(profile, fetchedGigs, topGigs), 3000);
    account("Rank and proposals", rankModel, rankRes.usage);
    ranked = parseRanked(rankRes.content, fetchedGigs) || fetchedGigs.slice(0, topGigs).map((g) => Object.assign({}, g, { fit: 0, reason: "", proposal: "" }));
    ranked = ranked.slice(0, topGigs);
  }
  onProgress({ step: "ranking", status: "done" });

  const report = buildReport(profile, cvJson, ranked, { fetched: gigResult.fetched || fetchedGigs.length, dropped: gigResult.dropped || 0 });

  return {
    report,
    cvJson,
    gigs: ranked,
    profile,
    steps,
    totalCostMicros,
    meta: { sourceCounts: gigResult.sourceCounts || {}, errors: gigResult.errors || [] },
  };
}

module.exports = {
  extractJsonObject,
  extractJsonArray,
  parseProfile,
  fallbackProfile,
  parseCvJson,
  normalizeCvJson,
  selectTemplate,
  parseRanked,
  buildProfileMessages,
  buildCvMessages,
  buildCvRetryMessages,
  buildRankMessages,
  compactGig,
  buildReport,
  runCvGigWorkflow,
};
