"use strict";

function createWorkflowJobWorker(options) {
  if (!options || !options.store) throw new Error("store is required");
  if (typeof options.executeJob !== "function") throw new Error("executeJob is required");
  if (typeof options.settleJob !== "function") throw new Error("settleJob is required");
  if (typeof options.refundJob !== "function") throw new Error("refundJob is required");

  const store = options.store;
  const workerId = String(options.workerId || ("worker-" + process.pid));
  const leaseMs = Math.max(1, Number(options.leaseMs) || 60000);
  const pollMs = Math.max(1, Number(options.pollMs) || 1000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const cancel = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const executeJob = options.executeJob;
  const settleJob = options.settleJob;
  const refundJob = options.refundJob;
  const onError = typeof options.onError === "function" ? options.onError : () => {};
  let timer = null;
  let started = false;
  let draining = false;

  function completedAt() {
    return new Date(now()).toISOString();
  }

  function errorCode(error, fallback) {
    const code = String(error && error.code || fallback);
    return /^[a-z0-9_-]{1,64}$/i.test(code) ? code : fallback;
  }

  async function processRefund(jobId) {
    try {
      const refunded = await refundJob(store.getJob(jobId), {
        onSubmitted: (txHash) => store.update(jobId, ["refunding"], {
          settlement: { status: "refund_submitted", txHash: String(txHash || "") },
        }),
      });
      store.transition(jobId, ["refunding"], "refunded", {
        settlement: {
          status: "refund_confirmed",
          txHash: String(refunded && refunded.txHash || ""),
        },
        completedAt: completedAt(),
      });
    } catch (_) {
      store.update(jobId, ["refunding"], {
        execution: { errorCode: "refund_pending" },
      });
    }
  }

  async function runOnce() {
    const job = store.claimNext({ workerId, leaseMs });
    if (!job) return false;

    const renew = () => store.renewLease(job.jobId, workerId, leaseMs);
    if (job.status === "failed") {
      store.transition(job.jobId, ["failed"], "refunding", {});
    }
    if (job.status === "refunding" || job.status === "failed") {
      await processRefund(job.jobId);
      return true;
    }

    try {
      let result = store.getResult(job.jobId);
      if (!result) {
        result = await executeJob(store.getJob(job.jobId), { onProgress: renew });
        store.storeResult(job.jobId, result);
        store.transition(job.jobId, ["processing"], "settlement_pending", {});
      } else if (store.getJob(job.jobId).status === "processing") {
        store.transition(job.jobId, ["processing"], "settlement_pending", {});
      }

      try {
        const settled = await settleJob(store.getJob(job.jobId), result, {
          onSubmitted: (txHash) => store.update(job.jobId, ["settlement_pending"], {
            settlement: { status: "submitted", txHash: String(txHash || "") },
          }),
        });
        store.transition(job.jobId, ["settlement_pending"], "succeeded", {
          settlement: {
            status: "confirmed",
            txHash: String(settled && settled.txHash || ""),
          },
          execution: { errorCode: null },
          completedAt: completedAt(),
        });
      } catch (_) {
        store.update(job.jobId, ["settlement_pending"], {
          execution: { errorCode: "settlement_pending" },
        });
      }
    } catch (error) {
      store.transition(job.jobId, ["processing"], "failed", {
        execution: { errorCode: errorCode(error, "workflow_failed") },
      });
      store.transition(job.jobId, ["failed"], "refunding", {});
      await processRefund(job.jobId);
    }
    return true;
  }

  async function drain() {
    if (!started || draining) return;
    draining = true;
    try {
      while (started && await runOnce()) {}
    } catch (error) {
      onError(error);
    } finally {
      draining = false;
      if (started) timer = schedule(drain, pollMs);
    }
  }

  function start() {
    if (started) return;
    started = true;
    timer = schedule(drain, 0);
  }

  function stop() {
    started = false;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
  }

  return { runOnce, start, stop };
}

module.exports = { createWorkflowJobWorker };
