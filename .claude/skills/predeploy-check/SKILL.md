---
name: predeploy-check
description: Run the full pre-push gate for Fundline before pushing to main, which auto-deploys to cPanel via FTP. Use before any git push, or when the user says "check before deploy / ship / release / push". It runs node --check on app.js and server.js, runs the relevant node test_*.js, scans the diff for the hard rules (no em dash, no emoji on UI text, English copy, USDC 6-decimal math, no secrets, non-custodial), and confirms the working dir is the nested repo. Returns a GO or NO-GO verdict. It does NOT push.
---

# predeploy-check

The gate before pushing to `main`. A push to main triggers `.github/workflows/deploy.yml`,
which runs `node --check` on app.js and server.js then FTP-deploys to cPanel. A bad
`node --check` blocks the deploy, and anything merged is live, so verify first.

Run every step. Report a single GO or NO-GO verdict with the exact fixes for any failure.
Do NOT run `git push` yourself; report the result and let the user push.

## Steps

1. Confirm the repo. Run `git rev-parse --show-toplevel`; it must end with
   `outputs/arc-invoice-usdc` (the real repo, remote duclucky/fundline). If it points at the
   outer `fundline/` working folder, stop and switch, then continue. Run all commands from
   the repo root.
2. Syntax (CI blocker). Run `node --check app.js` and `node --check server.js`. Any failure
   is an immediate NO-GO.
3. Tests. Run the standalone `node test_*.js` scripts relevant to what changed (for example
   `node test_cctp_fee.js`, `node test_stepper.js`). There is no test runner; these are
   plain node scripts. Note which were run and which were skipped.
4. Scan the changed files only (`git diff --name-only` plus staged) for the hard rules:
   - Long em dashes anywhere in code, comments, or UI text.
   - Emojis or icons attached to website text.
   - Non-English UI copy, comments, or docs.
   - Secrets: private keys, `.env` values, raw API keys. Confirm no `.env` or `data/` files
     are staged (both are deploy-excluded and gitignored, but block them anyway).
   - USDC decimal hazards: `1e18`, `parseEther`, or any 18-decimal assumption on a USDC
     amount. USDC on Arc is 6 decimals; amounts use `parseUnits(amount, 6)`.
   - Non-custodial violations: any owner or admin path that can withdraw or seize user or
     escrowed funds.
5. Optional deeper review. For a non-trivial diff, delegate a rule-compliance pass to the
   diff-reviewer subagent. Note: project subagents are not available as `subagent_type` in
   this environment, so embed the contents of `.claude/agents/diff-reviewer.md` into a
   general-purpose Agent prompt and ask it to review the current diff.
6. Verdict. GO only if steps 2 to 4 pass. Otherwise NO-GO with file:line and the concrete
   fix for each issue.

## Notes

- This skill never pushes, deploys, or sends transactions.
- For contract or escrow changes, run the escrow-build audit gate first; this skill does
  not compile or audit Solidity.
