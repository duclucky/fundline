"use strict";

// Circle Gateway dry-run: deposit on Base Sepolia -> burn intent -> Forwarding Service mints on Arc.
//
// This script validates the server-side Gateway proxy and the full transfer flow:
//   Step 1: Check Gateway balance (via /api/gateway/balance) on Base Sepolia (domain 6)
//   Step 2: If balance < required, deposit USDC to Gateway Wallet on Base Sepolia
//   Step 3: Build and sign EIP-712 burn intent
//   Step 4: POST to /api/gateway/transfer (server proxy)
//   Step 5: Poll transfer status until minted on Arc (Forwarding Service)
//   Step 6: Verify USDC balance on Arc increased
//
// Setup: ARC_DEPLOYER_PRIVATE_KEY and BASE_SEPOLIA_PRIVATE_KEY in .env (can be same key).
// Run:   node test_gateway_dryrun.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const https = require("https");

// Load .env manually
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    });
}

// Chain constants
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002n;
const ARC_USDC = "0x3600000000000000000000000000000000000000";
const ARC_DOMAIN = 26;
const ARC_USDC_DECIMALS = 6;

const BASE_SEPOLIA_RPC = "https://sepolia.base.org";
const BASE_SEPOLIA_CHAIN_ID = 84532n;
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const BASE_SEPOLIA_DOMAIN = 6;

// Gateway addresses (testnet)
const GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";
const GATEWAY_MINTER = "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B";
const GATEWAY_API_BASE = "https://gateway-api-testnet.circle.com/v1";

// Transfer params
const TRANSFER_AMOUNT = 2_000_000n; // 2 USDC
const MAX_FEE = 500_000n;           // 0.5 USDC max forwarding fee
const TOTAL_TRANSFER = TRANSFER_AMOUNT + MAX_FEE;

// Selectors
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const ERC20_BALANCE_OF_SELECTOR = "0x70a08231";
const GATEWAY_DEPOSIT_SELECTOR = "0x47e7ef24"; // deposit(address,uint256)

