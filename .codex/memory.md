# Fundline Working Memory

## 2026-07-23

- On 2026-08-25, all workflow model calls moved to the shared CheapKeyAI connection at `https://cheapkeyai.shop/v1`. The canonical configuration is `CHEAPKEYAI_*`; `WORKFLOW_FINAL_API_KEY` remains only as a temporary API-key compatibility fallback.
- Keep `gpt-5.6-luna`, `gpt-5.6-terra`, and `gpt-5.6-sol` as the normal, plus, and pro final-node defaults. Model IDs and prices are centralized in `cheapkey-models.js`.
- CheapKeyAI workflow calls default to `CHEAPKEYAI_TIMEOUT_MS=300000`. Preflight checks use `/models` and `/balance`; no paid live request was made during the provider cutover.
- Telegram settings now expose derived `not_linked`, `pending`, and `active` state. Saving an unchanged active chat ID preserves activation, while a missing or mismatched claim is repaired as pending. Test-message delivery never claims activation; `/start` remains the activation boundary.
- Invoice verification is transaction-first and bounded. A supplied txHash never falls into recent scans; no-hash discovery uses at most two explorer pages, twenty router candidates, and four concurrent receipt reads. Browser verification starts immediately, retries every two seconds, and has a sixty-second deadline with ten-second request timeouts.
- Paid browser workflows use durable async jobs when the server exposes `workflowAsyncEnabled`. The browser persists only wallet-scoped recovery metadata, rotates configured read RPCs on retryable failures, and can resume authorized jobs after reload.
- Durable workflow results are visible during `settlement_pending`. Settlement and refund reconciliation retries after five seconds without rerunning model execution, and treasury confirmation waits are bounded at thirty seconds.
- Every successful workflow now finalizes a backend PDF artifact before result persistence and settlement. Existing document PDFs are preserved, web history retains URL-backed artifacts, MCP exposes them as deliverable resource links, and document TTL is no shorter than result TTL.
