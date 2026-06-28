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
- 2026-06-18: Arc Memo exact event ABI captured (for the indexer direction):
  `event Memo(address indexed sender, address indexed target, bytes32 callDataHash,
  bytes32 indexed memoId, bytes memo, uint256 memoIndex)`. Topic0 sig =
  0xeb15ee720798341c37739df41be53acfbbf70ae6802dade35457beec6e47a5e4; topics are
  [sig, sender, target, memoId]. Reconcile a single invoice with eth_getLogs
  topics=[MEMO_TOPIC, null, null, <invoiceId>]. Also `event BeforeMemo(uint256 indexed
  memoIndex)`. On child revert the outer tx reverts with `MemoFailed(bytes)` (no partial
  settlement). No documented gas/size limits.
- 2026-06-18: Arc App Kit evaluated (docs.arc.io/app-kit). App Kit (`@circle-fin/app-kit`)
  is a TypeScript/npm SDK suite with 4 modules: Bridge (wraps CCTP), Unified Balance
  (`@circle-fin/unified-balance-kit`), Swap, Send; adapters for Viem/Ethers/Solana/Circle
  Wallets. KEY FINDING: Unified Balance is explicitly "built on top of Circle Gateway" and
  "handles the Gateway workflow for deposits and spends" -- so it does NOT remove the
  deposit-finality wait; "instantly spendable" means after the deposit finalizes (the same
  Gateway model). It is cleaner CODE, not faster UX, so it does NOT change the decision to
  drop Gateway for one-off payers. BLOCKER to adopting App Kit now: it is an npm/TS SDK
  needing a bundler, but Fundline's frontend is deliberately buildless (vanilla app.js, manual
  ABI encoding, FTP to cPanel, CI only `node --check`). Recommendation: keep the hand-rolled
  CCTP Fast (works, zero deps); consider App Kit only if Fundline adds a build step or revives
  the repeat-payer Gateway path, where `@circle-fin/unified-balance-kit` + App Kit Bridge would
  be the clean implementations.
- 2026-06-18: Circle MCP server + Skills committed (`cc8af84`). .mcp.json adds project-level
  Circle MCP (HTTP transport, api.circle.com/v1/codegen/mcp) - must be approved in Claude Code
  UI before it activates. 4 skills (circle-use-arc, circle-use-gateway, circle-bridge-stablecoin,
  circle-use-usdc) saved to .claude/skills/ - invokable as /circle-use-arc etc. Note: user-scope
  MCP (claude mcp add --scope user) not possible without the claude CLI in PATH; project-level
  .mcp.json is the fallback.
