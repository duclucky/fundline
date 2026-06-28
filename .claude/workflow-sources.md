# Community workflow sources (for replacing Fundline's mock workflows)

Status: RESEARCH (2026-06-28). The current Fundline `WORKFLOWS` catalog is demo/mock data
(simulated runs, fabricated metrics, no real per-step prompts). Direction: adapt publicly
shared, community-accepted LLM prompt-chains instead of inventing our own. This file is the
curated shortlist; licenses noted because we will adapt the structure.

Caveats: n8n template pages do not expose per-template usage counts (acceptance signal =
"published in the official curated library"); cited star counts are the framework repo's, not
a single template. Some items are router/parallel patterns, not strict linear chains.

## Shortlist (sourced)

Research
- GPT Researcher - plan -> parallel crawl/search -> summarize+cite -> aggregate -> write
  cited report. https://github.com/assafelovic/gpt-researcher ~27.9k stars, Apache-2.0.
- STORM (Stanford) - perspectives -> questions -> writer/expert convo -> outline -> article
  with citations -> polish. https://github.com/stanford-oval/storm ~29.5k stars, MIT.
- n8n Deep Research -> Notion - clarify -> queries -> search loop -> structured report.
  https://n8n.io/workflows/7160-... official library.
- n8n Market Research & Business Case - scope (GPT-4o) -> deep research (Perplexity) ->
  ~1500-word case (Claude) -> Google Docs. https://n8n.io/workflows/5430-... official library.

Content
- CrewAI Research -> Write -> Edit (DeepLearning.AI course) - Planner -> Writer -> Editor.
  https://github.com/ksm26/Multi-AI-Agent-Systems-with-crewAI (verify license at repo root).
- n8n Multi-Agent SEO Blog (8 agents) - keyword -> prompt-gen -> research -> outline -> write
  -> edit -> SEO -> internal-linking. https://n8n.io/workflows/8654-... official library.
- Promplify 4-step SEO (has VERBATIM prompts) - research -> outline -> draft -> edit.
  https://promplify.ai/blog/prompt-chaining/ (cite, do not copy verbatim).

Business / marketing
- CrewAI Marketing Strategy Crew - research -> understand -> strategy -> campaign ideas ->
  copy. https://github.com/crewAIInc/crewAI-examples (crews/marketing_strategy) ~6.1k stars, MIT.
- AirOps "6 Prompt Chaining Examples" - documented 5-step marketing chains (SEO/social/email).
  https://www.airops.com/blog/prompt-chaining-examples (no metric shown).

Code
- AI Code Reviewer (calimero) - parallel Security/Perf/Patterns/Logic/Style -> aggregate ->
  delta -> ranked report. https://github.com/calimero-network/ai-code-reviewer (only ~7 stars;
  structure is the value, not popularity), MIT. Linear alt: Security -> Performance ->
  Report-Writer (https://github.com/Ionio-io/LLM-agent-for-code-reviews).

Crypto / Web3
- n8n CoinMarketCap Data Analyst - supervisor routes Crypto -> Exchange/Community ->
  DEXScan agents, then formats. https://n8n.io/workflows/3425-... official library (router pattern).
- CrewAI Stock Analysis (re-skin for tokens) - financials -> research/news -> filings ->
  recommend. https://github.com/crewAIInc/crewAI-examples (crews/stock_analysis) ~6.1k stars, MIT.

Excluded on purpose: awesome-chatgpt-prompts (~164k stars) = single-role personas, not chains.

## Recommended first 5 (map onto existing Fundline workflows)

1. GPT Researcher skeleton -> upgrade Client Research + Crypto Research Report. Apache-2.0,
   ~28k stars, the best general research-report chain.
2. CrewAI Research->Write->Edit -> SEO Article + X Thread Writer. Most-copied content chain,
   3 simple steps, easy to specialize per output format.
3. CrewAI Marketing Strategy Crew -> a new Marketing/Campaign workflow (fits Proposal Writer's
   "build context -> strategize -> deliverable" shape). MIT, official example.
4. Promplify / AirOps SEO chains -> harden SEO Article with copy-ready per-step prompts.
5. CrewAI Stock Analysis re-skinned for tokens (+ CoinMarketCap tooling) -> proper 4-step
   Crypto Research Report (fundamentals -> news/sentiment -> on-chain -> recommendation).

Code stays lower priority: use the Security -> Performance -> Report-Writer shape.

## Notes for adapting these into Fundline
- We only need the STEP STRUCTURE + prompt intent; rebuild each step as a v98store chat call
  (see the v98store-api skill). We are not importing CrewAI/n8n runtimes.
- Keep attribution where a license requires it; MIT/Apache structures are safe to adapt.
- Each adapted workflow needs: real per-step prompt templates, a model per step (map to a real
  v98store id), and how each step output feeds the next. That is the actual content work.
