# Plan: Create invoices via the Fundline Telegram bot

Status: PLAN (not yet approved to code). Authored 2026-06-19 from a 3-decision
architecture workflow (transport, identity/security, session state machine).
This file lives under `.claude/` so it is FTP-excluded (never served on the site).

## Goal

A merchant creates a USDC invoice from inside the Fundline Telegram bot using
inline-keyboard buttons (minimal typing), and gets back a `fundline.xyz/pay/:id`
link. Future external sales bots integrate via the existing API-key
`/api/agent/invoices` path, NOT through this bot.

## Agreed product flow (decided with user)

- `/start`: if the chat is NOT linked to a merchant -> one-time setup screen
  (welcome + chat ID + "Open Fundline Settings" button). If linked -> straight
  to the main menu. Setup screen seen once.
- Main menu: `[ Create invoice ] [ My invoices ]`.
- Create: type client name -> type amount in USDC (custom, no presets) ->
  pick due date `[3][7][14][30 days]` -> Confirm screen (client, amount,
  concrete due date) `[Confirm][Cancel]` -> return pay link + `[New invoice]`.
  DECIDED: no "No due date" option; every bot invoice has a due date (default
  path is the 3/7/14/30-day buttons), so normalizeInvoice is untouched.
- `[My invoices]`: 5 most recent for that merchant.
- Re-show the chat ID (device changes) via a "Show chat ID" button in the main
  menu. DECIDED: `/start` is the ONLY registered slash command; `/id` and
  `/chatid` are removed.

## Key architecture decisions

1. TRANSPORT: keep the existing getUpdates polling, do NOT add a webhook.
   - Fix the current short-poll (timeout=0, 8s setInterval) to LONG-poll
     (timeout=25) on a self-rescheduling setTimeout chain -> sub-second taps.
   - Add `allowed_updates: ["message","callback_query"]` and a callback_query
     branch so inline buttons work.
   - Reasons: cPanel single-process + manual-restart host; polling is
     self-healing, no inbound endpoint, no webhook secret, identical on
     localhost and prod; Telegram forbids getUpdates + webhook together.
   - Use a dedicated `https.request` with a 30s socket timeout for the poll
     (the shared requestJson hardcodes 15000ms and would abort a 25s long-poll).
   - Future trigger to revisit webhook: ever running >1 process (409 Conflict).

2. IDENTITY / SECURITY: confirmed 1:1 chatId <-> wallet binding.
   - New store `data/telegram-links.json`:
     `{ links: { "<chatId>": { wallet, status:"pending"|"active", linkedAt, confirmedAt, lastSeenAt } } }`.
   - `resolveWalletByChatId(chatId)` returns the wallet ONLY when status active.
   - Trust anchor: telegramChatId is set inside the authenticated settings PUT
     (requireSellerAuth verifies an ethers signature, server.js:2610). On that
     PUT, call `claimTelegramChatId(wallet, chatId)` which writes the link as
     `pending` and enforces 1:1 (release any chatId already bound to this wallet;
     steal the chatId from any other wallet and blank their telegramChatId).
   - The link becomes `active` only when that exact chat sends `/start`. This
     closes the spoof where a merchant pastes a victim's chatId.
   - Bot-created invoices FORCE `merchantWallet = resolveWalletByChatId(chatId)`,
     never a user-supplied value (mirrors the agentSellerId override at
     server.js:414). A bot user can only invoice for their own wallet.
   - One-time reconciliation when first seeding the index: if existing
     sellers.json has duplicate chatIds, keep most-recently-updated as active.
   - Per-chat rate limit (reuse in-memory rateLimits Map, 60s window) to bound
     spam. Invoice creation moves no funds, so blast radius is spam/spoof only.