- 2026-06-19: Auth/session persistence reworked to a true session model (working tree, NOT yet
  committed). Per user requirement: stay logged in across reload; log out ONLY on manual logout
  or when the browser profile closes; no prior-session invoices shown after logout. Root cause:
  login + cache lived in localStorage, which survives a browser restart (so #2 failed). Fix:
  moved ALL login/cache state from localStorage to sessionStorage. app.js - WALLET_SESSION_KEY,
  STORAGE_KEY (invoice cache), SETTINGS_KEY, and the shared SELLER_SESSION_KEY
  ("fundline_dashboard_session") now use sessionStorage; added purgeLegacyAuthStorage() (runs
  first in init()) to drop stale localStorage copies once. dashboard.js - the shared
  fundline_dashboard_session now in sessionStorage (+ one-time legacy localStorage cleanup at
  init). app.js and dashboard.js MUST stay in sync on that key (both read it). #3 already held:
  disconnectWallet() zeroes state.invoices and syncInvoicesFromServer() returns [] with no wallet.
  Trade-offs to remember: sessionStorage is per-tab (no cross-tab shared login); a browser
  "restore tabs / continue where you left off" setting can revive sessionStorage; existing users
  are logged out once after this deploys.
- 2026-06-19: Pre-existing CRITICAL syntax bug fixed in dashboard.js and storefront.js. Template
  literals had escaped backticks (escaped backtick and escaped dollar-brace instead of the bare
  forms), so BOTH files threw SyntaxError at load - dashboard.html and the public /s/:slug
  storefront ran NO JS at all (login, logout, products, webhooks, api-keys, buy-button all dead).
  Confirmed the committed HEAD was already broken (not introduced by me); likely an old automated
  edit script. Fixed by unescaping. node --check now passes for app.js, dashboard.js,
  storefront.js, home.js, server.js. patch_app.js (scratch one-off, NOT deployed) still fails
  node --check - left as-is. Residual, out of scope, NOT fixed: dashboard.js loadWebhooks() treats
  fetchApi() as a raw Response (checks .ok / await .json()) but fetchApi already returns parsed
  JSON, so webhooks/logs likely never render even now.

- 2026-06-19: Merchant-name UX overhaul + made the name persistent per wallet (working tree,
  builds on the session-auth commit d42ac90). Three parts: (a) the wallet-gate button on the
  create-invoice page now doubles as "Set up Telegram alerts" -> settings when a wallet is
  connected (previously it was hidden once connected); (b) removed validateSettings() so an
  invoice can be created immediately after connecting (no forced settings detour; server already
  defaults merchantName to "Fundline merchant"); (c) merchant name is now ONE value owned by the
  server per wallet: sellers[wallet].displayName. It is established by the first invoice that
  carries a real name (server first-write in POST /api/invoices) OR by the authenticated settings
  PUT (which overwrites); every later invoice inherits the established name and CANNOT rename it -
  only settings can change it. New PUBLIC endpoint GET /api/sellers/:wallet returns
  {wallet, displayName} (only the name, already public on invoices; telegram/alerts stay behind
  auth). Client (app.js/app.html): a "Your business name" field (.form-full) was added to the
  create-invoice form, prefilled from state.settings.merchantName and set READONLY once a name
  exists (change only in Settings); fetchSellerName() syncs the name after connect/sync;
  createInvoice adopts savedInvoice.merchantName; settings PUT now sends displayName and
  fetchServerSettings reads it. This RESOLVES the earlier caveat that settings (sessionStorage)
  lost the name on browser close - the name is now server-persistent per wallet. Verified by
  test_seller_name.js (15/15: first-write, no-rename-via-invoice, settings override, default
  "Fundline merchant" does not establish a name). node --check passes for all served JS + server.

- 2026-06-19: Memo-vs-PaymentRouter settlement decision (4-lens workflow: security, payer UX,
  strategy/lock-in, eng cost). VERDICT: keep PaymentRouter as the always-on settlement spine
  through the mainnet cutover; do NOT build Memo payer flows yet; later add Memo only as an
  OPTIONAL, feature-flagged, Arc-only 1-tx fast path with PaymentRouter fallback - never the sole
  path. Why PaymentRouter wins now: (1) mainnet readiness - router is verified on Arcscan, owned,
  immutable, deployable today; Memo has no confirmed mainnet address, no published audit, testnet-
  only since ~2026-06-13. (2) Non-custodial is a TIE (both payer->merchant direct), so it does not
  break the choice. (3) Stronger verify binding - InvoicePaid carries invoiceId+payer+merchant+
  amount+token in one event; the Memo event lacks merchant/amount so it needs a weaker 2-log
  re-pair (Memo log + a same-tx USDC Transfer). (4) Memo is EOA-ONLY -> hard-blocks Safe/multisig/
  smart-account payers (zero-conversion for that B2B segment), so it can never be the only path.
  (5) Portability - router is standard EVM + brand-owned event; Memo is Arc-specific (relevant to
  the "Fundline Router" branding idea: router stays, so that name still makes sense). Memo's real
  win is narrow: 1 tx / no approve / ~61-68k vs ~87k gas, but ONLY for first-time (no-allowance)
  on-Arc EOA payers - repeat payers already get 1 tx via the allowance>=amount short-circuit, and
  cross-chain payers' dominant friction is the CCTP bridge legs which Memo does not touch. The
  (chainId, txHash) double-confirm guard is event-source-agnostic, so it survives either path
  unchanged. Conditions to revisit Memo later: Memo confirmed on Arc MAINNET at a stable address
  WITH a published audit of the Memo contract + CallFrom precompile; reliable client-side EOA-vs-
  smart-account detection (default to router on doubt); Memo verify hardened to the InvoicePaid bar
  (assert recipient==merchant, amount==total at 6 decimals, bind memoId to the SAME txHash as the
  matched Transfer); MemoFailed decoded to a friendly message + a memoData size cap; telemetry
  proving the first-payment approve step is a real drop-off. Only a formal Arc-only commitment
  (drop multi-chain ambition) plus all the above could justify making Memo primary. NOTE: Memo is
  still NOT implemented in production server.js/app.js (only test scaffolding from the earlier
  probe). Earlier conceptual explanation given to user: a memo payment routes USDC.transfer through
  Arc's Memo contract via CallFrom (preserves payer as msg.sender), carrying the invoiceId in the
  indexed memoId topic; it is embedded in the tx at send time, not attached to a tx hash afterward.

- 2026-06-19: Telegram bot "create invoice from chat" feature - planning + build started.
  Full plan in `.claude/telegram-bot-plan.md` (FTP-excluded). Decisions: keep getUpdates
  POLLING (no webhook); merchant<->chat binding is a CONFIRMED 1:1 link (new
  data/telegram-links.json, pending until the chat sends /start, closes the paste-someone-
  elses-chatId spoof); bot-created invoices FORCE merchantWallet = resolved linked wallet;
  `/start` is the ONLY registered command (dropped /id, /chatid; "Show chat ID" becomes a
  menu button in P3); no "No due date" option (every bot invoice defaults via 3/7/14/30-day
  buttons, normalizeInvoice untouched); no emoji in bot text. Phases: P0 long-poll+callback
  plumbing (DONE, commit a4adcf3, test_telegram_longpoll.js); P1 confirmed chatId<->wallet
  link store (DONE: loadTelegramLinkDb/saveTelegramLinkDb, resolveWalletByChatId [active-only],
  claimTelegramChatId [1:1, called from the signature-verified settings PUT], activateTelegramLink
  [pending->active on /start], seedTelegramLinksFromSellers [one-time idempotent migration of
  existing chatIds as pending], test_telegram_link.js 22/22). P2 session state machine +
  create-invoice flow (DONE: TG_STATE main_menu/ask_client/ask_amount/ask_due/confirm/done,
  data/telegram-sessions.json [30-min TTL], callback ns:value:step with step-stamp stale-tap
  guard, shared createInvoiceRecord [merchantWallet forced to linked wallet], idempotent confirm
  via draftInvoiceId, parseTelegramAmount, test_telegram_session.js 35/35). P3 menu polish (DONE:
  mainMenuKeyboard [Create invoice / My invoices / Show chat ID], buildMyInvoicesText [5 recent],
  botInvoiceStatus, test_telegram_invoices.js 12/12). ALL FOUR PHASES COMPLETE, all local commits
  (a4adcf3, 2526e4d, 4b493b4, e0bc02f), NOT YET PUSHED. answerCallbackQuery is a no-op without a
  token (correct + enables offline tests). Single sequential poll loop => no per-chat lock needed.
  Before pushing: this auto-deploys via FTP; the cPanel Node app MUST be manually restarted for
  the new bot to run. After deploy, existing merchants must send /start once to activate their
  seeded-pending link.
  IMPORTANT new pattern: server.js now guards `server.listen` behind
  `if (require.main === module)` and `module.exports` the testable link functions, so tests
  can require server.js without booting it (test_telegram_link.js relies on this; reuse for
  P2). Existing tests still spawn `node server.js` and are unaffected. After deploy the cPanel
  Node app MUST be manually restarted for the new poll loop/handlers to take effect.

- 2026-06-20: Direct/native USDC transfer verification fallback shipped (`71d401f`, pushed).
  Context: QR/manual payers who do NOT connect a wallet settle with a plain transfer (no
  PaymentRouter), so no InvoicePaid event. In production requireInvoiceReference is ALWAYS true
  (router deployed + onchainInvoiceId always set via randomBytes32), so the strict path REQUIRED
  the InvoicePaid event -> direct transfers never verified -> the manual-verify flow was
  effectively dead for non-connect payers. Fix in findArcPayment (server.js): try strict router
  path FIRST (unchanged for connect-wallet payers; it returns immediately so no shadowing/
  regression), then on no match FALL THROUGH to a direct-transfer fallback: txHash-scoped
  (findPaymentInRpcReceipt with requireInvoiceReference:false -> ERC-20 Transfer log, then
  findTokenTransferByTx, then findNativeTransferByTx), then recent-list scans (findRecentToken/
  NativeTransfer). Precedence router > ERC-20 > native. This is a GLOBAL relaxation (all invoices
  accept direct transfers as fallback), NOT per-invoice, because the QR is on every pay page.
  Tradeoff the user explicitly approved: direct transfers carry no on-chain invoiceId, so binding
  rests on exact amount + recipient + recency + the (txHash) double-spend guard. SECURITY HARDENING
  done because the fallback activates code that was dead in prod: (1) findMatchingNativeTransaction
  value>=expected -> exact === (an unrelated larger native transfer must not settle a smaller
  invoice); (2) isMatchingTokenTransfer now REQUIRES the canonical USDC address when set (dropped
  the symbol=="USDC" escape that let a spoofed token pass) and forces 6 decimals for the canonical
  token; (3) both Arcscan matchers reject a match with empty txHash so the dedup guard stays
  airtight. QR CHANGED again: app.js pay-page QR is now an EIP-681 NATIVE transfer URI
  (`ethereum:<merchant>@<chainId>?value=<amount*10^18>`), replacing the ERC-20 transfer URI from
  e76bc71. Reason: OKX (and exchange apps) refused the ERC-20 URI with "add the token and try
  again" because they don't recognize the 0x3600 system-USDC contract; a NATIVE send needs no
  token import (USDC IS the Arc gas token). Native value = 18 decimals; server verifies native at
  ARC_NATIVE_USDC_DECIMALS=18; /api/config now ships nativeUsdcDecimals; app.js adds
  ARC_NATIVE_USDC_DECIMALS=18 + normalizePublicConfig parsing. server.js now exports
  findMatchingTokenTransfer/findMatchingNativeTransaction/amountToUnits. New test
  test_native_transfer_fallback.js (24 assertions: exact-match, overpay-reject, spoof-reject,
  forced-6-decimals, no-txHash-reject, both Arcscan field shapes). Built via 2 workflows: a
  6-reader "understand" pass (mapped the whole verify path + surfaced the >=/spoof/decimals risks)
  and a 6-lens adversarial review that FAILED on session limit (not run) - so the review was done
  manually instead. OPERATIONAL CAVEATS TO LIVE-TEST (could not verify offline): (a) does OKX/
  exchange wallets actually honor the EIP-681 native `value` + `@chainId` on scan; (b) does a plain
  native USDC send on Arc appear in Arcscan /addresses/:payer/transactions and /transactions/:hash
  with to=merchant + value at 18 decimals so findMatchingNativeTransaction finds it. Pre-existing
  gaps left out of scope (noted by the understand workflow): the dedup guard is txHash-only (NO
  chainId dimension, contra the docs rule) - harmless while settlement is Arc-only; TOCTOU on the
  read-modify-write JSON store (two concurrent verifies of different invoices citing one txHash
  could both pass); isRecentEnough has a 5-min-early tolerance and no upper bound. Earlier this
  session also: cross-chain roadmap steps 1 (CHAINS table refactor, 691d88b) + 4 (MaxUint256
  one-time approve, d6f1c2f); pay-page UX split into wallet vs manual flows (3020e9b).

- 2026-06-20: PaymentRouterV2 + opt-in on-chain invoice memo BUILT (committed, NOT pushed,
  NOT deployed). Decision recap: rejected the "Memo contract + PaymentRouter in parallel"
  option (Arc Memo is EOA-only via CallFrom tx.origin semantics -> breaks Safe/smart-account
  payers; Arc-only -> useless for the CCTP cross-chain leg; weaker 2-log verify) in favor of
  extending the router. This is CONSISTENT with the 2026-06-19 Memo-vs-Router verdict (router
  stays the spine). contracts/PaymentRouterV2.sol: keeps payInvoice(bytes32,address,uint256)
  with the IDENTICAL selector 0xe1a9ef45 AND the IDENTICAL InvoicePaid event signature/topic
  (0x3c732fcd...) so the existing verify path + Arcscan indexer work unchanged when the
  configured router is pointed at V2; adds payInvoiceWithMemo(bytes32,address,uint256,bytes)
  selector 0x53a2a881 which, after the same transferFrom settlement, emits
  InvoiceMemo(bytes32 indexed invoiceId, address indexed payer, bytes memo) only when memo
  length > 0. MAX_MEMO_BYTES = 2048 cap. Non-custodial preserved (only transferFrom, holds no
  funds, no owner/withdraw). Compiles clean (solc), bytecode 1293 bytes. Deploy via
  scripts/deploy-payment-router-v2.js (npm run deploy:payment-router-v2) - mirrors the V1
  script, also writes contracts/PaymentRouterV2.abi.json and overwrites ARC_PAYMENT_ROUTER_ADDRESS.
  Memo is OPT-IN per invoice, OFF by default. Field picker on the create form (app.html
  #memoOnchain / #memoEnabled / name="memoField"): safe fields preselected (number, total,
  createdAt, dueDate, merchantName), sensitive ones off + amber-marked (clientName, items,
  note - public forever), plus a "hash" option (SHA-256 commitment, hides content). Server
  whitelist ONCHAIN_MEMO_FIELD_KEYS + normalizeMemoFields stores invoice.onchainMemoFields.
  Shared pure helpers in NEW memo-util.js (browser global window.FundlineMemo + Node export;
  loaded via <script src="/memo-util.js"> before app.js): normalizeMemoFields,
  buildInvoiceMemoText (readable UTF-8 "Fundline | invoice X | 10.50 USDC | ... | commit:<hash>",
  canonical field order, "" when nothing selected), canonicalInvoiceForHash, and
  encodePayInvoiceWithMemo (hand-rolled ABI for the 4-arg fn, dynamic-bytes tail, offset 0x80).
  app.js: collectMemoFields()/wireMemoToggle() on create; buildOnchainMemo()+computeInvoiceCommitHash()
  (crypto.subtle SHA-256) at pay time; sendRouterPayment branches to encodePayInvoiceWithMemo
  when memoText present else the plain 3-arg path (unchanged). test_memo_encoding.js (27 assertions:
  ABI byte-for-byte vs ethers across empty/aligned/unaligned/unicode/max sizes, >2048 reject,
  field-selection incl. sensitive-not-leaked, hash commitment). node --check + all tests pass.
  CRITICAL DEPLOY ORDER (frontend calls payInvoiceWithMemo which V1 lacks -> would revert for
  memo-enabled invoices): (1) user runs npm run deploy:payment-router-v2 with ARC_DEPLOYER_PRIVATE_KEY;
  (2) update ARC_PAYMENT_ROUTER_ADDRESS in the cPanel env to the V2 address + restart (V2 still
  serves the old 3-arg payInvoice so the not-yet-updated frontend keeps working); (3) THEN push
  the frontend so payInvoiceWithMemo hits V2. Memo-off invoices are safe in any order. Consider
  Arcscan-verifying V2 like V1 and updating onchain-reference.md with the V2 address once deployed.

- 2026-06-20: FundlineMemoRouter DEPLOYED + VERIFIED on Arc testnet. Renamed from the
  initial PaymentRouterV2 (user wanted the router named "FundLine Memo Router"; Solidity
  identifier FundlineMemoRouter, no spaces). Files renamed: contracts/PaymentRouterV2.sol ->
  contracts/FundlineMemoRouter.sol, scripts/deploy-payment-router-v2.js ->
  scripts/deploy-memo-router.js, ABI -> contracts/FundlineMemoRouter.abi.json; npm script
  deploy:memo-router. NOTE first deploy under the old name PaymentRouterV2 landed at
  0x94d4f81d2cD0747C158D0E7bb8aE518928aB78dD (tx 0x898314f7...) and is now ORPHANED/unused
  (renaming changes the metadata hash so it could not verify as FundlineMemoRouter; redeployed).
  ACTIVE router: FundlineMemoRouter at 0x5613D701D2e6A70643680eabBeEdc0e924b30848 (deploy tx
  0xcba05b08..., block 47840156). Local .env ARC_PAYMENT_ROUTER_ADDRESS now points to it; app.js
  DEFAULT_PUBLIC_CONFIG.paymentRouterAddress hardcoded fallback updated to it too. VERIFIED on
  Arcscan via the same Blockscout recipe as V1 (POST /api/v2/smart-contracts/{addr}/verification/
  via/flattened-code, compiler v0.8.35+commit.47b9dedd, optimizer on/200, evm_version "default",
  single flattened source, contract_name FundlineMemoRouter, autodetect_constructor_args true,
  license mit) - is_fully_verified=true, name shows FundlineMemoRouter. STILL PENDING (not done):
  (1) cPanel env ARC_PAYMENT_ROUTER_ADDRESS must be updated to 0x5613D701... + restart the Node
  app, BEFORE/with pushing the frontend (else the pushed app.js calls payInvoiceWithMemo on the
  old V1 router which lacks it -> revert for memo-enabled invoices); (2) the feature commit
  (74924e6, local, not pushed) plus this rename are NOT pushed yet. Update onchain-reference.md
  already done (FundlineMemoRouter listed as ACTIVE, V1 marked LEGACY).

- 2026-06-20: Bulk payout / payroll feature (FundlineBatchRouter) BUILT + DEPLOYED +
  VERIFIED across 5 phases. One payer distributes USDC to many recipients in ONE tx
  (payroll, speaker fees). Direction is 1->N (disburse), the OPPOSITE of an invoice (N->1)
  - confirmed with the user. Contract: contracts/FundlineBatchRouter.sol, payBatch(bytes32,
  address[],uint256[]) selector 0x4ae7161f + payBatchWithMemo(...,bytes[]) selector 0xb4199844
  (per-recipient on-chain memo for payroll references; user insisted memo is needed). Atomic
  (any failed transfer reverts the whole run), non-custodial (only transferFrom payer->each
  recipient, no funds held, no owner/withdraw), caps MAX_BATCH=256 + MAX_MEMO_BYTES=256. Events
  BatchPaid(batchId,payer,total,count) topic 0xcff8d316... + BatchItemPaid(batchId,payer,
  recipient,amount,memo) topic 0x33dd8a08.... DEPLOYED + Arcscan-VERIFIED at
  0x8d838Cee79e3F8a500d9C1dDEf12DF2f33e84cc4 (deploy tx 0xd3d9fdb9..., block 47858591). Deploy:
  npm run deploy:batch-router (scripts/deploy-batch-router.js, writes ARC_BATCH_ROUTER_ADDRESS).
  batch-util.js (browser+Node) hand-rolls the dynamic-array ABI (encodePayBatch /
  encodePayBatchWithMemo), verified byte-for-byte vs ethers in test_batch_router.js (15). Server
  (server.js): data/batches.json, normalizeBatch/normalizeBatchItem (exact 6-dp totalUnits),
  createBatchRecord, routes POST/GET /api/batches + GET /api/batches/:id (public, strips email)
  + POST /api/batches/:id/verify, findBatchPaidInReceipt (matches BatchPaid by onchainBatchId +
  total + count from the batch router address; events are unforgeable so it is a sound proof),
  /api/config now returns batchRouterAddress/batchPaymentsEnabled/maxBatchRecipients, /batch/:id
  -> app.html. test_batch_model.js (18). Frontend: a Single invoice / Bulk payout sub-tab in the
  create view; Bulk = download CSV template, parse+validate CSV (wallet/amount, per-row errors,
  running total), opt-in on-chain reference memo, POST -> /batch/:id link. PAY PAGE is a SEPARATE
  route /batch/:id (renderBatchPayPage, NOT the invoice /pay/ page): wallet-login REQUIRED, NO QR,
  NO manual pay/verify (user requirement); connect -> approve exact total -> ONE payBatch tx ->
  auto-verify. isPublicPaymentRoute() = isPayRoute() || isBatchRoute() gates merchant-only behavior.
  CRITICAL: normalizePublicConfig had to be extended to pass batchRouterAddress (it dropped unknown
  fields); the client default batchRouterAddress is "" (NOT baked) on purpose so the pay page only
  enables when the server reports an address - which is also when server verify works - avoiding a
  half-state where payment goes through but cannot be verified. STILL PENDING for go-live: (1) push
  all commits (Phase 1-5 are LOCAL, not pushed yet); (2) set ARC_BATCH_ROUTER_ADDRESS=
  0x8d838Cee79e3F8a500d9C1dDEf12DF2f33e84cc4 in the cPanel env + RESTART the Node app (else
  /api/config returns no batch address, the pay page stays disabled, and verify cannot run).

## Open threads / TODOs

- PENDING DEPLOY (2026-06-28): local commit `935d61c` "Rename run-mode buttons to Write
  prompt / Generate prompt" is committed but NOT pushed yet (user wants to deploy later).
  It only relabels the two Run-panel mode buttons in workflows.js (data-mode own/build and
  run logic unchanged). Earlier the same day the workflows-canvas series WAS pushed to main
  (n8n-style Workflow Structure redesign + run animation `8495120`, tabs vertical-scrollbar
  fix `3992f12`, node simplification to step/name/model `8495120`). Just `git push origin main`
  from outputs/arc-invoice-usdc when ready; frontend-only, no cPanel restart needed.
- SPEC (2026-06-28, DRAFT, NOT built): workflow free-run rate limiting + cost control. Full
  spec in `.claude/workflow-rate-limit-spec.md` (FTP-excluded). Decisions locked with user:
  D1 workflow runs = 3/IP/day HARD cap (then stop until reset, beta-quota messaging, no
  pay-to-continue during beta; runs use USDC testnet now); D2 "Generate prompt" = its own
  separate free 3/IP/day, stays free even after runs move to real USDC; D3 day boundary UTC;
  D4 per-IP spend cap USD 0.50/day (hard, replaced the earlier token-count idea); D5 provider
  = v98store (https://v98store.com, one key all models, use the EXACT model per workflow step).
  Two-layer model: L1 per-IP hard caps (3 runs + 3 gen-prompts + USD 0.50 spend) + L2 global
  daily API-spend ceiling (the real cost backstop vs VPN/CGNAT bypass). Enforced in NEW server
  endpoints POST /api/workflows/:slug/run and .../build-prompt (run is pure frontend mock
  today, no server run path yet). IP read from X-Forwarded-For on cPanel (WORKFLOW_TRUST_PROXY
  =xff); Cloudflare NOT required. v98store CONFIRMED (user PDF, section 12 of the spec):
  OpenAI-compatible, base URL https://v98store.com/v1, POST /v1/chat/completions for BOTH GPT
  and Claude (gateway translates), Bearer auth, standard usage block. Model labels in WORKFLOWS
  are NOT real ids - need a map: gpt-4.1-mini -> gpt-4.1-mini; claude-3-haiku ->
  claude-3-haiku-20240307; claude-3.5-sonnet -> claude-3-5-sonnet-20241022 (date suffix
  required). Price table USD/1M captured in spec; NewAPI markup, group_ratio Default 1x up to
  16x (Direct Claude) - must confirm OUR key's group. Always send max_tokens (Claude needs it).
  Q-A RESOLVED: global daily ceiling = USD 10/day for beta (WORKFLOW_DAILY_BUDGET_USD=10).
  v98store integration contract + model registry + price table + cost formula extracted into a
  NEW skill `.claude/skills/v98store-api/SKILL.md` (load-on-demand reference for expanding
  workflows to new models; the spec covers the limiter, the skill covers the provider). Live
  v98store request CONFIRMED (2026-06-28, gpt-4.1-mini): endpoint + Bearer auth + standard
  OpenAI usage block all work (usage.prompt_tokens/completion_tokens/total_tokens +
  prompt_tokens_details.cached_tokens + completion_tokens_details; ignore the non-standard
  latency_checkpoint). Billing endpoint CONFIRMED: GET /v1/dashboard/billing/subscription returns
  hard_limit_usd (259 on the test key) + has_payment_method + token_name; remaining = hard_limit
  minus /v1/dashboard/billing/usage total_usage -> usable for the L2 $10/day backstop. STILL
  OPEN before build: Q-B confirm prod XFF first entry is real client IP; the key's group_ratio
  (not in API responses, read from dashboard; default 1x + config override V98STORE_GROUP_RATIO
  meanwhile). No app code written.
- DIRECTION (2026-06-28): the current workflows `WORKFLOWS` catalog is demo/mock (simulated
  runs, fabricated metrics, NO real per-step prompts; model labels are not even real v98store
  ids). It first landed in commit d617c0b today with no Claude co-author trailer. User wants to
  REPLACE the invented workflows by adapting publicly shared, community-accepted LLM prompt-
  chains. Curated, sourced shortlist + recommended first 5 in `.claude/workflow-sources.md`
  (top picks: GPT Researcher ~28k stars Apache-2.0 -> Client/Crypto Research; CrewAI
  Research->Write->Edit -> SEO/X-thread; CrewAI Marketing Strategy MIT -> a marketing workflow;
  Promplify/AirOps SEO prompts; CrewAI Stock Analysis re-skinned -> Crypto Research). We only
  adapt the STEP STRUCTURE into v98store chat calls (per the v98store-api skill), not import
  CrewAI/n8n runtimes. Next: pick which to implement first, design real per-step prompts. No code.
- GPT Researcher DEEP-DIVE done -> `.claude/workflow-gpt-researcher.md` (verbatim prompts from
  gpt_researcher/prompts.py + real config defaults + adapted 6-step chain: Role Select, Planner,
  Retrieve+Scrape, Summarize, Curate, Writer). KEY FORK before building: GPT Researcher quality
  depends on live web search+scrape. Fundline has NO retrieval tool. Options: A) add Tavily
  search API (faithful, extra service+cost, has free tier); C1) user pastes sources (no API, real
  citations, user retrieves); C2) knowledge-only (must drop citations, label un-sourced, weakest).
  Recommended A + C1 fallback; avoid C2 as standalone research. DECIDED 2026-06-28: Option A + C1
  (Tavily search + paste-your-sources fallback). Build needs TAVILY_API_KEY (.env + cPanel,
  secret); confirm Tavily API shape + free-tier limit at build time.
