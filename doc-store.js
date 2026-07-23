"use strict";

// Short-lived store for generated document files (doc-gen PDFs). A run writes the PDF here
// and returns an unguessable capability URL (/d/<id>) that the agent hands to its owner to
// read. Disk-backed (data/docs/) so it survives restart and works across Passenger workers,
// unlike an in-memory map. Files expire after TTL and are swept opportunistically on write.
// The id is high-entropy so the link acts as an unlisted share link (no auth); treat the
// content as readable-by-anyone-with-the-link.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DOCS_DIR = path.join(__dirname, "data", "docs");

function positiveHours(value, fallback) {
  const hours = Number(value);
  return Number.isFinite(hours) && hours > 0 ? hours : fallback;
}

function resolveDocTtlMs(env) {
  const source = env || {};
  const resultHours = positiveHours(source.WORKFLOW_JOB_RESULT_TTL_HOURS, 168);
  const documentHours = positiveHours(source.WORKFLOW_DOC_TTL_HOURS, resultHours);
  return Math.max(resultHours, documentHours) * 60 * 60 * 1000;
}

const TTL_MS = resolveDocTtlMs(process.env);

function ensureDir() {
  try { fs.mkdirSync(DOCS_DIR, { recursive: true }); } catch (_) {}
}

// Delete expired files. Best-effort; never throws.
function sweep() {
  try {
    const now = Date.now();
    fs.readdirSync(DOCS_DIR).forEach((f) => {
      try {
        const p = path.join(DOCS_DIR, f);
        if (now - fs.statSync(p).mtimeMs > TTL_MS) fs.unlinkSync(p);
      } catch (_) {}
    });
  } catch (_) {}
}

// Store a PDF buffer, return its id. Filename is kept alongside for the download name.
function putDoc(buffer, filename) {
  ensureDir();
  sweep();
  const id = crypto.randomBytes(12).toString("hex"); // 24 hex chars
  fs.writeFileSync(path.join(DOCS_DIR, id + ".pdf"), buffer);
  try { fs.writeFileSync(path.join(DOCS_DIR, id + ".name"), String(filename || "document.pdf")); } catch (_) {}
  return id;
}

// Fetch a stored PDF by id, or null if missing/expired/invalid id.
function getDoc(id) {
  if (!/^[a-f0-9]{24}$/.test(String(id || ""))) return null;
  const p = path.join(DOCS_DIR, id + ".pdf");
  try {
    if (Date.now() - fs.statSync(p).mtimeMs > TTL_MS) return null;
    const buffer = fs.readFileSync(p);
    let filename = "document.pdf";
    try { filename = (fs.readFileSync(path.join(DOCS_DIR, id + ".name"), "utf8") || "").trim() || filename; } catch (_) {}
    return { buffer, filename };
  } catch (_) {
    return null;
  }
}

module.exports = { putDoc, getDoc, sweep, resolveDocTtlMs, DOCS_DIR, TTL_MS };
