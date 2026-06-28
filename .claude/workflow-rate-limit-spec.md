# Spec: Workflow free-run rate limiting and cost control

Status: DRAFT for discussion (2026-06-28). Nothing built. Frontend "Run Workflow" is a
pure mock today, so there is no server run path yet. This spec covers the gate to add WHEN
real model/API integration lands and each run starts costing real money.

Conventions: plain Node http server, CommonJS, two-space indent, double quotes, JSON file
store under data/ (gitignored), English copy, no em dashes, no emojis. Non-custodial
invariant untouched (this feature never moves funds).

## 1. Goal and non-goals

Goal: cap how much free, real-money API spend an anonymous visitor can trigger, so the
workflow runner cannot drain our provider budget.

### Decisions locked (2026-06-28)

- D1. WORKFLOW RUNS: 3 per IP per day, hard cap. After 3 it is a HARD STOP until the daily
  reset (NOT a pay-to-continue tier right now). During beta the runs use USDC testnet (no
  economic value). The block message frames it as a beta limitation. Revisit a paid
  unlimited tier post-beta.
- D2. GENERATE PROMPT (Build mode helper): its own SEPARATE free quota, 3 per IP per day,
  independent of the workflow-run counter. Stays free even later when workflow runs move to
  real USDC. So two independent per-IP daily counters: runCount and genCount.
- D3. Day boundary: UTC.
- D4. Spend cap: max USD 0.50 of real API spend per user (per IP) per day, enforced as a
  hard per-IP money cap alongside the 3-run cap. (Replaces the earlier token-count idea; a
  direct USD cap is cleaner and is what the user specified.)