3. SESSION STATE MACHINE: in `data/telegram-sessions.json`, driven inside the
   poll loop. 7 states S0..S6.
   - `{ sessions: { [chatId]: { chatId, merchantWallet, state, step, draft:{clientName,amount,dueChoice,dueDateIso}, lastInvoiceId, draftInvoiceId, createdAt, updatedAt, expiresAt } } }`
   - State table:
     - S0 IDLE_UNLINKED: /start with no active link -> setup screen.
     - S1 MAIN_MENU: greeting + [Create invoice][My invoices].
     - S2 ASK_CLIENT: typed text = client name (trim, slice 0..160).
     - S3 ASK_AMOUNT: typed text = USDC amount; validate via roundMoney +
       amountToUnits(text,6) > 0n (same semantics as normalizeInvoice total guard).
     - S4 ASK_DUE: buttons only [3][7][14][30 days]; compute dueDateIso from N days.
     - S5 CONFIRM: summary + [Confirm][Cancel]; RE-VALIDATE link before create.
     - S6 DONE: pay link + [New invoice].
   - Callback data: compact `ns:value:step` (act:create / act:confirm / act:cancel
     / act:menu / act:mine, due:3|7|14|30|none). Trailing int = session.step the
     keyboard was minted with.
   - STALE-TAP GUARD: step increments every time the bot sends a keyboard. A
     callback whose step != session.step is answered ("button expired") and
     ignored. Defeats old buttons + double taps.
   - TEXT vs BUTTON per state: S2/S3 advance on typed text only; S1/S4/S5/S6 on
     buttons only (typed text -> "Use the buttons below" nudge).
   - CONCURRENCY: one Node process / one event loop. Per-chat in-memory Promise
     mutex (serialize a chat's turns) + one global write-queue Promise (no
     whole-file write overlap). Each turn does exactly one load -> mutate -> save.
   - IDEMPOTENCY: generate draftInvoiceId once at the Confirm screen; a duplicate
     Confirm returns the same invoice.
   - EXPIRY: 30 min TTL, refreshed each turn; prune expired on load; cap total.
   - /start = hard reset (re-resolve link). /cancel = wipe draft -> S1.
     /id, /chatid handled before the reducer, work in any state.
   - Invoice creation reuses normalizeInvoice + loadInvoiceDb/saveInvoiceDb (the
     same path POST /api/invoices uses, server.js:338-386), via a shared
     createInvoiceRecord(input) helper used by both the HTTP handler and the bot.
     Amount stays a 2dp human value (roundMoney); 6-decimal conversion happens
     client-side at pay time. Pay link = (PUBLIC_BASE_URL||"https://fundline.xyz")
     + "/pay/" + id.

## Implementation phases (each shippable + node --check + a test_*.js)

### Phase 0 - Long-poll + callback plumbing
- Files: server.js
- pollTelegramUpdates (server.js:2079): timeout=25, allowed_updates, dedicated
  https.request w/ 30s socket timeout, self-rescheduling setTimeout chain,
  keep telegramUpdateOffset ack + telegramPollBusy guard.
- Add answerCallbackQuery(id, text) helper; add update.callback_query branch.
- Wrap each update handler in try/catch so one bad update can't stall the loop.
- Acceptance: button taps no longer leave a spinner; updates arrive sub-second;
  /start /id /chatid still work; node --check passes.

### Phase 1 - Confirmed chatId <-> wallet link
- Files: server.js
- Add TELEGRAM_LINK_DB_PATH + loadTelegramLinkDb/saveTelegramLinkDb (mirror
  loadSellerDb/saveSellerDb, server.js:714-728).
- resolveWalletByChatId(chatId) (active only).
- claimTelegramChatId(wallet, chatId) atomic 1:1; call it from the settings PUT
  (server.js:2865-2885) instead of the raw telegramChatId write.
- /start: pending->active confirm; linked -> S1; unlinked -> S0 setup screen.
- setMyCommands registers ONLY /start (drop /id, /chatid). Update the handler so
  /id and /chatid are no longer special-cased.
