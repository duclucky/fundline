"use strict";

(function exposePaymentVerification(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FundlinePaymentVerification = api;
})(typeof window !== "undefined" ? window : globalThis, function createPaymentVerification() {
  function normalizeRpcUrls(primary, fallbacks) {
    const values = [primary, ...(Array.isArray(fallbacks) ? fallbacks : [])];
    return Array.from(new Set(values
      .map((value) => String(value || "").trim())
      .filter((value) => /^https?:\/\//i.test(value))));
  }

  function isRpcRateLimitError(error) {
    const status = Number(error?.status || error?.statusCode);
    const code = Number(error?.code);
    const message = String(error?.message || "").toLowerCase();
    return status === 429
      || code === 429
      || code === -32011
      || message.includes("status code: '429'")
      || message.includes("status code 429")
      || message.includes("too many requests")
      || message.includes("rate limit");
  }

  function isTransientRpcError(error) {
    if (isRpcRateLimitError(error)) return true;
    const status = Number(error?.status || error?.statusCode);
    if (Number.isFinite(status) && status > 0) return status >= 500;
    if (error?.code === "invoice_rpc_timeout" || error?.name === "AbortError") return true;
    const message = String(error?.message || "").toLowerCase();
    return error instanceof TypeError
      || message.includes("network")
      || message.includes("fetch")
      || message.includes("timeout")
      || message.includes("connection");
  }

  async function rpcRequestWithFallback(options) {
    const fetchImpl = options.fetchImpl;
    const urls = normalizeRpcUrls("", options.urls);
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const timeoutMs = Math.max(1, Number(options.timeoutMs) || 10000);
    if (typeof fetchImpl !== "function") throw new Error("Invoice RPC fetch is not configured.");
    if (!urls.length) throw new Error("Invoice RPC endpoint is not configured.");

    for (let index = 0; index < urls.length; index += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await fetchImpl(urls[index], {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: Date.now(),
            method: options.method,
            params: options.params || [],
          }),
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || payload.error) {
          const error = new Error(payload.error?.message || `Invoice RPC returned HTTP ${response.status}.`);
          error.status = response.status;
          error.code = payload.error?.code;
          throw error;
        }
        return payload.result;
      } catch (error) {
        if (controller.signal.aborted) {
          const timeoutError = new Error("Invoice RPC request timed out.");
          timeoutError.code = "invoice_rpc_timeout";
          error = timeoutError;
        }
        if (!isTransientRpcError(error) || index === urls.length - 1) throw error;
        await wait(Math.min(250 * (2 ** index), 1000));
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error("Invoice RPC request failed.");
  }

  async function submitInvoiceTransactionOnce(options) {
    try {
      return { status: "submitted", value: await options.submit() };
    } catch (error) {
      if (!isRpcRateLimitError(error)) throw error;
      const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
      const attempts = Math.max(1, Number(options.attempts) || 1);
      const delayMs = Math.max(0, Number(options.delayMs) || 0);
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        try {
          if (await options.checkState(attempt)) return { status: "recovered" };
        } catch (checkError) {
          if (!isTransientRpcError(checkError)) throw checkError;
        }
        if (attempt < attempts) await wait(delayMs);
      }
      const unknown = new Error(
        options.unknownMessage
        || "The wallet RPC is busy and the transaction status is unknown. Check wallet activity before retrying.",
      );
      unknown.code = "invoice_rpc_submission_unknown";
      unknown.cause = error;
      throw unknown;
    }
  }

  async function pollPaymentVerification(options) {
    const attempt = options.attempt;
    const wait = options.wait || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const now = options.now || Date.now;
    const retryDelayMs = Number(options.retryDelayMs) || 2000;
    const deadlineMs = Number(options.deadlineMs) || 60000;
    const startedAt = now();
    let attemptNumber = 0;

    while (now() - startedAt < deadlineMs) {
      attemptNumber += 1;
      if (await attempt(attemptNumber)) return { verified: true, attempts: attemptNumber };
      const remaining = deadlineMs - (now() - startedAt);
      if (remaining <= 0) break;
      await wait(Math.min(retryDelayMs, remaining));
    }
    return { verified: false, attempts: attemptNumber, timedOut: true };
  }

  async function fetchWithTimeout(fetchImpl, input, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetchImpl(input, { ...(init || {}), signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) {
        const timeoutError = new Error("Payment verification request timed out.");
        timeoutError.code = "verification_timeout";
        throw timeoutError;
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    normalizeRpcUrls,
    isRpcRateLimitError,
    rpcRequestWithFallback,
    submitInvoiceTransactionOnce,
    pollPaymentVerification,
    fetchWithTimeout,
  };
});
