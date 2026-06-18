const STORAGE_KEY = "arc-invoice-usdc-invoices-v1";
const SETTINGS_KEY = "arc-invoice-usdc-settings-v1";
const ARC_EXPLORER_URL = "https://testnet.arcscan.app";
const ARC_USDC_DECIMALS = 6;
const DEFAULT_PUBLIC_CONFIG = {
  networkName: "Arc Testnet",
  chainId: 5042002,
  chainIdHex: "0x4cef52",
  rpcUrl: "https://rpc.testnet.arc.network",
  explorerBase: ARC_EXPLORER_URL,
  usdcTokenAddress: "0x3600000000000000000000000000000000000000",
  usdcDecimals: ARC_USDC_DECIMALS,
  paymentRouterAddress: "0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24",
  onchainPaymentsEnabled: true,
};

const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const ERC20_ALLOWANCE_SELECTOR = "0xdd62ed3e";
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";
const ERC20_DECIMALS_SELECTOR = "0x313ce567";
const PAYMENT_ROUTER_PAY_SELECTOR = "0xe1a9ef45";
const MULTICALL3FROM_ADDRESS = "0x522fAf9A91c41c443c66765030741e4AaCe147D0";
const MULTICALL3_AGGREGATE3_SELECTOR = "0x82ad56cb";
const CCTP_DEPOSIT_FOR_BURN_SELECTOR = "0x8e0250ee";
const CCTP_RECEIVE_MESSAGE_SELECTOR = "0x57ecfd28";
const CCTP_STANDARD_FINALITY_THRESHOLD = 2000;
const CCTP_FAST_FINALITY_THRESHOLD = 1000;
const ZERO_BYTES32 = `0x${"0".repeat(64)}`;
const CCTP_IRIS_SANDBOX_BASE = "https://iris-api-sandbox.circle.com";

const CCTP_TOKEN_MESSENGER_V2 = "0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA";
const CCTP_MESSAGE_TRANSMITTER_V2 = "0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275";
const CCTP_TESTNET_CHAINS = {
  arcTestnet: {
    key: "arcTestnet",
    name: "Arc Testnet",
    shortName: "Arc",
    chainId: 5042002,
    chainIdHex: "0x4cef52",
    domain: 26,
    usdc: "0x3600000000000000000000000000000000000000",
    explorer: ARC_EXPLORER_URL,
    rpcUrls: ["https://rpc.testnet.arc.network"],
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  },
  ethereumSepolia: {
    key: "ethereumSepolia",
    name: "Ethereum Sepolia",
    shortName: "Ethereum Sepolia",
    chainId: 11155111,
    chainIdHex: "0xaa36a7",
    domain: 0,
    usdc: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
    explorer: "https://sepolia.etherscan.io",
    rpcUrls: ["https://ethereum-sepolia-rpc.publicnode.com"],
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
  baseSepolia: {
    key: "baseSepolia",
    name: "Base Sepolia",
    shortName: "Base Sepolia",
    chainId: 84532,
    chainIdHex: "0x14a34",
    domain: 6,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
    rpcUrls: ["https://sepolia.base.org"],
    nativeCurrency: { name: "Sepolia Ether", symbol: "ETH", decimals: 18 },
  },
};

const state = {
  invoices: loadInvoices(),
  settings: loadSettings(),
  publicConfig: { ...DEFAULT_PUBLIC_CONFIG },
  wallet: {
    connected: false,
    address: "",
    balance: "",
    authAt: "",
  },
  walletMenuOpen: false,
  walletConnecting: false,
  invoiceSyncStatus: "idle",
  activeView: "dashboard",
  filter: "all",
};

const els = {
  appPage: document.querySelector("#appPage"),
  payPage: document.querySelector("#payPage"),
  pageEyebrow: document.querySelector("#pageEyebrow"),
  pageTitle: document.querySelector("#pageTitle"),
  walletButton: document.querySelector("#walletButton"),
  walletButtonText: document.querySelector("#walletButtonText"),
  walletControl: document.querySelector("#walletControl"),
  walletMenu: document.querySelector("#walletMenu"),
  walletMenuStatus: document.querySelector("#walletMenuStatus"),
  walletMenuAddress: document.querySelector("#walletMenuAddress"),
  walletMenuBalance: document.querySelector("#walletMenuBalance"),
  walletRefreshBalance: document.querySelector("#walletRefreshBalance"),
  walletDisconnect: document.querySelector("#walletDisconnect"),
  walletGate: document.querySelector("#walletGate"),
  walletGateTitle: document.querySelector("#walletGateTitle"),
  walletGateText: document.querySelector("#walletGateText"),
  walletGateConnect: document.querySelector("#walletGateConnect"),
  navButtons: document.querySelectorAll("[data-view]"),
  panels: document.querySelectorAll("[data-panel]"),
  invoiceList: document.querySelector("#invoiceList"),
  invoiceForm: document.querySelector("#invoiceForm"),
  createInvoiceButton: document.querySelector("#invoiceForm button[type='submit']"),
  lineItems: document.querySelector("#lineItems"),
  addLineItem: document.querySelector("#addLineItem"),
  invoiceTotal: document.querySelector("#invoiceTotal"),
  settingsForm: document.querySelector("#settingsForm"),
  connectWalletSettings: document.querySelector("#connectWalletSettings"),
  sendTelegramTest: document.querySelector("#sendTelegramTest"),
  walletSettingsNote: document.querySelector("#walletSettingsNote"),
  exportCsv: document.querySelector("#exportCsv"),
  filters: document.querySelectorAll("[data-filter]"),
  paidRevenue: document.querySelector("#paidRevenue"),
  openCount: document.querySelector("#openCount"),
  paidCount: document.querySelector("#paidCount"),
  overdueCount: document.querySelector("#overdueCount"),
  dialog: document.querySelector("#invoiceDialog"),
  dialogBody: document.querySelector("#invoiceDialogBody"),
  toast: document.querySelector("#toast"),
};

let toastTimer = null;
let _activeBridgeContext = null; // holds state for retry across both pay paths

init();

async function init() {
  bindEvents();
  await loadPublicConfig();
  if (isPayRoute()) {
    await loadPayInvoice(getPayInvoiceId());
    renderWalletState();
    renderPayPage(getPayInvoiceId());
    return;
  }
  await syncInvoicesFromServer();
  seedLineItems();
  renderApp();
}

function bindEvents() {
  els.navButtons.forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.view) setView(button.dataset.view);
    });
  });

  els.filters.forEach((button) => {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter || "all";
      renderApp();
    });
  });

  els.addLineItem?.addEventListener("click", () => addLineItem());
  els.lineItems?.addEventListener("input", updateInvoiceTotal);
  els.lineItems?.addEventListener("click", handleLineItemAction);
  els.invoiceForm?.addEventListener("submit", createInvoice);
  els.invoiceList?.addEventListener("click", handleInvoiceAction);
  els.settingsForm?.addEventListener("submit", saveSettingsFromForm);
  els.walletButton?.addEventListener("click", handleWalletButton);
  els.walletRefreshBalance?.addEventListener("click", refreshWalletBalance);
  els.walletDisconnect?.addEventListener("click", disconnectWallet);
  els.walletGateConnect?.addEventListener("click", connectWallet);
  els.connectWalletSettings?.addEventListener("click", handleWalletButton);
  els.sendTelegramTest?.addEventListener("click", sendTelegramTestAlert);
  els.exportCsv?.addEventListener("click", exportCsv);
  document.addEventListener("click", handleDocumentClick);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWalletMenu();
  });
  els.dialog?.addEventListener("click", (event) => {
    if (event.target === els.dialog) closeDialog();
  });
  window.ethereum?.on?.("accountsChanged", handleAccountsChanged);
}

function isPayRoute() {
  return window.location.pathname.startsWith("/pay/") || new URLSearchParams(window.location.search).has("pay");
}

function getPayInvoiceId() {
  if (window.location.pathname.startsWith("/pay/")) {
    return window.location.pathname.split("/pay/")[1]?.split("/")[0] || "";
  }
  return new URLSearchParams(window.location.search).get("pay") || "";
}

function setView(view) {
  state.activeView = view || "dashboard";
  renderApp();
}

function renderApp() {
  document.body.classList.remove("payment-mode");
  els.appPage.hidden = false;
  els.payPage.hidden = true;
  const pageCopy = {
    dashboard: ["Non-custodial billing", "USDC invoice dashboard"],
    create: ["Create invoice", "New USDC invoice"],
    settings: ["Merchant settings", "Payment settings"],
  };
  const [eyebrow, title] = pageCopy[state.activeView] || pageCopy.dashboard;
  els.pageEyebrow.textContent = eyebrow;
  els.pageTitle.textContent = title;

  els.navButtons.forEach((button) => {
    if (!button.dataset.view) return;
    button.classList.toggle("is-active", button.dataset.view === state.activeView);
  });

  els.panels.forEach((panel) => {
    const active = panel.dataset.panel === state.activeView;
    panel.hidden = !active;
    panel.classList.toggle("is-active", active);
  });

  els.filters.forEach((button) => button.classList.toggle("is-active", button.dataset.filter === state.filter));

  renderStats();
  renderInvoiceList();
  renderSettings();
  renderWalletState();
  updateInvoiceTotal();
}

function renderWalletState() {
  const connected = hasConnectedWallet();
  const address = getConnectedWallet();
  if (!connected) state.walletMenuOpen = false;
  if (els.walletButtonText) {
    els.walletButtonText.textContent = state.walletConnecting ? "Signing..." : connected ? shortAddress(address) : "Connect wallet";
  }
  els.walletButton?.classList.toggle("is-connected", connected);
  els.walletButton?.setAttribute("title", connected ? "Open wallet details" : "Connect wallet");
  els.walletButton?.setAttribute("aria-expanded", connected && state.walletMenuOpen ? "true" : "false");
  if (els.walletButton) els.walletButton.disabled = state.walletConnecting;

  if (els.walletMenu) {
    els.walletMenu.hidden = !connected || !state.walletMenuOpen;
    els.walletMenuStatus.textContent = connected ? "Signed in" : "Not connected";
    els.walletMenuAddress.textContent = connected ? address : "-";
    els.walletMenuBalance.textContent = connected ? state.wallet.balance || "Checking..." : "-";
  }

  if (els.walletGate) {
    els.walletGate.classList.toggle("is-connected", connected);
    els.walletGateTitle.textContent = connected ? "Wallet connected" : "Connect wallet before creating invoice";
    els.walletGateText.textContent = connected
      ? `${shortAddress(address)} will receive USDC for newly created invoices.`
      : "The connected wallet becomes your USDC receiving wallet for this invoice.";
    els.walletGateConnect.hidden = connected;
  }

  if (els.createInvoiceButton) {
    els.createInvoiceButton.disabled = !connected;
    els.createInvoiceButton.title = connected ? "" : "Connect wallet before creating invoice";
  }

  if (els.settingsForm) {
    els.settingsForm.elements.merchantWallet.value = connected ? address : "";
    if (els.connectWalletSettings) els.connectWalletSettings.textContent = connected ? "Wallet details" : "Connect wallet";
  }

  if (els.walletSettingsNote) {
    els.walletSettingsNote.textContent = connected
      ? `Receiving wallet is locked to the connected wallet: ${shortAddress(address)}.`
      : "Connect wallet to set the USDC receiving address.";
  }
}

function handleDocumentClick(event) {
  if (!state.walletMenuOpen) return;
  if (els.walletControl?.contains(event.target)) return;
  closeWalletMenu();
}

function closeWalletMenu() {
  if (!state.walletMenuOpen) return;
  state.walletMenuOpen = false;
  renderWalletState();
}

function refreshCurrentView() {
  if (isPayRoute()) {
    renderWalletState();
    renderPayPage(getPayInvoiceId());
    return;
  }
  renderApp();
}

function handleWalletButton() {
  if (hasConnectedWallet()) {
    state.walletMenuOpen = !state.walletMenuOpen;
    renderWalletState();
    return;
  }
  connectWallet();
}

async function connectWallet() {
  const provider = window.ethereum;
  if (!provider?.request) {
    showToast("No wallet extension found. Install or open OKX Wallet, MetaMask, or another EVM wallet.");
    return;
  }
  state.walletConnecting = true;
  renderWalletState();
  try {
    const accounts = await provider.request({ method: "eth_requestAccounts" });
    const address = normalizeAddress(accounts?.[0]);
    if (!address) {
      showToast("Wallet did not return a valid address.");
      return;
    }
    const authAt = await requireWalletSignature(provider, address);
    setConnectedWallet(address, { authAt, silent: true });
    await refreshWalletBalance();
    if (!isPayRoute()) await syncInvoicesFromServer();
    refreshCurrentView();
    showToast("Wallet connected.");
  } catch (error) {
    showToast(error?.message || "Wallet connection rejected.");
  } finally {
    state.walletConnecting = false;
    renderWalletState();
  }
}

async function requireWalletSignature(provider, address) {
  const issuedAt = new Date().toISOString();
  const message = [
    "Sign in to Fundline",
    "",
    "This signature proves you control this wallet.",
    "It does not move funds or create an on-chain transaction.",
    "",
    `Wallet: ${address}`,
    `Issued at: ${issuedAt}`,
  ].join("\n");
  let signature = "";
  try {
    signature = await provider.request({
      method: "personal_sign",
      params: [stringToHex(message), address],
    });
  } catch (error) {
    if (Number(error?.code) === 4001) throw error;
    signature = await provider.request({
      method: "personal_sign",
      params: [message, address],
    });
  }
  if (!signature) throw new Error("Wallet signature is required.");
  return issuedAt;
}

