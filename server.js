const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { ethers } = require("ethers");

const PORT = Number(process.env.PORT || 5190);
const ROOT = __dirname;
loadEnvFiles();

const DATA_DIR = path.join(ROOT, "data");
const INVOICE_DB_PATH = path.join(DATA_DIR, "invoices.json");
const WEBHOOK_DB_PATH = path.join(DATA_DIR, "webhooks.json");
const PRODUCT_DB_PATH = path.join(DATA_DIR, "products.json");
const WEBHOOK_LOG_DB_PATH = path.join(DATA_DIR, "webhook-logs.json");
const PAYMENT_ATTEMPT_DB_PATH = path.join(DATA_DIR, "payment-attempts.json");
const SELLER_DB_PATH = path.join(DATA_DIR, "sellers.json");
const DISPATCHED_WEBHOOKS_PATH = path.join(DATA_DIR, "dispatched_webhooks.json");
const API_KEY_DB_PATH = path.join(DATA_DIR, "api-keys.json");
const EVENT_DB_PATH = path.join(DATA_DIR, "events.json");
const TELEGRAM_LINK_DB_PATH = path.join(DATA_DIR, "telegram-links.json");
const TELEGRAM_SESSION_DB_PATH = path.join(DATA_DIR, "telegram-sessions.json");

const AGENT_RATE_LIMIT_PER_MIN = Number(process.env.AGENT_RATE_LIMIT_PER_MIN || 60);
const rateLimits = new Map();

function checkRateLimit(req, res, identifier) {
  console.log("AGENT_RATE_LIMIT_PER_MIN:", AGENT_RATE_LIMIT_PER_MIN, typeof AGENT_RATE_LIMIT_PER_MIN);
  const now = Date.now();
  const windowStart = now - 60000;
  if (!rateLimits.has(identifier)) rateLimits.set(identifier, []);
  const timestamps = rateLimits.get(identifier).filter(t => t > windowStart);
  if (timestamps.length >= AGENT_RATE_LIMIT_PER_MIN) {
    res.setHeader("Retry-After", "60");
    sendJson(res, 429, { error: { code: "RATE_LIMITED", message: "Too many requests, please try again later" } });
    rateLimits.set(identifier, timestamps);
    return false;
  }
  timestamps.push(now);
  rateLimits.set(identifier, timestamps);
  return true;
}

let dispatchedEventIds = new Set();
try {
  if (fs.existsSync(DISPATCHED_WEBHOOKS_PATH)) {
    const data = JSON.parse(fs.readFileSync(DISPATCHED_WEBHOOKS_PATH, "utf8"));
    if (Array.isArray(data)) dispatchedEventIds = new Set(data);
  }
} catch (e) {}

function saveDispatchedEventIds() {
  fs.writeFileSync(DISPATCHED_WEBHOOKS_PATH, JSON.stringify(Array.from(dispatchedEventIds)));
}

const ARCSCAN_API_BASE = process.env.ARCSCAN_API_BASE || "https://testnet.arcscan.app/api/v2";
const ARCSCAN_EXPLORER_BASE = process.env.ARCSCAN_EXPLORER_BASE || "https://testnet.arcscan.app";
const ARC_USDC_TOKEN_ADDRESS = normalizeAddress(process.env.ARC_USDC_TOKEN_ADDRESS || "0x3600000000000000000000000000000000000000");
const ARC_NATIVE_USDC_DECIMALS = Number(process.env.ARC_NATIVE_USDC_DECIMALS || 18);
const ARC_USDC_DECIMALS = Number(process.env.ARC_USDC_DECIMALS || 6);
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ARC_NETWORK_NAME = process.env.ARC_NETWORK_NAME || "Arc Testnet";
const ARC_PAYMENT_ROUTER_ADDRESS = normalizeAddress(process.env.ARC_PAYMENT_ROUTER_ADDRESS || "");
const TELEGRAM_LONG_POLL_SECONDS = getTelegramLongPollSeconds();
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INVOICE_PAID_TOPIC = "0x3c732fcd5451057e3d8cb6784128fcc1db83ea499c9d5e0141f37aee34d328db";
// Arc Transaction Memos (read-only reconciliation). Memo contract is predeployed on Arc.
const MEMO_CONTRACT_ADDRESS = "0x5294E9927c3306DcBaDb03fe70b92e01cCede505";
const MEMO_EVENT_TOPIC = "0xeb15ee720798341c37739df41be53acfbbf70ae6802dade35457beec6e47a5e4";

const CIRCLE_GATEWAY_API_KEY = String(process.env.CIRCLE_GATEWAY_API_KEY || "").trim();
// Public Reown (WalletConnect) project id. A public client key, not a secret;
// the WalletConnect QR login option is hidden in the UI until this is set.
const WALLETCONNECT_PROJECT_ID = String(process.env.REOWN_PROJECT_ID || process.env.WALLETCONNECT_PROJECT_ID || "").trim();
const GATEWAY_API_BASE = "https://gateway-api-testnet.circle.com/v1";
const GATEWAY_WALLET_ADDRESS = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER_ADDRESS = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

let telegramPollTimer = null;
let telegramPollBusy = false;
let telegramPollStarted = false;
let telegramUpdateOffset = 0;
let telegramCommandsReady = false;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sol": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname === "/api/config") {
    handlePublicConfig(req, res);
    return;
  }

  if (url.pathname === "/api/agent/invoices") {
    handleAgentInvoices(req, res, url);
    return;
  }

  const agentInvoiceMatch = url.pathname.match(/^\/api\/agent\/invoices\/([a-f0-9]{20})$/i);
  if (agentInvoiceMatch) {
    handleAgentInvoiceById(req, res, agentInvoiceMatch[1]);
    return;
  }

  
  if (url.pathname === "/api/agent/events") {
    handleAgentEvents(req, res, url);
    return;
  }
  if (url.pathname === "/api/agent/webhooks/test") {
    handleAgentWebhooksTest(req, res);
    return;
  }
  const verifyMatch = url.pathname.match(/^\/api\/agent\/invoices\/([a-f0-9]{20})\/verify$/i);
  if (verifyMatch) {
    handleAgentVerify(req, res, verifyMatch[1]);
    return;
  }
  const x402Match = url.pathname.match(/^\/api\/x402\/invoices\/([a-f0-9]{20})$/i);
  if (x402Match) {
    handleX402Invoice(req, res, x402Match[1]);
    return;
  }

  if (url.pathname === "/api/agent/webhooks") {
    handleAgentWebhooks(req, res, url);
    return;
  }

  if (url.pathname === "/api/agent/webhook-logs") {
    handleAgentWebhookLogs(req, res, url);
    return;
  }

  const agentWebhookLogMatch = url.pathname.match(/^\/api\/agent\/webhook-logs\/([a-f0-9]{20})$/i);
  if (agentWebhookLogMatch) {
    handleAgentWebhookLogById(req, res, agentWebhookLogMatch[1]);
    return;
  }

  const agentWebhookMatch = url.pathname.match(/^\/api\/agent\/webhooks\/([a-f0-9]{20})$/i);
  if (agentWebhookMatch) {
    handleAgentWebhookById(req, res, agentWebhookMatch[1]);
    return;
  }

  if (url.pathname === "/api/invoices") {
    handleInvoices(req, res, url);
    return;
  }

  const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([a-f0-9]{20})$/i);
  if (invoiceMatch) {
    handleInvoiceById(req, res, invoiceMatch[1]);
    return;
  }

  if (url.pathname === "/api/arcscan/verify-payment") {
    handleVerifyPayment(req, res);
    return;
  }

  if (url.pathname === "/api/dashboard/summary") {
    handleDashboardSummary(req, res);
    return;
  }

  if (url.pathname === "/api/dashboard/settings") {
    handleDashboardSettings(req, res);
    return;
  }

  const sellerProfileMatch = url.pathname.match(/^\/api\/sellers\/(0x[a-fA-F0-9]{40})$/);
  if (sellerProfileMatch) {
    handleSellerProfile(req, res, sellerProfileMatch[1]);
    return;
  }

  if (url.pathname === "/api/dashboard/webhooks") {
    handleDashboardWebhooks(req, res);
    return;
  }

  const sellerWebhookMatch = url.pathname.match(/^\/api\/dashboard\/webhooks\/([a-f0-9]{20})$/i);
  if (sellerWebhookMatch) {
    handleDashboardWebhookById(req, res, sellerWebhookMatch[1]);
    return;
  }

  if (url.pathname === "/api/dashboard/webhook-logs") {
    handleDashboardWebhookLogs(req, res);
    return;
  }

  const sellerWebhookLogResendMatch = url.pathname.match(/^\/api\/dashboard\/webhook-logs\/([a-f0-9]{20})\/resend$/i);
  if (sellerWebhookLogResendMatch) {
    handleDashboardWebhookLogResend(req, res, sellerWebhookLogResendMatch[1]);
    return;
  }


  if (url.pathname === "/api/products") {
    handleProducts(req, res, url);
    return;
  }

  const productMatch = url.pathname.match(/^\/api\/products\/([^\/]+)$/i);
  if (productMatch) {
    handleProductById(req, res, productMatch[1]);
    return;
  }

  if (url.pathname === "/api/telegram/payment-paid") {
    handleTelegramPayment(req, res);
    return;
  }

  if (url.pathname === "/api/telegram/verify-alert") {
    handleTelegramVerifyAlert(req, res);
    return;
  }

  if (url.pathname === "/api/gateway/balance") {
    handleGatewayBalance(req, res);
    return;
  }

  if (url.pathname === "/api/gateway/estimate") {
    handleGatewayEstimate(req, res);
    return;
  }

  if (url.pathname === "/api/gateway/transfer") {
    handleGatewayTransfer(req, res);
    return;
  }

  const gatewayStatusMatch = url.pathname.match(/^\/api\/gateway\/transfer\/([^/]+)$/);
  if (gatewayStatusMatch) {
    handleGatewayStatus(req, res, gatewayStatusMatch[1]);
    return;
  }

  const memoReconcileMatch = url.pathname.match(/^\/api\/memo\/reconcile\/(0x[0-9a-fA-F]{64})$/);
  if (memoReconcileMatch) {
    handleMemoReconcile(req, res, memoReconcileMatch[1]);
    return;
  }

  const requested = resolveRequestPath(url.pathname);
  const filePath = path.normalize(path.join(ROOT, requested));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }

    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(content);
  });
});

function resolveRequestPath(pathname) {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "/dashboard.html";
  if (pathname.startsWith("/s/")) return "/storefront.html";
  if (pathname === "/docs") return "/docs.html";
  if (pathname === "/") return "/index.html";
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/pay/")) return "/app.html";
  return pathname;
}

const HOST = process.env.HOST || "0.0.0.0";

// Start the server unless explicitly suppressed. Tests require this module and
// set FUNDLINE_NO_LISTEN to get the exported functions without booting the
// server or the bot. Do NOT gate on require.main === module: under cPanel /
// Phusion Passenger the app is require()d by the Passenger loader (so
// require.main !== module), and gating on it would skip server.listen and the
// app would never bind, returning 503.
if (!process.env.FUNDLINE_NO_LISTEN) {
  server.listen(PORT, HOST, () => {
    console.log(`Fundline running at http://${HOST}:${PORT}`);
    startTelegramPolling();
    startOverdueJob();
  });
}

module.exports = {
  normalizeAddress,
  loadSellerDb,
  saveSellerDb,
  loadInvoiceDb,
  saveInvoiceDb,
  loadTelegramLinkDb,
  saveTelegramLinkDb,
  resolveWalletByChatId,
  claimTelegramChatId,
  activateTelegramLink,
  seedTelegramLinksFromSellers,
  loadTelegramSessionDb,
  saveTelegramSessionDb,
  getTelegramSession,
  setTelegramSession,
  clearTelegramSession,
  parseTelegramAmount,
  createInvoiceRecord,
  buildMyInvoicesText,
  botInvoiceStatus,
  handleTelegramText,
  handleTelegramCallback,
  findMatchingTokenTransfer,
  findMatchingNativeTransaction,
  amountToUnits,
  TELEGRAM_LINK_DB_PATH,
  TELEGRAM_SESSION_DB_PATH,
  SELLER_DB_PATH,
  INVOICE_DB_PATH,
};

function loadEnvFiles() {
  [
    path.join(ROOT, ".env"),
    path.join(ROOT, "fundline.env"),
    path.resolve(ROOT, "..", "..", "fundline.env"),
    path.resolve(ROOT, "..", "..", "telegram.env"),
  ].forEach((filePath) => {
    if (!fs.existsSync(filePath)) return;
    const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
    lines.forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return;
      const separator = trimmed.indexOf("=");
      if (separator <= 0) return;
      const key = trimmed.slice(0, separator).trim();
      const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    });
  });
}

function handlePublicConfig(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  sendJson(res, 200, {
    networkName: ARC_NETWORK_NAME,
    chainId: ARC_CHAIN_ID,
    chainIdHex: toRpcQuantity(ARC_CHAIN_ID),
    rpcUrl: ARC_RPC_URL,
    explorerBase: ARCSCAN_EXPLORER_BASE,
    usdcTokenAddress: ARC_USDC_TOKEN_ADDRESS,
    usdcDecimals: ARC_USDC_DECIMALS,
    nativeUsdcDecimals: ARC_NATIVE_USDC_DECIMALS,
    paymentRouterAddress: ARC_PAYMENT_ROUTER_ADDRESS,
    onchainPaymentsEnabled: Boolean(ARC_PAYMENT_ROUTER_ADDRESS && ARC_USDC_TOKEN_ADDRESS),
    gatewayWalletAddress: GATEWAY_WALLET_ADDRESS,
    gatewayMinterAddress: GATEWAY_MINTER_ADDRESS,
    gatewayEnabled: Boolean(CIRCLE_GATEWAY_API_KEY),
    walletConnectProjectId: WALLETCONNECT_PROJECT_ID,
  });
}

// Shared invoice-creation core used by both POST /api/invoices and the Telegram
// bot. Generates ids if missing, runs the canonical normalizeInvoice, applies the
// per-wallet seller-name first-write model, rejects duplicate ids (throws with
// code DUPLICATE_ID), prepends, and persists. Returns the created invoice. The
// bot passes a trusted merchantWallet; this function never derives merchantWallet
// beyond what normalizeInvoice validates.
function createInvoiceRecord(input) {
  if (!input.id) input.id = makeId();
  if (!input.onchainInvoiceId && !input.onchain_invoice_id) input.onchainInvoiceId = randomBytes32();
  const invoice = normalizeInvoice(input);
  const sellerDb = loadSellerDb();
  const sellerKey = invoice.merchantWallet;
  const seller = sellerDb.sellers[sellerKey];
  const establishedName = String(seller?.displayName || "").trim();
  if (establishedName) {
    invoice.merchantName = establishedName;
  } else if (invoice.merchantName && invoice.merchantName !== "Fundline merchant") {
    sellerDb.sellers[sellerKey] = {
      wallet: sellerKey,
      displayName: invoice.merchantName.slice(0, 120),
      telegramChatId: seller?.telegramChatId || "",
      alerts: seller?.alerts || { paid: true, failed: true, overdue: true },
    };
    saveSellerDb(sellerDb);
  }
  const db = loadInvoiceDb();
  if (db.invoices.some((item) => item.id === invoice.id)) {
    const error = new Error("Invoice ID already exists");
    error.code = "DUPLICATE_ID";
    throw error;
  }
  db.invoices = [invoice, ...db.invoices];
  saveInvoiceDb(db);
  return invoice;
}

