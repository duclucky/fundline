# Claude working memory - Fundline

My personal, cross-session memory for this repo. It is loaded into context via an
`@import` in CLAUDE.md. Append durable, non-obvious working knowledge here: decisions
made, dead ends, user preferences, and open threads. Do not duplicate what CLAUDE.md or
.claude/rules/ already state. Keep entries dated (absolute dates).

## Latest work (read first)

- 2026-07: NAV cleanup per user product decisions. (a) REMOVED the "Developers" nav group from the app
  sidebar (app.html + workflows.html) - the seller dashboard is de-emphasized (not deleted): invoicing
  + workflow have their own history, no marketplace yet so Products/sales dashboard not needed, Telegram
  covers notifications so Webhooks dropped from nav. (b) API keys MOVED under the "Agents" group (agents
  + humans share ONE type of API key); Agents group is now [Agent API -> /docs#agent-api, API keys ->
  /dashboard#apikeys, Docs -> /docs]. (c) Removed the dead disabled items Access Keys / Runs / Settings.
  Runs was dropped on the user's correct point: an agent uses its OWN wallet, so there is no logged-in
  "manager" account that maps to a runs view. (d) dashboard.html trimmed to 2 tabs (Dashboard + API keys;
  removed Products + Webhooks tabs, panels left in place/unreachable, code NOT deleted). (e) dashboard.js:
  showDashboard() now honors /dashboard#apikeys to open the API keys tab directly (the Agents nav links
  there). The dashboard PAGE still exists and works; it is just not surfaced as "Developers" in the main
  nav. Frontend-only (no server change) so FTP deploy is enough, no restart needed.

- 2026-07: SEO/GEO Phase 1 (foundation) DONE + live-verified (commit 9a9d739). robots.txt (allow all
  + explicitly allow AI answer engines GPTBot/OAI-SearchBot/ChatGPT-User/ClaudeBot/Claude-Web/
  PerplexityBot/Google-Extended/Applebot-Extended; disallow /dashboard,/pay/,/batch/,/api/agent/,
  /api/dashboard/; Sitemap line + llms.txt note); sitemap.xml (/, /docs, /workflows); index.html got
  canonical + link rel=alternate to /llms.txt + JSON-LD @graph (Organization, WebSite,
  SoftwareApplication with offers). server.js MIME_TYPES gained .txt + .xml (robots/sitemap serve as
  static ROOT files; resolveRequestPath returns unknown paths as-is). Verified live: robots.txt 200
  text/plain, sitemap.xml 200 application/xml, homepage JSON-LD present. PHASE 2 (NOT built) = the real
  ranking/GEO driver: crawlable intent landing pages (create USDC invoice / run AI workflows / create
  CV + find freelance gigs) with visible H1/H2 + FAQ + FAQPage JSON-LD + internal links, and a
  crawlable (SSR or static) workflow catalog (app pages are JS-rendered = crawler sees a shell today).
  Honest: on-page is code; Google ranking also needs off-page (backlinks, authority, time). User to add
  Google/Bing Search Console + submit sitemap. GEO already works: ChatGPT browsing read /llms.txt +
  /api/workflows and correctly summarized Fundline + prices + x402 (user-confirmed).
- 2026-07: SEO/GEO Phase 2 (intent landing pages) DONE + live-verified (commit 2ff4f83). 3 crawlable
  content pages sharing landing.css (dark/gold, NO JS = crawler-friendly), each with H1/H2, how-it-works,
  feature cards, a VISIBLE FAQ + FAQPage + BreadcrumbList JSON-LD (schema matches visible text), and a
  CTA into the app: create-invoice.html (/create-invoice -> /app), ai-workflows.html (/ai-workflows ->
  /workflows), cv-gigs.html (/cv-gigs -> /workflows/cv-gig-match). Routes wired in resolveRequestPath;
  all 3 added to sitemap.xml (now 6 URLs); homepage footer Product column now links the 3 landing pages;
  each landing cross-links the others + Home + Docs. Verified live: all 3 return 200 with correct
  <title>. Homepage (/) unchanged as the single main page; landings are separate URLs for search/AI
  discovery. NEXT possible: SSR/static-ize the /workflows catalog (JS-rendered today so crawlers see a
  shell), more intent pages (SEO/proposal/crypto), <head> discovery link already added Phase 1. USER
  ACTION still needed: Google/Bing Search Console verify + submit https://fundline.xyz/sitemap.xml.

- 2026-07: REMOTE MCP SERVER hosted at POST /mcp (spec .claude/remote-mcp-spec.md; NOT pushed at
  time of writing - check git). User chose: host remote MCP (URL + API key), x402 payment (agent's
  OWN wallet), and transport T2 = the OFFICIAL @modelcontextprotocol/sdk (added as an APP dependency,
  ^1.29.0 - a deliberate deviation from the buildless/no-dep principle, user accepted; it is
  Anthropic's official MCP SDK, MIT, CJS-requireable). server.js: route POST/GET /mcp -> handleMcp;
  auth via optionalAgentApiKey (Bearer/X-API-Key required); LAZY require of the SDK inside the handler
  wrapped in try/catch -> 503 if the dep is not installed (so the site stays up on cPanel until
  `npm install` runs there). Uses the low-level Server + StreamableHTTPServerTransport in STATELESS
  mode ({sessionIdGenerator: undefined, enableJsonResponse: true}) - VERIFIED live locally that
  initialize / tools/list / tools/call all work statelessly (no session needed) returning JSON. Two
  MCP tools: list_workflows({query}) and run_workflow({slug,tier,prompt,payment?}). Tool handlers call
  THIS server's own endpoints in-process via fetch to http://127.0.0.1:PORT (/api/workflows and /run),
  forwarding the caller's API key header; run_workflow with no payment returns the x402 402 quote as
  a "pay then call again" text, with payment={payerWallet,txHash} sends X-PAYMENT and returns output.
  Non-custodial: no wallet server-side; agent pays from its own wallet. LOCAL TEST PASSED: initialize
  -> capabilities; tools/list -> 2 tools; tools/call list_workflows?q=research -> 3 workflows;
  no-auth -> 401. npm audit: `npm audit fix` (non-force) applied (fixed ws high); 2 remaining
  (tmp/solc, offline-only, fixing needs --force which downgrades solc = skip). DEPLOY IMPACT: (1) CI
  `npm ci` now installs the SDK (package.json + package-lock committed, in sync); (2) node_modules is
  FTP-excluded so cPanel needs `npm install` on the Node app + restart to get the SDK (else /mcp -> 503,
  rest of site fine). docs.html #agent-api got a "Remote MCP server" section (client config + x402
  note + mcp-remote bridge caveat). NOT tested against real MCP clients (Claude Desktop/Hermes/OpenClaw)
  or a real x402 run yet. examples/mcp-server/fundline-mcp.js (the earlier LOCAL stdio MCP) still exists
  as the local-install alternative.
- 2026-07 FOLLOW-UP (agent self-onboarding): (a) /mcp auth is now OPTIONAL (keyless allowed;
  present-but-invalid key still 401) so an agent needs NO Fundline account - just a funded wallet
  paying via x402. (b) NEW GET /llms.txt (handleLlmsTxt) = machine-readable self-onboarding guide
  (what Fundline is, discovery endpoints, MCP URL, x402 pay steps, escrow alt, docs link) so an
  agent told "go to fundline.xyz" can read + self-configure. (c) Nav "Soon" flipped to live in
  app.html + workflows.html only (the app-shell sidebar; dashboard.html/index.html never had the
  nav-group-soon block): removed nav-group-soon + soon-badge, converted API keys->/dashboard,
  Webhooks->/dashboard, Docs->/docs, Agent API->/docs#agent-api (remaining Agents children Access
  Keys/Runs/Settings left disabled = not built as pages). VERIFIED LIVE on fundline.xyz earlier:
  /api/config billing on, GET /mcp 200, /api/workflows + ?q= work, POST /mcp no-auth/bad-key 401.
  After this deploy: keyless /mcp + /llms.txt live. Irreducible human step remains: the agent needs
  a funded wallet (money origin). All pushed.

- 2026-07: AGENT DISCOVERY + MCP SERVER + rate-limit hardening (all pushed to main, commits
  0e5ba55 discovery, ffdd52c keyword search, ee09f5f limits, a93a541 MCP). Continues the Agent API.
  (1) NEW public endpoint GET /api/workflows[?q=keyword] (handleWorkflowList, gated on
  WORKFLOW_RATE_LIMIT_ENABLED, GET only) = discovery menu: [{slug, name, tiers:{normal/plus/pro:
  {units,usdc}}}] + billingEnabled/chainId/usdc; ?q= filters slug+name case-insensitive. So an
  agent can search/choose a workflow, not be handed a fixed slug. (2) RATE-LIMIT SECURITY FIX
  (user caught it): per-key spend cap was $10/day == the global $10 budget, so ONE key (paying free
  testnet USDC in beta while v98 cost is real USD) could drain the shared global budget and DoS
  everyone. Lowered per-key defaults WELL BELOW global: WORKFLOW_KEY_RUNS_PER_DAY 500->100,
  WORKFLOW_KEY_SPEND_PER_DAY_USD 10->2 (so ~5 wallet-signed keys needed to approach the $10 global;
  same cap applies to x402 payers keyed on "x402:"+payer). Root cause is beta=testnet (free spam);
  mainnet real USDC makes runs self-funding. All tunable via env (.env.example documents the KEY vars).
  (3) MCP SERVER for autonomous agents (Hermes Agent, OpenClaw, Claude Desktop, Cursor all use MCP):
  examples/mcp-server/fundline-mcp.js exposes tools list_workflows / run_workflow / wallet_info over
  stdio (low-level @modelcontextprotocol/sdk API, no zod). run_workflow does discover->pay->run and
  returns the output. Shared discover/pay/run logic factored into examples/fundline-agent-core.js
  (initCircle/listWorkflows/getConfig/runEscrow/runX402/payAndRun/getWalletAddress/getUsdcBalance);
  circle-agent-demo.js refactored to use it (DRY). Non-custodial: operator's Circle + Fundline keys
  live in the MCP server's OWN env (their machine); Fundline never sees them. MCP + Circle SDKs are
  integration-only deps (npm i in examples/mcp-server/), NOT added to the app package.json (app stays
  buildless). examples/README documents MCP setup + a Claude Desktop mcpServers config block.
  Two compatibility levels: (L1) plain HTTP + Bearer/X-API-Key works with ANY framework today;
  (L2) MCP = plug-and-play for MCP clients. VERIFIED: node --check all; core requires clean (dynamic
  imports so Circle SDK not needed until initCircle); no em dash/emoji/secret. NOT tested live (needs
  Circle creds + funded wallet + server billing on).