async function refreshWalletBalance(event) {
  event?.preventDefault();
  const provider = window.ethereum;
  const address = getConnectedWallet();
  if (!provider?.request || !address) return;
  state.wallet.balance = "Checking...";
  renderWalletState();
  try {
    const rawBalance = await provider.request({
      method: "eth_getBalance",
      params: [address, "latest"],
    });
    state.wallet.balance = `${formatUnits(rawBalance, 18)} USDC`;
  } catch {
    state.wallet.balance = "Unavailable";
  }
  renderWalletState();
}

function disconnectWallet(options = {}) {
  state.wallet = { connected: false, address: "", balance: "", authAt: "" };
  state.walletMenuOpen = false;
  if (!isPayRoute()) {
    state.settings = { ...state.settings, merchantWallet: "" };
    saveSettings();
  }
  
  state.invoices = [];
  saveInvoices();
  
  refreshCurrentView();
  if (!options.silent) showToast("Wallet disconnected.");
}

function setConnectedWallet(address, options = {}) {
  const normalized = normalizeAddress(address);
  if (!normalized) return;
  state.wallet = { connected: true, address: normalized, balance: state.wallet.balance || "", authAt: options.authAt || new Date().toISOString() };
  if (!isPayRoute()) {
    state.settings = { ...state.settings, merchantWallet: normalized };
    saveSettings();
  }
  refreshCurrentView();
  if (!options.silent) showToast(isPayRoute() ? "Payer wallet connected." : "Receiving wallet set from connected wallet.");
}

function handleAccountsChanged(accounts) {
  if (!state.wallet.connected) return;
  const address = normalizeAddress(accounts?.[0]);
  disconnectWallet({ silent: true });
  showToast(address ? "Wallet changed. Please connect and sign again." : "Wallet disconnected.");
}

function hasConnectedWallet() {
  return Boolean(state.wallet.connected && normalizeAddress(state.wallet.address));
}

function getConnectedWallet() {
  return hasConnectedWallet() ? normalizeAddress(state.wallet.address) : "";
}

async function loadPublicConfig() {
  try {
    const response = await fetch("/api/config");
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Config unavailable");
    state.publicConfig = normalizePublicConfig(payload);
  } catch {
    if (await redirectToLocalApiServer()) return;
    state.publicConfig = { ...DEFAULT_PUBLIC_CONFIG };
  }
}

async function redirectToLocalApiServer() {
  const fallbackOrigin = getLocalApiFallbackOrigin();
  if (!fallbackOrigin) return false;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 900);
  try {
    await fetch(`${fallbackOrigin}/api/config`, {
      mode: "no-cors",
      cache: "no-store",
      signal: controller.signal,
    });
    window.location.replace(`${fallbackOrigin}${window.location.pathname}${window.location.search}${window.location.hash}`);
    return true;
  } catch {
    return false;
  } finally {
    window.clearTimeout(timer);
  }
}

function getLocalApiFallbackOrigin() {
  const host = window.location.hostname;
  if (host !== "127.0.0.1" && host !== "localhost") return "";
  if (window.location.port === "5191") return "";
  return "http://127.0.0.1:5191";
}

function getApiUnavailableMessage() {
  const fallbackOrigin = getLocalApiFallbackOrigin();
  return fallbackOrigin
    ? `Invoice API is not available on this page. Open ${fallbackOrigin}/app.html and try again.`
    : "Invoice API is not available. Start the Fundline server and try again.";
}

function normalizePublicConfig(config) {
  const chainId = Number(config.chainId || DEFAULT_PUBLIC_CONFIG.chainId);
  const chainIdHex = /^0x[0-9a-f]+$/i.test(String(config.chainIdHex || ""))
    ? String(config.chainIdHex).toLowerCase()
    : `0x${Math.trunc(chainId).toString(16)}`;
  const usdcTokenAddress = normalizeAddress(config.usdcTokenAddress) || DEFAULT_PUBLIC_CONFIG.usdcTokenAddress;
  const paymentRouterAddress = normalizeAddress(config.paymentRouterAddress) || DEFAULT_PUBLIC_CONFIG.paymentRouterAddress;
  const usdcDecimals = Number(config.usdcDecimals);
  const normalizedUsdcDecimals = Number.isFinite(usdcDecimals) ? Math.min(Math.max(Math.trunc(usdcDecimals), 0), 18) : DEFAULT_PUBLIC_CONFIG.usdcDecimals;
  const paymentTokenDecimals = normalizedUsdcDecimals;
  return {
    networkName: String(config.networkName || DEFAULT_PUBLIC_CONFIG.networkName),
    chainId,
    chainIdHex,
    rpcUrl: String(config.rpcUrl || DEFAULT_PUBLIC_CONFIG.rpcUrl),
    explorerBase: String(config.explorerBase || DEFAULT_PUBLIC_CONFIG.explorerBase).replace(/\/$/, ""),
    usdcTokenAddress,
    usdcDecimals: paymentTokenDecimals,
    paymentRouterAddress,
    onchainPaymentsEnabled: Boolean(paymentRouterAddress && usdcTokenAddress),
  };
}

async function syncInvoicesFromServer() {
  const merchantWallet = getConnectedWallet() || "";
  if (!merchantWallet) {
    state.invoices = [];
    state.invoiceSyncStatus = "ready";
    return;
  }
  state.invoiceSyncStatus = "loading";
  const url = `/api/invoices?merchantWallet=${encodeURIComponent(merchantWallet)}`;
  try {
    const response = await fetch(url);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || `Invoice sync failed: ${response.status}`);
    if (Array.isArray(payload.invoices)) {
      state.invoices = payload.invoices;
      saveInvoices();
    }
    state.invoiceSyncStatus = "ready";
  } catch {
    state.invoiceSyncStatus = "offline-cache";
  }
}

async function loadPayInvoice(invoiceId) {
  if (!invoiceId) return null;
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.invoice) throw new Error(payload.error || "Invoice not found");
    upsertInvoice(payload.invoice);
    saveInvoices();
    return payload.invoice;
  } catch {
    return state.invoices.find((item) => item.id === invoiceId) || null;
  }
}

function upsertInvoice(invoice) {
  const index = state.invoices.findIndex((item) => item.id === invoice.id);
  if (index >= 0) {
    state.invoices[index] = invoice;
  } else {
    state.invoices = [invoice, ...state.invoices];
  }
}

async function createInvoiceOnServer(invoice) {
  const response = await fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(invoice),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.invoice) {
    if (response.status === 404) throw new Error(getApiUnavailableMessage());
    throw new Error(payload.error || "Could not save invoice on server");
  }
  return payload.invoice;
}

async function updateInvoiceOnServer(invoiceId, patch) {
  const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.invoice) throw new Error(payload.error || "Could not update invoice on server");
  return payload.invoice;
}

function renderStats() {
  const paid = state.invoices.filter((invoice) => invoice.status === "paid");
  const open = state.invoices.filter((invoice) => getInvoiceStatus(invoice) === "open");
  const expired = state.invoices.filter((invoice) => getInvoiceStatus(invoice) === "expired");
  const revenue = paid.reduce((sum, invoice) => sum + invoice.total, 0);

  els.paidRevenue.textContent = `${formatUsdc(revenue)} USDC`;
  els.openCount.textContent = String(open.length);
  els.paidCount.textContent = String(paid.length);
  els.overdueCount.textContent = String(expired.length);
}

function renderInvoiceList() {
  const invoices = getFilteredInvoices();
  if (!invoices.length) {
    els.invoiceList.innerHTML = `<div class="empty-state">No invoice found. Create your first USDC invoice.</div>`;
    return;
  }

  els.invoiceList.innerHTML = invoices.map(renderInvoiceRow).join("");
}

function getFilteredInvoices() {
  return state.invoices
    .filter((invoice) => {
      if (state.filter === "paid") return invoice.status === "paid";
      if (state.filter === "open") return getInvoiceStatus(invoice) === "open";
      return true;
    })
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

function renderInvoiceRow(invoice) {
  const status = getInvoiceStatus(invoice);
  const payLink = getInvoicePayLink(invoice);
  const receiptButton =
    invoice.status === "paid"
      ? `<button class="ghost-action" data-action="receipt" data-id="${escapeHtml(invoice.id)}" type="button">PDF</button>`
      : "";

  return `
    <article class="invoice-row">
      <div>
        <strong>${escapeHtml(invoice.number)} - ${escapeHtml(invoice.clientName)}</strong>
        <span>${escapeHtml(invoice.clientEmail || "No client email")}</span>
        <small>Due ${escapeHtml(formatDate(invoice.dueDate))}</small>
      </div>
      <div class="amount">${formatUsdc(invoice.total)} USDC</div>
      <div><span class="status status-${status}">${escapeHtml(status)}</span></div>
      <div class="invoice-actions">
        <button class="ghost-action" data-action="view" data-id="${escapeHtml(invoice.id)}" type="button">View</button>
        <button class="ghost-action" data-action="copy" data-link="${escapeHtml(payLink)}" type="button">Copy link</button>
        <a class="ghost-action" href="${escapeHtml(payLink)}" target="_blank" rel="noreferrer">Open pay</a>
        ${receiptButton}
      </div>
    </article>
  `;
}

function renderSettings() {
  if (!els.settingsForm) return;
  els.settingsForm.elements.merchantName.value = state.settings.merchantName || "";
  els.settingsForm.elements.merchantWallet.value = getConnectedWallet() || "";
  els.settingsForm.elements.telegramChatId.value = state.settings.telegramChatId || "";
  if (state.settings.alerts) {
    if (els.settingsForm.elements["alerts.paid"]) els.settingsForm.elements["alerts.paid"].checked = Boolean(state.settings.alerts.paid);
    if (els.settingsForm.elements["alerts.failed"]) els.settingsForm.elements["alerts.failed"].checked = Boolean(state.settings.alerts.failed);
    if (els.settingsForm.elements["alerts.overdue"]) els.settingsForm.elements["alerts.overdue"].checked = Boolean(state.settings.alerts.overdue);
  }
}
function seedLineItems() {
  if (!els.lineItems || els.lineItems.children.length) return;
  setDefaultDueDate();
  addLineItem({ description: "AI automation consulting", quantity: 1, unitPrice: 250 });
}

function setDefaultDueDate() {
  const dueDate = els.invoiceForm?.elements.dueDate;
  if (!dueDate || dueDate.value) return;
  const date = new Date();
  date.setDate(date.getDate() + 7);
  dueDate.value = date.toISOString().slice(0, 10);
}

function addLineItem(item = {}) {
  const row = document.createElement("div");
  row.className = "line-item";
  row.innerHTML = `
    <label>
      <span class="field-label">
        Description
        <span class="help-tip" tabindex="0" data-help="Describe the service or product clearly, for example landing page, AI automation setup, or monthly support." aria-label="Description help">?</span>
      </span>
      <input name="description" required placeholder="Design, development, support..." value="${escapeHtml(item.description || "")}" />
    </label>
    <label>
      <span class="field-label">
        Qty
        <span class="help-tip" tabindex="0" data-help="Quantity, hours, days, or units for this line. Decimal values such as 1.5 are supported." aria-label="Quantity help">?</span>
      </span>
      <input name="quantity" type="number" min="0" step="0.01" required value="${escapeHtml(item.quantity ?? 1)}" />
    </label>
    <label>
      <span class="field-label">
        USDC
        <span class="help-tip" tabindex="0" data-help="Unit price in USDC for this line. The line total is quantity multiplied by this price." aria-label="USDC price help">?</span>
      </span>
      <input name="unitPrice" type="number" min="0" step="0.01" required value="${escapeHtml(item.unitPrice ?? 0)}" />
    </label>
    <button class="icon-button" data-action="remove-line" type="button" aria-label="Remove line item">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7h12M9 7V5h6v2M10 11v6M14 11v6M8 7l1 14h6l1-14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </button>
  `;
  els.lineItems.append(row);
  updateInvoiceTotal();
}

function handleLineItemAction(event) {
  const button = event.target.closest("[data-action='remove-line']");
  if (!button) return;
  if (els.lineItems.children.length <= 1) {
    showToast("Invoice needs at least one line item.");
    return;
  }
  button.closest(".line-item")?.remove();
  updateInvoiceTotal();
}

function collectLineItems() {
  return Array.from(els.lineItems.querySelectorAll(".line-item"))
    .map((row) => {
      const description = row.querySelector("[name='description']").value.trim();
      const quantity = toAmount(row.querySelector("[name='quantity']").value);
      const unitPrice = toAmount(row.querySelector("[name='unitPrice']").value);
      return {
        description,
        quantity,
        unitPrice,
        total: roundMoney(quantity * unitPrice),
      };
    })
    .filter((item) => item.description && item.quantity > 0 && item.unitPrice >= 0);
}

function updateInvoiceTotal() {
  if (!els.invoiceTotal || !els.lineItems) return;
  const total = collectLineItems().reduce((sum, item) => sum + item.total, 0);
  els.invoiceTotal.textContent = `${formatUsdc(total)} USDC`;
}

async function createInvoice(event) {
  event.preventDefault();
  if (!hasConnectedWallet()) {
    showToast("Connect wallet before creating invoice.");
    renderWalletState();
    return;
  }

  const settingsError = validateSettings();
  if (settingsError) {
    showToast(settingsError);
    setView("settings");
    return;
  }

  const items = collectLineItems();
  if (!items.length) {
    showToast("Add at least one valid line item.");
    return;
  }

  const form = new FormData(els.invoiceForm);
  const total = roundMoney(items.reduce((sum, item) => sum + item.total, 0));
  if (total <= 0) {
    showToast("Invoice total must be greater than 0.");
    return;
  }

  const id = makeId();
  const invoice = {
    id,
    number: nextInvoiceNumber(),
    // Offchain reference that PaymentRouter emits later in InvoicePaid.
    onchainInvoiceId: randomBytes32(),
    merchantName: state.settings.merchantName || "Fundline merchant",
    merchantWallet: getConnectedWallet(),
    telegramChatId: state.settings.telegramChatId || "",
    clientName: String(form.get("clientName") || "").trim(),
    clientEmail: String(form.get("clientEmail") || "").trim(),
    dueDate: String(form.get("dueDate") || ""),
    note: String(form.get("note") || "").trim(),
    items,
    total,
    status: "open",
    createdAt: new Date().toISOString(),
    paidAt: "",
    payerWallet: "",
    txHash: "",
  };

  let savedInvoice;
  try {
    savedInvoice = await createInvoiceOnServer(invoice);
  } catch (error) {
    showToast(error?.message || "Could not save invoice on server.");
    return;
  }

  upsertInvoice(savedInvoice);
  saveInvoices();
  els.invoiceForm.reset();
  els.lineItems.innerHTML = "";
  seedLineItems();
  state.filter = "all";
  setView("dashboard");
  showInvoiceDialog(savedInvoice);
  showToast("Invoice created.");
}

function validateSettings() {
  if (!state.settings.merchantName?.trim()) return "Add your merchant display name first.";
  if (!hasConnectedWallet()) return "Connect wallet before creating invoice.";
  return "";
}

const SELLER_SESSION_KEY = "fundline_dashboard_session";
const SELLER_SESSION_MAX_AGE_MS = 23 * 60 * 60 * 1000;

async function getSellerSession(connected, forceNew = false) {
  if (!forceNew) {
    let stored = null;
    try {
      stored = JSON.parse(localStorage.getItem(SELLER_SESSION_KEY) || "null");
    } catch {
      stored = null;
    }
    if (
      stored &&
      typeof stored.wallet === "string" &&
      stored.wallet.toLowerCase() === connected.toLowerCase() &&
      stored.signature &&
      stored.issuedAt &&
      Date.now() - new Date(stored.issuedAt).getTime() < SELLER_SESSION_MAX_AGE_MS
    ) {
      return stored;
    }
  }

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
    signature = await window.ethereum.request({ method: "personal_sign", params: [stringToHex(message), connected] });
  } catch (e) {
    if (Number(e?.code) === 4001) throw e;
    signature = await window.ethereum.request({ method: "personal_sign", params: [message, connected] });
  }

  const session = { wallet: connected, signature, issuedAt };
  localStorage.setItem(SELLER_SESSION_KEY, JSON.stringify(session));
  return session;
}

