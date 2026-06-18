"use strict";

// Circle Gateway dry-run, finish stage. The deposit is already confirmed on-chain
// (ETH Sepolia tx 0xf1087f..., Gateway deposit event emitted). This script does NOT
// re-deposit. It waits for the Gateway API to credit the existing deposit, then runs
// the transfer steps end to end:
//   Step A: Poll /balances until the deposit is credited (ETH Sepolia finality ~19 min)
//   Step B: Build and sign the EIP-712 burn intent
//   Step C: POST to /transfer (Gateway API)
//   Step D: Poll transfer status until minted on Arc (Forwarding Service)
//   Step E: Verify Arc USDC balance
//
// Run: node test_gateway_finish.js   (intended to run in the background)

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");

const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

// Arc (destination)
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_DOMAIN = 26;
const ARC_USDC_DECIMALS = 6;

// ETH Sepolia (source) -- wallet has 40 USDC + ETH, deposit already confirmed here
const SRC_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
const SRC_CHAIN_ID = 11155111n;
const SRC_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const SRC_DOMAIN = 0;

// Gateway addresses (testnet)
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";

// Transfer params (must match the deposit: 1 USDC value + up to 0.5 USDC fee)
// Gateway reserves value + maxFee from the deposited balance at submission. The ETH
// Sepolia route enforces a 1 USDC minimum maxFee, and our deposit is 1.5 USDC, so the
// delivered value must be <= 0.5 USDC. Use 0.4 for a safety margin (0.4 + 1.0 = 1.4 <= 1.5).
const TRANSFER_AMOUNT = 400_000n;   // 0.4 USDC delivered to Arc
const MAX_FEE = 1_000_000n;         // 1 USDC max forwarding fee (ETH Sepolia route floor)

const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";

