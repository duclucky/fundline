"use strict";

(function exposePaymentVerification(root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.FundlinePaymentVerification = api;
})(typeof window !== "undefined" ? window : globalThis, function createPaymentVerification() {
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
    pollPaymentVerification,
    fetchWithTimeout,
  };
});