async function saveSettingsFromForm(event) {
  event.preventDefault();
  const settings = readSettingsDraft();
  const merchantName = settings.merchantName;
  if (!merchantName) {
    showToast("Display name is required.");
    return;
  }
  
  const connected = getConnectedWallet();
  if (!connected) {
    showToast("Please connect your wallet to save settings.");
    return;
  }

  try {
    const sendSettings = (session) =>
      fetch("/api/dashboard/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-fundline-wallet": session.wallet,
          "x-fundline-signature": session.signature,
          "x-fundline-issued-at": session.issuedAt,
        },
        body: JSON.stringify({
          telegramChatId: settings.telegramChatId,
          alerts: settings.alerts,
        }),
      });

    let res = await sendSettings(await getSellerSession(connected));
    if (res.status === 401) {
      // Stored signature is stale or rejected; drop it, re-sign once, and retry.
      localStorage.removeItem(SELLER_SESSION_KEY);
      res = await sendSettings(await getSellerSession(connected, true));
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "Failed to save settings to server");
    }
  } catch (err) {
    if (err.code !== 4001) showToast(err.message);
    return;
  }

  state.settings = {
    ...state.settings,
    ...settings,
    merchantWallet: connected,
  };
  saveSettings();
  renderSettings();
  showToast("Settings saved.");
}

function readSettingsDraft() {
  const form = new FormData(els.settingsForm);
  return {
    merchantName: String(form.get("merchantName") || "").trim(),
    telegramChatId: String(form.get("telegramChatId") || "").trim(),
    alerts: {
      paid: form.get("alerts.paid") === "on",
      failed: form.get("alerts.failed") === "on",
      overdue: form.get("alerts.overdue") === "on",
    }
  };
}
function handleInvoiceAction(event) {
  const target = event.target.closest("[data-action]");
  if (!target) return;
  const action = target.dataset.action;
  const id = target.dataset.id;
  const invoice = state.invoices.find((item) => item.id === id);

  if (action === "copy") {
    copyText(target.dataset.link || "");
    return;
  }
  if (!invoice) return;
  if (action === "view") showInvoiceDialog(invoice);
  if (action === "receipt") downloadReceiptPdf(invoice);
}

function showInvoiceDialog(invoice) {
  invoice = state.invoices.find((item) => item.id === invoice.id) || invoice;
  const payLink = getInvoicePayLink(invoice);
  const status = getInvoiceStatus(invoice);
  els.dialogBody.innerHTML = `
    <div class="dialog-head">
      <div>
        <p class="eyebrow">Invoice detail</p>
        <h2>${escapeHtml(invoice.number)}</h2>
      </div>
      <button class="icon-button" data-dialog-close type="button" aria-label="Close">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg>
      </button>
    </div>
    <div class="pay-meta">
      <article><span>Client</span><strong>${escapeHtml(invoice.clientName)}</strong></article>
      <article><span>Status</span><strong>${escapeHtml(status)}</strong></article>
      <article><span>Payment reference ID</span><strong>${escapeHtml(invoice.onchainInvoiceId)}</strong></article>
      <article><span>Receiving wallet</span><strong>${escapeHtml(invoice.merchantWallet)}</strong></article>
    </div>
    <div class="summary-box" style="margin-top: 14px;">
      ${renderPayItems(invoice)}
      <div class="summary-line summary-total"><span>Total</span><strong>${formatUsdc(invoice.total)} USDC</strong></div>
      <div class="copy-row">
        <input readonly value="${escapeHtml(payLink)}" />
        <button class="ghost-action" data-copy-dialog="${escapeHtml(payLink)}" type="button">Copy payment link</button>
      </div>
      <div class="receipt-actions">
        <a class="primary-action" href="${escapeHtml(payLink)}" target="_blank" rel="noreferrer">Open payment page</a>
        ${invoice.status === "paid" ? `<button class="ghost-action" data-dialog-receipt="${escapeHtml(invoice.id)}" type="button">Download receipt PDF</button>` : ""}
      </div>
    </div>
  `;
  els.dialogBody.querySelector("[data-dialog-close]")?.addEventListener("click", closeDialog);
  els.dialogBody.querySelector("[data-copy-dialog]")?.addEventListener("click", (event) => copyText(event.currentTarget.dataset.copyDialog));
  els.dialogBody.querySelector("[data-dialog-receipt]")?.addEventListener("click", () => downloadReceiptPdf(invoice));
  els.dialog.showModal();
}

function closeDialog() {
  els.dialog.close();
}

function renderPayPage(invoiceId) {
  const invoice = state.invoices.find((item) => item.id === invoiceId);
  document.body.classList.add("payment-mode");
  els.appPage.hidden = true;
  els.payPage.hidden = false;
  els.pageEyebrow.textContent = "Payment page";
  els.pageTitle.textContent = invoice ? `Pay ${invoice.number}` : "Invoice not found";

  if (!invoice) {
    els.payPage.innerHTML = `
      <section class="pay-card checkout-card">
        <div class="payment-hero">
          <div class="payment-merchant">
            <p class="eyebrow">Missing invoice</p>
            <h1>Invoice not found</h1>
          </div>
        </div>
        <div class="checkout-grid">
          <div class="empty-state">This invoice was not found on the server. Check the payment link or restart the Fundline server with the invoice database.</div>
        </div>
      </section>
    `;
    return;
  }

  const status = getInvoiceStatus(invoice);
  const payLink = getInvoicePayLink(invoice);
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=150x150&margin=8&data=${encodeURIComponent(payLink)}`;
  els.payPage.innerHTML = `
    <section class="pay-card checkout-card">
      <div class="payment-hero">
        <div class="payment-merchant">
          <p class="eyebrow">Invoice from</p>
          <h1>${escapeHtml(invoice.merchantName)}</h1>
          <div class="invoice-number-row">
            <span>${escapeHtml(invoice.number)}</span>
            <span class="pay-status pay-status-${escapeHtml(status)}">${escapeHtml(status)}</span>
          </div>
        </div>
        <div class="payment-total-card">
          <div class="payment-total-copy">
            <span>Amount due</span>
            <strong>${escapeHtml(formatUsdc(invoice.total))} USDC</strong>
            <small>Arc Testnet - Due ${escapeHtml(formatDate(invoice.dueDate))}</small>
          </div>
          <div class="qr-box">
            <img src="${escapeHtml(qrUrl)}" alt="Payment QR code" />
            <span>Payment link QR</span>
          </div>
        </div>
      </div>

      <div class="checkout-grid">
        <section class="invoice-panel">
          <div class="panel-title-row">
            <div>
              <p class="eyebrow">Invoice summary</p>
              <h2>Services and payment details</h2>
            </div>
          </div>
          ${renderPayItems(invoice)}
          ${invoice.note ? `<div class="payment-note"><span>Note</span><p>${escapeHtml(invoice.note)}</p></div>` : ""}
          <div class="reference-grid">
            <article><span>Client</span><strong>${escapeHtml(invoice.clientName)}</strong></article>
            <article><span>Due date</span><strong>${escapeHtml(formatDate(invoice.dueDate))}</strong></article>
            <article><span>Receiving wallet</span><strong>${escapeHtml(invoice.merchantWallet)}</strong></article>
            <article><span>Payment reference ID</span><strong>${escapeHtml(invoice.onchainInvoiceId)}</strong></article>
          </div>
        </section>

        <aside class="checkout-panel">
          <div class="checkout-total">
            <span>Total due</span>
            <strong>${formatUsdc(invoice.total)} USDC</strong>
          </div>
          ${invoice.status === "paid" ? renderVerifiedPayment(invoice) : renderPaymentVerification(invoice)}
          <div class="pay-actions">
            ${
              invoice.status === "paid"
                ? `<button class="ghost-action" id="downloadReceipt" type="button">Download PDF receipt</button>`
                : ""
            }
            <a class="ghost-action" href="/app.html" id="backDashboard">Dashboard</a>
          </div>
        </aside>
      </div>
    </section>
  `;

  document.querySelector("#payWithWallet")?.addEventListener("click", () => handleInvoicePaymentAction(invoice.id));
  document.querySelector("#paymentSourceChain")?.addEventListener("change", () => refreshPaymentSourceStatus(invoice.id));
  document.querySelector("#refreshPaymentSource")?.addEventListener("click", () => refreshPaymentSourceStatus(invoice.id));
  document.querySelector("#paymentVerifyForm")?.addEventListener("submit", (event) => verifyPaymentAndMarkPaid(invoice.id, event));
  document.querySelector("#downloadReceipt")?.addEventListener("click", () => downloadReceiptPdf(invoice));
  if (hasConnectedWallet() && invoice.status !== "paid") {
    window.setTimeout(() => refreshPaymentSourceStatus(invoice.id, { silent: true }), 0);
  }
}

function renderPaymentVerification(invoice) {
  const payerWallet = getConnectedWallet();
  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  const isSelfPayment = Boolean(payerWallet && sameAddress(payerWallet, invoice.merchantWallet));
  const payDisabled = !config.onchainPaymentsEnabled || isSelfPayment;
  const sourceOptions = getPaymentSourceOptions()
    .map((source) => `<option value="${escapeHtml(source.key)}">${escapeHtml(source.label)}</option>`)
    .join("");
  return `
    <div class="onchain-payment">
      <div>
        <p class="eyebrow">Wallet payment</p>
        <h2>${isSelfPayment ? "Use a different payer wallet" : config.onchainPaymentsEnabled ? "Choose USDC source" : "PaymentRouter not configured"}</h2>
        <p>${
          isSelfPayment
            ? "The connected wallet is also the receiving wallet. A self-transfer does not settle an invoice."
            :
          config.onchainPaymentsEnabled
            ? `Choose where your USDC is. If Arc balance is enough, pay directly. If USDC is on another testnet, Fundline will bridge first, then pay. Need testnet USDC? <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Get some at faucet.circle.com</a>.`
            : "Send USDC manually to the receiving wallet, then use verification below."
        }</p>
      </div>
      <div class="payment-source-box">
        <label>
          <span class="field-label">
            Pay with
            <span class="help-tip" tabindex="0" data-help="Choose the network where this payer wallet already has USDC. Arc pays directly; other supported testnets bridge first." aria-label="Pay source help">?</span>
          </span>
          <select id="paymentSourceChain" ${payDisabled ? "disabled" : ""}>${sourceOptions}</select>
        </label>
        <button class="ghost-action" id="refreshPaymentSource" type="button" ${payDisabled ? "disabled" : ""}>Check balance</button>
      </div>
      <div class="payment-source-status" id="paymentSourceStatus">${payerWallet ? "Checking selected USDC balance..." : "Connect wallet to check USDC balance."}</div>
      <button class="primary-action" id="payWithWallet" type="button" data-action="connect" ${payDisabled ? "disabled" : ""}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0l6-6m-6 6l-6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        ${payerWallet ? "Checking balance..." : "Connect wallet"}
      </button>
      <div class="bridge-pay-progress" id="bridgePayProgress" hidden></div>
    </div>
    <form class="payment-verify" id="paymentVerifyForm">
      <div>
        <p class="eyebrow">Payment verification</p>
        <h2>Verify on Arcscan</h2>
        <p>After sending USDC, connect the payer wallet or enter the wallet that sent payment. The app checks Arcscan before marking this invoice paid.</p>
      </div>
      <label>
        <span class="field-label">
          Payer wallet
          <span class="help-tip" tabindex="0" data-help="Wallet address that sent the USDC payment. If you connect the payer wallet, this field can be filled automatically." aria-label="Payer wallet help">?</span>
        </span>
        <input name="payerWallet" placeholder="0x wallet that paid this invoice" value="${escapeHtml(payerWallet)}" />
      </label>
      <label>
        <span class="field-label">
          Transaction hash
          <span class="help-tip" tabindex="0" data-help="Optional. Paste the transaction hash to verify faster. If left blank, the app searches recent Arcscan transactions from the payer wallet." aria-label="Transaction hash help">?</span>
        </span>
        <input name="txHash" placeholder="0x transaction hash, optional" />
      </label>
      <button class="primary-action" id="verifyPayment" type="submit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Verify payment
      </button>
    </form>
  `;
}

function renderVerifiedPayment(invoice) {
  const explorerUrl = invoice.txHash ? getTxExplorerUrl(invoice.txHash) : "";
  return `
    <div class="verified-payment">
      <span>Verified payment</span>
      ${explorerUrl ? `<a href="${escapeHtml(explorerUrl)}" target="_blank" rel="noreferrer" class="tx-hash-link"><strong>${escapeHtml(invoice.txHash || "demo")}</strong></a>` : `<strong>${escapeHtml(invoice.txHash || "demo")}</strong>`}
    </div>
  `;
}

function getPaymentSourceOptions() {
  return [
    { key: "arcTestnet", label: "USDC on Arc", chain: CCTP_TESTNET_CHAINS.arcTestnet },
    { key: "baseSepolia", label: "USDC on Base Sepolia", chain: CCTP_TESTNET_CHAINS.baseSepolia },
    { key: "ethereumSepolia", label: "USDC on Ethereum Sepolia", chain: CCTP_TESTNET_CHAINS.ethereumSepolia },
  ];
}

function getSelectedPaymentSource() {
  const key = document.querySelector("#paymentSourceChain")?.value || "arcTestnet";
  return getPaymentSourceOptions().find((source) => source.key === key) || getPaymentSourceOptions()[0];
}

async function refreshPaymentSourceStatus(id, options = {}) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice || invoice.status === "paid") return;
  const status = document.querySelector("#paymentSourceStatus");
  const button = document.querySelector("#payWithWallet");
  const wallet = getConnectedWallet();
  const source = getSelectedPaymentSource();
  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  if (!button || !status) return;
  button.dataset.source = source.key;

  if (!wallet) {
    button.disabled = false;
    button.dataset.action = "connect";
    button.innerHTML = paymentButtonHtml("Connect wallet");
    status.textContent = "Connect wallet to check USDC balance.";
    return;
  }
  if (sameAddress(wallet, invoice.merchantWallet)) {
    button.disabled = true;
    button.dataset.action = "blocked";
    button.innerHTML = paymentButtonHtml("Use a different wallet");
    status.textContent = "The payer wallet cannot be the same as the receiving wallet.";
    return;
  }
  if (!config.onchainPaymentsEnabled) {
    button.disabled = true;
    button.dataset.action = "blocked";
    button.innerHTML = paymentButtonHtml("Payment unavailable");
    status.textContent = "Wallet payment is not configured. Use manual transfer and verification.";
    return;
  }

  button.disabled = true;
  button.dataset.action = "checking";
  button.innerHTML = paymentButtonHtml("Checking balance...");
  status.textContent = `Checking ${source.label} balance...`;
  try {
    const chain = getPaymentSourceChain(source.key);
    const amountUnits = parseTokenUnits(invoice.total, ARC_USDC_DECIMALS);
    const balance = await readUsdcBalanceFromRpc(chain.rpcUrls[0], chain.usdc, wallet);
    const enough = balance >= amountUnits;
    const balanceText = `${formatUnits(balance, ARC_USDC_DECIMALS)} USDC`;
    if (!enough) {
      button.disabled = true;
      button.dataset.action = "blocked";
      button.innerHTML = paymentButtonHtml(source.key === "arcTestnet" ? "Insufficient Arc USDC" : "Insufficient USDC");
      status.textContent =
        source.key === "arcTestnet"
          ? `Insufficient Arc USDC balance (${balanceText}). Add more USDC or choose another chain to bridge from.`
          : `Insufficient USDC balance on ${chain.shortName} (${balanceText}). Choose another source or add more testnet USDC.`;
      return;
    }
    button.disabled = false;
    button.dataset.action = source.key === "arcTestnet" ? "pay" : "bridge-pay";
    button.innerHTML = paymentButtonHtml(source.key === "arcTestnet" ? `Pay ${formatUsdc(invoice.total)} USDC` : `Bridge and pay ${formatUsdc(invoice.total)} USDC`);
    status.textContent =
      source.key === "arcTestnet"
        ? `Arc balance is enough (${balanceText}). You can pay directly.`
        : `${chain.shortName} balance is enough (${balanceText}). Fundline will bridge to Arc, then pay.`;
  } catch (error) {
    button.disabled = false;
    button.dataset.action = "check";
    button.innerHTML = paymentButtonHtml("Check again");
    status.textContent = error?.message || "Could not check balance. Try again.";
    if (!options.silent) showToast("Could not check selected USDC balance.");
  }
}

function paymentButtonHtml(label) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0l6-6m-6 6l-6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>${escapeHtml(label)}`;
}

