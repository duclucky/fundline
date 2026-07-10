import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
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
  sendTransaction: async (tx) => {
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

function Widget() {
  const { ready, authenticated, login, logout, exportWallet } = usePrivy();
  const { wallets } = useWallets();
  const [open, setOpen] = useState(false);
  const [bal, setBal] = useState(null);

  const embedded = wallets.find((w) => w.walletClientType === "privy") || wallets[0];
  const address = embedded && embedded.address ? embedded.address.toLowerCase() : "";

  useEffect(() => {
    api.ready = ready;
    api.login = login;
    api.logout = logout;
    api.exportWallet = () => exportWallet();
    api.getProvider = embedded ? (() => embedded.getEthereumProvider()) : null;
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
        <div className="ww-panel is-open" style={{ position: "fixed", left: 300, bottom: 20 }}>
          <div className="ww-panel-head">
            <strong>Wallet</strong>
            <button className="ww-panel-close" onClick={() => setOpen(false)} aria-label="Close">x</button>
          </div>
          <a className="ww-panel-addr" href={(CFG.explorerBase || FALLBACK_EXPLORER) + "/address/" + address} target="_blank" rel="noopener">{address}</a>
          <div className="ww-panel-label">Balance</div>
          <div className="ww-balances">
            <div className="ww-bal-row">
              <span className="ww-bal-net"><span className="ww-bal-dot"></span>Arc Testnet</span>
              <span className="ww-bal-amt">{bal == null ? "Checking..." : bal + " USDC"}</span>
            </div>
          </div>
          <button className="ww-send" onClick={() => exportWallet()}>Export private key</button>
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
