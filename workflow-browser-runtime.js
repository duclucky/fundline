"use strict";

(function exposeWorkflowRuntime(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FundlineWorkflowRuntime = api;
})(typeof window !== "undefined" ? window : globalThis, function createWorkflowRuntime() {
  const DEFAULT_RPC_URL = "https://rpc.testnet.arc.network";

  function normalizeRpcUrls(config = {}) {
    const values = [config.rpcUrl, ...(Array.isArray(config.rpcFallbackUrls) ? config.rpcFallbackUrls : [])];
    const seen = new Set();
    const urls = [];
    for (const raw of values) {
      const value = String(raw || "").trim();
      if (!/^https?:\/\//i.test(value) || seen.has(value)) continue;
      seen.add(value);
      urls.push(value);
    }
    return urls.length ? urls : [DEFAULT_RPC_URL];
  }

  function canRotate(error) {
    return error?.code === -32011
      || error?.code === "rpc_timeout"
      || error?.status === 429
      || Number(error?.status) >= 500;
  }

  function createRpcReadProvider(options = {}) {
    const rpcUrls = normalizeRpcUrls({
      rpcUrl: options.rpcUrls?.[0],
      rpcFallbackUrls: options.rpcUrls?.slice(1),
    });
    const fetchImpl = options.fetchImpl || fetch;
    const rpcTimeoutMs = Math.max(1, Number(options.rpcTimeoutMs) || 10000);
    let requestId = 0;

    return {
      async request({ method, params = [] }) {
        let lastError;
        for (let index = 0; index < rpcUrls.length; index += 1) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), rpcTimeoutMs);
          try {
            const response = await fetchImpl(rpcUrls[index], {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
              signal: controller.signal,
            });
            const body = await response.json().catch(() => ({}));
            if (!response.ok) {
              const error = new Error(body.error?.message || `Arc RPC HTTP ${response.status}`);
              error.status = response.status;
              throw error;
            }
            if (body.error) {
              const error = new Error(body.error.message || "Arc RPC returned an error");
              error.code = body.error.code;
              throw error;
            }
            return body.result;
          } catch (error) {
            if (controller.signal.aborted) {
              lastError = new Error("Arc RPC request timed out");
              lastError.code = "rpc_timeout";
            } else {
              lastError = error;
            }
            if (!canRotate(lastError) || index === rpcUrls.length - 1) throw lastError;
          } finally {
            clearTimeout(timer);
          }
        }
        throw lastError || new Error("Arc RPC request failed");
      },
    };
  }

  async function waitForReceipt(options = {}) {
    const now = options.now || Date.now;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 60000);
    const pollMs = Math.max(1, Number(options.pollMs) || 2000);
    const startedAt = now();

    while (now() - startedAt < timeoutMs) {
      const receipt = await options.request("eth_getTransactionReceipt", [options.txHash]);
      if (receipt) {
        if (String(receipt.status || "").toLowerCase() === "0x0") {
          throw new Error("Transaction reverted.");
        }
        return receipt;
      }
      const remaining = timeoutMs - (now() - startedAt);
      if (remaining <= 0) break;
      await sleep(Math.min(pollMs, remaining));
    }
    const error = new Error("Transaction confirmation timed out.");
    error.code = "transaction_confirmation_timeout";
    throw error;
  }

  function createRecoveryStore(storage, key) {
    const storageKey = String(key || "fundline-workflow-jobs-v1");
    const validHash = (value) => /^0x[a-fA-F0-9]{64}$/.test(String(value || ""));
    const validWallet = (value) => /^0x[a-fA-F0-9]{40}$/.test(String(value || ""));
    const read = () => {
      try {
        const parsed = JSON.parse(storage.getItem(storageKey) || "[]");
        return Array.isArray(parsed) ? parsed.filter(validRecord) : [];
      } catch {
        return [];
      }
    };
    const write = (records) => storage.setItem(storageKey, JSON.stringify(records));
    const validRecord = (record) => Boolean(
      record
      && validHash(record.jobId)
      && validHash(record.runId)
      && validWallet(record.wallet)
      && String(record.recoveryToken || "").trim()
      && String(record.slug || "").trim()
      && String(record.tier || "").trim()
    );

    return {
      put(record) {
        if (!validRecord(record)) throw new Error("Invalid workflow recovery record");
        const records = read();
        const index = records.findIndex((item) => item.jobId.toLowerCase() === record.jobId.toLowerCase());
        const normalized = { ...record, wallet: record.wallet.toLowerCase() };
        if (index >= 0) records[index] = normalized;
        else records.push(normalized);
        write(records);
        return normalized;
      },
      listForWallet(wallet) {
        const normalized = String(wallet || "").toLowerCase();
        return validWallet(normalized)
          ? read().filter((record) => record.wallet.toLowerCase() === normalized)
          : [];
      },
      remove(jobId) {
        const normalized = String(jobId || "").toLowerCase();
        write(read().filter((record) => record.jobId.toLowerCase() !== normalized));
      },
    };
  }

  async function fetchRunStatus(options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1, Number(options.timeoutMs) || 10000));
    try {
      const response = await options.fetchImpl(
        `/api/workflows/runs/${encodeURIComponent(options.jobId)}`,
        {
          headers: {
            "Accept": "application/json",
            "X-Fundline-Recovery-Token": options.recoveryToken,
          },
          signal: controller.signal,
        },
      );
      const body = await response.json().catch(() => ({}));
      if (response.status !== 200 && response.status !== 202) {
        throw new Error(body.error?.message || body.error || `Workflow status HTTP ${response.status}`);
      }
      return body;
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error("Workflow status request timed out.");
        timeoutError.code = "workflow_status_timeout";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    normalizeRpcUrls,
    createRpcReadProvider,
    waitForReceipt,
    createRecoveryStore,
    fetchRunStatus,
  };
});