function getPaymentSourceChain(key) {
  if (key === "arcTestnet") {
    const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
    return {
      ...CCTP_TESTNET_CHAINS.arcTestnet,
      usdc: config.usdcTokenAddress || CCTP_TESTNET_CHAINS.arcTestnet.usdc,
      rpcUrls: [config.rpcUrl || CCTP_TESTNET_CHAINS.arcTestnet.rpcUrls[0]],
      explorer: config.explorerBase || CCTP_TESTNET_CHAINS.arcTestnet.explorer,
    };
  }
  return CCTP_TESTNET_CHAINS[key] || CCTP_TESTNET_CHAINS.arcTestnet;
}

function renderPayItems(invoice) {
  return `
    <div class="pay-items">
      ${invoice.items
        .map(
          (item) => `
            <div class="pay-item">
              <div>
                <strong>${escapeHtml(item.description)}</strong>
                <span>${formatNumber(item.quantity)} x ${formatUsdc(item.unitPrice)} USDC</span>
              </div>
              <strong>${formatUsdc(item.total)} USDC</strong>
            </div>
          `,
        )
        .join("")}
    </div>
  `;
}

// isBridge: if false (direct Arc pay), the bridge step is shown as "skipped".
function createBridgePayProgress(isBridge = true) {
  return [
    { key: "check",    label: "Check balance",     status: "pending", detail: "Waiting",  skipped: false },
    { key: "bridge",   label: "Bridge USDC to Arc",status: isBridge ? "pending" : "skipped", detail: isBridge ? "Waiting" : "Paying on Arc directly", skipped: !isBridge },
    { key: "pay",      label: "Pay invoice",        status: "pending", detail: "Waiting",  skipped: false },
    { key: "verify",   label: "Verify payment",     status: "pending", detail: "Waiting",  skipped: false },
    { key: "receipt",  label: "Receipt issued",     status: "pending", detail: "Waiting",  skipped: false },
  ];
}

function setProgressStep(steps, key, status, detail) {
  const step = steps.find((item) => item.key === key);
  if (step) {
    step.status = status;
    step.detail = detail || step.detail;
  }
  renderBridgePayProgress(steps);
}

function renderBridgePayProgress(steps) {
  const container = document.querySelector("#bridgePayProgress");
  if (!container) return;
  container.hidden = false;
  container.innerHTML = steps
    .map(
      (step) => {
        const isError = step.status === "error";
        const isSkipped = step.status === "skipped";
        return `
          <div class="progress-step progress-${escapeHtml(step.status)}">
            <span>${escapeHtml(step.label)}</span>
            <span class="progress-step-right">
              ${isError ? `<button class="progress-retry-btn" data-retry-step="${escapeHtml(step.key)}" type="button">Retry</button>` : ""}
              <strong>${escapeHtml(step.detail)}</strong>
            </span>
          </div>
        `;
      },
    )
    .join("");
  // Bind retry buttons
  container.querySelectorAll(".progress-retry-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const step = btn.dataset.retryStep;
      if (_activeBridgeContext?.retry) {
        _activeBridgeContext.retry(step);
      }
    });
  });
}

async function handleInvoicePaymentAction(id) {
  const button = document.querySelector("#payWithWallet");
  const action = button?.dataset.action || "connect";
  if (action === "connect") {
    await connectWallet();
    await refreshPaymentSourceStatus(id);
    return;
  }
  if (action === "bridge-pay") {
    await bridgeAndPayInvoice(id, button.dataset.source || getSelectedPaymentSource().key);
    return;
  }
  if (action === "pay") {
    await payInvoiceWithWallet(id);
    return;
  }
  await refreshPaymentSourceStatus(id);
}

async function payInvoiceWithWallet(id) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return;
  if (invoice.status === "paid") {
    showToast("Invoice is already paid.");
    return;
  }

  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  if (!config.onchainPaymentsEnabled) {
    showToast("PaymentRouter is not configured on this server.");
    return;
  }

  const provider = window.ethereum;
  if (!provider?.request) {
    showToast("No wallet extension found. Install or open an EVM wallet.");
    return;
  }

  let payerWallet = getConnectedWallet();
  if (!payerWallet) {
    await connectWallet();
    payerWallet = getConnectedWallet();
  }
  if (!payerWallet) return;
  if (sameAddress(payerWallet, invoice.merchantWallet)) {
    showToast("Use a different payer wallet. Paying from the receiving wallet creates a self-transfer and does not settle the invoice.");
    return;
  }

  const button = document.querySelector("#payWithWallet");
  button?.classList.remove("error-ring");

  // Direct Arc pay - uses the same 5-step stepper, bridge step shown as skipped
  const progress = createBridgePayProgress(false);
  renderBridgePayProgress(progress);
  _activeBridgeContext = {
    retry: (fromStep) => _retryDirectPay(id, fromStep),
    payerWallet,
    steps: progress,
  };

  try {
    setProgressStep(progress, "check", "active", "Checking Arc USDC balance...");
    setButtonBusy(button, "Checking balance...");
    const amountUnits = parseTokenUnits(invoice.total, ARC_USDC_DECIMALS);
    const balance = await readUsdcBalanceFromRpc(config.rpcUrl, config.usdcTokenAddress, payerWallet);
    if (balance < amountUnits) {
      throw new Error(`Insufficient Arc USDC. Need ${formatUsdc(invoice.total)} USDC, wallet has ${formatUnits(balance, ARC_USDC_DECIMALS)} USDC.`);
    }
    setProgressStep(progress, "check", "done", `${formatUnits(balance, ARC_USDC_DECIMALS)} USDC available`);

    setProgressStep(progress, "pay", "active", "Preparing payment...");
    setButtonBusy(button, "Preparing payment...");
    await submitArcPaymentWithProgress(invoice, payerWallet, button, progress);
  } catch (error) {
    const isRejected = error?.code === 4001 || String(error?.message).toLowerCase().includes("rejected") || String(error?.message).toLowerCase().includes("denied");
    const msg = isRejected ? "Rejected by user" : error?.message || "Wallet payment failed";
    const activeStep = progress.find((s) => s.status === "active");
    if (activeStep) setProgressStep(progress, activeStep.key, "error", msg);
    showToast(isRejected ? "Transaction rejected by user." : error?.message || "Wallet payment failed.");
    if (isRejected) {
      button?.classList.add("error-ring");
      setTimeout(() => button?.classList.remove("error-ring"), 3000);
    }
  } finally {
    resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }
}

// Internal: retry direct pay from a given step
async function _retryDirectPay(id, fromStep) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice || invoice.status === "paid") return;
  const ctx = _activeBridgeContext;
  if (!ctx) return;
  const progress = ctx.steps;
  // Reset error on fromStep and downstream steps
  const keys = ["check", "bridge", "pay", "verify", "receipt"];
  const fromIdx = keys.indexOf(fromStep);
  keys.slice(fromIdx).forEach((k) => {
    const s = progress.find((x) => x.key === k);
    if (s && s.status === "error") { s.status = "pending"; s.detail = "Waiting"; }
  });
  renderBridgePayProgress(progress);
  const button = document.querySelector("#payWithWallet");
  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  const provider = window.ethereum;
  const payerWallet = ctx.payerWallet || getConnectedWallet();
  if (!payerWallet) return;
  try {
    if (fromStep === "check") {
      setProgressStep(progress, "check", "active", "Checking Arc USDC balance...");
      setButtonBusy(button, "Checking balance...");
      const amountUnits = parseTokenUnits(invoice.total, ARC_USDC_DECIMALS);
      const balance = await readUsdcBalanceFromRpc(config.rpcUrl, config.usdcTokenAddress, payerWallet);
      if (balance < amountUnits) throw new Error(`Insufficient Arc USDC. Need ${formatUsdc(invoice.total)} USDC.`);
      setProgressStep(progress, "check", "done", `${formatUnits(balance, ARC_USDC_DECIMALS)} USDC available`);
    }
    if (fromStep === "check" || fromStep === "pay") {
      setProgressStep(progress, "pay", "active", "Preparing payment...");
      setButtonBusy(button, "Paying invoice...");
      await submitArcPaymentWithProgress(invoice, payerWallet, button, progress);
    }
    if (fromStep === "verify") {
      setProgressStep(progress, "verify", "active", "Verifying on Arcscan...");
      setButtonBusy(button, "Verifying...");
      const txHash = ctx.arcTxHash || "";
      const verified = await autoVerifyWithProgress(id, payerWallet, txHash, progress);
      if (verified) {
        setProgressStep(progress, "receipt", "done", "Receipt available");
      }
    }
  } catch (error) {
    const activeStep = progress.find((s) => s.status === "active");
    if (activeStep) setProgressStep(progress, activeStep.key, "error", error?.message || "Failed");
    showToast(error?.message || "Retry failed.");
  } finally {
    resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }
}

