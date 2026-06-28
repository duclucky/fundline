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

function createRunEscrowClient(config) {
  const escrowAddress = String((config && config.escrowAddress) || "").trim();
  const rpcUrl = String((config && config.rpcUrl) || "").trim();
  const treasuryKey = String((config && config.treasuryKey) || "").trim();

  let provider = null;
  let readContract = null;
  let treasuryContract = null;

  function ensureRead() {
    if (!escrowAddress || !rpcUrl) throw new Error("Run escrow is not configured (address or RPC).");
    if (!provider) provider = new JsonRpcProvider(rpcUrl);
    if (!readContract) readContract = new Contract(escrowAddress, ESCROW_ABI, provider);
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

    async release(runId, memoText) {
      const tx = await ensureTreasury().release(runId, toUtf8Bytes(String(memoText || "")));
      await tx.wait(1);
      return tx.hash;
    },

    async refund(runId) {
      const tx = await ensureTreasury().refund(runId);
      await tx.wait(1);
      return tx.hash;
    },
  };
}

module.exports = { createRunEscrowClient, ESCROW_ABI };
