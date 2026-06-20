// Shared memo helpers for the PaymentRouterV2 on-chain invoice memo. Pure, dependency
// free, and usable in both the browser (loaded as a plain <script>, exposes
// window.FundlineMemo) and Node (require, for tests). Keep it free of DOM/browser
// globals so the test can import it directly.
//
// The memo is an opt-in, human-readable record a merchant may embed in the payment
// transaction. The merchant picks which invoice fields go on-chain at create time;
// this module turns that selection into a deterministic memo string and ABI-encodes
// the PaymentRouterV2.payInvoiceWithMemo(bytes32,address,uint256,bytes) calldata.
(function (global) {
  "use strict";

  // Canonical field set and order. Must match ONCHAIN_MEMO_FIELD_KEYS in server.js.
  var MEMO_FIELD_KEYS = ["number", "total", "createdAt", "dueDate", "merchantName", "clientName", "items", "note", "hash"];
  var PAY_WITH_MEMO_SELECTOR = "0x53a2a881"; // payInvoiceWithMemo(bytes32,address,uint256,bytes)
  var MAX_MEMO_BYTES = 2048; // must match PaymentRouterV2.MAX_MEMO_BYTES

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

  // Render an ISO timestamp as a short UTC date (YYYY-MM-DD) for the memo.
  function formatMemoDate(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    var p = function (n) { return String(n).padStart(2, "0"); };
    return d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate());
  }

  // Deterministic representation of the invoice's economic content, used as the input
  // to the optional SHA-256 commitment. Order is fixed so the same invoice always
  // produces the same hash on the client and on any verifier.
  function canonicalInvoiceForHash(invoice) {
    var items = (Array.isArray(invoice.items) ? invoice.items : [])
      .map(function (it) {
        var qty = it.quantity != null ? it.quantity : it.qty;
        var desc = it.description || it.name || "";
        return desc + ":" + (qty == null ? "" : qty) + ":" + (it.price == null ? "" : it.price);
      })
      .join(";");
    return [
      invoice.number || "",
      String(invoice.merchantWallet || "").toLowerCase(),
      invoice.merchantName || "",
      invoice.clientName || "",
      invoice.total == null ? "" : invoice.total,
      invoice.createdAt || "",
      invoice.dueDate || "",
      items,
    ].join("|");
  }

  // Keep only known keys, drop duplicates, preserve canonical order. Mirrors
  // normalizeMemoFields in server.js so client and server agree on the selection.
  function normalizeMemoFields(fields) {
    if (!Array.isArray(fields)) return [];
    var chosen = {};
    fields.forEach(function (f) { chosen[String(f || "").trim()] = true; });
    return MEMO_FIELD_KEYS.filter(function (key) { return chosen[key]; });
  }

  // Build the readable memo string from the invoice and the selected fields. Returns
  // "" when nothing is selected (the "do not attach info" choice). hashHex, when the
  // "hash" field is selected, is a precomputed SHA-256 hex of canonicalInvoiceForHash.
  function buildInvoiceMemoText(invoice, fields, hashHex) {
    var selected = normalizeMemoFields(fields);
    if (!invoice || selected.length === 0) return "";
    var chosen = {};
    selected.forEach(function (f) { chosen[f] = true; });

    var parts = ["Fundline"];
    if (chosen.number && invoice.number) parts.push("invoice " + invoice.number);
    if (chosen.total && invoice.total != null) parts.push(Number(invoice.total).toFixed(2) + " USDC");
    if (chosen.createdAt && invoice.createdAt) parts.push("issued " + formatMemoDate(invoice.createdAt));
    if (chosen.dueDate && invoice.dueDate) parts.push("due " + formatMemoDate(invoice.dueDate));
    if (chosen.merchantName && invoice.merchantName) parts.push("from " + invoice.merchantName);
    if (chosen.clientName && invoice.clientName) parts.push("to " + invoice.clientName);
    if (chosen.items && Array.isArray(invoice.items) && invoice.items.length) {
      var itemsText = invoice.items
        .map(function (it) {
          var qty = it.quantity != null ? it.quantity : it.qty;
          var desc = it.description || it.name || "item";
          return (qty ? qty + "x " : "") + desc + (it.price != null ? " @" + it.price : "");
        })
        .join(", ");
      parts.push("items: " + itemsText);
    }
    if (chosen.note && invoice.note) parts.push("note: " + invoice.note);
    if (chosen.hash && hashHex) parts.push("commit:" + strip0x(hashHex).toLowerCase());
    return parts.join(" | ");
  }

  function encUint256(value) {
    var n = typeof value === "bigint" ? value : BigInt(String(value == null ? "0" : value));
    if (n < 0n) throw new Error("Amount cannot be negative.");
    return n.toString(16).padStart(64, "0");
  }

  function encAddress(value) {
    var h = strip0x(value).toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(h)) throw new Error("Invalid address for memo calldata.");
    return h.padStart(64, "0");
  }

  function encBytes32(value) {
    var h = strip0x(value).toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error("Invalid bytes32 for memo calldata.");
    return h;
  }

  function padHexRight32(hex) {
    var remainder = hex.length % 64;
    return remainder ? hex + "0".repeat(64 - remainder) : hex;
  }

  // ABI-encode payInvoiceWithMemo(bytes32,address,uint256,bytes). The trailing dynamic
  // bytes sits after a 4-word head (offset is a constant 0x80 = 128 bytes).
  function encodePayInvoiceWithMemo(params) {
    var invoiceId = encBytes32(params.invoiceId);
    var merchant = encAddress(params.merchant);
    var amount = encUint256(params.amount);
    var memoBytes = toUtf8Bytes(params.memoText || "");
    if (memoBytes.length > MAX_MEMO_BYTES) {
      throw new Error("Memo exceeds the " + MAX_MEMO_BYTES + "-byte on-chain limit.");
    }
    var offset = encUint256(128n);
    var length = encUint256(BigInt(memoBytes.length));
    var dataHex =
      strip0x(PAY_WITH_MEMO_SELECTOR) +
      invoiceId +
      merchant +
      amount +
      offset +
      length +
      padHexRight32(bytesToHex(memoBytes));
    return "0x" + dataHex;
  }

  var api = {
    MEMO_FIELD_KEYS: MEMO_FIELD_KEYS,
    MAX_MEMO_BYTES: MAX_MEMO_BYTES,
    PAY_WITH_MEMO_SELECTOR: PAY_WITH_MEMO_SELECTOR,
    formatMemoDate: formatMemoDate,
    canonicalInvoiceForHash: canonicalInvoiceForHash,
    normalizeMemoFields: normalizeMemoFields,
    buildInvoiceMemoText: buildInvoiceMemoText,
    encodePayInvoiceWithMemo: encodePayInvoiceWithMemo,
  };

  global.FundlineMemo = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