// Legacy wrapper - kept for backward compat; bridge path calls this directly.
// Direct pay path now calls submitArcPaymentWithProgress instead.
async function submitArcPayment(invoice, payerWallet, button) {
  const provider = window.ethereum;
  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  await ensurePaymentNetwork(provider, config);
  const onchainDecimals = await readUsdcDecimals(provider, config.usdcTokenAddress);
  if (onchainDecimals !== 6) {
    throw new Error(`Critical Error: Expected Arc USDC to have 6 decimals but found ${onchainDecimals}.`);
  }
  const amountUnits = parseTokenUnits(invoice.total, config.usdcDecimals);
  const balance = await readUsdcBalance(provider, config.usdcTokenAddress, payerWallet);
  if (balance < amountUnits) {
    throw new Error(
      `Insufficient Arc USDC. This invoice requires ${formatUsdc(invoice.total)} USDC, but this wallet has ${formatUnits(balance, config.usdcDecimals)} USDC.`,
    );
  }
  setButtonBusy(button, "Paying invoice...");
  const allowance = await readUsdcAllowance(provider, config.usdcTokenAddress, payerWallet, config.paymentRouterAddress);
  let txHash;
  if (allowance < amountUnits) {
    // Batch approve + payInvoice in one Multicall3From tx - payer signs once.
    const invoiceBytes = normalizeBytes32(invoice.onchainInvoiceId);
    if (!invoiceBytes) throw new Error("Invoice is missing a valid onchain invoice ID.");
    txHash = await sendMulticall3FromPayment(provider, {
      from: payerWallet,
      calls: [
        {
          target: config.usdcTokenAddress,
          callData: ERC20_APPROVE_SELECTOR + encodeAddress(config.paymentRouterAddress) + encodeUint256(amountUnits),
        },
        {
          target: config.paymentRouterAddress,
          callData: PAYMENT_ROUTER_PAY_SELECTOR + encodeBytes32(invoiceBytes) + encodeAddress(invoice.merchantWallet) + encodeUint256(amountUnits),
        },
      ],
    });
  } else {
    txHash = await sendRouterPayment(provider, {
      from: payerWallet,
      router: config.paymentRouterAddress,
      invoiceId: invoice.onchainInvoiceId,
      merchantWallet: invoice.merchantWallet,
      amount: amountUnits,
    });
  }
  const form = document.querySelector("#paymentVerifyForm");
  if (form?.elements.payerWallet) form.elements.payerWallet.value = payerWallet;
  if (form?.elements.txHash) form.elements.txHash.value = txHash;
  showToast("Payment submitted. Verification will start in 10 seconds.");
  setButtonBusy(button, "Waiting 10 seconds...");
  return autoVerifySubmittedPayment(invoice.id, { payerWallet, txHash, button });
}

// Stepper-aware version used by direct pay path.
async function submitArcPaymentWithProgress(invoice, payerWallet, button, progress) {
  const provider = window.ethereum;
  const config = state.publicConfig || DEFAULT_PUBLIC_CONFIG;
  setProgressStep(progress, "pay", "active", "Switching to Arc network...");
  await ensurePaymentNetwork(provider, config);
  const onchainDecimals = await readUsdcDecimals(provider, config.usdcTokenAddress);
  if (onchainDecimals !== 6) {
    throw new Error(`Critical Error: Expected Arc USDC to have 6 decimals but found ${onchainDecimals}.`);
  }
  const amountUnits = parseTokenUnits(invoice.total, config.usdcDecimals);
  setProgressStep(progress, "pay", "active", "Paying invoice...");
  setButtonBusy(button, "Paying invoice...");
  const allowance = await readUsdcAllowance(provider, config.usdcTokenAddress, payerWallet, config.paymentRouterAddress);
  let txHash;
  if (allowance < amountUnits) {
    // Batch approve + payInvoice in one Multicall3From tx - payer signs once.
    const invoiceBytes = normalizeBytes32(invoice.onchainInvoiceId);
    if (!invoiceBytes) throw new Error("Invoice is missing a valid onchain invoice ID.");
    txHash = await sendMulticall3FromPayment(provider, {
      from: payerWallet,
      calls: [
        {
          target: config.usdcTokenAddress,
          callData: ERC20_APPROVE_SELECTOR + encodeAddress(config.paymentRouterAddress) + encodeUint256(amountUnits),
        },
        {
          target: config.paymentRouterAddress,
          callData: PAYMENT_ROUTER_PAY_SELECTOR + encodeBytes32(invoiceBytes) + encodeAddress(invoice.merchantWallet) + encodeUint256(amountUnits),
        },
      ],
    });
  } else {
    txHash = await sendRouterPayment(provider, {
      from: payerWallet,
      router: config.paymentRouterAddress,
      invoiceId: invoice.onchainInvoiceId,
      merchantWallet: invoice.merchantWallet,
      amount: amountUnits,
    });
  }
  setProgressStep(progress, "pay", "done", "Payment submitted");
  if (_activeBridgeContext) _activeBridgeContext.arcTxHash = txHash;
  const form = document.querySelector("#paymentVerifyForm");
  if (form?.elements.payerWallet) form.elements.payerWallet.value = payerWallet;
  if (form?.elements.txHash) form.elements.txHash.value = txHash;
  showToast("Payment submitted. Verification will start in 10 seconds.");
  setButtonBusy(button, "Waiting for confirmation...");
  setProgressStep(progress, "verify", "active", "Waiting 10 s before checking Arcscan...");
  const verified = await autoVerifyWithProgress(invoice.id, payerWallet, txHash, progress);
  return verified;
}

// Runs auto-verify loop and drives verify+receipt steps.
async function autoVerifyWithProgress(id, payerWallet, txHash, progress) {
  await delay(10000);
  setProgressStep(progress, "verify", "active", "Checking Arcscan...");
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const verified = await verifyPaymentAndMarkPaid(
      id,
      { preventDefault() {} },
      { payerWallet, txHash, auto: true, showPendingToast: attempt === 1 },
    );
    if (verified) {
      setProgressStep(progress, "verify", "done", "Payment confirmed on Arcscan");
      setProgressStep(progress, "receipt", "done", "Receipt available");
      return true;
    }
    if (attempt < attempts) {
      showToast(`Payment not indexed yet. Checking again (${attempt + 1}/${attempts})...`);
      setProgressStep(progress, "verify", "active", `Retry ${attempt + 1}/${attempts}...`);
      await delay(10000);
    }
  }
  setProgressStep(progress, "verify", "error", "Not yet indexed - press Retry");
  showToast("Payment submitted, but Arcscan has not indexed it yet. Press Retry on the Verify step.");
  return false;
}

async function bridgeAndPayInvoice(id, sourceKey) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return;
  const source = getPaymentSourceChain(sourceKey);
  if (!source || source.key === "arcTestnet") {
    await payInvoiceWithWallet(id);
    return;
  }
  const provider = window.ethereum;
  if (!provider?.request) {
    showToast("No wallet extension found. Install or open an EVM wallet.");
    return;
  }
  let payerWallet = getConnectedWallet();
  if (!payerWallet) {
    await connectWallet();
    payerWallet = getConnectedWallet();
  }
  if (!payerWallet) return;
  if (sameAddress(payerWallet, invoice.merchantWallet)) {
    showToast("Use a different payer wallet. Paying from the receiving wallet creates a self-transfer and does not settle the invoice.");
    return;
  }

  const button = document.querySelector("#payWithWallet");
  const progress = createBridgePayProgress(true); // 5-step bridge flow
  renderBridgePayProgress(progress);

  // Bridge context - used by Retry buttons
  _activeBridgeContext = {
    retry: (fromStep) => _retryBridgePay(id, sourceKey, fromStep),
    payerWallet,
    steps: progress,
    burnTx: null,
    cctpMessage: null,
    arcTxHash: null,
  };

  try {
    setProgressStep(progress, "check", "active", `Checking ${source.shortName} USDC...`);
    setButtonBusy(button, "Checking source...");
    await ensureWalletNetwork(provider, source);
    const amountUnits = parseTokenUnits(invoice.total, ARC_USDC_DECIMALS);
    const balance = await readUsdcBalance(provider, source.usdc, payerWallet);
    if (balance < amountUnits) {
      throw new Error(`Insufficient USDC on ${source.shortName}.`);
    }
    setProgressStep(progress, "check", "done", `${formatUnits(balance, ARC_USDC_DECIMALS)} USDC available`);

    setProgressStep(progress, "bridge", "active", "Approving bridge spend...");
    setButtonBusy(button, "Approving bridge...");
    const allowance = await readUsdcAllowance(provider, source.usdc, payerWallet, CCTP_TOKEN_MESSENGER_V2);
    if (allowance < amountUnits) {
      const approveTx = await sendUsdcApprove(provider, {
        from: payerWallet,
        token: source.usdc,
        spender: CCTP_TOKEN_MESSENGER_V2,
        amount: amountUnits,
      });
      await waitForTransaction(provider, approveTx);
    }

    setProgressStep(progress, "bridge", "active", `Moving USDC from ${source.shortName} to Arc...`);
    setButtonBusy(button, "Starting bridge...");
    const burnTx = await sendCctpBurn(provider, {
      from: payerWallet,
      source,
      destination: CCTP_TESTNET_CHAINS.arcTestnet,
      amount: amountUnits,
      recipient: payerWallet,
      fast: true,
      onFeeResolved: (feeInfo) => {
        const modeLabel = feeInfo.mode === "fast" ? "Fast" : "Standard";
        const feeDetail = feeInfo.mode === "fast" ? `fee ${feeInfo.feeText}` : feeInfo.feeText;
        setProgressStep(progress, "bridge", "active", `Bridging via ${modeLabel} (${feeDetail})...`);
      }
    });
    _activeBridgeContext.burnTx = burnTx;
    await waitForTransaction(provider, burnTx, { attempts: 60, intervalMs: 2500 });
    setProgressStep(progress, "bridge", "active", "Waiting for Circle attestation...");
    const message = await fetchCctpAttestation(source.domain, burnTx);
    _activeBridgeContext.cctpMessage = message;

    setProgressStep(progress, "bridge", "active", "Minting USDC on Arc...");
    setButtonBusy(button, "Minting on Arc...");
    await ensurePaymentNetwork(provider, state.publicConfig || DEFAULT_PUBLIC_CONFIG);
    const mintTx = await sendCctpMint(provider, { from: payerWallet, message: message.message, attestation: message.attestation });
    await waitForTransaction(provider, mintTx, { attempts: 60, intervalMs: 2500 });
    setProgressStep(progress, "bridge", "done", "USDC received on Arc");

    setProgressStep(progress, "pay", "active", "Paying invoice on Arc...");
    setButtonBusy(button, "Paying invoice...");
    // Use stepper-aware version for the pay step
    await submitArcPaymentWithProgress(invoice, payerWallet, button, progress);
  } catch (error) {
    const isRejected = error?.code === 4001 || String(error?.message).toLowerCase().includes("rejected") || String(error?.message).toLowerCase().includes("denied");
    const active = progress.find((step) => step.status === "active");
    if (active) setProgressStep(progress, active.key, "error", isRejected ? "Rejected by user" : error?.message || "Stopped");
    showToast(isRejected ? "Transaction rejected by user." : error?.message || "Bridge and pay failed.");
    if (isRejected) {
      button?.classList.add("error-ring");
      setTimeout(() => button?.classList.remove("error-ring"), 3000);
    }
  } finally {
    resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }
}