- WORKFLOW RUNNER PHASE 1 BUILT (2026-06-28, branch `workflow-runner-phase1`, NOT merged/deployed).
  Shared plumbing behind master switch WORKFLOW_RATE_LIMIT_ENABLED (default OFF -> prod unchanged,
  frontend still mock). New modules: `v98-models.js` (id map + price table + computeCostMicros,
  micro-USD), `v98-client.js` (OpenAI-compatible callV98Chat with 429 retry/backoff),
  `workflow-limiter.js` (per-IP UTC-day quota: runCount/genCount/spentMicros, global budget,
  IPv4 + IPv6 /64 keying, XFF/CF IP resolution, checkAndReserve/rollbackReserve/recordCost; JSON
  store data/workflow-usage.json + workflow-budget.json). server.js: env consts + WORKFLOW_LIMITS,
  routes POST /api/workflows/:slug/build-prompt (REAL single v98 call, genCount quota, cost
  recorded) and /run (501 not_implemented until phase 2), /api/config now returns
  workflowRunnerEnabled/workflowFreeRunsPerDay/workflowGenPromptsPerDay/workflowBetaNotice. Tests:
  test_v98_cost.js (14), test_workflow_limiter.js (23) pass; server requires cleanly with
  FUNDLINE_NO_LISTEN. VERIFIED END-TO-END 2026-06-28 with the real key: POST build-prompt returned
  HTTP 200 + a real professional prompt, genCount 1/3 (remaining 2), cost 52 micro-USD ($0.000052)
  recorded in BOTH data/workflow-usage.json (per-IP) and workflow-budget.json (global), matching
  gpt-4o-mini at group 1x. Caveat: cost recorded at V98STORE_GROUP_RATIO=1; if the key is a higher
  group the real credit burn is higher -> set V98STORE_GROUP_RATIO once confirmed from dashboard
  (not blocking). Commits on branch workflow-runner-phase1: 9bd297c (docs) + 8ba2084 (code), local
  only, NOT pushed/deployed. .env.example documents all new vars. Phase 2 next: Tavily + GPT
  Researcher chain for /run + frontend wiring.
