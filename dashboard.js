let session = {
  wallet: "",
  signature: "",
  issuedAt: ""
};

const els = {
  walletButton: document.getElementById('walletButton'),
  walletMenu: document.getElementById('walletMenu'),
  walletMenuAddress: document.getElementById('walletMenuAddress'),
  walletDisconnect: document.getElementById('walletDisconnect'),
  storefrontLink: document.getElementById('storefrontLink'),
  gateSection: document.getElementById('gateSection'),
  dashboardSection: document.getElementById('dashboardSection'),
  walletGateConnect: document.getElementById('walletGateConnect'),
  navButtons: document.querySelectorAll('.nav-item'),
  panels: document.querySelectorAll('[data-panel]'),
  
  totalRevenue: document.getElementById('totalRevenue'),
  openCount: document.getElementById('openCount'),
  paidCount: document.getElementById('paidCount'),
  expiredCount: document.getElementById('expiredCount'),
  paymentHistoryList: document.getElementById('paymentHistoryList'),
  customersList: document.getElementById('customersList'),
  
  newProductBtn: document.getElementById('newProductBtn'),
  cancelProductBtn: document.getElementById('cancelProductBtn'),
  productForm: document.getElementById('productForm'),
  productsList: document.getElementById('productsList'),
};

let editingProductId = null;

function formatUsdc(units) {
  const amount = Number(units) / 1e6;
  return new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 }).format(amount) + " USDC";
}

function shortenAddress(address) {
  if (!address) return "";
  return address.slice(0, 6) + "..." + address.slice(-4);
}

function stringToHex(str) {
  let hex = "";
  for (let i = 0; i < str.length; i++) {
    hex += str.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return "0x" + hex;
}

async function connectAndSign() {
  if (!window.ethereum) return alert("Please install a Web3 wallet (e.g. MetaMask).");
  try {
    const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    const address = accounts[0];
    
    const issuedAt = new Date().toISOString();
    const message = [
      "Sign in to Fundline",
      "",
      "This signature proves you control this wallet.",
      "It does not move funds or create an on-chain transaction.",
      "",
      `Issued at: ${issuedAt}`,
    ].join("\n");

    let signature = "";
    try {
      signature = await window.ethereum.request({ method: "personal_sign", params: [stringToHex(message), address] });
    } catch (e) {
      if (Number(e?.code) === 4001) throw e;
      signature = await window.ethereum.request({ method: "personal_sign", params: [message, address] });
    }

    session = { wallet: address, signature, issuedAt };
    localStorage.setItem("fundline_dashboard_session", JSON.stringify(session));
    
    showDashboard();
  } catch (err) {
    if (err.code !== 4001) alert(err.message);
  }
}

function logout() {
  session = { wallet: "", signature: "", issuedAt: "" };
  localStorage.removeItem("fundline_dashboard_session");
  els.dashboardSection.hidden = true;
  els.gateSection.hidden = false;
  els.walletButton.textContent = "Connect Wallet";
  els.walletMenu.hidden = true;

  if (els.paymentHistoryList) els.paymentHistoryList.innerHTML = "";
  if (els.customersList) els.customersList.innerHTML = "";
  if (els.productsList) els.productsList.innerHTML = "";
  if (els.totalRevenue) els.totalRevenue.textContent = "0.00 USDC";
  if (els.openCount) els.openCount.textContent = "0";
  if (els.paidCount) els.paidCount.textContent = "0";
  if (els.expiredCount) els.expiredCount.textContent = "0";

  const webhooksList = document.getElementById("webhooksList");
  if (webhooksList) webhooksList.innerHTML = "";
  const webhookLogsList = document.getElementById("webhookLogsList");
  if (webhookLogsList) webhookLogsList.innerHTML = "";
  const apiKeysList = document.getElementById("apiKeysList");
  if (apiKeysList) apiKeysList.innerHTML = "";
}

async function fetchApi(path, options = {}) {
  const headers = {
    ...options.headers,
    "x-fundline-wallet": session.wallet,
    "x-fundline-signature": session.signature,
    "x-fundline-issued-at": session.issuedAt,
  };
  const res = await fetch(path, { ...options, headers });
  if (res.status === 401) {
    logout();
    throw new Error("Session expired or invalid");
  }
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || "API error");
  return json;
}