// Internal: retry bridge-and-pay from a specific step
async function _retryBridgePay(id, sourceKey, fromStep) {
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice || invoice.status === "paid") return;
  const ctx = _activeBridgeContext;
  if (!ctx) return;
  const progress = ctx.steps;
  const source = getPaymentSourceChain(sourceKey);
  const provider = window.ethereum;
  const payerWallet = ctx.payerWallet || getConnectedWallet();
  if (!payerWallet) return;
  const button = document.querySelector("#payWithWallet");
  // Reset error status for this step and later
  const keys = ["check", "bridge", "pay", "verify", "receipt"];
  const fromIdx = keys.indexOf(fromStep);
  keys.slice(fromIdx).forEach((k) => {
    const s = progress.find((x) => x.key === k);
    if (s && !s.skipped && s.status === "error") { s.status = "pending"; s.detail = "Waiting"; }
  });
  renderBridgePayProgress(progress);
  const amountUnits = parseTokenUnits(invoice.total, ARC_USDC_DECIMALS);
  try {
    if (fromStep === "check") {
      setProgressStep(progress, "check", "active", `Checking ${source.shortName} USDC...`);
      setButtonBusy(button, "Checking source...");
      await ensureWalletNetwork(provider, source);
      const balance = await readUsdcBalance(provider, source.usdc, payerWallet);
      if (balance < amountUnits) throw new Error(`Insufficient USDC on ${source.shortName}.`);
      setProgressStep(progress, "check", "done", `${formatUnits(balance, ARC_USDC_DECIMALS)} USDC available`);
    }
    if (["check", "bridge"].includes(fromStep) && !ctx.cctpMessage) {
      setProgressStep(progress, "bridge", "active", "Approving bridge spend...");
      setButtonBusy(button, "Approving bridge...");
      const allowance = await readUsdcAllowance(provider, source.usdc, payerWallet, CCTP_TOKEN_MESSENGER_V2);
      if (allowance < amountUnits) {
        const approveTx = await sendUsdcApprove(provider, { from: payerWallet, token: source.usdc, spender: CCTP_TOKEN_MESSENGER_V2, amount: amountUnits });
        await waitForTransaction(provider, approveTx);
      }
      setProgressStep(progress, "bridge", "active", `Moving USDC from ${source.shortName} to Arc...`);
      setButtonBusy(button, "Starting bridge...");
      const burnTx = await sendCctpBurn(provider, { 
        from: payerWallet, 
        source, 
        destination: CCTP_TESTNET_CHAINS.arcTestnet, 
        amount: amountUnits, 
        recipient: payerWallet, 
        fast: true,
        onFeeResolved: (feeInfo) => {
          const modeLabel = feeInfo.mode === "fast" ? "Fast" : "Standard";
          const feeDetail = feeInfo.mode === "fast" ? `fee ${feeInfo.feeText}` : feeInfo.feeText;
          setProgressStep(progress, "bridge", "active", `Bridging via ${modeLabel} (${feeDetail})...`);
        }
      });
      ctx.burnTx = burnTx;
      await waitForTransaction(provider, burnTx, { attempts: 60, intervalMs: 2500 });
      setProgressStep(progress, "bridge", "active", "Waiting for Circle attestation...");
      const message = await fetchCctpAttestation(source.domain, burnTx);
      ctx.cctpMessage = message;
      setProgressStep(progress, "bridge", "active", "Minting USDC on Arc...");
      setButtonBusy(button, "Minting on Arc...");
      await ensurePaymentNetwork(provider, state.publicConfig || DEFAULT_PUBLIC_CONFIG);
      const mintTx = await sendCctpMint(provider, { from: payerWallet, message: message.message, attestation: message.attestation });
      await waitForTransaction(provider, mintTx, { attempts: 60, intervalMs: 2500 });
      setProgressStep(progress, "bridge", "done", "USDC received on Arc");
    } else if (["check", "bridge"].includes(fromStep) && ctx.cctpMessage) {
      // Already have attestation, just mint
      setProgressStep(progress, "bridge", "active", "Minting USDC on Arc (retry)...");
      setButtonBusy(button, "Minting on Arc...");
      await ensurePaymentNetwork(provider, state.publicConfig || DEFAULT_PUBLIC_CONFIG);
      const mintTx = await sendCctpMint(provider, { from: payerWallet, message: ctx.cctpMessage.message, attestation: ctx.cctpMessage.attestation });
      await waitForTransaction(provider, mintTx, { attempts: 60, intervalMs: 2500 });
      setProgressStep(progress, "bridge", "done", "USDC received on Arc");
    }
    if (["check", "bridge", "pay"].includes(fromStep)) {
      setProgressStep(progress, "pay", "active", "Paying invoice on Arc...");
      setButtonBusy(button, "Paying invoice...");
      await submitArcPaymentWithProgress(invoice, payerWallet, button, progress);
    }
    if (fromStep === "verify") {
      setProgressStep(progress, "verify", "active", "Verifying on Arcscan...");
      const txHash = ctx.arcTxHash || "";
      const verified = await autoVerifyWithProgress(id, payerWallet, txHash, progress);
      if (!verified) {
        setProgressStep(progress, "verify", "error", "Not yet indexed - press Retry");
      }
    }
  } catch (error) {
    const active = progress.find((s) => s.status === "active");
    if (active) setProgressStep(progress, active.key, "error", error?.message || "Failed");
    showToast(error?.message || "Retry failed.");
  } finally {
    resetPayWithWalletButton(button, invoice);
    await refreshPaymentSourceStatus(id, { silent: true });
  }
}

// Legacy auto-verify used by old submitArcPayment path (bridge flow calls submitArcPaymentWithProgress now).
async function autoVerifySubmittedPayment(id, { payerWallet, txHash, button }) {
  await delay(10000);
  setButtonBusy(button, "Verifying payment...");
  const attempts = 6;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const verified = await verifyPaymentAndMarkPaid(
      id,
      { preventDefault() {} },
      {
        payerWallet,
        txHash,
        auto: true,
        showPendingToast: attempt === 1,
      },
    );
    if (verified) return true;
    if (attempt < attempts) {
      showToast(`Payment not indexed yet. Checking again (${attempt + 1}/${attempts})...`);
      await delay(10000);
    }
  }
  showToast("Payment submitted, but Arcscan has not indexed it yet. You can press Verify payment again.");
  return false;
}

async function ensurePaymentNetwork(provider, config) {
  const expected = String(config.chainIdHex || "").toLowerCase();
  if (!expected) return;
  const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (current === expected) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: expected,
          chainName: config.networkName || "Arc Testnet",
          nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
          rpcUrls: config.rpcUrl ? [config.rpcUrl] : [],
          blockExplorerUrls: config.explorerBase ? [config.explorerBase] : [],
        },
      ],
    });
  }
}

async function ensureWalletNetwork(provider, chain) {
  const expected = String(chain.chainIdHex || "").toLowerCase();
  const current = String(await provider.request({ method: "eth_chainId" })).toLowerCase();
  if (current === expected) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: expected }],
    });
  } catch (error) {
    if (Number(error?.code) !== 4902) throw error;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: expected,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls,
          blockExplorerUrls: [chain.explorer],
        },
      ],
    });
  }
}

async function readUsdcAllowance(provider, token, owner, spender) {
  const data = `${ERC20_ALLOWANCE_SELECTOR}${encodeAddress(owner)}${encodeAddress(spender)}`;
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return hexToBigInt(result);
}

async function readUsdcBalance(provider, token, owner) {
  const data = `${ERC20_BALANCE_OF_SELECTOR}${encodeAddress(owner)}`;
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data }, "latest"],
  });
  return hexToBigInt(result);
}

async function readUsdcDecimals(provider, token) {
  const result = await provider.request({
    method: "eth_call",
    params: [{ to: token, data: ERC20_DECIMALS_SELECTOR }, "latest"],
  });
  return Number(hexToBigInt(result));
}

async function readUsdcBalanceFromRpc(rpcUrl, token, owner) {
  const data = `${ERC20_BALANCE_OF_SELECTOR}${encodeAddress(owner)}`;
  const result = await rpcCall(rpcUrl, "eth_call", [{ to: token, data }, "latest"]);
  return hexToBigInt(result);
}

async function rpcCall(rpcUrl, method, params) {
  if (!rpcUrl) throw new Error("RPC endpoint is not configured.");
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.error) throw new Error(payload.error?.message || "RPC request failed.");
  return payload.result;
}

function sendUsdcApprove(provider, { from, token, spender, amount }) {
  const data = `${ERC20_APPROVE_SELECTOR}${encodeAddress(spender)}${encodeUint256(amount)}`;
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: token, data, value: "0x0" }],
  });
}

function sendRouterPayment(provider, { from, router, invoiceId, merchantWallet, amount }) {
  const invoiceBytes = normalizeBytes32(invoiceId);
  if (!invoiceBytes) throw new Error("Invoice is missing a valid onchain invoice ID.");
  const data = `${PAYMENT_ROUTER_PAY_SELECTOR}${encodeBytes32(invoiceBytes)}${encodeAddress(merchantWallet)}${encodeUint256(amount)}`;
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: router, data, value: "0x0" }],
  });
}

// Encode aggregate3((address,bool,bytes)[]) calldata for Multicall3From.
// calls: [{target, callData}, ...] - allowFailure is always false (batch reverts atomically).
// callData strings may include a leading "0x" prefix; it is stripped before encoding.
function encodeMulticall3Batch(calls) {
  const N = calls.length;
  if (N === 0) throw new Error("Multicall3 batch cannot be empty.");
  const callDatas = calls.map((c) => {
    const hex = String(c.callData || "").replace(/^0x/, "").toLowerCase();
    if (hex.length % 2 !== 0) throw new Error("callData hex length must be even.");
    const byteLen = hex.length / 2;
    const padLen = byteLen === 0 ? 0 : Math.ceil(byteLen / 32) * 32;
    return { hex, byteLen, padLen };
  });
  // Each (address, bool, bytes) tuple: 96-byte head + 32-byte length word + padLen bytes.
  const callSizes = callDatas.map((cd) => 128 + cd.padLen);
  // Offsets are relative to the start of the array encoding (length word at position 0).
  const baseOffset = (1 + N) * 32;
  const callOffsets = [];
  let cumSize = 0;
  for (let i = 0; i < N; i++) {
    callOffsets.push(baseOffset + cumSize);
    cumSize += callSizes[i];
  }
  let arrayHex = encodeUint256(BigInt(N));
  for (let i = 0; i < N; i++) {
    arrayHex += encodeUint256(BigInt(callOffsets[i]));
  }
  for (let i = 0; i < N; i++) {
    const cd = callDatas[i];
    arrayHex += encodeAddress(calls[i].target);
    arrayHex += encodeUint256(0n);     // allowFailure = false
    arrayHex += encodeUint256(96n);    // offset to bytes from start of this tuple head
    arrayHex += encodeUint256(BigInt(cd.byteLen));
    arrayHex += cd.hex.padEnd(cd.padLen * 2, "0");
  }
  // Outer argument: dynamic array at offset 0x20 (32 bytes from start of calldata).
  return MULTICALL3_AGGREGATE3_SELECTOR + encodeUint256(32n) + arrayHex;
}

function sendMulticall3FromPayment(provider, { from, calls }) {
  const data = encodeMulticall3Batch(calls);
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: MULTICALL3FROM_ADDRESS, data, value: "0x0" }],
  });
}

async function resolveCctpFee({ sourceDomain, destinationDomain, amountUnits, fast }) {
  let mode = fast ? "fast" : "standard";
  let maxFee = 0n;
  let minFinalityThreshold = fast ? CCTP_FAST_FINALITY_THRESHOLD : CCTP_STANDARD_FINALITY_THRESHOLD;
  let feeText = fast ? "calculating..." : "free, slower (~13-19 min)";

  try {
    const url = `${CCTP_IRIS_SANDBOX_BASE}/v2/burn/USDC/fees/${sourceDomain}/${destinationDomain}`;
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json();
    const tiers = Array.isArray(payload) ? payload : [];
    if (tiers.length > 0) {
      let tier = null;
      if (fast) {
        tier = tiers.find((f) => Number(f.minimumFee) > 0);
        if (!tier) {
          tier = tiers.reduce((prev, curr) => (Number(curr.finalityThreshold) < Number(prev.finalityThreshold) ? curr : prev), tiers[0]);
        }
      } else {
        tier = tiers.find((f) => Number(f.minimumFee) === 0);
        if (!tier) {
          tier = tiers.reduce((prev, curr) => (Number(curr.finalityThreshold) > Number(prev.finalityThreshold) ? curr : prev), tiers[0]);
        }
      }
      if (tier) {
        minFinalityThreshold = Number(tier.finalityThreshold) || minFinalityThreshold;
        const bps = Number(tier.minimumFee) || 0;
        if (bps > 0) {
          // bps might be a float like 1.3, so scale it up by 100 to make it an integer
          const bpsScaled = BigInt(Math.ceil(bps * 100));
          // Divisor is now 10,000 * 100 = 1,000,000
          let feeUnits = (amountUnits * bpsScaled + 999999n) / 1000000n;
          maxFee = (feeUnits * 125n) / 100n;
          feeText = formatUnits(maxFee, ARC_USDC_DECIMALS) + " USDC";
        } else {
          maxFee = 0n;
          feeText = "free, slower (~13-19 min)";
        }
      }
    }
  } catch (error) {
    console.error("CCTP fee API failed:", error);
  }

  if (fast && maxFee === 0n) {
    mode = "standard";
    minFinalityThreshold = CCTP_STANDARD_FINALITY_THRESHOLD;
    feeText = "free, slower (~13-19 min)";
  }

  if (maxFee > 0n) {
    const onePercent = amountUnits / 100n;
    if (maxFee > onePercent) {
      throw new Error("Bridge fee exceeds 1% of the transfer amount. Please retry later or pay directly on Arc.");
    }
  }

  return { maxFee, minFinalityThreshold, mode, feeText };
}

async function sendCctpBurn(provider, { from, source, destination, amount, recipient, fast = false, onFeeResolved }) {
  const feeInfo = await resolveCctpFee({
    sourceDomain: source.domain,
    destinationDomain: destination.domain,
    amountUnits: amount,
    fast,
  });

  if (onFeeResolved) onFeeResolved(feeInfo);

  const data =
    CCTP_DEPOSIT_FOR_BURN_SELECTOR +
    encodeUint256(amount) +
    encodeUint256(destination.domain) +
    encodeBytes32(addressToBytes32(recipient)) +
    encodeAddress(source.usdc) +
    encodeBytes32(ZERO_BYTES32) +
    encodeUint256(feeInfo.maxFee) +
    encodeUint256(feeInfo.minFinalityThreshold);
    
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: CCTP_TOKEN_MESSENGER_V2, data, value: "0x0" }],
  });
}

