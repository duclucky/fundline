# CLAUDE.md - Fundline (fundline.xyz)

Persistent context for coding sessions. Keep it accurate. If something here drifts
from the code, fix the code or fix this file.

Fundline is a non-custodial verification-and-settlement layer on Arc that turns a raw
USDC transfer into a trusted business event (human invoices, AI-agent x402 pay-per-call,
creator pay-per-item). The longer-term vision is a trust layer and job marketplace for the
AI-agent economy (Identity, Competence, Reputation, Matching, Settlement). Stack: plain
Node.js `http` server plus vanilla browser JS, no framework, no build step. This directory
(`outputs/arc-invoice-usdc/`) is the git-tracked app repo. Deep product and strategy detail
is in `../../fundline-product-master.md` (kept outside the repo, not deployed).

## Rules

Detailed, per-topic guidance lives in `.claude/rules/`. Files there with no `paths:`
frontmatter load automatically at session start. Read them before working:

- `.claude/rules/project-overview.md` - what Fundline is and current build status
- `.claude/rules/architecture.md` - tech stack, directory map, agent + x402 surface
- `.claude/rules/onchain-reference.md` - contract addresses, chainId, RPC, CCTP, decimals
- `.claude/rules/commands.md` - install, run, test, contract deploy
- `.claude/rules/coding-conventions.md` - hard requirements (style, language, invariants)
- `.claude/rules/glossary.md` - domain terms (PaymentRouter, x402, CCTP, SBT, etc.)
- `.claude/rules/gotchas.md` - fragile areas and "do not touch"
- `.claude/rules/git-workflow.md` - git layout, commit style, CI/CD
- `.claude/rules/escrow-spec.md` - FundlineEscrow spec (state machine, functions, invariant, integration)

To make a rule load only for specific files instead of every session, add a `paths:`
glob frontmatter block to that rule file (Claude Code rule spec). None are scoped today
because all current rules are project-wide.

## Subagents

Project subagents live in `.claude/agents/`. Delegate to them to keep this session's
context lean (they read/audit in their own window and return only the result):

- `fundline-explorer` - read-only navigator; "where is X / how does Y work" across the big server.js and app.js
- `contract-auditor` - Solidity security review (non-custodial invariant, decimals); use on contracts/ and deploy script
- `backend-api-dev` - server.js work: agent API, webhooks, x402, CCTP, verification
- `frontend-ui-dev` - HTML/CSS/JS UI work; enforces brand rules (no emoji, no em dash, gold theme)
- `diff-reviewer` - read-only pre-commit check against the hard rules
- `escrow-engineer` - writes FundlineEscrow.sol, its deploy script, and /api/config wiring (phase 1)
- `trust-layer-architect` - read-only designer for the phase-2 trust layer (Competence, SBT, Reputation, Matching)

## Skills

Packaged procedures in `.claude/skills/<name>/SKILL.md`, invoked with `/<name>`. They encode
repeatable workflows and orchestrate the subagents:

- `predeploy-check` - the ship gate before pushing to main (syntax, tests, rule and secret scan)
- `escrow-build` - the phase-1 FundlineEscrow pipeline (write, audit, wire, test); never deploys
- `verify-payment-audit` - settlement-integrity audit of the on-chain payment verification path

## Memory

My personal cross-session working memory for this repo (decisions, TODOs, gotchas):
@.claude/memory.md

Keep `.claude/memory.md` current. Update it as decisions land, and when the session is
winding down or the context is about to be summarized, flush any new decisions, TODOs, and
gotchas into it (dated, English, no duplication of CLAUDE.md or the rule files). A
`PreCompact` hook in `.claude/settings.json` prints a reminder before compaction, but it is
best-effort, so prefer updating memory proactively rather than relying on the reminder.

## Critical rules summary (full detail in the rule files above)

These must always hold, even if the rules directory is not loaded:

- Code, comments, UI copy, and docs are in English.
- Do NOT use long em dashes in code, comments, or UI text.
- Do NOT attach icons or emojis to text on the website.
- USDC has 6 decimals on Arc and is also the gas token. Never assume 18 decimals.
  Centralize decimal handling. `10.50 USDC` is `10500000` base units.
- Non-custodial invariant: no owner or admin path may withdraw user or escrowed funds.
  Flag any code that violates this.
- Follow the existing style (CommonJS, two-space indent, double quotes). Do not introduce
  a new formatter/linter or restyle untouched code.
- Run git and npm commands from this directory (`outputs/arc-invoice-usdc/`), which is the
  real repo. The outer `fundline/` folder is not its own git repo.

## Docs publishing policy (public docs.html / docs.js)

The docs page deploys to the public site. When writing or editing it, publish only what an
integrator needs to USE the product; keep anything that helps an attacker probe the system
or a competitor clone it OUT of the public page.

- No secrets and no full server `.env` surface. Do not enumerate secret env vars (API key,
  Telegram bot token, deployer private key) on the public docs; point self-hosters to the
  repo `.env.example` instead.
- Public, on-chain-verifiable references are fine (chainId, RPC, USDC address, explorer,
  deployed contract address) since they are already public.
- Do NOT publish the internal verification / anti-double-spend implementation, or the
  phase-2 trust-layer design (Competence exams, Reputation, SBT, Matching). A high-level
  non-custodial / correctness claim is acceptable for transparency; the recipe is not.
- Use placeholder values in examples (e.g., `0xYourMerchantWallet`), never real operational
  wallets, tokens, or keys. Generalize internal paths (say "stored on the server", not a
  concrete `data/*.json` path).