async function handleInvoices(req, res, url) {
  if (req.method === "GET") {
    const merchantWallet = normalizeAddress(url.searchParams.get("merchantWallet"));
    const db = loadInvoiceDb();
    const invoices = merchantWallet ? db.invoices.filter((invoice) => sameAddress(invoice.merchantWallet, merchantWallet)) : db.invoices;
    sendJson(res, 200, { invoices });
    return;
  }

  if (req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      const invoice = createInvoiceRecord(input);
      sendJson(res, 201, { invoice });
    } catch (error) {
      if (error.code === "DUPLICATE_ID") {
        sendJson(res, 409, { error: "Invoice ID already exists" });
        return;
      }
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: error.message || "Could not create invoice" } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleAgentInvoices(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method === "GET") {
    let merchantWallet = normalizeAddress(url.searchParams.get("merchantWallet"));
    if (req.agentSellerId) {
      if (merchantWallet && !sameAddress(merchantWallet, req.agentSellerId)) {
        merchantWallet = "0x0000000000000000000000000000000000000000"; // Force empty result
      } else {
        merchantWallet = req.agentSellerId;
      }
    }

    const status = String(url.searchParams.get("status") || "").trim().toLowerCase();
    const limit = clampListLimit(url.searchParams.get("limit"), 100, 500);
    const db = loadInvoiceDb();
    let invoices = merchantWallet ? db.invoices.filter((invoice) => sameAddress(invoice.merchantWallet, merchantWallet)) : db.invoices;
    if (["open", "verifying", "paid"].includes(status)) invoices = invoices.filter((invoice) => invoice.status === status);
    sendJson(res, 200, { invoices: invoices.slice(0, limit).map((invoice) => decorateInvoiceForAgent(invoice, req)) });
    return;
  }

  if (req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      let merchantWallet = normalizeAddress(input.merchantWallet);
      if (req.agentSellerId) merchantWallet = req.agentSellerId;
      if (!merchantWallet) throw new Error("merchantWallet is required");
      
      const db = loadInvoiceDb();
      const idempotencyKey = getAgentIdempotencyKey(req, input);
      if (idempotencyKey) {
        const existing = db.invoices.find((invoice) => sameAddress(invoice.merchantWallet, merchantWallet) && invoice.idempotencyKey === idempotencyKey);
        if (existing) {
          sendJson(res, 200, { invoice: decorateInvoiceForAgent(existing, req), idempotent: true });
          return;
        }
      }
      
      const invoice = normalizeAgentInvoice({ ...input, idempotencyKey, merchantWallet }, db);
      // Ensure IDs are set if missing
      if (!invoice.id) invoice.id = makeId(20);
      if (!invoice.onchainInvoiceId) invoice.onchainInvoiceId = randomBytes32();
      
      db.invoices = [invoice, ...db.invoices];
      saveInvoiceDb(db);
      sendJson(res, 201, { invoice: decorateInvoiceForAgent(invoice, req) });
    } catch (error) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: error.message || "Could not create invoice" } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleAgentInvoiceById(req, res, invoiceId) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method !== "GET" && req.method !== "PATCH" && req.method !== "DELETE") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  const db = loadInvoiceDb();
  const index = db.invoices.findIndex((item) => item.id === invoiceId);
  const invoice = index >= 0 ? db.invoices[index] : null;
  if (!invoice) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
    return;
  }

  if (req.agentSellerId && !sameAddress(invoice.merchantWallet, req.agentSellerId)) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { invoice: decorateInvoiceForAgent(invoice, req) });
    return;
  }
  
  if (req.method === "PATCH") {
    try {
      const input = await readJsonBody(req);
      const patched = normalizeInvoicePatch(invoice, input);
      db.invoices[index] = patched;
      saveInvoiceDb(db);
      sendJson(res, 200, { invoice: decorateInvoiceForAgent(patched, req) });
    } catch (error) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invalid patch" } });
    }
    return;
  }

  if (req.method === "DELETE") {
    db.invoices.splice(index, 1);
    saveInvoiceDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }
}

async function handleInvoiceById(req, res, invoiceId) {
  const db = loadInvoiceDb();
  const index = db.invoices.findIndex((invoice) => invoice.id === invoiceId);
  const invoice = index >= 0 ? db.invoices[index] : null;

  if (req.method === "GET") {
    if (!invoice) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
      return;
    }
    sendJson(res, 200, { invoice });
    return;
  }

  if (req.method === "PATCH") {
    if (!invoice) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
      return;
    }
    try {
      const patch = await readJsonBody(req);
      const requestedStatus = String(patch.status || "").trim().toLowerCase();
      if (requestedStatus === "paid" && invoice.status !== "paid") {
        sendJson(res, 409, { error: "Paid status can only be set by verified on-chain payment" });
        return;
      }
      if (invoice.status === "paid" && requestedStatus && requestedStatus !== "paid") {
        sendJson(res, 409, { error: "Paid invoices cannot be reopened from the client" });
        return;
      }
      const updated = normalizeInvoicePatch(invoice, patch);
      db.invoices[index] = updated;
      saveInvoiceDb(db);
      if (invoice.status !== "paid" && updated.status === "paid") {
        dispatchInvoiceTelegramAlert(updated, "invoice.paid").catch(console.error);
        dispatchInvoiceWebhooks(updated, "invoice.paid", req).catch((error) => {
          console.log(`Webhook dispatch failed: ${error.message || "Unknown error"}`);
        });
      }
      sendJson(res, 200, { invoice: updated });
    } catch (error) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: error.message || "Could not update invoice" } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleAgentWebhooks(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method === "GET") {
    const db = loadWebhookDb();
    let webhooks = db.webhooks;
    if (req.agentSellerId) webhooks = webhooks.filter(w => sameAddress(w.merchantWallet, req.agentSellerId));
    sendJson(res, 200, { webhooks });
    return;
  }

  if (req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      const db = loadWebhookDb();
      let merchantWallet = normalizeAddress(input.merchantWallet);
      if (req.agentSellerId) merchantWallet = req.agentSellerId;
      if (!merchantWallet) throw new Error("merchantWallet is required");
      
      const webhook = {
        id: makeId(20),
        merchantWallet,
        url: String(input.url || "").trim(),
        event: String(input.event || "").trim() || "*",
        secret: String(input.secret || "").trim() || crypto.randomBytes(32).toString("hex"),
        enabled: input.enabled !== false,
        createdAt: new Date().toISOString()
      };
      db.webhooks.push(webhook);
      saveWebhookDb(db);
      sendJson(res, 201, { webhook });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message || "Invalid webhook" } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleAgentWebhookById(req, res, webhookId) {
  if (!requireAgentApiKey(req, res)) return;

  const db = loadWebhookDb();
  const webhookIndex = db.webhooks.findIndex((item) => item.id === webhookId);
  const webhook = webhookIndex >= 0 ? db.webhooks[webhookIndex] : null;

  if (req.method === "GET") {
    if (!webhook) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Webhook not found" } });
      return;
    }
    sendJson(res, 200, { webhook: redactWebhook(webhook) });
    return;
  }

  if (req.method === "PATCH") {
    if (!webhook) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Webhook not found" } });
      return;
    }
    try {
      const patch = await readJsonBody(req);
      const updated = normalizeWebhookPatch(webhook, patch);
      db.webhooks[webhookIndex] = updated;
      saveWebhookDb(db);
      sendJson(res, 200, { webhook: redactWebhook(updated) });
    } catch (error) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: error.message || "Could not update webhook" } });
    }
    return;
  }

  if (req.method === "DELETE") {
    if (!webhook) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Webhook not found" } });
      return;
    }
    db.webhooks = db.webhooks.filter((item) => item.id !== webhookId);
    saveWebhookDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleAgentWebhookLogs(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  const merchantWallet = normalizeAddress(url.searchParams.get("merchantWallet"));
  const webhookId = String(url.searchParams.get("webhookId") || "").trim().toLowerCase();
  const invoiceId = String(url.searchParams.get("invoiceId") || "").trim().toLowerCase();
  const event = String(url.searchParams.get("event") || "").trim();
  const ok = String(url.searchParams.get("ok") || "").trim().toLowerCase();
  const limit = clampListLimit(url.searchParams.get("limit"), 100, 500);

  let logs = loadWebhookLogDb().logs;
  if (merchantWallet) logs = logs.filter((log) => sameAddress(log.merchantWallet, merchantWallet));
  if (/^[a-f0-9]{20}$/i.test(webhookId)) logs = logs.filter((log) => log.webhookId === webhookId);
  if (/^[a-f0-9]{20}$/i.test(invoiceId)) logs = logs.filter((log) => log.invoiceId === invoiceId);
  if (event) logs = logs.filter((log) => log.event === event);
  if (ok === "true" || ok === "false") logs = logs.filter((log) => log.ok === (ok === "true"));

  sendJson(res, 200, { logs: logs.slice(0, limit).map(redactWebhookLog) });
}

async function handleAgentWebhookLogById(req, res, logId) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  const log = loadWebhookLogDb().logs.find((item) => item.id === logId);
  if (!log) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Webhook log not found" } });
    return;
  }

  sendJson(res, 200, { log: redactWebhookLog(log) });
}

function loadInvoiceDb() {
  ensureDataDir();
  if (!fs.existsSync(INVOICE_DB_PATH)) return { invoices: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(INVOICE_DB_PATH, "utf8"));
    return { invoices: Array.isArray(parsed.invoices) ? parsed.invoices.map(normalizeStoredInvoice).filter(Boolean) : [] };
  } catch {
    return { invoices: [] };
  }
}

function saveInvoiceDb(db) {
  ensureDataDir();
  fs.writeFileSync(INVOICE_DB_PATH, `${JSON.stringify({ invoices: db.invoices || [] }, null, 2)}\n`);
}

function loadApiKeyDb() {
  ensureDataDir();
  if (!fs.existsSync(API_KEY_DB_PATH)) return { apiKeys: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(API_KEY_DB_PATH, "utf8"));
    return { apiKeys: Array.isArray(parsed.apiKeys) ? parsed.apiKeys : [] };
  } catch {
    return { apiKeys: [] };
  }
}

function saveApiKeyDb(db) {
  fs.writeFileSync(API_KEY_DB_PATH, JSON.stringify(db, null, 2));
}

function loadEventDb() {
  ensureDataDir();
  if (!fs.existsSync(EVENT_DB_PATH)) return { events: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(EVENT_DB_PATH, "utf8"));
    return { events: Array.isArray(parsed.events) ? parsed.events : [] };
  } catch {
    return { events: [] };
  }
}

function saveEventDb(db) {
  fs.writeFileSync(EVENT_DB_PATH, JSON.stringify(db, null, 2));
}
function loadSellerDb() {
  ensureDataDir();
  if (!fs.existsSync(SELLER_DB_PATH)) return { sellers: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(SELLER_DB_PATH, "utf8"));
    return { sellers: typeof parsed.sellers === "object" && parsed.sellers !== null ? parsed.sellers : {} };
  } catch {
    return { sellers: {} };
  }
}

function saveSellerDb(db) {
  ensureDataDir();
  fs.writeFileSync(SELLER_DB_PATH, `${JSON.stringify({ sellers: db.sellers || {} }, null, 2)}\n`);
}

// Reverse index from a Telegram chatId to a merchant wallet. A link is created
// "pending" by the authenticated settings write and only becomes "active" when
// that chat sends /start, so a chatId pasted into settings cannot resolve to a
// wallet until the real chat owner confirms it.
function loadTelegramLinkDb() {
  ensureDataDir();
  if (!fs.existsSync(TELEGRAM_LINK_DB_PATH)) return { links: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(TELEGRAM_LINK_DB_PATH, "utf8"));
    return { links: typeof parsed.links === "object" && parsed.links !== null ? parsed.links : {} };
  } catch {
    return { links: {} };
  }
}

function saveTelegramLinkDb(db) {
  ensureDataDir();
  fs.writeFileSync(TELEGRAM_LINK_DB_PATH, `${JSON.stringify({ links: db.links || {} }, null, 2)}\n`);
}

// Resolve a chatId to its merchant wallet, ONLY when the link is active. Returns
// "" when the chat is unlinked or still pending confirmation.
function resolveWalletByChatId(chatId) {
  const key = String(chatId || "").trim();
  if (!key) return "";
  const link = loadTelegramLinkDb().links[key];
  if (!link || link.status !== "active") return "";
  return normalizeAddress(link.wallet) || "";
}

// Claim a 1:1 chatId<->wallet link from inside the signature-verified settings
// write. Enforces one chatId per wallet (drops any chatId this wallet held) and
// one wallet per chatId (steals the chatId from any other wallet and blanks that
// wallet's stored telegramChatId). The link starts "pending"; /start activates
// it. Mutates sellerDb.sellers (caller saves it) and persists the link store.
function claimTelegramChatId(sellerDb, wallet, rawChatId) {
  const walletKey = normalizeAddress(wallet);
  const chatId = String(rawChatId || "").trim().slice(0, 64);
  const linkDb = loadTelegramLinkDb();

  for (const key of Object.keys(linkDb.links)) {
    if (normalizeAddress(linkDb.links[key].wallet) === walletKey) delete linkDb.links[key];
  }

  if (!chatId) {
    saveTelegramLinkDb(linkDb);
    return "";
  }

  const prior = linkDb.links[chatId];
  if (prior && normalizeAddress(prior.wallet) !== walletKey) {
    const priorWallet = normalizeAddress(prior.wallet);
    if (priorWallet && sellerDb.sellers[priorWallet]) sellerDb.sellers[priorWallet].telegramChatId = "";
  }

  const now = new Date().toISOString();
  linkDb.links[chatId] = { wallet: walletKey, status: "pending", linkedAt: now, confirmedAt: "", lastSeenAt: "" };
  saveTelegramLinkDb(linkDb);
  return chatId;
}

// One-time, idempotent migration. Merchants who set telegramChatId before the
// link store existed have no link entry, so /start would bounce them to setup.
// Seed those chatIds as "pending" so a single /start activates them (no need to
// re-paste). Skips chatIds already in the store and resolves duplicate chatIds
// across wallets by first-seen-wins (the loser keeps its stored chatId for
// alerts but gets no bot link).
function seedTelegramLinksFromSellers() {
  const sellerDb = loadSellerDb();
  const linkDb = loadTelegramLinkDb();
  let added = 0;
  let dropped = 0;
  for (const [wallet, seller] of Object.entries(sellerDb.sellers)) {
    const chatId = String((seller && seller.telegramChatId) || "").trim().slice(0, 64);
    if (!chatId) continue;
    if (linkDb.links[chatId]) {
      if (normalizeAddress(linkDb.links[chatId].wallet) !== normalizeAddress(wallet)) dropped += 1;
      continue;
    }
    linkDb.links[chatId] = { wallet: normalizeAddress(wallet), status: "pending", linkedAt: new Date().toISOString(), confirmedAt: "", lastSeenAt: "" };
    added += 1;
  }
  if (added || dropped) {
    saveTelegramLinkDb(linkDb);
    console.log(`Telegram links: seeded ${added} pending from sellers, ${dropped} duplicate chatId(s) skipped`);
  }
  return { added, dropped };
}

// Ephemeral per-chat conversation state for the create-invoice flow. This is a
// cursor, NOT a source of truth: invoices live in invoices.json and the
// chat<->wallet binding lives in the link store, so losing this file only drops
// in-progress drafts.
function getTelegramSessionTtlMs() {
  const n = Number(process.env.TELEGRAM_SESSION_TTL_MS || 0);
  return Number.isFinite(n) && n >= 60000 ? n : 30 * 60 * 1000;
}

function loadTelegramSessionDb() {
  ensureDataDir();
  if (!fs.existsSync(TELEGRAM_SESSION_DB_PATH)) return { sessions: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(TELEGRAM_SESSION_DB_PATH, "utf8"));
    const sessions = typeof parsed.sessions === "object" && parsed.sessions !== null ? parsed.sessions : {};
    const now = Date.now();
    for (const key of Object.keys(sessions)) {
      const exp = new Date(sessions[key].expiresAt || 0).getTime();
      if (!Number.isFinite(exp) || exp < now) delete sessions[key];
    }
    return { sessions };
  } catch {
    return { sessions: {} };
  }
}

function saveTelegramSessionDb(db) {
  ensureDataDir();
  fs.writeFileSync(TELEGRAM_SESSION_DB_PATH, `${JSON.stringify({ sessions: db.sessions || {} }, null, 2)}\n`);
}

function getTelegramSession(chatId) {
  const db = loadTelegramSessionDb();
  return db.sessions[String(chatId)] || null;
}

function setTelegramSession(chatId, session) {
  const db = loadTelegramSessionDb();
  const now = Date.now();
  session.updatedAt = new Date(now).toISOString();
  session.expiresAt = new Date(now + getTelegramSessionTtlMs()).toISOString();
  db.sessions[String(chatId)] = session;
  saveTelegramSessionDb(db);
  return session;
}

function clearTelegramSession(chatId) {
  const db = loadTelegramSessionDb();
  delete db.sessions[String(chatId)];
  saveTelegramSessionDb(db);
}

function loadWebhookDb() {
  ensureDataDir();
  if (!fs.existsSync(WEBHOOK_DB_PATH)) return { webhooks: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(WEBHOOK_DB_PATH, "utf8"));
    return { webhooks: Array.isArray(parsed.webhooks) ? parsed.webhooks.map(normalizeStoredWebhook).filter(Boolean) : [] };
  } catch {
    return { webhooks: [] };
  }
}

function saveWebhookDb(db) {
  ensureDataDir();
  fs.writeFileSync(WEBHOOK_DB_PATH, `${JSON.stringify({ webhooks: db.webhooks || [] }, null, 2)}\n`);
}

function loadWebhookLogDb() {
  ensureDataDir();
  if (!fs.existsSync(WEBHOOK_LOG_DB_PATH)) return { logs: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(WEBHOOK_LOG_DB_PATH, "utf8"));
    return { logs: Array.isArray(parsed.logs) ? parsed.logs.map(normalizeStoredWebhookLog).filter(Boolean) : [] };
  } catch {
    return { logs: [] };
  }
}

