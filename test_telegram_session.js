// Unit test for the Phase 2 Telegram create-invoice state machine.
//
// Covers: parseTelegramAmount accept/reject; createInvoiceRecord forcing
// merchantWallet and rejecting duplicate ids; the full conversational flow
// (/start -> menu -> client name -> amount -> due -> confirm -> invoice created);
// stale-tap and double-confirm rejection via the step stamp; mid-flow amount
// validation; cancel; and the unlinked-chat guard.
//
// Runs offline: requiring server.js does not start the server (require.main
// guard), and clearing the bot token makes sendTelegramMessage / answerCallbackQuery
// no-ops, so the reducer runs and mutates session/invoice state without any
// network. Works against the real data/ files with snapshot/restore.
//
// Run: node test_telegram_session.js

const fs = require("fs");
process.env.FUNDLINE_NO_LISTEN = "1"; // require server.js without booting the server
const server = require("./server.js");

// Force the no-token path so the reducer makes no Telegram network calls.
delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.FUNDLINE_TELEGRAM_BOT_TOKEN;
delete process.env.ARC_INVOICE_TELEGRAM_BOT_TOKEN;

const LINK_PATH = server.TELEGRAM_LINK_DB_PATH;
const SESSION_PATH = server.TELEGRAM_SESSION_DB_PATH;
const SELLER_PATH = server.SELLER_DB_PATH;
const INVOICE_PATH = server.INVOICE_DB_PATH;

const WALLET_A = "0x" + "a".repeat(40);
const CHAT_X = "8436047896";

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
  server.saveTelegramLinkDb({ links: { [CHAT_X]: { wallet: WALLET_A, status: "active", linkedAt: "", confirmedAt: "", lastSeenAt: "" } } });
  server.saveTelegramSessionDb({ sessions: {} });
  server.saveSellerDb({ sellers: {} });
  server.saveInvoiceDb({ invoices: [] });
}

function cb(chatId, data) {
  return { id: "cb", data, message: { chat: { id: chatId } } };
}
function state() {
  return server.getTelegramSession(CHAT_X);
}
function invoiceCount() {
  return server.loadInvoiceDb().invoices.length;
}

async function run() {
  // parseTelegramAmount accept/reject.
  [["25", 25], ["25.50", 25.5], ["0.01", 0.01], ["1,000.50", 1000.5], ["100", 100]].forEach(([inp, exp]) => {
    assert(server.parseTelegramAmount(inp) === exp, `amount "${inp}" parses to ${exp}`);
  });
  ["0", "-5", "abc", "", "1e3", "  ", ".", "12."].forEach((inp) => {
    assert(server.parseTelegramAmount(inp) === null, `amount "${inp}" rejected`);
  });

  // createInvoiceRecord: valid build + duplicate id.
  resetState();
  const rec = server.createInvoiceRecord({ merchantWallet: WALLET_A, clientName: "Acme", items: [{ description: "Item", quantity: 1, unitPrice: 5 }], total: 5 });
  assert(server.normalizeAddress(rec.merchantWallet) === WALLET_A && rec.total === 5, "createInvoiceRecord builds a valid invoice for the wallet");
  let threw = false;
  try {
    server.createInvoiceRecord({ id: rec.id, merchantWallet: WALLET_A, items: [{ description: "Item", quantity: 1, unitPrice: 5 }], total: 5 });
  } catch (e) {
    threw = e.code === "DUPLICATE_ID";
  }
  assert(threw, "createInvoiceRecord throws DUPLICATE_ID on a duplicate id");

  // Full happy-path flow.
  resetState();
  await server.handleTelegramText(CHAT_X, "/start");
  assert(state().state === "main_menu", "/start opens the main menu");
  await server.handleTelegramCallback(cb(CHAT_X, `act:create:${state().step}`));
  assert(state().state === "ask_client", "Create invoice -> ask client name");
  await server.handleTelegramText(CHAT_X, "Nguyen Van A");
  assert(state().state === "ask_amount" && state().draft.clientName === "Nguyen Van A", "client name captured -> ask amount");
  await server.handleTelegramText(CHAT_X, "125.50");
  assert(state().state === "ask_due" && state().draft.amount === 125.5, "amount captured -> ask due");
  const dueStep = state().step;
  await server.handleTelegramCallback(cb(CHAT_X, `due:7:${dueStep}`));
  assert(state().state === "confirm" && state().draftInvoiceId, "due chosen -> confirm screen with a draft id");
  const daysOut = Math.round((new Date(state().draft.dueDateIso).getTime() - Date.now()) / 86400000);
  assert(daysOut === 7, "due date computed 7 days out");
  const confirmStep = state().step;
  const draftId = state().draftInvoiceId;
  await server.handleTelegramCallback(cb(CHAT_X, `act:confirm:${confirmStep}`));
  assert(state().state === "done", "confirm -> done");
  const inv = server.loadInvoiceDb().invoices.find((i) => i.id === draftId);
  assert(inv, "invoice created with the draft id");
  assert(inv && server.normalizeAddress(inv.merchantWallet) === WALLET_A, "invoice merchantWallet is the linked wallet (forced)");
  assert(inv && inv.total === 125.5, "invoice total matches the typed amount");
  assert(inv && inv.clientName === "Nguyen Van A", "invoice client name matches");

  // Double-confirm: re-tapping the (now stale) confirm button creates nothing new.
  const before = invoiceCount();
  await server.handleTelegramCallback(cb(CHAT_X, `act:confirm:${confirmStep}`));
  assert(invoiceCount() === before, "stale confirm tap does not create a second invoice");

  // Stale tap generic: a create tap at an old step is ignored.
  resetState();
  await server.handleTelegramText(CHAT_X, "/start");
  const menuStep = state().step;
  await server.handleTelegramCallback(cb(CHAT_X, `act:create:${menuStep - 1}`));
  assert(state().state === "main_menu", "a tap at a stale step is ignored (no transition)");

  // Mid-flow amount validation.
  await server.handleTelegramCallback(cb(CHAT_X, `act:create:${state().step}`));
  await server.handleTelegramText(CHAT_X, "Client B");
  assert(state().state === "ask_amount", "precondition: ask_amount");
  const amtStep = state().step;
  await server.handleTelegramText(CHAT_X, "abc");
  assert(state().state === "ask_amount" && state().step === amtStep, "invalid amount keeps state and step at ask_amount");
  await server.handleTelegramText(CHAT_X, "0");
  assert(state().state === "ask_amount", "zero amount rejected");
  await server.handleTelegramText(CHAT_X, "10");
  assert(state().state === "ask_due", "valid amount advances to ask_due");

  // Cancel returns to the menu.
  resetState();
  await server.handleTelegramText(CHAT_X, "/start");
  await server.handleTelegramCallback(cb(CHAT_X, `act:create:${state().step}`));
  assert(state().state === "ask_client", "precondition for cancel: ask_client");
  await server.handleTelegramCallback(cb(CHAT_X, `act:cancel:${state().step}`));
  assert(state().state === "main_menu", "cancel returns to the main menu");

  // Unlinked chat cannot drive the flow.
  const handled = await server.handleTelegramText("000000", "hello");
  assert(handled === false, "unlinked chat: non-/start text is ignored");
}

async function main() {
  const baks = [LINK_PATH, SESSION_PATH, SELLER_PATH, INVOICE_PATH].map((p) => [p, snapshot(p)]);
  try {
    await run();
  } catch (err) {
    console.error("Test threw:", err);
    failed++;
  } finally {
    baks.forEach(([p, buf]) => restore(p, buf));
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
