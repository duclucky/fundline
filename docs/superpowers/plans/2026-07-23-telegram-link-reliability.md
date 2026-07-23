# Telegram Link Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Telegram linking report and enforce the real `not_linked`, `pending`, and `active` states so the bot invoice menu becomes available only after the claimed chat sends `/start`.

**Architecture:** Keep `/start` as the proof-of-chat-control boundary. Derive link status from the existing seller and Telegram link stores, repair missing claims during authenticated settings writes, and render that server-derived state in the existing settings UI. Outbound test messages remain delivery tests and never mutate link state.

**Tech Stack:** Node.js 20, CommonJS, plain `http`, vanilla browser JavaScript, JSON file stores, standalone `node test_*.js` tests.

## Global Constraints

- Code, comments, UI copy, and project docs are in English.
- Do not use long em dashes, emojis, or icons attached to website text.
- Preserve the one-wallet-per-chat and one-chat-per-wallet invariants.
- Do not persist derived `telegramLinkStatus` inside `data/sellers.json`.
- Do not expose Telegram link status through an unauthenticated endpoint.
- Preserve unrelated worktree changes in `workflow-mcp-tools.js` and `test_workflow_mcp_tools.js`.

---

### Task 1: Derived Telegram Link Status and Claim Repair

**Files:**
- Modify: `server.js:3241-3315`
- Modify: `server.js:897-929`
- Test: `test_telegram_link.js`

**Interfaces:**
- Consumes: `loadTelegramLinkDb()`, `claimTelegramChatId(sellerDb, wallet, chatId)`, and `normalizeAddress(value)`.
- Produces: `getTelegramLinkStatus(wallet, rawChatId) -> "not_linked" | "pending" | "active"` and `ensureTelegramLinkClaim(sellerDb, wallet, rawChatId) -> status`.

- [ ] **Step 1: Write the failing helper tests**

Add these assertions to `run()` in `test_telegram_link.js`:

```js
resetState();
const repairDb = { sellers: { [WALLET_A]: seller(WALLET_A, CHAT_X) } };
assert(server.getTelegramLinkStatus(WALLET_A, "") === "not_linked", "empty chat ID is not linked");
assert(server.ensureTelegramLinkClaim(repairDb, WALLET_A, CHAT_X) === "pending", "missing claim is repaired as pending");
assert(server.getTelegramLinkStatus(WALLET_A, CHAT_X) === "pending", "repaired claim reports pending");
server.activateTelegramLink(CHAT_X);
const activeBefore = server.loadTelegramLinkDb().links[CHAT_X].confirmedAt;
assert(server.ensureTelegramLinkClaim(repairDb, WALLET_A, CHAT_X) === "active", "matching active claim stays active");
assert(server.loadTelegramLinkDb().links[CHAT_X].confirmedAt === activeBefore, "active claim confirmation is preserved");
server.saveTelegramLinkDb({
  links: {
    [CHAT_X]: { wallet: WALLET_B, status: "active", linkedAt: "", confirmedAt: "", lastSeenAt: "" },
  },
});
assert(server.ensureTelegramLinkClaim(repairDb, WALLET_A, CHAT_X) === "pending", "mismatched claim is repaired for the seller");
assert(server.getTelegramLinkStatus(WALLET_A, CHAT_X) === "pending", "repaired mismatch requires /start again");
assert(server.ensureTelegramLinkClaim(repairDb, WALLET_A, "") === "not_linked", "clearing chat ID removes the claim");
assert(server.loadTelegramLinkDb().links[CHAT_X] === undefined, "cleared claim is removed from the link store");
```

- [ ] **Step 2: Run the helper test and verify RED**

Run:

```powershell
node test_telegram_link.js
```

Expected: FAIL because `getTelegramLinkStatus` or `ensureTelegramLinkClaim` is not exported.

- [ ] **Step 3: Implement the minimal helpers**

Add after `claimTelegramChatId` in `server.js`:

