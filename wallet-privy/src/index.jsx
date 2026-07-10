import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets, useMfaEnrollment } from "@privy-io/react-auth";
import { defineChain } from "viem";

// Runtime config is fetched from /api/config before mount (privyAppId, rpcUrl, chainId, etc.).
const CFG = {};
const FALLBACK_RPC = "https://rpc.testnet.arc.network";
const FALLBACK_EXPLORER = "https://testnet.arcscan.app";
const USDC = "0x3600000000000000000000000000000000000000";

function arcChain() {
  return defineChain({
    id: CFG.chainId || 5042002,
    name: CFG.networkName || "Arc Testnet",
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [CFG.rpcUrl || FALLBACK_RPC] } },
    blockExplorers: { default: { name: "Arcscan", url: CFG.explorerBase || FALLBACK_EXPLORER } },
  });
}

// Bridge so the vanilla app (app.js / workflows.js) keeps driving one window.FundlineWallet.
const api = { address: "", ready: false, login: null, logout: null, exportWallet: null, getProvider: null };
let connectWaiters = [];
function resolveConnect(addr) { connectWaiters.forEach((r) => r(addr)); connectWaiters = []; }
function emitChange() {
  try { document.dispatchEvent(new CustomEvent("fundline:walletchange", { detail: { address: api.address } })); } catch (e) {}
}

window.FundlineWallet = {
  getAddress: () => api.address || "",
  getSession: () => (api.address ? { address: api.address, authAt: "", kind: "privy" } : null),
  isConnected: () => Boolean(api.address),
  getProvider: () => null,
  connect: () => {
    if (api.address) return Promise.resolve(api.address);
    if (api.login) api.login();
    return new Promise((resolve) => connectWaiters.push(resolve));
  },
  disconnect: () => { if (api.logout) api.logout(); },
  refreshBalance: () => readBalance(api.address),
  exportWallet: () => { if (api.exportWallet) api.exportWallet(); },
  sendTransaction: async (tx, opts) => {
    // Routine workflow-run funding is co-signed server-side (policy) so it skips MFA; everything else
    // (invoice pay, withdraw, batch) signs on the client, which prompts MFA when enrolled.
    try { console.log("[privy] send", { viaServer: !!(opts && opts.viaServer), policy: CFG.walletPrivyPolicyEnabled, walletId: api.walletId }); } catch (e) {}
    if (opts && opts.viaServer && api.walletId && CFG.walletPrivyPolicyEnabled) {
      const r = await fetch("/api/wallet/privy/run-tx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletId: api.walletId, address: api.address, to: tx.to, data: tx.data || "0x", value: tx.value }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.hash) throw new Error((j.error && j.error.message) || "Transaction failed.");
      return j.hash;
    }
    if (!api.getProvider) throw new Error("Wallet is not ready.");
    const provider = await api.getProvider();
    if (!provider || !provider.request) throw new Error("Wallet provider unavailable.");
    const params = { from: api.address, to: tx.to, data: tx.data || "0x" };
    if (tx.value != null) params.value = tx.value;
    return provider.request({ method: "eth_sendTransaction", params: [params] });
  },
};

async function readBalance(addr) {
  if (!addr) return null;
  try {
    const data = "0x70a08231" + String(addr).toLowerCase().replace(/^0x/, "").padStart(64, "0");
    const r = await fetch(CFG.rpcUrl || FALLBACK_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDC, data }, "latest"] }),
    });
    const j = await r.json();
    const n = BigInt(j.result || "0x0");
    const whole = n / 1000000n;
    const frac = (n % 1000000n).toString().padStart(6, "0").replace(/0+$/, "");
    return frac ? (whole + "." + frac) : String(whole);
  } catch (e) { return null; }
}

function shortAddr(a) { return a ? a.slice(0, 6) + "..." + a.slice(-4) : ""; }

// Parse a decimal USDC string to 6-decimal base units (BigInt) or null if malformed.
function parseUsdc6(str) {
  const s = String(str || "").trim();
  if (!/^\d+(\.\d{1,6})?$/.test(s)) return null;
  const p = s.split(".");
  const f = ((p[1] || "") + "000000").slice(0, 6);
  try { return BigInt(p[0]) * 1000000n + BigInt(f); } catch (e) { return null; }
}

