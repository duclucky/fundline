# Workflow spec: CV + Freelance Gig Match (v1)

Status: DRAFT, not built. Scope locked with user 2026-06-30.
Follows `.claude/skills/create-workflow/SKILL.md`. This is the design record to review
before any code. Two money systems stay distinct (fixed USDC price paid via escrow vs real
v98 micro-USD cost tracked by the limiter).

## 1. What it does (locked v1 scope)

One run, one flow, for a freelancer:

1. User pastes their background (skills, experience, past work, target role).
2. LLM extracts a structured profile (skills, profession, seniority, keywords).
3. A CV template is auto-selected from the detected profession.
4. LLM fills a structured CV (JSON) from ONLY what the user provided (no fabricated facts).
5. The workflow queries 3 real gig sources for matching work.
6. LLM ranks the REAL returned gigs against the profile and drafts a short proposal for each top gig.
7. Output: a downloadable CV PDF + a ranked list of real gigs with real apply/bid links.

Explicitly EXCLUDED in v1 (platform API limits, not our choice; state this in UI copy):
Upwork, Fiverr, Facebook, LinkedIn. Grok/X is a documented phase-2 enhancement (section 13),
not v1.

## 2. Source chains adapted (proven, not invented)

- CV writing + tailoring: adapt the step structure of `srbhr/Resume-Matcher` (skill/keyword
  extraction + match scoring) and `abhineetgupta/ai-resume-builder` (tailor content to a target
  role). MIT/Apache; keep an attribution comment. We adapt the STEP STRUCTURE into v98store chat
  calls only, no runtime import.
- Gig ranking + proposal: reuse Fundline's own proven `upwork-proposal` / `rfp-proposal` prompt
  patterns already in `workflow-defs.js` for the per-gig proposal draft.

## 3. Node graph

```
0. User input (skills / experience / target role / optional location)
1. Profile extract   [LLM cheap]  -> { skills[], profession, seniority, keywords[], summary }
2. Template select   [local/deterministic] -> templateId from profession map
3. CV content        [LLM strong] -> CV JSON (structured, no fabrication)
4. Gig fetch         [external APIs, NOT LLM] -> normalized gigs[] from 3 sources
5. Gig rank+proposal [LLM strong] -> ranked gigs[] with fit reason + short proposal per top N
6. Assemble          -> { cvJson, gigs[], report(markdown for modal) }
```

Notes:
- Steps 1, 3, 5 are v98store LLM calls (counted for v98 cost + budget caps).
- Step 4 is NOT a Tavily retrieval node and NOT a v98 search-preview call. It hits dedicated gig
  APIs directly (see section 5). These do not consume v98 budget; JSearch consumes its own monthly
  quota.
- Step 2 is deterministic (a profession -> templateId lookup), optionally a 1-line cheap LLM
  classifier if the map misses. Prefer deterministic to keep cost/latency down.
