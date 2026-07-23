"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const JOB_ID_RE = /^0x[0-9a-f]{64}$/;
const TERMINAL = new Set(["succeeded", "refunded"]);
const TRANSITIONS = {
  awaiting_payment: new Set(["queued"]),
  queued: new Set(["processing"]),
  processing: new Set(["queued", "settlement_pending", "failed"]),
  settlement_pending: new Set(["succeeded"]),
  failed: new Set(["refunding"]),
  refunding: new Set(["refunded"]),
  succeeded: new Set(),
  refunded: new Set(),
};

function validateJobId(jobId) {
  const value = String(jobId || "").toLowerCase();
  if (!JOB_ID_RE.test(value)) throw new Error("Invalid job ID");
  return value;
}

function atomicWriteJson(filePath, value) {
  const tempPath = filePath + "." + process.pid + ".tmp";
  fs.writeFileSync(tempPath, JSON.stringify(value));
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.unlinkSync(tempPath);
    } catch (_) {}
    throw error;
  }
}

function tokenHash(token) {
  return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function safeEqualHex(left, right) {
  const a = Buffer.from(String(left || ""), "hex");
  const b = Buffer.from(String(right || ""), "hex");
  return a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergePatch(target, patch) {
  const output = isObject(target) ? { ...target } : {};
  for (const [key, value] of Object.entries(patch || {})) {
    output[key] = isObject(value) ? mergePatch(output[key], value) : value;
  }
  return output;
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function normalizePaymentPart(value) {
  return String(value || "").trim().toLowerCase();
}

function createWorkflowJobStore(config) {
  if (!config || !config.baseDir) throw new Error("baseDir is required");

  const baseDir = path.resolve(String(config.baseDir));
  const now = typeof config.now === "function" ? config.now : Date.now;
  const randomBytes = typeof config.randomBytes === "function"
    ? config.randomBytes
    : crypto.randomBytes;
  const lockLeaseMs = Math.max(1, Number(config.lockLeaseMs) || 30000);
  const paymentLockPath = path.join(baseDir, ".payments.lock");

  fs.mkdirSync(baseDir, { recursive: true });

  function pathsFor(jobId) {
    const id = validateJobId(jobId).slice(2);
    return {
      metadata: path.join(baseDir, id + ".json"),
      result: path.join(baseDir, id + ".result.json"),
      lock: path.join(baseDir, id + ".lock"),
    };
  }

  function readJson(filePath) {
    try {
      return JSON.parse(fs.readFileSync(filePath, "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  function lockTimestamp(lockPath) {
    try {
      const value = JSON.parse(fs.readFileSync(lockPath, "utf8"));
      return Number(value.acquiredAt) || 0;
    } catch (_) {
      try {
        return fs.statSync(lockPath).mtimeMs;
      } catch (_) {
        return 0;
      }
    }
  }

  function acquireLock(lockPath) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const fd = fs.openSync(lockPath, "wx");
        fs.writeFileSync(fd, JSON.stringify({ acquiredAt: now(), pid: process.pid }));
        fs.closeSync(fd);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          try {
            fs.unlinkSync(lockPath);
          } catch (error) {
            if (!error || error.code !== "ENOENT") throw error;
          }
        };
      } catch (error) {
        if (!error || error.code !== "EEXIST") throw error;
        if (now() - lockTimestamp(lockPath) <= lockLeaseMs) return null;
        try {
          fs.unlinkSync(lockPath);
        } catch (unlinkError) {
          if (!unlinkError || unlinkError.code !== "ENOENT") return null;
        }
      }
    }
    return null;
  }

  function withLock(lockPath, callback) {
    const release = acquireLock(lockPath);
    if (!release) throw new Error("Job is locked");
    try {
      return callback();
    } finally {
      release();
    }
  }

  function getJob(jobId) {
    return readJson(pathsFor(jobId).metadata);
  }

  function writeJob(job) {
    atomicWriteJson(pathsFor(job.jobId).metadata, job);
    return clone(job);
  }

  function mutate(jobId, callback) {
    const paths = pathsFor(jobId);
    return withLock(paths.lock, () => {
      const current = readJson(paths.metadata);
      if (!current) throw new Error("Workflow job not found");
      return writeJob(callback(current));
    });
  }

  function assertLease(job, lease) {
    const workerId = String(lease && lease.workerId || "");
    const leaseToken = String(lease && lease.leaseToken || "");
    const execution = job && job.execution || {};
    if (!workerId || execution.workerId !== workerId) {
      throw new Error("Workflow job lease owner mismatch");
    }
    if (!leaseToken || !safeEqualHex(execution.leaseToken, leaseToken)) {
      throw new Error("Workflow job lease token mismatch");
    }
    if (!execution.leaseUntil || Number(execution.leaseUntil) <= now()) {
      throw new Error("Workflow job lease expired");
    }
  }

  function listJobs() {
    return fs.readdirSync(baseDir)
      .filter((name) => /^[0-9a-f]{64}\.json$/.test(name))
      .map((name) => readJson(path.join(baseDir, name)))
      .filter(Boolean);
  }

  function createQuote(input) {
    const source = input || {};
    const jobId = validateJobId(source.jobId || ("0x" + randomBytes(32).toString("hex")));
    const paths = pathsFor(jobId);
    const recoveryToken = randomBytes(32).toString("hex");
    const timestamp = new Date(now()).toISOString();

    return withLock(paths.lock, () => {
      if (fs.existsSync(paths.metadata)) throw new Error("Workflow job already exists");
      const job = {
        version: 1,
        jobId,
        status: "awaiting_payment",
        createdAt: timestamp,
        updatedAt: timestamp,
        completedAt: null,
        owner: {
          rateKey: source.ownerRateKey || null,
          recoveryTokenHash: tokenHash(recoveryToken),
        },
        request: clone(source.request || {}),
        payment: clone(source.payment || {}),
        execution: {
          attempts: 0,
          workerId: null,
          leaseUntil: null,
          resultStored: false,
          errorCode: null,
        },
        settlement: clone(source.settlement || { status: "pending", txHash: "" }),
      };
      writeJob(job);
      return { job: clone(job), recoveryToken };
    });
  }

  function findByPayment(mode, reference) {
    const normalizedMode = normalizePaymentPart(mode);
    const normalizedReference = normalizePaymentPart(reference);
    if (!normalizedMode || !normalizedReference) return null;
    return listJobs().find((job) => (
      job.payment
      && job.payment.boundAt
      && normalizePaymentPart(job.payment.mode) === normalizedMode
      && normalizePaymentPart(job.payment.reference) === normalizedReference
    )) || null;
  }

  function bindPayment(jobId, payment) {
    const normalizedJobId = validateJobId(jobId);
    const nextPayment = clone(payment || {});
    const mode = normalizePaymentPart(nextPayment.mode);
    const reference = normalizePaymentPart(nextPayment.reference);
    if (!mode || !reference) throw new Error("Payment mode and reference are required");

    return withLock(paymentLockPath, () => {
      const existing = findByPayment(mode, reference);
      if (existing && existing.jobId !== normalizedJobId) {
        throw new Error("Payment reference is already bound");
      }
      return mutate(normalizedJobId, (job) => {
        const currentMode = normalizePaymentPart(job.payment && job.payment.mode);
        const currentReference = normalizePaymentPart(job.payment && job.payment.reference);
        if (job.payment && job.payment.boundAt
          && (currentMode !== mode || currentReference !== reference)) {
          throw new Error("Workflow job payment is already bound");
        }
        const timestamp = new Date(now()).toISOString();
        return {
          ...job,
          payment: mergePatch(job.payment, {
            ...nextPayment,
            mode,
            reference,
            boundAt: job.payment && job.payment.boundAt
              ? job.payment.boundAt
              : timestamp,
          }),
          updatedAt: timestamp,
        };
      });
    });
  }

  function transition(jobId, allowedStatuses, nextStatus, patch, lease) {
    const allowed = new Set(allowedStatuses || []);
    return mutate(jobId, (job) => {
      if (TERMINAL.has(job.status)) throw new Error("Workflow job is terminal");
      if (!allowed.has(job.status)) throw new Error("Workflow job state precondition failed");
      if (["processing", "settlement_pending", "failed", "refunding"].includes(job.status)) {
        assertLease(job, lease);
      }
      if (!TRANSITIONS[job.status] || !TRANSITIONS[job.status].has(nextStatus)) {
        throw new Error("Invalid workflow job transition");
      }
      if (patch && Object.hasOwn(patch, "status")) {
        throw new Error("Status must be changed through transition");
      }
      const updated = mergePatch(job, patch || {});
      updated.status = nextStatus;
      updated.updatedAt = new Date(now()).toISOString();
      return updated;
    });
  }

  function update(jobId, allowedStatuses, patch, lease) {
    const allowed = new Set(allowedStatuses || []);
    return mutate(jobId, (job) => {
      if (!allowed.has(job.status)) throw new Error("Workflow job state precondition failed");
      if (["processing", "settlement_pending", "failed", "refunding"].includes(job.status)) {
        assertLease(job, lease);
      }
      if (patch && Object.hasOwn(patch, "status")) {
        throw new Error("Status must be changed through transition");
      }
      const updated = mergePatch(job, patch || {});
      updated.status = job.status;
      updated.updatedAt = new Date(now()).toISOString();
      return updated;
    });
  }

  function deferRetry(jobId, allowedStatuses, lease, delayMs) {
    const allowed = new Set(allowedStatuses || []);
    return mutate(jobId, (job) => {
      if (!allowed.has(job.status)) throw new Error("Workflow job state precondition failed");
      assertLease(job, lease);
      return {
        ...job,
        updatedAt: new Date(now()).toISOString(),
        execution: mergePatch(job.execution, {
          leaseUntil: now() + Math.max(1, Number(delayMs) || 1),
        }),
      };
    });
  }

  function claimNext(options) {
    const workerId = String(options && options.workerId || "").trim();
    const leaseMs = Math.max(1, Number(options && options.leaseMs) || lockLeaseMs);
    if (!workerId) throw new Error("workerId is required");

    const candidates = listJobs().sort((left, right) => (
      String(left.createdAt).localeCompare(String(right.createdAt))
    ));
    for (const candidate of candidates) {
      const candidateLeaseExpired = !candidate.execution
        || !candidate.execution.leaseUntil
        || Number(candidate.execution.leaseUntil) <= now();
      const reclaimable = candidate.status === "queued"
        || (["failed", "refunding", "settlement_pending"].includes(candidate.status)
          && candidateLeaseExpired)
        || (candidate.status === "processing"
          && Number(candidate.execution && candidate.execution.leaseUntil) <= now());
      if (!reclaimable) continue;

      try {
        return mutate(candidate.jobId, (job) => {
          const jobLeaseExpired = !job.execution
            || !job.execution.leaseUntil
            || Number(job.execution.leaseUntil) <= now();
          const expiredProcessing = job.status === "processing"
            && Number(job.execution && job.execution.leaseUntil) <= now();
          const stillReclaimable = job.status === "queued"
            || (["failed", "refunding", "settlement_pending"].includes(job.status)
              && jobLeaseExpired)
            || expiredProcessing;
          if (!stillReclaimable) throw new Error("Workflow job is not claimable");

          const timestamp = new Date(now()).toISOString();
          return {
            ...job,
            status: job.status === "queued" ? "processing" : job.status,
            updatedAt: timestamp,
            execution: mergePatch(job.execution, {
              attempts: job.status === "queued"
                ? Number(job.execution && job.execution.attempts || 0) + 1
                : Number(job.execution && job.execution.attempts || 0),
              workerId,
              leaseToken: randomBytes(16).toString("hex"),
              leaseUntil: now() + leaseMs,
              claimedAt: timestamp,
            }),
          };
        });
      } catch (error) {
        if (/locked|not claimable|precondition/.test(String(error && error.message))) continue;
        throw error;
      }
    }
    return null;
  }

  function renewLease(jobId, workerId, leaseToken, leaseMs) {
    return mutate(jobId, (job) => {
      if (TERMINAL.has(job.status)) throw new Error("Workflow job is terminal");
      assertLease(job, { workerId, leaseToken });
      return {
        ...job,
        updatedAt: new Date(now()).toISOString(),
        execution: mergePatch(job.execution, { leaseUntil: now() + Math.max(1, Number(leaseMs) || lockLeaseMs) }),
      };
    });
  }

  function storeResult(jobId, result, lease) {
    const paths = pathsFor(jobId);
    return withLock(paths.lock, () => {
      const job = readJson(paths.metadata);
      if (!job) throw new Error("Workflow job not found");
      if (TERMINAL.has(job.status)) throw new Error("Workflow job is terminal");
      assertLease(job, lease);
      atomicWriteJson(paths.result, clone(result));
      job.execution = mergePatch(job.execution, { resultStored: true });
      job.updatedAt = new Date(now()).toISOString();
      writeJob(job);
      return clone(result);
    });
  }

  function getResult(jobId) {
    return readJson(pathsFor(jobId).result);
  }

  function authorize(job, credentials) {
    if (!job || !job.owner) return false;
    const rateKey = String(credentials && credentials.rateKey || "");
    if (rateKey && job.owner.rateKey && rateKey === job.owner.rateKey) return true;
    const recoveryToken = String(credentials && credentials.recoveryToken || "");
    if (!recoveryToken) return false;
    return safeEqualHex(job.owner.recoveryTokenHash, tokenHash(recoveryToken));
  }

  function publicJob(job) {
    if (!job) return null;
    const output = clone(job);
    delete output.owner;
    if (output.request) delete output.request.input;
    if (output.execution) {
      delete output.execution.workerId;
      delete output.execution.leaseToken;
      delete output.execution.exception;
      delete output.execution.internalError;
      delete output.execution.stack;
    }
    return output;
  }

  function sweep(options) {
    const resultTtlMs = Math.max(0, Number(options && options.resultTtlMs) || 0);
    const metadataTtlMs = Math.max(0, Number(options && options.metadataTtlMs) || 0);
    const summary = { resultsDeleted: 0, metadataDeleted: 0 };

    for (const candidate of listJobs()) {
      if (!TERMINAL.has(candidate.status)) continue;
      const terminalAt = Date.parse(candidate.completedAt || candidate.updatedAt || candidate.createdAt);
      const age = now() - terminalAt;
      const paths = pathsFor(candidate.jobId);

      if (metadataTtlMs && age > metadataTtlMs) {
        try {
          fs.unlinkSync(paths.result);
          summary.resultsDeleted += 1;
        } catch (error) {
          if (!error || error.code !== "ENOENT") throw error;
        }
        try {
          fs.unlinkSync(paths.metadata);
          summary.metadataDeleted += 1;
        } catch (error) {
          if (!error || error.code !== "ENOENT") throw error;
        }
        continue;
      }

      if (resultTtlMs && age > resultTtlMs && fs.existsSync(paths.result)) {
        fs.unlinkSync(paths.result);
        summary.resultsDeleted += 1;
        const current = readJson(paths.metadata);
        if (current) {
          current.execution = mergePatch(current.execution, { resultStored: false });
          atomicWriteJson(paths.metadata, current);
        }
      }
    }
    return summary;
  }

  return {
    createQuote,
    getJob,
    findByPayment,
    bindPayment,
    transition,
    update,
    deferRetry,
    claimNext,
    renewLease,
    storeResult,
    getResult,
    authorize,
    publicJob,
    sweep,
  };
}

module.exports = {
  createWorkflowJobStore,
  JOB_ID_RE,
  TRANSITIONS,
};