function saveWebhookLogDb(db) {
  ensureDataDir();
  fs.writeFileSync(WEBHOOK_LOG_DB_PATH, `${JSON.stringify({ logs: db.logs || [] }, null, 2)}\n`);
}

function loadPaymentAttemptDb() {
  ensureDataDir();
  if (!fs.existsSync(PAYMENT_ATTEMPT_DB_PATH)) return { attempts: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(PAYMENT_ATTEMPT_DB_PATH, "utf8"));
    return { attempts: Array.isArray(parsed.attempts) ? parsed.attempts.map(normalizeStoredPaymentAttempt).filter(Boolean) : [] };
  } catch {
    return { attempts: [] };
  }
}

function savePaymentAttemptDb(db) {
  ensureDataDir();
  fs.writeFileSync(PAYMENT_ATTEMPT_DB_PATH, `${JSON.stringify({ attempts: db.attempts || [] }, null, 2)}\n`);
}

function appendWebhookLog(log) {
  const db = loadWebhookLogDb();
  db.logs = [normalizeWebhookLog(log), ...db.logs].slice(0, 500);
  saveWebhookLogDb(db);
}

function createPaymentAttempt(input) {
  const attempt = normalizePaymentAttempt({
    ...input,
    id: makeId(10),
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const db = loadPaymentAttemptDb();
  db.attempts = [attempt, ...db.attempts].slice(0, 1000);
  savePaymentAttemptDb(db);
  return attempt;
}

function updatePaymentAttempt(attemptId, patch) {
  const db = loadPaymentAttemptDb();
  const index = db.attempts.findIndex((attempt) => attempt.id === attemptId);
  if (index < 0) return null;
  const updated = normalizePaymentAttempt({
    ...db.attempts[index],
    ...patch,
    updatedAt: new Date().toISOString(),
  }, { allowExistingTimestamps: true });
  db.attempts[index] = updated;
  savePaymentAttemptDb(db);
  return updated;
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function normalizeStoredInvoice(invoice) {
  try {
    return normalizeInvoice(invoice, { allowExistingTimestamps: true });
  } catch {
    return null;
  }
}

function normalizeStoredWebhook(webhook) {
  try {
    return normalizeWebhook(webhook, { allowExistingTimestamps: true });
  } catch {
    return null;
  }
}

function normalizeStoredWebhookLog(log) {
  try {
    return normalizeWebhookLog(log, { allowExistingTimestamps: true });
  } catch {
    return null;
  }
}

function normalizeStoredPaymentAttempt(attempt) {
  try {
    return normalizePaymentAttempt(attempt, { allowExistingTimestamps: true });
  } catch {
    return null;
  }
}

function normalizeAgentInvoice(input, db) {
  const requestedId = String(input.id || "").trim().toLowerCase();
  let id = /^[a-f0-9]{20}$/i.test(requestedId) ? requestedId : makeId(10);
  while (db.invoices.some((invoice) => invoice.id === id)) id = makeId(10);

  return normalizeInvoice({
    ...input,
    id,
    number: String(input.number || "").trim() || nextInvoiceNumber(db.invoices),
    onchainInvoiceId: normalizeBytes32(input.onchainInvoiceId) || randomBytes32(),
    status: input.status || "open",
  });
}

function normalizeInvoice(input, options = {}) {
  const id = String(input.id || "").trim();
  if (!/^[a-f0-9]{20}$/i.test(id)) throw new Error("Invalid invoice ID");

  const merchantWallet = normalizeAddress(input.merchantWallet);
  if (!merchantWallet) throw new Error("Invalid merchant wallet");

  const items = Array.isArray(input.items)
    ? input.items
        .map((item) => ({
          description: String(item.description || "").trim().slice(0, 220),
          quantity: roundMoney(item.quantity),
          unitPrice: roundMoney(item.unitPrice),
          total: roundMoney(item.total || Number(item.quantity || 0) * Number(item.unitPrice || 0)),
        }))
        .filter((item) => item.description && item.quantity > 0 && item.unitPrice >= 0)
    : [];
  if (!items.length) throw new Error("Invoice needs at least one item");

  const total = roundMoney(input.total || items.reduce((sum, item) => sum + item.total, 0));
  // Reject non-finite or absurd totals. The upper bound is far above any real
  // invoice and well below the magnitude (>= 1e21) where Number.toString emits
  // exponential form, which the base-unit parser cannot read.
  if (!Number.isFinite(total) || total <= 0) throw new Error("Invoice total must be greater than 0");
  if (total > 1e12) throw new Error("Invoice total is too large");

  const status = ["open", "verifying", "paid"].includes(input.status) ? input.status : "open";
  const createdAt = options.allowExistingTimestamps && input.createdAt ? String(input.createdAt) : new Date().toISOString();

  let defaultDueDate = new Date(createdAt);
  defaultDueDate.setDate(defaultDueDate.getDate() + 7);
  const dueDate = String(input.dueDate || "").trim().slice(0, 24) || defaultDueDate.toISOString();

  return {
    id,
    number: String(input.number || "").trim().slice(0, 48) || `INV-${new Date().getFullYear()}-${id.slice(0, 6)}`,
    onchainInvoiceId: normalizeBytes32(input.onchainInvoiceId) || "",
    merchantName: String(input.merchantName || "Fundline merchant").trim().slice(0, 120),
    merchantWallet,
    telegramChatId: String(input.telegramChatId || "").trim().slice(0, 64),
    clientName: String(input.clientName || "").trim().slice(0, 160),
    clientEmail: String(input.clientEmail || "").trim().slice(0, 180),
    dueDate,
    note: String(input.note || "").trim().slice(0, 1000),
    items,
    total,
    status,
    createdAt,
    paidAt: String(input.paidAt || ""),
    payerWallet: normalizeAddress(input.payerWallet),
    txHash: normalizeTxHash(input.txHash),
    verifiedAt: String(input.verifiedAt || ""),
    verificationSource: String(input.verificationSource || "").trim().slice(0, 80),
    verifiedPayment: input.verifiedPayment && typeof input.verifiedPayment === "object" ? input.verifiedPayment : null,
    lastVerificationAt: String(input.lastVerificationAt || ""),
    idempotencyKey: normalizeIdempotencyKey(input.idempotencyKey),
    telegramPaidNotifiedAt: String(input.telegramPaidNotifiedAt || ""),
    telegramFailedNotifiedAt: String(input.telegramFailedNotifiedAt || ""),
    overdueNotifiedAt: String(input.overdueNotifiedAt || ""),
    webhookEventId: String(input.webhookEventId || "").trim().slice(0, 48),
  };
}

function normalizeWebhook(input, options = {}) {
  const requestedId = String(input.id || "").trim().toLowerCase();
  const id = /^[a-f0-9]{20}$/i.test(requestedId) ? requestedId : makeId(10);
  const merchantWallet = normalizeAddress(input.merchantWallet);
  if (!merchantWallet) throw new Error("Invalid merchant wallet");

  const event = String(input.event || "invoice.paid").trim();
  if (!["invoice.paid", "invoice.failed", "invoice.overdue", "*"].includes(event)) {
    throw new Error("Unsupported webhook event");
  }

  const url = normalizeWebhookUrl(input.url);
  const createdAt = options.allowExistingTimestamps && input.createdAt ? String(input.createdAt) : new Date().toISOString();

  return {
    id,
    merchantWallet,
    url,
    event,
    secret: String(input.secret || "").trim().slice(0, 160),
    enabled: input.enabled !== false,
    createdAt,
  };
}

function normalizeWebhookPatch(existing, patch) {
  return normalizeWebhook(
    {
      ...existing,
      url: patch.url ?? existing.url,
      event: patch.event ?? existing.event,
      secret: patch.secret ?? existing.secret,
      enabled: patch.enabled ?? existing.enabled,
    },
    { allowExistingTimestamps: true },
  );
}

function normalizeWebhookLog(input, options = {}) {
  const id = /^[a-f0-9]{20}$/i.test(String(input.id || "")) ? String(input.id).toLowerCase() : makeId(10);
  const createdAt = options.allowExistingTimestamps && input.createdAt ? String(input.createdAt) : new Date().toISOString();
  const statusCode = Number(input.statusCode);
  const durationMs = Number(input.durationMs);

  return {
    id,
    deliveryId: String(input.deliveryId || id).trim().slice(0, 80),
    webhookId: /^[a-f0-9]{20}$/i.test(String(input.webhookId || "")) ? String(input.webhookId).toLowerCase() : "",
    invoiceId: /^[a-f0-9]{20}$/i.test(String(input.invoiceId || "")) ? String(input.invoiceId).toLowerCase() : "",
    invoiceNumber: String(input.invoiceNumber || "").trim().slice(0, 48),
    merchantWallet: normalizeAddress(input.merchantWallet),
    event: String(input.event || "invoice.paid").trim().slice(0, 80),
    url: String(input.url || "").trim().slice(0, 500),
    ok: Boolean(input.ok),
    statusCode: Number.isFinite(statusCode) ? statusCode : null,
    error: String(input.error || "").trim().slice(0, 500),
    responseBodyPreview: String(input.responseBodyPreview || "").trim().slice(0, 500),
    durationMs: Number.isFinite(durationMs) ? Math.max(0, Math.round(durationMs)) : 0,
    createdAt,
  };
}

function normalizePaymentAttempt(input, options = {}) {
  const id = /^[a-f0-9]{20}$/i.test(String(input.id || "")) ? String(input.id).toLowerCase() : makeId(10);
  const invoiceId = /^[a-f0-9]{20}$/i.test(String(input.invoiceId || "")) ? String(input.invoiceId).toLowerCase() : "";
  if (!invoiceId) throw new Error("Invalid invoice ID");
  const amount = roundMoney(input.amount);
  if (amount <= 0) throw new Error("Invalid payment attempt amount");
  const status = ["pending", "verified", "failed"].includes(String(input.status || "").trim().toLowerCase())
    ? String(input.status).trim().toLowerCase()
    : "pending";
  const createdAt = options.allowExistingTimestamps && input.createdAt ? String(input.createdAt) : new Date().toISOString();
  const updatedAt = options.allowExistingTimestamps && input.updatedAt ? String(input.updatedAt) : createdAt;

  return {
    id,
    invoiceId,
    invoiceNumber: String(input.invoiceNumber || "").trim().slice(0, 48),
    chain: String(input.chain || ARC_NETWORK_NAME).trim().slice(0, 80),
    chainId: Number(input.chainId || ARC_CHAIN_ID),
    payerWallet: normalizeAddress(input.payerWallet),
    merchantWallet: normalizeAddress(input.merchantWallet),
    amount,
    tokenSymbol: String(input.tokenSymbol || "USDC").trim().slice(0, 20),
    tokenAddress: normalizeAddress(input.tokenAddress) || ARC_USDC_TOKEN_ADDRESS,
    onchainInvoiceId: normalizeBytes32(input.onchainInvoiceId),
    txHash: normalizeTxHash(input.txHash),
    status,
    error: String(input.error || "").trim().slice(0, 500),
    verifiedAt: String(input.verifiedAt || "").trim(),
    match: input.match && typeof input.match === "object" ? sanitizePaymentMatch(input.match) : null,
    createdAt,
    updatedAt,
  };
}

function sanitizePaymentMatch(input = {}) {
  return {
    source: String(input.source || "").trim().slice(0, 80),
    txHash: normalizeTxHash(input.txHash),
    explorerUrl: String(input.explorerUrl || "").trim().slice(0, 500),
    from: normalizeAddress(input.from),
    to: normalizeAddress(input.to),
    timestamp: String(input.timestamp || "").trim(),
    blockNumber: String(input.blockNumber || "").trim().slice(0, 80),
    tokenSymbol: String(input.tokenSymbol || "USDC").trim().slice(0, 20),
    tokenAddress: normalizeAddress(input.tokenAddress) || String(input.tokenAddress || "").trim().slice(0, 80),
    rawAmount: String(input.rawAmount || "").trim().slice(0, 120),
    onchainInvoiceId: normalizeBytes32(input.onchainInvoiceId),
    referenceVerified: Boolean(input.referenceVerified),
    transferVerified: Boolean(input.transferVerified),
    paymentAttemptId: /^[a-f0-9]{20}$/i.test(String(input.paymentAttemptId || "")) ? String(input.paymentAttemptId).toLowerCase() : "",
  };
}

function findTxHashPaymentOwner(invoices, txHash, excludeInvoiceId = "") {
  const normalized = normalizeTxHash(txHash);
  if (!normalized) return null;
  const excluded = String(excludeInvoiceId || "").toLowerCase();

  const ownerInvoice = (invoices || []).find((invoice) => {
    if (!invoice || invoice.id === excluded) return false;
    if (normalizeTxHash(invoice.txHash) === normalized) return true;
    return normalizeTxHash(invoice.verifiedPayment?.txHash) === normalized;
  });
  if (ownerInvoice) return ownerInvoice;

  const ownerAttempt = loadPaymentAttemptDb().attempts.find((attempt) => {
    if (!attempt || attempt.invoiceId === excluded || attempt.status !== "verified") return false;
    return normalizeTxHash(attempt.txHash || attempt.match?.txHash) === normalized;
  });
  return ownerAttempt ? { id: ownerAttempt.invoiceId, number: ownerAttempt.invoiceNumber } : null;
}

function normalizeInvoicePatch(existing, patch) {
  const allowed = {
    ...existing,
    status: ["open", "verifying", "paid"].includes(patch.status) ? patch.status : existing.status,
    paidAt: String(patch.paidAt ?? existing.paidAt ?? ""),
    payerWallet: normalizeAddress(patch.payerWallet ?? existing.payerWallet),
    txHash: normalizeTxHash(patch.txHash ?? existing.txHash),
    verifiedAt: String(patch.verifiedAt ?? existing.verifiedAt ?? ""),
    verificationSource: String(patch.verificationSource ?? existing.verificationSource ?? "").trim().slice(0, 80),
    verifiedPayment: patch.verifiedPayment && typeof patch.verifiedPayment === "object" ? patch.verifiedPayment : existing.verifiedPayment || null,
    lastVerificationAt: String(patch.lastVerificationAt ?? existing.lastVerificationAt ?? ""),
  };
  return normalizeInvoice(allowed, { allowExistingTimestamps: true });
}

function getAgentIdempotencyKey(req, input = {}) {
  return normalizeIdempotencyKey(req.headers["idempotency-key"] || input.idempotencyKey || input.idempotency_key);
}

function normalizeIdempotencyKey(value) {
  return String(value || "").trim().slice(0, 120);
}

function clampListLimit(value, fallback, max) {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(Math.max(Math.round(limit), 1), max);
}

function requireAgentApiKey(req, res) {
  const authorization = String(req.headers.authorization || "");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const received = String((bearerMatch && bearerMatch[1]) || req.headers["x-api-key"] || "").trim();
  
  if (!received) {
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } });
    return false;
  }

  const expectedGlobal = getAgentApiKey();
  if (expectedGlobal && safeEqualString(received, expectedGlobal)) {
    if (!checkRateLimit(req, res, `ip:${req.socket.remoteAddress}`)) return false;
    req.agentSellerId = null; 
    return true;
  }

  const db = loadApiKeyDb();
  const keyHash = crypto.createHash("sha256").update(received).digest("hex");
  const record = db.apiKeys.find(k => k.keyHash === keyHash);
  
  if (!record || record.revokedAt) {
    sendJson(res, 401, { error: { code: "UNAUTHORIZED", message: "Invalid or missing API key" } });
    return false;
  }
  
  if (!checkRateLimit(req, res, `key:${keyHash}`)) return false;

  record.lastUsedAt = new Date().toISOString();
  saveApiKeyDb(db);
  
  req.agentSellerId = normalizeAddress(record.sellerId);
  return true;
}

function getAgentApiKey() {
  return String(process.env.FUNDLINE_API_KEY || process.env.ARC_INVOICE_API_KEY || "").trim();
}