- WORKFLOW RUNNER PHASE 2 (BACKEND) BUILT + VERIFIED LIVE (2026-06-28, branch
  workflow-runner-phase1). New: `tavily-client.js` (POST api.tavily.com/search, Bearer auth,
  returns results[{title,url,content,score}]); `workflow-research.js` = GPT Researcher chain
  adapted (role select -> plan 3 queries -> Tavily retrieve -> write cited report), prompts close
  to originals, dependency-injected callModel/searchWeb so it is testable; dedupes sources by URL;
  sums cost in micro-USD. server.js: WORKFLOW_RUN_DEFS={client-research:research},
  WORKFLOW_RESEARCH_CHEAP_MODEL (gpt-4o-mini), WORKFLOW_RESEARCH_WRITER_MODEL (gpt-4.1-mini),
  TAVILY_API_KEY; handleWorkflowRun now executes the research chain (search OR paste mode), reserves
  one run, records summed cost, rolls back on failure. Modes: search (needs Tavily) + paste
  (user-pasted sources, no API). test_workflow_research.js (20) passes. LIVE E2E 2026-06-28: POST
  /api/workflows/client-research/run search mode returned HTTP 200, a real ~1500-word cited
  markdown report from real Tavily sources (wikipedia, zoominfo, company sites), 6 deduped sources,
  cost $0.003218 (role 35 + plan 32 + writer 3151 micro-USD), remaining 2/3. Also confirmed:
  unknown slug -> 501, paste + empty sources -> 400. .env.example documents TAVILY_API_KEY + model
  vars. STILL TODO (phase 2 frontend): wire workflows.js to call /run + /build-prompt for real,
  drive the canvas off the response, add paste-sources UI mode, show remaining quota + beta notice.
  Then predeploy-check + decide deploy. Note: current WORKFLOWS frontend display still has mock
  step labels/metrics; align client-research display with the real chain when wiring.