function Widget() {
  const { ready, authenticated, user, login, logout, exportWallet } = usePrivy();
  const { wallets } = useWallets();
  const mfa = useMfaEnrollment();
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState(null);
  const [mfaStep, setMfaStep] = useState(null); // null | "setup"
  const [mfaSecret, setMfaSecret] = useState("");
  const [mfaUri, setMfaUri] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState("");
  const [copied, setCopied] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTo, setSendTo] = useState("");
  const [sendAmt, setSendAmt] = useState("");
  const [sendMsg, setSendMsg] = useState("");
  const [sending, setSending] = useState(false);

  const mfaEnrolled = Boolean(user && Array.isArray(user.mfaMethods) && user.mfaMethods.length > 0);

  function copyAddr() {
    try { navigator.clipboard.writeText(address); } catch (e) {}
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  }

  async function doSend() {
    setSendMsg("");
    const to = String(sendTo || "").trim().toLowerCase();
    if (!/^0x[a-f0-9]{40}$/.test(to)) { setSendMsg("Enter a valid recipient address (0x...)."); return; }
    const units = parseUsdc6(sendAmt);
    if (units == null || units <= 0n) { setSendMsg("Enter a valid amount."); return; }
    setSending(true);
    try {
      const data = "0xa9059cbb" + to.replace(/^0x/, "").padStart(64, "0") + units.toString(16).padStart(64, "0");
      const txHash = await window.FundlineWallet.sendTransaction({ to: USDC, data: data, value: "0x0" });
      setSendMsg("Sent. " + (txHash ? txHash.slice(0, 12) + "..." : ""));
      setSendOpen(false); setSendTo(""); setSendAmt("");
      readBalance(address).then(setBal);
    } catch (e) { setSendMsg((e && e.message) || "Send failed."); }
    setSending(false);
  }

  async function startMfa() {
    setMfaMsg("");
    try {
      const res = (await mfa.initEnrollmentWithTotp()) || {};
      setMfaSecret(res.secret || res.totpSecret || "");
      setMfaUri(res.authenticatorUrl || res.uri || res.provisioningUri || res.otpauthUrl || "");
      setMfaStep("setup");
    } catch (e) { setMfaMsg((e && e.message) || "Could not start 2FA setup."); }
  }
  async function confirmMfa() {
    setMfaMsg("");
    try {
      try { await mfa.submitEnrollmentWithTotp({ mfaCode: mfaCode }); }
      catch (inner) { await mfa.submitEnrollmentWithTotp(mfaCode); }
      setMfaStep(null); setMfaCode("");
      setMfaMsg("2FA enabled. Exporting and signing now require your authenticator code.");
    } catch (e) { setMfaMsg((e && e.message) || "Wrong code, please try again."); }
  }

  const embedded = wallets.find((w) => w.walletClientType === "privy") || wallets[0];
  const address = embedded && embedded.address ? embedded.address.toLowerCase() : "";

  useEffect(() => {
    api.ready = ready;
    api.login = login;
    api.logout = logout;
    api.exportWallet = () => exportWallet();
    api.getProvider = embedded ? (() => embedded.getEthereumProvider()) : null;
    api.walletId = (embedded && (embedded.id || embedded.walletId)) || "";
    try {
      console.log("[privy] wallet fields", {
        walletId: api.walletId,
        address: api.address,
        embeddedKeys: embedded ? Object.keys(embedded) : null,
        userWallet: user ? user.wallet : null,
      });
    } catch (e) {}
    const prev = api.address;
    api.address = address;
    if (address !== prev) { emitChange(); if (address) resolveConnect(address); }
  }, [ready, authenticated, address, embedded]);

  useEffect(() => { if (open && address) readBalance(address).then(setBal); }, [open, address]);

  if (!ready) return React.createElement("button", { className: "ww-connect", disabled: true }, "Loading...");
  if (!authenticated || !address) {
    return React.createElement("button", { className: "ww-connect", onClick: () => login() }, "Connect wallet");
  }
  return (
    <>
      <button className="ww-addr" onClick={() => setOpen(!open)} title="Wallet details">
        <span className="ww-dot"></span>
        <span className="ww-addr-text">{shortAddr(address)}</span>
      </button>
      {open ? (
        <div className="ww-panel is-open" style={{ position: "fixed", left: 16, right: "auto", bottom: 16, zIndex: 90, width: "min(360px, calc(100vw - 24px))", boxSizing: "border-box", maxHeight: "85vh", overflowY: "auto" }}>
          <div className="ww-panel-head">
            <strong>Wallet</strong>
            <button className="ww-panel-close" onClick={() => setOpen(false)} aria-label="Close">x</button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <a className="ww-panel-addr" href={(CFG.explorerBase || FALLBACK_EXPLORER) + "/address/" + address} target="_blank" rel="noopener" style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{address}</a>
            <button className="ww-send" style={{ width: "auto", margin: 0, padding: "6px 10px", flexShrink: 0 }} onClick={copyAddr}>{copied ? "Copied" : "Copy"}</button>
          </div>
          <div className="ww-panel-label">Balance</div>
          <div className="ww-balances">
            <div className="ww-bal-row">
              <span className="ww-bal-net"><span className="ww-bal-dot"></span>Arc Testnet</span>
              <span className="ww-bal-amt">{bal == null ? "Checking..." : bal + " USDC"}</span>
            </div>
          </div>
          {sendOpen ? (
            <div>
              <div className="ww-panel-label">Send / Withdraw</div>
              <input placeholder="Recipient 0x..." value={sendTo} onChange={(e) => setSendTo(e.target.value.trim())} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, border: "1px solid rgba(212,175,55,0.3)", background: "rgba(18,16,10,0.5)", color: "#f6f1e6", margin: "6px 0" }} />
              <input inputMode="decimal" placeholder="Amount USDC" value={sendAmt} onChange={(e) => setSendAmt(e.target.value.trim())} style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, border: "1px solid rgba(212,175,55,0.3)", background: "rgba(18,16,10,0.5)", color: "#f6f1e6", margin: "6px 0" }} />
              <button className="ww-send" disabled={sending} onClick={doSend}>{sending ? "Sending..." : "Send"}</button>
              <button className="ww-link" onClick={() => { setSendOpen(false); setSendMsg(""); }}>Cancel</button>
            </div>
          ) : (
            <button className="ww-send" onClick={() => { setSendOpen(true); setSendMsg(""); }}>Send / Withdraw</button>
          )}
          {sendMsg ? <div className="ww-panel-note">{sendMsg}</div> : null}
          {mfaEnrolled ? (
            <>
              <div className="ww-panel-note" style={{ color: "#6df7a0" }}>2FA is on. Export requires your authenticator code.</div>
              <button className="ww-send" onClick={() => exportWallet()}>Export private key</button>
            </>
          ) : mfaStep === "setup" ? (
            <div>
              <div className="ww-panel-label">Set up 2FA</div>
              <p className="ww-panel-note">Add this key to Google Authenticator or Authy, then enter the 6-digit code.</p>
              {mfaSecret ? (
                <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", padding: 8, background: "rgba(255,255,255,0.06)", borderRadius: 8, margin: "6px 0" }}>{mfaSecret}</div>
              ) : null}
              {mfaUri ? <a className="ww-panel-addr" href={mfaUri}>Open in authenticator app</a> : null}
              <input
                inputMode="numeric"
                placeholder="6-digit code"
                value={mfaCode}
                onChange={(e) => setMfaCode(e.target.value.trim())}
                style={{ width: "100%", boxSizing: "border-box", padding: 10, borderRadius: 10, border: "1px solid rgba(212,175,55,0.3)", background: "rgba(18,16,10,0.5)", color: "#f6f1e6", margin: "6px 0" }}
              />
              <button className="ww-send" onClick={confirmMfa}>Confirm 2FA</button>
            </div>
          ) : (
            <>
              <p className="ww-panel-note">Enable 2FA to protect your private key. Export is locked until 2FA is on.</p>
              <button className="ww-send" onClick={startMfa}>Enable 2FA to export</button>
            </>
          )}
          {mfaMsg ? <div className="ww-panel-note">{mfaMsg}</div> : null}
          <button className="ww-logout" onClick={() => { logout(); setOpen(false); }}>Disconnect</button>
        </div>
      ) : null}
    </>
  );
}

function Root() {
  return (
    <PrivyProvider
      appId={CFG.privyAppId || ""}
      config={{
        loginMethods: ["email", "google"],
        embeddedWallets: { createOnLogin: "users-without-wallets" },
        defaultChain: arcChain(),
        supportedChains: [arcChain()],
      }}
    >
      <Widget />
    </PrivyProvider>
  );
}

async function boot() {
  const el = document.getElementById("walletWidget");
  if (!el) return;
  try {
    const cfg = await (await fetch("/api/config")).json();
    Object.assign(CFG, cfg);
  } catch (e) {}
  if (!CFG.privyAppId) return; // Privy not configured on the server; leave the widget to the fallback.
  createRoot(el).render(React.createElement(Root));
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
