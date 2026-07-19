"use strict";

const g = require("./workflow-graph.js");

function boxes(layout) {
  return layout.nodes.map((nd) => {
    const VBW = nd._vbw;
    const hw = ((nd.wPct / 100) * VBW) / 2;
    const hh = nd._hh;
    return { key: nd.key, x0: nd.vx - hw, x1: nd.vx + hw, y0: nd.vy - hh, y1: nd.vy + hh, nd };
  });
}

function parsePaths(html) {
  const m = html.match(/class="wfg-solar-flow"[^>]*>([\s\S]*?)<\/g>/);
  if (!m) return [];
  const paths = [];
  const re = /d="([^"]+)"/g;
  let x;
  while ((x = re.exec(m[1]))) paths.push(x[1]);
  return paths;
}

function samplePath(d) {
  const pts = [];
  const tokens = d.replace(/,/g, " ").trim().split(/(?=[MLC])/);
  let cx = 0;
  let cy = 0;
  tokens.forEach((tok) => {
    const t = tok.trim();
    if (!t) return;
    const cmd = t[0];
    const nums = t.slice(1).trim().split(/\s+/).map(Number).filter((n) => !isNaN(n));
    if (cmd === "M") {
      cx = nums[0];
      cy = nums[1];
      pts.push([cx, cy]);
    } else if (cmd === "L") {
      cx = nums[0];
      cy = nums[1];
      pts.push([cx, cy]);
    } else if (cmd === "C") {
      const c1x = nums[0];
      const c1y = nums[1];
      const c2x = nums[2];
      const c2y = nums[3];
      const x = nums[4];
      const y = nums[5];
      for (let i = 1; i <= 12; i++) {
        const tt = i / 12;
        const u = 1 - tt;
        const px = u * u * u * cx + 3 * u * u * tt * c1x + 3 * u * tt * tt * c2x + tt * tt * tt * x;
        const py = u * u * u * cy + 3 * u * u * tt * c1y + 3 * u * tt * tt * c2y + tt * tt * tt * y;
        pts.push([px, py]);
      }
      cx = x;
      cy = y;
    }
  });
  return pts;
}

function pointInBox(x, y, box, pad) {
  return x >= box.x0 - pad && x <= box.x1 + pad && y >= box.y0 - pad && y <= box.y1 + pad;
}

function testGraph(name, steps, flow) {
  const layout = g.buildLayout(steps, "in", "out", flow);
  const bxs = boxes(layout);
  const paths = parsePaths(layout.boardHtml);
  let hits = 0;
  const details = [];

  paths.forEach((d, pi) => {
    const pts = samplePath(d);
    // Skip first/last few samples (ports sit just outside cards)
    for (let s = 2; s < pts.length - 2; s++) {
      const x = pts[s][0];
      const y = pts[s][1];
      bxs.forEach((box) => {
        if (pointInBox(x, y, box, 1)) {
          hits++;
          if (details.length < 6) {
            details.push(name + " path" + pi + " inside " + box.key + " @ " + x.toFixed(0) + "," + y.toFixed(0));
          }
        }
      });
    }
  });

  const idxs = [...layout.boardHtml.matchAll(/data-node-idx="(\d+)"/g)].map((m) => +m[1]).sort((a, b) => a - b);
  const hub = layout.nodes.find((n) => n.hub);
  console.log(
    name + ": edges=" + layout.edges
    + " paths=" + paths.length
    + " occlusionHits=" + hits
    + " idxs=" + idxs.join(",")
    + " hub=" + (hub ? hub.key : "-")
    + " aspect=" + layout.aspect.toFixed(3)
  );
  if (details.length) console.log("  " + details.join(" | "));
  if (hits > 0) process.exitCode = 1;
  return hits;
}

testGraph("linear", [
  { serverKey: "a", name: "A", model: "m", purpose: "p" },
  { serverKey: "b", name: "B", model: "m", purpose: "p" },
  { serverKey: "c", name: "C", model: "m", purpose: "p" },
  { serverKey: "d", name: "D", model: "m", purpose: "p" },
], { a: [], b: ["a"], c: ["b"], d: ["c"] });

testGraph("diamond", [
  { serverKey: "intake", name: "Intake", model: "m", purpose: "p" },
  { serverKey: "fetch", name: "Fetch", model: "m", purpose: "p" },
  { serverKey: "news", name: "News", model: "m", purpose: "p" },
  { serverKey: "writer", name: "Writer", model: "gpt-5.6", purpose: "p" },
  { serverKey: "verifier", name: "Verifier", model: "gpt-5.6", purpose: "p" },
], {
  intake: [],
  fetch: ["intake"],
  news: ["intake"],
  writer: ["fetch", "news"],
  verifier: ["writer", "fetch"],
});

testGraph("fanin", [
  { serverKey: "code_normalizer", name: "Code Normalizer", model: "m", purpose: "p" },
  { serverKey: "logic_review", name: "Logic Review", model: "m", purpose: "p" },
  { serverKey: "security_review", name: "Security Review", model: "m", purpose: "p" },
  { serverKey: "perf_review", name: "Perf Review", model: "m", purpose: "p" },
  { serverKey: "fix_suggestions", name: "Fix Suggestions", model: "m", purpose: "p" },
  { serverKey: "formatter", name: "Formatter", model: "m", purpose: "p" },
], {
  code_normalizer: [],
  logic_review: ["code_normalizer"],
  security_review: [],
  perf_review: [],
  fix_suggestions: ["logic_review", "security_review", "perf_review"],
  formatter: ["logic_review", "security_review", "perf_review", "fix_suggestions"],
});

if (!process.exitCode) console.log("All graphs clean.");