- WORKFLOW RUNNER PHASE 2 (FRONTEND) WIRED (2026-06-28, branch workflow-runner-phase1, NOT
  deployed). workflows.js: client-research is now `live: true` with the REAL chain displayed
  (Role analysis / Research plan / Web research [Tavily] / Report writer, modelCount 2). Run +
  Generate-prompt call the real endpoints (/run, /build-prompt); the canvas animates steps and
  holds the last node "running" until the real response, then shows the real report + receipt
  (sources count, est. cost, remaining quota) with Copy/Download. Added a retrieval toggle (Search
  the web vs Paste my sources -> mode search|paste). Errors (429/503/501/502) show the server
  message. DEPLOY-SAFETY GATE: a workflow is runnable only if `wf.live && WF_RUNNER_ENABLED`, where
  WF_RUNNER_ENABLED comes from GET /api/config workflowRunnerEnabled (fetched on load); until the
  server flag is on, everything shows "coming soon" -> safe to deploy the frontend before enabling
  the server. Other workflows: Run button disabled + "Coming soon". To TEST LOCALLY: set
  WORKFLOW_RATE_LIMIT_ENABLED=true in .env (V98 + Tavily keys already there), npm start, open
  /workflows/client-research, hard-refresh. node --check passes for workflows.js + server.js.
  Frontend DOM not auto-tested (no headless browser); needs a manual browser pass. Commit pending
  on branch. TO DEPLOY later: enable WORKFLOW_RATE_LIMIT_ENABLED + V98STORE_API_KEY + TAVILY_API_KEY
  in the cPanel env, then merge to main + push (auto-deploys); restart not needed for static files
  but IS needed for server.js env/code changes.