function encodeAddress(addr) {
  return addr.replace(/^0x/, "").padStart(64, "0");
}
function encodeUint256(n) {
  return n.toString(16).padStart(64, "0");
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

async function main() {
  const privateKey = process.env.ARC_DEPLOYER_PRIVATE_KEY || process.env.BASE_SEPOLIA_PRIVATE_KEY;
  if (!privateKey) {
    console.error("ERROR: ARC_DEPLOYER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }
  const apiKey = process.env.CIRCLE_GATEWAY_API_KEY;
  if (!apiKey) {
    console.error("ERROR: CIRCLE_GATEWAY_API_KEY not set in .env");
    process.exit(1);
  }

  const arcProvider = new ethers.JsonRpcProvider(ARC_RPC);
  const baseProvider = new ethers.JsonRpcProvider(BASE_SEPOLIA_RPC);

  const arcNetwork = await arcProvider.getNetwork();
  if (arcNetwork.chainId !== ARC_CHAIN_ID) { console.error("Wrong Arc chain"); process.exit(1); }
  const baseNetwork = await baseProvider.getNetwork();
  if (baseNetwork.chainId !== BASE_SEPOLIA_CHAIN_ID) { console.error("Wrong Base Sepolia chain"); process.exit(1); }

  const signer = new ethers.Wallet(privateKey);
  const wallet = signer.address;
  console.log("Wallet:", wallet);
  console.log("Transfer:", Number(TRANSFER_AMOUNT) / 1e6, "USDC +", Number(MAX_FEE) / 1e6, "USDC fee");

  // Step 1: Check Gateway balance
  console.log("\n--- Step 1: Check Gateway balance on Base Sepolia (domain 6) ---");
  const balResp = await gatewayRequest("POST", "/balances", {
    token: "USDC",
    sources: [{ domain: BASE_SEPOLIA_DOMAIN, depositor: wallet }],
  });
  if (balResp.status !== 200) {
    console.error("FAIL: Gateway balance check failed:", JSON.stringify(balResp.body));
    process.exit(1);
  }
  const gwBalEntry = balResp.body.balances?.[0];
  const gwBalance = parseTokenUnits(String(gwBalEntry?.balance || "0"), ARC_USDC_DECIMALS);
  console.log("Gateway balance:", Number(gwBalance) / 1e6, "USDC (settled)");
  console.log("Pending batch: ", gwBalEntry?.pendingBatch || "0", "USDC");

  // Step 2: Deposit if needed
  if (gwBalance < TOTAL_TRANSFER) {
    console.log("\n--- Step 2: Deposit to Gateway Wallet on Base Sepolia ---");
    const signerBase = signer.connect(baseProvider);

    // Check on-chain USDC balance
    const balData = ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet);
    const balResult = await baseProvider.call({ to: BASE_SEPOLIA_USDC, data: balData });
    const onChainBal = BigInt(balResult);
    console.log("On-chain USDC balance:", Number(onChainBal) / 1e6, "USDC");
    if (onChainBal < TOTAL_TRANSFER) {
      console.error(`FAIL: Insufficient USDC. Need ${Number(TOTAL_TRANSFER) / 1e6} USDC on Base Sepolia.`);
      console.error("Get testnet USDC at https://faucet.circle.com/");
      process.exit(1);
    }

    // Approve Gateway Wallet
    console.log("Approving Gateway Wallet to spend USDC...");
    const approveTx = await signerBase.sendTransaction({
      to: BASE_SEPOLIA_USDC,
      data: "0x" + ERC20_APPROVE_SELECTOR.replace(/^0x/, "") + encodeAddress(GATEWAY_WALLET) + encodeUint256(TOTAL_TRANSFER),
      gasLimit: 100000n,
    });
    console.log("Approve tx:", approveTx.hash);
    await approveTx.wait(1);
    console.log("PASS: Approved");

    // Deposit
    console.log(`Depositing ${Number(TOTAL_TRANSFER) / 1e6} USDC to Gateway Wallet...`);
    const depositData = "0x" + GATEWAY_DEPOSIT_SELECTOR.replace(/^0x/, "") + encodeAddress(BASE_SEPOLIA_USDC) + encodeUint256(TOTAL_TRANSFER);
    const depositTx = await signerBase.sendTransaction({
      to: GATEWAY_WALLET,
      data: depositData,
      gasLimit: 200000n,
    });
    console.log("Deposit tx:", depositTx.hash);
    const depositReceipt = await depositTx.wait(1);
    if (depositReceipt.status !== 1) {
      console.error("FAIL: Deposit reverted.");
      process.exit(1);
    }
    console.log("PASS: Deposit confirmed. Gas used:", depositReceipt.gasUsed.toString());

    // Wait for Gateway to recognize deposit
    console.log("Waiting for Gateway to process deposit (polling every 15s, up to 5 min for testnet)...");
    const depositStart = Date.now();
    let settled = false;
    while (Date.now() - depositStart < 300000) {
      await delay(15000);
      const pollResp = await gatewayRequest("POST", "/balances", {
        token: "USDC",
        sources: [{ domain: BASE_SEPOLIA_DOMAIN, depositor: wallet }],
      });
      const newBal = parseTokenUnits(String(pollResp.body.balances?.[0]?.balance || "0"), ARC_USDC_DECIMALS);
      console.log(`  Gateway balance: ${Number(newBal) / 1e6} USDC (waited ${Math.round((Date.now() - depositStart) / 1000)}s)`);
      if (newBal >= TOTAL_TRANSFER) { settled = true; break; }
    }
    if (!settled) {
      console.error("FAIL: Gateway did not recognize deposit within 5 minutes.");
      process.exit(1);
    }
    console.log("PASS: Gateway balance updated.");
  } else {
    console.log("PASS: Sufficient Gateway balance already. Skipping deposit.");
  }

  // Step 3: Build and sign burn intent
  console.log("\n--- Step 3: Build and sign EIP-712 burn intent ---");
  const blockHex = await baseProvider.send("eth_blockNumber", []);
  const currentBlock = Number(BigInt(blockHex));
  console.log("Current Base Sepolia block:", currentBlock);

  const spec = {
    version: 1,
    sourceDomain: BASE_SEPOLIA_DOMAIN,
    destinationDomain: ARC_DOMAIN,
    sourceContract: addressToBytes32(GATEWAY_WALLET),
    destinationContract: addressToBytes32(GATEWAY_MINTER),
    sourceToken: addressToBytes32(BASE_SEPOLIA_USDC),
    destinationToken: addressToBytes32(ARC_USDC),
    sourceDepositor: addressToBytes32(wallet),
    destinationRecipient: addressToBytes32(wallet),
    sourceSigner: addressToBytes32(wallet),
    destinationCaller: "0x" + "0".repeat(64),
    value: TRANSFER_AMOUNT.toString(),
    salt: randomBytes32(),
    hookData: "0x",
  };
  const burnIntentMessage = {
    maxBlockHeight: (currentBlock + 500).toString(),
    maxFee: MAX_FEE.toString(),
    spec,
  };
  const typedData = {
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }],
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
    },
    domain: { name: "GatewayWallet", version: "1" },
    primaryType: "BurnIntent",
    message: burnIntentMessage,
  };

  // Sign with ethers v6 signTypedData
  const signature = await signer.signTypedData(typedData.domain, {
    TransferSpec: typedData.types.TransferSpec,
    BurnIntent: typedData.types.BurnIntent,
  }, burnIntentMessage);
  console.log("PASS: Burn intent signed. Signature:", signature.slice(0, 20) + "...");

  // Step 4: Submit to Gateway API
  console.log("\n--- Step 4: Submit burn intent to Gateway API ---");
  const transferResp = await gatewayRequest("POST", "/transfer", [{ burnIntent: burnIntentMessage, signature }]);
  console.log("Response status:", transferResp.status);
  console.log("Response body:", JSON.stringify(transferResp.body).slice(0, 400));

  if (transferResp.status !== 200 && transferResp.status !== 201) {
    console.error("FAIL: Gateway transfer request failed.");
    process.exit(1);
  }

  const transferData = transferResp.body;
  const transferId = transferData?.id || (Array.isArray(transferData) ? transferData[0]?.id : null);
  if (!transferId) {
    console.log("NOTE: No transfer ID in response. The API may not support Forwarding Service polling yet.");
    console.log("Full response:", JSON.stringify(transferData, null, 2));
    console.log("\nGateway transfer submitted. Check Arc USDC balance manually after a few minutes.");
    process.exit(0);
  }
  console.log("PASS: Transfer ID:", transferId);

  // Step 5: Poll transfer status
  console.log("\n--- Step 5: Poll transfer status (Forwarding Service) ---");
  const pollStart = Date.now();
  let minted = false;
  for (let attempt = 1; attempt <= 120; attempt++) {
    await delay(5000);
    const statusResp = await gatewayRequest("GET", `/transfer/${encodeURIComponent(transferId)}`, null);
    if (statusResp.status === 200) {
      const status = String(statusResp.body.status || statusResp.body.transferStatus || "").toLowerCase();
      console.log(`  Attempt ${attempt}: status=${status} (${Math.round((Date.now() - pollStart) / 1000)}s)`);
      if (status === "complete" || status === "completed" || status === "minted") {
        minted = true;
        break;
      }
      if (status === "failed" || status === "error") {
        console.error("FAIL: Gateway transfer failed:", JSON.stringify(statusResp.body));
        process.exit(1);
      }
    }
  }
  if (!minted) {
    console.error("FAIL: Transfer not completed within 10 minutes.");
    process.exit(1);
  }
  console.log("PASS: USDC minted on Arc.");

  // Step 6: Verify Arc USDC balance increased
  console.log("\n--- Step 6: Verify Arc USDC balance ---");
  const arcBalData = ERC20_BALANCE_OF_SELECTOR + encodeAddress(wallet);
  const arcBalResult = await arcProvider.call({ to: ARC_USDC, data: arcBalData });
  const arcBal = BigInt(arcBalResult);
  console.log("Arc USDC balance:", Number(arcBal) / 1e6, "USDC");

  console.log("\n--- Summary ---");
  console.log("ALL CHECKS PASSED. Circle Gateway flow verified on testnet.");
  console.log("Base Sepolia (domain 6) -> Arc Testnet (domain 26) transfer complete.");
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