```js
function getTelegramLinkStatus(wallet, rawChatId) {
  const walletKey = normalizeAddress(wallet);
  const chatId = String(rawChatId || "").trim();
  if (!walletKey || !chatId) return "not_linked";
  const link = loadTelegramLinkDb().links[chatId];
  if (!link || normalizeAddress(link.wallet) !== walletKey) return "not_linked";
  return link.status === "active" ? "active" : "pending";
}

function ensureTelegramLinkClaim(sellerDb, wallet, rawChatId) {
  const walletKey = normalizeAddress(wallet);
  const chatId = String(rawChatId || "").trim().slice(0, 64);
  if (!walletKey) return "not_linked";
  if (!chatId) {
    claimTelegramChatId(sellerDb, walletKey, "");
    return "not_linked";
  }
  const status = getTelegramLinkStatus(walletKey, chatId);
  if (status === "active" || status === "pending") return status;
  claimTelegramChatId(sellerDb, walletKey, chatId);
  return "pending";
}
```

Export both functions from `module.exports`.

- [ ] **Step 4: Run the helper test and verify GREEN**

Run:

```powershell
node test_telegram_link.js
```

Expected: all assertions pass.

- [ ] **Step 5: Commit the helper behavior**

```powershell
git add server.js test_telegram_link.js
git commit -m "Add Telegram link status helpers"
```

### Task 2: Authenticated Settings Status Contract

**Files:**
- Modify: `server.js:6315-6360`
- Modify: `test_seller_name.js`

**Interfaces:**
- Consumes: `ensureTelegramLinkClaim` and `getTelegramLinkStatus` from Task 1.
- Produces: authenticated GET/PUT `/api/dashboard/settings` responses with top-level `telegramLinkStatus`.

- [ ] **Step 1: Write the failing HTTP regression test**

Extend `test_seller_name.js`. Add `TELEGRAM_LINK_PATH`, snapshot/restore it in `main()`, and
replace `putName` with a generic signed helper:

```js
const TELEGRAM_LINK_PATH = path.join(DATA_DIR, "telegram-links.json");
const CHAT_X = "8436047896";

async function sellerSettingsRequest(wallet, privateKey, method, body) {
  const issuedAt = new Date().toISOString();
  const message = [
    "Sign in to Fundline",
    "",
    "This signature proves you control this wallet.",
    "It does not move funds or create an on-chain transaction.",
    "",
    `Issued at: ${issuedAt}`,
  ].join("\n");
  const signature = await new Wallet(privateKey).signMessage(message);
  const response = await fetch(`${BASE}/api/dashboard/settings`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-fundline-wallet": wallet,
      "x-fundline-signature": signature,
      "x-fundline-issued-at": issuedAt,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => ({})) };
}
```

At the end of `runAssertions`, add:

