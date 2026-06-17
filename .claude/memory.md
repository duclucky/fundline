# Claude working memory - Fundline

My personal, cross-session memory for this repo. It is loaded into context via an
`@import` in CLAUDE.md. Append durable, non-obvious working knowledge here: decisions
made, dead ends, user preferences, and open threads. Do not duplicate what CLAUDE.md or
.claude/rules/ already state. Keep entries dated (absolute dates).

## User preferences (observed)

- Communicates in Vietnamese and wants my replies in Vietnamese.
- Wants a modular `.claude/` setup: rules in `.claude/rules/`, subagents in
  `.claude/agents/`, and this memory file. Prefers following the real Claude Code spec.
- When redesigning UI: "giu nguyen phong cach, chi fix layout" - keep the existing
  dark/gold visual language, only fix layout, spacing, and responsive issues.
- Cares about minimizing context usage; favors delegating heavy reads to subagents.

## Key decisions

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

## Open threads / TODOs

- TODO: confirm where FundlineEscrow.sol work lives (planned, no file in repo yet, not
  deployed). When it lands, contract-auditor must enforce the no-withdraw invariant.
- Risk: USDC 6-vs-18 decimals. audit_report.md (Vietnamese) flags it High. .env.example
  carries ARC_NATIVE_USDC_DECIMALS=18 alongside ARC_USDC_DECIMALS=6.
- Hardcoded addresses (USDC, CCTP, chainId) are scattered across server.js and app.js; a
  single constants source is wanted but not done.
- No lint / typecheck / test runner. CI only runs `node --check` on app.js and server.js,
  then FTP-deploys to cPanel on push to main.

## Repo gotcha

- The real git repo is the nested `outputs/arc-invoice-usdc/` (remote
  github.com/duclucky/fundline, branch main). The outer `fundline/` folder's git is
  actually the Windows home dir (C:/Users/TBC) and tracks unrelated files. Always run git
  from `outputs/arc-invoice-usdc/`.
- Subagent / rule discovery is relative to the workspace root. These live in the nested
  repo's `.claude/`. If a session is rooted at the outer fundline/ folder, they may not
  auto-discover; open `outputs/arc-invoice-usdc/` as the workspace, or mirror `.claude/`
  up one level.
