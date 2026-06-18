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
  longer an opt-out) - removed in `cafb03a`. The sellers[merchantWallet] lookup is case-safe
  (normalizeAddress lowercases both the invoice wallet and the seller key).
- 2026-06-18: Removed the dead per-invoice telegramEnabled flag committed `cafb03a` (pushed).
  state.settings.telegramEnabled was never set (not in readSettingsDraft/defaults/server load),
  so the flag was always false and dead on both sides. Dropped it from normalizeInvoice and the
  app.js create payload; the client sendPaymentNotification now sends only on an explicit test
  (force) since real paid alerts are sent server-side (avoids duplicate messages). Also replaced
  5 pre-existing em dashes in app.js with hyphens to satisfy the no-em-dash rule.

- 2026-06-18: Part B (Arc payment flow) completed. Testnet dry-run verified (`test_multicall_dryrun.js`):
  Tx1 approve (35k gas) + Tx2 payInvoice (52k gas), InvoicePaid payer==signer confirmed on Arc testnet.
  Root finding: Multicall3From's CallFrom precompile (0x1800...0003) throws StackUnderflow for ANY
  subcall target (both USDC precompile 0x3600... and regular contracts like PaymentRouter). The 1-tx
  [approve+pay] batch is not viable on current Arc testnet.
  Final implementation: 2-tx flow -- if allowance < amount, send direct USDC.approve (via sendUsdcApprove)
  + waitForArcTx (60x3s polling), then send direct PaymentRouter.payInvoice (via sendRouterPayment).
  If allowance >= amount: 1-tx direct payInvoice (unchanged). Dead code removed from app.js:
  encodeMulticall3Batch, sendMulticall3FromPayment, MULTICALL3FROM_ADDRESS, MULTICALL3_AGGREGATE3_SELECTOR.
  ABI encoding bug ALSO fixed (baseOffset = N*32 not (1+N)*32 -- offsets relative to head section start,
  not array start). 25-assertion unit test in test_multicall_pay.js validates the correct ABI encoding.
  Arcscan approve: 0x4eaa2f4137aeb5242e265b5797bb10981c5b948d8899ae549f38c4ce2d3b12a3
  Arcscan pay:     0x3f8888cccbbf2ef86943ef57f3be4326419588999594ad7109e043196dc526ed
- 2026-06-18: Circle Gateway PARKED, removed from client UI. Built Part A end-to-end (server
  proxy 30bb820, client flow 5fa5aca, fee fix 8057733) and dry-ran ETH Sepolia (domain 0) ->
  Arc on testnet. Decision: Gateway is the WRONG default for invoice payers. A one-off payer
  must wait for deposit finality (~19 min on ETH Sepolia/Ethereum) before the unified balance
  is spendable, so first payment is no faster than CCTP Standard -- they abandon. Gateway only
  wins for REPEAT payers who pre-fund a balance (then each transfer is <500ms, gasless on Arc).
  Product direction (user choice): CCTP Fast Transfer is the sole cross-chain path for one-off
  payers (~8-20s); direct Arc pay when funds already on Arc. CCTP Fast was ALREADY implemented
  in app.js (resolveCctpFee fast=true -> IRIS fee tier, finalityThreshold 1000, maxFee capped
  at 1%, fallback to Standard) and wired as the default bridge-pay path -- no new work needed.
  Removed from app.js (1 commit, -323 lines): GATEWAY_* constants, gateway-* payment options,
  the gateway branch in refreshPaymentSourceStatus, gateway- prefix in getPaymentSourceChain,
  the gateway-pay action, and all 6 gateway helpers (readGatewayBalance, buildGatewayBurnIntent,
  pollGatewayTransferStatus, pollForGatewayBalance, gatewayPayInvoice, _retryGatewayPay). Also
  deleted duplicate addressToBytes32/randomBytes32 (Gateway had re-declared them; originals at
  the bottom of app.js survive and CCTP uses those). KEPT for later revival: server.js proxy
  routes + public-config gateway fields, test_gateway_dryrun.js, test_gateway_finish.js.
  Testnet constraints found for the ETH Sepolia -> Arc route (recorded for revival): min maxFee
  is 1 USDC (not 0.5), the API enforces a maxBlockHeight floor ~50k blocks above a lagging
  public RPC head (read "expected at least N" from the 400 and re-sign at N+buffer), and the
  balance reservation is value + maxFee (so 1.5 USDC deposit only covers value <= 0.5 at the
  1 USDC fee floor). No public-facing page ever referenced Gateway; only app.js did.
