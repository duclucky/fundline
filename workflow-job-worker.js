"use strict";

function createWorkflowJobWorker(options) {
  if (!options || !options.store) throw new Error("store is required");
  if (typeof options.executeJob !== "function") throw new Error("executeJob is required");
  if (typeof options.settleJob !== "function") throw new Error("settleJob is required");
  if (typeof options.refundJob !== "function") throw new Error("refundJob is required");

  const store = options.store;
  const workerId = String(options.workerId || ("worker-" + process.pid));
  const leaseMs = Math.max(1, Number(options.leaseMs) || 60000);
  const heartbeatMs = Math.max(1, Number(options.heartbeatMs) || Math.floor(leaseMs / 3) || 1);
  const pollMs = Math.max(1, Number(options.pollMs) || 1000);
  const settlementRetryMs = Math.max(1, Number(options.settlementRetryMs) || 5000);
  const now = typeof options.now === "function" ? options.now : Date.now;
  const schedule = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const cancel = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const repeat = typeof options.setInterval === "function" ? options.setInterval : setInterval;
  const cancelRepeat = typeof options.clearInterval === "function" ? options.clearInterval : clearInterval;
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

  function isLeaseError(error) {
    return /lease owner|lease token|lease expired|state precondition|terminal/i.test(
      String(error && error.message || "")
    );
  }

  function startHeartbeat(job) {
    const lease = {
      workerId,
      leaseToken: String(job && job.execution && job.execution.leaseToken || ""),
    };
    let leaseError = null;
    function renew() {
      if (leaseError) throw leaseError;
      try {
        return store.renewLease(job.jobId, workerId, lease.leaseToken, leaseMs);
      } catch (error) {
        if (isLeaseError(error)) leaseError = error;
        throw error;
      }
    }
    const heartbeat = repeat(() => {
      try {
        renew();
      } catch (error) {
        if (!isLeaseError(error)) onError(error);
      }
    }, heartbeatMs);
    if (heartbeat && typeof heartbeat.unref === "function") heartbeat.unref();
    return {
      lease,
      renew,
      stop: () => cancelRepeat(heartbeat),
    };
  }

  async function processRefund(jobId, controls) {
    try {
      controls.renew();
      const refunded = await refundJob(store.getJob(jobId), {
        updateJob: (patch) => store.update(jobId, ["refunding"], patch, controls.lease),
        onSubmitted: (txHash) => store.update(jobId, ["refunding"], {
          settlement: { status: "refund_submitted", txHash: String(txHash || "") },
        }, controls.lease),
      });
      controls.renew();
      store.transition(jobId, ["refunding"], "refunded", {
        settlement: {
          status: "refund_confirmed",
          txHash: String(refunded && refunded.txHash || ""),
        },
        completedAt: completedAt(),
      }, controls.lease);
    } catch (error) {
      if (isLeaseError(error)) return;
      try {
        store.update(jobId, ["refunding"], {
          execution: { errorCode: "refund_pending" },
        }, controls.lease);
        store.deferRetry(jobId, ["refunding"], controls.lease, settlementRetryMs);
      } catch (updateError) {
        if (!isLeaseError(updateError)) throw updateError;
      }
    }
  }

  async function runOnce() {
    const job = store.claimNext({ workerId, leaseMs });
    if (!job) return false;

    const controls = startHeartbeat(job);
    try {
      if (job.status === "failed") {
        store.transition(job.jobId, ["failed"], "refunding", {}, controls.lease);
      }
      if (job.status === "refunding" || job.status === "failed") {
        await processRefund(job.jobId, controls);
        return true;
      }

      try {
        let result = store.getResult(job.jobId);
        if (!result) {
          result = await executeJob(store.getJob(job.jobId), { onProgress: controls.renew });
          controls.renew();
          store.storeResult(job.jobId, result, controls.lease);
          store.transition(job.jobId, ["processing"], "settlement_pending", {}, controls.lease);
        } else if (store.getJob(job.jobId).status === "processing") {
          controls.renew();
          store.transition(job.jobId, ["processing"], "settlement_pending", {}, controls.lease);
        }

        try {
          controls.renew();
          const settled = await settleJob(store.getJob(job.jobId), result, {
            onSubmitted: (txHash) => store.update(job.jobId, ["settlement_pending"], {
              settlement: { status: "submitted", txHash: String(txHash || "") },
            }, controls.lease),
          });
          controls.renew();
          store.storeResult(job.jobId, result, controls.lease);
          store.transition(job.jobId, ["settlement_pending"], "succeeded", {
            settlement: {
              status: "confirmed",
              txHash: String(settled && settled.txHash || ""),
            },
            execution: { errorCode: null },
            completedAt: completedAt(),
          }, controls.lease);
        } catch (error) {
          if (isLeaseError(error)) return true;
          try {
            store.update(job.jobId, ["settlement_pending"], {
              execution: { errorCode: "settlement_pending" },
            }, controls.lease);
            store.deferRetry(
              job.jobId,
              ["settlement_pending"],
              controls.lease,
              settlementRetryMs,
            );
          } catch (updateError) {
            if (!isLeaseError(updateError)) throw updateError;
          }
        }
      } catch (error) {
        if (isLeaseError(error)) return true;
        store.transition(job.jobId, ["processing"], "failed", {
          execution: { errorCode: errorCode(error, "workflow_failed") },
        }, controls.lease);
        store.transition(job.jobId, ["failed"], "refunding", {}, controls.lease);
        await processRefund(job.jobId, controls);
      }
      return true;
    } finally {
      controls.stop();
    }
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