- D5. Provider: v98store (https://v98store.com). One API key works for all models; each
  workflow step uses the EXACT model named in its definition (see section 12).

Two enforced layers:
- L1 (per IP, hard during beta): 3 workflow runs/day across ALL workflows, plus a separate
  3 generate-prompt/day, plus a USD 0.50/day spend cap. Primary gate while beta. Normal runs
  cost well under 0.50 (proposal-writer is ~USD 0.04/run in the mock pricing, so 3 runs is
  ~0.12), so the 3-run cap usually binds first; the 0.50 cap is the safety against a single
  unexpectedly expensive run.
- L2 (global budget, hard): a daily ceiling on TOTAL real API spend across everyone, the
  backstop when L1 per-IP is bypassed (a VPN/CGNAT rotator gets a fresh 0.50 per new IP).
  Global ceiling = 0.50 x how many users/day we are willing to fund; set conservatively for
  beta (open Q-A: pick the global number).

Non-goals: not a billing system, not bulletproof anti-abuse. L1 per-IP is a deterrent against
casual overuse, not a guarantee against a determined IP-rotating abuser; that is L2's job.

## 2. Where it is enforced

Two new server endpoints own the costly calls; the limit check wraps each real model call.
They use SEPARATE per-IP counters (D2).

  POST /api/workflows/:slug/run          -> uses runCount (D1: 3/day hard)
  body: { "prompt": "...", "mode": "own" | "build" }

  POST /api/workflows/:slug/build-prompt -> uses genCount (D2: 3/day, always free)
  body: { "description": "..." }

Enforcement order inside the run handler:
1. Feature flag off -> behave as today (or 404 if endpoint not live).
2. Resolve client IP key (section 4).
3. L2 check: if today global spend >= budget -> 503 service_budget_reached (do NOT call API).
4. L1 checks: if runCount today >= 3 -> 429 daily_limit; if this IP's spentMicros today
   >= 500000 (USD 0.50) -> 429 spend_limit (do NOT call API).
5. Reserve: increment runCount and a provisional global-run counter BEFORE the API call so a
   slow/concurrent caller cannot slip extra runs in.
6. Call the real model pipeline (v98store, exact model per step, section 12).
7. On success, compute real cost from the response usage (prompt/completion tokens x the
   v98store per-model price), add it to this IP's spentMicros AND today's global spend;
   return result + remaining headers.
8. On API failure, roll back the runCount increment (do not burn a free run on our error).

The build-prompt handler is the same flow but checks/increments genCount (3/day) and stays
free regardless of D1; it still counts toward L2 global spend and the token sub-cap so it
cannot be abused as an unlimited free model call.

Client must never be trusted; all counting is server-side.

## 3. Data model (JSON store, mirrors existing pattern)

data/workflow-usage.json  (per-IP daily counters)
  { "<ipKey>": { "date": "2026-06-28", "runCount": 2, "genCount": 1, "spentMicros": 80000 } }
  - date is the UTC day (D3).
  - runCount = workflow runs (D1, cap 3). genCount = generate-prompt uses (D2, cap 3).
  - spentMicros = real API spend by this IP today, integer micro-USD (D4, cap 500000 = USD 0.50).
  - prune entries whose date != today on each write to keep the file small.

data/workflow-budget.json  (global daily ledger)
  { "date": "2026-06-28", "spentMicros": 412300, "runs": 57 }
  - spentMicros = integer micro-USD spent today (integer math, no float, mirrors the
    6-decimal discipline used for USDC). Reset when date rolls over.

Both files can be empty/missing on a fresh machine; treat missing as zero.

## 4. Client IP resolution (the critical, easy-to-get-wrong part)

getClientIp(req):
- If behind Cloudflare: trust CF-Connecting-IP.
- Else if a known proxy sets it: take the FIRST IP in X-Forwarded-For (the original client),
  trusting it ONLY because the request reached us through our proxy.
- Fallback: req.socket.remoteAddress.
- Normalize: for IPv6, key by the /64 prefix (a single user often controls a whole /64), not
  the full /128. For IPv4, key by the full address.

WARNING: on cPanel + Passenger (and any CDN), req.socket.remoteAddress is the PROXY IP. If we
key on that, the entire site shares ONE counter and free runs die at 3/day globally. Must
confirm the real prod header chain before shipping (open Q5).

## 5. Atomicity

Node is single-threaded, so a synchronous read-modify-write of the JSON counters within one
handler tick (before any await) is atomic per process. Risk: if cPanel runs more than one
app instance, counters race across processes. Mitigations, in order of preference:
- Confirm Passenger runs a single instance (likely for this app) and accept synchronous RMW.
- Add a tiny in-process write queue/mutex around the counter files.
- Long term: move counters to the planned Postgres/Supabase with an atomic increment
  (UPSERT ... count = count + 1 RETURNING count) which removes the race entirely.

This is the same TOCTOU class already noted for the invoice JSON store.

## 6. Config (.env, with safe defaults)

  WORKFLOW_RATE_LIMIT_ENABLED=true
  WORKFLOW_RUNS_PER_IP_PER_DAY=3            # D1
  WORKFLOW_GEN_PROMPTS_PER_IP_PER_DAY=3     # D2, separate counter
  WORKFLOW_SPEND_PER_IP_PER_DAY_USD=0.50    # D4, per-IP hard money cap
  WORKFLOW_DAILY_BUDGET_USD=10              # L2 global ceiling for beta (Q-A)
  WORKFLOW_RATE_LIMIT_TZ=UTC               # D3, fixed
  WORKFLOW_TRUST_PROXY=xff                  # cloudflare | xff | none -> controls IP resolution
  WORKFLOW_BETA_NOTICE=true                 # show "limited beta quota" copy

  # Provider (D5, v98store). Secret -> .env only, never on public docs.
  V98STORE_API_KEY=sk-...
  V98STORE_BASE_URL=https://v98store.com/v1   # CONFIRM exact base path from the dashboard

Day boundary is fixed to UTC (D3); WORKFLOW_RATE_LIMIT_TZ is kept only so it is not hardcoded.

GET /api/config additionally returns { workflowFreeRunsPerDay, workflowGenPromptsPerDay,
betaNotice } (public, so the UI can show the quota and the beta banner). Do NOT expose the
global budget number, the per-IP spend cap, or the v98store key publicly.

## 7. Responses

Success 200:
  { "runId", "status": "completed", "output", "cost", "currency": "USD" }
  headers: X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset (epoch of next reset)

Per-IP runs exceeded 429 (D1, beta framing per D1):
  { "error": "daily_limit",
    "message": "You have used all 3 runs for today. Fundline workflows are in beta, so the
                daily quota is limited for now. It resets at 00:00 UTC.",
    "remaining": 0, "resetsAt": "<ISO>" }

Per-IP generate-prompt exceeded 429 (D2):
  { "error": "gen_limit",
    "message": "You have used all 3 prompt generations for today. Resets at 00:00 UTC.",
    "remaining": 0, "resetsAt": "<ISO>" }

Per-IP spend cap hit 429 (D4):
  { "error": "spend_limit",
    "message": "You have reached today's usage limit. Resets at 00:00 UTC." }

Global budget reached 503:
  { "error": "service_budget_reached",
    "message": "Workflow runs are paused for today. Please try again tomorrow." }

## 8. Frontend changes (workflows.js)

- Before run: show "X of 3 free runs left today" near the Run button (from /api/config +
  the X-RateLimit-Remaining of the last call).
- The runner calls POST /api/workflows/:slug/run instead of the current pure mock; keep the
  canvas animation but drive completion off the real response.
- On 429 (daily_limit): beta-quota notice + the reset time (00:00 UTC). No pay-to-continue
  during beta (D1). Run button disabled until reset.
- On 503 (service_budget_reached): "Workflow runs are paused for today" state, button disabled.

## 9. Abuse vectors acknowledged (so we ship with eyes open)

- VPN / proxy / Tor / mobile CGNAT rotation defeats per-IP. Expected; L2 budget is the real
  guard.
- Shared NAT (office, campus, carrier) means many real users share 3/day -> possible unfair
  blocks. Tune N or pair with wallet-based quota if this hurts.
- IPv6 single-address keying would let one user cycle a /64; hence /64 keying in section 4.

## 10. Testing (standalone node test_*.js, no runner)

- test_workflow_ratelimit.js: 4th run from same IP key -> 429; counter resets on date change;
  IPv6 /64 keying collapses addresses in the same prefix; rollback on simulated API error
  restores the count; global budget exhaustion -> 503 before any per-IP check passes; correct
  IP picked from CF-Connecting-IP vs X-Forwarded-For vs socket per WORKFLOW_TRUST_PROXY.

## 11. Open questions

RESOLVED 2026-06-28:
- Q1 -> D2: Generate prompt has its own separate free 3/day, not counted into workflow runs.
- Q2 -> D3: UTC.
- Q3 -> D1: hard cap (3 runs, then stop until reset) with beta-quota messaging; no
  pay-to-continue tier during beta.
- Q4 -> D4: per-user (per-IP) spend cap = USD 0.50/day.
- Q-C -> D5: provider is v98store (one key, all models, exact model per workflow step).
- Q-D (v98store specifics): RESOLVED from the official site (section 12) - base URL
  https://v98store.com/v1, OpenAI-compatible POST /v1/chat/completions for GPT and Claude,
  Bearer auth, standard usage block, model-id map (date suffixes required), USD/1M price table,
  NewAPI markup formula. Residual: a few items still need ONE live request to lock exactly
  (usage detail fields, billing path, our group_ratio, RPM/TPM) - build-time, not a product
  blocker.
- Q5 (Cloudflare cost): NOT required. Cloudflare's Free plan already sets CF-Connecting-IP,
  but we likely do not need Cloudflare at all because the cPanel proxy (Apache/LiteSpeed +
  Passenger) sets X-Forwarded-For. Default WORKFLOW_TRUST_PROXY=xff. Still must confirm the
  exact prod header before shipping (see Q-B).

- Q-A (L2 global ceiling): RESOLVED -> USD 10/day for beta (WORKFLOW_DAILY_BUDGET_USD=10).
  An IP rotator gets a fresh 0.50 per IP, so this 10/day is the real cash backstop; revisit
  post-beta.

The v98store integration contract, model registry, price table, and cost formula now live in
the `v98store-api` skill (.claude/skills/v98store-api/SKILL.md). This spec covers the limiter;
that skill covers the provider.

STILL OPEN:
- Q-B (prod header): confirm the live cPanel app receives X-Forwarded-For and its first entry
  is the real client (log request headers once in prod) before trusting it. If a CDN is added
  later, switch WORKFLOW_TRUST_PROXY accordingly. Build-time task.

## 12. Provider integration (v98store, D5)

CONFIRMED from the official site (user-supplied PDF, 2026-06-28). A few items still need ONE
real request with our key to lock 100% (listed at the end).

Transport (CONFIRMED):
- OpenAI-compatible. Base URL: https://v98store.com/v1 (no api.* subdomain).
- Endpoint: POST https://v98store.com/v1/chat/completions for BOTH GPT and Claude (the gateway
  translates to Anthropic internally) -> one code path, no per-vendor branching.
