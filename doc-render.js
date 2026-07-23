"use strict";

// Document render backend A: a document-spec (JSON) -> PDF bytes, in-process and hosting-safe.
// Pure JS via pdfkit (no headless Chromium, no native build), so it runs on the shared cPanel
// host without the nproc/RAM risk that a browser renderer would carry. Backend B (off-host,
// HTML/CSS + Chromium, higher design) consumes the SAME document-spec. See
// .claude/workflow-doc-gen-spec.md for the spec shape and the two-backend architecture.

// pdfkit is required lazily inside renderDocumentPdf so a missing dependency degrades a
// single run instead of crashing server boot (same precedent as the lazy MCP-SDK require).

// Defaults mirror the Fundline dark/gold theme; spec.theme can override.
const THEME = {
  accent: "#B8860B",
  text: "#1a1a1a",
  muted: "#666666",
  rule: "#dddddd",
  stripe: "#f5f5f5",
};

const PAGE = { size: "A4", margin: 64, bottomMargin: 92 };

// renderProposalPdf(spec) -> Promise<Buffer>. Also used for reports (same block grammar).
function renderDocumentPdf(spec, opts) {
  return new Promise((resolve, reject) => {
    try {
      let PDFDocument;
      try { PDFDocument = require("pdfkit"); }
      catch (_) { throw new Error("pdfkit is not installed; run npm install to enable document rendering"); }
      const options = opts || {};
      const theme = Object.assign({}, THEME, (spec && spec.theme) || {});
      const doc = new PDFDocument({
        size: PAGE.size,
        margins: {
          top: PAGE.margin,
          bottom: PAGE.bottomMargin,
          left: PAGE.margin,
          right: PAGE.margin,
        },
        bufferPages: true,
        info: {
          Title: (spec && spec.meta && spec.meta.title) || "Document",
          Author: (spec && spec.meta && spec.meta.sender) || "Fundline",
        },
      });
      const chunks = [];
      doc.on("data", (c) => chunks.push(c));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
      renderCover(doc, spec, theme, contentWidth);

      const sections = (spec && Array.isArray(spec.sections)) ? spec.sections : [];
      sections.forEach((section) => renderSection(doc, section, theme, contentWidth));

      const sources = (spec && Array.isArray(spec.sources)) ? spec.sources : [];
      if (sources.length) {
        renderSection(doc, {
          heading: "Sources",
          blocks: [{ type: "list", items: sources.map((s) => (s.title ? s.title + " - " : "") + (s.url || "")) }],
        }, theme, contentWidth);
      }

      addFooters(doc, theme, options.footer);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

function renderCover(doc, spec, theme, width) {
  const meta = (spec && spec.meta) || {};
  doc.fillColor(theme.accent).font("Helvetica-Bold").fontSize(26).text(meta.title || "Document", { width });
  if (meta.subtitle) {
    doc.moveDown(0.3).fillColor(theme.muted).font("Helvetica").fontSize(13).text(meta.subtitle, { width });
  }
  doc.moveDown(0.8).fillColor(theme.text).font("Helvetica").fontSize(10);
  if (meta.sender) doc.text("From: " + meta.sender, { width });
  if (meta.recipient) doc.text("To: " + meta.recipient, { width });
  if (meta.date) doc.text("Date: " + meta.date, { width });
  doc.moveDown(0.6);
  horizontalRule(doc, theme, width);
  doc.moveDown(0.8);
}

function horizontalRule(doc, theme, width) {
  const y = doc.y;
  doc.save().strokeColor(theme.rule).lineWidth(1)
    .moveTo(doc.page.margins.left, y)
    .lineTo(doc.page.margins.left + width, y)
    .stroke().restore();
}

function ensureSpace(doc, needed) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (doc.y + needed > bottom) doc.addPage();
}

function renderSection(doc, section, theme, width) {
  if (!section || !section.heading) return;
  doc.x = doc.page.margins.left;
  ensureSpace(doc, 56);
  doc.moveDown(0.3);
  doc.fillColor(theme.accent).font("Helvetica-Bold").fontSize(14).text(String(section.heading), { width });
  doc.moveDown(0.3);
  const blocks = Array.isArray(section.blocks) ? section.blocks : [];
  blocks.forEach((block) => renderBlock(doc, block, theme, width));
  doc.moveDown(0.5);
}

function renderBlock(doc, block, theme, width) {
  const type = block && block.type;
  if (type === "paragraph") {
    doc.fillColor(theme.text).font("Helvetica").fontSize(10.5).text(String(block.text || ""), { width, align: "left", lineGap: 2 });
    doc.moveDown(0.4);
  } else if (type === "list") {
    const items = Array.isArray(block.items) ? block.items : [];
    doc.fillColor(theme.text).font("Helvetica").fontSize(10.5);
    items.forEach((it) => {
      ensureSpace(doc, 16);
      doc.text("- " + String(it), { width, indent: 8, lineGap: 2 });
    });
    doc.moveDown(0.4);
  } else if (type === "keyvalue") {
    const pairs = Array.isArray(block.pairs) ? block.pairs : [];
    doc.fontSize(10.5);
    pairs.forEach((p) => {
      ensureSpace(doc, 16);
      const k = String((p && p.k) || "");
      const v = String((p && p.v) || "");
      doc.font("Helvetica-Bold").fillColor(theme.text).text(k + ":  ", { continued: true })
        .font("Helvetica").fillColor(theme.muted).text(v);
    });
    doc.moveDown(0.4);
  } else if (type === "table") {
    renderTable(doc, block, theme, width);
    doc.moveDown(0.4);
  } else if (type === "code") {
    const text = String(block.text || "");
    ensureSpace(doc, 32);
    doc.fillColor(theme.text).font("Courier").fontSize(8.5)
      .text(text, {
        width,
        lineGap: 1,
        indent: 8,
      });
    doc.moveDown(0.4);
  }
}

// Grid table with wrapped cells and computed row heights, so long cell text does not overlap.
// Draws cells with absolute coordinates, then restores the text cursor (x AND y) so following
// flow text is not shifted. Long tables paginate per row and redraw the header on a new page.
function renderTable(doc, block, theme, width) {
  const columns = Array.isArray(block.columns) ? block.columns : [];
  const rows = Array.isArray(block.rows) ? block.rows : [];
  if (!columns.length) return;

  const startX = doc.page.margins.left;
  const colWidth = width / columns.length;
  const padX = 6;
  const padY = 5;
  const cellW = colWidth - padX * 2;

  function measureRow(cells, font, size) {
    doc.font(font).fontSize(size);
    let max = 0;
    for (let i = 0; i < columns.length; i++) {
      const txt = String(cells && cells[i] != null ? cells[i] : "");
      const h = doc.heightOfString(txt, { width: cellW });
      if (h > max) max = h;
    }
    return Math.ceil(max) + padY * 2;
  }

  function drawRow(cells, y, h, o) {
    const opts = o || {};
    if (opts.fill) doc.save().rect(startX, y, width, h).fill(opts.fill).restore();
    doc.font(opts.font || "Helvetica").fontSize(opts.size || 10);
    for (let i = 0; i < columns.length; i++) {
      const txt = String(cells && cells[i] != null ? cells[i] : "");
      doc.fillColor(opts.color || theme.text).text(txt, startX + i * colWidth + padX, y + padY, { width: cellW });
    }
  }

  const headerH = measureRow(columns, "Helvetica-Bold", 10);
  ensureSpace(doc, headerH + 4);
  let y = doc.y;
  drawRow(columns, y, headerH, { fill: theme.accent, color: "#ffffff", font: "Helvetica-Bold", size: 10 });
  y += headerH;

  for (let ri = 0; ri < rows.length; ri++) {
    const cells = Array.isArray(rows[ri]) ? rows[ri] : [];
    const h = measureRow(cells, "Helvetica", 10);
    if (y + h > doc.page.height - doc.page.margins.bottom) {
      doc.addPage();
      y = doc.y;
      const hh = measureRow(columns, "Helvetica-Bold", 10);
      drawRow(columns, y, hh, { fill: theme.accent, color: "#ffffff", font: "Helvetica-Bold", size: 10 });
      y += hh;
    }
    drawRow(cells, y, h, ri % 2 === 1 ? { fill: theme.stripe } : {});
    y += h;
  }

  doc.x = doc.page.margins.left;
  doc.y = y;
}

function addFooters(doc, theme, footerText) {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i);
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const y = doc.page.height - 40;
    const label = (footerText ? footerText + "   " : "") + "Page " + (i + 1) + " of " + range.count;
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font("Helvetica").fontSize(8).fillColor(theme.muted)
      .text(label, doc.page.margins.left, y, { width, align: "center", lineBreak: false });
    doc.page.margins.bottom = bottomMargin;
  }
}

module.exports = { renderDocumentPdf, THEME };