```js
let settingsResponse = await sellerSettingsRequest(w1.address, w1.privateKey, "GET");
assert(settingsResponse.status === 200, "authenticated settings GET succeeds");
assert(settingsResponse.json.telegramLinkStatus === "not_linked", "initial Telegram link is not linked");

settingsResponse = await sellerSettingsRequest(w1.address, w1.privateKey, "PUT", {
  telegramChatId: CHAT_X,
  alerts: { paid: true, failed: true, overdue: true },
});
assert(settingsResponse.json.telegramLinkStatus === "pending", "new chat ID is pending");

const linkDb = JSON.parse(fs.readFileSync(TELEGRAM_LINK_PATH, "utf8"));
linkDb.links[CHAT_X].status = "active";
linkDb.links[CHAT_X].confirmedAt = new Date().toISOString();
fs.writeFileSync(TELEGRAM_LINK_PATH, JSON.stringify(linkDb, null, 2) + "\n");
const confirmedAt = linkDb.links[CHAT_X].confirmedAt;

settingsResponse = await sellerSettingsRequest(w1.address, w1.privateKey, "PUT", {
  telegramChatId: CHAT_X,
  alerts: { paid: false, failed: true, overdue: true },
});
assert(settingsResponse.json.telegramLinkStatus === "active", "unchanged active chat stays active");
assert(JSON.parse(fs.readFileSync(TELEGRAM_LINK_PATH, "utf8")).links[CHAT_X].confirmedAt === confirmedAt, "active confirmation timestamp is preserved");

fs.writeFileSync(TELEGRAM_LINK_PATH, JSON.stringify({ links: {} }, null, 2) + "\n");
settingsResponse = await sellerSettingsRequest(w1.address, w1.privateKey, "PUT", { telegramChatId: CHAT_X });
assert(settingsResponse.json.telegramLinkStatus === "pending", "missing unchanged claim is repaired");

settingsResponse = await sellerSettingsRequest(w1.address, w1.privateKey, "PUT", { telegramChatId: "" });
assert(settingsResponse.json.telegramLinkStatus === "not_linked", "blank chat ID removes the link");
assert(Object.hasOwn(JSON.parse(fs.readFileSync(SELLER_PATH, "utf8")).sellers[w1.address.toLowerCase()], "telegramLinkStatus") === false, "derived status is not persisted");
```

Add `const telegramLinkBak = snapshot(TELEGRAM_LINK_PATH);` and restore it in `finally`.

- [ ] **Step 2: Run the HTTP test and verify RED**

Run:

```powershell
node test_seller_name.js
```

Expected: FAIL because settings responses do not include `telegramLinkStatus` and unchanged
missing claims are not repaired.

- [ ] **Step 3: Implement the settings response contract**

Change the GET response to:

```js
const telegramLinkStatus = getTelegramLinkStatus(sellerId, settings.telegramChatId);
sendJson(res, 200, { settings, telegramLinkStatus });
```

In PUT, replace the chat-ID-changed-only claim condition with:

```js
let telegramLinkStatus = getTelegramLinkStatus(sellerId, nextChatId);
if (patch.telegramChatId !== undefined) {
  telegramLinkStatus = ensureTelegramLinkClaim(db, sellerId, nextChatId);
}
saveSellerDb(db);
sendJson(res, 200, {
  settings: db.sellers[sellerId],
  telegramLinkStatus,
});
```

Do not add `telegramLinkStatus` to `db.sellers[sellerId]`.

- [ ] **Step 4: Run backend Telegram tests**

Run:

```powershell
node test_seller_name.js
node test_telegram_link.js
node test_telegram_session.js
```

Expected: all pass, including pending `/start` activation into `main_menu`.

- [ ] **Step 5: Commit the settings contract**

```powershell
git add server.js test_seller_name.js
git commit -m "Expose Telegram activation status"
```

### Task 3: Settings UI and Neutral Test Message

**Files:**
- Modify: `app.html:353-397`
- Modify: `app.js:93-148`
- Modify: `app.js:718-728`
- Modify: `app.js:1019-1073`
- Modify: `app.js:2431-2450`
- Modify: `app.js:3101-3127`
- Modify: `server.js:4732-4741`
- Create: `test_telegram_settings_ui.js`

**Interfaces:**
- Consumes: `telegramLinkStatus` from Task 2.
- Produces: status rendering, pending `/start` guidance, and a delivery-only test message.

- [ ] **Step 1: Write the failing source-contract test**

Create `test_telegram_settings_ui.js`:

```js
"use strict";

const assert = require("assert");
const fs = require("fs");

const html = fs.readFileSync("app.html", "utf8");
const app = fs.readFileSync("app.js", "utf8");
const server = fs.readFileSync("server.js", "utf8");

assert.match(html, /id="telegramLinkStatus"/);
assert.match(html, />Send test message</);
assert.doesNotMatch(html, />Verify Telegram</);
assert.match(app, /telegramLinkStatus/);
assert.match(app, /Send \\/start in Telegram to finish linking\./);
assert.match(app, /Test message delivered to Telegram\./);
assert.doesNotMatch(server, /Your payment alerts are active\./);
assert.doesNotMatch(server, /Fundline is connected\./);

console.log("PASS: Telegram settings UI contract");
```

