const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5190);
const ROOT = __dirname;
loadEnvFiles();

const DATA_DIR = path.join(ROOT, "data");
const INVOICE_DB_PATH = path.join(DATA_DIR, "invoices.json");
const WEBHOOK_DB_PATH = path.join(DATA_DIR, "webhooks.json");
const WEBHOOK_LOG_DB_PATH = path.join(DATA_DIR, "webhook-logs.json");
const ARCSCAN_API_BASE = process.env.ARCSCAN_API_BASE || "https://testnet.arcscan.app/api/v2";
const ARCSCAN_EXPLORER_BASE = process.env.ARCSCAN_EXPLORER_BASE || "https://testnet.arcscan.app";
const ARC_USDC_TOKEN_ADDRESS = normalizeAddress(process.env.ARC_USDC_TOKEN_ADDRESS || "0x3600000000000000000000000000000000000000");
const ARC_NATIVE_USDC_DECIMALS = Number(process.env.ARC_NATIVE_USDC_DECIMALS || 18);
const ARC_USDC_DECIMALS = Number(process.env.ARC_USDC_DECIMALS || 6);
const ARC_CHAIN_ID = Number(process.env.ARC_CHAIN_ID || 5042002);
const ARC_RPC_URL = process.env.ARC_RPC_URL || "https://rpc.testnet.arc.network";
const ARC_NETWORK_NAME = process.env.ARC_NETWORK_NAME || "Arc Testnet";
const ARC_PAYMENT_ROUTER_ADDRESS = normalizeAddress(process.env.ARC_PAYMENT_ROUTER_ADDRESS || "");
const TELEGRAM_UPDATE_INTERVAL_MS = getTelegramUpdateIntervalMs();
const ERC20_TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
const INVOICE_PAID_TOPIC = "0x3c732fcd5451057e3d8cb6784128fcc1db83ea499c9d5e0141f37aee34d328db";

