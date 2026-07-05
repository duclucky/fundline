# Crypto Due-Diligence Pack - design spec (DESIGN ONLY, not built)

Slug: `crypto-dd`. Type: custom executor `cryptodd` (like cv-gig-match, NOT the generic
node-graph engine) because it fetches real on-chain/market data from external APIs and
fans out to parallel specialists, then verifies claims against the fetched data.

Positioning (from fundline-strategy-research-2026-07.md): an OUTCOME deliverable for both
humans (crypto buyers doing diligence) and agents (x402/gateway). Fits Fundline's moat:
live public data + verifiable output. The x402 market already pays for "blockchain
analytics" and "premium data feeds" per-call; this packages that into one priced run.

## What it answers

Given a token, produce a risk report + a risk-scored table: is this token likely a
rug/honeypot/scam, how concentrated is ownership, how deep is liquidity, is the contract
renounced/verified, and what does recent news/sentiment say. Every claim is backed by a
cited data point or flagged UNVERIFIED.

## Input contract

```
{ "chain": "ethereum" | "bsc" | "base" | "arbitrum" | "polygon" | "solana" | ...,
  "token": "0x<address>"  // contract address; or a symbol/name to resolve via DexScreener search
  "prompt": "<optional free-text, same field the other workflows use>" }
```
Humans use the structured form (like cv-gig-match `wf.fields`): Chain (select) + Token
address/name. Agents pass the same JSON. If only a name is given, the intake node resolves
it to (chain, address) via DexScreener search and asks for disambiguation if multiple hits.

## Data sources (all LIVE-VERIFIED 2026-07-05, FREE, keyless except Tavily)

1. DexScreener `GET https://api.dexscreener.com/latest/dex/tokens/{address}` - free, no key.
   Returns per pair: chainId, dexId, priceUsd, liquidity.usd, volume.h24, fdv, marketCap,
   pairCreatedAt (proxy for launch age), txns. Also `/latest/dex/search?q=` to resolve a name.
2. GoPlus Security `GET https://api.gopluslabs.io/api/v1/token_security/{chainId}?contract_addresses={addr}`
   - free, no key (keyed higher limits optional). Returns: is_open_source, is_honeypot,
   buy_tax, sell_tax, is_mintable, owner_address (0x0 = renounced), can_take_back_ownership,
   is_proxy, is_blacklisted, transfer_pausable, holder_count, lp_holder_count, lp_locked,
   holders[] (top holders + %), creator_address/percent. Solana has a separate GoPlus
   endpoint (`/api/v1/solana/token_security`).
3. Tavily web search (already integrated via tavily-client.js) - news, audits, team, scam
   reports, community sentiment. Real URLs + citations.

Honest limits (state in UI): DexScreener/GoPlus cover major chains (ETH, BSC, Base,
Arbitrum, Polygon, Solana, etc.) but NOT brand-new/obscure chains; data can be incomplete
for tokens < a few hours old; the analyzed token lives on ITS chain (usually not Arc) while
payment settles on Arc. No holder data source is perfect; we report GoPlus figures and label
them as such. We do NOT give financial advice - this is a risk data summary.

## The crew (node-by-node)

FAST alias = gpt-4o-mini (all tiers). STRONG alias per tier: normal deepseek-v3.2 /
plus gpt-4.1-mini / pro claude-sonnet-4-6 (mirrors cv-gig-match).

1. INTAKE (deterministic + FAST fallback)
   - In: raw input. Out: { chain, address, resolved:bool, candidates?[] }.
   - Deterministic if a 0x address + chain given. If a name, call DexScreener search,
     pick the highest-liquidity match, record alternatives. FAST model only used to
     interpret messy free-text into {chain, token} when the structured fields are absent.

2. FAN OUT - parallel specialists (Promise.all; mostly API, cheap):
   a. MARKET & LIQUIDITY (data fetch + no LLM)
      - DexScreener -> priceUsd, liquidityUsd, vol24h, fdv, marketCap, pairAgeDays, dex,
        pairCount. Derives liquidity/mcap ratio, volume/liquidity ratio.
   b. SECURITY & OWNERSHIP (data fetch + no LLM)
      - GoPlus -> honeypot, taxes, mintable, owner renounced?, can_take_back_ownership,
        proxy, pausable, blacklist, lp_locked, holder_count, top-10 concentration %,
        creator %. This is the primary rug/honeypot signal.
   c. NEWS & NARRATIVE (retrieval + FAST)
      - Tavily search: "{name/symbol} token audit", "{name} rug scam", "{name} team".
        FAST model summarizes findings into {positives[], redFlags[], sources[]} with
        citations. Never invents; only summarizes fetched articles.
   (Contract age + verified status come from DexScreener pairCreatedAt + GoPlus
   is_open_source, so NO Etherscan key is needed - keyless.)

3. ANALYST (STRONG)
   - In: the three specialists' structured outputs. Out: findings across 5 dimensions:
     Liquidity, Holder concentration, Contract/ownership control, Honeypot/tax, Narrative/team.
     Each finding: { dimension, claim, evidence (the exact data point), severity }.
   - Prompt forces the model to cite the specific fetched value for every claim.