- 2026-07 (approx): AGENT API v1 built. Spec `.claude/agent-api-spec.md`. Lets an AI agent
  (headless + own Arc wallet) create invoices and run workflows via HTTP with an API key. Decision:
  workflow-run payment = ESCROW-FUND HEADLESS (agent funds its own per-run escrow from its own wallet
  -> reuses the exact existing billing / verify / release / refund; non-custodial preserved). INVOICES
  were already done (POST /api/agent/invoices, X-API-Key, idempotency, paymentLink). Changes:
  (1) WIRED the API-key issuance routes that existed but were never routed: GET/POST
  /api/dashboard/api-keys + DELETE /api/dashboard/api-keys/:id{16hex}, under requireSellerAuth
  (wallet-signature); handleDashboardApiKeys takes (req,res,wallet,url). (2) NEW optionalAgentApiKey(req)
  (exported) = non-fatal requireAgentApiKey: validates a key IF present (Bearer or X-API-Key), never
  writes a response; returns {present, ok, sellerId, rateKey}. Absent -> present:false (keeps browser
  IP path). Applied to /run + /quote: present-but-invalid -> 401; valid -> key rate limit + JSON mode.
  (3) JSON (non-SSE) mode on /run: jsonMode = agentAuth.ok || input.stream===false; skips SSE writeHead,
  sendSSE no-op, result -> sendJson(200,{output,steps,cvJson,costUsd,releaseTx,memo,runId,remaining,
  resetsAt}), error -> sendJson(502). Browser (no key) unchanged = SSE. (4) WORKFLOW_KEY_LIMITS
  (runsPerDay 500 env WORKFLOW_KEY_RUNS_PER_DAY, spend $10/day, same global daily budget backstop),
  keyed on "key:<hash>"/"key:global". (5) Dashboard key UI existed in dashboard.js but was broken
  (wrong fetchApi signature) + had NO HTML + never called on nav: fixed the fetchApi calls, ADDED the
  dashboard.html section (nav data-view=apikeys + newApiKeyBtn/apiKeyForm/newApiKeyDisplay/
  newApiSecretInput/apiKeysList/copyApiSecretBtn), trigger loadApiKeys()/loadWebhooks() on nav click
  (guarded by session.wallet; webhooks previously only loaded after create/delete = fixed). (6)
  docs.html #agent-api extended: get key + run-a-workflow flow (config->quote->approve+fund->run JSON)
  with curl, placeholders only. Test test_agent_api.js (12; exports optionalAgentApiKey +
  requireAgentApiKey). VERIFIED OFFLINE: node --check app+server+dashboard; test_agent_api 12/12,
  cvgig 27/27, gig_sources 21/21; requires clean; no em dash/emoji/secret. Global admin key still =
  FUNDLINE_API_KEY / ARC_INVOICE_API_KEY (agentSellerId null = unscoped). Agent runs still need the
  same cPanel env (WORKFLOW_RATE_LIMIT_ENABLED + escrow + treasury + V98) to work live (testnet beta).
  FUTURE (not v1): x402 for runs, prepaid on-chain credit balance per key.