async function fetchCctpAttestation(sourceDomain, txHash) {
  const normalizedHash = normalizeTxHash(txHash);
  if (!normalizedHash) throw new Error("Bridge transaction hash is invalid.");
  const url = `${CCTP_IRIS_SANDBOX_BASE}/v2/messages/${sourceDomain}?transactionHash=${encodeURIComponent(normalizedHash)}`;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const response = await fetch(url, { cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    const message = Array.isArray(payload.messages) ? payload.messages[0] : payload.message ? payload : null;
    if (message?.message && message?.attestation && String(message.status || "").toLowerCase() === "complete") {
      return { message: message.message, attestation: message.attestation };
    }
    if (message?.message && message?.attestation && !message.status) {
      return { message: message.message, attestation: message.attestation };
    }
    await delay(5000);
  }
  throw new Error("Circle attestation is not ready yet. Try again after a few minutes.");
}

function sendCctpMint(provider, { from, message, attestation }) {
  const data = CCTP_RECEIVE_MESSAGE_SELECTOR + encodeDynamicBytesPair(message, attestation);
  return provider.request({
    method: "eth_sendTransaction",
    params: [{ from, to: CCTP_MESSAGE_TRANSMITTER_V2, data, value: "0x0" }],
  });
}

async function waitForTransaction(provider, txHash, options = {}) {
  const normalized = normalizeTxHash(txHash);
  if (!normalized) return null;
  const attempts = Number(options.attempts || 45);
  const intervalMs = Number(options.intervalMs || 2000);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const receipt = await provider
      .request({
        method: "eth_getTransactionReceipt",
        params: [normalized],
      })
      .catch(() => null);
    if (receipt) {
      if (receipt.status && String(receipt.status).toLowerCase() === "0x0") throw new Error("Transaction failed onchain.");
      return receipt;
    }
    await delay(intervalMs);
  }
  return null;
}

function setButtonBusy(button, text) {
  if (!button) return;
  button.disabled = true;
  button.dataset.originalHtml ||= button.innerHTML;
  button.textContent = text;
}

function resetPayWithWalletButton(button, invoice) {
  if (!button) return;
  button.disabled = !(state.publicConfig || DEFAULT_PUBLIC_CONFIG).onchainPaymentsEnabled;
  button.innerHTML =
    button.dataset.originalHtml ||
    `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14m0 0l6-6m-6 6l-6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg> Pay ${escapeHtml(formatUsdc(invoice.total))} USDC`;
  delete button.dataset.originalHtml;
}

async function verifyPaymentAndMarkPaid(id, event, options = {}) {
  event?.preventDefault();
  const invoice = state.invoices.find((item) => item.id === id);
  if (!invoice) return false;
  if (invoice.status === "paid") {
    showToast("Invoice is already paid.");
    return true;
  }
  if (invoice.status === "verifying") {
    if (!options.auto) showToast("Payment verification is already running.");
    return false;
  }

  const form = document.querySelector("#paymentVerifyForm");
  const payerWallet = normalizeAddress(options.payerWallet || form?.elements.payerWallet.value || getConnectedWallet());
  const txHashInput = String(options.txHash || form?.elements.txHash.value || "").trim();
  const txHash = normalizeTxHash(txHashInput);
  if (!payerWallet) {
    showToast("Enter the wallet address that paid this invoice.");
    return false;
  }
  if (sameAddress(payerWallet, invoice.merchantWallet)) {
    showToast("Payer wallet must be different from the receiving wallet.");
    return false;
  }
  if (txHashInput && !txHash) {
    showToast("Enter a valid 0x transaction hash or leave it blank.");
    return false;
  }

  const verifyButton = document.querySelector("#verifyPayment");
  if (verifyButton) {
    verifyButton.disabled = true;
    verifyButton.textContent = "Checking Arcscan...";
  }

  let result;
  const previousStatus = invoice.status || "open";
  invoice.status = "verifying";
  invoice.lastVerificationAt = new Date().toISOString();
  upsertInvoice(invoice);
  saveInvoices();
  try {
    const serverInvoice = await updateInvoiceOnServer(invoice.id, {
      status: "verifying",
      lastVerificationAt: invoice.lastVerificationAt,
    });
    upsertInvoice(serverInvoice);
    saveInvoices();
  } catch {
    invoice.status = previousStatus === "paid" ? "paid" : "open";
    upsertInvoice(invoice);
    saveInvoices();
    showToast("Could not save verification state on server.");
    return false;
  }
  try {
    const response = await fetch("/api/arcscan/verify-payment", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        invoiceId: invoice.id,
        onchainInvoiceId: invoice.onchainInvoiceId,
        payerWallet,
        merchantWallet: invoice.merchantWallet,
        amount: invoice.total,
        createdAt: invoice.createdAt,
        txHash,
      }),
    });
    result = await response.json().catch(() => ({}));
    if (!response.ok || !result.verified) {
      invoice.status = previousStatus === "paid" ? "paid" : "open";
      upsertInvoice(invoice);
      saveInvoices();
      updateInvoiceOnServer(invoice.id, { status: invoice.status }).catch(() => {});
      if (!options.auto || options.showPendingToast) showToast(result.error || "No valid Arc payment found yet.");
      return false;
    }
  } catch (error) {
    invoice.status = previousStatus === "paid" ? "paid" : "open";
    upsertInvoice(invoice);
    saveInvoices();
    updateInvoiceOnServer(invoice.id, { status: invoice.status }).catch(() => {});
    if (!options.auto || options.showPendingToast) showToast(error?.message || "Arcscan verification failed.");
    return false;
  } finally {
    if (verifyButton) {
      verifyButton.disabled = false;
      verifyButton.innerHTML = `
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13l4 4L19 7" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" /></svg>
        Verify payment
      `;
    }
  }

  const match = result.match || {};
  if (isTxHashAlreadyUsed(match.txHash, invoice.id)) {
    showToast("This transaction is already used for another invoice.");
    return false;
  }

  invoice.status = "paid";
  invoice.paidAt = match.timestamp || new Date().toISOString();
  invoice.payerWallet = payerWallet;
  invoice.txHash = match.txHash || txHash;
  invoice.verifiedAt = new Date().toISOString();
  invoice.verificationSource = match.source || "arcscan";
  invoice.verifiedPayment = match;
  let savedInvoice = invoice;
  try {
    savedInvoice = await updateInvoiceOnServer(invoice.id, {
      status: "paid",
      paidAt: invoice.paidAt,
      payerWallet: invoice.payerWallet,
      txHash: invoice.txHash,
      verifiedAt: invoice.verifiedAt,
      verificationSource: invoice.verificationSource,
      verifiedPayment: invoice.verifiedPayment,
    });
  } catch (error) {
    showToast(error?.message || "Payment verified but could not persist paid status.");
    return false;
  }
  upsertInvoice(savedInvoice);
  saveInvoices();
  const telegramResult = await sendPaymentNotification(savedInvoice);
  if (telegramResult.ok) {
    showToast("Invoice marked paid. Telegram alert sent.");
  } else if (telegramResult.skipped) {
    showToast("Invoice marked paid.");
  } else {
    showToast(`Invoice marked paid. Telegram alert failed: ${telegramResult.error}`);
  }
  renderPayPage(id);
  return true;
}

async function sendTelegramTestAlert(event) {
  event.preventDefault();
  const settings = readSettingsDraft();
  if (!settings.telegramChatId) {
    showToast("Add Telegram chat ID first.");
    return;
  }
  const sampleInvoice = {
    id: "telegram-test",
    number: "TEST-PAID",
    clientName: "Demo client",
    total: 25,
    paidAt: new Date().toISOString(),
    payerWallet: getConnectedWallet() || "0x0000000000000000000000000000000000000000",
    merchantWallet: getConnectedWallet() || state.settings.merchantWallet || "0x...",
    txHash: "demo-telegram-test",
    verificationSource: "telegram_test",
  };
  const result = await sendPaymentNotification(sampleInvoice, {
    chatId: settings.telegramChatId,
    force: true,
  });
  showToast(result.ok ? "Test Telegram alert sent." : `Telegram alert failed: ${result.error}`);
}

async function sendPaymentNotification(invoice, options = {}) {
  const chatId = String(options.chatId || state.settings.telegramChatId || invoice.telegramChatId || "").trim();
  // Only the explicit test alert sends from the client; real paid alerts are sent
  // server-side by dispatchInvoiceTelegramAlert, so this avoids duplicate messages.
  const enabled = Boolean(options.force);
  if (!enabled || !chatId) return { skipped: true };

  try {
    const response = await fetch("/api/telegram/payment-paid", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chatId,
        invoice: {
          number: invoice.number,
          clientName: invoice.clientName,
          total: `${formatUsdc(invoice.total)} USDC`,
          paidAt: formatDateTime(invoice.paidAt),
          payerWallet: invoice.payerWallet || "",
          merchantWallet: invoice.merchantWallet,
          txHash: invoice.txHash || "demo",
          verificationSource: invoice.verificationSource || "",
          explorerUrl: invoice.txHash ? getTxExplorerUrl(invoice.txHash) : "",
          paymentLink: getInvoicePayLink(invoice),
        },
      }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || `HTTP ${response.status}` };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error?.message || "Network error" };
  }
}