- WORKFLOW RUNNER DEPLOYED to main 2026-06-28 (merged workflow-runner-phase1 fast-forward,
  e01ac15..4c53f0a, pushed -> FTP auto-deploy + tmp/restart.txt touched so Passenger reloads
  server.js). FEATURE IS DORMANT until the cPanel Node app env is set: add
  WORKFLOW_RATE_LIMIT_ENABLED=true, V98STORE_API_KEY, V98STORE_BASE_URL=https://v98store.com/v1,
  TAVILY_API_KEY (and optionally V98STORE_GROUP_RATIO if the key is not group 1x) in the cPanel
  Environment Variables, then restart the Node app. Until then /api/config returns
  workflowRunnerEnabled=false and EVERY workflow shows "Coming soon" (the old mock Run demo is
  gone on prod while dormant - expected, safe). Once enabled: client-research runs live
  (search + paste modes), others stay "Coming soon". Frontend DOM still not browser-tested by me.
- SKILL `create-workflow` exists (`.claude/skills/create-workflow/SKILL.md`, listed in CLAUDE.md
  Skills). It is the end-to-end procedure for building a new AI workflow (adapt a community chain
  -> v98store executor -> /run wiring -> frontend -> tests -> deploy). WHEN THE USER ASKS TO
  CREATE/ADD A NEW WORKFLOW, open and follow it so the design is consistent. It orchestrates the
  v98store-api skill, workflow-rate-limit-spec.md, workflow-sources.md, and the worked example
  workflow-gpt-researcher.md.