- CV generation is self-contained (input is the user's own info). Hard rule in the prompt: use
  ONLY facts the user provided; never invent employers, dates, or metrics. This is the CV analog
  of the "no fabricated citations" rule for retrieval-less workflows.

## 4. New pieces vs shared pieces

SHARED (do not rebuild): wallet session, escrow billing (quote -> fund -> run -> release/refund),
limiter + budget caps, canvas run animation, result modal, receipt. Per create-workflow, a normal
new workflow is just executor + WORKFLOW_RUN_DEFS entry + WORKFLOWS entry.

NEW for this workflow (this is why it is bigger than a standard workflow):
- N1. `gig-sources.js` (server): unified client for the 3 gig APIs, returns a normalized gig shape.
- N2. `workflow-cvgig.js` (server): the executor (profile -> CV JSON -> gig fetch -> rank+proposal).
- N3. `cv-render.js` (browser): builds a self-contained, styled HTML CV page from `cvJson` and
     exports via the browser print-to-PDF path. DECISION (user, 2026-06-30): design quality is the
     priority, so CV is HTML/CSS (real fonts, tasteful layout, like Reactive Resume), NOT the
     hand-rolled invoice PDF primitives. This DROPS the earlier idea of extracting PDF ops from
     app.js; the invoice PDF path is untouched and separate. See section 7.
- N4. Frontend result handling: the standard modal shows the markdown report; this workflow also
     returns `cvJson`, so the result modal gets a "View CV" (opens the styled HTML CV in a new
     print-ready tab) and the user prints/saves to PDF from there. The chosen template is noted in
     the report markdown.

Effort honesty: N3 (a polished HTML/CSS CV renderer with 2 tasteful templates + a print
stylesheet) and N4 (structured CV return + open-print flow in the result UI) are real extra work
beyond the standard executor-plus-two-entries pattern. Budget for it. Upside vs the PDF-primitive
route: no risky refactor of the invoice PDF code, and far higher design quality.

## 5. Gig sources (v1: three, all validated live 2026-06-30)

Unified normalized gig shape returned by `gig-sources.js`:
```
{ source, title, org, budget, location, remote, url, postedAt, snippet }
```

### 5a. Freelancer.com (PRIMARY, free, no auth)
- GET `https://www.freelancer.com/api/projects/0.1/projects/active/?query=<kw>&limit=<n>&job_details=true`
- No key. Real projects with budget.minimum/maximum + currency.code; link =
  `https://www.freelancer.com/projects/<seo_url>`.
- Validated: "Expert Solidity Contract Development $750-1500", "ERC-20 Token Platform $3000-5000".
- Rate: be polite (a few calls/run, cache per keyword within a run).

### 5b. Hacker News (SECONDARY, free, no auth)
- Algolia: GET `https://hn.algolia.com/api/v1/search?query=<kw>&tags=comment&hitsPerPage=<n>`
  for direct gig comments, and `search_by_date?query=Freelancer%20Seeking%20freelancer&tags=story`
  to find the current monthly thread (then read its comments via the item API if we want the
  full SEEKING FREELANCER set).
- Validated: 351 hits for "solidity remote contract"; first was a real
  "REMOTE | CONTRACT | Solidity Developer" post.
- Parse: keep comments that look like a SEEKING post; link = HN permalink
  `https://news.ycombinator.com/item?id=<objectID>`.

### 5c. JSearch (SECONDARY, key present, contract roles)
- GET `https://api.openwebninja.com/jsearch/v1/search?query=<kw>&page=1&num_pages=1&date_posted=month`
  header `x-api-key: <JSEARCH_KEY>` (OpenWeb Ninja direct key format `ak_...`).
- Validated: precise results (query "solidity" -> real Solidity roles), apply links from
  ZipRecruiter/JobLeads/LaborX etc, some with salary. Optional `&employment_types=CONTRACTOR` and
  `&remote_jobs_only=true` to bias toward freelance-ish contract work.
- Quota is ~200/month on the current plan (confirmed by user). So JSearch is ON-DEMAND, not
  every run: call Freelancer.com + HN (free) on every run; call JSearch ONLY when the free two
  return too few matches (threshold, e.g. < 5 relevant gigs) OR the user explicitly opts in. Track
  a monthly JSearch call counter server-side and stop calling it near the cap (log when skipped).
  NOT v98 budget; a separate external monthly limit.

### Fallback + failure policy
- Query all three; merge; dedupe by (title+org) and by URL. If a source errors or is empty, log
  and continue with the others (never fail the whole run on one source).
- If ALL sources return zero gigs, still deliver the CV PDF + a clear "no gigs matched, try
  broader keywords" note. Do NOT fabricate gigs. (Adzuna is the documented next fallback if we
  want a 4th source later; key already available.)

## 6. CV JSON schema (LLM step 3 output)

Learned from Reactive Resume's 12-section data model. v1 uses a freelancer-focused subset (their
`profiles`/links, `languages`, `certifications` matter for freelancers who sell on portfolio +
work internationally; their `awards`/`publications`/`volunteer`/`references`/`interests` are
deferred to keep v1 tight).

```
{
  "name": "", "headline": "", "location": "",
  "contact": { "email": "", "phone": "", "website": "" },
  "profiles": [ { "network":"", "url":"" } ],        // portfolio, GitHub, etc (key for freelancers)
  "summary": "",
  "skills": ["", ...],
  "projects":  [ { "name":"", "desc":"", "link":"" } ],  // shown high for freelancers
  "experience": [ { "role":"", "org":"", "period":"", "bullets":["", ...] } ],
  "education": [ { "degree":"", "school":"", "period":"" } ],
  "certifications": [ { "name":"", "issuer":"", "date":"" } ],
  "languages": [ { "name":"", "level":"" } ],
  "templateId": "modern|classic|technical"
}
```
- The LLM MUST return valid JSON only (parse + validate server-side; retry once on parse failure).
- Empty sections are omitted from the PDF, not shown blank.
- Freelancer section ORDER in the PDF: Summary -> Skills -> Projects -> Experience -> Education ->
  Certifications -> Languages (portfolio-forward, unlike an employment CV that leads with Experience).