- Auth: Authorization: Bearer <V98STORE_API_KEY>.
- Request body is standard OpenAI: { model, messages: [{role, content}], temperature,
  max_tokens }.
- Response is standard OpenAI: choices[0].message.content + usage { prompt_tokens,
  completion_tokens, total_tokens }. We read usage for cost.
- Anthropic quirk: Claude requires max_tokens, so ALWAYS send max_tokens on every call.

Model id map (CONFIRMED - the workflow step labels are NOT the real ids; map before calling):
  workflow label      ->  v98store model id
  gpt-4.1-mini        ->  gpt-4.1-mini             (or pin gpt-4.1-mini-2025-04-14)
  claude-3-haiku      ->  claude-3-haiku-20240307      (date suffix REQUIRED)
  claude-3.5-sonnet   ->  claude-3-5-sonnet-20241022   (dashes -3-5- + date suffix)
Keep this map AND the price table in ONE server constant (do not scatter ids/prices, per the
gotchas single-source rule).

Pricing (CONFIRMED, USD per 1M tokens, Default group = 1x):
  model id                       input/1M   output/1M
  gpt-4.1-mini                   0.40       1.60
  gpt-4o-mini                    0.15       0.60
  gpt-5-mini                     0.25       2.00
  claude-3-haiku-20240307        0.25       1.25
  claude-3-5-sonnet-20241022     3.00       15.00
  claude-haiku-4-5-20251001      1.00       5.00
  claude-sonnet-4-6              3.00       15.00