function safeEqualString(received, expected) {
  if (!received || !expected) return false;
  const left = Buffer.from(String(received));
  const right = Buffer.from(String(expected));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

function decorateInvoiceForAgent(invoice, req) {
  return {
    ...invoice,
    paymentLink: `${getRequestBaseUrl(req)}/pay/${invoice.id}`,
  };
}

const DEFAULT_PUBLIC_BASE_URL = "https://fundline.xyz";
function getPublicBaseUrl() {
  const publicBase = process.env.PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL;
  return String(publicBase).trim().replace(/\/$/, "");
}

function getRequestBaseUrl(req) {
  if (!req || !req.headers || !req.headers.host) {
    const pub = getPublicBaseUrl();
    if (pub) return pub;
  }
  const host = req && req.headers && req.headers.host ? String(req.headers.host).trim() : `127.0.0.1:${PORT}`;
  const forwardedProto = req && req.headers ? String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() : "";
  const proto = forwardedProto || (host.startsWith("127.0.0.1") || host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function redactWebhook(webhook) {
  return {
    id: webhook.id,
    merchantWallet: webhook.merchantWallet,
    url: webhook.url,
    event: webhook.event,
    enabled: webhook.enabled,
    createdAt: webhook.createdAt,
    hasSecret: Boolean(webhook.secret),
  };
}

function redactWebhookLog(log) {
  return {
    id: log.id,
    deliveryId: log.deliveryId,
    webhookId: log.webhookId,
    invoiceId: log.invoiceId,
    invoiceNumber: log.invoiceNumber,
    merchantWallet: log.merchantWallet,
    event: log.event,
    url: log.url,
    ok: log.ok,
    statusCode: log.statusCode,
    error: log.error,
    responseBodyPreview: log.responseBodyPreview,
    durationMs: log.durationMs,
    createdAt: log.createdAt,
  };
}

function normalizeWebhookUrl(value) {
  const text = String(value || "").trim();
  let parsed;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error("Invalid webhook URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Webhook URL must use http or https");
  if (!parsed.hostname) throw new Error("Webhook URL must include a host");
  return parsed.toString();
}

function nextInvoiceNumber(invoices) {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const max = invoices.reduce((current, invoice) => {
    const number = String(invoice.number || "");
    if (!number.startsWith(prefix)) return current;
    const value = Number(number.slice(prefix.length));
    return Number.isFinite(value) ? Math.max(current, value) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

function makeId(bytes = 10) {
  return crypto.randomBytes(bytes).toString("hex");
}

function randomBytes32() {
  return `0x${crypto.randomBytes(32).toString("hex")}`;
}

async function dispatchInvoiceWebhooks(invoice, event, req) {
  const db = loadWebhookDb();
  const webhooks = db.webhooks.filter((webhook) => webhook.enabled && (webhook.event === event || webhook.event === "*") && sameAddress(webhook.merchantWallet, invoice.merchantWallet));
  if (!webhooks.length) return { sent: 0 };

  const payload = {
    event,
    sentAt: new Date().toISOString(),
    invoice: decorateInvoiceForAgent(invoice, req),
  };

  const results = await Promise.allSettled(webhooks.map(async (webhook) => {
    const eventId = event === "invoice.paid" && invoice.webhookEventId ? invoice.webhookEventId : `${invoice.id}-${event}`;
    if (!eventId) return Promise.resolve(null);
    const idKey = `${eventId}:${webhook.id}`;
    if (dispatchedEventIds.has(idKey)) return Promise.resolve(null);
    
    const res = await sendWebhookWithLog(webhook, payload, invoice, eventId);
    dispatchedEventIds.add(idKey);
    saveDispatchedEventIds();
    return res;
  }));
  const sent = results.filter((result) => result.status === "fulfilled" && result.value !== null).length;
  const failed = results.filter((result) => result.status === "rejected").length;
  if (failed || sent) console.log(`Webhook ${event} delivered to ${sent}/${results.length} endpoint(s)`);
  
  // Save to events DB
  try {
    const eventDb = loadEventDb();
    eventDb.events.push({
      id: crypto.randomBytes(12).toString("hex"),
      type: event,
      sellerId: invoice.merchantWallet,
      invoiceId: invoice.id,
      createdAt: new Date().toISOString(),
      payload: { invoice: decorateInvoiceForAgent(invoice, req) }
    });
    saveEventDb(eventDb);
  } catch (err) {
    console.error("Failed to save event log", err);
  }
  return { sent, failed };
}

async function sendWebhookWithLog(webhook, payload, invoice, idempotencyKey) {
  const deliveryId = makeId(10);
  const startedAt = Date.now();
  try {
    const result = await sendWebhook(webhook, payload, deliveryId, idempotencyKey);
    appendWebhookLog({
      deliveryId,
      webhookId: webhook.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      merchantWallet: invoice.merchantWallet,
      event: payload.event,
      url: webhook.url,
      ok: true,
      statusCode: result.statusCode,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    appendWebhookLog({
      deliveryId,
      webhookId: webhook.id,
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      merchantWallet: invoice.merchantWallet,
      event: payload.event,
      url: webhook.url,
      ok: false,
      statusCode: error.statusCode,
      error: error.message || "Webhook delivery failed",
      responseBodyPreview: error.responseBodyPreview,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function sendWebhook(webhook, payload, deliveryId = makeId(10), idempotencyKey = "") {
  return new Promise((resolve, reject) => {
    const target = new URL(webhook.url);
    const transport = target.protocol === "http:" ? http : https;
    const body = JSON.stringify(payload);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "User-Agent": "FundlineWebhook/1.0",
      "X-Fundline-Event": payload.event,
      "X-Fundline-Delivery": deliveryId,
    };
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    if (webhook.secret) {
      const signature = `sha256=${crypto.createHmac("sha256", webhook.secret).update(body).digest("hex")}`;
      headers["X-Fundline-Signature"] = signature;
    }

    const request = transport.request(
      target,
      {
        method: "POST",
        headers,
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            resolve({ statusCode: response.statusCode, deliveryId });
            return;
          }
          const error = new Error(`Webhook ${webhook.id} returned ${response.statusCode}: ${responseBody || "request failed"}`);
          error.statusCode = response.statusCode;
          error.responseBodyPreview = responseBody;
          reject(error);
        });
      },
    );
    request.setTimeout(10000, () => {
      request.destroy(new Error(`Webhook ${webhook.id} timed out`));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function handleVerifyPayment(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  let attempt = null;
  try {
    const body = await readJsonBody(req);
    const invoiceId = String(body.invoiceId || "").trim().toLowerCase();
    const payerWallet = normalizeAddress(body.payerWallet);
    const txHash = normalizeTxHash(body.txHash);

    if (!/^[a-f0-9]{20}$/i.test(invoiceId)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invoice ID is required" } });
      return;
    }

    const db = loadInvoiceDb();
    const invoiceIndex = db.invoices.findIndex((item) => item.id === invoiceId);
    const invoice = invoiceIndex >= 0 ? db.invoices[invoiceIndex] : null;
    if (!invoice) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
      return;
    }

    const merchantWallet = invoice.merchantWallet;
    const amount = Number(invoice.total);
    const onchainInvoiceId = normalizeBytes32(invoice.onchainInvoiceId);
    const createdAt = invoice.createdAt ? new Date(invoice.createdAt) : null;
    const now = new Date().toISOString();

    if (!payerWallet) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Payer wallet is required" } });
      return;
    }
    if (!merchantWallet) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Merchant receiving wallet is invalid" } });
      return;
    }
    if (sameAddress(payerWallet, merchantWallet)) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Payer wallet must be different from the receiving wallet" } });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invoice amount is invalid" } });
      return;
    }
    if (ARC_PAYMENT_ROUTER_ADDRESS && !onchainInvoiceId) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Invoice payment reference is missing" } });
      return;
    }

    attempt = createPaymentAttempt({
      invoiceId: invoice.id,
      invoiceNumber: invoice.number,
      payerWallet,
      merchantWallet,
      amount,
      tokenSymbol: "USDC",
      tokenAddress: ARC_USDC_TOKEN_ADDRESS,
      onchainInvoiceId,
      txHash,
      chain: ARC_NETWORK_NAME,
      chainId: ARC_CHAIN_ID,
    });

    if (invoice.status === "paid") {
      const existingHash = normalizeTxHash(invoice.txHash);
      if (txHash && existingHash && txHash !== existingHash) {
        const failedAttempt = updatePaymentAttempt(attempt.id, {
          status: "failed",
          error: "Invoice is already paid with a different transaction",
        });
        dispatchInvoiceTelegramAlert(invoice, "invoice.failed", failedAttempt.error).catch(console.error);
        dispatchInvoiceWebhooks(invoice, "invoice.failed", req).catch(console.error);
        sendJson(res, 409, { error: "Invoice is already paid with a different transaction", attempt: failedAttempt });
        return;
      }
      const match = sanitizePaymentMatch(invoice.verifiedPayment || {
        source: invoice.verificationSource || "stored_verified_payment",
        txHash: existingHash,
        explorerUrl: existingHash ? `${ARCSCAN_EXPLORER_BASE}/tx/${existingHash}` : "",
        from: invoice.payerWallet,
        to: invoice.merchantWallet,
        timestamp: invoice.paidAt,
        tokenSymbol: "USDC",
        tokenAddress: ARC_USDC_TOKEN_ADDRESS,
        onchainInvoiceId,
        referenceVerified: Boolean(onchainInvoiceId),
        transferVerified: true,
      });
      const verifiedAttempt = updatePaymentAttempt(attempt.id, {
        status: "verified",
        verifiedAt: now,
        txHash: match.txHash,
        match,
      });
      sendJson(res, 200, { verified: true, match, invoice, attempt: verifiedAttempt });
      return;
    }

    const duplicateBeforeScan = txHash ? findTxHashPaymentOwner(db.invoices, txHash, invoice.id) : null;
    if (duplicateBeforeScan) {
      if (invoice.status === "verifying") {
        db.invoices[invoiceIndex] = normalizeInvoice(
          {
            ...invoice,
            status: "open",
            lastVerificationAt: now,
          },
          { allowExistingTimestamps: true },
        );
        saveInvoiceDb(db);
      }
      const failedAttempt = updatePaymentAttempt(attempt.id, {
        status: "failed",
        error: `Transaction already verifies invoice ${duplicateBeforeScan.number || duplicateBeforeScan.id}`,
      });
      dispatchInvoiceTelegramAlert(invoice, "invoice.failed", failedAttempt.error).catch(console.error);
      dispatchInvoiceWebhooks(invoice, "invoice.failed", req).catch(console.error);
      sendJson(res, 409, { error: "This transaction is already used for another invoice", attempt: failedAttempt });
      return;
    }

    const match = await findArcPayment({
      invoiceId: invoice.id,
      payerWallet,
      merchantWallet,
      amount,
      onchainInvoiceId,
      createdAt: createdAt && Number.isFinite(createdAt.getTime()) ? createdAt : null,
      txHash,
      requireInvoiceReference: Boolean(ARC_PAYMENT_ROUTER_ADDRESS && onchainInvoiceId),
    });

    if (!match) {
      if (invoice.status === "verifying") {
        db.invoices[invoiceIndex] = normalizeInvoice(
          {
            ...invoice,
            status: "open",
            lastVerificationAt: now,
          },
          { allowExistingTimestamps: true },
        );
        saveInvoiceDb(db);
      }
      const pendingAttempt = updatePaymentAttempt(attempt.id, {
        status: "pending",
        error: "No matching USDC payment was found yet. If you just paid, wait a few seconds and verify again.",
      });
      sendJson(res, 200, {
        verified: false,
        status: "pending",
        error: pendingAttempt.error,
        attempt: pendingAttempt,
      });
      return;
    }

    const duplicateAfterScan = findTxHashPaymentOwner(db.invoices, match.txHash, invoice.id);
    if (duplicateAfterScan) {
      if (invoice.status === "verifying") {
        db.invoices[invoiceIndex] = normalizeInvoice(
          {
            ...invoice,
            status: "open",
            lastVerificationAt: now,
          },
          { allowExistingTimestamps: true },
        );
        saveInvoiceDb(db);
      }
      const failedAttempt = updatePaymentAttempt(attempt.id, {
        status: "failed",
        txHash: match.txHash,
        error: `Transaction already verifies invoice ${duplicateAfterScan.number || duplicateAfterScan.id}`,
        match,
      });
      dispatchInvoiceTelegramAlert(invoice, "invoice.failed", failedAttempt.error).catch(console.error);
      dispatchInvoiceWebhooks(invoice, "invoice.failed", req).catch(console.error);
      sendJson(res, 409, { error: "This transaction is already used for another invoice", attempt: failedAttempt });
      return;
    }

    const sanitizedMatch = sanitizePaymentMatch({
      ...match,
      paymentAttemptId: attempt.id,
      onchainInvoiceId,
    });
    const updated = normalizeInvoice(
      {
        ...invoice,
        status: "paid",
        paidAt: sanitizedMatch.timestamp || now,
        payerWallet,
        txHash: sanitizedMatch.txHash,
        verifiedAt: now,
        verificationSource: sanitizedMatch.source,
        verifiedPayment: sanitizedMatch,
        lastVerificationAt: now,
        webhookEventId: invoice.webhookEventId || crypto.randomUUID(),
      },
      { allowExistingTimestamps: true },
    );
    db.invoices[invoiceIndex] = updated;
    saveInvoiceDb(db);

    const verifiedAttempt = updatePaymentAttempt(attempt.id, {
      status: "verified",
      verifiedAt: now,
      txHash: sanitizedMatch.txHash,
      match: sanitizedMatch,
    });

    if (invoice.status !== "paid") {
      dispatchInvoiceTelegramAlert(updated, "invoice.paid").catch(console.error);
      dispatchInvoiceWebhooks(updated, "invoice.paid", req).catch((error) => {
        console.log(`Webhook dispatch failed: ${error.message || "Unknown error"}`);
      });
    }

    sendJson(res, 200, { verified: true, match: sanitizedMatch, invoice: updated, attempt: verifiedAttempt });
  } catch (error) {
    if (attempt?.id) {
      updatePaymentAttempt(attempt.id, {
        status: "failed",
        error: error.message || "Arcscan verification failed",
      });
    }
    sendJson(res, 500, { error: error.message || "Arcscan verification failed" });
  }
}

async function findArcPayment(criteria) {
  // 1. Strict path first: prefer the PaymentRouter InvoicePaid binding (it carries
  //    the onchainInvoiceId). Connect-wallet payments go through the router and
  //    verify here; this path is unchanged.
  if (criteria.requireInvoiceReference) {
    const strict = criteria.txHash
      ? await findPaymentInRpcReceipt(criteria)
      : await findRecentReferencedPayment(criteria);
    if (strict) return strict;
    // No router-bound match. Fall through to accept a direct USDC transfer made
    // without the router (QR / manual payers who scan-to-pay). These are guarded
    // by exact amount + recipient + recency + the (txHash) double-spend guard in
    // the caller, but carry no onchainInvoiceId, so they are a weaker,
    // unreferenced settlement signal by design.
  }

  // 2. Direct transfer, txHash-scoped (preferred over recent-list scans because
  //    a supplied hash binds the payment explicitly). Precedence: ERC-20 Transfer
  //    (6 decimals) before native USDC value (18 decimals).
  if (criteria.txHash) {
    const receiptMatch = await findPaymentInRpcReceipt({ ...criteria, requireInvoiceReference: false });
    if (receiptMatch) return receiptMatch;
    const tokenByTx = await findTokenTransferByTx(criteria);
    if (tokenByTx) return tokenByTx;
    const nativeByTx = await findNativeTransferByTx(criteria);
    if (nativeByTx) return nativeByTx;
  }

  // 3. Direct transfer, recent-list scan (last resort, when no txHash is given).
  const recentToken = await findRecentTokenTransfer(criteria);
  if (recentToken) return recentToken;
  const recentNative = await findRecentNativeTransfer(criteria);
  if (recentNative) return recentNative;
  return null;
}

async function findPaymentInRpcReceipt(criteria) {
  if (!criteria.txHash || !ARC_RPC_URL) return null;
  try {
    const receipt = await rpcRequest("eth_getTransactionReceipt", [criteria.txHash]);
    if (!receipt || String(receipt.status || "").toLowerCase() !== "0x1") return null;
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const routerEvent = findInvoicePaidLog(logs, criteria);
    const transferEvent = findUsdcTransferLog(logs, criteria);
    if (criteria.requireInvoiceReference && (!routerEvent || !transferEvent)) return null;
    if (!routerEvent && !transferEvent) return null;
    return {
      source: routerEvent ? "rpc_payment_router_event" : "rpc_usdc_transfer_log",
      txHash: criteria.txHash,
      explorerUrl: `${ARCSCAN_EXPLORER_BASE}/tx/${criteria.txHash}`,
      from: criteria.payerWallet,
      to: criteria.merchantWallet,
      timestamp: "",
      blockNumber: hexToNumber(receipt.blockNumber),
      tokenSymbol: "USDC",
      tokenAddress: ARC_USDC_TOKEN_ADDRESS,
      rawAmount: String((routerEvent || transferEvent).amount),
      onchainInvoiceId: routerEvent ? criteria.onchainInvoiceId : "",
      referenceVerified: Boolean(routerEvent),
      transferVerified: Boolean(transferEvent),
    };
  } catch {
    return null;
  }
}

async function findRecentReferencedPayment(criteria) {
  const transactions = await fetchArcscanItems(`/addresses/${criteria.payerWallet}/transactions`, {}, 3);
  for (const transaction of transactions) {
    const txHash = normalizeTxHash(transaction.hash || transaction.transaction_hash);
    if (!txHash) continue;
    const from = normalizeAddress(transaction.from?.hash || transaction.from);
    if (from && !sameAddress(from, criteria.payerWallet)) continue;
    if (!isRecentEnough(transaction.timestamp, criteria.createdAt)) continue;
    const match = await findPaymentInRpcReceipt({ ...criteria, txHash });
    if (match) return { ...match, timestamp: transaction.timestamp || match.timestamp };
  }
  return null;
}

function findInvoicePaidLog(logs, criteria) {
  if (!ARC_PAYMENT_ROUTER_ADDRESS) return null;
  const expectedAmount = amountToUnits(criteria.amount, ARC_USDC_DECIMALS);
  for (const log of logs.map(normalizeReceiptLog)) {
    if (!sameAddress(log.address, ARC_PAYMENT_ROUTER_ADDRESS)) continue;
    if (log.topics[0] !== INVOICE_PAID_TOPIC) continue;
    if (criteria.onchainInvoiceId && log.topics[1] !== criteria.onchainInvoiceId) continue;
    if (!sameAddress(topicToAddress(log.topics[2]), criteria.payerWallet)) continue;
    if (!sameAddress(topicToAddress(log.topics[3]), criteria.merchantWallet)) continue;
    const words = dataWords(log.data);
    const amount = words[0] ? BigInt(words[0]) : 0n;
    const token = words[1] ? topicToAddress(words[1]) : "";
    if (ARC_USDC_TOKEN_ADDRESS && token && !sameAddress(token, ARC_USDC_TOKEN_ADDRESS)) continue;
    if (amount === expectedAmount) return { ...log, amount };
  }
  return null;
}

function findUsdcTransferLog(logs, criteria) {
  const expectedAmount = amountToUnits(criteria.amount, ARC_USDC_DECIMALS);
  for (const log of logs.map(normalizeReceiptLog)) {
    if (ARC_USDC_TOKEN_ADDRESS && !sameAddress(log.address, ARC_USDC_TOKEN_ADDRESS)) continue;
    if (log.topics[0] !== ERC20_TRANSFER_TOPIC) continue;
    if (!sameAddress(topicToAddress(log.topics[1]), criteria.payerWallet)) continue;
    if (!sameAddress(topicToAddress(log.topics[2]), criteria.merchantWallet)) continue;
    const amount = log.data && /^0x[0-9a-f]+$/i.test(log.data) ? BigInt(log.data) : 0n;
    if (amount === expectedAmount) return { ...log, amount };
  }
  return null;
}

async function findTokenTransferByTx(criteria) {
  try {
    const transfers = await fetchArcscanItems(`/transactions/${criteria.txHash}/token-transfers`, {}, 1);
    return findMatchingTokenTransfer(transfers, criteria);
  } catch {
    return null;
  }
}

async function findRecentTokenTransfer(criteria) {
  const transfers = await fetchArcscanItems(`/addresses/${criteria.payerWallet}/token-transfers`, { type: "ERC-20" }, 4);
  return findMatchingTokenTransfer(transfers, criteria);
}

async function findNativeTransferByTx(criteria) {
  try {
    const tx = await fetchArcscanJson(`/transactions/${criteria.txHash}`);
    return findMatchingNativeTransaction([tx], criteria);
  } catch {
    return null;
  }
}

async function findRecentNativeTransfer(criteria) {
  const transactions = await fetchArcscanItems(`/addresses/${criteria.payerWallet}/transactions`, {}, 3);
  return findMatchingNativeTransaction(transactions, criteria);
}

function findMatchingTokenTransfer(transfers, criteria) {
  const transfer = transfers.find((item) => isMatchingTokenTransfer(item, criteria));
  if (!transfer) return null;
  const match = toTokenTransferMatch(transfer);
  // Never accept a match without a txHash: the (txHash) double-spend guard relies
  // on it, so a hashless match could be reused across invoices.
  return match.txHash ? match : null;
}

function isMatchingTokenTransfer(transfer, criteria) {
  const from = normalizeAddress(transfer.from?.hash || transfer.from);
  const to = normalizeAddress(transfer.to?.hash || transfer.to);
  const txHash = normalizeTxHash(transfer.transaction_hash || transfer.tx_hash || transfer.transaction?.hash);
  if (criteria.txHash && txHash !== criteria.txHash) return false;
  if (!sameAddress(from, criteria.payerWallet) || !sameAddress(to, criteria.merchantWallet)) return false;
  if (!isRecentEnough(transfer.timestamp, criteria.createdAt)) return false;

  const tokenAddress = normalizeAddress(transfer.token?.address || transfer.token?.address_hash || transfer.token?.contract_address || transfer.token?.hash);
  const symbol = String(transfer.token?.symbol || transfer.token?.name || "").toUpperCase();
  // Require the canonical USDC contract when it is configured. Do NOT accept a
  // transfer just because its token symbol string is "USDC" - a spoofed token can
  // report any symbol. Only fall back to the symbol check when no canonical
  // address is set (dev / self-host without ARC_USDC_TOKEN_ADDRESS).
  if (ARC_USDC_TOKEN_ADDRESS) {
    if (!sameAddress(tokenAddress, ARC_USDC_TOKEN_ADDRESS)) return false;
  } else if (symbol !== "USDC") {
    return false;
  }

  // For the canonical USDC, trust the fixed 6-decimal scale rather than the
  // explorer-reported decimals (which a spoofed token could otherwise influence).
  const reportedDecimals = Number(transfer.total?.decimals ?? transfer.token?.decimals ?? ARC_USDC_DECIMALS);
  const decimals = ARC_USDC_TOKEN_ADDRESS
    ? ARC_USDC_DECIMALS
    : (Number.isFinite(reportedDecimals) ? reportedDecimals : ARC_USDC_DECIMALS);
  const rawValue = parseUnitsValue(transfer.total?.value ?? transfer.value);
  const expected = amountToUnits(criteria.amount, decimals);
  return rawValue === expected;
}

function toTokenTransferMatch(transfer) {
  const txHash = normalizeTxHash(transfer.transaction_hash || transfer.tx_hash || transfer.transaction?.hash);
  const tokenAddress = normalizeAddress(transfer.token?.address || transfer.token?.address_hash || transfer.token?.contract_address || transfer.token?.hash);
  return {
    source: "arcscan_token_transfer",
    txHash,
    explorerUrl: txHash ? `${ARCSCAN_EXPLORER_BASE}/tx/${txHash}` : "",
    from: normalizeAddress(transfer.from?.hash || transfer.from),
    to: normalizeAddress(transfer.to?.hash || transfer.to),
    timestamp: transfer.timestamp || "",
    blockNumber: transfer.block_number || transfer.blockNumber || "",
    tokenSymbol: transfer.token?.symbol || "USDC",
    tokenAddress,
    rawAmount: String(transfer.total?.value ?? transfer.value ?? ""),
  };
}

function findMatchingNativeTransaction(transactions, criteria) {
  const tx = transactions.find((transaction) => {
    const txHash = normalizeTxHash(transaction.hash || transaction.transaction_hash);
    if (criteria.txHash && txHash !== criteria.txHash) return false;
    const from = normalizeAddress(transaction.from?.hash || transaction.from);
    const to = normalizeAddress(transaction.to?.hash || transaction.to);
    if (!sameAddress(from, criteria.payerWallet) || !sameAddress(to, criteria.merchantWallet)) return false;
    if (!isRecentEnough(transaction.timestamp, criteria.createdAt)) return false;
    if (String(transaction.status || "").toLowerCase() === "error") return false;
    const value = parseUnitsValue(transaction.value);
    const expected = amountToUnits(criteria.amount, ARC_NATIVE_USDC_DECIMALS);
    // Exact match only. A larger, unrelated native transfer to the merchant must
    // never be claimed as payment for a smaller invoice.
    return value === expected;
  });
  if (!tx) return null;
  const txHash = normalizeTxHash(tx.hash || tx.transaction_hash);
  // Never accept a match without a txHash: the (txHash) double-spend guard relies
  // on it, so a hashless match could be reused across invoices.
  if (!txHash) return null;
  return {
    source: "arcscan_native_transfer",
    txHash,
    explorerUrl: txHash ? `${ARCSCAN_EXPLORER_BASE}/tx/${txHash}` : "",
    from: normalizeAddress(tx.from?.hash || tx.from),
    to: normalizeAddress(tx.to?.hash || tx.to),
    timestamp: tx.timestamp || "",
    blockNumber: tx.block || tx.block_number || "",
    tokenSymbol: "USDC",
    tokenAddress: "native",
    rawAmount: String(tx.value || ""),
  };
}

async function fetchArcscanItems(pathname, params = {}, maxPages = 1) {
  const items = [];
  let pageParams = { ...params };
  for (let page = 0; page < maxPages; page += 1) {
    const data = await fetchArcscanJson(pathname, pageParams);
    if (Array.isArray(data)) {
      items.push(...data);
      break;
    }
    if (Array.isArray(data.items)) items.push(...data.items);
    if (!data.next_page_params) break;
    pageParams = { ...params, ...data.next_page_params };
  }
  return items;
}

function fetchArcscanJson(pathname, params = {}) {
  const url = new URL(`${ARCSCAN_API_BASE}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return requestJson(url);
}

async function handleTelegramPayment(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const chatId = String(body.chatId || "").trim();
    const clientInvoice = body.invoice || {};
    if (!chatId) {
      sendJson(res, 400, { error: "Telegram chat ID is required" });
      return;
    }
    if (!clientInvoice.number || !clientInvoice.total) {
      sendJson(res, 400, { error: "Invoice number and total are required" });
      return;
    }

    const token = getTelegramToken();
    if (!token) {
      console.error("[Telegram] handleTelegramPayment: TELEGRAM_BOT_TOKEN not set");
      sendJson(res, 500, { error: "TELEGRAM_BOT_TOKEN is not configured on the server" });
      return;
    }

    const db = loadInvoiceDb();
    const storedInvoice = db.invoices.find((item) => item.id === clientInvoice.id);
    const invoice = storedInvoice || clientInvoice;

    if (invoice.telegramPaidNotifiedAt) {
      sendJson(res, 200, { ok: true, skipped: true });
      return;
    }

    const sendResult = await sendTelegramMessage(token, chatId, buildPaymentMessage(invoice));
    if (!sendResult.ok) {
      sendJson(res, 502, { error: sendResult.error || "Telegram delivery failed" });
      return;
    }

    // Set guard only after confirmed delivery
    const db2 = loadInvoiceDb();
    const index = db2.invoices.findIndex((item) => item.id === invoice.id);
    if (index >= 0) {
      db2.invoices[index].telegramPaidNotifiedAt = new Date().toISOString();
      saveInvoiceDb(db2);
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[Telegram] handleTelegramPayment error:", error.message);
    sendJson(res, 500, { error: error.message || "Telegram notification failed" });
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 64 * 1024) {
        req.destroy();
        reject(new Error("Request body is too large"));
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function formatPaidAt(isoString) {
  if (!isoString) return "-";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return isoString;
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} - ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} UTC`;
}

function buildPaymentMessage(invoice) {
  return [
    "Fundline payment received",
    "",
    `Invoice: ${invoice.number}`,
    `Client: ${invoice.clientName || "-"}`,
    `Amount: ${invoice.total}`,
    `Paid at: ${formatPaidAt(invoice.paidAt)}`,
    `Payer wallet: ${invoice.payerWallet || "-"}`,
    `Receiving wallet: ${invoice.merchantWallet || "-"}`,
    `Tx: ${invoice.txHash || "demo"}`,
    invoice.verificationSource ? `Verified by: ${invoice.verificationSource}` : "",
    invoice.explorerUrl ? `Arcscan: ${invoice.explorerUrl}` : "",
    invoice.paymentLink ? `Payment page: ${invoice.paymentLink}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function handleTelegramVerifyAlert(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const chatId = String(body.chatId || "").trim();
    if (!chatId) {
      sendJson(res, 400, { error: "Telegram chat ID is required" });
      return;
    }
    const token = getTelegramToken();
    if (!token) {
      console.error("[Telegram] handleTelegramVerifyAlert: TELEGRAM_BOT_TOKEN not set");
      sendJson(res, 500, { error: "TELEGRAM_BOT_TOKEN is not configured on the server" });
      return;
    }
    const sendResult = await sendTelegramMessage(token, chatId, buildVerifyAlertMessage());
    if (!sendResult.ok) {
      sendJson(res, 502, { error: sendResult.error || "Telegram delivery failed" });
      return;
    }
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[Telegram] handleTelegramVerifyAlert error:", error.message);
    sendJson(res, 500, { error: error.message || "Telegram notification failed" });
  }
}

function buildVerifyAlertMessage() {
  return [
    "Fundline is connected.",
    "",
    "Send a USDC invoice as one link. Your client pays from Arc, Base, or Ethereum.",
    "Fundline confirms the payment on-chain before marking it received.",
    "Money goes straight to your wallet - never through us.",
    "",
    "Your payment alerts are active.",
  ].join("\n");
}

async function dispatchInvoiceTelegramAlert(invoice, event, reason = "") {
  const token = getTelegramToken();
  if (!token) {
    console.error("[Telegram] dispatchInvoiceTelegramAlert: TELEGRAM_BOT_TOKEN not set, skipping alert");
    return;
  }

  const sellerDb = loadSellerDb();
  const sellerSettings = sellerDb.sellers[invoice.merchantWallet] || {};
  const alerts = sellerSettings.alerts || { paid: true, failed: true, overdue: true };

  const chatId = invoice.telegramChatId || sellerSettings.telegramChatId;
  if (!chatId) {
    console.log("[Telegram] No chat ID configured for invoice", invoice.id, "- skipping");
    return;
  }

  const db = loadInvoiceDb();
  const index = db.invoices.findIndex(i => i.id === invoice.id);
  if (index < 0) return;

  if (event === "invoice.paid") {
    // Gate on the account-level alerts.paid switch only, consistent with the
    // failed and overdue branches below. The chatId is already required above and
    // is resolved from the invoice or the seller settings, so a seller who
    // configured Telegram at the account level (chatId + alerts.paid) gets alerts.
    if (alerts.paid === false) return;
    if (invoice.telegramPaidNotifiedAt || db.invoices[index].telegramPaidNotifiedAt) return;

    const text = buildPaymentMessage(invoice);
    const result = await sendTelegramMessage(token, chatId, text);
    if (result.ok) {
      db.invoices[index].telegramPaidNotifiedAt = new Date().toISOString();
      invoice.telegramPaidNotifiedAt = db.invoices[index].telegramPaidNotifiedAt;
      saveInvoiceDb(db);
    } else {
      console.error("[Telegram] Paid alert failed for invoice", invoice.id, ":", result.error);
    }
  } else if (event === "invoice.failed") {
    if (alerts.failed === false) return;
    if (invoice.telegramFailedNotifiedAt || db.invoices[index].telegramFailedNotifiedAt) return;

    const text = `Fundline payment failed\n\nInvoice: ${invoice.number}\nClient: ${invoice.clientName || "-"}\nReason: ${reason}`;
    const result = await sendTelegramMessage(token, chatId, text);
    if (result.ok) {
      db.invoices[index].telegramFailedNotifiedAt = new Date().toISOString();
      invoice.telegramFailedNotifiedAt = db.invoices[index].telegramFailedNotifiedAt;
      saveInvoiceDb(db);
    } else {
      console.error("[Telegram] Failed alert failed for invoice", invoice.id, ":", result.error);
    }
  } else if (event === "invoice.overdue") {
    if (alerts.overdue === false) return;
    if (invoice.overdueNotifiedAt || db.invoices[index].overdueNotifiedAt) return;

    const text = `Fundline invoice overdue\n\nInvoice: ${invoice.number}\nClient: ${invoice.clientName || "-"}\nDue Date: ${invoice.dueDate || "-"}`;
    const result = await sendTelegramMessage(token, chatId, text);
    if (result.ok) {
      db.invoices[index].overdueNotifiedAt = new Date().toISOString();
      invoice.overdueNotifiedAt = db.invoices[index].overdueNotifiedAt;
      saveInvoiceDb(db);
    } else {
      console.error("[Telegram] Overdue alert failed for invoice", invoice.id, ":", result.error);
    }
  }
}

function startTelegramPolling() {
  if (telegramPollStarted || !getTelegramToken()) {
    if (!getTelegramToken()) console.log("Telegram bot: no token loaded");
    return;
  }
  telegramPollStarted = true;
  console.log("Telegram bot: starting polling...");
  validateTelegramToken().catch((error) => console.log(`Telegram token check failed: ${error.message || "Unknown error"}`));
  setTelegramCommands().catch((error) => console.log(`Telegram command setup failed: ${error.message || "Unknown error"}`));
  try {
    seedTelegramLinksFromSellers();
  } catch (error) {
    console.log(`Telegram link seeding failed: ${error.message || "Unknown error"}`);
  }
  scheduleTelegramPoll();
}

// Self-rescheduling poll loop. The long-poll itself holds the connection for up
// to TELEGRAM_LONG_POLL_SECONDS and returns the moment an update arrives, so we
// reschedule immediately after each cycle resolves (sub-second button latency)
// and back off briefly on error to avoid a hot retry loop.
function scheduleTelegramPoll() {
  pollTelegramUpdates()
    .then(() => {
      if (getTelegramToken()) telegramPollTimer = setTimeout(scheduleTelegramPoll, 0);
    })
    .catch((error) => {
      console.log(`Telegram polling failed: ${error.message || "Unknown error"}`);
      if (getTelegramToken()) telegramPollTimer = setTimeout(scheduleTelegramPoll, 3000);
    });
}

// Validate the configured bot token at startup so a revoked or mistyped token
// is surfaced loudly in the boot log instead of only failing on the first alert.
async function validateTelegramToken() {
  const token = getTelegramToken();
  if (!token) return;
  try {
    const me = await requestTelegramWithToken(token, "getMe", {});
    if (me && me.ok && me.result) {
      console.log(`Telegram bot: token OK, authenticated as @${me.result.username} (id ${me.result.id})`);
    } else {
      console.error("Telegram bot: getMe returned an unexpected response, alerts may not work");
    }
  } catch (error) {
    const parsed = parseTelegramError(error);
    if (parsed.code === 401) {
      console.error(`Telegram bot: ${TELEGRAM_BAD_TOKEN_HINT}`);
    } else {
      console.error(`Telegram bot: token validation failed: ${parsed.text}`);
    }
  }
}

let overdueJobTimer = null;
function startOverdueJob() {
  if (overdueJobTimer) return;
  const interval = Number(process.env.OVERDUE_SCAN_INTERVAL_MS) || 5 * 60 * 1000;
  console.log(`Overdue job: scanning every ${interval}ms`);
  
  overdueJobTimer = setInterval(() => {
    const db = loadInvoiceDb();
    const now = Date.now();
    let modified = false;

    for (const invoice of db.invoices) {
      if (invoice.status === "paid") continue;
      if (!invoice.dueDate) continue;
      
      const dueTime = new Date(invoice.dueDate).getTime();
      if (Number.isNaN(dueTime) || now <= dueTime) continue;

      if (!invoice.overdueNotifiedAt) {
        dispatchInvoiceTelegramAlert(invoice, "invoice.overdue").catch(console.error);
        dispatchInvoiceWebhooks(invoice, "invoice.overdue", { headers: {} }).catch(console.error);
        invoice.overdueNotifiedAt = new Date().toISOString();
        modified = true;
      }
    }
    
    if (modified) saveInvoiceDb(db);
  }, Math.max(interval, 5000));
}

async function pollTelegramUpdates() {
  const token = getTelegramToken();
  if (!token || telegramPollBusy) return { skipped: true };
  telegramPollBusy = true;

  try {
    const payload = await requestTelegramLongPoll(token, {
      timeout: TELEGRAM_LONG_POLL_SECONDS,
      allowed_updates: ["message", "callback_query"],
      ...(telegramUpdateOffset ? { offset: telegramUpdateOffset } : {}),
    });
    if (payload.ok === false) throw new Error(payload.description || "Telegram getUpdates failed");

    const updates = Array.isArray(payload.result) ? payload.result : [];
    let handled = 0;
    for (const update of updates) {
      // Ack the offset first so a single bad update cannot make the loop replay it forever.
      telegramUpdateOffset = Math.max(Number(telegramUpdateOffset || 0), Number(update.update_id || 0) + 1);
      try {
        if (await handleTelegramUpdate(update)) handled += 1;
      } catch (error) {
        console.log(`Telegram update handling failed: ${error.message || "Unknown error"}`);
      }
    }
    return { updates: updates.length, handled };
  } finally {
    telegramPollBusy = false;
  }
}

// Route one Telegram update to the conversation reducer. Returns true if handled.
async function handleTelegramUpdate(update) {
  if (update.callback_query) {
    await handleTelegramCallback(update.callback_query);
    return true;
  }

  const message = update.message || update.edited_message;
  const chat = message?.chat;
  if (!chat?.id) return false;

  return handleTelegramText(chat.id, String(message.text || ""));
}

// Long-poll variant of the Telegram request: a held getUpdates connection must
// not be aborted before the server-side long-poll window elapses, so the socket
// timeout sits above TELEGRAM_LONG_POLL_SECONDS (the shared requestJson uses a
// 15s timeout that would kill a 25s long-poll).
function requestTelegramLongPoll(token, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/getUpdates`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(JSON.parse(responseBody || "{}"));
            } catch {
              resolve({});
            }
            return;
          }
          reject(new Error(`Telegram API ${response.statusCode}: ${responseBody || "request failed"}`));
        });
      },
    );
    request.setTimeout((TELEGRAM_LONG_POLL_SECONDS + 10) * 1000, () => {
      request.destroy(new Error("Telegram getUpdates timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

async function answerCallbackQuery(callbackQueryId, text) {
  if (!callbackQueryId || !getTelegramToken()) return;
  const payload = { callback_query_id: callbackQueryId };
  if (text) payload.text = text;
  try {
    await requestTelegram("answerCallbackQuery", payload);
  } catch (error) {
    console.log(`Telegram answerCallbackQuery failed: ${error.message || "Unknown error"}`);
  }
}

// Activate a chat's link (idempotent). Returns "activated" on a pending->active
// transition, "active" if it was already active, or "none" if the chat has no
// link. Pure state transition (no network) so it is unit-testable.
function activateTelegramLink(chatId) {
  const key = String(chatId).trim();
  const linkDb = loadTelegramLinkDb();
  const link = linkDb.links[key];
  if (!link) return "none";
  const now = new Date().toISOString();
  if (link.status === "pending") {
    link.status = "active";
    link.confirmedAt = now;
    link.lastSeenAt = now;
    saveTelegramLinkDb(linkDb);
    return "activated";
  }
  link.lastSeenAt = now;
  saveTelegramLinkDb(linkDb);
  return "active";
}

// Smart /start entry point. Confirms a pending link and opens the main menu, or
// shows the one-time setup screen when the chat is not linked to a merchant.
async function handleTelegramStart(chatId) {
  const key = String(chatId).trim();
  const status = activateTelegramLink(key);
  if (status === "none") {
    await sendTelegramSetup(key);
    return;
  }
  const wallet = resolveWalletByChatId(key);
  const session = freshSession(key, wallet);
  const greeting = status === "activated"
    ? "Linked to your Fundline account. What would you like to do?"
    : "What would you like to do?";
  await showMainMenu(session, greeting);
}

// One-time setup screen for a chat not yet linked to a merchant.
async function sendTelegramSetup(chatId) {
  const chatIdText = String(chatId);
  await sendTelegramMessage(
    getTelegramToken(),
    chatIdText,
    [
      "Welcome to Fundline.",
      "",
      "Your Telegram chat ID:",
      `<code>${escapeHtml(chatIdText)}</code>`,
      "",
      "Paste this ID into Fundline Settings (Telegram chat ID), then come back and send /start. After that you can receive paid invoice alerts and create invoices here.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open Fundline Settings", url: `${getPublicBaseUrl()}/app` }],
          [{ text: "Copy chat ID", copy_text: { text: chatIdText } }],
        ],
      },
    },
  );
}

// ----- Bot conversation: create-invoice state machine -----
//
// States: MAIN_MENU -> ASK_CLIENT (typed) -> ASK_AMOUNT (typed) -> ASK_DUE
// (buttons) -> CONFIRM (buttons) -> DONE. Every keyboard is stamped with the
// session step; a tap whose step does not match the live session is rejected,
// which neutralizes stale buttons and double taps. The poll loop processes
// updates strictly one at a time, so a single load-mutate-save per turn is
// race-free without a lock; if the bot ever runs in more than one process,
// revisit this (and the polling-vs-webhook choice).
const TG_STATE = {
  MAIN_MENU: "main_menu",
  ASK_CLIENT: "ask_client",
  ASK_AMOUNT: "ask_amount",
  ASK_DUE: "ask_due",
  CONFIRM: "confirm",
  DONE: "done",
};

function freshSession(chatId, wallet) {
  return {
    chatId: String(chatId),
    merchantWallet: wallet,
    state: TG_STATE.MAIN_MENU,
    step: 1,
    draft: { clientName: "", amount: 0, dueChoice: "", dueDateIso: "" },
    draftInvoiceId: "",
    lastInvoiceId: "",
    createdAt: new Date().toISOString(),
    updatedAt: "",
    expiresAt: "",
  };
}

function formatTelegramDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || "");
  return d.toISOString().slice(0, 10);
}

