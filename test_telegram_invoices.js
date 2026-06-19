// Unit test for the Phase 3 bot menu additions: My invoices and Show chat ID.
//
// Covers: botInvoiceStatus label mapping; buildMyInvoicesText (empty state,
// newest-first ordering, 5-item cap, pay links, only the caller's invoices);
// and that tapping My invoices / Show chat ID re-arms the menu (state stays
// main_menu, step bumps) without breaking the session.
//
// Runs offline (no token -> sends are no-ops) against the real data/ files with
// snapshot/restore. Run: node test_telegram_invoices.js

const fs = require("fs");
process.env.FUNDLINE_NO_LISTEN = "1"; // require server.js without booting the server
const server = require("./server.js");

delete process.env.TELEGRAM_BOT_TOKEN;
delete process.env.FUNDLINE_TELEGRAM_BOT_TOKEN;
delete process.env.ARC_INVOICE_TELEGRAM_BOT_TOKEN;

const LINK_PATH = server.TELEGRAM_LINK_DB_PATH;
const SESSION_PATH = server.TELEGRAM_SESSION_DB_PATH;
const INVOICE_PATH = server.INVOICE_DB_PATH;

const WALLET_A = "0x" + "a".repeat(40);
const WALLET_B = "0x" + "b".repeat(40);
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
function cb(chatId, data) {
  return { id: "cb", data, message: { chat: { id: chatId } } };
}
function state() {
  return server.getTelegramSession(CHAT_X);
}
function inv(id, wallet, createdAt, extra) {
  return Object.assign(
    {
      id,
      merchantWallet: wallet,
      clientName: "Client " + id,
      total: 10,
      status: "open",
      dueDate: "",
      createdAt,
      items: [{ description: "Item", quantity: 1, unitPrice: 10, total: 10 }],
    },
    extra || {},
  );
}

async function run() {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();

  // botInvoiceStatus mapping.
  assert(server.botInvoiceStatus({ status: "paid" }) === "Paid", "status paid -> Paid");
  assert(server.botInvoiceStatus({ status: "verifying" }) === "Verifying", "status verifying -> Verifying");
  assert(server.botInvoiceStatus({ status: "open", dueDate: past }) === "Overdue", "open past due -> Overdue");
  assert(server.botInvoiceStatus({ status: "open", dueDate: future }) === "Open", "open future due -> Open");
  assert(server.botInvoiceStatus({ status: "open", dueDate: "" }) === "Open", "open no due date -> Open");

  // buildMyInvoicesText: empty state.
  server.saveInvoiceDb({ invoices: [] });
  assert(server.buildMyInvoicesText(WALLET_A).startsWith("No invoices yet"), "empty merchant -> no invoices message");

  // Ordering, 5-cap, only the caller's, pay links.
  // Ids must be 20-char hex or normalizeStoredInvoice drops them on load.
  const ID = (n) => `${String(n).padStart(2, "0")}${"a".repeat(18)}`;
  const IDB = "ff" + "b".repeat(18);
  server.saveInvoiceDb({
    invoices: [
      inv(ID(1), WALLET_A, "2026-06-01T00:00:00.000Z"),
      inv(ID(2), WALLET_A, "2026-06-02T00:00:00.000Z"),
      inv(ID(3), WALLET_A, "2026-06-03T00:00:00.000Z"),
      inv(ID(4), WALLET_A, "2026-06-04T00:00:00.000Z"),
      inv(ID(5), WALLET_A, "2026-06-05T00:00:00.000Z"),
      inv(ID(6), WALLET_A, "2026-06-06T00:00:00.000Z"),
      inv(IDB, WALLET_B, "2026-06-07T00:00:00.000Z"),
    ],
  });
  const text = server.buildMyInvoicesText(WALLET_A);
  assert(text.includes(`/pay/${ID(6)}`), "list includes a pay link for the newest invoice");
  assert(!text.includes(ID(1)), "list caps at 5 (oldest excluded)");
  assert(!text.includes(IDB), "list excludes another merchant's invoice");
  assert(text.indexOf(ID(6)) < text.indexOf(ID(2)), "list is newest-first");

  // Tapping My invoices / Show chat ID re-arms the menu.
  server.saveTelegramLinkDb({ links: { [CHAT_X]: { wallet: WALLET_A, status: "active", linkedAt: "", confirmedAt: "", lastSeenAt: "" } } });
  server.saveTelegramSessionDb({ sessions: {} });
  await server.handleTelegramText(CHAT_X, "/start");
  let step = state().step;
  await server.handleTelegramCallback(cb(CHAT_X, `act:mine:${step}`));
  assert(state().state === "main_menu" && state().step > step, "My invoices keeps main_menu and re-arms (step bumped)");
  step = state().step;
  await server.handleTelegramCallback(cb(CHAT_X, `act:chatid:${step}`));
  assert(state().state === "main_menu" && state().step > step, "Show chat ID keeps main_menu and re-arms (step bumped)");
}

async function main() {
  const baks = [LINK_PATH, SESSION_PATH, INVOICE_PATH].map((p) => [p, snapshot(p)]);
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
