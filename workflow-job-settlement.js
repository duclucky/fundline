"use strict";

function codedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function paymentMode(job) {
  return String(job && job.payment && job.payment.mode || "").trim().toLowerCase();
}

function submittedHash(job, refunding) {
  const settlement = job && job.settlement || {};
  const status = String(settlement.status || "");
  if (refunding && !status.startsWith("refund_")) return "";
  if (!refunding && status.startsWith("refund_")) return "";
  return String(settlement.txHash || "").trim();
}

function createWorkflowJobSettlement(options) {
  if (!options || !options.runEscrow) throw new Error("runEscrow is required");
  const runEscrow = options.runEscrow;
  const buildMemo = typeof options.buildMemo === "function" ? options.buildMemo : () => "";
  const markX402Refunded = typeof options.markX402Refunded === "function"
    ? options.markX402Refunded
    : () => {};

  async function reconcile(txHash, pendingCode) {
    const status = await runEscrow.getTransactionStatus(txHash);
    if (status === "confirmed") return { txHash, confirmed: true };
    if (status === "failed") {
      throw codedError("settlement_transaction_failed", "Submitted settlement transaction failed");
    }
    throw codedError(pendingCode, "Submitted settlement transaction is pending");
  }

  function validateEscrowRun(job, run) {
    const payment = job.payment || {};
    if (payment.payer
      && String(run.payer || "").toLowerCase() !== String(payment.payer).toLowerCase()) {
      throw codedError("escrow_payer_mismatch", "Escrow payer does not match the queued payment");
    }
    if (payment.amount !== undefined && BigInt(run.amount) !== BigInt(payment.amount)) {
      throw codedError("escrow_amount_mismatch", "Escrow amount does not match the queued payment");
    }
  }

  async function settle(job, result, hooks) {
    const mode = paymentMode(job);
    const onSubmitted = hooks && hooks.onSubmitted;
    if (mode === "gateway") {
      throw codedError("gateway_async_unsupported", "gateway async unsupported");
    }
    if (mode === "x402") {
      return { txHash: String(job.payment.reference || ""), confirmed: true };
    }
    if (mode !== "escrow") throw codedError("payment_mode_unsupported", "Unsupported payment mode");

    const runId = String(job.payment.reference || job.jobId || "");
    const run = await runEscrow.readRun(runId);
    validateEscrowRun(job, run);
    if (run.released) {
      return { txHash: submittedHash(job, false), confirmed: true, observed: "released" };
    }
    if (run.refunded) {
      throw codedError("escrow_already_refunded", "Escrow run was already refunded");
    }
    const existingHash = submittedHash(job, false);
    if (existingHash) return reconcile(existingHash, "settlement_pending");

    const txHash = await runEscrow.release(
      runId,
      buildMemo(job, result),
      onSubmitted
    );
    return { txHash: String(txHash || ""), confirmed: true };
  }

  async function refund(job, hooks) {
    const mode = paymentMode(job);
    const onSubmitted = hooks && hooks.onSubmitted;
    if (mode === "gateway") {
      throw codedError("gateway_async_unsupported", "gateway async unsupported");
    }

    const existingHash = submittedHash(job, true);
    if (existingHash) return reconcile(existingHash, "refund_pending");

    if (mode === "x402") {
      const txHash = await runEscrow.transferUsdc(
        String(job.payment.payer || ""),
        BigInt(job.payment.amount),
        onSubmitted
      );
      markX402Refunded(String(job.payment.reference || ""), String(txHash || ""));
      return { txHash: String(txHash || ""), confirmed: true };
    }
    if (mode !== "escrow") throw codedError("payment_mode_unsupported", "Unsupported payment mode");

    const runId = String(job.payment.reference || job.jobId || "");
    const run = await runEscrow.readRun(runId);
    validateEscrowRun(job, run);
    if (run.refunded) {
      return { txHash: "", confirmed: true, observed: "refunded" };
    }
    if (run.released) {
      throw codedError("escrow_already_released", "Escrow run was already released");
    }
    const txHash = await runEscrow.refund(runId, onSubmitted);
    return { txHash: String(txHash || ""), confirmed: true };
  }

  return { settle, refund };
}

module.exports = { createWorkflowJobSettlement };