- [ ] **Step 2: Run the UI test and verify RED**

Run:

```powershell
node test_telegram_settings_ui.js
```

Expected: FAIL on the missing status element and old verify copy.

- [ ] **Step 3: Add the status markup and frontend state**

Add below the Telegram chat ID input:

```html
<p class="settings-note" id="telegramLinkStatus" data-status="not_linked">
  Telegram bot is not linked.
</p>
```

Rename the button text to `Send test message`.

Add `telegramLinkStatus: "not_linked"` to the root UI state and cache
`document.getElementById("telegramLinkStatus")`. Add:

```js
function renderTelegramLinkStatus() {
  const status = state.telegramLinkStatus || "not_linked";
  const element = document.getElementById("telegramLinkStatus");
  if (!element) return;
  element.dataset.status = status;
  element.textContent = status === "active"
    ? "Telegram bot is active. You can create invoices from the bot."
    : status === "pending"
      ? "Pending activation. Open @Fundline_bot and send /start."
      : "Telegram bot is not linked.";
}
```

Call it from `renderSettings()`.

- [ ] **Step 4: Consume status from save and refresh responses**

Parse the successful PUT body in `saveSettingsFromForm`, assign:

```js
const data = await res.json().catch(() => ({}));
state.telegramLinkStatus = String(data.telegramLinkStatus || "not_linked");
```

Then select the toast:

```js
const message = state.telegramLinkStatus === "pending"
  ? "Settings saved. Send /start in Telegram to finish linking."
  : state.telegramLinkStatus === "active"
    ? "Settings saved. Telegram bot is connected."
    : "Settings saved.";
showToast(message);
```

Update the authenticated settings refresh function to assign
`state.telegramLinkStatus = data.telegramLinkStatus || "not_linked"` and render. Call that
refresh when Settings opens and on `visibilitychange` when the document becomes visible.

- [ ] **Step 5: Make the outbound test message neutral**

Change the success toast to:

```js
showToast("Test message delivered to Telegram.");
```

Change `buildVerifyAlertMessage()` to:

```js
function buildVerifyAlertMessage() {
  return [
    "Fundline test message delivered.",
    "",
    "To finish linking this chat and open the invoice menu, send /start.",
  ].join("\n");
}
```

- [ ] **Step 6: Run UI and Telegram regression tests**

Run:

```powershell
node test_telegram_settings_ui.js
node test_seller_name.js
node test_telegram_link.js
node test_telegram_session.js
node --check app.js
node --check server.js
```

Expected: all pass with zero syntax errors.

- [ ] **Step 7: Commit the Telegram UI**

```powershell
git add app.html app.js server.js test_telegram_settings_ui.js
git commit -m "Clarify Telegram activation flow"
```

### Task 4: Telegram Acceptance Check

**Files:**
- Verify only: `app.html`, `app.js`, `server.js`, Telegram tests

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: independently shippable Telegram reliability change.

- [ ] **Step 1: Run the complete Telegram suite**

```powershell
node test_telegram_link.js
node test_telegram_longpoll.js
node test_telegram_session.js
node test_telegram_invoices.js
node test_telegram_settings.js
node test_telegram_settings_ui.js
node --check app.js
node --check server.js
```

Expected: all tests pass. If `test_telegram_invoices.js` still asserts the removed
`act:chatid` action, update that stale assertion in its own commit before claiming a clean suite.

- [ ] **Step 2: Review the scoped diff**

```powershell
git diff HEAD~3 -- app.html app.js server.js test_telegram_link.js test_seller_name.js test_telegram_settings_ui.js
git status --short
```

Expected: only Telegram-scope changes plus the pre-existing unrelated worktree files.
