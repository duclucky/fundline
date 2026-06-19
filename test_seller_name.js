// Integration test for the persistent per-wallet merchant display name.
//
// Rules under test:
//   1. The first invoice that carries a real name establishes the seller's name.
//   2. Once set, that name wins for every later invoice (a later invoice cannot rename).
//   3. The public GET /api/sellers/:wallet returns the established name.
//   4. The authenticated settings PUT can change the name (the only way to change it).
//   5. A first invoice with no name (default "Fundline merchant") does NOT establish a name.
//
// Run: node test_seller_name.js  (starts server.js on a private port, restores data/ after)

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const SELLER_PATH = path.join(DATA_DIR, "sellers.json");
const INVOICE_PATH = path.join(DATA_DIR, "invoices.json");
const PORT = 5199;
const BASE = `http://127.0.0.1:${PORT}`;

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${BASE}/api/config`);
      if (r.status) return true;
    } catch {}
    await sleep(150);
  }
  return false;
}

async function postInvoice(merchantWallet, merchantName) {
  const body = { merchantWallet, items: [{ description: "Test item", quantity: 1, unitPrice: 10 }], total: 10 };
  if (merchantName !== undefined) body.merchantName = merchantName;
  const r = await fetch(`${BASE}/api/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function getSeller(wallet) {
  const r = await fetch(`${BASE}/api/sellers/${wallet}`);
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function putName(wallet, privateKey, displayName) {
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
  const r = await fetch(`${BASE}/api/dashboard/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-fundline-wallet": wallet,
      "x-fundline-signature": signature,
      "x-fundline-issued-at": issuedAt,
    },
    body: JSON.stringify({ displayName }),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}

async function runAssertions() {
  const w1 = Wallet.createRandom();
  const w2 = Wallet.createRandom();

  // 1. First invoice establishes the name.
  let res = await postInvoice(w1.address, "Alice Studio");
  assert(res.status === 201, "first invoice created");
  assert(res.json.invoice && res.json.invoice.merchantName === "Alice Studio", "first invoice keeps the supplied name");

  // 3. Public endpoint returns the established name.
  let seller = await getSeller(w1.address);
  assert(seller.status === 200, "GET /api/sellers/:wallet responds 200");
  assert(seller.json.displayName === "Alice Studio", "seller profile shows established name");

  // 2. A later invoice with a different name cannot rename the seller.
  res = await postInvoice(w1.address, "Hacker Rename");
  assert(res.json.invoice && res.json.invoice.merchantName === "Alice Studio", "later invoice cannot override the established name");
  seller = await getSeller(w1.address);
  assert(seller.json.displayName === "Alice Studio", "seller name unchanged after rename attempt");

  // A later invoice with no name still uses the established name.
  res = await postInvoice(w1.address, undefined);
  assert(res.json.invoice && res.json.invoice.merchantName === "Alice Studio", "nameless later invoice inherits established name");

  // 4. Settings PUT (authenticated) is the only way to change the name.
  const put = await putName(w1.address, w1.privateKey, "Alice Co");
  assert(put.status === 200, "authenticated settings PUT succeeds");
  assert(put.json.settings && put.json.settings.displayName === "Alice Co", "settings PUT stores the new name");
  seller = await getSeller(w1.address);
  assert(seller.json.displayName === "Alice Co", "seller name updated via settings");
  res = await postInvoice(w1.address, "ignored");
  assert(res.json.invoice && res.json.invoice.merchantName === "Alice Co", "invoices follow the settings-updated name");

  // 5. A first invoice with no real name does not establish a name.
  res = await postInvoice(w2.address, undefined);
  assert(res.json.invoice && res.json.invoice.merchantName === "Fundline merchant", "nameless first invoice falls back to default");
  seller = await getSeller(w2.address);
  assert(seller.json.displayName === "", "default name does not establish a seller name");

  // Then a real name on a later invoice establishes it.
  res = await postInvoice(w2.address, "Bob LLC");
  assert(res.json.invoice && res.json.invoice.merchantName === "Bob LLC", "later real name establishes the seller name");
  seller = await getSeller(w2.address);
  assert(seller.json.displayName === "Bob LLC", "seller name established on first real name");
}

async function main() {
  const sellerBak = snapshot(SELLER_PATH);
  const invoiceBak = snapshot(INVOICE_PATH);

  const child = spawn("node", ["server.js"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), HOST: "127.0.0.1" },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  try {
    const up = await waitForServer();
    if (!up) {
      console.error("Server did not start. stderr:\n" + stderr);
      process.exitCode = 1;
      return;
    }
    await runAssertions();
  } catch (err) {
    console.error("Test threw:", err);
    failed++;
  } finally {
    child.kill();
    await sleep(300);
    restore(SELLER_PATH, sellerBak);
    restore(INVOICE_PATH, invoiceBak);
  }

  console.log(`\n${passed} passed, ${failed} failed`);
  process.exitCode = failed === 0 ? 0 : 1;
}

main();