// Validate a typed USDC amount. Returns a 2-decimal number, or null if invalid.
// Mirrors the normalizeInvoice total guard and the 6-decimal base-unit math.
function parseTelegramAmount(text) {
  const cleaned = String(text).replace(/,/g, "").trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(cleaned)) return null;
  const n = roundMoney(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 1e12) return null;
  if (amountToUnits(String(n), 6) <= 0n) return null;
  return n;
}

function mainMenuKeyboard(step) {
  return {
    inline_keyboard: [
      [{ text: "Create invoice", callback_data: `act:create:${step}` }],
      [{ text: "My invoices", callback_data: `act:mine:${step}` }],
      [{ text: "Show chat ID", callback_data: `act:chatid:${step}` }],
    ],
  };
}

// Send a message that returns the chat to the main menu: resets the draft, bumps
// the step (so older buttons go stale), and arms a fresh menu keyboard.
async function showMainMenuMessage(session, text, parseMode) {
  session.state = TG_STATE.MAIN_MENU;
  session.step += 1;
  session.draft = { clientName: "", amount: 0, dueChoice: "", dueDateIso: "" };
  session.draftInvoiceId = "";
  setTelegramSession(session.chatId, session);
  const options = { reply_markup: mainMenuKeyboard(session.step) };
  if (parseMode) options.parse_mode = parseMode;
  await sendTelegramMessage(getTelegramToken(), session.chatId, text, options);
}