async function loadSummary() {
  try {
    const data = await fetchApi("/api/dashboard/summary");
    
    els.totalRevenue.textContent = formatUsdc(data.revenue);
    els.openCount.textContent = data.counts.open;
    els.paidCount.textContent = data.counts.paid;
    els.expiredCount.textContent = data.counts.expired;

    els.paymentHistoryList.innerHTML = data.paymentHistory.map(inv => \`
      <div class="invoice-row">
        <div class="invoice-info">
          <strong class="invoice-title">Invoice \${inv.number} \${inv.payerWallet ? 'from ' + shortenAddress(inv.payerWallet) : ''}</strong>
          <span class="invoice-meta">\${formatUsdc(inv.total)} &bull; \${new Date(inv.createdAt).toLocaleDateString()}</span>
        </div>
        <div class="invoice-status" data-status="\${inv.status}">
          \${inv.txHash ? \`<a href="https://testnet.arcscan.app/tx/\${inv.txHash}" target="_blank" style="text-decoration:none; margin-right:8px">View Tx</a>\` : ''}
          <div class="status-indicator"></div>
          <span>\${inv.status}</span>
        </div>
      </div>
    \`).join('') || '<p>No history</p>';

    els.customersList.innerHTML = data.customers.map(c => \`
      <div class="invoice-row">
        <div class="invoice-info">
          <strong class="invoice-title">\${c.wallet}</strong>
          <span class="invoice-meta">\${c.count} payment(s) &bull; Last seen \${new Date(c.lastSeen).toLocaleDateString()}</span>
        </div>
      </div>
    \`).join('') || '<p>No customers yet</p>';

  } catch (e) {
    console.error(e);
  }
}

async function loadProducts() {
  try {
    const res = await fetchApi("/api/products");
    const myProducts = res.products;

    els.productsList.innerHTML = myProducts.map(p => `
      <div class="invoice-row">
        <div class="invoice-info">
          <strong class="invoice-title">${p.title} ${p.active ? '' : '(Inactive)'}</strong>
          <span class="invoice-meta">${p.priceUSDC} USDC &bull; ${p.description || ''}</span>
        </div>
        <div class="invoice-status">
          <button class="ghost-action" onclick="editProduct('${p.id}')">Edit</button>
        </div>
      </div>
    `).join('') || '<p>No products found</p>';
    window.allProducts = myProducts;
  } catch (e) {
    console.error(e);
  }
}

window.editProduct = function(id) {
  const p = window.allProducts.find(x => x.id === id);
  if (!p) return;
  editingProductId = id;
  els.productForm.elements.title.value = p.title;
  els.productForm.elements.priceUSDC.value = p.priceUSDC;
  els.productForm.elements.description.value = p.description || '';
  els.productForm.elements.active.checked = p.active !== false;
  els.productForm.hidden = false;
};

els.productForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const payload = {
    title: formData.get('title'),
    priceUSDC: Number(formData.get('priceUSDC')),
    description: formData.get('description'),
    active: formData.get('active') === 'on'
  };

  try {
    if (editingProductId) {
      await fetchApi(\`/api/products/\${editingProductId}\`, {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
    } else {
      await fetchApi("/api/products", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
    els.productForm.reset();
    els.productForm.hidden = true;
    editingProductId = null;
    loadProducts();
  } catch (err) {
    alert(err.message);
  }
});

els.newProductBtn.addEventListener('click', () => {
  editingProductId = null;
  els.productForm.reset();
  els.productForm.hidden = false;
});

els.cancelProductBtn.addEventListener('click', () => {
  els.productForm.hidden = true;
});

function showDashboard() {
  els.gateSection.hidden = true;
  els.dashboardSection.hidden = false;
  els.walletButton.textContent = shortenAddress(session.wallet);
  els.walletMenuAddress.textContent = session.wallet;
  els.storefrontLink.href = \`/s/\${session.wallet}\`;
  
  loadSummary();
  loadProducts();
}

els.walletButton.addEventListener('click', () => {
  if (session.wallet) {
    els.walletMenu.hidden = !els.walletMenu.hidden;
  } else {
    connectAndSign();
  }
});

els.walletGateConnect.addEventListener('click', connectAndSign);
els.walletDisconnect.addEventListener('click', logout);

els.navButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    els.navButtons.forEach(b => b.classList.remove('is-active'));
    btn.classList.add('is-active');
    const view = btn.dataset.view;
    els.panels.forEach(p => p.hidden = p.dataset.panel !== view);
    els.productForm.hidden = true;
  });
});

// Init
const stored = localStorage.getItem("fundline_dashboard_session");
if (stored) {
  session = JSON.parse(stored);
  // Check if expired locally
  const issued = new Date(session.issuedAt);
  if (Date.now() - issued.getTime() > 24 * 3600 * 1000) {
    logout();
  } else {
    showDashboard();
  }
}


let webhooks = [];
let webhookLogs = [];

async function loadWebhooks() {
  try {
    const [hooksRes, logsRes] = await Promise.all([
      fetchApi("/api/dashboard/webhooks"),
      fetchApi("/api/dashboard/webhook-logs")
    ]);
    if (hooksRes.ok) {
      const data = await hooksRes.json();
      webhooks = data.webhooks || [];
    }
    if (logsRes.ok) {
      const data = await logsRes.json();
      webhookLogs = data.logs || [];
    }
    renderWebhooks();
    renderWebhookLogs();
  } catch (err) {
    console.error(err);
  }
}

function renderWebhooks() {
  if (!els.webhooksList) return;
  els.webhooksList.innerHTML = webhooks.length ? "" : '<div class="empty-state">No webhooks registered.</div>';
  webhooks.forEach((hook) => {
    const el = document.createElement("article");
    el.className = "invoice-card";
    el.innerHTML = `
      <div class="invoice-main">
        <div class="invoice-summary">
          <strong>${escapeHtml(hook.url)}</strong>
          <span>Event: ${escapeHtml(hook.event)}</span>
          <span class="badge ${hook.enabled ? 'badge-paid' : 'badge-open'}">${hook.enabled ? "Enabled" : "Disabled"}</span>
        </div>
      </div>
      <div class="invoice-actions">
        <button class="ghost-action toggle-webhook" data-id="${hook.id}">${hook.enabled ? "Disable" : "Enable"}</button>
        <button class="danger-action delete-webhook" data-id="${hook.id}">Delete</button>
      </div>
    `;
    els.webhooksList.appendChild(el);
  });
}

function renderWebhookLogs() {
  if (!els.webhookLogsList) return;
  els.webhookLogsList.innerHTML = webhookLogs.length ? "" : '<div class="empty-state">No recent deliveries.</div>';
  webhookLogs.forEach((log) => {
    const el = document.createElement("article");
    el.className = "invoice-card";
    const isOk = log.status === "ok";
    el.innerHTML = `
      <div class="invoice-main">
        <div class="invoice-summary">
          <strong>Event: ${escapeHtml(log.event)}</strong>
          <span>Status: ${log.statusCode}</span>
          <span>Time: ${new Date(log.timestamp).toLocaleString()}</span>
          <span>ID: ${log.deliveryId}</span>
          <span class="badge ${isOk ? 'badge-paid' : 'badge-open'}" ${!isOk ? 'style="color:red;border-color:red;"' : ''}>${isOk ? "OK" : "Failed"}</span>
        </div>
      </div>
      ${!isOk ? `
      <div class="invoice-actions">
        <button class="ghost-action resend-webhook" data-id="${log.id}">Resend</button>
      </div>
      ` : ''}
    `;
    els.webhookLogsList.appendChild(el);
  });
}

els.newWebhookBtn?.addEventListener("click", () => {
  els.webhookForm.hidden = false;
  els.webhookForm.reset();
});

els.cancelWebhookBtn?.addEventListener("click", () => {
  els.webhookForm.hidden = true;
});

els.webhookForm?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = new FormData(els.webhookForm);
  try {
    const res = await fetchApi("/api/dashboard/webhooks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: form.get("url"),
        event: form.get("event"),
        enabled: form.get("enabled") === "on",
      })
    });
    if (!res.ok) throw new Error("Failed to save webhook");
    const data = await res.json();
    alert("Webhook saved! Secret: " + data.secret + "\nKeep this secret to verify signatures.");
    els.webhookForm.hidden = true;
    loadWebhooks();
  } catch(err) {
    alert(err.message);
  }
});

els.webhooksList?.addEventListener("click", async (e) => {
  if (e.target.classList.contains("toggle-webhook")) {
    const id = e.target.dataset.id;
    const hook = webhooks.find(w => w.id === id);
    if (!hook) return;
    try {
      const res = await fetchApi(`/api/dashboard/webhooks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !hook.enabled })
      });
      if (res.ok) loadWebhooks();
    } catch(err) {
      alert(err.message);
    }
  }
  if (e.target.classList.contains("delete-webhook")) {
    if (!confirm("Delete this webhook?")) return;
    const id = e.target.dataset.id;
    try {
      const res = await fetchApi(`/api/dashboard/webhooks/${id}`, { method: "DELETE" });
      if (res.ok) loadWebhooks();
    } catch(err) {
      alert(err.message);
    }
  }
});

