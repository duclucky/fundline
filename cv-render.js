"use strict";

// Client-side CV renderer for the CV + Gig Match workflow.
// Builds a self-contained, styled HTML CV from the structured cvJson returned by
// the server, and opens it in a print-ready tab (Ctrl/Cmd+P -> Save as PDF).
// Design quality is the point (user decision 2026-06-30): real typography, tasteful
// layout, prints clean on white. Two templates: "classic" (single column) and
// "modern" (two column with a sidebar). No external requests (self-contained),
// text stays selectable, A4. See .claude/workflow-cv-gigmatch-spec.md section 7.
//
// Typography note: v1 uses a strong system-font stack to stay self-contained and
// zero-dependency. A base64 woff2 embed can replace the stack later for an even
// more distinctive look without adding an external request.

(function () {
  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function has(arr) {
    return Array.isArray(arr) && arr.length > 0;
  }

  var CSS = [
    ":root{",
    "  --ink:#1c1c1c; --muted:#5c5c5c; --line:#e2ddd2; --accent:#b8860b;",
    "  --sidebar-bg:#faf7f0; --page:#ffffff;",
    "}",
    "*{box-sizing:border-box;}",
    "html,body{margin:0;padding:0;background:#eceae5;color:var(--ink);",
    "  font-family:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif;",
    "  font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
    ".cv-toolbar{position:sticky;top:0;display:flex;gap:10px;justify-content:center;",
    "  padding:12px;background:#1a1a1a;}",
    ".cv-toolbar button{padding:9px 18px;border:0;border-radius:8px;background:var(--accent);",
    "  color:#fff;font-weight:700;font-size:13px;cursor:pointer;font-family:inherit;}",
    ".cv-toolbar span{color:#cbb98a;font-size:12px;align-self:center;}",
    ".cv-page{width:210mm;min-height:297mm;margin:18px auto;background:var(--page);",
    "  box-shadow:0 8px 40px rgba(0,0,0,0.15);overflow:hidden;}",
    ".cv-head{padding:34px 40px 20px;}",
    ".cv-name{font-size:30px;font-weight:800;letter-spacing:-0.02em;margin:0;}",
    ".cv-headline{font-size:15px;color:var(--accent);font-weight:600;margin:4px 0 0;}",
    ".cv-contact{margin-top:10px;color:var(--muted);font-size:12px;display:flex;flex-wrap:wrap;gap:4px 16px;}",
    ".cv-contact a{color:var(--muted);text-decoration:none;}",
    ".cv-sec{margin:0 0 16px;}",
    ".cv-sec h2{font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);",
    "  margin:0 0 8px;padding-bottom:5px;border-bottom:1.5px solid var(--line);}",
    ".cv-summary{color:var(--ink);margin:0;}",
    ".cv-entry{margin:0 0 12px;break-inside:avoid;}",
    ".cv-entry .row{display:flex;justify-content:space-between;gap:12px;}",
    ".cv-entry .title{font-weight:700;}",
    ".cv-entry .org{color:var(--muted);}",
    ".cv-entry .period{color:var(--muted);font-size:11.5px;white-space:nowrap;}",
    ".cv-entry ul{margin:5px 0 0;padding-left:18px;}",
    ".cv-entry li{margin:2px 0;}",
    ".cv-skills{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0;}",
    ".cv-skills li{background:var(--sidebar-bg);border:1px solid var(--line);border-radius:999px;",
    "  padding:3px 11px;font-size:11.5px;}",
    ".cv-list{list-style:none;margin:0;padding:0;}",
    ".cv-list li{margin:0 0 6px;}",
    ".cv-link{color:var(--accent);text-decoration:none;word-break:break-all;}",
    /* classic: single column */
    ".tpl-classic .cv-head{text-align:center;border-bottom:2px solid var(--line);}",
    ".tpl-classic .cv-contact{justify-content:center;}",
    ".tpl-classic .cv-body{padding:22px 40px 40px;}",
    /* modern: two column with sidebar */
    ".tpl-modern .cv-grid{display:grid;grid-template-columns:35% 65%;}",
    ".tpl-modern .cv-side{background:var(--sidebar-bg);padding:28px 22px;border-right:1px solid var(--line);}",
    ".tpl-modern .cv-main{padding:28px 26px;}",
    ".tpl-modern .cv-head{padding:28px 26px 6px;}",
    ".tpl-modern .cv-side .cv-sec h2{border-bottom-color:#e8e0cf;}",
    "@media print{",
    "  html,body{background:#fff;}",
    "  .cv-toolbar{display:none;}",
    "  .cv-page{width:auto;min-height:auto;margin:0;box-shadow:none;}",
    "  @page{size:A4;margin:12mm;}",
    "}",
  ].join("\n");

  function contactHtml(cv) {
    var c = cv.contact || {};
    var bits = [];
    if (c.email) bits.push('<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>");
    if (c.phone) bits.push("<span>" + esc(c.phone) + "</span>");
    if (c.website) bits.push('<a href="' + esc(c.website) + '">' + esc(c.website) + "</a>");
    if (cv.location) bits.push("<span>" + esc(cv.location) + "</span>");
    (cv.profiles || []).forEach(function (p) {
      bits.push('<a href="' + esc(p.url) + '">' + esc(p.network || p.url) + "</a>");
    });
    return bits.length ? '<div class="cv-contact">' + bits.join("") + "</div>" : "";
  }

  function secSummary(cv) {
    if (!cv.summary) return "";
    return '<div class="cv-sec"><h2>Summary</h2><p class="cv-summary">' + esc(cv.summary) + "</p></div>";
  }

  function secSkills(cv) {
    if (!has(cv.skills)) return "";
    var items = cv.skills.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("");
    return '<div class="cv-sec"><h2>Skills</h2><ul class="cv-skills">' + items + "</ul></div>";
  }

  function secProjects(cv) {
    if (!has(cv.projects)) return "";
    var items = cv.projects.map(function (p) {
      var link = p.link ? ' - <a class="cv-link" href="' + esc(p.link) + '">' + esc(p.link) + "</a>" : "";
      return '<div class="cv-entry"><div class="title">' + esc(p.name) + "</div>"
        + (p.desc ? "<div>" + esc(p.desc) + "</div>" : "")
        + (link ? "<div>" + link + "</div>" : "") + "</div>";
    }).join("");
    return '<div class="cv-sec"><h2>Projects</h2>' + items + "</div>";
  }

  function secExperience(cv) {
    if (!has(cv.experience)) return "";
    var items = cv.experience.map(function (e) {
      var bullets = has(e.bullets) ? "<ul>" + e.bullets.map(function (b) { return "<li>" + esc(b) + "</li>"; }).join("") + "</ul>" : "";
      return '<div class="cv-entry"><div class="row"><span class="title">' + esc(e.role)
        + (e.org ? ' <span class="org">- ' + esc(e.org) + "</span>" : "")
        + '</span><span class="period">' + esc(e.period) + "</span></div>" + bullets + "</div>";
    }).join("");
    return '<div class="cv-sec"><h2>Experience</h2>' + items + "</div>";
  }

  function secEducation(cv) {
    if (!has(cv.education)) return "";
    var items = cv.education.map(function (e) {
      return '<div class="cv-entry"><div class="row"><span class="title">' + esc(e.degree)
        + (e.school ? ' <span class="org">- ' + esc(e.school) + "</span>" : "")
        + '</span><span class="period">' + esc(e.period) + "</span></div></div>";
    }).join("");
    return '<div class="cv-sec"><h2>Education</h2>' + items + "</div>";
  }

  function secCertifications(cv) {
    if (!has(cv.certifications)) return "";
    var items = cv.certifications.map(function (c) {
      var meta = [c.issuer, c.date].filter(Boolean).join(", ");
      return "<li><strong>" + esc(c.name) + "</strong>" + (meta ? " - " + esc(meta) : "") + "</li>";
    }).join("");
    return '<div class="cv-sec"><h2>Certifications</h2><ul class="cv-list">' + items + "</ul></div>";
  }

  function secLanguages(cv) {
    if (!has(cv.languages)) return "";
    var items = cv.languages.map(function (l) {
      return "<li>" + esc(l.name) + (l.level ? " - " + esc(l.level) : "") + "</li>";
    }).join("");
    return '<div class="cv-sec"><h2>Languages</h2><ul class="cv-list">' + items + "</ul></div>";
  }

  function headHtml(cv) {
    return '<div class="cv-head"><h1 class="cv-name">' + esc(cv.name || "Your Name") + "</h1>"
      + (cv.headline ? '<p class="cv-headline">' + esc(cv.headline) + "</p>" : "")
      + contactHtml(cv) + "</div>";
  }

  function bodyClassic(cv) {
    return headHtml(cv) + '<div class="cv-body">'
      + secSummary(cv) + secSkills(cv) + secProjects(cv) + secExperience(cv)
      + secEducation(cv) + secCertifications(cv) + secLanguages(cv) + "</div>";
  }

  function bodyModern(cv) {
    var side = secSkills(cv) + secLanguages(cv);
    var main = secSummary(cv) + secProjects(cv) + secExperience(cv) + secEducation(cv) + secCertifications(cv);
    return headHtml(cv) + '<div class="cv-grid"><aside class="cv-side">' + side
      + '</aside><section class="cv-main">' + main + "</section></div>";
  }

  // Returns the full self-contained HTML document string for a CV.
  function buildHtml(cvJson) {
    var cv = cvJson || {};
    var tpl = cv.templateId === "classic" ? "classic" : "modern";
    var body = tpl === "classic" ? bodyClassic(cv) : bodyModern(cv);
    var title = esc((cv.name || "CV") + " - CV");
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
      + '<meta name="viewport" content="width=device-width,initial-scale=1">'
      + "<title>" + title + "</title><style>" + CSS + "</style></head><body>"
      + '<div class="cv-toolbar"><button type="button" onclick="window.print()">Save as PDF</button>'
      + "<span>Use your browser print dialog and choose Save as PDF</span></div>"
      + '<div class="cv-page tpl-' + tpl + '">' + body + "</div></body></html>";
  }

  // Opens the rendered CV in a new print-ready tab.
  function openCv(cvJson) {
    var html = buildHtml(cvJson);
    var win = window.open("", "_blank");
    if (!win) return false;
    win.document.open();
    win.document.write(html);
    win.document.close();
    return true;
  }

  window.FundlineCV = { buildHtml: buildHtml, openCv: openCv };
})();
