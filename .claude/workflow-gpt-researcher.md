# GPT Researcher - adaptation reference for a Fundline workflow

Status: RESEARCH (2026-06-28). Source: https://github.com/assafelovic/gpt-researcher
(Apache-2.0, ~27.9k stars). Prompts below are VERBATIM from `gpt_researcher/prompts.py`
(PromptFamily base class); config defaults from `gpt_researcher/config/variables/default.py`,
master branch. We adapt the STEP STRUCTURE + prompts into sequential v98store chat calls; we do
NOT import GPT Researcher / LangChain runtime. Apache-2.0: keep an attribution comment in code.

## Config defaults (real)

  RETRIEVER=tavily         SCRAPER=bs (BeautifulSoup)
  FAST_LLM=gpt-4o-mini     SMART_LLM=gpt-4.1     STRATEGIC_LLM=o4-mini
  MAX_ITERATIONS=3 (sub-queries)   MAX_SEARCH_RESULTS_PER_QUERY=5
  TOTAL_WORDS=1200   REPORT_FORMAT=APA   TEMPERATURE=0.4   SUMMARY_TOKEN_LIMIT=700
  MAX_SUBTOPICS=3 (detailed mode)   deep-research mode: breadth 3 / depth 2 / concurrency 4

## Real pipeline (default research_report type)

1. Role select (auto_agent_instructions) -> persona prompt, used as system msg for later steps.
2. Plan (generate_search_queries_prompt, FAST) -> 3 natural-language sub-queries.
3. Retrieve (Tavily) -> ~5 results/query (~15 candidate sources). EXTERNAL TOOL.
4. Scrape (BeautifulSoup) -> page text. EXTERNAL TOOL.
5. Summarize per source (generate_summary_prompt, FAST, ~700-token cap).
6. (Optional) Curate (curate_sources) -> JSON filter to <=10, prioritize quantitative.
7. Aggregate -> concatenate summaries into one context blob (CODE, no prompt).
8. Write (generate_report_prompt, SMART) -> ~1200-word markdown report, APA citations + refs.

## Retrieval dependency (critical)

Quality comes from steps 3-4 (live search + scrape). Without them: planner emits queries nobody
runs; summarize/curate have nothing; writer falls back to model memory -> NO real citations,
stale facts, FABRICATED urls (the prompt demands hyperlinked sources). Fundline has no retrieval
tool today. Options:
- A: add a search API (Tavily = native fit, returns snippets so MVP can skip a scraper).
  Alts: SerpAPI, Brave, Bing. Faithful to the original. Adds one external service + cost.
- C1: user pastes URLs/text; skip search; run summarize -> curate -> write on their material.
  Real citations, no API, but user does retrieval.
- C2: knowledge-only, no sources. MUST drop citation requirements + label output un-sourced.
  Weaker, different product; do not market as research-grade.
Recommendation: ship A (Tavily) for the real workflow + offer C1 as a no-API fallback mode.
Avoid C2 as a standalone "research" feature. (Tavily has a free tier; confirm exact limits.)