els.webhookLogsList?.addEventListener("click", async (e) => {
  if (e.target.classList.contains("resend-webhook")) {
    const id = e.target.dataset.id;
    e.target.disabled = true;
    e.target.textContent = "Resending...";
    try {
      const res = await fetchApi(`/api/dashboard/webhook-logs/${id}/resend`, { method: "POST" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Resend failed");
      }
      alert("Resent successfully!");
      loadWebhooks();
    } catch(err) {
      alert(err.message);
      e.target.disabled = false;
      e.target.textContent = "Resend";
    }
  }
});


// API KEYS
async function loadApiKeys() {
  const data = await fetchApi("/api/dashboard/api-keys");
  const list = document.getElementById("apiKeysList");
  if (!data || !data.apiKeys || !data.apiKeys.length) {
    list.innerHTML = `<div class="empty-state">No API keys found.</div>`;
    return;
  }
  list.innerHTML = data.apiKeys.map(k => `
    <div class="invoice-card" ${k.revokedAt ? 'style="opacity: 0.5;"' : ''}>
      <div class="card-left">
        <span class="invoice-id">${k.name}</span>
        <div class="meta" style="margin-top: 4px;">${k.keyPrefix}••••••••</div>
      </div>
      <div class="card-right">
        <div class="status-badge ${k.revokedAt ? 'failed' : 'paid'}">${k.revokedAt ? 'Revoked' : 'Active'}</div>
        <div class="meta" style="text-align: right; margin-top: 4px;">${k.lastUsedAt ? 'Used ' + new Date(k.lastUsedAt).toLocaleDateString() : 'Never used'}</div>
        ${!k.revokedAt ? `<button class="ghost-action revoke-key" data-id="${k.id}" style="margin-top: 8px;">Revoke</button>` : ''}
      </div>
    </div>
  `).join("");

  document.querySelectorAll(".revoke-key").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      if (!confirm("Are you sure you want to revoke this key? It will immediately stop working.")) return;
      await fetchApi(`/api/dashboard/api-keys/${e.target.dataset.id}`, "DELETE");
      loadApiKeys();
    });
  });
}

document.getElementById("newApiKeyBtn")?.addEventListener("click", () => {
  document.getElementById("apiKeyForm").hidden = false;
  document.getElementById("newApiKeyDisplay").hidden = true;
});
document.getElementById("cancelApiKeyBtn")?.addEventListener("click", () => {
  document.getElementById("apiKeyForm").hidden = true;
});
document.getElementById("apiKeyForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const name = form.name.value;
  const res = await fetchApi("/api/dashboard/api-keys", "POST", { name });
  if (res && res.apiKey) {
    form.hidden = true;
    form.reset();
    const display = document.getElementById("newApiKeyDisplay");
    display.hidden = false;
    document.getElementById("newApiSecretInput").value = res.apiKey.secret;
    loadApiKeys();
  }
});
document.getElementById("copyApiSecretBtn")?.addEventListener("click", () => {
  const input = document.getElementById("newApiSecretInput");
  input.select();
  document.execCommand("copy");
});