function exportCsv() {
  if (!state.invoices.length) {
    showToast("No invoices to export.");
    return;
  }
  const headers = [
    "number",
    "client",
    "email",
    "status",
    "due_date",
    "total_usdc",
    "payment_reference_id",
    "paid_at",
    "merchant_wallet",
    "payer_wallet",
    "tx_hash",
    "verification_source",
  ];
  const rows = state.invoices.map((invoice) => [
    invoice.number,
    invoice.clientName,
    invoice.clientEmail,
    getInvoiceStatus(invoice),
    invoice.dueDate,
    formatUsdc(invoice.total),
    invoice.onchainInvoiceId,
    invoice.paidAt,
    invoice.merchantWallet,
    invoice.payerWallet,
    invoice.txHash,
    invoice.verificationSource,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  downloadBlob(csv, "text/csv;charset=utf-8", `arc-invoices-${todaySlug()}.csv`);
}

function downloadReceiptPdf(invoice) {
  if (invoice.status !== "paid") {
    showToast("Receipt PDF is available after payment.");
    return;
  }

  const pdf = makeReceiptPdf(invoice);
  downloadBlob(pdf, "application/pdf", `${invoice.number}-receipt.pdf`);
}

function makeReceiptPdf(invoice) {
  const page = { width: 595, height: 842, margin: 48 };
  const colors = {
    band: [18, 16, 10],
    ink: [28, 24, 16],
    muted: [120, 114, 100],
    line: [226, 220, 206],
    soft: [248, 245, 238],
    tint: [248, 241, 214],
    gold: [212, 175, 55],
    goldDeep: [184, 134, 11],
    goldSoft: [223, 202, 138],
    white: [255, 255, 255],
  };
  const pages = [];
  let ops = [];
  let cursorY = 0;

  const startPage = (isFirstPage = false) => {
    ops = [];
    pages.push(ops);
    drawRect(0, page.height - 96, page.width, 96, colors.band);
    drawText("Fundline", page.margin, page.height - 52, 20, "F2", colors.gold);
    drawText("USDC payment receipt", page.margin, page.height - 70, 10, "F1", colors.goldSoft);
    drawText("RECEIPT", page.width - page.margin, page.height - 48, 25, "F2", colors.white, { align: "right" });
    drawText(invoice.number, page.width - page.margin, page.height - 70, 10, "F1", colors.goldSoft, { align: "right" });
    drawFooter();
    cursorY = isFirstPage ? 690 : 690;
  };

  const drawFirstPageIntro = () => {
    drawStatusBlock();
    drawPartyCard("FROM", invoice.merchantName || "Merchant", ["Receiving wallet", shortAddress(invoice.merchantWallet)], page.margin, 564, 228, 92);
    drawPartyCard("BILL TO", invoice.clientName || "Client", [invoice.clientEmail || "No email provided"], 319, 564, 228, 92);
    cursorY = 540;
  };

  const ensureSpace = (heightNeeded, includeTableHeader = true) => {
    if (cursorY - heightNeeded < 112) {
      startPage(false);
      if (includeTableHeader) {
        drawTableHeader(cursorY);
        cursorY -= 28;
      }
    }
  };

  startPage(true);
  drawFirstPageIntro();
  drawTableHeader(cursorY);
  cursorY -= 28;

  invoice.items.forEach((item, index) => {
    const descriptionLines = wrapPdfText(item.description || "Invoice item", 44).slice(0, 2);
    const rowHeight = Math.max(42, 24 + descriptionLines.length * 12);
    ensureSpace(rowHeight);
    drawItemRow(item, index, cursorY, rowHeight, descriptionLines);
    cursorY -= rowHeight;
  });

  ensureSpace(230, false);
  drawTotals(cursorY - 8);
  drawBlockchainReference(cursorY - 92);

  return makePdfDocument(pages.map((pageOps) => pageOps.join("\n")), page);

  function drawStatusBlock() {
    drawRect(page.margin, 668, page.width - page.margin * 2, 48, colors.soft);
    drawStrokeRect(page.margin, 668, page.width - page.margin * 2, 48, colors.line);
    drawText("PAID", page.margin + 18, 696, 10, "F2", colors.goldDeep);
    drawText(`${formatUsdc(invoice.total)} USDC`, page.margin + 18, 677, 18, "F2", colors.ink);
    drawText("Paid at", 250, 695, 8, "F2", colors.muted);
    drawText(formatDateTimeZoned(invoice.paidAt), 250, 678, 10, "F1", colors.ink);
    drawText("Network", page.width - page.margin - 16, 695, 8, "F2", colors.muted, { align: "right" });
    drawText("Arc Testnet", page.width - page.margin - 16, 678, 10, "F1", colors.ink, { align: "right" });
  }

  function drawPartyCard(label, title, lines, x, y, width, height) {
    drawRect(x, y, width, height, colors.white);
    drawStrokeRect(x, y, width, height, colors.line);
    drawText(label, x + 14, y + height - 21, 8, "F2", colors.muted);
    drawText(title, x + 14, y + height - 43, 13, "F2", colors.ink);
    lines.slice(0, 3).forEach((line, index) => {
      drawText(line || "-", x + 14, y + height - 62 - index * 13, 9, "F1", colors.muted);
    });
  }

  function drawTableHeader(y) {
    drawRect(page.margin, y - 22, page.width - page.margin * 2, 28, colors.band);
    drawText("Description", page.margin + 14, y - 11, 9, "F2", colors.white);
    drawText("Qty", 326, y - 11, 9, "F2", colors.white, { align: "right" });
    drawText("Unit", 424, y - 11, 9, "F2", colors.white, { align: "right" });
    drawText("Amount", page.width - page.margin - 14, y - 11, 9, "F2", colors.white, { align: "right" });
  }

  function drawItemRow(item, index, y, height, descriptionLines) {
    drawRect(page.margin, y - height, page.width - page.margin * 2, height, index % 2 === 0 ? colors.white : colors.soft);
    drawStrokeRect(page.margin, y - height, page.width - page.margin * 2, height, colors.line);
    descriptionLines.forEach((line, lineIndex) => {
      drawText(line, page.margin + 14, y - 18 - lineIndex * 13, 10, lineIndex === 0 ? "F2" : "F1", lineIndex === 0 ? colors.ink : colors.muted);
    });
    drawText(formatNumber(item.quantity), 326, y - 22, 10, "F1", colors.ink, { align: "right" });
    drawText(`${formatUsdc(item.unitPrice)} USDC`, 424, y - 22, 10, "F1", colors.ink, { align: "right" });
    drawText(`${formatUsdc(item.total)} USDC`, page.width - page.margin - 14, y - 22, 10, "F2", colors.ink, { align: "right" });
  }

  function drawTotals(y) {
    const boxX = 333;
    const boxW = page.width - page.margin - boxX;
    drawRect(boxX, y - 58, boxW, 68, colors.tint);
    drawStrokeRect(boxX, y - 58, boxW, 68, colors.line);
    drawText("Total paid", boxX + 16, y - 12, 9, "F2", colors.muted);
    drawText(`${formatUsdc(invoice.total)} USDC`, boxX + boxW - 16, y - 35, 18, "F2", colors.ink, { align: "right" });
  }

  function drawBlockchainReference(y) {
    drawText("ON-CHAIN REFERENCE", page.margin, y, 8, "F2", colors.muted);
    const rows = [
      ["Receiving wallet", invoice.merchantWallet || "-"],
      ["Payer wallet", invoice.payerWallet || "-"],
      ["Payment reference ID", invoice.onchainInvoiceId || "-"],
      ["Transaction hash", invoice.txHash || "demo"],
      ["Verification source", invoice.verificationSource || "-"],
      ["Verified at", invoice.verifiedAt ? formatDateTimeZoned(invoice.verifiedAt) : "-"],
    ];
    let rowY = y - 19;
    rows.forEach(([label, value]) => {
      drawText(label, page.margin, rowY, 8, "F2", colors.muted);
      wrapPdfText(value, 76)
        .slice(0, 2)
        .forEach((line, index) => drawText(line, 166, rowY - index * 12, 8.5, "F1", colors.ink));
      rowY -= 26;
    });
  }

  function drawFooter() {
    drawLine(page.margin, 58, page.width - page.margin, 58, colors.line);
    drawText("Non-custodial receipt. Funds are paid directly from payer wallet to merchant wallet.", page.margin, 38, 8, "F1", colors.muted);
    drawText(`Page ${pages.length}`, page.width - page.margin, 38, 8, "F1", colors.muted, { align: "right" });
  }

  function drawText(value, x, y, size, font, color, options = {}) {
    const text = escapePdfText(value);
    const textX = options.align === "right" ? x - estimateTextWidth(text, size) : options.align === "center" ? x - estimateTextWidth(text, size) / 2 : x;
    ops.push(`${pdfColor(color, "rg")}\nBT\n/${font} ${size} Tf\n${textX.toFixed(2)} ${y.toFixed(2)} Td\n(${text}) Tj\nET`);
  }

  function drawRect(x, y, width, height, color) {
    ops.push(`${pdfColor(color, "rg")}\n${x} ${y} ${width} ${height} re f`);
  }

  function drawStrokeRect(x, y, width, height, color) {
    ops.push(`${pdfColor(color, "RG")}\n0.8 w\n${x} ${y} ${width} ${height} re S`);
  }

  function drawLine(x1, y1, x2, y2, color) {
    ops.push(`${pdfColor(color, "RG")}\n0.8 w\n${x1} ${y1} m ${x2} ${y2} l S`);
  }
}

function makePdfDocument(contentStreams, page) {
  const pageObjectNumbers = contentStreams.map((_, index) => 5 + index * 2);
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${contentStreams.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];

  contentStreams.forEach((stream, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const streamObjectNumber = pageObjectNumber + 1;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefAt = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`;
  return pdf;
}

function pdfColor(color, operator) {
  return `${(color[0] / 255).toFixed(3)} ${(color[1] / 255).toFixed(3)} ${(color[2] / 255).toFixed(3)} ${operator}`;
}

function estimateTextWidth(value, size) {
  return String(value || "").length * size * 0.52;
}

function wrapPdfText(value, maxLength) {
  const words = String(value || "-").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  words.forEach((word) => {
    if (word.length > maxLength) {
      if (line) {
        lines.push(line);
        line = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      return;
    }
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length > maxLength) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  });
  if (line) lines.push(line);
  return lines.length ? lines : ["-"];
}

function shortAddress(value) {
  const text = String(value || "");
  return text.length > 18 ? `${text.slice(0, 10)}...${text.slice(-8)}` : text || "-";
}

function shortHash(value) {
  const text = String(value || "");
  return text.length > 22 ? `${text.slice(0, 14)}...${text.slice(-10)}` : text || "-";
}

function getInvoiceStatus(invoice) {
  if (invoice.status === "paid") return "paid";
  if (invoice.status === "verifying") return "verifying";
  if (invoice.dueDate && new Date(`${invoice.dueDate}T23:59:59`).getTime() < Date.now()) return "expired";
  return "open";
}

function getInvoicePayLink(invoice) {
  return `${window.location.origin}/pay/${invoice.id}`;
}

function nextInvoiceNumber() {
  const year = new Date().getFullYear();
  const max = state.invoices.reduce((current, invoice) => {
    const match = String(invoice.number || "").match(/INV-\d{4}-(\d+)/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `INV-${year}-${String(max + 1).padStart(4, "0")}`;
}

function loadInvoices() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveInvoices() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.invoices));
}

function loadSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return {
      merchantName: parsed.merchantName || "",
      merchantWallet: normalizeAddress(parsed.merchantWallet || ""),
      telegramChatId: String(parsed.telegramChatId || ""),
      alerts: parsed.alerts || { paid: true, failed: true, overdue: true },
    };
  } catch {
    return { merchantName: "", merchantWallet: "", telegramChatId: "", alerts: { paid: true, failed: true, overdue: true } };
  }
}

function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
}

function copyText(value) {
  if (!value) return;
  navigator.clipboard
    ?.writeText(value)
    .then(() => showToast("Copied."))
    .catch(() => {
      showToast("Copy failed.");
    });
}

function downloadBlob(content, type, filename) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function showToast(message) {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function makeId() {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomBytes32() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function normalizeAddress(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{40}$/.test(text) ? text : "";
}

function sameAddress(left, right) {
  return Boolean(left && right && normalizeAddress(left).toLowerCase() === normalizeAddress(right).toLowerCase());
}

function normalizeTxHash(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : "";
}

function normalizeBytes32(value) {
  const text = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(text) ? text : "";
}

function encodeAddress(value) {
  const address = normalizeAddress(value);
  if (!address) throw new Error("Invalid wallet or contract address.");
  return address.toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

function addressToBytes32(value) {
  const address = normalizeAddress(value);
  if (!address) throw new Error("Invalid wallet address.");
  return `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
}

function encodeBytes32(value) {
  const bytes = normalizeBytes32(value);
  if (!bytes) throw new Error("Invalid bytes32 value.");
  return bytes.replace(/^0x/, "").toLowerCase();
}

function encodeDynamicBytesPair(first, second) {
  const firstHex = stripHexPrefix(first);
  const secondHex = stripHexPrefix(second);
  if (firstHex.length % 2 || secondHex.length % 2) throw new Error("Invalid byte payload.");
  const firstBytes = firstHex.length / 2;
  const secondBytes = secondHex.length / 2;
  const firstPadded = padHexRight(firstHex);
  const secondPadded = padHexRight(secondHex);
  const firstOffset = 64n;
  const secondOffset = firstOffset + 32n + BigInt(firstPadded.length / 2);
  return (
    encodeUint256(firstOffset) +
    encodeUint256(secondOffset) +
    encodeUint256(BigInt(firstBytes)) +
    firstPadded +
    encodeUint256(BigInt(secondBytes)) +
    secondPadded
  );
}

function stripHexPrefix(value) {
  const text = String(value || "").trim();
  if (!/^0x[0-9a-fA-F]*$/.test(text)) throw new Error("Invalid hex payload.");
  return text.slice(2).toLowerCase();
}

function padHexRight(hex) {
  const remainder = hex.length % 64;
  return remainder ? hex + "0".repeat(64 - remainder) : hex;
}

function encodeUint256(value) {
  const amount = typeof value === "bigint" ? value : BigInt(String(value || "0"));
  if (amount < 0n) throw new Error("Amount cannot be negative.");
  return amount.toString(16).padStart(64, "0");
}

function hexToBigInt(value) {
  const text = String(value || "").trim();
  return /^0x[0-9a-fA-F]+$/.test(text) ? BigInt(text) : 0n;
}

function parseTokenUnits(value, decimals) {
  const normalizedDecimals = Math.min(Math.max(Number(decimals) || 0, 0), 18);
  const text = String(value || "0").replace(/,/g, "").trim();
  const [wholeRaw, fractionRaw = ""] = text.split(".");
  const whole = wholeRaw.replace(/\D/g, "") || "0";
  const fraction = fractionRaw.replace(/\D/g, "").padEnd(normalizedDecimals, "0").slice(0, normalizedDecimals);
  return BigInt(whole) * 10n ** BigInt(normalizedDecimals) + BigInt(fraction || "0");
}

function stringToHex(value) {
  return `0x${Array.from(new TextEncoder().encode(String(value || "")), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function formatUnits(value, decimals) {
  const raw = BigInt(String(value || "0x0"));
  const divisor = 10n ** BigInt(decimals);
  const whole = raw / divisor;
  const fraction = raw % divisor;
  const fractionText = fraction.toString().padStart(decimals, "0").slice(0, 4).replace(/0+$/, "");
  return fractionText ? `${whole.toLocaleString()}.${fractionText}` : whole.toLocaleString();
}

function isTxHashAlreadyUsed(txHash, invoiceId) {
  const normalized = normalizeTxHash(txHash);
  if (!normalized) return false;
  return state.invoices.some((invoice) => invoice.id !== invoiceId && normalizeTxHash(invoice.txHash) === normalized);
}

function getTxExplorerUrl(txHash) {
  const normalized = normalizeTxHash(txHash);
  const explorerBase = (state.publicConfig?.explorerBase || ARC_EXPLORER_URL).replace(/\/$/, "");
  return normalized ? `${explorerBase}/tx/${normalized}` : "";
}

function delay(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toAmount(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatUsdc(value) {
  return roundMoney(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 4,
  });
}

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

function formatDateTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-US", { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function formatGmtOffset(date) {
  const offsetMinutes = -date.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMinutes);
  const hours = Math.floor(abs / 60);
  const minutes = abs % 60;
  return `GMT${sign}${hours}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}`;
}

function formatDateTimeZoned(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return `${formatDateTime(value)} (${formatGmtOffset(date)})`;
}

function todaySlug() {
  return new Date().toISOString().slice(0, 10);
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapePdfText(value) {
  return String(value ?? "")
    .replace(/[^\x20-\x7E]/g, " ")
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}


async function fetchServerSettings() {
  const sessionStr = localStorage.getItem("fundline_dashboard_session");
  const connected = getConnectedWallet();
  if (!sessionStr || !connected) return;
  const session = JSON.parse(sessionStr);
  if (session.wallet.toLowerCase() !== connected.toLowerCase()) return;

  try {
    const res = await fetch("/api/dashboard/settings", {
      headers: {
        "x-fundline-wallet": session.wallet,
        "x-fundline-signature": session.signature,
        "x-fundline-issued-at": session.issuedAt,
      }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.settings) {
        state.settings.telegramChatId = data.settings.telegramChatId || "";
        if (data.settings.alerts) {
          state.settings.alerts = { ...state.settings.alerts, ...data.settings.alerts };
        }
        saveSettings();
        renderSettings();
      }
    }
  } catch(e) {}
}
