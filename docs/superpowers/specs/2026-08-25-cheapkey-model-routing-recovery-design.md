# CheapKeyAI Model Routing Recovery Design

Date: 2026-08-25
Status: Approved for implementation

## Incident

The production Client Research run reached its final model after earlier `gpt-4o-mini` calls succeeded. CheapKeyAI rejected `gpt-5.6-luna` twice with HTTP 404 and once with HTTP 503 because the API key's active group had no configured channel for that model. Fundline then refunded the escrow correctly.

The CheapKeyAI catalog is global and can list a model that is not routable for the current key group. Existing usage logs confirm that `cheap-5.6-sol` is routable for the same key. The account catalog also exposes `cheap-5.6-terra`; there is no `cheap-5.6-luna` alias.

## Routing decision

Use group-compatible aliases as the default final models:

- Normal: `cheap-5.6-sol`
- Plus: `cheap-5.6-terra`
- Pro: `cheap-5.6-sol`

Normal and Pro share the proven final alias for now. Their full workflow quality and fixed USDC price still differ because their intermediate model tiers differ. This avoids sending the known-unroutable `gpt-5.6-*` IDs.

Keep each `WORKFLOW_FINAL_MODEL_*` environment variable as an override. Existing cPanel overrides must be changed or removed if they still contain a `gpt-5.6-*` value.

## Registry and preflight

Add the two `cheap-5.6-*` aliases to the centralized model registry. Keep conservative cost metadata for budget enforcement. Preflight will then verify the exact configured aliases against `/models` instead of accepting the old global catalog IDs.

No paid completion will be added to preflight. It remains a free readiness check and cannot guarantee that an upstream channel stays routable after the check. Runtime failures continue to use the existing refund path.

## UI recovery

Apply the separately approved terminal UI design in `2026-08-25-workflow-refund-terminal-ui-design.md`. A terminal `refunded` or `failed` response must restore the action as `Try again` without automatically creating a new job or payment.

## Testing

- Add failing assertions for the new default final aliases and their prices.
- Add failing assertions for terminal button-state mapping.
- Verify model-provider, preflight, async job, settlement, and browser runtime behavior.
- Run syntax checks and the predeploy gate before pushing to `main`.
- Do not run paid CheapKeyAI model tests during implementation.

## Acceptance criteria

- Production no longer sends `gpt-5.6-luna`, `gpt-5.6-terra`, or `gpt-5.6-sol` by default.
- Normal and Pro use `cheap-5.6-sol`; Plus uses `cheap-5.6-terra`.
- A refunded or failed job restores an enabled `Try again` action.
- Escrow refund behavior and payment safety remain unchanged.
- Relevant automated tests pass before deployment.