## 7. CV rendering (`cv-render.js`, client-side HTML/CSS -> print PDF)

DECISION (user, 2026-06-30): CV is rendered as a polished HTML/CSS page (designer quality, real
typography, like Reactive Resume), exported via the browser print-to-PDF. NOT the hand-rolled PDF
primitives (those hit a ceiling: 2 fonts, no icons, no fine typography). The invoice PDF path stays
separate and untouched.

- `cv-render.js` builds a SELF-CONTAINED HTML document from `cvJson`: inline `<style>`, no external
  requests (CSP/offline safe, same discipline as the rest of the app). Opened in a new tab that is
  print-ready; the user does Ctrl/Cmd+P -> Save as PDF. Text stays selectable, real fonts, A4.
- v1 templates (2 CSS layouts): `classic` (single column, centered header, clean section rules)
  and `modern` (two column: sidebar ~35% for contact/skills/languages/links + main for
  summary/projects/experience). Section order = the freelancer order in section 6. templateId from
  step 2 picks the layout. (`technical` deferred; it was only a reordering of modern -> low value
  for v1.)
- Typography: to stay self-contained AND look good, EITHER a tasteful system-font stack
  (e.g. "Inter"-like: system-ui/Segoe UI/Helvetica Neue) OR embed 1 nice font as base64 woff2 in
  the inline CSS (build-time decision; base64 embed = best look, +file size). No external font CDN.
- Design language: clean and modern, tasteful accent color. Can echo the Fundline gold/dark accent
  but on a LIGHT page (CV must print well on white and read as a professional CV, not a dark web
  UI). Strong hierarchy: name/headline large, section headers with a rule, generous whitespace,
  consistent spacing scale. This is the "dep, co gu" bar the user set.
- Print stylesheet: `@media print` sets A4 page size, margins, avoids awkward section breaks
  (`break-inside: avoid` on entries), hides any screen-only chrome.
- No embedded photo in v1 (keep it text-first; a photo slot can be a v2 add). Empty sections
  omitted, not shown blank.
- A "View CV" action in the result modal opens this rendered page; the report markdown notes which
  template was used.

## 8. Executor (`workflow-cvgig.js`, server, testable)

- Pure helpers: `buildProfilePrompt`, `parseProfile`, `buildCvPrompt`, `parseCvJson`,
  `buildRankPrompt`, `parseRankedGigs`, `mergeAndDedupeGigs`.
- Orchestrator takes injected `callModel(modelId, messages, maxTokens)` and injected
  `fetchGigs(keywords, opts)` (wrapping `gig-sources.js`) so it unit-tests with no network.
- Map every model label via `v98Models.resolveModelId`; always send max_tokens.
- Returns `{ report, cvJson, gigs, steps, totalCostMicros }`. `report` = markdown for the modal
  (profile summary + template chosen + ranked gig list with links + proposals). `steps` =
  `[{name, model}]` for the escrow memo.
- Models: step 1 profile = gpt-4o-mini (cheap); step 3 CV = stronger (gpt-4.1-mini / claude per
  tier); step 5 rank+proposal = stronger. Tier matrix mirrors existing workflows.

## 9. Server registration

- `WORKFLOW_RUN_DEFS["cv-gig-match"] = { type: "cvgig", name: "CV + Freelance Gig Match",
  priceUnits: <fixed, measured> }`.
- Dispatch `type: "cvgig"` in `handleWorkflowRun` to `workflow-cvgig.js` (mirror the research
  branch). Reuse the existing funded-run verification, limiter reserve, recordCost, treasury
  release-with-memo / refund, and response shape. The SSE `result` event carries the extra
  `cvJson` field.
- New env: `JSEARCH_API_KEY` (+ optional `ADZUNA_APP_ID`/`ADZUNA_APP_KEY` for the later 4th
  source). Document in `.env.example`; set in cPanel. Freelancer.com + HN need no key.

## 10. Frontend `WORKFLOWS["cv-gig-match"]`