- One-time reconciliation seeding from sellers.json duplicates.
- Acceptance: pasted-but-unconfirmed chatId is inert; one wallet per chatId;
  GET /api/sellers/:wallet still exposes only displayName (no chatId leak).

### Phase 2 - Session machine + create-invoice flow
- Files: server.js
- Add TELEGRAM_SESSION_DB_PATH + load/save w/ prune.
- Implement the S0..S6 reducer, callback encoding + step stamp, per-chat mutex +
  global write queue, amount validation (roundMoney/amountToUnits), due-date
  buttons, createInvoiceRecord shared helper, idempotent confirm via draftInvoiceId,
  link re-validation at Confirm.
- Acceptance: full create flow end-to-end on a real chat; double Confirm creates
  one invoice; stale buttons rejected; merchantWallet always the linked wallet.

### Phase 3 - My invoices + menu polish
- Files: server.js
- [My invoices]: db.invoices.filter(sameAddress merchantWallet) sorted desc,
  slice(0,5), rendered as text + pay links.
- [Show chat ID] main-menu button (replaces the dropped /id, /chatid commands).
- [Cancel] button cancels the flow back to the menu (no /cancel command).
- [New invoice] loop back to S2.
- Acceptance: menu navigation complete; My invoices shows only the caller's;
  Show chat ID returns the same chat ID block as the setup screen.

## Security invariants (must hold)
- Bot creates invoices ONLY for resolveWalletByChatId(chatId); never a
  client-supplied wallet. Re-validate the link at Confirm.
- Link becomes active only after the real chat sends /start (no paste-spoof).
- Non-custodial: invoice creation is a pure write; no transferFrom; merchant
  receives to their own wallet.
- chatId and the link map stay server-internal; never exposed via any public route.
- 6-decimal USDC handling reused from the existing helpers; no parallel path.

## Testing (standalone node test_*.js, no framework)
- test_telegram_link.js: claim 1:1 (release prior, steal from other wallet),
  pending vs active resolution, reconciliation of duplicate chatIds.
- test_telegram_session.js: S0..S6 transitions, step-stamp stale-tap rejection,
  amount validation accept/reject table, idempotent double Confirm, expiry prune.
- test_telegram_create.js: createInvoiceRecord forces merchantWallet, reuses
  normalizeInvoice, seller-name inheritance, pay link shape.
- Manual: real bot on testnet - link, create, My invoices, /cancel, stale tap.

## Deployment notes
- Push to main -> FTP deploy. The cPanel Node app MUST be manually restarted for
  the new poll loop + handlers to take effect (FTP only copies files).
- No new env var required (TELEGRAM_BOT_TOKEN exists). Optional:
  TELEGRAM_SESSION_TTL_MS. PUBLIC_BASE_URL already used for pay links.
- data/telegram-links.json and telegram-sessions.json are gitignored; empty on
  the live box until first use. Code must tolerate missing files.
- node --check server.js is the CI gate; keep it green.

## Decisions (resolved with user 2026-06-19)
1. No emoji in bot messages and button labels (matches the website rule + the
   existing plain-text Telegram messages).
2. "No due date": DROPPED. Every bot invoice gets a due date via the
   [3][7][14][30 days] buttons, so normalizeInvoice is untouched.
3. Confirmation step (pending->active on /start): KEEP. Closes the
   paste-someone-elses-chatId spoof at the cost of one extra /start.
4. Commands: `/start` is the ONLY registered command. Drop `/id` and `/chatid`.
   "Show chat ID" becomes a main-menu button (Phase 3). `/cancel` is not a
   registered command; the flow uses a [Cancel] button instead.

## Build process
- Phase by phase: implement one phase, node --check + a test_*.js, commit, then
  stop for review before the next phase (user choice).
- Phase 0 DONE: long-poll rewrite + callback plumbing (commit, test_telegram_longpoll.js).