function encodeAddress(addr) {
  return addr.replace(/^0x/, "").padStart(64, "0");
}
function parseTokenUnits(text, decimals) {
  const d = Number(decimals);
  const [whole, fractionRaw = ""] = String(text).split(".");
  const fraction = fractionRaw.padEnd(d, "0").slice(0, d);
  return BigInt(whole.replace(/\D/g, "") || "0") * 10n ** BigInt(d) + BigInt(fraction || "0");
}
function addressToBytes32(addr) {
  return "0x" + "0".repeat(24) + addr.replace(/^0x/, "").toLowerCase();
}
function randomBytes32() {
  const arr = new Uint8Array(32);
  require("crypto").getRandomValues(arr);
  return "0x" + Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

function gatewayRequest(method, pathname, body) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.CIRCLE_GATEWAY_API_KEY || "";
    const payload = body ? JSON.stringify(body) : null;
    const headers = { "Content-Type": "application/json", "Accept": "application/json" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
    if (payload) headers["Content-Length"] = Buffer.byteLength(payload);
    const req = https.request(
      { hostname: "gateway-api-testnet.circle.com", path: `/v1${pathname}`, method, headers },
      (res) => {
        let data = "";
        res.on("data", (c) => { data += c; });
        res.on("end", () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(data || "{}") }); }
          catch { resolve({ status: res.statusCode, body: data }); }
        });
      }
    );
    req.setTimeout(30000, () => req.destroy(new Error("Gateway timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

function ts() { return new Date().toISOString().slice(11, 19); }

async function main() {
  const privateKey = process.env.ARC_DEPLOYER_PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!privateKey) { console.error("ERROR: ARC_DEPLOYER_PRIVATE_KEY not set"); process.exit(1); }
  if (!process.env.CIRCLE_GATEWAY_API_KEY) { console.error("ERROR: CIRCLE_GATEWAY_API_KEY not set"); process.exit(1); }

  const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
  const srcProvider = new ethers.JsonRpcProvider(SRC_RPC);

  const arcNet = await arcProvider.getNetwork();
  if (arcNet.chainId !== ARC_CHAIN_ID) { console.error("Wrong Arc chain"); process.exit(1); }
  const srcNet = await srcProvider.getNetwork();
  if (srcNet.chainId !== SRC_CHAIN_ID) { console.error("Wrong source chain"); process.exit(1); }

  const signer = new ethers.Wallet(privateKey);
  const wallet = signer.address;
  console.log(`[${ts()}] Wallet: ${wallet}`);
  console.log(`[${ts()}] Transfer: ${Number(TRANSFER_AMOUNT) / 1e6} USDC + up to ${Number(MAX_FEE) / 1e6} USDC fee`);

  // Record Arc balance before, to prove the delta after mint.
  const arcBefore = BigInt(await arcProvider.call({ to: ARC_USDC, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet) }));
  console.log(`[${ts()}] Arc USDC balance before: ${Number(arcBefore) / 1e6} USDC`);

  // Step A: Wait for the existing deposit to be credited (NO re-deposit).
  console.log(`\n[${ts()}] --- Step A: Wait for Gateway to credit the deposit (ETH Sepolia finality) ---`);
  const waitStart = Date.now();
  const maxWait = 20 * 60 * 1000; // 20 minutes
  let gwBalance = 0n;
  while (Date.now() - waitStart < maxWait) {
    const resp = await gatewayRequest("POST", "/balances", {
      token: "USDC",
      sources: [{ domain: SRC_DOMAIN, depositor: wallet }],
    });
    const entry = resp.body.balances?.[0];
    gwBalance = parseTokenUnits(String(entry?.balance || "0"), ARC_USDC_DECIMALS);
    const elapsed = Math.round((Date.now() - waitStart) / 1000);
    console.log(`[${ts()}] Gateway balance: ${Number(gwBalance) / 1e6} USDC (pending ${entry?.pendingBatch || "0"}) [waited ${elapsed}s]`);
    if (gwBalance >= TRANSFER_AMOUNT) break;
    await delay(30000);
  }
  if (gwBalance < TRANSFER_AMOUNT) {
    console.error(`[${ts()}] FAIL: deposit not credited within 20 min. Re-run later; deposit is safe on-chain.`);
    process.exit(1);
  }
  console.log(`[${ts()}] PASS: Gateway balance credited (${Number(gwBalance) / 1e6} USDC).`);

  // Step B + C: Build, sign, and submit the EIP-712 burn intent.
  // The Gateway API enforces a minimum maxBlockHeight relative to its own view of the
  // source chain head, which can be far ahead of a lagging public RPC. So we build with
  // a guess, and if the API rejects with "expected at least N", we re-sign at N + buffer.
  const types = {
    TransferSpec: [
      { name: "version", type: "uint32" },
      { name: "sourceDomain", type: "uint32" },
      { name: "destinationDomain", type: "uint32" },
      { name: "sourceContract", type: "bytes32" },
      { name: "destinationContract", type: "bytes32" },
      { name: "sourceToken", type: "bytes32" },
      { name: "destinationToken", type: "bytes32" },
      { name: "sourceDepositor", type: "bytes32" },
      { name: "destinationRecipient", type: "bytes32" },
      { name: "sourceSigner", type: "bytes32" },
      { name: "destinationCaller", type: "bytes32" },
      { name: "value", type: "uint256" },
      { name: "salt", type: "bytes32" },
      { name: "hookData", type: "bytes" },
    ],
    BurnIntent: [
      { name: "maxBlockHeight", type: "uint256" },
      { name: "maxFee", type: "uint256" },
      { name: "spec", type: "TransferSpec" },
    ],
  };

  async function buildSignSubmit(maxBlockHeight) {
    const spec = {
      version: 1,
      sourceDomain: SRC_DOMAIN,
      destinationDomain: ARC_DOMAIN,
      sourceContract: addressToBytes32(GATEWAY_WALLET),
      destinationContract: addressToBytes32(GATEWAY_MINTER),
      sourceToken: addressToBytes32(SRC_USDC),
      destinationToken: addressToBytes32(ARC_USDC),
      sourceDepositor: addressToBytes32(wallet),
      destinationRecipient: addressToBytes32(wallet),
      sourceSigner: addressToBytes32(wallet),
      destinationCaller: "0x" + "0".repeat(64),
      value: TRANSFER_AMOUNT.toString(),
      salt: randomBytes32(),
      hookData: "0x",
    };
    const message = { maxBlockHeight: maxBlockHeight.toString(), maxFee: MAX_FEE.toString(), spec };
    const signature = await signer.signTypedData(
      { name: "GatewayWallet", version: "1" },
      { TransferSpec: types.TransferSpec, BurnIntent: types.BurnIntent },
      message
    );
    const resp = await gatewayRequest("POST", "/transfer", [{ burnIntent: message, signature }]);
    return resp;
  }

  console.log(`\n[${ts()}] --- Step B + C: Build, sign, and submit burn intent ---`);
  const blockHex = await srcProvider.send("eth_blockNumber", []);
  const currentBlock = Number(BigInt(blockHex));
  let transferResp = await buildSignSubmit(currentBlock + 1000);
  console.log(`[${ts()}] Response status: ${transferResp.status}`);
  console.log(`[${ts()}] Response body: ${JSON.stringify(transferResp.body).slice(0, 500)}`);

  const blockErr = String(transferResp?.body?.message || "").match(/expected at least (\d+)/);
  if (transferResp.status === 400 && blockErr) {
    const minBlock = Number(blockErr[1]);
    console.log(`[${ts()}] Re-signing with maxBlockHeight = ${minBlock + 2000} (API floor + buffer)...`);
    transferResp = await buildSignSubmit(minBlock + 2000);
    console.log(`[${ts()}] Retry status: ${transferResp.status}`);
    console.log(`[${ts()}] Retry body: ${JSON.stringify(transferResp.body).slice(0, 500)}`);
  }

  if (transferResp.status !== 200 && transferResp.status !== 201) {
    console.error(`[${ts()}] FAIL: Gateway transfer request failed.`);
    process.exit(1);
  }
  const td = transferResp.body;
  const transferId = td?.id || (Array.isArray(td) ? td[0]?.id : (td?.transferId || null));

  // Step D: Poll transfer status (if an id is returned).
  if (transferId) {
    console.log(`[${ts()}] Transfer ID: ${transferId}`);
    console.log(`\n[${ts()}] --- Step D: Poll transfer status (Forwarding Service) ---`);
    const pollStart = Date.now();
    let minted = false;
    for (let attempt = 1; attempt <= 120; attempt++) {
      await delay(5000);
      const sResp = await gatewayRequest("GET", `/transfer/${encodeURIComponent(transferId)}`, null);
      if (sResp.status === 200) {
        const status = String(sResp.body.status || sResp.body.transferStatus || "").toLowerCase();
        console.log(`[${ts()}]   attempt ${attempt}: status=${status} (${Math.round((Date.now() - pollStart) / 1000)}s)`);
        if (["complete", "completed", "minted"].includes(status)) { minted = true; break; }
        if (["failed", "error"].includes(status)) {
          console.error(`[${ts()}] FAIL: transfer failed: ${JSON.stringify(sResp.body)}`);
          process.exit(1);
        }
      }
    }
    if (!minted) console.log(`[${ts()}] NOTE: status not "complete" within 10 min; verifying Arc balance anyway.`);
  } else {
    console.log(`[${ts()}] NOTE: no transfer id returned; the API may mint via Forwarding Service without polling. Verifying Arc balance.`);
  }

  // Step E: Verify Arc USDC balance increased.
  console.log(`\n[${ts()}] --- Step E: Verify Arc USDC balance ---`);
  let arcAfter = arcBefore;
  for (let i = 0; i < 24; i++) {
    arcAfter = BigInt(await arcProvider.call({ to: ARC_USDC, data: ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet) }));
    if (arcAfter > arcBefore) break;
    await delay(5000);
  }
  const delta = arcAfter - arcBefore;
  console.log(`[${ts()}] Arc USDC before: ${Number(arcBefore) / 1e6} USDC`);
  console.log(`[${ts()}] Arc USDC after:  ${Number(arcAfter) / 1e6} USDC`);
  console.log(`[${ts()}] Delta:           ${Number(delta) / 1e6} USDC`);

  console.log(`\n[${ts()}] --- Summary ---`);
  if (delta >= TRANSFER_AMOUNT) {
    console.log(`[${ts()}] ALL CHECKS PASSED. ETH Sepolia (domain 0) -> Arc (domain 26) Gateway transfer minted ${Number(delta) / 1e6} USDC on Arc.`);
  } else {
    console.log(`[${ts()}] PARTIAL: Arc balance delta ${Number(delta) / 1e6} USDC (expected >= ${Number(TRANSFER_AMOUNT) / 1e6}). Mint may still be propagating; re-check Arc balance shortly.`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`[${ts()}] Error: ${e.message || e}`);
  process.exit(1);
});
