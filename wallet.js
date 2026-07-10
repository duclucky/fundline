"use strict";

// Shared wallet session for the whole Fundline dApp. Loaded on every page that has
// the sidebar (app.html, workflows.html). Manages a single connect/disconnect session
// (localStorage, dApp-wide), renders the sidebar wallet widget, and provides a
// wallet picker with EIP-6963 multi-wallet discovery and WalletConnect QR login.
(function () {
  "use strict";

  var SESSION_KEY = "fundline_wallet_session";
  var ARC_CHAIN_ID_HEX = "0x4cef52"; // 5042002
  var ARC_USDC = "0x3600000000000000000000000000000000000000";
  var ARC_EXPLORER = "https://testnet.arcscan.app";
  var ARC_RPC = "https://rpc.testnet.arc.network";
  var ERC20_BALANCE_OF = "0x70a08231";

  var session = null;         // { address, authAt }
  var activeProvider = null;  // the EIP-1193 provider chosen in the picker
  var walletKind = "";        // "injected" | "walletconnect"
  var discoveredWallets = []; // wallets announced via EIP-6963
  var _wcProvider = null;     // cached WalletConnect provider instance
  var _publicConfig = null;   // cached /api/config (for walletConnectProjectId)

  // The active provider, falling back to window.ethereum when no picker choice has been made.
  function getProvider() {
    return activeProvider || (typeof window !== "undefined" && window.ethereum) || null;
  }

  // Adopt a new provider as the active one and wire accountsChanged.
  function setActiveProvider(p, kind) {
    if (!p) return;
    if (activeProvider && activeProvider !== p && typeof activeProvider.removeListener === "function") {
      try { activeProvider.removeListener("accountsChanged", handleAccountsChanged); } catch (_) {}
    }
    activeProvider = p;
    walletKind = kind || "injected";
    if (p.on) p.on("accountsChanged", handleAccountsChanged);
  }

  function handleAccountsChanged(accounts) {
    var current = normalizeAddress(accounts && accounts[0]);
    if (!session) return;
    if (!current || current !== session.address) disconnect();
  }

  function normalizeAddress(value) {
    var t = String(value || "").trim();
    return /^0x[a-fA-F0-9]{40}$/.test(t) ? t.toLowerCase() : "";
  }
  function shortAddress(a) { return a ? (a.slice(0, 6) + "..." + a.slice(-4)) : ""; }
  function encAddr(a) { return normalizeAddress(a).replace(/^0x/, "").padStart(64, "0"); }
  function formatUnits6(hex) {
    var n;
    try { n = BigInt(hex || "0x0"); } catch (e) { n = 0n; }
    var whole = n / 1000000n;
    var frac = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? (whole.toString() + "." + frac) : whole.toString();
  }
  function escapeHtml(s) {
    return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function stringToHex(str) {
    var hex = "0x";
    for (var i = 0; i < str.length; i += 1) hex += str.charCodeAt(i).toString(16).padStart(2, "0");
    return hex;
  }

  // --- session persistence ---
  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      var obj = raw ? JSON.parse(raw) : null;
      if (obj && normalizeAddress(obj.address)) return { address: normalizeAddress(obj.address), authAt: obj.authAt || "", kind: obj.kind || "" };
    } catch (e) {}
    return null;
  }
  function saveSession(s) { try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch (e) {} }
  function clearSession() { try { localStorage.removeItem(SESSION_KEY); } catch (e) {} }

  function emitChange() {
    try {
      document.dispatchEvent(new CustomEvent("fundline:walletchange", { detail: { address: session ? session.address : "" } }));
    } catch (e) {}
  }

  // --- EIP-6963 multi-wallet discovery ---
  // Each installed wallet extension announces itself; we collect them so the picker
  // can show a named button per wallet instead of blindly grabbing window.ethereum.
  function initWalletDiscovery() {
    window.addEventListener("eip6963:announceProvider", function (event) {
      var detail = event.detail;
      if (!detail || !detail.info || !detail.provider) return;
      var key = detail.info.rdns || detail.info.uuid || detail.info.name;
      if (discoveredWallets.some(function (w) { return (w.info.rdns || w.info.uuid || w.info.name) === key; })) return;
      discoveredWallets.push({ info: detail.info, provider: detail.provider });
    });
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }

  // --- public config (lazy, for walletConnectProjectId + chainId/rpcUrl) ---
  async function getPublicConfig() {
    if (_publicConfig) return _publicConfig;
    try {
      var res = await fetch("/api/config");
      _publicConfig = await res.json();
    } catch (_) { _publicConfig = {}; }
    return _publicConfig;
  }

  // Build the list of connect options: all EIP-6963 wallets + WalletConnect if configured.
  async function buildWalletOptions() {
    var options = discoveredWallets.map(function (w) {
      return { kind: "injected", name: w.info.name || "Wallet", icon: w.info.icon || "", provider: w.provider };
    });
    var config = await getPublicConfig();
    if (config.walletConnectProjectId) {
      options.push({ kind: "walletconnect", name: "WalletConnect (scan with mobile)", icon: "" });
    }
    // Mainstream options first: create or open a wallet with just an email (Circle, no extension),
    // and Google when social login is configured.
    if (config.walletCircleEnabled && config.circleAppId) {
      var circleOpts = [{ kind: "circle", name: "Continue with email" }];
      if (config.circleSocialEnabled) circleOpts.push({ kind: "circle-google", name: "Continue with Google" });
      options = circleOpts.concat(options);
    }
    return options;
  }

  // --- connect entry point ---
  async function connect() {
    var options = await buildWalletOptions();
    if (options.length > 1) {
      // Multiple wallets or WalletConnect: show the picker.
      openWalletPicker(options);
      return "";
    }
    if (options.length === 1) {
      return await connectWithOption(options[0]);
    }
    // Nothing discovered and no WalletConnect: fall back to the injected provider.
    if (!window.ethereum || !window.ethereum.request) {
      alert("No wallet found. Install a wallet extension (OKX, MetaMask, etc.) or configure WalletConnect.");
      return "";
    }
    return await connectWithProvider(window.ethereum, "");
  }

  async function connectWithOption(option) {
    if (!option) return "";
    if (option.kind === "walletconnect") {
      await connectWithWalletConnect();
      return session ? session.address : "";
    }
    if (option.kind === "circle") {
      await connectWithCircleEmail();
      return session ? session.address : "";
    }
    if (option.kind === "circle-google") {
      await connectWithCircleSocial("Google");
      return session ? session.address : "";
    }
    return await connectWithProvider(option.provider, option.name);
  }

  // Make sure the wallet is on Arc Testnet. Tries to switch, and adds the network if the
  // wallet does not know it yet, so the user never has to add or switch the chain by hand.
  // Best-effort: any failure (including the user declining) is swallowed so it never blocks
  // the session. The pay and run flows re-check the network before sending a transaction.
  async function ensureArcNetwork(p) {
    if (!p || !p.request) return;
    try {
      var current = String(await p.request({ method: "eth_chainId" })).toLowerCase();
      if (current === ARC_CHAIN_ID_HEX) return;
      try {
        await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ARC_CHAIN_ID_HEX }] });
      } catch (err) {
        if (Number(err && err.code) !== 4902) throw err;
        await p.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: ARC_CHAIN_ID_HEX,
              chainName: "Arc Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [ARC_RPC],
              blockExplorerUrls: [ARC_EXPLORER],
            },
          ],
        });
      }
    } catch (err) {
      if (typeof console !== "undefined") console.warn("Arc network switch skipped:", err && err.message);
    }
  }

  async function connectWithProvider(p, name) {
    if (!p || !p.request) { alert("That wallet is unavailable."); return ""; }
    setActiveProvider(p, "injected");
    try {
      var accounts = await p.request({ method: "eth_requestAccounts" });
      var address = normalizeAddress(accounts && accounts[0]);
      if (!address) throw new Error("Wallet did not return a valid address.");
      await ensureArcNetwork(p);
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
        if (Number(err && err.code) === 4001) throw err;
        await p.request({ method: "personal_sign", params: [message, address] });
      }
      session = { address: address, authAt: issuedAt };
      saveSession(session);
      closePickerDialog();
      render();
      emitChange();
      return address;
    } catch (err) {
      if (Number(err && err.code) !== 4001) { /* non-rejection: leave dialog open or alert */ }
      throw err;
    }
  }

  // --- WalletConnect (scan a QR with a mobile wallet) ---
  // Lazy-imports the provider and QR generator from a CDN only when the user picks
  // WalletConnect, so no extra bytes are loaded for extension-wallet users.

  async function getWalletConnectProvider(projectId) {
    if (_wcProvider) return _wcProvider;
    var config = await getPublicConfig();
    var mod = await import("https://esm.sh/@walletconnect/ethereum-provider@2.23.9");
    var EthereumProvider = mod.EthereumProvider || (mod.default && mod.default.EthereumProvider) || mod.default;
    _wcProvider = await EthereumProvider.init({
      projectId: projectId,
      showQrModal: false, // we render our own QR in the picker dialog
      optionalChains: [config.chainId || 5042002, 1, 8453, 11155111, 84532],
      rpcMap: { [config.chainId || 5042002]: config.rpcUrl || "https://rpc.testnet.arc.network" },
      optionalMethods: ["eth_sendTransaction", "personal_sign", "eth_signTypedData_v4", "wallet_switchEthereumChain", "wallet_addEthereumChain"],
      metadata: {
        name: "Fundline",
        description: "USDC invoices on Arc",
        url: window.location.origin,
        icons: [window.location.origin + "/assets/fundline-logo.png"],
      },
    });
    _wcProvider.on("accountsChanged", handleAccountsChanged);
    _wcProvider.on("disconnect", function () { if (walletKind === "walletconnect") disconnect(); });
    return _wcProvider;
  }

  async function connectWithWalletConnect() {
    var config = await getPublicConfig();
    var projectId = config.walletConnectProjectId;
    if (!projectId) { alert("WalletConnect is not configured."); return; }
    try {
      var p = await getWalletConnectProvider(projectId);
      var onUri = function (uri) { showWalletConnectQr(uri); };
      p.on("display_uri", onUri);
      try {
        await p.enable(); // resolves once the mobile wallet approves the session
      } finally {
        if (p.removeListener) p.removeListener("display_uri", onUri);
      }
      var address = normalizeAddress((p.accounts && p.accounts[0]) || "");
      if (!address) { alert("WalletConnect did not return an address."); return; }
      setActiveProvider(p, "walletconnect");
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
        if (Number(err && err.code) === 4001) throw err;
        await p.request({ method: "personal_sign", params: [message, address] });
      }
      session = { address: address, authAt: issuedAt };
      saveSession(session);
      closePickerDialog();
      render();
      emitChange();
    } catch (err) {
      closePickerDialog();
      if (Number(err && err.code) !== 4001) alert((err && err.message) || "WalletConnect connection cancelled.");
    }
  }

  // --- Circle user-controlled wallet (email login) ---
  // Optional wallet option so a mainstream user can create or open a wallet with just an email,
  // no extension. The user controls the key via Circle MPC; the server only proxies the calls with
  // its API key (never a key or entity secret). Gated on /api/config.walletCircleEnabled, so it is
  // dormant until configured. NOTE: the Web SDK method sequence (updateConfigs + verifyOtp) follows
  // Circle's docs; re-verify it live against the installed SDK version when first enabling this.
  var _circleSdkPromise = null;
  var _circleSdk = null;          // live W3SSdk instance after login
  var _circleAuth = null;         // { userToken, encryptionKey } (memory only, ~60 min)
  var _circleWalletId = "";       // Circle wallet id (for contract-execution challenges)
  function loadCircleSdk() {
    if (!_circleSdkPromise) {
      // The SDK bundles poorly as a raw ESM import, so try CDNs that inline dependencies. If all
      // fail, reset so the next attempt can retry (a rejected cached promise would stick forever).
      var urls = [
        "https://esm.sh/@circle-fin/w3s-pw-web-sdk?bundle",
        "https://cdn.jsdelivr.net/npm/@circle-fin/w3s-pw-web-sdk/+esm",
        "https://esm.sh/@circle-fin/w3s-pw-web-sdk",
      ];
      _circleSdkPromise = (async function () {
        var lastErr = null;
        for (var i = 0; i < urls.length; i += 1) {
          try {
            var mod = await import(urls[i]);
            var W3SSdk = mod.W3SSdk || (mod.default && mod.default.W3SSdk) || mod.default;
            if (W3SSdk) return W3SSdk;
            lastErr = new Error("W3SSdk export not found");
          } catch (e) { lastErr = e; }
        }
        throw new Error("Circle Web SDK failed to load. " + ((lastErr && lastErr.message) || ""));
      })().catch(function (e) { _circleSdkPromise = null; throw e; });
    }
    return _circleSdkPromise;
  }

  async function circlePostJson(path, body) {
    var res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error((json && json.error && json.error.message) || "Request failed.");
    return json;
  }

  // Full email OTP login per Circle's current Web SDK docs: construct the SDK with the completion
  // callback as the SECOND constructor argument, request the code, feed the session tokens via
  // loginConfigs (NOT authentication), then open the SDK OTP window. Resolves { sdk, userToken,
  // encryptionKey }.
  async function circleEmailLogin(W3SSdk, appId, email) {
    return await new Promise(function (resolve, reject) {
      var sdk = new W3SSdk(
        { appSettings: { appId: appId } },
        function (error, result) {
          if (error) { reject(new Error(error.message || "OTP verification failed.")); return; }
          if (result && result.userToken && result.encryptionKey) resolve({ sdk: sdk, userToken: result.userToken, encryptionKey: result.encryptionKey });
          else reject(new Error("Login did not return a session."));
        },
      );
      (async function () {
        try {
          var deviceId = await sdk.getDeviceId();
          var tokenResp = await circlePostJson("/api/wallet/circle/email/token", { deviceId: deviceId, email: email });
          sdk.updateConfigs({
            appSettings: { appId: appId },
            loginConfigs: {
              deviceToken: tokenResp.deviceToken,
              deviceEncryptionKey: tokenResp.deviceEncryptionKey,
              otpToken: tokenResp.otpToken,
              email: { email: email },
            },
          });
          sdk.verifyOtp();
        } catch (e) { reject(e); }
      })();
    });
  }

  // Execute a wallet-creation (or other) challenge in the SDK.
  function circleExecute(sdk, userToken, encryptionKey, challengeId) {
    return new Promise(function (resolve, reject) {
      try {
        sdk.setAuthentication({ userToken: userToken, encryptionKey: encryptionKey });
        sdk.execute(challengeId, function (error, result) {
          if (error) { reject(new Error(error.message || "Wallet setup failed.")); return; }
          resolve(result);
        });
      } catch (err) { reject(err); }
    });
  }

  // Shared post-login step (email + social): create the wallet if needed, read the address, and
  // set the shared session. Keeps the live SDK + userToken in memory for signing (P2/P3); the
  // userToken is short-lived and never persisted, so the signing path re-authenticates after reload.
  async function finishCircleLogin(sdk, login) {
    var walletsResp = await circlePostJson("/api/wallet/circle/wallets", { userToken: login.userToken });
    if (!walletsResp.primary || !walletsResp.primary.address) {
      var init = await circlePostJson("/api/wallet/circle/initialize", { userToken: login.userToken });
      if (init.challengeId) await circleExecute(sdk, login.userToken, login.encryptionKey, init.challengeId);
      walletsResp = await circlePostJson("/api/wallet/circle/wallets", { userToken: login.userToken });
    }
    var address = normalizeAddress(walletsResp.primary && walletsResp.primary.address);
    if (!address) throw new Error("Wallet was not created. Please try again.");
    _circleSdk = sdk;
    _circleAuth = { userToken: login.userToken, encryptionKey: login.encryptionKey };
    _circleWalletId = (walletsResp.primary && walletsResp.primary.id) || "";
    session = { address: address, authAt: new Date().toISOString(), kind: "circle", circleWalletId: _circleWalletId };
    saveSession(session);
    closePickerDialog();
    render();
    emitChange();
  }

  async function connectWithCircleEmail() {
    var config = await getPublicConfig();
    if (!config.walletCircleEnabled || !config.circleAppId) { alert("Email sign-in is not available right now."); return; }
    renderCircleEmailStep(config, "");
  }

  // Professional in-dialog email step (replaces the browser prompt). The Web SDK then shows its own
  // OTP entry UI after the code is sent.
  function renderCircleEmailStep(config, errorMsg) {
    var dialog = ensurePickerDialog();
    var body = document.getElementById("wwPickerBody");
    if (!body) return;
    body.innerHTML =
      "<div class=\"dialog-head\">" +
        "<div><p class=\"eyebrow\">Connect</p><h2>Continue with email</h2></div>" +
        "<button class=\"icon-button\" id=\"wwPickerClose\" type=\"button\" aria-label=\"Close\">" +
          "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6 6 18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>" +
        "</button>" +
      "</div>" +
      "<p class=\"muted ww-hint\">We will email you a one-time code to create or open your wallet.</p>" +
      "<form id=\"wwEmailForm\" class=\"ww-email-form\">" +
        "<input id=\"wwEmailInput\" type=\"email\" inputmode=\"email\" autocomplete=\"email\" placeholder=\"you@example.com\" required />" +
        (errorMsg ? ("<p class=\"ww-error\">" + escapeHtml(errorMsg) + "</p>") : "") +
        "<button class=\"primary-action ww-email-submit\" type=\"submit\">Send code</button>" +
      "</form>";
    var closeBtn = document.getElementById("wwPickerClose");
    if (closeBtn) closeBtn.addEventListener("click", closePickerDialog);
    var form = document.getElementById("wwEmailForm");
    var input = document.getElementById("wwEmailInput");
    if (input) { try { input.focus(); } catch (e) {} }
    if (form) form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = ((input && input.value) || "").trim();
      if (!email) return;
      startCircleEmailLogin(config, email);
    });
    if (!dialog.open) dialog.showModal();
  }

  async function startCircleEmailLogin(config, email) {
    var submit = document.querySelector("#wwEmailForm .ww-email-submit");
    if (submit) { submit.disabled = true; submit.textContent = "Sending code..."; }
    try {
      var W3SSdk = await loadCircleSdk();
      var login = await circleEmailLogin(W3SSdk, config.circleAppId, email);
      await finishCircleLogin(login.sdk, { userToken: login.userToken, encryptionKey: login.encryptionKey });
    } catch (err) {
      renderCircleEmailStep(config, (err && err.message) || "Sign-in failed. Please try again.");
    }
  }

  // (P4) Social login (Google first). Requires the provider's OAuth client to be configured in the
  // Circle Console. The SDK handles the OAuth exchange and returns the session in the callback.
  // NOTE: the exact performLogin provider argument (enum vs string) needs a live verification pass.
  async function connectWithCircleSocial(providerName) {
    var config = await getPublicConfig();
    if (!config.walletCircleEnabled || !config.circleAppId) { alert("Social sign-in is not available right now."); return; }
    try {
      var W3SSdk = await loadCircleSdk();
      var login = await new Promise(function (resolve, reject) {
        var sdk = new W3SSdk(
          { appSettings: { appId: config.circleAppId } },
          function (error, result) {
            if (error) { reject(new Error(error.message || "Social sign-in failed.")); return; }
            if (result && result.userToken && result.encryptionKey) resolve({ sdk: sdk, userToken: result.userToken, encryptionKey: result.encryptionKey });
            else reject(new Error("Social sign-in did not return a session."));
          },
        );
        try { sdk.performLogin(providerName); } catch (e) { reject(e); }
      });
      await finishCircleLogin(login.sdk, { userToken: login.userToken, encryptionKey: login.encryptionKey });
    } catch (err) {
      closePickerDialog();
      alert((err && err.message) || "Social sign-in failed. Please try again.");
    }
  }

  // (P2/P3) Sign + broadcast a transaction from a Circle wallet: build a contract-execution
  // challenge on the backend from Fundline-encoded calldata, let the user approve it in the SDK,
  // then poll for the on-chain hash. Returns the txHash so callers behave exactly like the EOA path.
  // NOTE: the SDK execute + userToken lifecycle here need a live verification pass on first enable.
  async function circleSendTransaction(tx) {
    if (!_circleSdk || !_circleAuth || !_circleAuth.userToken) {
      // Session expired or restored from storage without a live token: re-authenticate to sign.
      await connectWithCircleEmail();
      if (!_circleSdk || !_circleAuth || !_circleAuth.userToken) throw new Error("Sign in with your email to authorize this.");
    }
    var rid = (window.crypto && window.crypto.randomUUID) ? window.crypto.randomUUID() : (String(Date.now()) + Math.random().toString(16).slice(2));
    var refId = "fl-" + rid;
    var created = await circlePostJson("/api/wallet/circle/transaction", {
      userToken: _circleAuth.userToken,
      walletId: _circleWalletId || undefined,
      walletAddress: _circleWalletId ? undefined : (session && session.address),
      to: tx.to,
      data: tx.data || "0x",
      value: tx.value,
      refId: refId,
    });
    if (!created.challengeId) throw new Error("Could not start the transaction.");
    await circleExecute(_circleSdk, _circleAuth.userToken, _circleAuth.encryptionKey, created.challengeId);
    for (var i = 0; i < 60; i += 1) {
      await new Promise(function (r) { setTimeout(r, 3000); });
      var st = await circlePostJson("/api/wallet/circle/tx-status", { userToken: _circleAuth.userToken, refId: refId }).catch(function () { return {}; });
      if (st && st.txHash) return st.txHash;
      if (st && String(st.state || "").toUpperCase() === "FAILED") throw new Error("Transaction failed on-chain.");
    }
    throw new Error("Transaction not confirmed in time.");
  }

  async function showWalletConnectQr(uri) {
    var dialog = ensurePickerDialog();
    var body = document.getElementById("wwPickerBody");
    if (!body) return;
    body.innerHTML =
      "<div class=\"dialog-head\">" +
        "<div><p class=\"eyebrow\">Connect</p><h2>Scan with your wallet</h2></div>" +
        "<button class=\"icon-button\" id=\"wwPickerClose\" type=\"button\" aria-label=\"Close\">" +
          "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6 6 18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>" +
        "</button>" +
      "</div>" +
      "<div class=\"wc-qr\"><canvas id=\"wcQrCanvas\"></canvas></div>" +
      "<p class=\"muted wc-hint\">Open your mobile wallet, choose WalletConnect or Scan, and scan this code.</p>" +
      "<div class=\"copy-row\">" +
        "<input readonly value=\"" + escapeHtml(uri) + "\" />" +
        "<button class=\"ghost-action\" id=\"wcCopyLink\" type=\"button\">Copy link</button>" +
      "</div>";
    var closeBtn = document.getElementById("wwPickerClose");
    if (closeBtn) closeBtn.addEventListener("click", closePickerDialog);
    var copyBtn = document.getElementById("wcCopyLink");
    if (copyBtn) copyBtn.addEventListener("click", function () {
      if (navigator.clipboard) navigator.clipboard.writeText(uri).catch(function () {});
    });
    if (!dialog.open) dialog.showModal();
    try {
      var qrcode = (await import("https://esm.sh/qrcode@1.5.4")).default;
      await qrcode.toCanvas(document.getElementById("wcQrCanvas"), uri, { width: 240, margin: 1 });
    } catch (_) {
      // The copyable link above is the fallback when the QR generator fails to load.
    }
  }

  // --- wallet picker dialog ---
  function ensurePickerDialog() {
    var existing = document.getElementById("wwPickerDialog");
    if (existing) return existing;
    var dialog = document.createElement("dialog");
    dialog.id = "wwPickerDialog";
    dialog.className = "invoice-dialog";
    var inner = document.createElement("div");
    inner.id = "wwPickerBody";
    inner.className = "dialog-body";
    dialog.appendChild(inner);
    dialog.addEventListener("click", function (e) { if (e.target === dialog) closePickerDialog(); });
    document.body.appendChild(dialog);
    return dialog;
  }

  function closePickerDialog() {
    var dialog = document.getElementById("wwPickerDialog");
    if (dialog && dialog.open) dialog.close();
  }

  function openWalletPicker(options) {
    var dialog = ensurePickerDialog();
    var body = document.getElementById("wwPickerBody");
    if (!body) return;
    var rows = options.map(function (option, index) {
      var icon = /^(data:|https:)/.test(option.icon || "") ? option.icon : "";
      var iconHtml = icon ? "<img class=\"wallet-option-icon\" src=\"" + escapeHtml(icon) + "\" alt=\"\" />" : "";
      return "<button class=\"wallet-option\" type=\"button\" data-wallet-index=\"" + index + "\">" + iconHtml + "<span>" + escapeHtml(option.name || "Wallet") + "</span></button>";
    }).join("");
    body.innerHTML =
      "<div class=\"dialog-head\">" +
        "<div><p class=\"eyebrow\">Connect</p><h2>Choose a wallet</h2></div>" +
        "<button class=\"icon-button\" id=\"wwPickerClose\" type=\"button\" aria-label=\"Close\">" +
          "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6 6 18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg>" +
        "</button>" +
      "</div>" +
      "<div class=\"wallet-options\">" + rows + "</div>";
    var closeBtn = document.getElementById("wwPickerClose");
    if (closeBtn) closeBtn.addEventListener("click", closePickerDialog);
    body.querySelectorAll("[data-wallet-index]").forEach(function (btn) {
      btn.addEventListener("click", async function () {
        var chosen = options[Number(btn.dataset.walletIndex)];
        // Injected wallets connect immediately; walletconnect and the Circle options render their
        // own next step inside this dialog, so keep it open for them.
        if (chosen && chosen.kind === "injected") closePickerDialog();
        await connectWithOption(chosen);
      });
    });
    if (!dialog.open) dialog.showModal();
  }

  // --- disconnect ---
  function disconnect() {
    if (walletKind === "walletconnect" && _wcProvider) {
      try { _wcProvider.disconnect(); } catch (_) {}
    }
    session = null;
    activeProvider = null;
    walletKind = "";
    clearSession();
    closePanel();
    closePickerDialog();
    render();
    emitChange();
  }

  // Silently restore a stored session on page load without prompting the user,
  // only if the wallet still reports the same address (eth_accounts, no popup).
  async function restore() {
    initWalletDiscovery();
    render();
    var stored = loadSession();
    if (!stored) return;
    // Circle wallets have no injected provider to check against; restore the address directly.
    // userToken is not persisted, so the signing path re-authenticates on demand.
    if (stored.kind === "circle") { session = stored; _circleWalletId = stored.circleWalletId || ""; render(); emitChange(); return; }
    // Give EIP-6963 wallets a tick to announce themselves before reading ethereum.
    await new Promise(function (r) { setTimeout(r, 50); });
    var p = getProvider();
    if (!p || !p.request) return;
    try {
      var accounts = await p.request({ method: "eth_accounts" });
      var current = normalizeAddress(accounts && accounts[0]);
      if (current && current === stored.address) {
        session = stored;
        setActiveProvider(p, "injected");
      } else {
        clearSession();
        session = null;
      }
    } catch (e) { session = null; }
    render();
    emitChange();
  }

  // --- balance ---
  async function fetchArcUsdcBalance() {
    if (!session) return null;
    var data = ERC20_BALANCE_OF + encAddr(session.address);
    // Circle wallets have no injected provider; read the balance over the public Arc RPC.
    if (session.kind === "circle") {
      try {
        var cfg = await getPublicConfig();
        var r = await fetch(cfg.rpcUrl || ARC_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: ARC_USDC, data: data }, "latest"] }),
        });
        var j = await r.json();
        return formatUnits6(j && j.result);
      } catch (e) { return null; }
    }
    var p = getProvider();
    if (!p) return null;
    try {
      var res = await p.request({ method: "eth_call", params: [{ to: ARC_USDC, data: data }, "latest"] });
      return formatUnits6(res);
    } catch (e) { return null; }
  }

  // --- UI: sidebar wallet widget ---
  function render() {
    var host = document.getElementById("walletWidget");
    if (!host) return;
    if (session && session.address) {
      host.innerHTML =
        "<button class=\"ww-addr\" id=\"wwAddr\" type=\"button\" title=\"Wallet details\">" +
        "<span class=\"ww-dot\"></span><span class=\"ww-addr-text\">" + shortAddress(session.address) + "</span></button>";
      var addrBtn = document.getElementById("wwAddr");
      if (addrBtn) addrBtn.addEventListener("click", openPanel);
    } else {
      host.innerHTML = "<button class=\"ww-connect\" id=\"wwConnect\" type=\"button\">Connect wallet</button>";
      var connectBtn = document.getElementById("wwConnect");
      if (connectBtn) {
        connectBtn.addEventListener("click", function () {
          connectBtn.disabled = true;
          connectBtn.textContent = "Connecting...";
          connect().catch(function () {}).finally(function () {
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
      "<div class=\"ww-panel-head\"><strong>Wallet</strong>" +
      "<button class=\"ww-panel-close\" id=\"wwClose\" type=\"button\" aria-label=\"Close\">" +
      "<svg viewBox=\"0 0 24 24\" aria-hidden=\"true\"><path d=\"M6 6l12 12M18 6L6 18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\"/></svg></button></div>" +
      "<a class=\"ww-panel-addr\" id=\"wwPanelAddr\" target=\"_blank\" rel=\"noopener\"></a>" +
      "<div class=\"ww-panel-label\">Balances</div>" +
      "<div class=\"ww-balances\" id=\"wwBalances\"></div>" +
      "<p class=\"ww-panel-note\">More networks coming soon.</p>" +
      "<button class=\"ww-logout\" id=\"wwLogout\" type=\"button\">Disconnect</button>";
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
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closePanel(); closePickerDialog(); }
    });
    return panel;
  }

  function openPanel() {
    if (!session) return;
    var panel = ensurePanel();
    var addrLink = document.getElementById("wwPanelAddr");
    addrLink.textContent = session.address;
    addrLink.href = ARC_EXPLORER + "/address/" + session.address;
    var balances = document.getElementById("wwBalances");
    balances.innerHTML = "<div class=\"ww-bal-row\"><span class=\"ww-bal-net\"><span class=\"ww-bal-dot\"></span>Arc Testnet</span><span class=\"ww-bal-amt\" id=\"wwArcBal\">Checking...</span></div>";
    var widget = document.getElementById("walletWidget");
    if (widget) {
      var rect = widget.getBoundingClientRect();
      panel.style.left = Math.round(rect.right + 10) + "px";
      panel.style.bottom = Math.round(window.innerHeight - rect.bottom) + "px";
    }
    panel.hidden = false;
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

  // Single send path for the whole dApp. Today it is a thin EIP-1193 eth_sendTransaction on the
  // active external wallet; centralizing it here means a future non-EOA wallet kind (e.g. a Circle
  // user-controlled wallet, which signs via a challenge instead of eth_sendTransaction) can be
  // added in ONE place without touching every call site. The caller is responsible for putting the
  // wallet on the correct network first (ensureArcChain / ensurePaymentNetwork), same as before.
  async function sendTransaction(tx) {
    tx = tx || {};
    if (session && session.kind === "circle") {
      return await circleSendTransaction(tx);
    }
    var p = getProvider();
    if (!p || !p.request) throw new Error("No wallet provider available.");
    var params = { from: tx.from || (session && session.address) || "", to: tx.to, data: tx.data || "0x" };
    if (tx.value !== undefined && tx.value !== null) params.value = tx.value;
    return await p.request({ method: "eth_sendTransaction", params: [params] });
  }

  // --- public API ---
  window.FundlineWallet = {
    getAddress: function () { return session ? session.address : ""; },
    getSession: function () { return session ? { address: session.address, authAt: session.authAt, kind: session.kind || "" } : null; },
    isConnected: function () { return Boolean(session && session.address); },
    getProvider: getProvider,
    connect: connect,
    disconnect: disconnect,
    refreshBalance: fetchArcUsdcBalance,
    sendTransaction: sendTransaction,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", restore);
  } else {
    restore();
  }
})();