- WORKFLOW BILLING design DONE -> spec `.claude/workflow-billing-spec.md` (2026-06-28, NOT built).
  Model: charge per workflow run via a NON-CUSTODIAL per-run escrow on Arc in USDC. Researched
  Circle's official `circlefin/arc-escrow` (contract RefundProtocol.sol is non-custodial: funds
  depositor->contract->beneficiary, no admin drain, no fee; but its APP layer uses Circle
  Developer-Controlled Wallets + OpenAI + Supabase = custodial -> DROPPED). Decisions locked:
  per-run escrow, USER signs fund() from own wallet for the FIXED workflow price (check balance,
  else top up); output -> Fundline TREASURY key signs release() (no AI/confirm/window); failure ->
  treasury refund() + a REFUND_WINDOW timeout so user can claimRefund() if treasury goes silent;
  fixed price (profit/loss ours, no per-node cost in memo); memo self-emitted by the escrow in the
  SAME InvoiceMemo format/topic as FundlineMemoRouter (reuse memo-util; new buildWorkflowMemoText
  = workflow name + nodes + models, NO cost/user/input/output). New contract FundlineRunEscrow
  (constructor usdc+treasury immutable, fund/release/refund/claimRefund, SafeERC20, 6 decimals).
  Env: ARC_RUN_ESCROW_ADDRESS + ARC_TREASURY_PRIVATE_KEY (treasury is a Fundline hot key, NOT a
  user key). MUST build via escrow-build skill (escrow-engineer + MANDATORY contract-auditor on
  the invariants) before any deploy. RESOLVED 2026-06-28: normal failure (a node fails after 3
  retries) -> immediate treasury refund + error to user; REFUND_WINDOW ~1h is ONLY a stuck-funds
  backstop (server dies between fund and release/refund) via claimRefund. ONE shared contract for
  all workflows (price passed at fund, server-validated). Billing runs on TESTNET USDC = beta
  (tests on-chain flow, NOT revenue); since v98 cost is REAL USD even when user pays testnet USDC,
  the per-IP + global budget caps STAY ON as the real-cost guard. Awaiting user "build" go.