- 2026-07: x402 FOR WORKFLOW RUNS built (user prioritized it right after the agent API; the
  earlier "future" note is now done). Spec in `.claude/agent-api-spec.md` Part 3. Also a Circle
  Wallet integration spec `.claude/circle-wallet-integration-spec.md` (agent brings its OWN Circle
  Developer-Controlled Wallet, non-custodial). Circle demo NOW BUILT (commit 2faff1d):
  examples/circle-agent-demo.js + examples/README.md (standalone agent, @circle-fin/developer-controlled-
  wallets demo-only dep NOT in package.json, modes escrow + x402, reads creds from env, ARC-TESTNET,
  createContractExecutionTransaction approve/fund/transfer, polls getTransaction; NOT tested live). x402
  runs: handleWorkflowRun now has THREE payment modes when billing on: (a) X-PAYMENT header -> x402
  settle (verify a direct USDC transfer of the exact tier price to ARC_TREASURY_ADDRESS via
  findPaymentInRpcReceipt requireInvoiceReference:false; consume the txHash so it settles one run;
  run; on failure treasury refunds via a plain USDC transfer back); (b) runId -> escrow (unchanged);
  (c) neither -> HTTP 402 challenge {accepts:[{scheme exact, network eip155:chainId, maxAmountRequired
  = priceUnits, asset USDC, payTo treasury, resource, extra:{slug,tier}}]}. x402 forces jsonMode + sets
  X-PAYMENT-RESPONSE header (base64 {txHash}) on success. Rate-limited on "x402:"+payer with
  WORKFLOW_KEY_LIMITS + global budget. NEW: run-escrow-client.transferUsdc(to,amount) (treasury-signed
  plain USDC transfer, only for x402 refunds; added usdcAddress to client config = ARC_USDC_TOKEN_ADDRESS);
  data/workflow-payments.json consumed-txHash store (isRunPaymentConsumed/consumeRunPayment/
  markRunPaymentRefunded); unitsToUsdcString(units,dec) exact base-units->decimal string (inverse of
  amountToUnits) so the verifier gets a decimal amount. Trade-off (user accepted): x402 refund is a
  treasury transfer back (less trustless than the escrow's contract-guaranteed refund); escrow stays
  available for agents wanting trustless refund. Docs.html #agent-api got a "Pay per call with x402"
  section (challenge+settle curl). Test_agent_api.js now 17 (added unitsToUsdcString roundtrip).
  VERIFIED OFFLINE: node --check server+run-escrow-client; test_agent_api 17/17, test_run_escrow 179/179
  (no regression), cvgig 27/27; requires clean. NOTE: browser SSE path unchanged (no key, runId ->
  escrow). x402 only activates when billing on (escrow+treasury+usdc configured) in cPanel env.
  STILL FUTURE: Circle Gateway nanopayments (prefund once, gasless per run) for high-frequency agents.

- 2026-06-30: NEW WORKFLOW "CV + Freelance Gig Match" (slug cv-gig-match) BUILT v1, NOT pushed,
  NOT live-tested. Spec: `.claude/workflow-cv-gigmatch-spec.md`. This is the FIRST workflow with a
  CUSTOM executor (not the generic node-graph engine) because it fetches real gigs from external
  APIs and returns a structured cvJson. New files: `gig-sources.js` (3 gig APIs -> one normalized
  shape: Freelancer.com [free,no auth,PRIMARY] + Hacker News Algolia [free] + JSearch/OpenWeb
  Ninja [key ak_..., ON-DEMAND, ~200/mo cap]; injected getJson for tests; merge/dedupe; a failing
  source is skipped not fatal), `workflow-cvgig.js` (executor: profile extract [FAST] -> deterministic
  template select -> CV JSON [STRONG, retry once on bad JSON, minimal fallback] -> gig fetch [free
  first; JSearch top-up only when free <5 AND under cap] -> rank+proposal [STRONG]; injected
  callModel+fetchGigs; returns {report,cvJson,gigs,steps,totalCostMicros,meta}), `cv-render.js`
  (BROWSER: builds self-contained styled HTML CV from cvJson + opens print-ready tab -> Ctrl/Cmd+P
  Save as PDF; 2 CSS templates classic/modern; window.FundlineCV.openCv/buildHtml). DECISION: CV is
  HTML/CSS+print (design quality, like Reactive Resume), NOT the invoice hand-rolled PDF primitives
  (user wanted "dep, co gu"); invoice PDF path untouched. server.js: WORKFLOW_RUN_DEFS["cv-gig-match"]
  = {type:"cvgig", name, tiers normal/plus/pro 20000/30000/60000 (0.02/0.03/0.06 USDC) = MEASURED
  live 2026-06-30 (real v98 cost normal $0.0041 deepseek-v3.2 / plus $0.0073 gpt-4.1-mini / pro
  $0.0303 claude-sonnet-4-6; models differentiated per tier), monotonic}; handleWorkflowRun branches on def.type==="cvgig" (relaxed the
  !graph 501 check for it) -> cvGig.runCvGigWorkflow, else the engine; SSE result now carries cvJson;
  JSEARCH_API_KEY + JSEARCH_MONTHLY_CAP(180) env + data/jsearch-usage.json monthly counter
  (jsearchUnderCap/bumpJsearchUsage, bumped only when JSearch actually ran). workflows.js: WORKFLOWS
  ["cv-gig-match"] live entry (category Freelance, usesRetrieval false, 4 steps serverKeys
  profile/cv_writer/gig_search/ranking matching executor onProgress); showRunResult appends a
  "View CV (save as PDF)" button when data.cvJson present -> FundlineCV.openCv. workflows.html loads
  /cv-render.js before workflows.js (static server serves any ROOT file by ext, FTP includes new .js).
  EXCLUDED sources (say so in UI): Upwork/Fiverr/Facebook/LinkedIn (API limits). Grok/X = phase 2
  (xAI direct, NOT v98; $25/1000 X sources; deferred). Adzuna = documented 4th-source fallback (key
  app_id c9bb89bc already available). VERIFIED OFFLINE: node --check all; test_gig_sources.js 21/21 +
  test_workflow_cvgig.js 27/27 (new); server requires clean; frontend catalog builds 27 in vm sandbox
  (cv-gig-match live, steps + tier prices correct); no regression I caused (v98_cost 5-fail +
  research 1-fail are PRE-EXISTING, v98-models.js/workflow-research.js untouched - confirmed via git).
  LIVE MEASURED 2026-06-30 via measure-cvgig.js (real v98 + real gig APIs, all 3 tiers ran clean;
  free sources Freelancer.com 15 + HN 15 = 30 gigs so JSearch on-demand NOT triggered = quota saved;
  normal deepseek returned only 3 ranked gigs vs 8 for plus/pro = acceptable cheap-tier quality; cv
  name was "" only because the test input had no name = no-fabrication rule working). STILL TODO
  before ship: (1) OPTIONAL on-chain e2e (quote->fund->run->release) - generic billing already proven
  by test_billing_e2e_dryrun.js so not strictly needed; (2) confirm JSearch real monthly quota on
  dashboard; (3) predeploy-check; (4) cPanel env add JSEARCH_API_KEY (+ optional JSEARCH_MONTHLY_CAP)
  then restart. measure-cvgig.js kept in repo (scratch, no secret; JSearch key passed via env at run).
- 2026-06-30 (follow-ups after first push): (a) INPUT is now a structured multi-field FORM for
  cv-gig-match (wf.fields array on the WORKFLOWS entry -> renderRunPanel + run handler branch, mode/
  gen wiring guarded for null); 12 fields (name/title/email/location/links/skills/experience/
  projects/education/certifications/languages/lookingFor), gathered into labeled lines as the run
  input so extraction is accurate + CV name/contact fill. (b) "View CV" button added INSIDE the
  result modal header (openResultModal now takes cvJson) - it was only in the receipt behind the
  auto-opened modal. (c) CV RENDER REWRITTEN: cv-render.js now opens a self-contained INTERACTIVE
  page with a toolbar = 6 templates (Modern/Classic/Minimal/Header/Compact/Elegant) + 6 accent
  colors + client-side photo upload (base64, NEVER sent to server) + Save as PDF; switching re-
  renders instantly and is FREE (content produced once). cvJson.templateId only sets the initial
  template. All inline/self-contained. User decisions: live switcher (not pre-pick), 6 quality
  templates (not 10), photo client-side. Commits d500f36 (form) + b46cb1f (modal button) + 5dc80b4
  (6-template renderer), all pushed. selectTemplate still returns modern/classic as the initial only. Templates: v1 = classic + modern only (technical
  deferred). API keys the user pasted in chat (JSearch ak_ukm..., Adzuna app_id c9bb89bc + key
  4a5b...) SHOULD be rotated (exposed in chat) and set in cPanel env, never committed.

- 2026-06-29: WORKFLOW LIBRARY = 15 workflows on a GENERIC ENGINE (committed local df4d3d0 +
  775584f + a0611e0, NOT pushed). Replaced the single hardcoded research chain with a
  data-driven node-graph engine so new workflows are CONFIG, not new server branches. New
  files: `workflow-engine.js` (runWorkflowGraph: runs nodes in order, resolves each node's
  alias->model via the active tier, kinds llm/retrieval/local, feeds prior outputs forward,
  emits SSE progress per node.id, sums micro-USD cost, returns {report,steps,totalCostMicros,
  outputs}); `workflow-defs.js` (the 15 graph definitions + getGraph + graphAliases). server.js:
  `handleWorkflowRun` no longer gates on `def.type==="research"` -> looks up `workflowDefs.getGraph(slug)`
  and dispatches via the engine; WORKFLOW_RUN_DEFS gained a WORKFLOW_TIER_MODELS matrix
  (aliases FAST/STRONG/RESEARCH/CODE/FORMATTER -> real ids per tier) + WORKFLOW_PRICE_BANDS
  (light 0.03/0.05/0.10, medium 0.04/0.06/0.12, heavy 0.05/0.08/0.15) + workflowTiers() helper;
  14 new slugs built via a loop that derives each tier's model map from the graph's required
  aliases (graphAliases) so models always match the chain. client-research KEPT its explicit
  proven model map (normal writer is deepseek-v3, not v3.2) and uses the original research prompt
  builders verbatim. Frontend workflows.js: stripped the 5 mock entries (via a brace-matching
  scratch script), kept client-research, and built the other 14 from compact specs through a new
  makeWorkflow() builder (WF_TIER_MODELS + WF_PRICE_BANDS mirror the server; node `key` ==
  server node id, cross-checked). 15 slugs: client-research, call-recap, proposal-sow,
  market-pain-research, code-review, upwork-proposal, rfp-proposal, cold-outreach,
  follow-up-nurture, timeline-from-sow, handover-report, seo-content-brief, seo-audit,
  keyword-strategy, pr-diff-review. Retrieval (RESEARCH alias, web/paste) on: client-research,
  market-pain-research, seo-content-brief, seo-audit. STT dropped (no STT model in v98 -> paste
  transcript text). PR review = paste diff (no GitHub OAuth). VERIFIED OFFLINE: node --check all;
  test_workflow_engine.js 93/93 (engine parity with old research chain = exact cost 20899; every
  graph smoke-runs; alias coverage), test_workflow_research.js 23/23, v98 cost 14/14, limiter
  23/23; frontend catalog builds 15 in a vm sandbox; no em dash/emoji/secret/decimal-hazard in
  the diff. predeploy verdict GO. NOT PUSHED. Live e2e (quote->fund->run->release) skipped per
  user (parity test covers it). TO DEPLOY: git push origin main (FTP auto-deploys the new modules
  workflow-engine.js + workflow-defs.js too) THEN restart the cPanel Node app (server.js changed;
  touch tmp/restart.txt or restart in cPanel) so the new WORKFLOW_RUN_DEFS + engine load. cPanel
  env already has the runner keys from the 2026-06-28 deploy, so all 15 go live on restart; each
  workflow charges its tier price via the existing FundlineRunEscrow billing. Prompts are decent
  beta quality but not yet tuned against real outputs.
- 2026-06-29: TAVILY REMOVED (commit ccc434e, local). It was never wired into the run path -
  retrieval nodes do web search via the RESEARCH-alias search model (grok-deepsearch / grok-4 /
  deepseek-r1-searching) directly; paste mode uses user sources. Deleted tavily-client.js, the
  unused server.js require, and TAVILY_API_KEY from .env.example; updated public docs.html +
  index.html diagram + create-workflow skill. cPanel no longer needs TAVILY_API_KEY (harmless if
  left). Older memory entries below that mention Tavily are historical (pre-removal).

## Latest work (read first) - continued

- 2026-06-29: CATALOG EXPANDED to 26 workflows + dynamic category filter (commit ab25edd +
  test fix, NOT pushed). Added 11 workflows via the same engine pattern (graph in
  workflow-defs.js + WORKFLOW_BANDS entry in server.js + WF_CATALOG entry in workflows.js,
  serverKeys cross-checked): Content = x-thread-writer, newsletter-writer, linkedin-post;
  Crypto = crypto-research (retrieval), tokenomics-analyzer, whitepaper-summary, narrative-scan
  (retrieval); Business = competitor-analysis (retrieval), gtm-plan, lean-canvas, swot-analysis.
  Retrieval workflows now total 6 (also client-research, market-pain-research, seo-content-brief,
  seo-audit). UI FIX: the explore category filter was a HARDCODED list (All/Freelance/Content/
  Research/Code/Crypto/Business) - replaced with a list DERIVED from the actual workflows
  (`["All"].concat(unique categories sorted)`), so every category with workflows gets a chip
  (previously SEO/Proposal/Sales/Operations/Delivery/Client Communication had none) and the
  Content/Crypto/Business chips are no longer empty. `.wf-filters` + `.wf-explore-top` already
  had `flex-wrap: wrap` so chips wrap to new lines (no horizontal scroll) - no CSS change needed.
  Verified: engine smoke test 148/148 (26 graphs run, step/progress counts, alias coverage),
  serverKeys match node ids (14+11), frontend builds 26 in vm sandbox, server requires cleanly,
  no em dash/emoji. Also earlier this session: result download is now a formatted Word .doc
  (buildWordDoc, commit 54524ed, pushed) instead of raw .md.

## Latest work (read first) - QA + pricing pass

- 2026-06-30: ALL 26 workflows RUN LIVE (real v98), quality-reviewed, prompt-tuned, and
  PRICED from measured per-mode cost (8 commits 6a5934d..5411e77, NOT pushed). Process per
  user: build -> run each mode real -> review quality -> tune prompts (now carry a fixed
  output-length directive) -> measure real cost -> round down to a clean USDC value
  (user-favorable, floor 0.01) -> save tuned prompts so cost stays ~constant. Tools added:
  run-workflow-once.js (real run: per-node tokens + output + 3-tier cost) and
  estimate-workflow-cost.js (offline pre-check). Prices live in WORKFLOW_PRICE_OVERRIDES
  (server.js, units) + WF_PRICE_OVERRIDES (workflows.js, display); client-research display is
  hand-edited (not in WF_CATALOG). FINAL PRICES (normal/plus/pro USDC): call-recap .01/.01/.02,
  proposal-sow .01/.01/.08, client-research .03/.03/.06, market-pain-research .03/.03/.06,
  code-review .01/.01/.05, upwork-proposal .01/.01/.02, rfp-proposal .01/.01/.03, cold-outreach
  .01/.01/.03, follow-up-nurture .01/.01/.02, timeline-from-sow .01/.01/.04, handover-report
  .01/.01/.03, seo-content-brief .06/.06/.08 (2 web searches), seo-audit .03/.03/.06,
  keyword-strategy .01/.01/.03, pr-diff-review .01/.01/.06, x-thread-writer .01/.01/.01,
  newsletter-writer .01/.01/.03, linkedin-post .01/.01/.01, crypto-research .03/.03/.06,
  tokenomics-analyzer .01/.01/.02, whitepaper-summary .01/.01/.02, narrative-scan .03/.03/.06,
  competitor-analysis .03/.03/.05, gtm-plan .01/.01/.02, lean-canvas .01/.01/.02, swot-analysis
  .01/.01/.02.
- WEB SEARCH: v98 dedicated search models (deepseek-r1-searching, grok-3-deepsearch, grok-4-fast)
  are DEAD (503). Use `gpt-4o-mini-search-preview` for the RESEARCH alias (all tiers) - it does
  REAL live browsing (returns real source URLs with utm_source=openai). `gpt-5-search-api` also
  works; gpt-4o-search-preview / o4-mini-deep-research are 429 rate-limited. The 7 retrieval
  workflows (client-research, market-pain-research, seo-content-brief, seo-audit, crypto-research,
  narrative-scan, competitor-analysis) now return real citations. v98-models.js added these search
  models with a `perCallUsd` surcharge (~$0.027, the search fee dominates token cost) and
  computeCostMicros applies it. CAVEAT: perCallUsd + group_ratio=1 are estimates; confirm real
  charge on the v98 dashboard (the global $10/day budget cap is the backstop).
- SYSTEMIC FIXES during the pass (benefit all): formatter no longer truncates (step() gives the
  isFinal node a 4096 cap and NO length directive; the cheap FORMATTER model makes this ~free);
  table/list nodes output the bare table/list (no preamble or code fence); FORMATTER_SYSTEM and
  the X-thread/LinkedIn prompts forbid emojis (brand rule); v98-client retries 429 up to 5x with
  1s..16s backoff (web-search models rate-limit harder; prevents spurious run failures + refunds).
- PROCESS RULE (user): every NEW workflow must run this loop (run live per mode -> review -> tune
  -> measure -> price -> save prompts) BEFORE publishing. Token counts are NOT perfectly
  tier-independent (stronger models like claude write longer), so measure each mode for real.
- NOT PUSHED yet: 8 commits on main local. Pushing auto-deploys (FTP + Passenger restart). Prod
  still needs WORKFLOW_RATE_LIMIT_ENABLED + keys in cPanel for workflows to leave "coming soon".

## User preferences (observed)

- Communicates in Vietnamese and wants my replies in Vietnamese.
- Wants a modular `.claude/` setup: rules in `.claude/rules/`, subagents in
  `.claude/agents/`, and this memory file. Prefers following the real Claude Code spec.
- When redesigning UI: "giu nguyen phong cach, chi fix layout" - keep the existing
  dark/gold visual language, only fix layout, spacing, and responsive issues.
- Cares about minimizing context usage; favors delegating heavy reads to subagents.

## Key decisions

- 2026-06-18: Integrated the product master doc into the project context. Added two
  subagents (escrow-engineer = writer for FundlineEscrow + deploy script + /api/config;
  trust-layer-architect = read-only phase-2 designer) and an escrow audit checklist to
  contract-auditor; 7 agents total now. New auto-load rule `escrow-spec.md`. Strategy depth
  distilled to `../../fundline-product-master.md` kept OUTSIDE the repo (user choice, to
  avoid committing competitive/GTM content). Added `**/.claude/**` and `**/CLAUDE.md` to the
  deploy.yml FTP exclude so dev tooling/notes are not served on fundline.xyz. Reconciled the
  data-file list to 8 files (invoices, sellers, products, webhooks, webhook-logs,
  payment-attempts, api-keys, events).
- 2026-06-18: Full UI redesign committed (`fc867a1`): styles.css, docs.css, home.css synced
  to dark/gold theme; dashboard.html and storefront.html refactored from inline styles to
  CSS classes; index.html footer expanded to 3 columns with Network links.
- 2026-06-18: Bug fix committed (`7cbdb47`): `syncInvoicesFromServer()` in app.js now
  returns early with `state.invoices = []` when no wallet is connected. Previously it
  called `/api/invoices` without a merchantWallet filter and returned ALL invoices from
  the server to any unauthenticated visitor.
- 2026-06-17: Split the monolithic CLAUDE.md into 8 topic files under `.claude/rules/`
  (auto-load, no `paths:` frontmatter). CLAUDE.md is now a slim index plus a
  critical-rules safety summary. Did NOT `@import` the rules - they auto-load, and
  importing would double-load them.
- 2026-06-17: Landing-page layout fix (home.css / styles.css / index.html): smaller
  --section-y, removed nowrap overflow on section titles, showcase grid to 2x2, removed
  background-attachment:fixed, unified accents to gold (removed cyan leakage), fixed the
  stats-grid tablet breakpoint, moved Telegram mockup inline styles to CSS classes.
- 2026-06-18: Created 5 project subagents in `.claude/agents/` - fundline-explorer
  (read-only navigator), contract-auditor (opus, Solidity security), backend-api-dev,
  frontend-ui-dev, diff-reviewer (read-only pre-commit). Added this memory.md and
  `@import`-ed it from CLAUDE.md so it loads each session.
- 2026-06-18: Feature audit + fixes committed `01998bd` (pushed to main -> deploy). Verified
  ALL on-chain constants against official docs: Arc chainId 5042002, USDC 0x3600..0000, CCTP
  TokenMessengerV2 0x8FE6..2DAA, MessageTransmitterV2 0xE737..CE275, and Arc CCTP domain 26 are
  CORRECT (domain 26 confirmed in Circle's ETH->Arc quickstart code sample; a web summary saying
  "domain 7" was wrong - 7 is Polygon PoS). depositForBurn V2 selector 0x8e0250ee verified by
  keccak. Fixed a real float bug: server.js amountToUnits used Number.toFixed which skewed the
  18-decimal native compare (0.1 -> 1e17+6); rewrote as exact BigInt string math mirroring
  app.js parseTokenUnits so client and server agree. Added finite + <=1e12 guard on
  invoice.total (catches Infinity from oversized API input, closes an exponential-notation parse
  hole). Added test_amount_units.js (452 assertions). Validated by a 4-lens adversarial review
  workflow (verdict: ship).
- 2026-06-18: Telegram 401 Unauthorized on fundline.xyz. Code is correct and the .env token is
  valid (getMe ok, test send delivered). Root cause: a stale/revoked token held by a running
  server process. The cPanel server has its own env (.env is FTP-excluded), so the LIVE fix is
  to update TELEGRAM_BOT_TOKEN in the cPanel Node.js app and restart it - not a code change.
  Hardened anyway: validateTelegramToken() runs getMe at boot and logs a loud error on 401;
  sendTelegramMessage returns an actionable message on 401. Note loadEnvFiles is first-wins, so
  an OS env var shadows .env.
- 2026-06-18: Telegram paid-alert fix committed `027e683` (pushed). The invoice.paid branch in
  dispatchInvoiceTelegramAlert was gated by invoice.telegramEnabled (Boolean(input.telegramEnabled),
  defaults false, NOT inherited from seller settings), so paid alerts were suppressed for sellers
  who only configured account-level Telegram (chatId + alerts.paid:true). The failed/overdue
  branches never had this gate. Fixed by gating paid on alerts.paid only (chatId already required
  above). Verified on real data + a 3-lens adversarial review (verdict: ship). The test-alert
  button works regardless because it uses force + the in-browser chatId. Residual (low): the
  per-invoice telegramEnabled flag is now DEAD for paid alerts (still stored, never read, no
  longer an opt-out) - removed in `cafb03a`. The sellers[merchantWallet] lookup is case-safe
  (normalizeAddress lowercases both the invoice wallet and the seller key).
- 2026-06-18: Removed the dead per-invoice telegramEnabled flag committed `cafb03a` (pushed).
  state.settings.telegramEnabled was never set (not in readSettingsDraft/defaults/server load),
  so the flag was always false and dead on both sides. Dropped it from normalizeInvoice and the
  app.js create payload; the client sendPaymentNotification now sends only on an explicit test
  (force) since real paid alerts are sent server-side (avoids duplicate messages). Also replaced
  5 pre-existing em dashes in app.js with hyphens to satisfy the no-em-dash rule.

- 2026-06-18: Part B (Arc payment flow) completed. Testnet dry-run verified (`test_multicall_dryrun.js`):
  Tx1 approve (35k gas) + Tx2 payInvoice (52k gas), InvoicePaid payer==signer confirmed on Arc testnet.
  Root finding: Multicall3From's CallFrom precompile (0x1800...0003) throws StackUnderflow for ANY
  subcall target (both USDC precompile 0x3600... and regular contracts like PaymentRouter). The 1-tx
  [approve+pay] batch is not viable on current Arc testnet.
  Final implementation: 2-tx flow -- if allowance < amount, send direct USDC.approve (via sendUsdcApprove)
  + waitForArcTx (60x3s polling), then send direct PaymentRouter.payInvoice (via sendRouterPayment).
  If allowance >= amount: 1-tx direct payInvoice (unchanged). Dead code removed from app.js:
  encodeMulticall3Batch, sendMulticall3FromPayment, MULTICALL3FROM_ADDRESS, MULTICALL3_AGGREGATE3_SELECTOR.
  ABI encoding bug ALSO fixed (baseOffset = N*32 not (1+N)*32 -- offsets relative to head section start,
  not array start). 25-assertion unit test in test_multicall_pay.js validates the correct ABI encoding.
  Arcscan approve: 0x4eaa2f4137aeb5242e265b5797bb10981c5b948d8899ae549f38c4ce2d3b12a3
  Arcscan pay:     0x3f8888cccbbf2ef86943ef57f3be4326419588999594ad7109e043196dc526ed
- 2026-06-18: Circle Gateway PARKED, removed from client UI. Built Part A end-to-end (server
  proxy 30bb820, client flow 5fa5aca, fee fix 8057733) and dry-ran ETH Sepolia (domain 0) ->
  Arc on testnet. Decision: Gateway is the WRONG default for invoice payers. A one-off payer
  must wait for deposit finality (~19 min on ETH Sepolia/Ethereum) before the unified balance
  is spendable, so first payment is no faster than CCTP Standard -- they abandon. Gateway only
  wins for REPEAT payers who pre-fund a balance (then each transfer is <500ms, gasless on Arc).
  Product direction (user choice): CCTP Fast Transfer is the sole cross-chain path for one-off
  payers (~8-20s); direct Arc pay when funds already on Arc. CCTP Fast was ALREADY implemented
  in app.js (resolveCctpFee fast=true -> IRIS fee tier, finalityThreshold 1000, maxFee capped
  at 1%, fallback to Standard) and wired as the default bridge-pay path -- no new work needed.
  Removed from app.js (1 commit, -323 lines): GATEWAY_* constants, gateway-* payment options,
  the gateway branch in refreshPaymentSourceStatus, gateway- prefix in getPaymentSourceChain,
  the gateway-pay action, and all 6 gateway helpers (readGatewayBalance, buildGatewayBurnIntent,
  pollGatewayTransferStatus, pollForGatewayBalance, gatewayPayInvoice, _retryGatewayPay). Also
  deleted duplicate addressToBytes32/randomBytes32 (Gateway had re-declared them; originals at
  the bottom of app.js survive and CCTP uses those). KEPT for later revival: server.js proxy
  routes + public-config gateway fields, test_gateway_dryrun.js, test_gateway_finish.js.
  Testnet constraints found for the ETH Sepolia -> Arc route (recorded for revival): min maxFee
  is 1 USDC (not 0.5), the API enforces a maxBlockHeight floor ~50k blocks above a lagging
  public RPC head (read "expected at least N" from the 400 and re-sign at N+buffer), and the
  balance reservation is value + maxFee (so 1.5 USDC deposit only covers value <= 0.5 at the
  1 USDC fee floor). No public-facing page ever referenced Gateway; only app.js did.
- 2026-06-18: CCTP Fast Transfer verified end-to-end on testnet (`test_cctp_fast_dryrun.js`).
  ETH Sepolia (domain 0) -> Arc (domain 26), 0.5 USDC. Fast tier confirmed live for both
  routes via the IRIS fee API: Base Sepolia->Arc = 1.3 bps, ETH Sepolia->Arc = 1.0 bps
  (Standard tier 2000 is free). Round trip: burn (gas 109103) -> attestation ready in 11s
  (Fast soft finality, finalityThreshold 1000) -> receiveMessage mint on Arc (gas 175768)
  -> Arc balance +0.496345 USDC. Total wall-clock ~58s. KEY PROOF for the product concern:
  a one-off cross-chain payer is served in ~1 minute, not the ~19 min a Gateway deposit would
  need. Gotcha recorded: the Arc balance delta is below the 0.5 transfer because Arc's gas
  token IS USDC, so the wallet-sent receiveMessage tx pays ~0.0036 USDC gas out of the same
  balance (plus the tiny CCTP fee). The dry-run assertion was corrected to allow a ~2% band
  for fee + Arc gas. Burn tx 0xbe061144...d66215c, mint tx 0x341be3a2...edf37ac3.
- 2026-06-18: Arc Transaction Memos evaluated for Fundline (`test_memo_probe.js`). Arc shipped
  a predeployed Memo contract at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` (testnet, activated
  ~2026-06-13): `memo(address target, bytes data, bytes32 memoId, bytes memoData)` forwards a
  call to `target` via the CallFrom precompile (preserves the original EOA as msg.sender) and
  emits `Memo(sender, target, callDataHash, memoId, memo, memoIndex)` for offchain indexing.
  EOA-only callers; STATICCALL/DELEGATECALL unsupported; child revert rolls back the whole tx.
  PROBE RESULT (Arc testnet, tx 0x11068fb2...09225): memo-wrapped USDC self-transfer SUCCEEDED,
  gas 61548, USDC Transfer from==payer (msg.sender preserved), Memo event emitted with memoId.
  This UPDATES the Part B finding that CallFrom threw StackUnderflow: via the Memo contract,
  CallFrom WORKS on the current testnet. Implication: the single-transaction invoice payment
  Fundline abandoned in Part B (2-tx approve+payInvoice) is viable again as
  `Memo.memo(USDC, transfer(merchant, amount), onchainInvoiceId, memoBytes)` -- 1 tx, no approve
  (USDC.transfer pulls from the preserved payer), gas ~61.5k vs ~87k for the 2-tx flow. Memos
  could also let Fundline DROP the custom PaymentRouter (memoId carries the invoice id in a
  standard, indexable way; moots the verify-PaymentRouter-on-Arcscan TODO) and keeps the
  non-custodial invariant (Memo contract never holds funds; payer->merchant direct). Uses 6
  USDC decimals. Caveats: contract is new (audit/maturity unverified), mainnet address/availability
  not yet confirmed, no documented memoData size limit. NOT yet implemented -- architecture
  decision pending user direction; PaymentRouter still the shipped path.
  Follow-up validation (`test_memo_payment_dryrun.js`, tx 0x531dae2a...cecce0dd): the realistic
  Fundline shape PASSED end-to-end on testnet -- payer -> a DISTINCT merchant in 1 tx (gas 68158),
  merchant credited exactly 0.01 USDC, and the payment is reconcilable by invoiceId via
  eth_getLogs on the Memo contract (memoId is an indexed topic; the matched log resolved to the
  exact payment tx). Both candidate directions are de-risked: (a) client 1-tx memo payment, and
  (b) backend indexer reading Memo events by invoiceId.
- 2026-06-18: Arc Memo exact event ABI captured (for the indexer direction):
  `event Memo(address indexed sender, address indexed target, bytes32 callDataHash,
  bytes32 indexed memoId, bytes memo, uint256 memoIndex)`. Topic0 sig =
  0xeb15ee720798341c37739df41be53acfbbf70ae6802dade35457beec6e47a5e4; topics are
  [sig, sender, target, memoId]. Reconcile a single invoice with eth_getLogs
  topics=[MEMO_TOPIC, null, null, <invoiceId>]. Also `event BeforeMemo(uint256 indexed
  memoIndex)`. On child revert the outer tx reverts with `MemoFailed(bytes)` (no partial
  settlement). No documented gas/size limits.
- 2026-06-18: Arc App Kit evaluated (docs.arc.io/app-kit). App Kit (`@circle-fin/app-kit`)
  is a TypeScript/npm SDK suite with 4 modules: Bridge (wraps CCTP), Unified Balance
  (`@circle-fin/unified-balance-kit`), Swap, Send; adapters for Viem/Ethers/Solana/Circle
  Wallets. KEY FINDING: Unified Balance is explicitly "built on top of Circle Gateway" and
  "handles the Gateway workflow for deposits and spends" -- so it does NOT remove the
  deposit-finality wait; "instantly spendable" means after the deposit finalizes (the same
  Gateway model). It is cleaner CODE, not faster UX, so it does NOT change the decision to
  drop Gateway for one-off payers. BLOCKER to adopting App Kit now: it is an npm/TS SDK
  needing a bundler, but Fundline's frontend is deliberately buildless (vanilla app.js, manual
  ABI encoding, FTP to cPanel, CI only `node --check`). Recommendation: keep the hand-rolled
  CCTP Fast (works, zero deps); consider App Kit only if Fundline adds a build step or revives
  the repeat-payer Gateway path, where `@circle-fin/unified-balance-kit` + App Kit Bridge would
  be the clean implementations.
- 2026-06-18: Circle MCP server + Skills committed (`cc8af84`). .mcp.json adds project-level
  Circle MCP (HTTP transport, api.circle.com/v1/codegen/mcp) - must be approved in Claude Code
  UI before it activates. 4 skills (circle-use-arc, circle-use-gateway, circle-bridge-stablecoin,
  circle-use-usdc) saved to .claude/skills/ - invokable as /circle-use-arc etc. Note: user-scope
  MCP (claude mcp add --scope user) not possible without the claude CLI in PATH; project-level
  .mcp.json is the fallback.
- 2026-06-19: Auth/session persistence reworked to a true session model (working tree, NOT yet
  committed). Per user requirement: stay logged in across reload; log out ONLY on manual logout
  or when the browser profile closes; no prior-session invoices shown after logout. Root cause:
  login + cache lived in localStorage, which survives a browser restart (so #2 failed). Fix:
  moved ALL login/cache state from localStorage to sessionStorage. app.js - WALLET_SESSION_KEY,
  STORAGE_KEY (invoice cache), SETTINGS_KEY, and the shared SELLER_SESSION_KEY
  ("fundline_dashboard_session") now use sessionStorage; added purgeLegacyAuthStorage() (runs
  first in init()) to drop stale localStorage copies once. dashboard.js - the shared
  fundline_dashboard_session now in sessionStorage (+ one-time legacy localStorage cleanup at
  init). app.js and dashboard.js MUST stay in sync on that key (both read it). #3 already held:
  disconnectWallet() zeroes state.invoices and syncInvoicesFromServer() returns [] with no wallet.
  Trade-offs to remember: sessionStorage is per-tab (no cross-tab shared login); a browser
  "restore tabs / continue where you left off" setting can revive sessionStorage; existing users
  are logged out once after this deploys.
- 2026-06-19: Pre-existing CRITICAL syntax bug fixed in dashboard.js and storefront.js. Template
  literals had escaped backticks (escaped backtick and escaped dollar-brace instead of the bare
  forms), so BOTH files threw SyntaxError at load - dashboard.html and the public /s/:slug
  storefront ran NO JS at all (login, logout, products, webhooks, api-keys, buy-button all dead).
  Confirmed the committed HEAD was already broken (not introduced by me); likely an old automated
  edit script. Fixed by unescaping. node --check now passes for app.js, dashboard.js,
  storefront.js, home.js, server.js. patch_app.js (scratch one-off, NOT deployed) still fails
  node --check - left as-is. Residual, out of scope, NOT fixed: dashboard.js loadWebhooks() treats
  fetchApi() as a raw Response (checks .ok / await .json()) but fetchApi already returns parsed
  JSON, so webhooks/logs likely never render even now.

- 2026-06-19: Merchant-name UX overhaul + made the name persistent per wallet (working tree,
  builds on the session-auth commit d42ac90). Three parts: (a) the wallet-gate button on the
  create-invoice page now doubles as "Set up Telegram alerts" -> settings when a wallet is
  connected (previously it was hidden once connected); (b) removed validateSettings() so an
  invoice can be created immediately after connecting (no forced settings detour; server already
  defaults merchantName to "Fundline merchant"); (c) merchant name is now ONE value owned by the
  server per wallet: sellers[wallet].displayName. It is established by the first invoice that
  carries a real name (server first-write in POST /api/invoices) OR by the authenticated settings
  PUT (which overwrites); every later invoice inherits the established name and CANNOT rename it -
  only settings can change it. New PUBLIC endpoint GET /api/sellers/:wallet returns
  {wallet, displayName} (only the name, already public on invoices; telegram/alerts stay behind
  auth). Client (app.js/app.html): a "Your business name" field (.form-full) was added to the
  create-invoice form, prefilled from state.settings.merchantName and set READONLY once a name
  exists (change only in Settings); fetchSellerName() syncs the name after connect/sync;
  createInvoice adopts savedInvoice.merchantName; settings PUT now sends displayName and
  fetchServerSettings reads it. This RESOLVES the earlier caveat that settings (sessionStorage)
  lost the name on browser close - the name is now server-persistent per wallet. Verified by
  test_seller_name.js (15/15: first-write, no-rename-via-invoice, settings override, default
  "Fundline merchant" does not establish a name). node --check passes for all served JS + server.

- 2026-06-19: Memo-vs-PaymentRouter settlement decision (4-lens workflow: security, payer UX,
  strategy/lock-in, eng cost). VERDICT: keep PaymentRouter as the always-on settlement spine
  through the mainnet cutover; do NOT build Memo payer flows yet; later add Memo only as an
  OPTIONAL, feature-flagged, Arc-only 1-tx fast path with PaymentRouter fallback - never the sole
  path. Why PaymentRouter wins now: (1) mainnet readiness - router is verified on Arcscan, owned,
  immutable, deployable today; Memo has no confirmed mainnet address, no published audit, testnet-
  only since ~2026-06-13. (2) Non-custodial is a TIE (both payer->merchant direct), so it does not
  break the choice. (3) Stronger verify binding - InvoicePaid carries invoiceId+payer+merchant+
  amount+token in one event; the Memo event lacks merchant/amount so it needs a weaker 2-log
  re-pair (Memo log + a same-tx USDC Transfer). (4) Memo is EOA-ONLY -> hard-blocks Safe/multisig/
  smart-account payers (zero-conversion for that B2B segment), so it can never be the only path.
  (5) Portability - router is standard EVM + brand-owned event; Memo is Arc-specific (relevant to
  the "Fundline Router" branding idea: router stays, so that name still makes sense). Memo's real
  win is narrow: 1 tx / no approve / ~61-68k vs ~87k gas, but ONLY for first-time (no-allowance)
  on-Arc EOA payers - repeat payers already get 1 tx via the allowance>=amount short-circuit, and
  cross-chain payers' dominant friction is the CCTP bridge legs which Memo does not touch. The
  (chainId, txHash) double-confirm guard is event-source-agnostic, so it survives either path
  unchanged. Conditions to revisit Memo later: Memo confirmed on Arc MAINNET at a stable address
  WITH a published audit of the Memo contract + CallFrom precompile; reliable client-side EOA-vs-
  smart-account detection (default to router on doubt); Memo verify hardened to the InvoicePaid bar
  (assert recipient==merchant, amount==total at 6 decimals, bind memoId to the SAME txHash as the
  matched Transfer); MemoFailed decoded to a friendly message + a memoData size cap; telemetry
  proving the first-payment approve step is a real drop-off. Only a formal Arc-only commitment
  (drop multi-chain ambition) plus all the above could justify making Memo primary. NOTE: Memo is
  still NOT implemented in production server.js/app.js (only test scaffolding from the earlier
  probe). Earlier conceptual explanation given to user: a memo payment routes USDC.transfer through
  Arc's Memo contract via CallFrom (preserves payer as msg.sender), carrying the invoiceId in the
  indexed memoId topic; it is embedded in the tx at send time, not attached to a tx hash afterward.

- 2026-06-19: Telegram bot "create invoice from chat" feature - planning + build started.
  Full plan in `.claude/telegram-bot-plan.md` (FTP-excluded). Decisions: keep getUpdates
  POLLING (no webhook); merchant<->chat binding is a CONFIRMED 1:1 link (new
  data/telegram-links.json, pending until the chat sends /start, closes the paste-someone-
  elses-chatId spoof); bot-created invoices FORCE merchantWallet = resolved linked wallet;
  `/start` is the ONLY registered command (dropped /id, /chatid; "Show chat ID" becomes a
  menu button in P3); no "No due date" option (every bot invoice defaults via 3/7/14/30-day
  buttons, normalizeInvoice untouched); no emoji in bot text. Phases: P0 long-poll+callback
  plumbing (DONE, commit a4adcf3, test_telegram_longpoll.js); P1 confirmed chatId<->wallet
  link store (DONE: loadTelegramLinkDb/saveTelegramLinkDb, resolveWalletByChatId [active-only],
  claimTelegramChatId [1:1, called from the signature-verified settings PUT], activateTelegramLink
  [pending->active on /start], seedTelegramLinksFromSellers [one-time idempotent migration of
  existing chatIds as pending], test_telegram_link.js 22/22). P2 session state machine +
  create-invoice flow (DONE: TG_STATE main_menu/ask_client/ask_amount/ask_due/confirm/done,
  data/telegram-sessions.json [30-min TTL], callback ns:value:step with step-stamp stale-tap
  guard, shared createInvoiceRecord [merchantWallet forced to linked wallet], idempotent confirm
  via draftInvoiceId, parseTelegramAmount, test_telegram_session.js 35/35). P3 menu polish (DONE:
  mainMenuKeyboard [Create invoice / My invoices / Show chat ID], buildMyInvoicesText [5 recent],
  botInvoiceStatus, test_telegram_invoices.js 12/12). ALL FOUR PHASES COMPLETE, all local commits
  (a4adcf3, 2526e4d, 4b493b4, e0bc02f), NOT YET PUSHED. answerCallbackQuery is a no-op without a
  token (correct + enables offline tests). Single sequential poll loop => no per-chat lock needed.
  Before pushing: this auto-deploys via FTP; the cPanel Node app MUST be manually restarted for
  the new bot to run. After deploy, existing merchants must send /start once to activate their
  seeded-pending link.
  IMPORTANT new pattern: server.js now guards `server.listen` behind
  `if (require.main === module)` and `module.exports` the testable link functions, so tests
  can require server.js without booting it (test_telegram_link.js relies on this; reuse for
  P2). Existing tests still spawn `node server.js` and are unaffected. After deploy the cPanel
  Node app MUST be manually restarted for the new poll loop/handlers to take effect.

- 2026-06-20: Direct/native USDC transfer verification fallback shipped (`71d401f`, pushed).
  Context: QR/manual payers who do NOT connect a wallet settle with a plain transfer (no
  PaymentRouter), so no InvoicePaid event. In production requireInvoiceReference is ALWAYS true
  (router deployed + onchainInvoiceId always set via randomBytes32), so the strict path REQUIRED
  the InvoicePaid event -> direct transfers never verified -> the manual-verify flow was
  effectively dead for non-connect payers. Fix in findArcPayment (server.js): try strict router
  path FIRST (unchanged for connect-wallet payers; it returns immediately so no shadowing/
  regression), then on no match FALL THROUGH to a direct-transfer fallback: txHash-scoped
  (findPaymentInRpcReceipt with requireInvoiceReference:false -> ERC-20 Transfer log, then
  findTokenTransferByTx, then findNativeTransferByTx), then recent-list scans (findRecentToken/
  NativeTransfer). Precedence router > ERC-20 > native. This is a GLOBAL relaxation (all invoices
  accept direct transfers as fallback), NOT per-invoice, because the QR is on every pay page.
  Tradeoff the user explicitly approved: direct transfers carry no on-chain invoiceId, so binding
  rests on exact amount + recipient + recency + the (txHash) double-spend guard. SECURITY HARDENING
  done because the fallback activates code that was dead in prod: (1) findMatchingNativeTransaction
  value>=expected -> exact === (an unrelated larger native transfer must not settle a smaller
  invoice); (2) isMatchingTokenTransfer now REQUIRES the canonical USDC address when set (dropped
  the symbol=="USDC" escape that let a spoofed token pass) and forces 6 decimals for the canonical
  token; (3) both Arcscan matchers reject a match with empty txHash so the dedup guard stays
  airtight. QR CHANGED again: app.js pay-page QR is now an EIP-681 NATIVE transfer URI
  (`ethereum:<merchant>@<chainId>?value=<amount*10^18>`), replacing the ERC-20 transfer URI from
  e76bc71. Reason: OKX (and exchange apps) refused the ERC-20 URI with "add the token and try
  again" because they don't recognize the 0x3600 system-USDC contract; a NATIVE send needs no
  token import (USDC IS the Arc gas token). Native value = 18 decimals; server verifies native at
  ARC_NATIVE_USDC_DECIMALS=18; /api/config now ships nativeUsdcDecimals; app.js adds
  ARC_NATIVE_USDC_DECIMALS=18 + normalizePublicConfig parsing. server.js now exports
  findMatchingTokenTransfer/findMatchingNativeTransaction/amountToUnits. New test
  test_native_transfer_fallback.js (24 assertions: exact-match, overpay-reject, spoof-reject,
  forced-6-decimals, no-txHash-reject, both Arcscan field shapes). Built via 2 workflows: a
  6-reader "understand" pass (mapped the whole verify path + surfaced the >=/spoof/decimals risks)
  and a 6-lens adversarial review that FAILED on session limit (not run) - so the review was done
  manually instead. OPERATIONAL CAVEATS TO LIVE-TEST (could not verify offline): (a) does OKX/
  exchange wallets actually honor the EIP-681 native `value` + `@chainId` on scan; (b) does a plain
  native USDC send on Arc appear in Arcscan /addresses/:payer/transactions and /transactions/:hash
  with to=merchant + value at 18 decimals so findMatchingNativeTransaction finds it. Pre-existing
  gaps left out of scope (noted by the understand workflow): the dedup guard is txHash-only (NO
  chainId dimension, contra the docs rule) - harmless while settlement is Arc-only; TOCTOU on the
  read-modify-write JSON store (two concurrent verifies of different invoices citing one txHash
  could both pass); isRecentEnough has a 5-min-early tolerance and no upper bound. Earlier this
  session also: cross-chain roadmap steps 1 (CHAINS table refactor, 691d88b) + 4 (MaxUint256
  one-time approve, d6f1c2f); pay-page UX split into wallet vs manual flows (3020e9b).

- 2026-06-20: PaymentRouterV2 + opt-in on-chain invoice memo BUILT (committed, NOT pushed,
  NOT deployed). Decision recap: rejected the "Memo contract + PaymentRouter in parallel"
  option (Arc Memo is EOA-only via CallFrom tx.origin semantics -> breaks Safe/smart-account
  payers; Arc-only -> useless for the CCTP cross-chain leg; weaker 2-log verify) in favor of
  extending the router. This is CONSISTENT with the 2026-06-19 Memo-vs-Router verdict (router
  stays the spine). contracts/PaymentRouterV2.sol: keeps payInvoice(bytes32,address,uint256)
  with the IDENTICAL selector 0xe1a9ef45 AND the IDENTICAL InvoicePaid event signature/topic
  (0x3c732fcd...) so the existing verify path + Arcscan indexer work unchanged when the
  configured router is pointed at V2; adds payInvoiceWithMemo(bytes32,address,uint256,bytes)
  selector 0x53a2a881 which, after the same transferFrom settlement, emits
  InvoiceMemo(bytes32 indexed invoiceId, address indexed payer, bytes memo) only when memo
  length > 0. MAX_MEMO_BYTES = 2048 cap. Non-custodial preserved (only transferFrom, holds no
  funds, no owner/withdraw). Compiles clean (solc), bytecode 1293 bytes. Deploy via
  scripts/deploy-payment-router-v2.js (npm run deploy:payment-router-v2) - mirrors the V1
  script, also writes contracts/PaymentRouterV2.abi.json and overwrites ARC_PAYMENT_ROUTER_ADDRESS.
  Memo is OPT-IN per invoice, OFF by default. Field picker on the create form (app.html
  #memoOnchain / #memoEnabled / name="memoField"): safe fields preselected (number, total,
  createdAt, dueDate, merchantName), sensitive ones off + amber-marked (clientName, items,
  note - public forever), plus a "hash" option (SHA-256 commitment, hides content). Server
  whitelist ONCHAIN_MEMO_FIELD_KEYS + normalizeMemoFields stores invoice.onchainMemoFields.
  Shared pure helpers in NEW memo-util.js (browser global window.FundlineMemo + Node export;
  loaded via <script src="/memo-util.js"> before app.js): normalizeMemoFields,
  buildInvoiceMemoText (readable UTF-8 "Fundline | invoice X | 10.50 USDC | ... | commit:<hash>",
  canonical field order, "" when nothing selected), canonicalInvoiceForHash, and
  encodePayInvoiceWithMemo (hand-rolled ABI for the 4-arg fn, dynamic-bytes tail, offset 0x80).
  app.js: collectMemoFields()/wireMemoToggle() on create; buildOnchainMemo()+computeInvoiceCommitHash()
  (crypto.subtle SHA-256) at pay time; sendRouterPayment branches to encodePayInvoiceWithMemo
  when memoText present else the plain 3-arg path (unchanged). test_memo_encoding.js (27 assertions:
  ABI byte-for-byte vs ethers across empty/aligned/unaligned/unicode/max sizes, >2048 reject,
  field-selection incl. sensitive-not-leaked, hash commitment). node --check + all tests pass.
  CRITICAL DEPLOY ORDER (frontend calls payInvoiceWithMemo which V1 lacks -> would revert for
  memo-enabled invoices): (1) user runs npm run deploy:payment-router-v2 with ARC_DEPLOYER_PRIVATE_KEY;
  (2) update ARC_PAYMENT_ROUTER_ADDRESS in the cPanel env to the V2 address + restart (V2 still
  serves the old 3-arg payInvoice so the not-yet-updated frontend keeps working); (3) THEN push
  the frontend so payInvoiceWithMemo hits V2. Memo-off invoices are safe in any order. Consider
  Arcscan-verifying V2 like V1 and updating onchain-reference.md with the V2 address once deployed.

- 2026-06-20: FundlineMemoRouter DEPLOYED + VERIFIED on Arc testnet. Renamed from the
  initial PaymentRouterV2 (user wanted the router named "FundLine Memo Router"; Solidity
  identifier FundlineMemoRouter, no spaces). Files renamed: contracts/PaymentRouterV2.sol ->
  contracts/FundlineMemoRouter.sol, scripts/deploy-payment-router-v2.js ->
  scripts/deploy-memo-router.js, ABI -> contracts/FundlineMemoRouter.abi.json; npm script
  deploy:memo-router. NOTE first deploy under the old name PaymentRouterV2 landed at
  0x94d4f81d2cD0747C158D0E7bb8aE518928aB78dD (tx 0x898314f7...) and is now ORPHANED/unused
  (renaming changes the metadata hash so it could not verify as FundlineMemoRouter; redeployed).
  ACTIVE router: FundlineMemoRouter at 0x5613D701D2e6A70643680eabBeEdc0e924b30848 (deploy tx
  0xcba05b08..., block 47840156). Local .env ARC_PAYMENT_ROUTER_ADDRESS now points to it; app.js
  DEFAULT_PUBLIC_CONFIG.paymentRouterAddress hardcoded fallback updated to it too. VERIFIED on
  Arcscan via the same Blockscout recipe as V1 (POST /api/v2/smart-contracts/{addr}/verification/
  via/flattened-code, compiler v0.8.35+commit.47b9dedd, optimizer on/200, evm_version "default",
  single flattened source, contract_name FundlineMemoRouter, autodetect_constructor_args true,
  license mit) - is_fully_verified=true, name shows FundlineMemoRouter. STILL PENDING (not done):
  (1) cPanel env ARC_PAYMENT_ROUTER_ADDRESS must be updated to 0x5613D701... + restart the Node
  app, BEFORE/with pushing the frontend (else the pushed app.js calls payInvoiceWithMemo on the
  old V1 router which lacks it -> revert for memo-enabled invoices); (2) the feature commit
  (74924e6, local, not pushed) plus this rename are NOT pushed yet. Update onchain-reference.md
  already done (FundlineMemoRouter listed as ACTIVE, V1 marked LEGACY).

- 2026-06-20: Bulk payout / payroll feature (FundlineBatchRouter) BUILT + DEPLOYED +
  VERIFIED across 5 phases. One payer distributes USDC to many recipients in ONE tx
  (payroll, speaker fees). Direction is 1->N (disburse), the OPPOSITE of an invoice (N->1)
  - confirmed with the user. Contract: contracts/FundlineBatchRouter.sol, payBatch(bytes32,
  address[],uint256[]) selector 0x4ae7161f + payBatchWithMemo(...,bytes[]) selector 0xb4199844
  (per-recipient on-chain memo for payroll references; user insisted memo is needed). Atomic
  (any failed transfer reverts the whole run), non-custodial (only transferFrom payer->each
  recipient, no funds held, no owner/withdraw), caps MAX_BATCH=256 + MAX_MEMO_BYTES=256. Events
  BatchPaid(batchId,payer,total,count) topic 0xcff8d316... + BatchItemPaid(batchId,payer,
  recipient,amount,memo) topic 0x33dd8a08.... DEPLOYED + Arcscan-VERIFIED at
  0x8d838Cee79e3F8a500d9C1dDEf12DF2f33e84cc4 (deploy tx 0xd3d9fdb9..., block 47858591). Deploy:
  npm run deploy:batch-router (scripts/deploy-batch-router.js, writes ARC_BATCH_ROUTER_ADDRESS).
  batch-util.js (browser+Node) hand-rolls the dynamic-array ABI (encodePayBatch /
  encodePayBatchWithMemo), verified byte-for-byte vs ethers in test_batch_router.js (15). Server
  (server.js): data/batches.json, normalizeBatch/normalizeBatchItem (exact 6-dp totalUnits),
  createBatchRecord, routes POST/GET /api/batches + GET /api/batches/:id (public, strips email)
  + POST /api/batches/:id/verify, findBatchPaidInReceipt (matches BatchPaid by onchainBatchId +
  total + count from the batch router address; events are unforgeable so it is a sound proof),
  /api/config now returns batchRouterAddress/batchPaymentsEnabled/maxBatchRecipients, /batch/:id
  -> app.html. test_batch_model.js (18). Frontend: a Single invoice / Bulk payout sub-tab in the
  create view; Bulk = download CSV template, parse+validate CSV (wallet/amount, per-row errors,
  running total), opt-in on-chain reference memo, POST -> /batch/:id link. PAY PAGE is a SEPARATE
  route /batch/:id (renderBatchPayPage, NOT the invoice /pay/ page): wallet-login REQUIRED, NO QR,
  NO manual pay/verify (user requirement); connect -> approve exact total -> ONE payBatch tx ->
  auto-verify. isPublicPaymentRoute() = isPayRoute() || isBatchRoute() gates merchant-only behavior.
  CRITICAL: normalizePublicConfig had to be extended to pass batchRouterAddress (it dropped unknown
  fields); the client default batchRouterAddress is "" (NOT baked) on purpose so the pay page only
  enables when the server reports an address - which is also when server verify works - avoiding a
  half-state where payment goes through but cannot be verified. STILL PENDING for go-live: (1) push
  all commits (Phase 1-5 are LOCAL, not pushed yet); (2) set ARC_BATCH_ROUTER_ADDRESS=
  0x8d838Cee79e3F8a500d9C1dDEf12DF2f33e84cc4 in the cPanel env + RESTART the Node app (else
  /api/config returns no batch address, the pay page stays disabled, and verify cannot run).

## Open threads / TODOs

- PENDING DEPLOY (2026-06-28): local commit `935d61c` "Rename run-mode buttons to Write
  prompt / Generate prompt" is committed but NOT pushed yet (user wants to deploy later).
  It only relabels the two Run-panel mode buttons in workflows.js (data-mode own/build and
  run logic unchanged). Earlier the same day the workflows-canvas series WAS pushed to main
  (n8n-style Workflow Structure redesign + run animation `8495120`, tabs vertical-scrollbar
  fix `3992f12`, node simplification to step/name/model `8495120`). Just `git push origin main`
  from outputs/arc-invoice-usdc when ready; frontend-only, no cPanel restart needed.
- SPEC (2026-06-28, DRAFT, NOT built): workflow free-run rate limiting + cost control. Full
  spec in `.claude/workflow-rate-limit-spec.md` (FTP-excluded). Decisions locked with user:
  D1 workflow runs = 3/IP/day HARD cap (then stop until reset, beta-quota messaging, no
  pay-to-continue during beta; runs use USDC testnet now); D2 "Generate prompt" = its own
  separate free 3/IP/day, stays free even after runs move to real USDC; D3 day boundary UTC;
  D4 per-IP spend cap USD 0.50/day (hard, replaced the earlier token-count idea); D5 provider
  = v98store (https://v98store.com, one key all models, use the EXACT model per workflow step).
  Two-layer model: L1 per-IP hard caps (3 runs + 3 gen-prompts + USD 0.50 spend) + L2 global
  daily API-spend ceiling (the real cost backstop vs VPN/CGNAT bypass). Enforced in NEW server
  endpoints POST /api/workflows/:slug/run and .../build-prompt (run is pure frontend mock
  today, no server run path yet). IP read from X-Forwarded-For on cPanel (WORKFLOW_TRUST_PROXY
  =xff); Cloudflare NOT required. v98store CONFIRMED (user PDF, section 12 of the spec):
  OpenAI-compatible, base URL https://v98store.com/v1, POST /v1/chat/completions for BOTH GPT
  and Claude (gateway translates), Bearer auth, standard usage block. Model labels in WORKFLOWS
  are NOT real ids - need a map: gpt-4.1-mini -> gpt-4.1-mini; claude-3-haiku ->
  claude-3-haiku-20240307; claude-3.5-sonnet -> claude-3-5-sonnet-20241022 (date suffix
  required). Price table USD/1M captured in spec; NewAPI markup, group_ratio Default 1x up to
  16x (Direct Claude) - must confirm OUR key's group. Always send max_tokens (Claude needs it).
  Q-A RESOLVED: global daily ceiling = USD 10/day for beta (WORKFLOW_DAILY_BUDGET_USD=10).
  v98store integration contract + model registry + price table + cost formula extracted into a
  NEW skill `.claude/skills/v98store-api/SKILL.md` (load-on-demand reference for expanding
  workflows to new models; the spec covers the limiter, the skill covers the provider). Live
  v98store request CONFIRMED (2026-06-28, gpt-4.1-mini): endpoint + Bearer auth + standard
  OpenAI usage block all work (usage.prompt_tokens/completion_tokens/total_tokens +
  prompt_tokens_details.cached_tokens + completion_tokens_details; ignore the non-standard
  latency_checkpoint). Billing endpoint CONFIRMED: GET /v1/dashboard/billing/subscription returns
  hard_limit_usd (259 on the test key) + has_payment_method + token_name; remaining = hard_limit
  minus /v1/dashboard/billing/usage total_usage -> usable for the L2 $10/day backstop. STILL
  OPEN before build: Q-B confirm prod XFF first entry is real client IP; the key's group_ratio
  (not in API responses, read from dashboard; default 1x + config override V98STORE_GROUP_RATIO
  meanwhile). No app code written.
- DIRECTION (2026-06-28): the current workflows `WORKFLOWS` catalog is demo/mock (simulated
  runs, fabricated metrics, NO real per-step prompts; model labels are not even real v98store
  ids). It first landed in commit d617c0b today with no Claude co-author trailer. User wants to
  REPLACE the invented workflows by adapting publicly shared, community-accepted LLM prompt-
  chains. Curated, sourced shortlist + recommended first 5 in `.claude/workflow-sources.md`
  (top picks: GPT Researcher ~28k stars Apache-2.0 -> Client/Crypto Research; CrewAI
  Research->Write->Edit -> SEO/X-thread; CrewAI Marketing Strategy MIT -> a marketing workflow;
  Promplify/AirOps SEO prompts; CrewAI Stock Analysis re-skinned -> Crypto Research). We only
  adapt the STEP STRUCTURE into v98store chat calls (per the v98store-api skill), not import
  CrewAI/n8n runtimes. Next: pick which to implement first, design real per-step prompts. No code.
- GPT Researcher DEEP-DIVE done -> `.claude/workflow-gpt-researcher.md` (verbatim prompts from
  gpt_researcher/prompts.py + real config defaults + adapted 6-step chain: Role Select, Planner,
  Retrieve+Scrape, Summarize, Curate, Writer). KEY FORK before building: GPT Researcher quality
  depends on live web search+scrape. Fundline has NO retrieval tool. Options: A) add Tavily
  search API (faithful, extra service+cost, has free tier); C1) user pastes sources (no API, real
  citations, user retrieves); C2) knowledge-only (must drop citations, label un-sourced, weakest).
  Recommended A + C1 fallback; avoid C2 as standalone research. DECIDED 2026-06-28: Option A + C1
  (Tavily search + paste-your-sources fallback). Build needs TAVILY_API_KEY (.env + cPanel,
  secret); confirm Tavily API shape + free-tier limit at build time.
- WORKFLOW RUNNER PHASE 1 BUILT (2026-06-28, branch `workflow-runner-phase1`, NOT merged/deployed).
  Shared plumbing behind master switch WORKFLOW_RATE_LIMIT_ENABLED (default OFF -> prod unchanged,
  frontend still mock). New modules: `v98-models.js` (id map + price table + computeCostMicros,
  micro-USD), `v98-client.js` (OpenAI-compatible callV98Chat with 429 retry/backoff),
  `workflow-limiter.js` (per-IP UTC-day quota: runCount/genCount/spentMicros, global budget,
  IPv4 + IPv6 /64 keying, XFF/CF IP resolution, checkAndReserve/rollbackReserve/recordCost; JSON
  store data/workflow-usage.json + workflow-budget.json). server.js: env consts + WORKFLOW_LIMITS,
  routes POST /api/workflows/:slug/build-prompt (REAL single v98 call, genCount quota, cost
  recorded) and /run (501 not_implemented until phase 2), /api/config now returns
  workflowRunnerEnabled/workflowFreeRunsPerDay/workflowGenPromptsPerDay/workflowBetaNotice. Tests:
  test_v98_cost.js (14), test_workflow_limiter.js (23) pass; server requires cleanly with
  FUNDLINE_NO_LISTEN. VERIFIED END-TO-END 2026-06-28 with the real key: POST build-prompt returned
  HTTP 200 + a real professional prompt, genCount 1/3 (remaining 2), cost 52 micro-USD ($0.000052)
  recorded in BOTH data/workflow-usage.json (per-IP) and workflow-budget.json (global), matching
  gpt-4o-mini at group 1x. Caveat: cost recorded at V98STORE_GROUP_RATIO=1; if the key is a higher
  group the real credit burn is higher -> set V98STORE_GROUP_RATIO once confirmed from dashboard
  (not blocking). Commits on branch workflow-runner-phase1: 9bd297c (docs) + 8ba2084 (code), local
  only, NOT pushed/deployed. .env.example documents all new vars. Phase 2 next: Tavily + GPT
  Researcher chain for /run + frontend wiring.
- WORKFLOW RUNNER PHASE 2 (BACKEND) BUILT + VERIFIED LIVE (2026-06-28, branch
  workflow-runner-phase1). New: `tavily-client.js` (POST api.tavily.com/search, Bearer auth,
  returns results[{title,url,content,score}]); `workflow-research.js` = GPT Researcher chain
  adapted (role select -> plan 3 queries -> Tavily retrieve -> write cited report), prompts close
  to originals, dependency-injected callModel/searchWeb so it is testable; dedupes sources by URL;
  sums cost in micro-USD. server.js: WORKFLOW_RUN_DEFS={client-research:research},
  WORKFLOW_RESEARCH_CHEAP_MODEL (gpt-4o-mini), WORKFLOW_RESEARCH_WRITER_MODEL (gpt-4.1-mini),
  TAVILY_API_KEY; handleWorkflowRun now executes the research chain (search OR paste mode), reserves
  one run, records summed cost, rolls back on failure. Modes: search (needs Tavily) + paste
  (user-pasted sources, no API). test_workflow_research.js (20) passes. LIVE E2E 2026-06-28: POST
  /api/workflows/client-research/run search mode returned HTTP 200, a real ~1500-word cited
  markdown report from real Tavily sources (wikipedia, zoominfo, company sites), 6 deduped sources,
  cost $0.003218 (role 35 + plan 32 + writer 3151 micro-USD), remaining 2/3. Also confirmed:
  unknown slug -> 501, paste + empty sources -> 400. .env.example documents TAVILY_API_KEY + model
  vars. STILL TODO (phase 2 frontend): wire workflows.js to call /run + /build-prompt for real,
  drive the canvas off the response, add paste-sources UI mode, show remaining quota + beta notice.
  Then predeploy-check + decide deploy. Note: current WORKFLOWS frontend display still has mock
  step labels/metrics; align client-research display with the real chain when wiring.
- WORKFLOW RUNNER PHASE 2 (FRONTEND) WIRED (2026-06-28, branch workflow-runner-phase1, NOT
  deployed). workflows.js: client-research is now `live: true` with the REAL chain displayed
  (Role analysis / Research plan / Web research [Tavily] / Report writer, modelCount 2). Run +
  Generate-prompt call the real endpoints (/run, /build-prompt); the canvas animates steps and
  holds the last node "running" until the real response, then shows the real report + receipt
  (sources count, est. cost, remaining quota) with Copy/Download. Added a retrieval toggle (Search
  the web vs Paste my sources -> mode search|paste). Errors (429/503/501/502) show the server
  message. DEPLOY-SAFETY GATE: a workflow is runnable only if `wf.live && WF_RUNNER_ENABLED`, where
  WF_RUNNER_ENABLED comes from GET /api/config workflowRunnerEnabled (fetched on load); until the
  server flag is on, everything shows "coming soon" -> safe to deploy the frontend before enabling
  the server. Other workflows: Run button disabled + "Coming soon". To TEST LOCALLY: set
  WORKFLOW_RATE_LIMIT_ENABLED=true in .env (V98 + Tavily keys already there), npm start, open
  /workflows/client-research, hard-refresh. node --check passes for workflows.js + server.js.
  Frontend DOM not auto-tested (no headless browser); needs a manual browser pass. Commit pending
  on branch. TO DEPLOY later: enable WORKFLOW_RATE_LIMIT_ENABLED + V98STORE_API_KEY + TAVILY_API_KEY
  in the cPanel env, then merge to main + push (auto-deploys); restart not needed for static files
  but IS needed for server.js env/code changes.
- WORKFLOW RUNNER DEPLOYED to main 2026-06-28 (merged workflow-runner-phase1 fast-forward,
  e01ac15..4c53f0a, pushed -> FTP auto-deploy + tmp/restart.txt touched so Passenger reloads
  server.js). FEATURE IS DORMANT until the cPanel Node app env is set: add
  WORKFLOW_RATE_LIMIT_ENABLED=true, V98STORE_API_KEY, V98STORE_BASE_URL=https://v98store.com/v1,
  TAVILY_API_KEY (and optionally V98STORE_GROUP_RATIO if the key is not group 1x) in the cPanel
  Environment Variables, then restart the Node app. Until then /api/config returns
  workflowRunnerEnabled=false and EVERY workflow shows "Coming soon" (the old mock Run demo is
  gone on prod while dormant - expected, safe). Once enabled: client-research runs live
  (search + paste modes), others stay "Coming soon". Frontend DOM still not browser-tested by me.
- SKILL `create-workflow` exists (`.claude/skills/create-workflow/SKILL.md`, listed in CLAUDE.md
  Skills). It is the end-to-end procedure for building a new AI workflow (adapt a community chain
  -> v98store executor -> /run wiring -> frontend -> tests -> deploy). WHEN THE USER ASKS TO
  CREATE/ADD A NEW WORKFLOW, open and follow it so the design is consistent. It orchestrates the
  v98store-api skill, workflow-rate-limit-spec.md, workflow-sources.md, and the worked example
  workflow-gpt-researcher.md.
- WORKFLOW BILLING design DONE -> spec `.claude/workflow-billing-spec.md` (2026-06-28, NOT built).
  Model: charge per workflow run via a NON-CUSTODIAL per-run escrow on Arc in USDC. Researched
  Circle's official `circlefin/arc-escrow` (contract RefundProtocol.sol is non-custodial: funds
  depositor->contract->beneficiary, no admin drain, no fee; but its APP layer uses Circle
  Developer-Controlled Wallets + OpenAI + Supabase = custodial -> DROPPED). Decisions locked:
  per-run escrow, USER signs fund() from own wallet for the FIXED workflow price (check balance,
  else top up); output -> Fundline TREASURY key signs release() (no AI/confirm/window); failure ->
  treasury refund() + a REFUND_WINDOW timeout so user can claimRefund() if treasury goes silent;
  fixed price (profit/loss ours, no per-node cost in memo); memo self-emitted by the escrow in the
  SAME InvoiceMemo format/topic as FundlineMemoRouter (reuse memo-util; new buildWorkflowMemoText
  = workflow name + nodes + models, NO cost/user/input/output). New contract FundlineRunEscrow
  (constructor usdc+treasury immutable, fund/release/refund/claimRefund, SafeERC20, 6 decimals).
  Env: ARC_RUN_ESCROW_ADDRESS + ARC_TREASURY_PRIVATE_KEY (treasury is a Fundline hot key, NOT a
  user key). MUST build via escrow-build skill (escrow-engineer + MANDATORY contract-auditor on
  the invariants) before any deploy. RESOLVED 2026-06-28: normal failure (a node fails after 3
  retries) -> immediate treasury refund + error to user; REFUND_WINDOW ~1h is ONLY a stuck-funds
  backstop (server dies between fund and release/refund) via claimRefund. ONE shared contract for
  all workflows (price passed at fund, server-validated). Billing runs on TESTNET USDC = beta
  (tests on-chain flow, NOT revenue); since v98 cost is REAL USD even when user pays testnet USDC,
  the per-IP + global budget caps STAY ON as the real-cost guard. Awaiting user "build" go.
- FundlineRunEscrow BUILT + AUDITED PASS (2026-06-28, branch `run-escrow`, commit 50627a4, NOT
  merged/deployed). contracts/FundlineRunEscrow.sol (non-custodial per-run billing escrow:
  fund/release/refund/claimRefund, immutable usdc+treasury, REFUND_WINDOW 1h, self-emits
  InvoiceMemo with topic byte-matching FundlineMemoRouter, IERC20 transferFrom not msg.value,
  6-decimal raw units, CEI, return-value-checked, no owner/admin/fee/selfdestruct). Built via
  escrow-build skill: escrow-engineer wrote it + scripts/deploy-fundline-run-escrow.js (mirrors
  deploy-payment-router, writes ARC_RUN_ESCROW_ADDRESS); contract-auditor verdict PASS (no
  High/Med; Lows are server-side: must verify payer==caller && amount==price && not settled
  before running, use high-entropy runIds). server.js: ARC_RUN_ESCROW_ADDRESS + ARC_TREASURY_ADDRESS
  consts, /api/config returns runEscrowAddress + workflowBillingEnabled. .env.example documents
  ARC_TREASURY_ADDRESS/ARC_RUN_ESCROW_ADDRESS/ARC_TREASURY_PRIVATE_KEY. test_run_escrow.js (179,
  offline surface/ABI audit). STILL TODO before live: (1) deploy contract to Arc testnet (manual:
  set ARC_TREASURY_ADDRESS + ARC_DEPLOYER_PRIVATE_KEY, run the deploy script); (2) BILLING
  INTEGRATION phase: /run returns runId+price+escrow, verify on-chain funded run (Lows above)
  before executing, treasury key (ARC_TREASURY_PRIVATE_KEY) signs release(runId, memo via new
  memo-util buildWorkflowMemoText) on success / refund on failure; frontend approve+fund flow;
  (3) testnet lifecycle dry-run. Keep rate-limit + $10/day budget caps ON (testnet USDC billing
  does not cover real v98 cost).
- FundlineRunEscrow DEPLOYED to Arc testnet 2026-06-28: `0xefDDfF01090404f1eC942d96346B00638339b8D5`
  (treasury `0xee395f5bc60AE30b8279dfcf8cf0ABa392EC36FC`, deploy tx 0xecb2a6f2..., block 49154785).
  ARC_RUN_ESCROW_ADDRESS in .env (the deploy script printed "Updated .env" but the write did NOT
  persist - had to append manually; watch updateEnvValue on this machine). VERIFIED on Arcscan
  2026-06-28 (is_fully_verified=true) via scripts/verify-run-escrow.js (Blockscout flattened-code,
  compiler v0.8.35+commit.47b9dedd, optimizer 200, evm default, autodetect ctor args).
  ARC_TREASURY_PRIVATE_KEY now present in .env -> billing can sign (WORKFLOW_BILLING_ENABLED true
  when server boots with all of: escrow addr + USDC + treasury key). LIFECYCLE DRY-RUN PASS 15/15
  on the live contract (test_run_escrow_dryrun.js, 2026-06-28): fund->release (treasury receives,
  InvoiceMemo emitted with exact memo body, RunReleased), fund->refund (payer refunded,
  RunRefunded), double-release reverts, escrow USDC balance deltas exact. Env (first-wins loader,
  same as server.js): ARC_DEPLOYER_PRIVATE_KEY=payer 0x8124ca3f...54ea (61 USDC), ARC_TREASURY_
  PRIVATE_KEY=treasury 0xee395f...36fc (= contract beneficiary). Backend + contract fully proven.
  FRONTEND approve+fund flow WIRED (workflows.js): on Run, if isBillingEnabled (wf.live &&
  /api/config.workflowBillingEnabled), fundWorkflowRun connects -> ensureArcChain (0x4cef52) ->
  POST /quote -> approve USDC if needed (0x095ea7b3) -> fund(runId) (0xe46bbc9e) via EIP-1193 ->
  runWorkflow with runId. Free path preserved when billing off. BILLING E2E PASS 7/7
  (test_billing_e2e_dryrun.js, live 2026-06-28): quote -> on-chain fund -> POST /run verified
  funding -> ran real workflow -> treasury released escrow (tx 0x214cbd5c...) -> released=true.
  ENTIRE billing system PROVEN server-side; only the browser wallet UI (popups) untested (needs a
  real browser). MERGED + DEPLOYED to main 2026-06-28 (cadb0c2..ac0cf14, FTP auto-deploy +
  Passenger restart). DORMANT until cPanel Node env is set: WORKFLOW_RATE_LIMIT_ENABLED=true,
  V98STORE_API_KEY, V98STORE_BASE_URL, TAVILY_API_KEY,
  ARC_RUN_ESCROW_ADDRESS=0xefDDfF01090404f1eC942d96346B00638339b8D5,
  ARC_TREASURY_ADDRESS=0xee395f5bc60AE30b8279dfcf8cf0ABa392EC36FC, ARC_TREASURY_PRIVATE_KEY (secret),
  optional V98STORE_GROUP_RATIO; then RESTART the Node app. Until set, /api/config reports runner +
  billing off -> all workflows "coming soon" (safe). Browser wallet UI still untested by me.
  Server BILLING
  INTEGRATION wired (branch run-escrow, commit 4fb7383, NOT merged/deployed to prod): run-escrow-
  client.js (read getRun, treasury release/refund), memo-util.buildWorkflowMemoText, server.js
  /api/workflows/:slug/quote (issues high-entropy runId + fixed price 50000=0.05 USDC) and /run
  billing branch (verify funded on-chain: payer set, amount==price, not settled -> run -> treasury
  release with memo on success / refund on failure). Free beta path preserved when billing off.
  /api/config exposes workflowBillingEnabled + workflowPrices. WORKFLOW_BILLING_ENABLED requires
  escrow addr + USDC + ARC_TREASURY_PRIVATE_KEY. Read path VERIFIED live against the deployed
  contract. STILL TODO: (1) user must add ARC_TREASURY_PRIVATE_KEY (key for the treasury address)
  to activate signing/billing; (2) FRONTEND approve+fund flow (quote -> approve USDC -> fund(runId)
  via EIP-1193 -> /run with runId) - NOT built; (3) full lifecycle dry-run (fund/release/refund)
  once treasury key present. v98 budget cap stays separate from USDC paid.
- BILLING UX FIXES deployed 2026-06-29 (commits 8ce053a + a4f1021 on main): (1) workflow page now
  has a Connect-wallet button + connected-address chip (reflects existing connection via
  eth_accounts, no popup; updates on accountsChanged); (2) if already connected, Run does NOT
  re-request accounts - it uses WF_WALLET and just signs fund; approval is a ONE-TIME large
  allowance (MAX_UINT256) so repeat runs need only the single fund signature (first run = approve
  + fund); (3) receipt always shows "Charged 0.05 USDC" + "Invoice memo tx" linking the release
  tx on Arcscan (no "free run" wording - every run is billed and counts to the budget pool).
  Run button reads "Pay 0.05 USDC and run" when billing on. User correction noted: there is NO
  free run path in prod; all runs charge USDC + count to the per-IP/global v98 budget caps.
- SINGLE dApp-WIDE WALLET SESSION (2026-06-29, NOT pushed; commits 154fe55 + 6297302 + 7a98bf2 on
  main, local). NEW `wallet.js` (loaded by app.html + workflows.html, before the page script) owns
  ONE connect/disconnect session in localStorage (key fundline_wallet_session), rendered as a
  sidebar widget ABOVE the network pill: Connect button when disconnected, address chip when
  connected -> click slides out a balance panel (Arc Testnet USDC now, more networks later) with a
  Disconnect button. Exposes window.FundlineWallet {getAddress,getSession,isConnected,connect,
  disconnect,refreshBalance} + fires document "fundline:walletchange". app.js: removed its own
  session storage + the header wallet control markup; connectWallet() delegates to
  FundlineWallet.connect(); syncWalletFromShared() mirrors the shared session into state.wallet on
  load + on the event (keeps invoice/payment logic intact). workflows.js: dropped its in-panel
  connect row/helpers; billing fund uses FundlineWallet.getAddress()/connect(); a run still
  requires a connected wallet. Result modal (6297302) + wallet persistence (154fe55) also pending.
  Sidebar exists only on app.html + workflows.html. node --check clean; serve test confirms widget
  + wallet.js on both pages and the old header control gone. Browser wallet UI not auto-tested.
- Phase 1 (active): build, audit, and deploy FundlineEscrow per `escrow-spec.md`. No file
  yet. Use the escrow-engineer agent to write it and contract-auditor to review before any
  deploy; the no-withdraw and no-fee invariants are make-or-break.
- RESOLVED 2026-06-19: PaymentRouter source verified on Arcscan (is_fully_verified=true).
  Address 0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24. Arcscan is Blockscout; verified via
  POST /api/v2/smart-contracts/{addr}/verification/via/flattened-code with: compiler
  v0.8.35+commit.47b9dedd (read from the on-chain bytecode CBOR metadata, matched the local
  solc), optimizer on / runs 200, evm_version "default", single flattened PaymentRouter.sol,
  autodetect_constructor_args=true (decoded usdc_=0x3600..0000). No API key or captcha needed.
  Note: Blockscout recorded license_type "none" despite the SPDX MIT header; cosmetic only,
  source/bytecode match is exact. The /api/v2 endpoints occasionally return an empty body
  (transient) -- retry on undefined fields.
- RESOLVED 2026-06-18: USDC 6-vs-18 decimals is NOT a risk (audit_report.md flagged it High).
  Verified against docs.arc.io: native gas-token value uses 18 decimals, ERC-20 interface uses
  6, both handled correctly (ERC-20/router path uses ARC_USDC_DECIMALS=6, native fallback uses
  ARC_NATIVE_USDC_DECIMALS=18). The .env.example values are correct as-is.
- Hardcoded addresses (USDC, CCTP, chainId) are scattered across server.js and app.js; a
  single constants source is wanted but not done.
- No lint / typecheck / test runner. CI only runs `node --check` on app.js and server.js,
  then FTP-deploys to cPanel on push to main.

## Critical deploy gotcha (cost a prod 503)

- 2026-06-19: cPanel runs server.js via Phusion Passenger, which `require()`s the app
  (it does NOT run `node server.js`). So `require.main === module` is FALSE in production.
  NEVER gate `server.listen(...)` on `require.main === module` - it skips listen, the app
  never binds, and the whole site returns 503 (and startTelegramPolling, called inside the
  listen callback, never runs, so the bot also goes silent - same root cause). To make
  server.js requirable by tests without booting, gate listen on an env flag instead:
  `if (!process.env.FUNDLINE_NO_LISTEN) server.listen(...)`. Tests set
  `process.env.FUNDLINE_NO_LISTEN = "1"` BEFORE `require("./server.js")`. Fixed in 5e33813.

## Repo gotcha

- The real git repo is the nested `outputs/arc-invoice-usdc/` (remote
  github.com/duclucky/fundline, branch main). The outer `fundline/` folder's git is
  actually the Windows home dir (C:/Users/TBC) and tracks unrelated files. Always run git
  from `outputs/arc-invoice-usdc/`.
- Subagent / rule discovery is relative to the workspace root. These live in the nested
  repo's `.claude/`. If a session is rooted at the outer fundline/ folder, they may not
  auto-discover; open `outputs/arc-invoice-usdc/` as the workspace, or mirror `.claude/`
  up one level.