Full list (~450 models): https://v98store.com/prices

Cost per call (drives the D4 0.50/IP/day cap and L2):
  costUSD = (prompt_tokens * inPrice + completion_tokens * outPrice) / 1_000_000
  spentMicros += round(costUSD * 1_000_000)   // integer micro-USD, no float drift
  CAVEAT (group_ratio): the table is the Default group (group_ratio = 1x). v98store markup is
  NewAPI/OneAPI style; group_ratio ranges Default 1x up to Direct Claude 16x. If OUR key is on
  a higher group, real cost = group_ratio x the table, so CONFIRM our key's group and fold
  group_ratio into the constant. Credit note: a ~$1 top-up yields ~$8-10 of credit, so capping
  by credit-USD computed from usage is conservative (real cash burn is lower than the cap).

COST SANITY (Default group, rough): proposal-writer leans on claude-3-5-sonnet for its big
step (3.00/15.00 per 1M); a typical run is low single-digit cents, so 3 runs/day stays well
under 0.50. To cut cost sharply, switch heavy steps to cheaper modern ids (gpt-4o-mini, or
claude-haiku-4-5-20251001) - a PRODUCT decision, not changed here.

Balance / budget endpoint (SHOULD-HAVE, OpenAI-convention, NEEDS live confirm on v98store):
  GET https://v98store.com/v1/dashboard/billing/subscription   (hard_limit_usd)
  GET https://v98store.com/v1/dashboard/billing/usage
Use for the L2 global backstop and a low-balance alert. Support: Telegram @v98storebot.

Secrets: V98STORE_API_KEY lives in .env + the cPanel env only, never client-side, never on
public docs (same policy as the deployer key and Telegram token).

STILL NEEDS one real request with our key to lock 100% (build-time tasks, not product blockers):
- exact usage block shape (does it include prompt_tokens_details / cached-token fields?);
- that the billing/balance path actually works on v98store;
- our key's group_ratio (so the cost map is exact);
- any RPM/TPM/concurrency cap (not published; add retry + exponential backoff on 429).