let telegramPollTimer = null;
let telegramPollBusy = false;
let telegramUpdateOffset = 0;
let telegramCommandsReady = false;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".sol": "text/plain; charset=utf-8",
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

  if (url.pathname === "/api/telegram/payment-paid") {
    handleTelegramPayment(req, res);
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
  if (pathname === "/docs") return "/docs.html";
  if (pathname === "/") return "/index.html";
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/pay/")) return "/app.html";
  return pathname;
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Fundline running at http://127.0.0.1:${PORT}`);
  startTelegramPolling();
});

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
    sendJson(res, 405, { error: "Method not allowed" });
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
    paymentRouterAddress: ARC_PAYMENT_ROUTER_ADDRESS,
    onchainPaymentsEnabled: Boolean(ARC_PAYMENT_ROUTER_ADDRESS && ARC_USDC_TOKEN_ADDRESS),
  });
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
      const invoice = normalizeInvoice(input);
      const db = loadInvoiceDb();
      if (db.invoices.some((item) => item.id === invoice.id)) {
        sendJson(res, 409, { error: "Invoice ID already exists" });
        return;
      }
      db.invoices = [invoice, ...db.invoices];
      saveInvoiceDb(db);
      sendJson(res, 201, { invoice });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not create invoice" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleAgentInvoices(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method === "GET") {
    const merchantWallet = normalizeAddress(url.searchParams.get("merchantWallet"));
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
      const db = loadInvoiceDb();
      const idempotencyKey = getAgentIdempotencyKey(req, input);
      const merchantWallet = normalizeAddress(input.merchantWallet);
      if (idempotencyKey && merchantWallet) {
        const existing = db.invoices.find((invoice) => sameAddress(invoice.merchantWallet, merchantWallet) && invoice.idempotencyKey === idempotencyKey);
        if (existing) {
          sendJson(res, 200, { invoice: decorateInvoiceForAgent(existing, req), idempotent: true });
          return;
        }
      }
      const invoice = normalizeAgentInvoice({ ...input, idempotencyKey }, db);
      db.invoices = [invoice, ...db.invoices];
      saveInvoiceDb(db);
      sendJson(res, 201, { invoice: decorateInvoiceForAgent(invoice, req) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not create invoice" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleAgentInvoiceById(req, res, invoiceId) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const db = loadInvoiceDb();
  const invoice = db.invoices.find((item) => item.id === invoiceId);
  if (!invoice) {
    sendJson(res, 404, { error: "Invoice not found" });
    return;
  }

  sendJson(res, 200, { invoice: decorateInvoiceForAgent(invoice, req) });
}

async function handleInvoiceById(req, res, invoiceId) {
  const db = loadInvoiceDb();
  const index = db.invoices.findIndex((invoice) => invoice.id === invoiceId);
  const invoice = index >= 0 ? db.invoices[index] : null;

  if (req.method === "GET") {
    if (!invoice) {
      sendJson(res, 404, { error: "Invoice not found" });
      return;
    }
    sendJson(res, 200, { invoice });
    return;
  }

  if (req.method === "PATCH") {
    if (!invoice) {
      sendJson(res, 404, { error: "Invoice not found" });
      return;
    }
    try {
      const patch = await readJsonBody(req);
      const updated = normalizeInvoicePatch(invoice, patch);
      db.invoices[index] = updated;
      saveInvoiceDb(db);
      if (invoice.status !== "paid" && updated.status === "paid") {
        dispatchInvoicePaidWebhooks(updated, req).catch((error) => {
          console.log(`Webhook dispatch failed: ${error.message || "Unknown error"}`);
        });
      }
      sendJson(res, 200, { invoice: updated });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not update invoice" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleAgentWebhooks(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method === "GET") {
    const merchantWallet = normalizeAddress(url.searchParams.get("merchantWallet"));
    const db = loadWebhookDb();
    const webhooks = merchantWallet ? db.webhooks.filter((webhook) => sameAddress(webhook.merchantWallet, merchantWallet)) : db.webhooks;
    sendJson(res, 200, { webhooks: webhooks.map(redactWebhook) });
    return;
  }

  if (req.method === "POST") {
    try {
      const input = await readJsonBody(req);
      const db = loadWebhookDb();
      const webhook = normalizeWebhook(input);
      db.webhooks = [webhook, ...db.webhooks.filter((item) => item.id !== webhook.id)];
      saveWebhookDb(db);
      sendJson(res, 201, { webhook: redactWebhook(webhook) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not save webhook" });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleAgentWebhookById(req, res, webhookId) {
  if (!requireAgentApiKey(req, res)) return;

  const db = loadWebhookDb();
  const webhookIndex = db.webhooks.findIndex((item) => item.id === webhookId);
  const webhook = webhookIndex >= 0 ? db.webhooks[webhookIndex] : null;

  if (req.method === "GET") {
    if (!webhook) {
      sendJson(res, 404, { error: "Webhook not found" });
      return;
    }
    sendJson(res, 200, { webhook: redactWebhook(webhook) });
    return;
  }

  if (req.method === "PATCH") {
    if (!webhook) {
      sendJson(res, 404, { error: "Webhook not found" });
      return;
    }
    try {
      const patch = await readJsonBody(req);
      const updated = normalizeWebhookPatch(webhook, patch);
      db.webhooks[webhookIndex] = updated;
      saveWebhookDb(db);
      sendJson(res, 200, { webhook: redactWebhook(updated) });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Could not update webhook" });
    }
    return;
  }

  if (req.method === "DELETE") {
    if (!webhook) {
      sendJson(res, 404, { error: "Webhook not found" });
      return;
    }
    db.webhooks = db.webhooks.filter((item) => item.id !== webhookId);
    saveWebhookDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleAgentWebhookLogs(req, res, url) {
  if (!requireAgentApiKey(req, res)) return;

  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
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
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  const log = loadWebhookLogDb().logs.find((item) => item.id === logId);
  if (!log) {
    sendJson(res, 404, { error: "Webhook log not found" });
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

function appendWebhookLog(log) {
  const db = loadWebhookLogDb();
  db.logs = [normalizeWebhookLog(log), ...db.logs].slice(0, 500);
  saveWebhookLogDb(db);
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
  if (total <= 0) throw new Error("Invoice total must be greater than 0");

  const status = ["open", "verifying", "paid"].includes(input.status) ? input.status : "open";
  const createdAt = options.allowExistingTimestamps && input.createdAt ? String(input.createdAt) : new Date().toISOString();

  return {
    id,
    number: String(input.number || "").trim().slice(0, 48) || `INV-${new Date().getFullYear()}-${id.slice(0, 6)}`,
    onchainInvoiceId: normalizeBytes32(input.onchainInvoiceId) || "",
    merchantName: String(input.merchantName || "Fundline merchant").trim().slice(0, 120),
    merchantWallet,
    telegramChatId: String(input.telegramChatId || "").trim().slice(0, 64),
    telegramEnabled: Boolean(input.telegramEnabled),
    clientName: String(input.clientName || "").trim().slice(0, 160),
    clientEmail: String(input.clientEmail || "").trim().slice(0, 180),
    dueDate: String(input.dueDate || "").trim().slice(0, 24),
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
  };
}

function normalizeWebhook(input, options = {}) {
  const requestedId = String(input.id || "").trim().toLowerCase();
  const id = /^[a-f0-9]{20}$/i.test(requestedId) ? requestedId : makeId(10);
  const merchantWallet = normalizeAddress(input.merchantWallet);
  if (!merchantWallet) throw new Error("Invalid merchant wallet");

  const event = String(input.event || "invoice.paid").trim();
  if (event !== "invoice.paid") throw new Error("Unsupported webhook event");

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
  const expected = getAgentApiKey();
  if (!expected) {
    sendJson(res, 503, { error: "Missing FUNDLINE_API_KEY in server environment" });
    return false;
  }

  const authorization = String(req.headers.authorization || "");
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  const received = String((bearerMatch && bearerMatch[1]) || req.headers["x-api-key"] || "").trim();
  if (!safeEqualString(received, expected)) {
    sendJson(res, 401, { error: "Invalid or missing API key" });
    return false;
  }

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

function getRequestBaseUrl(req) {
  const host = String(req.headers.host || `127.0.0.1:${PORT}`).trim();
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
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

async function dispatchInvoicePaidWebhooks(invoice, req) {
  const db = loadWebhookDb();
  const webhooks = db.webhooks.filter((webhook) => webhook.enabled && webhook.event === "invoice.paid" && sameAddress(webhook.merchantWallet, invoice.merchantWallet));
  if (!webhooks.length) return { sent: 0 };

  const payload = {
    event: "invoice.paid",
    sentAt: new Date().toISOString(),
    invoice: decorateInvoiceForAgent(invoice, req),
  };

  const results = await Promise.allSettled(webhooks.map((webhook) => sendWebhookWithLog(webhook, payload, invoice)));
  const sent = results.filter((result) => result.status === "fulfilled").length;
  const failed = results.length - sent;
  if (failed) console.log(`Webhook invoice.paid delivered to ${sent}/${results.length} endpoint(s)`);
  return { sent, failed };
}

async function sendWebhookWithLog(webhook, payload, invoice) {
  const deliveryId = makeId(10);
  const startedAt = Date.now();
  try {
    const result = await sendWebhook(webhook, payload, deliveryId);
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

function sendWebhook(webhook, payload, deliveryId = makeId(10)) {
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
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const payerWallet = normalizeAddress(body.payerWallet);
    const merchantWallet = normalizeAddress(body.merchantWallet);
    const amount = Number(body.amount);
    const txHash = normalizeTxHash(body.txHash);
    const onchainInvoiceId = normalizeBytes32(body.onchainInvoiceId);
    const createdAt = body.createdAt ? new Date(body.createdAt) : null;

    if (!payerWallet) {
      sendJson(res, 400, { error: "Payer wallet is required" });
      return;
    }
    if (!merchantWallet) {
      sendJson(res, 400, { error: "Merchant receiving wallet is invalid" });
      return;
    }
    if (sameAddress(payerWallet, merchantWallet)) {
      sendJson(res, 400, { error: "Payer wallet must be different from the receiving wallet" });
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      sendJson(res, 400, { error: "Invoice amount is invalid" });
      return;
    }

    const match = await findArcPayment({
      payerWallet,
      merchantWallet,
      amount,
      onchainInvoiceId,
      createdAt: createdAt && Number.isFinite(createdAt.getTime()) ? createdAt : null,
      txHash,
    });

    if (!match) {
      sendJson(res, 200, {
        verified: false,
        error: "No matching USDC payment was found on Arcscan yet.",
      });
      return;
    }

    sendJson(res, 200, { verified: true, match });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Arcscan verification failed" });
  }
}

async function findArcPayment(criteria) {
  if (criteria.txHash) {
    const receiptMatch = await findPaymentInRpcReceipt(criteria);
    if (receiptMatch) return receiptMatch;
    const transferMatch = await findTokenTransferByTx(criteria);
    if (transferMatch) return transferMatch;
    const txMatch = await findNativeTransferByTx(criteria);
    if (txMatch) return txMatch;
  }

  const transferMatch = await findRecentTokenTransfer(criteria);
  if (transferMatch) return transferMatch;
  return findRecentNativeTransfer(criteria);
}

async function findPaymentInRpcReceipt(criteria) {
  if (!criteria.txHash || !ARC_RPC_URL) return null;
  try {
    const receipt = await rpcRequest("eth_getTransactionReceipt", [criteria.txHash]);
    if (!receipt || String(receipt.status || "").toLowerCase() !== "0x1") return null;
    const logs = Array.isArray(receipt.logs) ? receipt.logs : [];
    const routerEvent = findInvoicePaidLog(logs, criteria);
    const transferEvent = findUsdcTransferLog(logs, criteria);
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
    };
  } catch {
    return null;
  }
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
    if (amount >= expectedAmount) return { ...log, amount };
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
    if (amount >= expectedAmount) return { ...log, amount };
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
  return transfer ? toTokenTransferMatch(transfer) : null;
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
  if (ARC_USDC_TOKEN_ADDRESS && tokenAddress && !sameAddress(tokenAddress, ARC_USDC_TOKEN_ADDRESS) && symbol !== "USDC") return false;
  if (!ARC_USDC_TOKEN_ADDRESS && symbol !== "USDC") return false;

  const decimals = Number(transfer.total?.decimals ?? transfer.token?.decimals ?? 6);
  const rawValue = parseUnitsValue(transfer.total?.value ?? transfer.value);
  const expected = amountToUnits(criteria.amount, Number.isFinite(decimals) ? decimals : 6);
  return rawValue >= expected;
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
    return value >= expected;
  });
  if (!tx) return null;
  const txHash = normalizeTxHash(tx.hash || tx.transaction_hash);
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
    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = await readJsonBody(req);
    const chatId = String(body.chatId || "").trim();
    const invoice = body.invoice || {};
    if (!chatId) {
      sendJson(res, 400, { error: "Telegram chat ID is required" });
      return;
    }
    if (!invoice.number || !invoice.total) {
      sendJson(res, 400, { error: "Invoice number and total are required" });
      return;
    }

    const token = process.env.TELEGRAM_BOT_TOKEN || process.env.FUNDLINE_TELEGRAM_BOT_TOKEN || process.env.ARC_INVOICE_TELEGRAM_BOT_TOKEN;
    if (!token) {
      sendJson(res, 500, { error: "Missing TELEGRAM_BOT_TOKEN in server environment" });
      return;
    }

    await sendTelegramMessage(token, chatId, buildPaymentMessage(invoice));
    sendJson(res, 200, { ok: true });
  } catch (error) {
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

function buildPaymentMessage(invoice) {
  return [
    "Fundline payment received",
    "",
    `Invoice: ${invoice.number}`,
    `Client: ${invoice.clientName || "-"}`,
    `Amount: ${invoice.total}`,
    `Paid at: ${invoice.paidAt || "-"}`,
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

function startTelegramPolling() {
  if (telegramPollTimer || !getTelegramToken()) {
    if (!getTelegramToken()) console.log("Telegram bot: no token loaded");
    return;
  }
  console.log("Telegram bot: polling /start for chat ID");
  setTelegramCommands().catch((error) => console.log(`Telegram command setup failed: ${error.message || "Unknown error"}`));
  pollTelegramUpdates().catch((error) => console.log(`Telegram polling failed: ${error.message || "Unknown error"}`));
  telegramPollTimer = setInterval(() => {
    pollTelegramUpdates().catch((error) => console.log(`Telegram polling failed: ${error.message || "Unknown error"}`));
  }, TELEGRAM_UPDATE_INTERVAL_MS);
}

async function pollTelegramUpdates() {
  const token = getTelegramToken();
  if (!token || telegramPollBusy) return { skipped: true };
  telegramPollBusy = true;

  try {
    const url = new URL(`https://api.telegram.org/bot${token}/getUpdates`);
    url.searchParams.set("timeout", "0");
    if (telegramUpdateOffset) url.searchParams.set("offset", String(telegramUpdateOffset));
    const payload = await requestJson(url);
    if (payload.ok === false) throw new Error(payload.description || "Telegram getUpdates failed");

    const updates = Array.isArray(payload.result) ? payload.result : [];
    let handled = 0;
    for (const update of updates) {
      telegramUpdateOffset = Math.max(Number(telegramUpdateOffset || 0), Number(update.update_id || 0) + 1);
      const message = update.message || update.edited_message;
      const chat = message?.chat;
      if (!chat?.id) continue;

      const text = String(message.text || "").trim().toLowerCase();
      if (text === "/start" || text.startsWith("/start ") || text === "/id" || text === "/chatid") {
        await sendTelegramChatId(chat.id);
        handled += 1;
      }
    }
    return { updates: updates.length, handled };
  } finally {
    telegramPollBusy = false;
  }
}

async function sendTelegramChatId(chatId) {
  const chatIdText = String(chatId);
  await sendTelegramMessage(
    getTelegramToken(),
    chatIdText,
    [
      "Fundline bot is ready.",
      "",
      "Your Telegram chat ID:",
      `<code>${escapeHtml(chatIdText)}</code>`,
      "",
      "Copy this ID into Fundline Settings to receive paid invoice alerts.",
    ].join("\n"),
    {
      parse_mode: "HTML",
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: "Copy chat ID",
              copy_text: { text: chatIdText },
            },
          ],
        ],
      },
    },
  );
}

async function setTelegramCommands() {
  const token = getTelegramToken();
  if (!token || telegramCommandsReady) return;
  await requestTelegram("setMyCommands", {
    commands: [
      { command: "start", description: "Get your Fundline chat ID" },
      { command: "id", description: "Show chat ID again" },
      { command: "chatid", description: "Show chat ID again" },
    ],
  });
  telegramCommandsReady = true;
}

function sendTelegramMessage(token, chatId, text, options = {}) {
  return requestTelegramWithToken(token, "sendMessage", {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
    ...options,
  });
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

function getTelegramUpdateIntervalMs() {
  const configured = Number(process.env.TELEGRAM_UPDATE_INTERVAL_MS || 0);
  return Number.isFinite(configured) && configured >= 3000 ? configured : 8000;
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
  const normalized = Number(amount || 0).toFixed(normalizedDecimals);
  const [whole, fraction = ""] = normalized.split(".");
  const paddedFraction = fraction.padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(`${whole}${paddedFraction}`.replace(/^0+(?=\d)/, "") || "0");
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