4. VERIFIER (STRONG) - the differentiator (MAST lesson: multi-agent needs a verify node)
   - In: analyst findings + the RAW fetched data (JSON). Out: each finding tagged
     CONFIRMED (evidence matches a real data point) or UNVERIFIED/DROPPED (no backing).
   - Adversarial prompt: "For each claim, find the exact supporting value in the data. If
     it is not present or contradicts the data, mark UNVERIFIED. Default to UNVERIFIED when
     unsure." Prevents the plausible-but-unbacked output the strategy report warned about.

5. WRITER (STRONG)
   - In: confirmed findings + data. Out: the artifact:
     - Markdown risk report (summary, per-dimension detail with data + citations, verdict).
     - A risk-scored table (see scoring) rendered in markdown AND returned as `riskJson`.
   - Overall verdict: e.g. "High risk - 2 critical flags (honeypot tax 40%, owner not
     renounced)". Includes an explicit "not financial advice / data as of <time>" line.

## Risk scoring (deterministic, in the executor - not left to the LLM)

Compute a 0-100 risk score from the fetched data so it is reproducible and not hallucinated:
- Honeypot / high tax (>10%): critical (caps score high).
- Owner not renounced + can mint / can_take_back_ownership / pausable / blacklist: high.
- Top-10 holder concentration > 50%: high; 30-50%: medium.
- Liquidity < $50k or liquidity/mcap < 2%: high; LP not locked: high.
- Pair age < 7 days: elevated (new).
- Not open source (unverified): high.
Each dimension gets a 0-100 sub-score + rationale + the data source. Overall = weighted max
(a single critical flag dominates). The LLM WRITES the narrative around these numbers; it
does not invent the numbers. This keeps the "expert" output trustworthy.

## Output (both audiences)

- `report` (markdown) - humans read it in the result modal; downloadable (existing Word/MD).
- `riskJson` - structured: { chain, address, name, symbol, overallScore, verdict,
  dimensions:[{key, score, severity, rationale, evidence, source}], data:{market, security,
  news}, disclaimers, generatedAt }. Agents parse this. Mirrors how cv-gig-match returns cvJson.
- Add `riskJson` to the /run response payload (like cvJson) so agents get structured output.

## Pricing (DECISION NEEDED - value-based vs cost-based)

Real v98 cost is low: ~3-5 LLM calls (intake FAST tiny + news FAST small + analyst +
verifier + writer STRONG) + 1-2 Tavily searches (~$0.008 each). Est. real cost:
normal ~$0.01-0.02, plus ~$0.02-0.03, pro ~$0.04-0.06 (MEASURE before shipping per the
process rule). Data APIs are free.

Two pricing philosophies:
- Cost-based (like the current 26 workflows): price ~= cost, e.g. 0.02 / 0.03 / 0.06.
- Value-based (strategy report recommendation, Bessemer "price to value"): this is an
  outcome deliverable a buyer would pay real money for, so price ABOVE cost:
  RECOMMENDED normal 0.10 / plus 0.20 / pro 0.40 USDC.
This is a strategy decision, not a measurement. Recommend value-based here (it is the whole
point of the "outcome economy" tier) but MEASURE real cost first to confirm margin, and keep
the per-IP + global v98 budget caps ON regardless (they track real cost, not the price).

## Payment - no new work

Works with ALL THREE existing gates automatically (escrow / x402 / Circle Gateway): the gate
logic in handleWorkflowRun is workflow-agnostic. Just needs the WORKFLOW_RUN_DEFS entry with
priceUnits. Agents pay per call; humans fund via the wallet flow. Non-custodial unchanged.

## Files to build (per create-workflow skill)

- NEW `crypto-data.js` - DexScreener + GoPlus + (reuse tavily) clients, normalized to one
  shape; injected getJson for tests; a failing source is skipped not fatal (like gig-sources.js).
- NEW `workflow-cryptodd.js` - the executor: intake -> parallel fetch -> analyst -> verifier
  -> writer, injected callModel + fetchData + searchWeb; deterministic risk scoring; returns
  { report, riskJson, steps, sources, totalCostMicros, meta }.
- `server.js` - WORKFLOW_RUN_DEFS["crypto-dd"] = { type:"cryptodd", name:"Crypto Due-Diligence
  Pack", tiers:{normal/plus/pro priceUnits + models} }; dispatch type "cryptodd" in
  handleWorkflowRun (mirror the cvgig branch); add riskJson to the result payload.
- `workflows.js` - WORKFLOWS["crypto-dd"] live entry (category Crypto, usesRetrieval true,
  wf.fields = [chain select, token], steps, pricing, modelCount); "View report" already
  handled by the result modal; optionally a structured risk-table render.
- NEW `test_workflow_cryptodd.js` + `test_crypto_data.js` - injected fakes, no network:
  parsing, risk scoring thresholds, verifier drop logic, cost summation, source-skip.

## Open decisions for the user

1. Pricing: value-based (0.10/0.20/0.40, recommended) vs cost-based (~0.02/0.03/0.06)?
2. Solana support in v1, or EVM-only first (GoPlus/DexScreener cover both, but Solana address
   format + a separate GoPlus endpoint add work)? Recommend EVM-only v1, Solana v2.
3. GoPlus/DexScreener free tier is rate-limited; fine for paid low-volume. Add a GoPlus API
   key later only if volume needs it. OK to ship keyless v1?
4. Name-resolution UX: if a symbol matches multiple tokens, return candidates for the user to
   pick, or auto-pick highest-liquidity? Recommend auto-pick + list alternatives in the report.
