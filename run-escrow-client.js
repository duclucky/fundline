"use strict";

const { JsonRpcProvider, Wallet, Contract, toUtf8Bytes } = require("ethers");

// Server-side client for FundlineRunEscrow. Reads run state for verification and,
// with the treasury key, signs release/refund. The treasury key is a Fundline hot
// key (matches the contract's immutable treasury); it is NOT a user key. Read-only
// works without it. See .claude/workflow-billing-spec.md.

const ESCROW_ABI = [
  "function getRun(bytes32 runId) view returns (address payer, uint256 amount, uint64 refundDeadline, bool released, bool refunded)",
  "function release(bytes32 runId, bytes memo)",
  "function refund(bytes32 runId)",
];

const USDC_ABI = [
  "function transfer(address to, uint256 amount) returns (bool)",
];

function waitForConfirmation(tx, options = {}) {
  const confirmations = Math.max(1, Number(options.confirmations) || 1);
  const timeoutMs = Math.max(1, Number(options.timeoutMs) || 30000);
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error("Transaction confirmation timed out.");
      error.code = "transaction_confirmation_timeout";
      reject(error);
    }, timeoutMs);
  });
  return Promise.race([tx.wait(confirmations), timeout]).finally(() => clearTimeout(timer));
}

function createRunEscrowClient(config) {
  const escrowAddress = String((config && config.escrowAddress) || "").trim();
  const rpcUrl = String((config && config.rpcUrl) || "").trim();
  const treasuryKey = String((config && config.treasuryKey) || "").trim();
  const usdcAddress = String((config && config.usdcAddress) || "").trim();
  const confirmationTimeoutMs = Math.max(1, Number(config && config.confirmationTimeoutMs) || 30000);

  let provider = null;
  let readContract = null;
  let treasuryContract = null;
  let treasuryUsdc = null;

  function ensureProvider() {
    if (!rpcUrl) throw new Error("Run escrow RPC is not configured.");
    if (!provider) provider = new JsonRpcProvider(rpcUrl);
    return provider;
  }

  function ensureRead() {
    if (!escrowAddress || !rpcUrl) throw new Error("Run escrow is not configured (address or RPC).");
    if (!readContract) readContract = new Contract(escrowAddress, ESCROW_ABI, ensureProvider());
    return readContract;
  }

  function ensureTreasury() {
    if (!treasuryKey) throw new Error("Treasury key is not configured.");
    ensureRead();
    if (!treasuryContract) {
      const key = treasuryKey.startsWith("0x") ? treasuryKey : `0x${treasuryKey}`;
      treasuryContract = new Contract(escrowAddress, ESCROW_ABI, new Wallet(key, provider));
    }
    return treasuryContract;
  }

  return {
    // Read path works with just an address + RPC.
    isConfigured() { return Boolean(escrowAddress && rpcUrl); },
    // Settlement (release/refund) also needs the treasury key.
    canSettle() { return Boolean(escrowAddress && rpcUrl && treasuryKey); },

    async readRun(runId) {
      const r = await ensureRead().getRun(runId);
      return {
        payer: String(r[0]),
        amount: BigInt(r[1]),
        refundDeadline: Number(r[2]),
        released: Boolean(r[3]),
        refunded: Boolean(r[4]),
      };
    },

    async release(runId, memoText, onSubmitted) {
      const tx = await ensureTreasury().release(runId, toUtf8Bytes(String(memoText || "")));
      if (typeof onSubmitted === "function") onSubmitted(tx.hash);
      await waitForConfirmation(tx, { confirmations: 1, timeoutMs: confirmationTimeoutMs });
      return tx.hash;
    },

    async refund(runId, onSubmitted) {
      const tx = await ensureTreasury().refund(runId);
      if (typeof onSubmitted === "function") onSubmitted(tx.hash);
      await waitForConfirmation(tx, { confirmations: 1, timeoutMs: confirmationTimeoutMs });
      return tx.hash;
    },

    async getTransactionStatus(txHash) {
      const receipt = await ensureProvider().getTransactionReceipt(String(txHash || ""));
      if (!receipt) return "pending";
      return Number(receipt.status) === 1 ? "confirmed" : "failed";
    },

    // Treasury-signed plain USDC transfer. Used only to refund an x402 run payer
    // when a paid run fails (x402 pays the treasury directly, so there is no escrow
    // to auto-refund). The treasury holds no other user's funds and cannot pull from
    // any wallet; this only sends the treasury's own USDC back to the payer.
    canTransfer() { return Boolean(escrowAddress && rpcUrl && treasuryKey && usdcAddress); },
    async transferUsdc(to, amount, onSubmitted) {
      if (!usdcAddress) throw new Error("USDC address is not configured.");
      if (!treasuryKey) throw new Error("Treasury key is not configured.");
      ensureRead();
      if (!treasuryUsdc) {
        const key = treasuryKey.startsWith("0x") ? treasuryKey : `0x${treasuryKey}`;
        treasuryUsdc = new Contract(usdcAddress, USDC_ABI, new Wallet(key, provider));
      }
      const tx = await treasuryUsdc.transfer(to, BigInt(amount));
      if (typeof onSubmitted === "function") onSubmitted(tx.hash);
      await waitForConfirmation(tx, { confirmations: 1, timeoutMs: confirmationTimeoutMs });
      return tx.hash;
    },
  };
}

module.exports = { createRunEscrowClient, waitForConfirmation, ESCROW_ABI };
