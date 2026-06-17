---
name: escrow-build
description: Drive the phase-1 FundlineEscrow build end to end. Use when implementing, changing, compiling, auditing, or wiring FundlineEscrow.sol and its deploy script or /api/config integration. It reads escrow-spec.md, writes the contract and deploy script via the escrow-engineer agent, enforces the no-withdraw and no-fee invariant via a mandatory contract-auditor pass, wires ARC_ESCROW_ADDRESS and GET /api/config, and tests the full lifecycle. It never deploys or sends transactions.
---

# escrow-build

The repeatable pipeline for FundlineEscrow, the current roadmap phase 1. The full spec
(state machine, functions, invariant, integration) is in `.claude/rules/escrow-spec.md`;
deeper product context is in `../../fundline-product-master.md`. Read the spec before starting.

Hard gate: NO owner, admin, or privileged path may withdraw, seize, or redirect escrowed
funds, and there is NO fee mechanism. If any step would require breaking this, stop and
surface it instead of shipping.

Note on agents: project subagents are not available as `subagent_type` in this environment.
To use one, embed the contents of its `.claude/agents/<name>.md` file into a general-purpose
Agent prompt.

## Steps

1. Spec. Read `.claude/rules/escrow-spec.md`. Confirm the states (None, Funded, Submitted,
   Released, Refunded, Disputed) and the functions (fund, submitDeliverable,
   confirmAndRelease, releaseAfterReviewWindow, refund, raiseDispute, resolveDispute,
   getAgreement).
2. Write. Delegate to the escrow-engineer agent (embed `.claude/agents/escrow-engineer.md`).
   Produce `contracts/FundlineEscrow.sol` and `scripts/deploy-fundline-escrow.js` that
   mirrors `scripts/deploy-payment-router.js` (compile with solc, no Hardhat/Foundry, write
   the address back to .env). Decide IERC20.transferFrom vs msg.value deliberately and
   document it. All amounts use `parseUnits(amount, 6)`.
3. Compile. Compile with solc through the deploy script's compile path to confirm it builds.
   Do NOT deploy.
4. Audit (mandatory gate). Delegate to the contract-auditor agent (embed
   `.claude/agents/contract-auditor.md`) and run its FundlineEscrow checklist: every state
   transition guarded, funds move only buyer to escrow to (seller on release or buyer on
   refund), no owner withdraw, no fee skim, reentrancy on every external transfer, 6-decimal
   handling. If the verdict is CHANGES NEEDED, return to step 2. Do not proceed on a High finding.
5. Wire the server. Add `ARC_ESCROW_ADDRESS` (and to `.env.example`). Return `escrowAddress`
   in `GET /api/config` alongside `paymentRouterAddress` and `usdcTokenAddress`, using the
   existing config helper pattern. Use the backend-api-dev agent if the server wiring is
   non-trivial.
6. Test the lifecycle. Add or extend a `test_*.js` covering fund, submitDeliverable,
   confirmAndRelease, releaseAfterReviewWindow, refund, raiseDispute, and
   resolveDispute(true/false). Run it with node.
7. Finish. Run `node --check server.js`. Then run the predeploy-check skill before any push.

## Deploy

Deployment is a deliberate human action. When the audit passes and tests are green,
recommend the user run `node scripts/deploy-fundline-escrow.js` (it needs
`ARC_DEPLOYER_PRIVATE_KEY`). This skill and the agents never deploy or send transactions.
