"use strict";

// Shared wallet session for the whole Fundline dApp. Loaded on every page that has
// the sidebar (app.html, workflows.html). Owns the single connect/disconnect session
// (localStorage, dApp-wide), renders the sidebar wallet widget above the network pill,
// and a slide-out balance panel. Page scripts read window.FundlineWallet.getAddress()
// and listen for the "fundline:walletchange" event. No build step; vanilla JS.
(function () {
  "use strict";

  var SESSION_KEY = "fundline_wallet_session";
  var ARC_CHAIN_ID_HEX = "0x4cef52"; // 5042002
  var ARC_USDC = "0x3600000000000000000000000000000000000000";
  var ARC_EXPLORER = "https://testnet.arcscan.app";
  var ERC20_BALANCE_OF = "0x70a08231";

  var session = null; // { address, authAt }

  function provider() {
    return (typeof window !== "undefined" && window.ethereum) ? window.ethereum : null;
  }
  function normalizeAddress(value) {
    var t = String(value || "").trim();
    return /^0x[a-fA-F0-9]{40}$/.test(t) ? t.toLowerCase() : "";
  }
  function shortAddress(a) { return a ? (a.slice(0, 6) + "…" + a.slice(-4)) : ""; }
  function encAddr(a) { return normalizeAddress(a).replace(/^0x/, "").padStart(64, "0"); }
  function formatUnits6(hex) {
    var n;
    try { n = BigInt(hex || "0x0"); } catch (e) { n = 0n; }
    var whole = n / 1000000n;
    var frac = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? (whole.toString() + "." + frac) : whole.toString();
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (obj && normalizeAddress(obj.address)) return { address: normalizeAddress(obj.address), authAt: obj.authAt || "" };
    } catch (e) { /* ignore */ }
    return null;
  }
  function saveSession(s) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) { /* ignore */ }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) { /* ignore */ }
  }

  function emitChange() {
    try {
      document.dispatchEvent(new CustomEvent("fundline:walletchange", { detail: { address: session ? session.address : "" } }));
    } catch (e) { /* ignore */ }
  }

  // --- connect / disconnect ---
  async function connect() {
    var p = provider();
    if (!p || !p.request) {
      alert("No wallet found. Install or open an EVM wallet (OKX, MetaMask, etc.).");
      return "";
    }
    var accounts = await p.request({ method: "eth_requestAccounts" });
    var address = normalizeAddress(accounts && accounts[0]);
    if (!address) throw new Error("Wallet did not return an address.");
    var issuedAt = new Date().toISOString();
    var message = [
      "Sign in to Fundline",
      "",
      "This signature proves you control this wallet.",
      "It does not move funds or create an on-chain transaction.",
      "",
      "Wallet: " + address,
      "Issued at: " + issuedAt,
    ].join("\n");
    try {
      await p.request({ method: "personal_sign", params: [stringToHex(message), address] });
    } catch (err) {
      if (Number(err && err.code) === 4001) throw err; // user rejected
      await p.request({ method: "personal_sign", params: [message, address] });
    }
    session = { address: address, authAt: issuedAt };
    saveSession(session);
    render();
    emitChange();
    return address;
  }

  function disconnect() {
    session = null;
    clearSession();
    closePanel();
    render();
    emitChange();
  }

  function stringToHex(str) {
    var hex = "0x";
    for (var i = 0; i < str.length; i += 1) hex += str.charCodeAt(i).toString(16).padStart(2, "0");
    return hex;
  }

  // Restore a stored session without prompting, only if the wallet still controls it.
  async function restore() {
    var stored = loadSession();
    render();
    if (!stored) return;
    var p = provider();
    if (!p || !p.request) return;
    try {
      var accounts = await p.request({ method: "eth_accounts" });
      var current = normalizeAddress(accounts && accounts[0]);
      if (current && current === stored.address) {
        session = stored;
      } else {
        clearSession();
        session = null;
      }
    } catch (e) {
      session = null;
    }
    render();
    emitChange();
    bindProviderEvents();
  }

  var providerBound = false;
  function bindProviderEvents() {
    var p = provider();
    if (!p || providerBound || !p.on) return;
    providerBound = true;
    p.on("accountsChanged", function (accs) {
      var current = normalizeAddress(accs && accs[0]);
      if (!session) return;
      if (!current || current !== session.address) {
        disconnect();
      }
    });
  }

  // --- balance ---
  async function fetchArcUsdcBalance() {
    var p = provider();
    if (!p || !session) return null;
    try {
      var data = ERC20_BALANCE_OF + encAddr(session.address);
      var res = await p.request({ method: "eth_call", params: [{ to: ARC_USDC, data: data }, "latest"] });
      return formatUnits6(res);
    } catch (e) {
      return null;
    }
  }

  // --- UI: sidebar widget ---
  function render() {
    var host = document.getElementById("walletWidget");
    if (!host) return;
    if (session && session.address) {
      host.innerHTML =
        '<button class="ww-addr" id="wwAddr" type="button" title="Wallet details">' +
        '<span class="ww-dot"></span><span class="ww-addr-text">' + shortAddress(session.address) + "</span></button>";
      var addrBtn = document.getElementById("wwAddr");
      if (addrBtn) addrBtn.addEventListener("click", openPanel);
    } else {
      host.innerHTML = '<button class="ww-connect" id="wwConnect" type="button">Connect wallet</button>';
      var connectBtn = document.getElementById("wwConnect");
      if (connectBtn) {
        connectBtn.addEventListener("click", function () {
          connectBtn.disabled = true;
          connectBtn.textContent = "Connecting...";
          connect().catch(function (err) {
            // user rejected or failed; restore button
          }).finally(function () {
            if (!session) { connectBtn.disabled = false; connectBtn.textContent = "Connect wallet"; }
          });
        });
      }
    }
  }

  // --- UI: slide-out balance panel ---
  function ensurePanel() {
    var panel = document.getElementById("wwPanel");
    if (panel) return panel;
    panel = document.createElement("div");
    panel.id = "wwPanel";
    panel.className = "ww-panel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="ww-panel-head"><strong>Wallet</strong>' +
      '<button class="ww-panel-close" id="wwClose" type="button" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg></button></div>' +
      '<a class="ww-panel-addr" id="wwPanelAddr" target="_blank" rel="noopener"></a>' +
      '<div class="ww-panel-label">Balances</div>' +
      '<div class="ww-balances" id="wwBalances"></div>' +
      '<p class="ww-panel-note">More networks coming soon.</p>' +
      '<button class="ww-logout" id="wwLogout" type="button">Disconnect</button>';
    document.body.appendChild(panel);
    document.getElementById("wwClose").addEventListener("click", closePanel);
    document.getElementById("wwLogout").addEventListener("click", disconnect);
    document.addEventListener("click", function (e) {
      if (panel.hidden) return;
      if (panel.contains(e.target)) return;
      var addrBtn = document.getElementById("wwAddr");
      if (addrBtn && addrBtn.contains(e.target)) return;
      closePanel();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closePanel(); });
    return panel;
  }

  function openPanel() {
    if (!session) return;
    var panel = ensurePanel();
    var addrLink = document.getElementById("wwPanelAddr");
    addrLink.textContent = session.address;
    addrLink.href = ARC_EXPLORER + "/address/" + session.address;
    var balances = document.getElementById("wwBalances");
    balances.innerHTML = '<div class="ww-bal-row"><span class="ww-bal-net"><span class="ww-bal-dot"></span>Arc Testnet</span><span class="ww-bal-amt" id="wwArcBal">Checking...</span></div>';
    // anchor next to the wallet widget
    var widget = document.getElementById("walletWidget");
    if (widget) {
      var rect = widget.getBoundingClientRect();
      panel.style.left = Math.round(rect.right + 10) + "px";
      panel.style.bottom = Math.round(window.innerHeight - rect.bottom) + "px";
    }
    panel.hidden = false;
    // slide-in
    requestAnimationFrame(function () { panel.classList.add("is-open"); });
    fetchArcUsdcBalance().then(function (bal) {
      var el = document.getElementById("wwArcBal");
      if (el) el.textContent = bal == null ? "Unavailable" : (bal + " USDC");
    });
  }

  function closePanel() {
    var panel = document.getElementById("wwPanel");
    if (!panel) return;
    panel.classList.remove("is-open");
    panel.hidden = true;
  }

  // --- public API ---
  window.FundlineWallet = {
    getAddress: function () { return session ? session.address : ""; },
    getSession: function () { return session ? { address: session.address, authAt: session.authAt } : null; },
    isConnected: function () { return Boolean(session && session.address); },
    connect: connect,
    disconnect: disconnect,
    refreshBalance: fetchArcUsdcBalance,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restore);
  } else {
    restore();
  }
})();
