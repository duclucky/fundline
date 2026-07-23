"use strict";

const { renderDocumentPdf } = require("./doc-render");

const PDF_MIME = "application/pdf";
const ARTIFACT_WARNING = "The PDF deliverable could not be generated.";

function sanitizeFilePart(value) {
  return String(value || "workflow")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "workflow";
}

function pdfFilename(options) {
  const date = String(options.completedAt || new Date().toISOString()).slice(0, 10);
  const runId = String(options.runId || "").replace(/^0x/i, "").slice(0, 8).toLowerCase();
  return sanitizeFilePart(options.slug) + "-" + date + (runId ? "-" + runId : "") + ".pdf";
}

function isPdf(file) {
  return !!file && (
    String(file.mimeType || "").toLowerCase() === PDF_MIME
    || String(file.format || "").toLowerCase() === "pdf"
    || /\.pdf$/i.test(String(file.filename || ""))
  );
}

function normalizeArtifact(file) {
  if (!file || typeof file !== "object") return null;
  return {
    ...file,
    kind: "file",
    role: file.role || "deliverable",
    format: file.format || (isPdf(file) ? "pdf" : ""),
    mimeType: file.mimeType || (isPdf(file) ? PDF_MIME : "application/octet-stream"),
  };
}

function cleanInlineMarkdown(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/^>\s?/, "")
    .trim();
}

function splitTableRow(line) {
  return String(line || "")
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cleanInlineMarkdown(cell));
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s+/g, "")));
}

function markdownToDocumentSpec(options) {
  const source = String(options.report || "").replace(/\r\n?/g, "\n");
  const lines = source.split("\n");
  let title = "";
  const sections = [];
  let section = null;
  let paragraph = [];
  let list = [];

  function ensureSection() {
    if (!section) {
      section = { heading: "Result", blocks: [] };
      sections.push(section);
    }
    return section;
  }

  function flushParagraph() {
    if (!paragraph.length) return;
    const text = cleanInlineMarkdown(paragraph.join(" "));
    if (text) ensureSection().blocks.push({ type: "paragraph", text });
    paragraph = [];
  }

  function flushList() {
    if (!list.length) return;
    ensureSection().blocks.push({ type: "list", items: list });
    list = [];
  }

  function flushFlow() {
    flushParagraph();
    flushList();
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushFlow();
      const text = cleanInlineMarkdown(heading[2]);
      if (heading[1].length === 1 && !title) {
        title = text;
      } else {
        section = { heading: text || "Result", blocks: [] };
        sections.push(section);
      }
      continue;
    }

    if (/^\s*```/.test(line)) {
      flushFlow();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      ensureSection().blocks.push({ type: "code", text: code.join("\n") });
      continue;
    }

    if (line.includes("|")
      && index + 1 < lines.length
      && lines[index + 1].includes("|")
      && isTableSeparator(lines[index + 1])) {
      flushFlow();
      const columns = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      ensureSection().blocks.push({ type: "table", columns, rows });
      continue;
    }

    const listItem = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      list.push(cleanInlineMarkdown(listItem[1]));
      continue;
    }

    if (!line.trim() || /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushFlow();
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }
  flushFlow();

  if (options.structured != null) {
    let serialized = "";
    try {
      serialized = JSON.stringify(options.structured, null, 2);
    } catch (_) {}
    if (serialized) {
      section = { heading: "Structured result", blocks: [{ type: "code", text: serialized.slice(0, 20000) }] };
      sections.push(section);
    }
  }

  if (!sections.length) {
    sections.push({
      heading: "Result",
      blocks: [{ type: "paragraph", text: "The workflow completed without a text report." }],
    });
  }

  const completedAt = String(options.completedAt || new Date().toISOString());
  return {
    meta: {
      title: title || "Workflow result",
      subtitle: sanitizeFilePart(options.slug).replace(/-/g, " "),
      sender: "Fundline",
      date: completedAt.slice(0, 10),
    },
    sections,
  };
}

async function renderWorkflowResultPdf(options) {
  const renderPdf = options.renderPdf || renderDocumentPdf;
  const spec = markdownToDocumentSpec(options);
  const buffer = await renderPdf(spec, { footer: "Generated by Fundline" });
  if (!Buffer.isBuffer(buffer)) throw new Error("PDF renderer did not return a buffer");
  return {
    format: "pdf",
    filename: pdfFilename(options),
    mimeType: PDF_MIME,
    base64: buffer.toString("base64"),
  };
}

function sameArtifact(left, right) {
  if (left.url && right.url) return left.url === right.url;
  return left.filename === right.filename && left.mimeType === right.mimeType;
}

async function finalizeWorkflowResult(result, options) {
  const settings = options || {};
  const next = { ...(result || {}) };
  const candidates = [next.file]
    .concat(Array.isArray(next.artifacts) ? next.artifacts : [])
    .map(normalizeArtifact)
    .filter(Boolean);
  let primary = candidates.find(isPdf) || null;

  try {
    if (!primary) {
      primary = normalizeArtifact(await renderWorkflowResultPdf({
        ...settings,
        report: next.report,
        structured: next.cvJson || next.riskJson || null,
      }));
      candidates.unshift(primary);
    }

    if (primary.base64 && typeof settings.persistDocument === "function") {
      const stored = await settings.persistDocument(primary);
      if (!stored || !stored.url) throw new Error("PDF persistence failed");
      const persisted = normalizeArtifact(stored);
      const primaryIndex = candidates.indexOf(primary);
      candidates[primaryIndex] = persisted;
      primary = persisted;
    }

    next.file = primary;
    next.artifacts = candidates.filter((item, index, all) =>
      all.findIndex((candidate) => sameArtifact(candidate, item)) === index);
    delete next.artifactWarning;
  } catch (error) {
    if (typeof settings.onArtifactError === "function") settings.onArtifactError(error);
    next.file = null;
    next.artifacts = candidates.filter((item) => item !== primary && item.url);
    next.artifactWarning = ARTIFACT_WARNING;
  }

  return next;
}

module.exports = {
  ARTIFACT_WARNING,
  PDF_MIME,
  finalizeWorkflowResult,
  isPdf,
  markdownToDocumentSpec,
  renderWorkflowResultPdf,
  sanitizeFilePart,
};