- 2026-06-18: CCTP Fast Transfer verified end-to-end on testnet (`test_cctp_fast_dryrun.js`).
  ETH Sepolia (domain 0) -> Arc (domain 26), 0.5 USDC. Fast tier confirmed live for both
  routes via the IRIS fee API: Base Sepolia->Arc = 1.3 bps, ETH Sepolia->Arc = 1.0 bps
  (Standard tier 2000 is free). Round trip: burn (gas 109103) -> attestation ready in 11s
  (Fast soft finality, finalityThreshold 1000) -> receiveMessage mint on Arc (gas 175768)
  -> Arc balance +0.496345 USDC. Total wall-clock ~58s. KEY PROOF for the product concern:
  a one-off cross-chain payer is served in ~1 minute, not the ~19 min a Gateway deposit would
  need. Gotcha recorded: the Arc balance delta is below the 0.5 transfer because Arc's gas
  token IS USDC, so the wallet-sent receiveMessage tx pays ~0.0036 USDC gas out of the same
  balance (plus the tiny CCTP fee). The dry-run assertion was corrected to allow a ~2% band
  for fee + Arc gas. Burn tx 0xbe061144...d66215c, mint tx 0x341be3a2...edf37ac3.
- 2026-06-18: Arc Transaction Memos evaluated for Fundline (`test_memo_probe.js`). Arc shipped
  a predeployed Memo contract at `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` (testnet, activated
  ~2026-06-13): `memo(address target, bytes data, bytes32 memoId, bytes memoData)` forwards a
  call to `target` via the CallFrom precompile (preserves the original EOA as msg.sender) and
  emits `Memo(sender, target, callDataHash, memoId, memo, memoIndex)` for offchain indexing.
  EOA-only callers; STATICCALL/DELEGATECALL unsupported; child revert rolls back the whole tx.
  PROBE RESULT (Arc testnet, tx 0x11068fb2...09225): memo-wrapped USDC self-transfer SUCCEEDED,
  gas 61548, USDC Transfer from==payer (msg.sender preserved), Memo event emitted with memoId.
  This UPDATES the Part B finding that CallFrom threw StackUnderflow: via the Memo contract,
  CallFrom WORKS on the current testnet. Implication: the single-transaction invoice payment
  Fundline abandoned in Part B (2-tx approve+payInvoice) is viable again as
  `Memo.memo(USDC, transfer(merchant, amount), onchainInvoiceId, memoBytes)` -- 1 tx, no approve
  (USDC.transfer pulls from the preserved payer), gas ~61.5k vs ~87k for the 2-tx flow. Memos
  could also let Fundline DROP the custom PaymentRouter (memoId carries the invoice id in a
  standard, indexable way; moots the verify-PaymentRouter-on-Arcscan TODO) and keeps the
  non-custodial invariant (Memo contract never holds funds; payer->merchant direct). Uses 6
  USDC decimals. Caveats: contract is new (audit/maturity unverified), mainnet address/availability
  not yet confirmed, no documented memoData size limit. NOT yet implemented -- architecture
  decision pending user direction; PaymentRouter still the shipped path.
  Follow-up validation (`test_memo_payment_dryrun.js`, tx 0x531dae2a...cecce0dd): the realistic
  Fundline shape PASSED end-to-end on testnet -- payer -> a DISTINCT merchant in 1 tx (gas 68158),
  merchant credited exactly 0.01 USDC, and the payment is reconcilable by invoiceId via
  eth_getLogs on the Memo contract (memoId is an indexed topic; the matched log resolved to the
  exact payment tx). Both candidate directions are de-risked: (a) client 1-tx memo payment, and
  (b) backend indexer reading Memo events by invoiceId.
- 2026-06-18: Circle MCP server + Skills committed (`cc8af84`). .mcp.json adds project-level
  Circle MCP (HTTP transport, api.circle.com/v1/codegen/mcp) - must be approved in Claude Code
  UI before it activates. 4 skills (circle-use-arc, circle-use-gateway, circle-bridge-stablecoin,
  circle-use-usdc) saved to .claude/skills/ - invokable as /circle-use-arc etc. Note: user-scope
  MCP (claude mcp add --scope user) not possible without the claude CLI in PATH; project-level
  .mcp.json is the fallback.

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
