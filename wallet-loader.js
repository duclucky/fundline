"use strict";

// Chooses the wallet layer at runtime so the heavy Privy bundle is only loaded when enabled:
// - Privy embedded wallet (wallet-privy.bundle.js) when walletPrivyEnabled + privyAppId are set
// - otherwise the default wallet.js (external wallets + Circle)
// Both define window.FundlineWallet, so the rest of the app (app.js / workflows.js) is unchanged.
(function () {
  function load(src) {
    var s = document.createElement("script");
    s.src = src;
    document.body.appendChild(s);
  }
  fetch("/api/config")
    .then(function (r) { return r.json(); })
    .then(function (cfg) {
      if (cfg && cfg.walletPrivyEnabled && cfg.privyAppId) load("/wallet-privy.bundle.js");
      else load("/wallet.js");
    })
    .catch(function () { load("/wallet.js"); });
})();
