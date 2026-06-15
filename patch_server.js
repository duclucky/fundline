const fs = require('fs');

let serverJs = fs.readFileSync('server.js', 'utf8');

// 1. Add ethers and PRODUCT_DB_PATH
if (!serverJs.includes('require("ethers")')) {
  serverJs = serverJs.replace(
    /const crypto = require\("crypto"\);/,
    `const crypto = require("crypto");\nconst { ethers } = require("ethers");`
  );
}

if (!serverJs.includes('PRODUCT_DB_PATH')) {
  serverJs = serverJs.replace(
    /const WEBHOOK_DB_PATH = path\.join\(DATA_DIR, "webhooks\.json"\);/,
    `const WEBHOOK_DB_PATH = path.join(DATA_DIR, "webhooks.json");\nconst PRODUCT_DB_PATH = path.join(DATA_DIR, "products.json");`
  );
}

// 2. Add route routing in createServer
const routingPatch = `
  if (url.pathname === "/api/dashboard/summary") {
    handleDashboardSummary(req, res);
    return;
  }

  if (url.pathname === "/api/products") {
    handleProducts(req, res, url);
    return;
  }

  const productMatch = url.pathname.match(/^\\/api\\/products\\/([^\\/]+)$/i);
  if (productMatch) {
    handleProductById(req, res, productMatch[1]);
    return;
  }

  if (url.pathname === "/api/telegram/payment-paid") {
`;
if (!serverJs.includes('/api/dashboard/summary')) {
  serverJs = serverJs.replace(
    /if \(url\.pathname === "\/api\/telegram\/payment-paid"\) \{/,
    routingPatch.trim()
  );
}

// 3. Map /dashboard and /s/:seller
const resolvePathPatch = `
function resolveRequestPath(pathname) {
  if (pathname === "/dashboard" || pathname === "/dashboard/") return "/dashboard.html";
  if (pathname.startsWith("/s/")) return "/storefront.html";
  if (pathname === "/docs") return "/docs.html";
  if (pathname === "/") return "/index.html";
  if (pathname === "/app" || pathname === "/app/" || pathname.startsWith("/pay/")) return "/app.html";
  return pathname;
}
`;
if (!serverJs.includes('/dashboard.html')) {
  serverJs = serverJs.replace(
    /function resolveRequestPath\(pathname\) \{[\s\S]*?return pathname;\n\}/,
    resolvePathPatch.trim()
  );
}

// 4. Add handlers at the bottom
const handlers = `
// --- DASHBOARD & STOREFRONT ---

function requireSellerAuth(req, res) {
  const wallet = normalizeAddress(req.headers["x-fundline-wallet"]);
  const signature = req.headers["x-fundline-signature"];
  const issuedAt = req.headers["x-fundline-issued-at"];

  if (!wallet || !signature || !issuedAt) {
    sendJson(res, 401, { error: "Missing authentication headers" });
    return null;
  }

  const issuedDate = new Date(issuedAt);
  if (isNaN(issuedDate.getTime()) || Date.now() - issuedDate.getTime() > 24 * 60 * 60 * 1000) {
    sendJson(res, 401, { error: "Signature expired. Please sign in again." });
    return null;
  }

  const message = [
    "Sign in to Fundline",
    "",
    "This signature proves you control this wallet.",
    "It does not move funds or create an on-chain transaction.",
    "",
    \`Issued at: \${issuedAt}\`,
  ].join("\\n");

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
  fs.writeFileSync(PRODUCT_DB_PATH, \`\${JSON.stringify({ products: db.products || [] }, null, 2)}\\n\`);
}

async function handleDashboardSummary(req, res) {
  if (req.method !== "GET") {
    sendJson(res, 405, { error: "Method not allowed" });
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
    // Find successful attempt if any
    const successfulAttempt = attemptsDb.attempts.find(a => a.invoiceId === inv.id && a.status === "verified");
    return {
      id: inv.id,
      number: inv.number,
      payerWallet: inv.payerWallet || (successfulAttempt ? successfulAttempt.payerWallet : ""),
      total: inv.total,
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
    revenue: totalRevenue,
    counts,
    paymentHistory,
    customers
  });
}

async function handleProducts(req, res, url) {
  if (req.method === "GET") {
    // Public endpoint, but can filter by sellerId
    const sellerId = normalizeAddress(url.searchParams.get("sellerId"));
    const db = loadProductDb();
    let products = db.products;
    if (sellerId) {
      products = products.filter(p => sameAddress(p.sellerId, sellerId) && p.active !== false);
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
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function handleProductById(req, res, productId) {
  const sellerId = requireSellerAuth(req, res);
  if (!sellerId) return;

  const db = loadProductDb();
  const index = db.products.findIndex(p => p.id === productId);
  const product = index >= 0 ? db.products[index] : null;

  if (!product) {
    sendJson(res, 404, { error: "Product not found" });
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
      sendJson(res, 400, { error: err.message });
    }
    return;
  }

  if (req.method === "DELETE") {
    db.products.splice(index, 1);
    saveProductDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}
`;

if (!serverJs.includes('requireSellerAuth')) {
  serverJs += '\n' + handlers;
}

fs.writeFileSync('server.js', serverJs);
console.log("Patched server.js successfully.");