async function showMainMenu(session, greeting) {
  await showMainMenuMessage(session, greeting || "What would you like to do?");
}

// Display status for a bot invoice list, mirroring the client getInvoiceStatus.
function botInvoiceStatus(invoice) {
  if (invoice.status === "paid") return "Paid";
  if (invoice.status === "verifying") return "Verifying";
  if (invoice.dueDate && new Date(invoice.dueDate).getTime() < Date.now()) return "Overdue";
  return "Open";
}

// Plain-text list of a merchant's 5 most recent invoices. Plain text (not HTML)
// so a client name with special characters cannot break formatting.
function buildMyInvoicesText(wallet) {
  const invoices = loadInvoiceDb().invoices
    .filter((invoice) => sameAddress(invoice.merchantWallet, wallet))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
  if (!invoices.length) return "No invoices yet. Tap Create invoice to make your first one.";
  const base = getPublicBaseUrl();
  const lines = ["Your 5 most recent invoices:", ""];
  for (const invoice of invoices) {
    lines.push(`${botInvoiceStatus(invoice)} - ${Number(invoice.total).toFixed(2)} USDC - ${invoice.clientName || "No client"}`);
    lines.push(`${base}/pay/${invoice.id}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function showMyInvoices(session) {
  await showMainMenuMessage(session, buildMyInvoicesText(session.merchantWallet));
}

async function showChatId(session) {
  const chatIdText = String(session.chatId);
  await showMainMenuMessage(session, ["Your Telegram chat ID:", `<code>${escapeHtml(chatIdText)}</code>`].join("\n"), "HTML");
}

async function showAskClient(session) {
  session.state = TG_STATE.ASK_CLIENT;
  session.step += 1;
  setTelegramSession(session.chatId, session);
  await sendTelegramMessage(getTelegramToken(), session.chatId, "Send the client name.", {
    reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: `act:cancel:${session.step}` }]] },
  });
}

async function showAskAmount(session) {
  session.state = TG_STATE.ASK_AMOUNT;
  session.step += 1;
  setTelegramSession(session.chatId, session);
  await sendTelegramMessage(getTelegramToken(), session.chatId, "Send the amount in USDC, for example 25 or 25.50.", {
    reply_markup: { inline_keyboard: [[{ text: "Cancel", callback_data: `act:cancel:${session.step}` }]] },
  });
}

async function showAskDue(session) {
  session.state = TG_STATE.ASK_DUE;
  session.step += 1;
  setTelegramSession(session.chatId, session);
  const s = session.step;
  await sendTelegramMessage(getTelegramToken(), session.chatId, "Choose a due date.", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "3 days", callback_data: `due:3:${s}` }, { text: "7 days", callback_data: `due:7:${s}` }],
        [{ text: "14 days", callback_data: `due:14:${s}` }, { text: "30 days", callback_data: `due:30:${s}` }],
        [{ text: "Cancel", callback_data: `act:cancel:${s}` }],
      ],
    },
  });
}

async function showConfirm(session) {
  session.state = TG_STATE.CONFIRM;
  session.step += 1;
  // Mint the invoice id once at the confirm screen so a redelivered Confirm is idempotent.
  if (!session.draftInvoiceId) session.draftInvoiceId = makeId();
  setTelegramSession(session.chatId, session);
  const s = session.step;
  const lines = [
    "Confirm invoice:",
    "",
    `Client: ${session.draft.clientName}`,
    `Amount: ${Number(session.draft.amount).toFixed(2)} USDC`,
    `Due: ${formatTelegramDate(session.draft.dueDateIso)}`,
  ];
  await sendTelegramMessage(getTelegramToken(), session.chatId, lines.join("\n"), {
    reply_markup: {
      inline_keyboard: [[
        { text: "Confirm", callback_data: `act:confirm:${s}` },
        { text: "Cancel", callback_data: `act:cancel:${s}` },
      ]],
    },
  });
}

async function showDone(session, invoice) {
  session.state = TG_STATE.DONE;
  session.step += 1;
  session.lastInvoiceId = invoice.id;
  session.draftInvoiceId = "";
  session.draft = { clientName: "", amount: 0, dueChoice: "", dueDateIso: "" };
  setTelegramSession(session.chatId, session);
  const link = `${getPublicBaseUrl()}/pay/${invoice.id}`;
  await sendTelegramMessage(getTelegramToken(), session.chatId, ["Invoice created.", "", link].join("\n"), {
    reply_markup: { inline_keyboard: [[{ text: "New invoice", callback_data: `act:create:${session.step}` }]] },
  });
}

// Typed input (client name, amount) and the /start command.
async function handleTelegramText(chatId, rawText) {
  const text = String(rawText || "");
  const lower = text.trim().toLowerCase();
  if (lower === "/start" || lower.startsWith("/start ")) {
    await handleTelegramStart(chatId);
    return true;
  }

  const wallet = resolveWalletByChatId(chatId);
  if (!wallet) return false; // Unlinked: only /start is meaningful.

  let session = getTelegramSession(chatId);
  if (!session || session.merchantWallet !== wallet) {
    session = freshSession(chatId, wallet);
    await showMainMenu(session);
    return true;
  }

  if (session.state === TG_STATE.ASK_CLIENT) {
    const name = text.trim().slice(0, 160);
    if (!name) {
      await sendTelegramMessage(getTelegramToken(), chatId, "Please send a client name.");
      return true;
    }
    session.draft.clientName = name;
    await showAskAmount(session);
    return true;
  }

  if (session.state === TG_STATE.ASK_AMOUNT) {
    const amount = parseTelegramAmount(text);
    if (amount === null) {
      await sendTelegramMessage(getTelegramToken(), chatId, "Enter an amount greater than 0, for example 25 or 25.50.");
      return true;
    }
    session.draft.amount = amount;
    await showAskDue(session);
    return true;
  }

  await sendTelegramMessage(getTelegramToken(), chatId, "Please use the buttons above.");
  return true;
}

// Inline-button taps.
async function handleTelegramCallback(cq) {
  const chatId = cq && cq.message && cq.message.chat ? String(cq.message.chat.id) : null;
  if (!chatId) {
    await answerCallbackQuery(cq && cq.id);
    return;
  }

  const wallet = resolveWalletByChatId(chatId);
  if (!wallet) {
    await answerCallbackQuery(cq.id, "Please send /start to begin.");
    return;
  }

  const [ns, value, stepRaw] = String(cq.data || "").split(":");
  const step = Number(stepRaw);

  let session = getTelegramSession(chatId);
  if (!session || session.merchantWallet !== wallet) {
    await answerCallbackQuery(cq.id);
    session = freshSession(chatId, wallet);
    await showMainMenu(session, "Let's start over. What would you like to do?");
    return;
  }

  if (!Number.isFinite(step) || step !== session.step) {
    await answerCallbackQuery(cq.id, "This button has expired. Use the latest message.");
    return;
  }

  await answerCallbackQuery(cq.id);

  if (ns === "act" && value === "cancel") {
    await showMainMenu(session, "Cancelled. What would you like to do?");
    return;
  }
  if (ns === "act" && value === "create") {
    await showAskClient(session);
    return;
  }
  if (ns === "act" && value === "mine") {
    await showMyInvoices(session);
    return;
  }
  if (ns === "act" && value === "chatid") {
    await showChatId(session);
    return;
  }
  if (ns === "due" && session.state === TG_STATE.ASK_DUE) {
    const days = Number(value);
    if ([3, 7, 14, 30].includes(days)) {
      session.draft.dueChoice = String(days);
      session.draft.dueDateIso = new Date(Date.now() + days * 86400000).toISOString();
      await showConfirm(session);
    }
    return;
  }
  if (ns === "act" && value === "confirm" && session.state === TG_STATE.CONFIRM) {
    await confirmAndCreateInvoice(session);
    return;
  }
  // Unknown or legacy callback: already acknowledged, nothing to do.
}

// Create the invoice on Confirm. Re-validates the link, forces merchantWallet to
// the resolved wallet (a bot user can only invoice for their own wallet), and is
// idempotent via the draft invoice id minted at the confirm screen.
async function confirmAndCreateInvoice(session) {
  const chatId = session.chatId;
  const wallet = resolveWalletByChatId(chatId);
  if (!wallet || wallet !== session.merchantWallet) {
    clearTelegramSession(chatId);
    await sendTelegramMessage(getTelegramToken(), chatId, "Your Telegram link changed. Send /start to reconnect.");
    return;
  }

  if (session.draftInvoiceId) {
    const existing = loadInvoiceDb().invoices.find((inv) => inv.id === session.draftInvoiceId);
    if (existing) {
      await showDone(session, existing);
      return;
    }
  }

  let invoice;
  try {
    const clientName = session.draft.clientName;
    invoice = createInvoiceRecord({
      id: session.draftInvoiceId || makeId(),
      merchantWallet: wallet,
      clientName,
      dueDate: session.draft.dueDateIso,
      items: [{ description: `Invoice for ${clientName}`.slice(0, 220), quantity: 1, unitPrice: session.draft.amount, total: session.draft.amount }],
      total: session.draft.amount,
    });
  } catch (error) {
    clearTelegramSession(chatId);
    await sendTelegramMessage(getTelegramToken(), chatId, `Could not create the invoice: ${error.message || "unknown error"}. Send /start to try again.`);
    return;
  }
  await showDone(session, invoice);
}

async function setTelegramCommands() {
  const token = getTelegramToken();
  if (!token || telegramCommandsReady) return;
  await requestTelegram("setMyCommands", {
    commands: [
      { command: "start", description: "Open Fundline" },
    ],
  });
  telegramCommandsReady = true;
}

// Parse a thrown Telegram API error ("Telegram API <status>: <json>") into a
// structured shape so callers can react to specific codes (e.g. 401).
function parseTelegramError(err) {
  const raw = err && err.message ? String(err.message) : "Unknown error";
  const m = raw.match(/Telegram API (\d+): (.+)/);
  if (m) {
    try {
      const parsed = JSON.parse(m[2]);
      return {
        code: Number(parsed.error_code) || Number(m[1]) || 0,
        description: parsed.description || "",
        text: `error_code=${parsed.error_code} description=${parsed.description}`,
      };
    } catch (_) {
      return { code: Number(m[1]) || 0, description: m[2], text: `error_code=${m[1]} ${m[2]}` };
    }
  }
  return { code: 0, description: raw, text: raw };
}

const TELEGRAM_BAD_TOKEN_HINT =
  "Telegram rejected the bot token (401 Unauthorized). The token is invalid or was regenerated in BotFather. Update TELEGRAM_BOT_TOKEN on the server and restart.";

async function sendTelegramMessage(token, chatId, text, options = {}) {
  if (!token) return { ok: false, error: "TELEGRAM_BOT_TOKEN is not configured" };
  if (!chatId) return { ok: false, error: "Telegram chat ID is empty" };
  try {
    const result = await requestTelegramWithToken(token, "sendMessage", {
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      ...options,
    });
    console.log("[Telegram] sendMessage ok, chat_id:", chatId);
    return { ok: true, result };
  } catch (err) {
    const parsed = parseTelegramError(err);
    const userError = parsed.code === 401 ? TELEGRAM_BAD_TOKEN_HINT : parsed.text;
    const maskedToken = token ? token.substring(0, 8) + "..." + token.slice(-4) : "(empty)";
    console.error(`[Telegram] sendMessage FAILED token=${maskedToken} chat_id=${chatId}: ${parsed.text}`);
    return { ok: false, error: userError };
  }
}

function requestTelegram(method, payload) {
  return requestTelegramWithToken(getTelegramToken(), method, payload);
}

function requestTelegramWithToken(token, method, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const request = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${token}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode >= 200 && response.statusCode < 300) {
            try {
              resolve(JSON.parse(responseBody || "{}"));
            } catch {
              resolve({});
            }
            return;
          }
          reject(new Error(`Telegram API ${response.statusCode}: ${responseBody || "request failed"}`));
        });
      },
    );
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function getTelegramToken() {
  return String(process.env.TELEGRAM_BOT_TOKEN || process.env.FUNDLINE_TELEGRAM_BOT_TOKEN || process.env.ARC_INVOICE_TELEGRAM_BOT_TOKEN || "").trim();
}

// Seconds the Telegram getUpdates long-poll holds the connection. Telegram caps
// this server-side; keep a safe upper bound. Default 25s for snappy taps.
function getTelegramLongPollSeconds() {
  const configured = Number(process.env.TELEGRAM_LONG_POLL_SECONDS || 0);
  return Number.isFinite(configured) && configured >= 1 && configured <= 50 ? configured : 25;
}

function rpcRequest(method, params = []) {
  return new Promise((resolve, reject) => {
    const endpoint = new URL(ARC_RPC_URL);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method,
      params,
    });
    const transport = endpoint.protocol === "http:" ? http : https;
    const request = transport.request(
      endpoint,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => {
          responseBody += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Arc RPC ${response.statusCode}: ${responseBody || "request failed"}`));
            return;
          }
          try {
            const payload = JSON.parse(responseBody || "{}");
            if (payload.error) {
              reject(new Error(payload.error.message || "Arc RPC returned an error"));
              return;
            }
            resolve(payload.result);
          } catch {
            reject(new Error("Arc RPC returned invalid JSON"));
          }
        });
      },
    );
    request.setTimeout(15000, () => {
      request.destroy(new Error("Arc RPC request timed out"));
    });
    request.on("error", reject);
    request.write(body);
    request.end();
  });
}

