"use strict";

// Arc payment testnet dry-run.
//
// Arc's CallFrom precompile (0x1800...0003) currently throws StackUnderflow for
// any subcall target (tested against both USDC and PaymentRouter). Multicall3From
// batching of [approve, payInvoice] is therefore not viable until Arc fixes the
// precompile.
//
// This script validates the working 2-tx flow instead:
//   Tx 1: direct USDC.approve(router, amount)
//   Tx 2: direct PaymentRouter.payInvoice(invoiceId, merchant, amount)
//
// Both txs are sent by the payer directly (msg.sender = payer). The InvoicePaid
// event on Tx 2 must show payer == signer.
//
// Setup: ARC_DEPLOYER_PRIVATE_KEY must be set in .env (or as env var).
// Run:   node test_multicall_dryrun.js

const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

// -- Load .env manually (no dotenv package installed) ---
const envFile = path.join(__dirname, ".env");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .forEach((line) => {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.+)$/);
      if (m && !process.env[m[1]]) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    });
}

// -- Chain constants ---
const ARC_RPC = "https://rpc.testnet.arc.network";
const ARC_CHAIN_ID = 5042002n;
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000";
const ROUTER_ADDRESS = "0x7f3bCf33711F981e2d67870D5Cdb5503f01e1a24";
const ARC_USDC_DECIMALS = 6;

// -- Selectors ---
const ERC20_APPROVE_SELECTOR = "0x095ea7b3";
const PAYMENT_ROUTER_PAY_SELECTOR = "0xe1a9ef45";

// -- Event topics ---
const INVOICE_PAID_TOPIC = ethers.id("InvoicePaid(bytes32,address,address,uint256,address)");
const ERC20_TRANSFER_TOPIC = ethers.id("Transfer(address,address,uint256)");

// -- Dry-run parameters ---
// "dryru" = 64 72 79 72 75 (5 bytes, 10 hex chars). Need 64 total hex chars for bytes32.
const DRY_RUN_INVOICE_ID = "0x6472797275" + "0".repeat(54);
const DRY_RUN_AMOUNT_TEXT = "0.01"; // 0.01 USDC

// -- ABI encoding helpers (mirrors app.js) ---
function normalizeAddress(value) {
  const t = String(value || "").trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(t) ? t : "";
}

