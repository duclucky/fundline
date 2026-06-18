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
  longer an opt-out) - candidate for removal/deprecation. The sellers[merchantWallet] lookup is
  case-safe (normalizeAddress lowercases both the invoice wallet and the seller key).

## Open threads / TODOs

- Phase 1 (active): build, audit, and deploy FundlineEscrow per `escrow-spec.md`. No file
  yet. Use the escrow-engineer agent to write it and contract-auditor to review before any
  deploy; the no-withdraw and no-fee invariants are make-or-break.
- TODO: verify the PaymentRouter source on arcscan (is_verified currently false).
- RESOLVED 2026-06-18: USDC 6-vs-18 decimals is NOT a risk (audit_report.md flagged it High).
  Verified against docs.arc.io: native gas-token value uses 18 decimals, ERC-20 interface uses
  6, both handled correctly (ERC-20/router path uses ARC_USDC_DECIMALS=6, native fallback uses
  ARC_NATIVE_USDC_DECIMALS=18). The .env.example values are correct as-is.
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