function normalizeReceiptLog(log) {
  return {
    address: normalizeAddress(log.address),
    topics: Array.isArray(log.topics) ? log.topics.map((topic) => String(topic || "").toLowerCase()) : [],
    data: String(log.data || "0x").toLowerCase(),
  };
}

function topicToAddress(topic) {
  const text = String(topic || "").toLowerCase();
  return /^0x[0-9a-f]{64}$/.test(text) ? normalizeAddress(`0x${text.slice(-40)}`) : "";
}

function dataWords(data) {
  const text = String(data || "").replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]*$/.test(text)) return [];
  const words = [];
  for (let index = 0; index < text.length; index += 64) {
    const word = text.slice(index, index + 64);
    if (word.length === 64) words.push(`0x${word}`);
  }
  return words;
}

function hexToNumber(value) {
  const text = String(value || "");
  return /^0x[0-9a-f]+$/i.test(text) ? Number.parseInt(text, 16) : "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function handleGatewayBalance(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const data = await requestGatewayJson("POST", "/balances", body);
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[Gateway] balance error:", error.message);
    sendJson(res, 502, { error: { code: "GATEWAY_ERROR", message: error.message } });
  }
}

async function handleGatewayEstimate(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const data = await requestGatewayJson("POST", "/transfer/estimate", body);
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[Gateway] estimate error:", error.message);
    sendJson(res, 502, { error: { code: "GATEWAY_ERROR", message: error.message } });
  }
}

async function handleGatewayTransfer(req, res) {
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  try {
    const body = await readJsonBody(req);
    const data = await requestGatewayJson("POST", "/transfer", body);
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[Gateway] transfer error:", error.message);
    sendJson(res, 502, { error: { code: "GATEWAY_ERROR", message: error.message } });
  }
}

async function handleGatewayStatus(req, res, transferId) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  try {
    const data = await requestGatewayJson("GET", `/transfer/${encodeURIComponent(transferId)}`, null);
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[Gateway] status error:", error.message);
    sendJson(res, 502, { error: { code: "GATEWAY_ERROR", message: error.message } });
  }
}

// Format a raw USDC unit string (6 decimals) as a human decimal string.
function memoFormatUsdc(unitsStr, decimals) {
  const n = BigInt(unitsStr);
  const divisor = BigInt(10) ** BigInt(decimals);
  const whole = n / divisor;
  const fraction = (n % divisor).toString().padStart(decimals, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

// Read-only reconciliation of an invoice paid via an Arc Transaction Memo. Given a bytes32
// invoiceId (the memoId), it scans the Memo contract's events for that id and pairs each
// memo with the USDC Transfer in the same tx to recover payer, recipient, and amount.
// This never moves funds and never writes state; it only reads chain data.
async function handleMemoReconcile(req, res, invoiceId) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  const id = String(invoiceId || "").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(id)) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "invoiceId must be a 0x-prefixed bytes32" } });
    return;
  }
  try {
    const latestHex = await rpcRequest("eth_blockNumber", []);
    const latest = parseInt(latestHex, 16) || 0;
    const filter = { address: MEMO_CONTRACT_ADDRESS, topics: [MEMO_EVENT_TOPIC, null, null, id] };

    let logs;
    try {
      logs = await rpcRequest("eth_getLogs", [{ ...filter, fromBlock: "0x0", toBlock: "latest" }]);
    } catch {
      // Some RPCs cap wide ranges; retry over a bounded recent window.
      const from = Math.max(0, latest - 100000);
      logs = await rpcRequest("eth_getLogs", [{ ...filter, fromBlock: "0x" + from.toString(16), toBlock: "latest" }]);
    }

    const payments = [];
    for (const log of Array.isArray(logs) ? logs : []) {
      const payer = "0x" + String(log.topics[1] || "").slice(26);
      const txHash = log.transactionHash;
      const block = parseInt(log.blockNumber, 16) || null;
      let to = null;
      let amountUnits = null;
      const receipt = await rpcRequest("eth_getTransactionReceipt", [txHash]);
      if (receipt && Array.isArray(receipt.logs)) {
        const transfer = receipt.logs.find(
          (l) =>
            normalizeAddress(l.address) === ARC_USDC_TOKEN_ADDRESS &&
            String(l.topics[0] || "").toLowerCase() === ERC20_TRANSFER_TOPIC,
        );
        if (transfer) {
          to = "0x" + String(transfer.topics[2] || "").slice(26);
          amountUnits = BigInt(transfer.data).toString();
        }
      }
      payments.push({
        payer,
        to,
        amountUnits,
        amount: amountUnits ? memoFormatUsdc(amountUnits, ARC_USDC_DECIMALS) : null,
        txHash,
        block,
      });
    }

    sendJson(res, 200, { invoiceId: id, paid: payments.length > 0, count: payments.length, payments });
  } catch (error) {
    console.error("[Memo] reconcile error:", error.message);
    sendJson(res, 502, { error: { code: "MEMO_ERROR", message: error.message } });
  }
}