- FundlineRunEscrow BUILT + AUDITED PASS (2026-06-28, branch `run-escrow`, commit 50627a4, NOT
  merged/deployed). contracts/FundlineRunEscrow.sol (non-custodial per-run billing escrow:
  fund/release/refund/claimRefund, immutable usdc+treasury, REFUND_WINDOW 1h, self-emits
  InvoiceMemo with topic byte-matching FundlineMemoRouter, IERC20 transferFrom not msg.value,
  6-decimal raw units, CEI, return-value-checked, no owner/admin/fee/selfdestruct). Built via
  escrow-build skill: escrow-engineer wrote it + scripts/deploy-fundline-run-escrow.js (mirrors
  deploy-payment-router, writes ARC_RUN_ESCROW_ADDRESS); contract-auditor verdict PASS (no
  High/Med; Lows are server-side: must verify payer==caller && amount==price && not settled
  before running, use high-entropy runIds). server.js: ARC_RUN_ESCROW_ADDRESS + ARC_TREASURY_ADDRESS
  consts, /api/config returns runEscrowAddress + workflowBillingEnabled. .env.example documents
  ARC_TREASURY_ADDRESS/ARC_RUN_ESCROW_ADDRESS/ARC_TREASURY_PRIVATE_KEY. test_run_escrow.js (179,
  offline surface/ABI audit). STILL TODO before live: (1) deploy contract to Arc testnet (manual:
  set ARC_TREASURY_ADDRESS + ARC_DEPLOYER_PRIVATE_KEY, run the deploy script); (2) BILLING
  INTEGRATION phase: /run returns runId+price+escrow, verify on-chain funded run (Lows above)
  before executing, treasury key (ARC_TREASURY_PRIVATE_KEY) signs release(runId, memo via new
  memo-util buildWorkflowMemoText) on success / refund on failure; frontend approve+fund flow;
  (3) testnet lifecycle dry-run. Keep rate-limit + $10/day budget caps ON (testnet USDC billing
  does not cover real v98 cost).
- FundlineRunEscrow DEPLOYED to Arc testnet 2026-06-28: `0xefDDfF01090404f1eC942d96346B00638339b8D5`
  (treasury `0xee395f5bc60AE30b8279dfcf8cf0ABa392EC36FC`, deploy tx 0xecb2a6f2..., block 49154785).
  ARC_RUN_ESCROW_ADDRESS in .env (the deploy script printed "Updated .env" but the write did NOT
  persist - had to append manually; watch updateEnvValue on this machine). Server BILLING
  INTEGRATION wired (branch run-escrow, commit 4fb7383, NOT merged/deployed to prod): run-escrow-
  client.js (read getRun, treasury release/refund), memo-util.buildWorkflowMemoText, server.js
  /api/workflows/:slug/quote (issues high-entropy runId + fixed price 50000=0.05 USDC) and /run
  billing branch (verify funded on-chain: payer set, amount==price, not settled -> run -> treasury
  release with memo on success / refund on failure). Free beta path preserved when billing off.
  /api/config exposes workflowBillingEnabled + workflowPrices. WORKFLOW_BILLING_ENABLED requires
  escrow addr + USDC + ARC_TREASURY_PRIVATE_KEY. Read path VERIFIED live against the deployed
  contract. STILL TODO: (1) user must add ARC_TREASURY_PRIVATE_KEY (key for the treasury address)
  to activate signing/billing; (2) FRONTEND approve+fund flow (quote -> approve USDC -> fund(runId)
  via EIP-1193 -> /run with runId) - NOT built; (3) full lifecycle dry-run (fund/release/refund)
  once treasury key present. v98 budget cap stays separate from USDC paid.
- Phase 1 (active): build, audit, and deploy FundlineEscrow per `escrow-spec.md`. No file
  yet. Use the escrow-engineer agent to write it and contract-auditor to review before any
  deploy; the no-withdraw and no-fee invariants are make-or-break.
- RESOLVED 2026-06-19: PaymentRouter source verified on Arcscan (is_fully_verified=true).
  Address 0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24. Arcscan is Blockscout; verified via
  POST /api/v2/smart-contracts/{addr}/verification/via/flattened-code with: compiler
  v0.8.35+commit.47b9dedd (read from the on-chain bytecode CBOR metadata, matched the local
  solc), optimizer on / runs 200, evm_version "default", single flattened PaymentRouter.sol,
  autodetect_constructor_args=true (decoded usdc_=0x3600..0000). No API key or captcha needed.
  Note: Blockscout recorded license_type "none" despite the SPDX MIT header; cosmetic only,
  source/bytecode match is exact. The /api/v2 endpoints occasionally return an empty body
  (transient) -- retry on undefined fields.
- RESOLVED 2026-06-18: USDC 6-vs-18 decimals is NOT a risk (audit_report.md flagged it High).
  Verified against docs.arc.io: native gas-token value uses 18 decimals, ERC-20 interface uses
  6, both handled correctly (ERC-20/router path uses ARC_USDC_DECIMALS=6, native fallback uses
  ARC_NATIVE_USDC_DECIMALS=18). The .env.example values are correct as-is.
- Hardcoded addresses (USDC, CCTP, chainId) are scattered across server.js and app.js; a
  single constants source is wanted but not done.
- No lint / typecheck / test runner. CI only runs `node --check` on app.js and server.js,
  then FTP-deploys to cPanel on push to main.

## Critical deploy gotcha (cost a prod 503)

- 2026-06-19: cPanel runs server.js via Phusion Passenger, which `require()`s the app
  (it does NOT run `node server.js`). So `require.main === module` is FALSE in production.
  NEVER gate `server.listen(...)` on `require.main === module` - it skips listen, the app
  never binds, and the whole site returns 503 (and startTelegramPolling, called inside the
  listen callback, never runs, so the bot also goes silent - same root cause). To make
  server.js requirable by tests without booting, gate listen on an env flag instead:
  `if (!process.env.FUNDLINE_NO_LISTEN) server.listen(...)`. Tests set
  `process.env.FUNDLINE_NO_LISTEN = "1"` BEFORE `require("./server.js")`. Fixed in 5e33813.

## Repo gotcha

- The real git repo is the nested `outputs/arc-invoice-usdc/` (remote
  github.com/duclucky/fundline, branch main). The outer `fundline/` folder's git is
  actually the Windows home dir (C:/Users/TBC) and tracks unrelated files. Always run git
  from `outputs/arc-invoice-usdc/`.
- Subagent / rule discovery is relative to the workspace root. These live in the nested
  repo's `.claude/`. If a session is rooted at the outer fundline/ folder, they may not
  auto-discover; open `outputs/arc-invoice-usdc/` as the workspace, or mirror `.claude/`
  up one level.
