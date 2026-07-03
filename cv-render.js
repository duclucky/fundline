"use strict";

// Client-side CV renderer for the CV + Gig Match workflow.
// openCv(cvJson) opens a self-contained, interactive CV page in a new tab: a
// toolbar to pick one of 6 templates, switch the accent color, upload a profile
// photo (client-side only, embedded as base64, never sent to a server), and Save
// as PDF via the browser print dialog. Switching template/color/photo re-renders
// instantly and costs nothing (the model produced the content once).
// Design quality is the point (user decision 2026-06-30). See
// .claude/workflow-cv-gigmatch-spec.md section 7.
//
// The opened document embeds its own CSS + JS + the cvJson data, so it is fully
// self-contained (offline, no external requests). Text stays selectable, A4.

(function () {
  // Build the self-contained interactive CV document. cvJson is embedded as data;
  // all rendering + toolbar logic lives inside the document's inline script. The
  // inline script deliberately avoids backticks and ${ so it is safe inside this
  // outer template literal.
  function buildHtml(cvJson) {
    var data = JSON.stringify(cvJson || {});
    return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
      + "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
      + "<title>CV</title><style>" + CSS + "</style></head><body>"
      + TOOLBAR
      + "<div id=\"stage\"><div id=\"page\" class=\"cv-page\"></div></div>"
      + "<script>var CV_DATA=" + data + ";\n" + SCRIPT + "</scr" + "ipt>"
      + "</body></html>";
  }

  function openCv(cvJson) {
    var win = window.open("", "_blank");
    if (!win) return false;
    win.document.open();
    win.document.write(buildHtml(cvJson));
    win.document.close();
    return true;
  }

  var CSS = [
    ":root{--accent:#b8860b;--ink:#1d1d1f;--muted:#5c5c60;--line:#e4e0d6;--soft:#f7f4ee;--page:#fff;}",
    "*{box-sizing:border-box;}",
    "html,body{margin:0;padding:0;background:#e9e7e2;color:var(--ink);",
    " font-family:'Segoe UI',system-ui,-apple-system,'Helvetica Neue',Arial,sans-serif;",
    " font-size:13px;line-height:1.5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}",
    // toolbar
    ".bar{position:sticky;top:0;z-index:10;display:flex;flex-wrap:wrap;align-items:center;gap:14px;",
    " padding:12px 16px;background:#17161a;color:#eee;box-shadow:0 2px 12px rgba(0,0,0,.3);}",
    ".bar .grp{display:flex;align-items:center;gap:7px;}",
    ".bar .lbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#9a97a2;}",
    ".bar button.tpl{padding:6px 11px;border:1px solid #3a3842;background:#232128;color:#ddd;",
    " border-radius:7px;font:inherit;font-size:12px;cursor:pointer;}",
    ".bar button.tpl.on{background:var(--accent);border-color:var(--accent);color:#fff;font-weight:700;}",
    ".sw{width:20px;height:20px;border-radius:50%;border:2px solid #33313a;cursor:pointer;padding:0;}",
    ".sw.on{border-color:#fff;box-shadow:0 0 0 2px var(--accent);}",
    ".bar .act{padding:7px 14px;border:0;border-radius:8px;background:var(--accent);color:#fff;",
    " font:inherit;font-weight:700;font-size:12px;cursor:pointer;}",
    ".bar .ghost{background:#232128;border:1px solid #3a3842;color:#ddd;}",
    ".bar .hint{font-size:11px;color:#9a97a2;max-width:260px;}",
    "#stage{padding:22px 12px 60px;display:flex;justify-content:center;}",
    ".cv-page{width:210mm;min-height:297mm;background:var(--page);box-shadow:0 10px 44px rgba(0,0,0,.16);}",
    // shared type + sections
    ".nm{font-size:30px;font-weight:800;letter-spacing:-.02em;margin:0;}",
    ".hl{font-size:15px;font-weight:600;color:var(--accent);margin:3px 0 0;}",
    ".ct{display:flex;flex-wrap:wrap;gap:3px 14px;color:var(--muted);font-size:12px;margin-top:9px;}",
    ".ct a{color:inherit;text-decoration:none;}",
    ".sec{margin:0 0 15px;}",
    ".sec h2{font-size:11.5px;letter-spacing:.13em;text-transform:uppercase;color:var(--accent);margin:0 0 8px;}",
    ".sec p{margin:0;}",
    ".en{margin:0 0 11px;}.en:last-child{margin-bottom:0;}",
    ".en .r{display:flex;justify-content:space-between;gap:10px;}",
    ".en .t{font-weight:700;}.en .o{color:var(--muted);}.en .pd{color:var(--muted);font-size:11.5px;white-space:nowrap;}",
    ".en ul{margin:5px 0 0;padding-left:17px;}.en li{margin:2px 0;}",
    ".chips{display:flex;flex-wrap:wrap;gap:6px;list-style:none;margin:0;padding:0;}",
    ".chips li{background:var(--soft);border:1px solid var(--line);border-radius:999px;padding:3px 10px;font-size:11.5px;}",
    ".lst{list-style:none;margin:0;padding:0;}.lst li{margin:0 0 5px;}",
    ".ph{width:96px;height:96px;border-radius:50%;object-fit:cover;display:block;}",
    ".link{color:var(--accent);text-decoration:none;}",
    // template: modern (accent sidebar)
    ".tpl-modern .hd{padding:26px 28px 8px;}",
    ".tpl-modern .grid{display:grid;grid-template-columns:34% 66%;}",
    ".tpl-modern .side{background:var(--soft);padding:24px 20px;border-right:2px solid var(--accent);}",
    ".tpl-modern .side .sec h2{border-bottom:1px solid var(--line);padding-bottom:4px;}",
    ".tpl-modern .main{padding:22px 26px;}",
    ".tpl-modern .ph{margin:0 auto 14px;}",
    // template: compact (dense sidebar, tinted)
    ".tpl-compact{font-size:12px;}",
    ".tpl-compact .grid{display:grid;grid-template-columns:32% 68%;}",
    ".tpl-compact .side{background:var(--ink);color:#f2f2f2;padding:24px 18px;}",
    ".tpl-compact .side .sec h2{color:#fff;opacity:.85;}",
    ".tpl-compact .side .chips li{background:rgba(255,255,255,.12);border-color:rgba(255,255,255,.2);color:#fff;}",
    ".tpl-compact .side .ct{color:#d8d6de;}",
    ".tpl-compact .main{padding:22px 24px;}",
    ".tpl-compact .nm{color:#fff;}.tpl-compact .side .hl{color:#fff;opacity:.9;}",
    ".tpl-compact .ph{margin:0 auto 12px;border:3px solid rgba(255,255,255,.25);}",
    // template: band (top accent band)
    ".tpl-band .band{background:var(--accent);color:#fff;padding:26px 30px;display:flex;align-items:center;gap:20px;}",
    ".tpl-band .band .nm,.tpl-band .band .hl{color:#fff;}",
    ".tpl-band .band .hl{opacity:.92;}",
    ".tpl-band .band .ct{color:rgba(255,255,255,.9);}",
    ".tpl-band .band .ct a{color:#fff;}",
    ".tpl-band .ph{width:84px;height:84px;border:3px solid rgba(255,255,255,.5);}",
    ".tpl-band .body{padding:24px 30px;}",
    ".tpl-band .sec h2{border-bottom:2px solid var(--line);padding-bottom:5px;}",
    // template: classic (centered, traditional)
    ".tpl-classic .hd{text-align:center;padding:32px 40px 16px;border-bottom:2px solid var(--accent);}",
    ".tpl-classic .ct{justify-content:center;}",
    ".tpl-classic .ph{margin:0 auto 12px;}",
    ".tpl-classic .body{padding:22px 44px 44px;}",
    ".tpl-classic .sec h2{text-align:center;letter-spacing:.16em;}",
    // template: minimal (airy, no color blocks)
    ".tpl-minimal{--accent:#222;}",
    ".tpl-minimal .hd{padding:40px 46px 10px;}",
    ".tpl-minimal .nm{font-weight:700;font-size:34px;}",
    ".tpl-minimal .hl{color:var(--muted);font-weight:500;}",
    ".tpl-minimal .body{padding:14px 46px 46px;}",
    ".tpl-minimal .sec h2{color:var(--muted);border-bottom:1px solid var(--line);padding-bottom:6px;}",
    ".tpl-minimal .chips li{background:transparent;border-color:var(--line);}",
    ".tpl-minimal .ph{margin-bottom:14px;}",
    // template: elegant (left accent rule)
    ".tpl-elegant .hd{padding:34px 40px 12px;border-left:5px solid var(--accent);}",
    ".tpl-elegant .body{padding:20px 40px 44px;}",
    ".tpl-elegant .sec{border-left:5px solid var(--soft);padding-left:16px;}",
    ".tpl-elegant .sec h2{margin-left:-16px;}",
    ".tpl-elegant .ph{width:110px;height:110px;margin-bottom:14px;}",
    "@media print{html,body{background:#fff;}.bar{display:none;}#stage{padding:0;}",
    " .cv-page{width:auto;min-height:auto;box-shadow:none;}@page{size:A4;margin:11mm;}}",
  ].join("\n");

  var TOOLBAR = [
    "<div class=\"bar\">",
    "  <div class=\"grp\"><span class=\"lbl\">Template</span><span id=\"tpls\"></span></div>",
    "  <div class=\"grp\"><span class=\"lbl\">Color</span><span id=\"accents\"></span></div>",
    "  <div class=\"grp\">",
    "    <input type=\"file\" id=\"photo\" accept=\"image/*\" style=\"display:none\">",
    "    <button class=\"act ghost\" id=\"upload\" type=\"button\">Upload photo</button>",
    "    <button class=\"act ghost\" id=\"rmphoto\" type=\"button\" hidden>Remove photo</button>",
    "  </div>",
    "  <span class=\"hint\" style=\"margin-left:auto\">Tip: in the dialog pick \"Save as PDF\" and click Print</span>",
    "  <button class=\"act\" id=\"save\" type=\"button\">Print PDF to Your Computer</button>",
    "</div>",
  ].join("\n");

  // Inline script for the opened document. No backticks, no ${ (kept safe for the
  // outer template literal). Builds the CV from CV_DATA for the chosen template.
  var SCRIPT = [
    "var PHOTO='';",
    "var TPL=(CV_DATA.templateId==='classic'||CV_DATA.templateId==='minimal'||CV_DATA.templateId==='band'||CV_DATA.templateId==='compact'||CV_DATA.templateId==='elegant')?CV_DATA.templateId:'modern';",
    "var ACC='#b8860b';",
    "var TPLS=[['modern','Modern'],['classic','Classic'],['minimal','Minimal'],['band','Header'],['compact','Compact'],['elegant','Elegant']];",
    "var ACCENTS=[['Gold','#b8860b'],['Navy','#1f3a5f'],['Teal','#0f766e'],['Burgundy','#7c2d3a'],['Slate','#334155'],['Forest','#14532d']];",
    "function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;');}",
    "function has(a){return Array.isArray(a)&&a.length>0;}",
    "function photoTag(){return PHOTO?('<img class=\"ph\" src=\"'+PHOTO+'\" alt=\"\">'):'';}",
    "function contact(){var c=CV_DATA.contact||{};var b=[];",
    " if(c.email)b.push('<a href=\"mailto:'+esc(c.email)+'\">'+esc(c.email)+'</a>');",
    " if(c.phone)b.push('<span>'+esc(c.phone)+'</span>');",
    " if(c.website)b.push('<a href=\"'+esc(c.website)+'\">'+esc(c.website)+'</a>');",
    " if(CV_DATA.location)b.push('<span>'+esc(CV_DATA.location)+'</span>');",
    " (CV_DATA.profiles||[]).forEach(function(p){if(p&&p.url)b.push('<a href=\"'+esc(p.url)+'\">'+esc(p.network||p.url)+'</a>');});",
    " return b.length?('<div class=\"ct\">'+b.join('')+'</div>'):'';}",
    "function sSummary(){return CV_DATA.summary?('<div class=\"sec\"><h2>Summary</h2><p>'+esc(CV_DATA.summary)+'</p></div>'):'';}",
    "function sSkills(){if(!has(CV_DATA.skills))return '';return '<div class=\"sec\"><h2>Skills</h2><ul class=\"chips\">'+CV_DATA.skills.map(function(s){return '<li>'+esc(s)+'</li>';}).join('')+'</ul></div>';}",
    "function sProjects(){if(!has(CV_DATA.projects))return '';return '<div class=\"sec\"><h2>Projects</h2>'+CV_DATA.projects.map(function(p){var l=p.link?('<div><a class=\"link\" href=\"'+esc(p.link)+'\">'+esc(p.link)+'</a></div>'):'';return '<div class=\"en\"><div class=\"t\">'+esc(p.name)+'</div>'+(p.desc?('<div>'+esc(p.desc)+'</div>'):'')+l+'</div>';}).join('')+'</div>';}",
    "function sExp(){if(!has(CV_DATA.experience))return '';return '<div class=\"sec\"><h2>Experience</h2>'+CV_DATA.experience.map(function(e){var bl=has(e.bullets)?('<ul>'+e.bullets.map(function(b){return '<li>'+esc(b)+'</li>';}).join('')+'</ul>'):'';return '<div class=\"en\"><div class=\"r\"><span class=\"t\">'+esc(e.role)+(e.org?(' <span class=\"o\">- '+esc(e.org)+'</span>'):'')+'</span><span class=\"pd\">'+esc(e.period)+'</span></div>'+bl+'</div>';}).join('')+'</div>';}",
    "function sEdu(){if(!has(CV_DATA.education))return '';return '<div class=\"sec\"><h2>Education</h2>'+CV_DATA.education.map(function(e){return '<div class=\"en\"><div class=\"r\"><span class=\"t\">'+esc(e.degree)+(e.school?(' <span class=\"o\">- '+esc(e.school)+'</span>'):'')+'</span><span class=\"pd\">'+esc(e.period)+'</span></div></div>';}).join('')+'</div>';}",
    "function sCerts(){if(!has(CV_DATA.certifications))return '';return '<div class=\"sec\"><h2>Certifications</h2><ul class=\"lst\">'+CV_DATA.certifications.map(function(c){var m=[c.issuer,c.date].filter(Boolean).join(', ');return '<li><strong>'+esc(c.name)+'</strong>'+(m?(' - '+esc(m)):'')+'</li>';}).join('')+'</ul></div>';}",
    "function sLangs(){if(!has(CV_DATA.languages))return '';return '<div class=\"sec\"><h2>Languages</h2><ul class=\"lst\">'+CV_DATA.languages.map(function(l){return '<li>'+esc(l.name)+(l.level?(' - '+esc(l.level)):'')+'</li>';}).join('')+'</ul></div>';}",
    "function head(showPhoto){return '<div class=\"hd\">'+(showPhoto?photoTag():'')+'<h1 class=\"nm\">'+esc(CV_DATA.name||'Your Name')+'</h1>'+(CV_DATA.headline?('<p class=\"hl\">'+esc(CV_DATA.headline)+'</p>'):'')+contact()+'</div>';}",
    "function layoutSidebar(){var side=photoTag()+contact()+sSkills()+sLangs()+sCerts();var main=sSummary()+sProjects()+sExp()+sEdu();return '<div class=\"hd\"><h1 class=\"nm\">'+esc(CV_DATA.name||'Your Name')+'</h1>'+(CV_DATA.headline?('<p class=\"hl\">'+esc(CV_DATA.headline)+'</p>'):'')+'</div><div class=\"grid\"><aside class=\"side\">'+side+'</aside><section class=\"main\">'+main+'</section></div>';}",
    "function layoutSingle(showPhoto){return head(showPhoto)+'<div class=\"body\">'+sSummary()+sSkills()+sProjects()+sExp()+sEdu()+sCerts()+sLangs()+'</div>';}",
    "function layoutBand(){return '<div class=\"band\">'+photoTag()+'<div><h1 class=\"nm\">'+esc(CV_DATA.name||'Your Name')+'</h1>'+(CV_DATA.headline?('<p class=\"hl\">'+esc(CV_DATA.headline)+'</p>'):'')+contact()+'</div></div><div class=\"body\">'+sSummary()+sSkills()+sProjects()+sExp()+sEdu()+sCerts()+sLangs()+'</div>';}",
    "function bodyFor(t){if(t==='modern'||t==='compact')return layoutSidebar();if(t==='band')return layoutBand();if(t==='classic')return layoutSingle(true);if(t==='elegant')return layoutSingle(true);return layoutSingle(false);}",
    "function render(){var pg=document.getElementById('page');pg.className='cv-page tpl-'+TPL;pg.style.setProperty('--accent',ACC);pg.innerHTML=bodyFor(TPL);",
    " var tb=document.querySelectorAll('#tpls button');for(var i=0;i<tb.length;i++){tb[i].className='tpl'+(tb[i].getAttribute('data-t')===TPL?' on':'');}",
    " var ab=document.querySelectorAll('#accents button');for(var j=0;j<ab.length;j++){ab[j].className='sw'+(ab[j].getAttribute('data-c')===ACC?' on':'');ab[j].style.background=ab[j].getAttribute('data-c');}",
    " document.getElementById('rmphoto').hidden=!PHOTO;}",
    "function buildToolbar(){var t=document.getElementById('tpls');t.innerHTML=TPLS.map(function(x){return '<button class=\"tpl\" data-t=\"'+x[0]+'\">'+x[1]+'</button>';}).join(' ');",
    " t.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;TPL=b.getAttribute('data-t');render();});",
    " var a=document.getElementById('accents');a.innerHTML=ACCENTS.map(function(x){return '<button class=\"sw\" data-c=\"'+x[1]+'\" title=\"'+x[0]+'\"></button>';}).join(' ');",
    " a.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;ACC=b.getAttribute('data-c');render();});",
    " document.getElementById('upload').addEventListener('click',function(){document.getElementById('photo').click();});",
    " document.getElementById('photo').addEventListener('change',function(e){var f=e.target.files&&e.target.files[0];if(!f)return;var r=new FileReader();r.onload=function(){PHOTO=r.result;render();};r.readAsDataURL(f);});",
    " document.getElementById('rmphoto').addEventListener('click',function(){PHOTO='';document.getElementById('photo').value='';render();});",
    " document.getElementById('save').addEventListener('click',function(){window.print();});}",
    "buildToolbar();render();",
  ].join("\n");

  window.FundlineCV = { buildHtml: buildHtml, openCv: openCv };
})();
