// Shared helpers for FundlineBatchRouter (one-to-many USDC payout). Pure, dependency
// free, usable in the browser (loaded as a plain <script>, exposes window.FundlineBatch)
// and in Node (require, for tests). Hand-rolls the ABI encoding for payBatch and
// payBatchWithMemo so the buildless frontend can call the contract without ethers.
(function (global) {
  "use strict";

  var PAY_BATCH_SELECTOR = "0x4ae7161f"; // payBatch(bytes32,address[],uint256[])
  var PAY_BATCH_WITH_MEMO_SELECTOR = "0xb4199844"; // payBatchWithMemo(bytes32,address[],uint256[],bytes[])
  var MAX_BATCH = 256; // must match FundlineBatchRouter.MAX_BATCH
  var MAX_MEMO_BYTES = 256; // must match FundlineBatchRouter.MAX_MEMO_BYTES

  function strip0x(value) {
    return String(value == null ? "" : value).replace(/^0x/i, "");
  }

  function toUtf8Bytes(str) {
    if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(String(str));
    return Uint8Array.from(Buffer.from(String(str), "utf8"));
  }

  function bytesToHex(bytes) {
    var out = "";
    for (var i = 0; i < bytes.length; i += 1) out += bytes[i].toString(16).padStart(2, "0");
    return out;
  }

  // 32-byte word from a non-negative integer (number or bigint).
  function word(value) {
    var n = typeof value === "bigint" ? value : BigInt(String(value == null ? "0" : value));
    if (n < 0n) throw new Error("Value cannot be negative.");
    return n.toString(16).padStart(64, "0");
  }

  function encAddress(value) {
    var h = strip0x(value).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error("Invalid recipient address: " + value);
    return h.padStart(64, "0");
  }

  function encBytes32(value) {
    var h = strip0x(value).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("Invalid bytes32 batch id.");
    return h;
  }

  function padHexRight32(hex) {
    var remainder = hex.length % 64;
    return remainder ? hex + "0".repeat(64 - remainder) : hex;
  }

  function validateLists(recipients, amounts) {
    var n = recipients.length;
    if (n !== amounts.length) throw new Error("recipients and amounts length mismatch.");
    if (n === 0) throw new Error("Batch is empty.");
    if (n > MAX_BATCH) throw new Error("Batch exceeds the " + MAX_BATCH + "-recipient limit.");
    return n;
  }

  // ABI-encode payBatch(bytes32, address[], uint256[]).
  function encodePayBatch(params) {
    var batchId = encBytes32(params.batchId);
    var recipients = params.recipients || [];
    var amounts = params.amounts || [];
    var n = validateLists(recipients, amounts);

    var offRecipients = 96; // 3 head words
    var offAmounts = 96 + 32 * (1 + n);
    var recipientsTail = word(n) + recipients.map(encAddress).join("");
    var amountsTail = word(n) + amounts.map(word).join("");

    var data =
      strip0x(PAY_BATCH_SELECTOR) +
      batchId +
      word(offRecipients) +
      word(offAmounts) +
      recipientsTail +
      amountsTail;
    return "0x" + data;
  }

  // ABI-encode payBatchWithMemo(bytes32, address[], uint256[], bytes[]). memos must line
  // up 1:1 with recipients (pass "" to skip a recipient's memo).
  function encodePayBatchWithMemo(params) {
    var batchId = encBytes32(params.batchId);
    var recipients = params.recipients || [];
    var amounts = params.amounts || [];
    var memos = params.memos || [];
    var n = validateLists(recipients, amounts);
    if (memos.length !== n) throw new Error("memos length must match recipients.");

    var offRecipients = 128; // 4 head words
    var offAmounts = 128 + 32 * (1 + n);
    var offMemos = 128 + 64 * (1 + n);
    var recipientsTail = word(n) + recipients.map(encAddress).join("");
    var amountsTail = word(n) + amounts.map(word).join("");

    // bytes[]: length, then n offsets (relative to the start of the offsets region),
    // then each element as length + right-padded data.
    var heads = "";
    var tails = "";
    var cursor = 32 * n;
    for (var i = 0; i < n; i += 1) {
      var bytes = toUtf8Bytes(memos[i] || "");
      if (bytes.length > MAX_MEMO_BYTES) throw new Error("A memo exceeds the " + MAX_MEMO_BYTES + "-byte limit.");
      var padded = padHexRight32(bytesToHex(bytes));
      heads += word(cursor);
      tails += word(bytes.length) + padded;
      cursor += 32 + padded.length / 2;
    }
    var memosTail = word(n) + heads + tails;

    var data =
      strip0x(PAY_BATCH_WITH_MEMO_SELECTOR) +
      batchId +
      word(offRecipients) +
      word(offAmounts) +
      word(offMemos) +
      recipientsTail +
      amountsTail +
      memosTail;
    return "0x" + data;
  }

  var api = {
    PAY_BATCH_SELECTOR: PAY_BATCH_SELECTOR,
    PAY_BATCH_WITH_MEMO_SELECTOR: PAY_BATCH_WITH_MEMO_SELECTOR,
    MAX_BATCH: MAX_BATCH,
    MAX_MEMO_BYTES: MAX_MEMO_BYTES,
    encodePayBatch: encodePayBatch,
    encodePayBatchWithMemo: encodePayBatchWithMemo,
  };

  global.FundlineBatch = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
