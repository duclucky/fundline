# Workflow Refund Terminal UI Design

Date: 2026-08-25
Status: Approved direction

## Problem

The durable workflow poller correctly receives the terminal `refunded` status and displays that the escrow payment was refunded. It does not reset the run button in this terminal branch. The button therefore remains disabled with the previous `Refunding...` label, making a completed refund look stuck.

Production evidence from the Client Research page showed both signals at once:

- Disabled action button labeled `Refunding...`
- Terminal message stating that the workflow did not complete and the escrow payment was refunded

The provider preflight remained healthy, so this design addresses the confirmed terminal UI defect independently from the upstream workflow failure.

## Desired behavior

While a durable job is active, the run button remains disabled and shows the current state. When polling reaches a terminal state:

- `succeeded`: enable the button and label it `Run again`.
- `refunded`: enable the button and label it `Try again`.
- `failed`: enable the button and label it `Try again`.

The existing error or refund message remains visible. The user's prompt, selected tier, and source mode remain unchanged.

## Safety boundaries

- Do not automatically rerun the workflow.
- Do not automatically create, approve, fund, or reuse a payment.
- Do not change escrow or backend settlement behavior.
- Do not remove recovery records before the current terminal handling already does so.
- Do not expose provider or internal exception details in the browser.

## Implementation design

Add a small pure state-mapping helper to `workflow-browser-runtime.js`. It returns the final button state for terminal job statuses and returns no state for active statuses. Use this helper in `pollDurableWorkflow` after a terminal response.

Keeping the mapping in the existing browser runtime makes the behavior directly testable without loading the full page script or adding a DOM test dependency. `workflows.js` remains responsible for applying the returned label and disabled state to `#wfRunBtn`.

The terminal error message already provides clear feedback. The restored `Try again` action supplies the missing recovery path and follows the existing Fundline visual language without adding new layout, color, icon, or motion rules.

## Test design

Extend `test_workflow_browser_runtime.js` before production changes. Verify:

- `succeeded` maps to enabled `Run again`.
- `refunded` maps to enabled `Try again`.
- `failed` maps to enabled `Try again`.
- Active states such as `refunding` do not map to a terminal button state.

Then verify `workflows.js` consumes the helper in both success and failure terminal branches. Run syntax checks and the workflow browser, async API, job worker, job settlement, and UI contract tests.

## Acceptance criteria

- A refunded workflow no longer leaves the run button disabled or labeled `Refunding...`.
- The user can deliberately start a new run with the existing form values.
- No automatic payment or rerun occurs.
- Existing successful-run behavior remains unchanged.
- Relevant tests pass and the deployed page reflects the terminal state correctly.