function normalizeBytes32(value) {
  const t = String(value || "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(t) ? t : "";
}

function encodeAddress(value) {
  const a = normalizeAddress(value);
  if (!a) throw new Error("Invalid address: " + value);
  return a.replace(/^0x/, "").padStart(64, "0");
}

function encodeBytes32(value) {
  const b = normalizeBytes32(value);
  if (!b) throw new Error("Invalid bytes32: " + value);
  return b.replace(/^0x/, "").toLowerCase();
}

function encodeUint256(value) {
  const n = typeof value === "bigint" ? value : BigInt(String(value || "0"));
  if (n < 0n) throw new Error("Negative uint256.");
  return n.toString(16).padStart(64, "0");
}

function parseTokenUnits(value, decimals) {
  const d = Math.min(Math.max(Number(decimals) || 0, 0), 18);
  const text = String(value || "0").replace(/,/g, "").trim();
  const [whole, fractionRaw = ""] = text.split(".");
  const fraction = fractionRaw.padEnd(d, "0").slice(0, d);
  return BigInt(whole.replace(/\D/g, "") || "0") * 10n ** BigInt(d) + BigInt(fraction || "0");
}

// -- Main dry-run ---
async function main() {
  const privateKey = process.env.ARC_DEPLOYER_PRIVATE_KEY;
  if (!privateKey) {
    console.error("ERROR: ARC_DEPLOYER_PRIVATE_KEY not set in .env");
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(ARC_RPC);
  const network = await provider.getNetwork();
  if (network.chainId !== ARC_CHAIN_ID) {
    console.error("ERROR: wrong chain. Got", network.chainId, "expected", ARC_CHAIN_ID);
    process.exit(1);
  }
  console.log("Connected to Arc testnet, chainId", network.chainId.toString());

  const signer = new ethers.Wallet(privateKey, provider);
  const payerAddress = signer.address;
  const merchantAddress = payerAddress; // self-pay (net-zero USDC effect)
  console.log("Payer (signer):", payerAddress);
  console.log("Merchant:      ", merchantAddress, "(self, net-zero)");

  const amountUnits = parseTokenUnits(DRY_RUN_AMOUNT_TEXT, ARC_USDC_DECIMALS);
  console.log("Amount: " + DRY_RUN_AMOUNT_TEXT + " USDC =", amountUnits.toString(), "units (6 decimals)");

  // Check USDC balance
  const balRaw = await provider.call({
    to: USDC_ADDRESS,
    data: "0x70a08231" + encodeAddress(payerAddress),
  });
  const balance = BigInt(balRaw);
  console.log("USDC balance:", (Number(balance) / 1e6).toFixed(6), "USDC");
  if (balance < amountUnits) {
    console.error("ERROR: insufficient USDC balance");
    process.exit(1);
  }

  const invoiceBytes = normalizeBytes32(DRY_RUN_INVOICE_ID);
  if (!invoiceBytes) throw new Error("Invalid dry-run invoiceId.");

  const approveCallData =
    ERC20_APPROVE_SELECTOR + encodeAddress(ROUTER_ADDRESS) + encodeUint256(amountUnits);
  const payCallData =
    PAYMENT_ROUTER_PAY_SELECTOR +
    encodeBytes32(invoiceBytes) +
    encodeAddress(merchantAddress) +
    encodeUint256(amountUnits);

  // --- Tx 1: direct USDC.approve ---
  console.log("\n--- Tx 1: direct USDC.approve ---");
  console.log("Approving router", ROUTER_ADDRESS, "for", amountUnits.toString(), "units...");
  const approveTx = await signer.sendTransaction({
    to: USDC_ADDRESS,
    data: approveCallData,
    value: 0n,
    gasLimit: 100000n,
  });
  console.log("Approve tx sent:", approveTx.hash);
  const approveReceipt = await approveTx.wait(1);
  if (approveReceipt.status !== 1) {
    console.error("FAIL: USDC.approve reverted.");
    process.exit(1);
  }
  console.log("PASS: approve confirmed. Gas used:", approveReceipt.gasUsed.toString());
  console.log("Arcscan: https://testnet.arcscan.app/tx/" + approveTx.hash);

  // Verify allowance was set
  const allowanceRaw = await provider.call({
    to: USDC_ADDRESS,
    data:
      "0xdd62ed3e" + encodeAddress(payerAddress) + encodeAddress(ROUTER_ADDRESS),
  });
  const allowance = BigInt(allowanceRaw);
  if (allowance < amountUnits) {
    console.error("FAIL: allowance not set. Got", allowance.toString(), "expected >=", amountUnits.toString());
    process.exit(1);
  }
  console.log("PASS: allowance confirmed:", allowance.toString(), "units");

  // --- Tx 2: direct PaymentRouter.payInvoice ---
  console.log("\n--- Tx 2: direct PaymentRouter.payInvoice ---");
  console.log("Calling PaymentRouter at", ROUTER_ADDRESS, "...");

  const payTx = await signer.sendTransaction({
    to: ROUTER_ADDRESS,
    data: payCallData,
    value: 0n,
    gasLimit: 200000n,
  });

  console.log("Pay tx sent:", payTx.hash);
  console.log("Waiting for confirmation...");

  const receipt = await payTx.wait(1);

  console.log("\n--- Receipt ---");
  console.log("Status:", receipt.status === 1 ? "SUCCESS" : "REVERTED");
  console.log("Block:", receipt.blockNumber);
  console.log("Gas used:", receipt.gasUsed.toString());
  console.log("Logs count:", receipt.logs.length);

  if (receipt.status !== 1) {
    console.error("FAIL: payInvoice tx reverted.");
    process.exit(1);
  }

  // -- Parse InvoicePaid event ---
  const invoicePaidLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === ROUTER_ADDRESS.toLowerCase() &&
      l.topics[0] === INVOICE_PAID_TOPIC,
  );
  if (!invoicePaidLog) {
    console.error("FAIL: InvoicePaid event NOT found in receipt.");
    process.exit(1);
  }

  // InvoicePaid(bytes32 indexed invoiceId, address indexed payer, address indexed merchant, uint256 amount, address token)
  const emittedInvoiceId = invoicePaidLog.topics[1];
  const emittedPayer = "0x" + invoicePaidLog.topics[2].slice(26);
  const emittedMerchant = "0x" + invoicePaidLog.topics[3].slice(26);
  const emittedAmount = BigInt("0x" + invoicePaidLog.data.slice(2, 66));
  const emittedToken = "0x" + invoicePaidLog.data.slice(90, 130);

  console.log("\n--- InvoicePaid event ---");
  console.log("invoiceId:", emittedInvoiceId);
  console.log("payer:    ", emittedPayer);
  console.log("merchant: ", emittedMerchant);
  console.log("amount:   ", emittedAmount.toString(), "units =", (Number(emittedAmount) / 1e6).toFixed(6), "USDC");
  console.log("token:    ", emittedToken);

  // -- Parse Transfer event ---
  const transferLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === USDC_ADDRESS.toLowerCase() &&
      l.topics[0] === ERC20_TRANSFER_TOPIC,
  );
  if (transferLog) {
    const transferFrom = "0x" + transferLog.topics[1].slice(26);
    const transferTo = "0x" + transferLog.topics[2].slice(26);
    const transferAmount = BigInt("0x" + transferLog.data.slice(2));
    console.log("\n--- Transfer event (USDC) ---");
    console.log("from:  ", transferFrom);
    console.log("to:    ", transferTo);
    console.log("amount:", transferAmount.toString(), "units");
  }

  // -- Assertions ---
  console.log("\n--- Verification ---");
  let ok = true;

  function check(label, actual, expected) {
    const pass = actual.toLowerCase() === expected.toLowerCase();
    console.log((pass ? "PASS" : "FAIL") + ": " + label);
    if (!pass) {
      console.log("      expected:", expected);
      console.log("      got:     ", actual);
      ok = false;
    }
  }

  check("InvoicePaid.payer == signer", emittedPayer, payerAddress);
  check("InvoicePaid.merchant == merchantAddress", emittedMerchant, merchantAddress);
  if (emittedAmount !== amountUnits) {
    console.log("FAIL: InvoicePaid.amount mismatch. got", emittedAmount, "expected", amountUnits);
    ok = false;
  } else {
    console.log("PASS: InvoicePaid.amount ==", amountUnits.toString(), "units (6 decimals)");
  }
  check("InvoicePaid.token == USDC", emittedToken, USDC_ADDRESS.slice(0, 42));

  console.log("\n--- Summary ---");
  if (ok) {
    console.log("ALL CHECKS PASSED. Arc 2-tx payment flow verified on testnet.");
    console.log("Arcscan approve: https://testnet.arcscan.app/tx/" + approveTx.hash);
    console.log("Arcscan pay:     https://testnet.arcscan.app/tx/" + payTx.hash);
  } else {
    console.log("SOME CHECKS FAILED.");
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
