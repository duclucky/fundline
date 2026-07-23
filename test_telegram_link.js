// Unit test for the Phase 1 confirmed chatId<->wallet link store.
//
// Rules under test:
//   1. A claimed link starts "pending" and does NOT resolve to a wallet until
//      that chat sends /start (activateTelegramLink), which closes the spoof
//      where a merchant pastes someone else's chat ID.
//   2. One chatId per wallet: claiming a new chatId releases the wallet's old one.
//   3. One wallet per chatId: claiming a chatId held by another wallet steals it
//      and blanks the previous wallet's stored telegramChatId.
//   4. resolve/activate behave correctly for unknown chats.
//   5. Claiming an empty chatId removes the wallet's link.
//   6. seedTelegramLinksFromSellers seeds existing chatIds as pending,
//      idempotently, first-seen-wins on duplicate chatIds.
//
// Runs against the real data/ files, snapshotting and restoring them. Requires
// server.js as a module (no server is started thanks to the require.main guard).
//
// Run: node test_telegram_link.js

const fs = require("fs");
process.env.FUNDLINE_NO_LISTEN = "1"; // require server.js without booting the server
const server = require("./server.js");

const LINK_PATH = server.TELEGRAM_LINK_DB_PATH;
const SELLER_PATH = server.SELLER_DB_PATH;

const WALLET_A = "0x" + "a".repeat(40);
const WALLET_B = "0x" + "b".repeat(40);
const CHAT_X = "8436047896";
const CHAT_Y = "9999999999";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log("  ok   -", msg);
  } else {
    failed++;
    console.error("  FAIL -", msg);
  }
}

function snapshot(p) {
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}
function restore(p, buf) {
  if (buf === null) {
    if (fs.existsSync(p)) fs.rmSync(p);
  } else {
    fs.writeFileSync(p, buf);
  }
}

function resetState() {
  server.saveTelegramLinkDb({ links: {} });
  server.saveSellerDb({ sellers: {} });
}

function seller(wallet, chatId) {
  return { wallet, displayName: "", telegramChatId: chatId, alerts: { paid: true, failed: true, overdue: true } };
}

function run() {
  // Case 1 + 2: claim -> pending -> activate -> resolve.
  resetState();
  const sdb = { sellers: { [WALLET_A]: seller(WALLET_A, "") } };
  server.claimTelegramChatId(sdb, WALLET_A, CHAT_X);
  assert(server.resolveWalletByChatId(CHAT_X) === "", "pending link does not resolve to a wallet");
  let link = server.loadTelegramLinkDb().links[CHAT_X];
  assert(link && link.status === "pending" && server.normalizeAddress(link.wallet) === WALLET_A, "claim creates a pending link to the wallet");
  assert(server.activateTelegramLink(CHAT_X) === "activated", "first /start activates the pending link");
  assert(server.resolveWalletByChatId(CHAT_X) === WALLET_A, "active link resolves to the wallet");
  assert(server.activateTelegramLink(CHAT_X) === "active", "second /start is idempotent (already active)");

  // Case: one chatId per wallet.
  server.claimTelegramChatId(sdb, WALLET_A, CHAT_Y);
  assert(server.loadTelegramLinkDb().links[CHAT_X] === undefined, "claiming a new chatId releases the wallet's old chatId");
  server.activateTelegramLink(CHAT_Y);
  assert(server.resolveWalletByChatId(CHAT_Y) === WALLET_A, "the new chatId links to the same wallet");

  // Case 3: one wallet per chatId (steal from another wallet).
  resetState();
  const sdb2 = { sellers: { [WALLET_A]: seller(WALLET_A, ""), [WALLET_B]: seller(WALLET_B, CHAT_X) } };
  server.claimTelegramChatId(sdb2, WALLET_B, CHAT_X);
  server.activateTelegramLink(CHAT_X);
  assert(server.resolveWalletByChatId(CHAT_X) === WALLET_B, "precondition: B owns CHAT_X");
  server.claimTelegramChatId(sdb2, WALLET_A, CHAT_X);
  link = server.loadTelegramLinkDb().links[CHAT_X];
  assert(link && server.normalizeAddress(link.wallet) === WALLET_A && link.status === "pending", "A steals CHAT_X, now pending under A");
  assert(sdb2.sellers[WALLET_B].telegramChatId === "", "stealing blanks the previous wallet's stored chatId");
  // The settings PUT loads the whole seller db, lets claim mutate it, then saves the
  // whole map - so the blanked prior wallet must persist (regression lock for the 1:1 invariant).
  server.saveSellerDb(sdb2);
  assert(server.loadSellerDb().sellers[WALLET_B].telegramChatId === "", "steal-blank persists across saveSellerDb");
  assert(server.resolveWalletByChatId(CHAT_X) === "", "stolen link stays pending until A confirms");

  // Case 4: unknown chat.
  assert(server.resolveWalletByChatId("000000") === "", "unknown chatId resolves to empty");
  assert(server.activateTelegramLink("000000") === "none", "activating an unknown chat returns none");

  // Case 5: claiming empty chatId removes the link.
  resetState();
  const sdb3 = { sellers: { [WALLET_A]: seller(WALLET_A, CHAT_X) } };
  server.claimTelegramChatId(sdb3, WALLET_A, CHAT_X);
  server.activateTelegramLink(CHAT_X);
  assert(server.resolveWalletByChatId(CHAT_X) === WALLET_A, "precondition: A active on CHAT_X");
  server.claimTelegramChatId(sdb3, WALLET_A, "");
  assert(server.loadTelegramLinkDb().links[CHAT_X] === undefined, "claiming an empty chatId removes the wallet's link");
  assert(server.resolveWalletByChatId(CHAT_X) === "", "removed link no longer resolves");

  // Case 6: seeding from existing sellers.
  resetState();
  server.saveSellerDb({ sellers: { [WALLET_A]: seller(WALLET_A, CHAT_X), [WALLET_B]: seller(WALLET_B, CHAT_Y) } });
  let r = server.seedTelegramLinksFromSellers();
  assert(r.added === 2 && r.dropped === 0, "seed adds a pending link per seller chatId");
  link = server.loadTelegramLinkDb().links[CHAT_X];
  assert(link && link.status === "pending" && server.normalizeAddress(link.wallet) === WALLET_A, "seeded link is pending under the right wallet");
  assert(server.resolveWalletByChatId(CHAT_X) === "", "seeded links require /start before resolving");
  r = server.seedTelegramLinksFromSellers();
  assert(r.added === 0, "seed is idempotent (skips chatIds already in the store)");

  // Case 7: duplicate chatId across wallets, first-seen-wins.
  resetState();
  server.saveSellerDb({ sellers: { [WALLET_A]: seller(WALLET_A, CHAT_X), [WALLET_B]: seller(WALLET_B, CHAT_X) } });
  r = server.seedTelegramLinksFromSellers();
  assert(r.added === 1 && r.dropped === 1, "duplicate chatId across wallets: first wins, the other is dropped");
  assert(server.normalizeAddress(server.loadTelegramLinkDb().links[CHAT_X].wallet) === WALLET_A, "the first seller keeps the shared chatId link");

  // Case 8: derived status and unchanged-Chat-ID repair.
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
}

function main() {
  const linkBak = snapshot(LINK_PATH);
  const sellerBak = snapshot(SELLER_PATH);
  try {
    run();
  } catch (err) {
    console.error("Test threw:", err);
    failed++;
  } finally {
    restore(LINK_PATH, linkBak);
    restore(SELLER_PATH, sellerBak);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