- `live: true`, `modelCount` set, real `steps` (Profile extract / CV writer / Gig search
  [Freelancer.com + HN + JSearch] / Rank + proposal), a `pricing` display, category e.g.
  "Freelance". `usesRetrieval` stays false (gig APIs are not the Tavily retrieval node; input is
  the user prompt, no paste-sources mode in v1).
- Result modal: standard markdown report PLUS a "View CV" button that opens the styled HTML CV
  (via `cv-render.js` with the returned `cvJson`) in a new print-ready tab; the user saves to PDF
  from the browser print dialog. Gig links open in a new tab with rel="noopener".
- Shared renderRunPanel / runWorkflow / fundWorkflowRun handle connect + quote + fund + canvas +
  receipt unchanged.

## 11. Pricing (two money systems, keep distinct)

- USDC price the USER pays (escrow, 6-dec base units): a FIXED per-tier price, set AFTER a live
  measurement pass (process rule: run live per tier -> review -> tune -> measure -> price ->
  save prompts). This workflow does 3 LLM calls + external API calls, heavier than a 1-call
  workflow, so expect a higher tier price than the 0.01 floor ones. Placeholder until measured:
  normal 0.05 / plus 0.06 / pro 0.12 (MUST be replaced by measured values; keep strictly
  monotonic plus>normal, pro>plus per the standing rule).
- Our REAL v98 cost (micro-USD via computeCostMicros, group ratio applied): tracked by the limiter
  for the per-IP + global budget caps. Estimated ~$0.003-0.008/run (3 LLM calls); the gig APIs add
  no v98 cost. JSearch monthly quota is a separate external limit to watch.

## 12. Tests

- `test_workflow_cvgig.js` (offline, injected fakes): profile parse, CV JSON parse + validate +
  retry-on-bad-json, gig merge/dedupe, rank parse, cost summation, all-sources-empty path,
  one-source-errors path.
- `test_gig_sources.js` (offline, fixture responses for each API): normalization of each source
  into the unified shape, dedupe, link construction.
- Escrow/billing path already proven by `test_run_escrow_dryrun.js` + `test_billing_e2e_dryrun.js`
  (reuse). One live billing e2e at the end (with user OK) to confirm real output + on-chain
  release + memo + quota accounting.

## 13. Phase 2 (documented, NOT v1)

- X via Grok: xAI API direct (NOT v98; v98 grok-search models are 503). Grok is the only model
  grounded to live X posts. Cost: tokens cheap but X Search $25/1000 sources (+ $175/mo free
  credit). Add as an OPTIONAL "signal" source (trending gigs / hiring buzz), unstructured, framed
  as soft suggestions, never the primary structured list. Needs a new provider integration + new
  secret + a second billing account, and pushes per-run cost up a lot, which is why it is deferred.
- Adzuna as a 4th structured source (key already available; app_id c9bb89bc). Cheap add if more
  geographic coverage is wanted.
- CV photo slot (easy now that CV is HTML: an <img> in the sidebar; deferred from v1 to keep tight).
- `technical` template (a third CSS layout) if users want a dev-focused variant.

## 14. Decisions + open questions

RESOLVED with user 2026-06-30:
- JSearch quota ~200/month -> JSearch is ON-DEMAND only (free two sources first; JSearch as a
  top-up when matches are thin or user opts in; monthly counter with a stop-near-cap). See 5c.
- Output caps at TOP 8-10 gigs after ranking; LOG if more were fetched but dropped (no silent
  truncation).
- Learn from Reactive Resume: adopted their section model (freelancer subset) + sidebar layout
  pattern; see sections 6 and 7.

- CV render = HTML/CSS + browser print-to-PDF (design quality priority), NOT hand-rolled PDF.
  v1 = 2 CSS templates (classic + modern); technical deferred. See sections 4, 7, 10.

Still open, resolve at build time:
- Typography: system-font stack vs embedding 1 base64 woff2 (recommend embed for the look).
- Whether step 2 template selection is a pure deterministic profession->template map or a 1-line
  cheap LLM classifier (recommend deterministic map, LLM only on miss).
- Measured per-tier price (live pass) before publishing.

## 15. Env vars to add (cPanel + .env.example)

- `JSEARCH_API_KEY` (OpenWeb Ninja `ak_...`)
- optional later: `ADZUNA_APP_ID`, `ADZUNA_APP_KEY`
- (Freelancer.com + Hacker News: none)
- All existing workflow env (V98, escrow, treasury) already required and unchanged.