function requestGatewayJson(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      "Content-Type": "application/json",
      "Accept": "application/json",
    };
    if (CIRCLE_GATEWAY_API_KEY) headers["Authorization"] = `Bearer ${CIRCLE_GATEWAY_API_KEY}`;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const request = https.request(
      {
        hostname: "gateway-api-testnet.circle.com",
        path: `/v1${pathname}`,
        method,
        headers,
      },
      (response) => {
        let responseBody = "";
        response.on("data", (chunk) => { responseBody += chunk; });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Gateway API ${response.statusCode}: ${responseBody || "request failed"}`));
            return;
          }
          try {
            resolve(JSON.parse(responseBody || "{}"));
          } catch {
            reject(new Error("Gateway API returned invalid JSON"));
          }
        });
      }
    );
    request.setTimeout(30000, () => {
      request.destroy(new Error("Gateway API request timed out"));
    });
    request.on("error", reject);
    if (payload) request.write(payload);
    request.end();
  });
}

function requestJson(url) {
  return new Promise((resolve, reject) => {
    const request = https.request(
      url,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "FundlineLocal/1.0",
        },
      },
      (response) => {
        let body = "";
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`Arcscan API ${response.statusCode}: ${body || "request failed"}`));
            return;
          }
          try {
            resolve(JSON.parse(body || "{}"));
          } catch {
            reject(new Error("Arcscan returned invalid JSON"));
          }
        });
      },
    );
    request.setTimeout(15000, () => {
      request.destroy(new Error("Arcscan request timed out"));
    });
    request.on("error", reject);
    request.end();
  });
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text.toLowerCase() : "";
}

function normalizeTxHash(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text.toLowerCase() : "";
}

function normalizeBytes32(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text.toLowerCase() : "";
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sameAddress(left, right) {
  return Boolean(left && right && normalizeAddress(left) === normalizeAddress(right));
}

function isRecentEnough(timestamp, createdAt) {
  if (!createdAt) return true;
  const txTime = new Date(timestamp || "").getTime();
  if (!Number.isFinite(txTime)) return false;
  return txTime >= createdAt.getTime() - 5 * 60 * 1000;
}

function parseUnitsValue(value) {
  const text = String(value ?? "0").replace(/\D/g, "");
  return text ? BigInt(text) : 0n;
}

function amountToUnits(amount, decimals) {
  const normalizedDecimals = Number.isFinite(decimals) ? Math.min(Math.max(decimals, 0), 18) : 6;
  // Use exact integer arithmetic on the decimal string. Number.toFixed adds
  // float rounding noise at high precision (e.g. (0.1).toFixed(18) yields
  // "0.100000000000000006"), which skews the 18-decimal native-transfer compare.
  // This mirrors parseTokenUnits in app.js so the client (amount paid) and the
  // server (expected amount) always agree exactly at any decimal count.
  const text = String(amount || "0").replace(/,/g, "").trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(whole) * 10n ** BigInt(normalizedDecimals) + BigInt(fraction || "0");
}

function toRpcQuantity(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? `0x${Math.trunc(number).toString(16)}` : "";
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

// --- DASHBOARD & STOREFRONT ---

function requireSellerAuth(req, res) {
  const wallet = normalizeAddress(req.headers["x-fundline-wallet"]);
  const signature = String(req.headers["x-fundline-signature"] || "");
  const issuedAt = req.headers["x-fundline-issued-at"];

  if (!wallet || !signature || !issuedAt) {
    sendJson(res, 401, { error: "Missing authentication headers" });
    return null;
  }

  const issuedDate = new Date(issuedAt);
  if (isNaN(issuedDate.getTime()) || Date.now() - issuedDate.getTime() > 24 * 60 * 60 * 1000 || issuedDate.getTime() > Date.now() + 60000) {
    sendJson(res, 401, { error: "Signature expired or invalid. Please sign in again." });
    return null;
  }

  const message = [
    "Sign in to Fundline",
    "",
    "This signature proves you control this wallet.",
    "It does not move funds or create an on-chain transaction.",
    "",
    `Issued at: ${issuedAt}`,
  ].join("\n");

  try {
    const recovered = normalizeAddress(ethers.verifyMessage(message, signature));
    if (recovered !== wallet) {
      sendJson(res, 401, { error: "Invalid signature: recovered address does not match claimed wallet" });
      return null;
    }
    return recovered;
  } catch (err) {
    sendJson(res, 401, { error: "Invalid signature format" });
    return null;
  }
}

function loadProductDb() {
  ensureDataDir();
  if (!fs.existsSync(PRODUCT_DB_PATH)) return { products: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(PRODUCT_DB_PATH, "utf8"));
    return { products: Array.isArray(parsed.products) ? parsed.products : [] };
  } catch {
    return { products: [] };
  }
}

function saveProductDb(db) {
  ensureDataDir();
  fs.writeFileSync(PRODUCT_DB_PATH, `${JSON.stringify({ products: db.products || [] }, null, 2)}\n`);
}

async function handleDashboardSummary(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return; // Error already sent

  const db = loadInvoiceDb();
  const invoices = db.invoices.filter(inv => sameAddress(inv.merchantWallet, sellerId));
  
  let totalRevenue = 0;
  const counts = { open: 0, paid: 0, expired: 0 };
  
  invoices.forEach(inv => {
    if (inv.status === "paid") {
      counts.paid++;
      totalRevenue += Number(inv.total || 0);
    } else if (inv.status === "open" || inv.status === "verifying") {
      counts.open++;
    } else if (inv.status === "expired") {
      counts.expired++;
    }
  });

  const attemptsDb = loadPaymentAttemptDb();
  
  const paymentHistory = invoices.map(inv => {
    const successfulAttempt = attemptsDb.attempts.find(a => a.invoiceId === inv.id && a.status === "verified");
    return {
      id: inv.id,
      number: inv.number,
      payerWallet: inv.payerWallet || (successfulAttempt ? successfulAttempt.payerWallet : ""),
      total: Math.round(Number(inv.total || 0) * 1e6),
      txHash: inv.txHash || (successfulAttempt ? successfulAttempt.txHash : ""),
      status: inv.status,
      createdAt: inv.createdAt,
      paidAt: inv.paidAt
    };
  }).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const customersMap = {};
  invoices.forEach(inv => {
    if (inv.status === "paid" && inv.payerWallet) {
      const payer = normalizeAddress(inv.payerWallet);
      if (!customersMap[payer]) {
        customersMap[payer] = { wallet: payer, count: 0, lastSeen: inv.paidAt };
      }
      customersMap[payer].count++;
      if (new Date(inv.paidAt).getTime() > new Date(customersMap[payer].lastSeen).getTime()) {
        customersMap[payer].lastSeen = inv.paidAt;
      }
    }
  });
  
  const customers = Object.values(customersMap).sort((a, b) => new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime());

  sendJson(res, 200, {
    revenue: Math.round(totalRevenue * 1e6),
    counts,
    paymentHistory,
    customers
  });
}

async function handleProducts(req, res, url) {
  if (req.method === "GET") {
    const hasAuth = req.headers["x-fundline-wallet"] && req.headers["x-fundline-signature"] && req.headers["x-fundline-issued-at"];
    let authenticatedSellerId = null;
    
    if (hasAuth) {
      authenticatedSellerId = requireSellerAuth(req, res);
      if (!authenticatedSellerId) return; // 401 already sent
    }

    const sellerId = normalizeAddress(url.searchParams.get("sellerId"));
    const db = loadProductDb();
    let products = db.products;

    if (authenticatedSellerId) {
      products = products.filter(p => sameAddress(p.sellerId, authenticatedSellerId));
    } else if (sellerId) {
      products = products.filter(p => sameAddress(p.sellerId, sellerId) && p.active !== false);
    } else {
      // If neither auth nor sellerId, return active only
      products = products.filter(p => p.active !== false);
    }

    sendJson(res, 200, { products });
    return;
  }

  if (req.method === "POST") {
    const sellerId = requireSellerAuth(req, res);
    if (!sellerId) return;

    try {
      const input = await readJsonBody(req);
      const product = {
        id: crypto.randomUUID().replace(/-/g, ""),
        sellerId,
        title: String(input.title || "").trim(),
        description: String(input.description || "").trim(),
        priceUSDC: Number(input.priceUSDC || 0),
        active: input.active !== false,
        createdAt: new Date().toISOString()
      };
      
      if (!product.title) throw new Error("Title is required");
      if (product.priceUSDC <= 0) throw new Error("Price must be > 0");

      const db = loadProductDb();
      db.products = [product, ...db.products];
      saveProductDb(db);
      
      sendJson(res, 201, { product });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleProductById(req, res, productId) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  const db = loadProductDb();
  const index = db.products.findIndex(p => p.id === productId);
  const product = index >= 0 ? db.products[index] : null;

  if (!product) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Product not found" } });
    return;
  }

  if (!sameAddress(product.sellerId, sellerId)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (req.method === "PATCH") {
    try {
      const input = await readJsonBody(req);
      const updated = { ...product };
      if (input.title !== undefined) updated.title = String(input.title).trim();
      if (input.description !== undefined) updated.description = String(input.description).trim();
      if (input.priceUSDC !== undefined) updated.priceUSDC = Number(input.priceUSDC);
      if (input.active !== undefined) updated.active = Boolean(input.active);
      
      if (!updated.title) throw new Error("Title is required");
      if (updated.priceUSDC <= 0) throw new Error("Price must be > 0");

      db.products[index] = updated;
      saveProductDb(db);
      sendJson(res, 200, { product: updated });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message } });
    }
    return;
  }

  if (req.method === "DELETE") {
    db.products.splice(index, 1);
    saveProductDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}


// Public read of a seller's display name (the name already appears on public invoices,
// so it is safe to expose; telegram and alerts stay behind the authenticated settings).
function handleSellerProfile(req, res, wallet) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  const normalized = normalizeAddress(wallet);
  const db = loadSellerDb();
  const seller = normalized ? db.sellers[normalized] : null;
  sendJson(res, 200, { wallet: normalized, displayName: String(seller?.displayName || "") });
}

async function handleDashboardSettings(req, res) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  if (req.method === "GET") {
    const db = loadSellerDb();
    const existing = db.sellers[sellerId] || { wallet: sellerId, displayName: "", telegramChatId: "", alerts: { paid: true, failed: true, overdue: true } };
    const settings = { displayName: "", ...existing };
    sendJson(res, 200, { settings });
    return;
  }

  if (req.method === "PUT") {
    try {
      const patch = await readJsonBody(req);
      const db = loadSellerDb();
      const existing = db.sellers[sellerId] || { wallet: sellerId, displayName: "", telegramChatId: "", alerts: { paid: true, failed: true, overdue: true } };

      const alerts = { ...existing.alerts };
      if (patch.alerts) {
        if (typeof patch.alerts.paid === "boolean") alerts.paid = patch.alerts.paid;
        if (typeof patch.alerts.failed === "boolean") alerts.failed = patch.alerts.failed;
        if (typeof patch.alerts.overdue === "boolean") alerts.overdue = patch.alerts.overdue;
      }

      const nextChatId = patch.telegramChatId !== undefined ? String(patch.telegramChatId).trim() : existing.telegramChatId;
      db.sellers[sellerId] = {
        wallet: sellerId,
        displayName: patch.displayName !== undefined ? String(patch.displayName).trim().slice(0, 120) : (existing.displayName || ""),
        telegramChatId: nextChatId,
        alerts
      };
      // Maintain the confirmed 1:1 chatId<->wallet link store, but only when the
      // chatId actually changed so a confirmed link is not reset to pending on an
      // unrelated settings save (e.g. just toggling an alert).
      if (patch.telegramChatId !== undefined && String(nextChatId).trim() !== String(existing.telegramChatId || "").trim()) {
        claimTelegramChatId(db, sellerId, nextChatId);
      }
      saveSellerDb(db);
      sendJson(res, 200, { settings: db.sellers[sellerId] });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleDashboardWebhooks(req, res) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  if (req.method === "GET") {
    const db = loadWebhookDb();
    const webhooks = db.webhooks.filter((w) => sameAddress(w.merchantWallet, sellerId));
    sendJson(res, 200, { webhooks: webhooks.map(redactWebhook) });
    return;
  }

  if (req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      input.merchantWallet = sellerId;
      const webhook = normalizeWebhook(input);
      const db = loadWebhookDb();
      db.webhooks = [webhook, ...db.webhooks];
      saveWebhookDb(db);
      sendJson(res, 201, { webhook: redactWebhook(webhook), secret: webhook.secret });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message } });
    }
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleDashboardWebhookById(req, res, webhookId) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  const db = loadWebhookDb();
  const index = db.webhooks.findIndex(w => w.id === webhookId);
  if (index < 0) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Webhook not found" } });
    return;
  }
  const webhook = db.webhooks[index];
  if (!sameAddress(webhook.merchantWallet, sellerId)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  if (req.method === "PATCH") {
    try {
      const patch = await readJsonBody(req);
      const updated = normalizeWebhookPatch(webhook, patch);
      db.webhooks[index] = updated;
      saveWebhookDb(db);
      sendJson(res, 200, { webhook: redactWebhook(updated) });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message } });
    }
    return;
  }

  if (req.method === "DELETE") {
    db.webhooks.splice(index, 1);
    saveWebhookDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleDashboardWebhookLogs(req, res) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  if (req.method === "GET") {
    const db = loadWebhookLogDb();
    const logs = db.logs.filter((log) => sameAddress(log.merchantWallet, sellerId));
    sendJson(res, 200, { logs: logs.slice(0, 100).map(redactWebhookLog) });
    return;
  }

  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleDashboardWebhookLogResend(req, res, logId) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }

  const db = loadWebhookLogDb();
  const log = db.logs.find((l) => l.id === logId);
  if (!log) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Log not found" } });
    return;
  }
  if (!sameAddress(log.merchantWallet, sellerId)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  const webhookDb = loadWebhookDb();
  const webhook = webhookDb.webhooks.find(w => w.id === log.webhookId);
  if (!webhook) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Webhook endpoint no longer exists" } });
    return;
  }

  const invoiceDb = loadInvoiceDb();
  const invoice = invoiceDb.invoices.find(i => i.id === log.invoiceId);
  if (!invoice) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Associated invoice no longer exists" } });
    return;
  }

  const eventId = log.event === "invoice.paid" && invoice.webhookEventId ? invoice.webhookEventId : `${invoice.id}-${log.event}`;

  try {
    const result = await sendWebhookWithLog(webhook, log.payload, invoice, eventId);
    sendJson(res, 200, { result });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Failed to resend webhook" });
  }
}


async function handleDashboardApiKeys(req, res, wallet, url) {
  const db = loadApiKeyDb();
  if (req.method === "GET") {
    const keys = db.apiKeys.filter(k => sameAddress(k.sellerId, wallet)).map(k => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      createdAt: k.createdAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt
    }));
    sendJson(res, 200, { apiKeys: keys });
    return;
  }
  if (req.method === "POST") {
    try {
      const body = await readJsonBody(req);
      const name = String(body.name || "Agent Key").trim().slice(0, 100);
      const randomPart = crypto.randomBytes(24).toString('hex');
      const fullKey = `fdl_live_${randomPart}`;
      const keyHash = crypto.createHash("sha256").update(fullKey).digest("hex");
      const keyPrefix = fullKey.substring(0, 17); // fdl_live_ + 8 chars
      
      const record = {
        id: crypto.randomBytes(8).toString('hex'),
        sellerId: normalizeAddress(wallet),
        name,
        keyPrefix,
        keyHash,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        revokedAt: null
      };
      db.apiKeys.push(record);
      saveApiKeyDb(db);
      
      sendJson(res, 201, { apiKey: { ...record, secret: fullKey } });
    } catch (err) {
      sendJson(res, 400, { error: { code: "BAD_REQUEST", message: "Failed to create API key" } });
    }
    return;
  }
  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}

async function handleDashboardApiKeyById(req, res, wallet, keyId) {
  if (req.method === "DELETE") {
    const db = loadApiKeyDb();
    const index = db.apiKeys.findIndex(k => k.id === keyId && sameAddress(k.sellerId, wallet));
    if (index >= 0) {
      db.apiKeys[index].revokedAt = new Date().toISOString();
      saveApiKeyDb(db);
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "API key not found" } });
    }
    return;
  }
  sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
}


async function handleAgentEvents(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;
  if (req.method !== "GET") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  
  const since = url.searchParams.get("since");
  const type = url.searchParams.get("type");
  const db = loadEventDb();
  
  let events = db.events;
  if (req.agentSellerId) {
    events = events.filter(e => sameAddress(e.sellerId, req.agentSellerId));
  }
  if (type) {
    events = events.filter(e => e.type === type);
  }
  if (since) {
    events = events.filter(e => e.createdAt > since || e.id === since || e.createdAt >= since);
  }
  
  events.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)); // Most recent first
  sendJson(res, 200, { events });
}

async function handleAgentVerify(req, res, invoiceId) {
  if (!requireAgentApiKey(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  
  const db = loadInvoiceDb();
  const invoice = db.invoices.find(i => i.id === invoiceId);
  if (!invoice) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
    return;
  }
  if (req.agentSellerId && !sameAddress(invoice.merchantWallet, req.agentSellerId)) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
    return;
  }
  
  // Call handleVerifyPayment, intercepting the response
  let verifyResStatus = 200;
  let verifyResBody = null;
  const mockRes = {
    setHeader: () => {},
    end: (data) => { verifyResBody = data; }
  };
  
  // Actually, handleVerifyPayment uses sendJson(res, status, data), we can monkey-patch mockRes
  mockRes.sendJson = (status, data) => {
    verifyResStatus = status;
    verifyResBody = JSON.stringify(data);
  };
  // But wait, handleVerifyPayment calls sendJson which requires res to have setHeader, writeHead, end
  mockRes.writeHead = (status, headers) => { verifyResStatus = status; };
  
  try {
    await handleVerifyPayment(req, mockRes);
    if (!verifyResBody) throw new Error("No response from verify");
    sendJson(res, verifyResStatus, JSON.parse(verifyResBody));
  } catch (err) {
    sendJson(res, 500, { error: { code: "INTERNAL_ERROR", message: "Verification failed" } });
  }
}

async function handleAgentWebhooksTest(req, res) {
  if (!requireAgentApiKey(req, res)) return;
  if (req.method !== "POST") {
    sendJson(res, 405, { error: { code: "METHOD_NOT_ALLOWED", message: "Method not allowed" } });
    return;
  }
  
  try {
    const body = await readJsonBody(req);
    const merchantWallet = req.agentSellerId || normalizeAddress(body.merchantWallet);
    if (!merchantWallet) throw new Error("merchantWallet is required");
    
    const webhookDb = loadWebhookDb();
    const webhooks = webhookDb.webhooks.filter(w => sameAddress(w.merchantWallet, merchantWallet) && w.enabled);
    
    if (webhooks.length === 0) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "No active webhooks found for this seller" } });
      return;
    }
    
    const testInvoice = { id: makeId(20), total: "1.000000", merchantWallet };
    const payload = { event: "invoice.paid", sentAt: new Date().toISOString(), invoice: testInvoice, test: true };
    const results = await Promise.allSettled(webhooks.map(w => sendWebhookWithLog(w, payload, testInvoice, makeId(10))));
    
    const sent = results.filter(r => r.status === "fulfilled" && r.value !== null).length;
    sendJson(res, 200, { ok: true, sent, total: webhooks.length });
  } catch (err) {
    sendJson(res, 400, { error: { code: "BAD_REQUEST", message: err.message || "Test failed" } });
  }
}

async function handleX402Invoice(req, res, invoiceId) {
  if (!checkRateLimit(req, res, `ip:${req.socket.remoteAddress}`)) return;

  const db = loadInvoiceDb();
  const invoice = db.invoices.find(i => i.id === invoiceId);
  if (!invoice) {
    sendJson(res, 404, { error: { code: "NOT_FOUND", message: "Invoice not found" } });
    return;
  }

  const xpayment = req.headers["x-payment"];
  
  if (!xpayment) {
    // Return 402 with accepts array
    res.writeHead(402, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({
      accepts: [
        {
          scheme: "exact",
          network: "eip155:5042002",
          maxAmountRequired: invoice.total,
          asset: "0x3600000000000000000000000000000000000000",
          payTo: invoice.merchantWallet,
          resource: getRequestBaseUrl(req) + req.url,
          description: invoice.description || "Invoice payment",
          maxTimeoutSeconds: 3600,
          extra: {
            invoiceId: invoice.id,
            onchainInvoiceId: invoice.onchainInvoiceId
          }
        }
      ]
    }));
    return;
  }

  // Parse x-payment
  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(xpayment, "base64").toString("utf8"));
  } catch (e) {
    res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "BAD_REQUEST", message: "Invalid X-PAYMENT header" } }));
    return;
  }

  // Construct mock request for handleVerifyPayment
  const verifyReq = {
    method: "POST",
    headers: { "content-type": "application/json" },
    socket: req.socket,
    bodyData: JSON.stringify({
      invoiceId: invoice.id,
      payerWallet: decoded.payerWallet || decoded.payer,
      txHash: decoded.txHash || decoded.transactionHash
    })
  };
  
  // Custom mock for reading body
  verifyReq.on = (event, cb) => {
    if (event === "data") cb(verifyReq.bodyData);
    if (event === "end") cb();
  };
  
  let verifyResStatus = 200;
  let verifyResBody = null;
  const mockRes = {
    setHeader: () => {},
    writeHead: (status) => { verifyResStatus = status; },
    end: (data) => { verifyResBody = data; }
  };
  
  await handleVerifyPayment(verifyReq, mockRes);
  
  if (verifyResStatus !== 200) {
    // If verify failed, return 402 with reason
    const reason = verifyResBody ? JSON.parse(verifyResBody).error : "Verification failed";
    res.writeHead(402, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ error: { code: "PAYMENT_REQUIRED", message: reason } }));
    return;
  }
  
  // Success! Send 200 with X-PAYMENT-RESPONSE
  const settlement = Buffer.from(JSON.stringify({ txHash: decoded.txHash || decoded.transactionHash })).toString("base64");
  res.setHeader("X-PAYMENT-RESPONSE", settlement);
  
  const updatedInvoice = loadInvoiceDb().invoices.find(i => i.id === invoiceId);
  sendJson(res, 200, { invoice: decorateInvoiceForAgent(updatedInvoice, req) });
}