DECIDED 2026-06-28 (user): Option A + C1. Use Tavily for real search/retrieval, plus a
paste-your-sources fallback mode. C2 (knowledge-only) not used. Build needs a TAVILY_API_KEY
(.env + cPanel, secret). Tavily API to confirm at build time: endpoint (POST
https://api.tavily.com/search), request { api_key, query, max_results, include_raw_content },
response results[] with content snippets, and the free-tier credit limit.

## Adapted Fundline chain (sequential v98store calls)

  # Step              Model    Input -> Output                                   Needs search
  0 Role Select       cheap    query -> agent_role_prompt persona (JSON)          no
  1 Planner           cheap    query -> 3 search queries                          no
  2 Retrieve+Scrape   tool     queries -> source texts + URLs                     YES (A/C1)
  3 Summarize/source  cheap    source_text + query -> factual summary             no
  4 Curate            cheap    summaries + query -> filtered JSON source list     no (optional MVP)
  5 Writer            strong   curated context + query + persona -> cited report  no

Map v98store models: cheap = gpt-4o-mini (0.15/0.60) or claude-haiku; strong = the report model
(gpt-4.1, or claude-sonnet for quality). Always send max_tokens. See the v98store-api skill.

## Verbatim prompts

### auto_agent_instructions (Step 0 system) - static, no vars
(emoji live INSIDE the LLM prompt; STRIP the emoji from server name before any UI display)

  This task involves researching a given topic, regardless of its complexity or the availability of a definitive answer. The research is conducted by a specific server, defined by its type and role, with each server requiring distinct instructions.
  Agent
  The server is determined by the field of the topic and the specific name of the server that could be utilized to research the topic provided. Agents are categorized by their area of expertise, and each server type is associated with a corresponding emoji.

  examples:
  task: "should I invest in apple stocks?"
  response:
  {
      "server": "Finance Agent",
      "agent_role_prompt": "You are a seasoned finance analyst AI assistant. Your primary goal is to compose comprehensive, astute, impartial, and methodically arranged financial reports based on provided data and trends."
  }
  task: "could reselling sneakers become profitable?"
  response:
  {
      "server": "Business Analyst Agent",
      "agent_role_prompt": "You are an experienced AI business analyst assistant. Your main objective is to produce comprehensive, insightful, impartial, and systematically structured business reports based on provided business data, market trends, and strategic analysis."
  }
  task: "what are the most interesting sites in Tel Aviv?"
  response:
  {
      "server": "Travel Agent",
      "agent_role_prompt": "You are a world-travelled AI tour guide assistant. Your main purpose is to draft engaging, insightful, unbiased, and well-structured travel reports on given locations, including history, attractions, and cultural insights."
  }

(Original source has emoji in server names and a typo missing-quote in the first example; cleaned
above. Parse the JSON, use agent_role_prompt as the system message for steps 3-5.)

### generate_search_queries_prompt (Step 1) - vars: max_iterations(3), task, today
  Write 3 search queries to research the following task: "{query}"

  Each query must be a plain natural language phrase. Do not use search operator syntax
  such as site:, filetype:, inurl:, intitle:, OR, AND, or NOT.

  Assume the current date is {today} if required.

  You must respond with a list of strings in the following format: ["query 1", "query 2", "query 3"].
  The response should contain ONLY the list.

### generate_summary_prompt (Step 3) - vars: data, query  [VERBATIM]
  {source_text}
   Using the above text, summarize it based on the following task or query: "{query}".
   If the query cannot be answered using the text, YOU MUST summarize the text in short.
   Include all factual information such as numbers, stats, quotes, etc if available.

### curate_sources (Step 4, optional) - vars: query, sources, max_results(10)  [VERBATIM]
  Your goal is to evaluate and curate the provided scraped content for the research task: "{query}"
      while prioritizing the inclusion of relevant and high-quality information, especially sources containing statistics, numbers, or concrete data.

  The final curated list will be used as context for creating a research report, so prioritize:
  - Retaining as much original information as possible, with extra emphasis on sources featuring quantitative data or unique insights
  - Including a wide range of perspectives and insights
  - Filtering out only clearly irrelevant or unusable content

  EVALUATION GUIDELINES:
  1. Assess each source based on:
     - Relevance: Include sources directly or partially connected to the research query. Err on the side of inclusion.
     - Credibility: Favor authoritative sources but retain others unless clearly untrustworthy.
     - Currency: Prefer recent information unless older data is essential or valuable.
     - Objectivity: Retain sources with bias if they provide a unique or complementary perspective.
     - Quantitative Value: Give higher priority to sources with statistics, numbers, or other concrete data.
  2. Source Selection:
     - Include as many relevant sources as possible, up to {max_results}, focusing on broad coverage and diversity.
     - Prioritize sources with statistics, numerical data, or verifiable facts.
     - Overlapping content is acceptable if it adds depth, especially when data is involved.
     - Exclude sources only if they are entirely irrelevant, severely outdated, or unusable due to poor content quality.
  3. Content Retention:
     - DO NOT rewrite, summarize, or condense any source content.
     - Retain all usable information, cleaning up only clear garbage or formatting issues.
     - Keep marginally relevant or incomplete sources if they contain valuable data or insights.

  SOURCES LIST TO EVALUATE:
  {sources}

  You MUST return your response in the EXACT sources JSON list format as the original sources.
  The response MUST not contain any markdown format or additional text (like ```json), just the JSON list!

### generate_report_prompt (Step 5) - system = persona; vars: context, question, report_format(APA), total_words(1200), today
  Information: "{aggregated_summaries_with_urls}"
  ---
  Using the above information, answer the following query or task: "{query}" in a detailed report --
  The report should focus on the answer to the query, should be well structured, informative, in-depth, and comprehensive, with facts and numbers if available and at least 1200 words.

  Guidelines:
  - Determine your own concrete opinion based on the information; do not defer to vague conclusions.
  - Write in markdown using # / ## / ### headers; use tables for structured comparisons.
  - Prioritize reliable and recent sources.
  - Do NOT include a table of contents.
  - Use in-text citations as markdown hyperlinks at the end of the relevant sentence: ([source](url)).
  - Add a references list at the end with full URLs.
  - You MUST write all used source URLs as references, no duplicates, each hyperlinked [url](url).
  Write in english. Assume the current date is {today}.

(If no-retrieval C2 mode is ever used: REMOVE every citation/reference guideline above and add a
line that the report is based on model knowledge without live sources.)

## Flags
- No standalone aggregation prompt exists; aggregation is code (concatenate summaries).
- total_words: function-signature default 1000 vs config 1200; use 1200 (the value that runs).
- Ignore the IBM-Granite prompt subclasses (doc-format tweaks only).
- For Crypto Research Report: same chain, persona = Finance Agent, add CoinGecko/on-chain data
  as extra step-2 sources alongside Tavily.
