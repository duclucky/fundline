"use strict";

// Layered DAG layout for Fundline workflow steps.
// Vanilla JS only: Sugiyama-style layering + barycenter ordering + occlusion-aware
// orthogonal edge routing. Renders absolutely-positioned node cards + an SVG edge layer.

(function (global) {
  var _layoutUid = 0;

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function wfgNodeIcon(type) {
    if (type === "hub") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4z" fill="currentColor"/><circle cx="18.5" cy="18.5" r="2" fill="currentColor"/></svg>';
    }
    if (type === "input") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M5 20c0-3.87 3.13-7 7-7s7 3.13 7 7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
    }
    if (type === "output") {
      return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 12l2 2 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><rect x="3" y="3" width="18" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
    }
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="8" width="18" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 8V6a4 4 0 0 1 8 0v2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="9" cy="13.5" r="1" fill="currentColor"/><circle cx="15" cy="13.5" r="1" fill="currentColor"/></svg>';
  }

  // ── Public: render a positioned node card ──────────────────────────────────
  function renderNode(node) {
    var cls = node.hub ? "wfg2-node--hub"
      : node.type === "input" ? "wfg2-node--input wfg2-node--io"
      : node.type === "output" ? "wfg2-node--output wfg2-node--io"
      : "wfg2-node--ai";
    var step = node.hub ? "FINAL MODEL"
      : node.type === "input" ? "INPUT"
      : node.type === "output" ? "OUTPUT"
      : "STEP " + String(node.stepNum).padStart(2, "0");
    var model = node.model ? '<span class="wfg2-model">' + esc(node.model) + "</span>" : "";
    var iconType = node.hub ? "hub" : node.type;
    var tip = (node.purpose || node.model)
      ? '<span class="wfg2-tip">'
        + (node.model ? '<span class="wfg2-tip-model">' + esc(node.model) + "</span>" : "")
        + (node.purpose ? esc(node.purpose) : "")
        + "</span>"
      : "";
    var state = '<span class="wfg2-state">'
      + '<span class="wfg2-state-dot"></span>'
      + '<span class="wfg2-check"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6L9 17l-5-5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span>'
      + "</span>";
    var w = node.wPct ? "width:" + node.wPct.toFixed(2) + "%;" : "";
    return '<div class="wfg2-node ' + cls + '" data-node-idx="' + node.idx + '" style="left:'
      + node.xPct.toFixed(2) + "%;top:" + node.yPct.toFixed(2) + "%;" + w + '">'
      + '<div class="wfg2-node-top">'
      + '<span class="wfg2-ico">' + wfgNodeIcon(iconType) + "</span>"
      + '<span class="wfg2-step">' + step + "</span>"
      + state
      + "</div>"
      + '<div class="wfg2-name">' + esc(node.name) + "</div>"
      + model
      + tip
      + "</div>";
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────

  function halfW(nd) {
    return (((nd.wPct || 40) / 100) * nd._vbw) / 2;
  }

  function halfH(nd) {
    return nd._hh;
  }

  // Liang-Barsky clip of segment (ax,ay)-(bx,by) against padded node box.
  // Returns [t0, t1] of the interior sub-interval, or null if no hit.
  function clipSeg(ax, ay, bx, by, nd, pad) {
    var rx0 = nd.vx - halfW(nd) - pad;
    var rx1 = nd.vx + halfW(nd) + pad;
    var ry0 = nd.vy - halfH(nd) - pad;
    var ry1 = nd.vy + halfH(nd) + pad;
    var t0 = 0;
    var t1 = 1;
    var dx = bx - ax;
    var dy = by - ay;
    var p = [-dx, dx, -dy, dy];
    var q = [ax - rx0, rx1 - ax, ay - ry0, ry1 - ay];
    for (var i = 0; i < 4; i++) {
      if (p[i] === 0) {
        if (q[i] < 0) return null;
      } else {
        var t = q[i] / p[i];
        if (p[i] < 0) {
          if (t > t1) return null;
          if (t > t0) t0 = t;
        } else {
          if (t < t0) return null;
          if (t < t1) t1 = t;
        }
      }
    }
    return t0 <= t1 ? [t0, t1] : null;
  }

  function segHitsNode(ax, ay, bx, by, nd, pad) {
    return clipSeg(ax, ay, bx, by, nd, pad) != null;
  }

  function polylineHitsAny(pts, nodes, a, b, pad) {
    for (var s = 0; s < pts.length - 1; s++) {
      var x0 = pts[s][0];
      var y0 = pts[s][1];
      var x1 = pts[s + 1][0];
      var y1 = pts[s + 1][1];
      // Skip zero-length stubs
      if (Math.abs(x1 - x0) < 0.01 && Math.abs(y1 - y0) < 0.01) continue;
      for (var i = 0; i < nodes.length; i++) {
        var nd = nodes[i];
        if (nd === a || nd === b) continue;
        if (segHitsNode(x0, y0, x1, y1, nd, pad)) return true;
      }
    }
    return false;
  }

  function pathFromPoints(pts) {
    var d = "M" + pts[0][0].toFixed(1) + " " + pts[0][1].toFixed(1);
    for (var i = 1; i < pts.length; i++) {
      d += "L" + pts[i][0].toFixed(1) + " " + pts[i][1].toFixed(1);
    }
    return '<path d="' + d + '" />';
  }

  function curvePath(sx, sy, tx, ty) {
    var dx = tx - sx;
    var c1x = sx + dx * 0.42;
    var c2x = sx + dx * 0.58;
    return '<path d="M' + sx.toFixed(1) + " " + sy.toFixed(1)
      + "C" + c1x.toFixed(1) + " " + sy.toFixed(1) + ","
      + c2x.toFixed(1) + " " + ty.toFixed(1) + ","
      + tx.toFixed(1) + " " + ty.toFixed(1) + '" />';
  }

  // Sample a cubic for occlusion testing.
  function curveHitsAny(sx, sy, tx, ty, nodes, a, b, pad) {
    var dx = tx - sx;
    var c1x = sx + dx * 0.42;
    var c2x = sx + dx * 0.58;
    var prevX = sx;
    var prevY = sy;
    var steps = 12;
    for (var i = 1; i <= steps; i++) {
      var t = i / steps;
      var u = 1 - t;
      var x = u * u * u * sx + 3 * u * u * t * c1x + 3 * u * t * t * c2x + t * t * t * tx;
      var y = u * u * u * sy + 3 * u * u * t * sy + 3 * u * t * t * ty + t * t * t * ty;
      for (var n = 0; n < nodes.length; n++) {
        var nd = nodes[n];
        if (nd === a || nd === b) continue;
        if (segHitsNode(prevX, prevY, x, y, nd, pad)) return true;
      }
      prevX = x;
      prevY = y;
    }
    return false;
  }

  // ── Transitive reduction ───────────────────────────────────────────────────

  function buildSucc(stepNodes, stepDeps, byKey) {
    var succ = {};
    stepNodes.forEach(function (sn) { succ[sn.key] = []; });
    stepNodes.forEach(function (sn) {
      stepDeps(sn.key).forEach(function (d) {
        if (succ[d]) succ[d].push(sn.key);
      });
    });
    return succ;
  }

  function makeRedundantChecker(succ) {
    var reachMemo = {};
    function reaches(a, b) {
      var mk = a + ">" + b;
      if (reachMemo[mk] != null) return reachMemo[mk];
      reachMemo[mk] = false;
      var kids = succ[a] || [];
      for (var i = 0; i < kids.length; i++) {
        var w = kids[i];
        if (w === b || reaches(w, b)) {
          reachMemo[mk] = true;
          break;
        }
      }
      return reachMemo[mk];
    }
    return function redundant(d, s) {
      var kids = succ[d] || [];
      for (var i = 0; i < kids.length; i++) {
        if (kids[i] !== s && reaches(kids[i], s)) return true;
      }
      return false;
    };
  }

  // ── Core layout ────────────────────────────────────────────────────────────

  /**
   * buildLayout(steps, inputHint, outputHint, flow)
   * Returns { nodes, total, boardHtml, aspect, edges }
   *
   * Algorithm (Sugiyama-inspired, pure JS):
   * 1. Layering: longest-path (ASAP) depth from INPUT; optional ALAP pull toward
   *    earliest consumer so multi-hop edges shrink when safe.
   * 2. Ordering: multi-sweep barycenter (forward + backward) to minimize crossings.
   * 3. Placement: column X by layer, even vertical spread, centered per column.
   * 4. Edges: transitive reduction; prefer gentle cubic right-to-left ports; if the
   *    path would pass under a card, route orthogonal detours through free horizontal
   *    channels with dedicated lanes so detours never share a stroke.
   * 5. Endpoints clipped with a visible gap; plain strokes only (no arrowheads).
   */
  function buildLayout(steps, inputHint, outputHint, flow) {
    steps = steps || [];
    flow = flow || {};
    var n = steps.length;
    var uid = ++_layoutUid;

    // Hub = last step, unless last is a post-synthesis verifier.
    var hubStep = n;
    if (n > 1 && steps[n - 1] && steps[n - 1].serverKey === "verifier") hubStep = n - 1;

    var inputNode = {
      type: "input", idx: 0, key: "__input",
      name: "User Input", purpose: inputHint || "Your prompt or instructions"
    };
    var outputNode = {
      type: "output", idx: n + 1, key: "__output",
      name: "Final Output", purpose: outputHint || "Ready to use result"
    };
    var stepNodes = steps.map(function (s, i) {
      return {
        type: "ai",
        idx: i + 1,
        stepNum: i + 1,
        key: s.serverKey,
        name: s.name,
        model: s.model,
        purpose: s.purpose,
        hub: (i + 1) === hubStep
      };
    });
    var nodes = [inputNode].concat(stepNodes, [outputNode]);
    var total = nodes.length;

    var byKey = {};
    stepNodes.forEach(function (sn) { byKey[sn.key] = sn; });
    function stepDeps(key) {
      return (flow[key] || []).filter(function (d) { return byKey[d]; });
    }

    var succ = buildSucc(stepNodes, stepDeps, byKey);
    var isRedundant = makeRedundantChecker(succ);

    // ── 1. ASAP depth (longest path from INPUT) ──────────────────────────────
    function depthOf(key) {
      var sn = byKey[key];
      if (!sn) return 0;
      if (sn._d != null) return sn._d;
      sn._d = -1; // cycle guard
      var ds = stepDeps(key);
      if (!ds.length) {
        sn._d = 1;
      } else {
        var mx = 0;
        for (var i = 0; i < ds.length; i++) {
          var dd = depthOf(ds[i]);
          if (dd > mx) mx = dd;
        }
        sn._d = 1 + mx;
      }
      return sn._d;
    }
    stepNodes.forEach(function (sn) { depthOf(sn.key); });
    var maxAsap = stepNodes.length ? Math.max.apply(null, stepNodes.map(function (sn) { return sn._d; })) : 1;
    if (!isFinite(maxAsap) || maxAsap < 1) maxAsap = 1;

    // ── 1b. ALAP: pull each node right toward its earliest consumer ───────────
    // Keeps long skip edges short. Nodes with no step-successors stay at ASAP
    // (sinks sit next to the final column). Clamp to ASAP so order is preserved.
    stepNodes.slice().sort(function (a, b) { return b._d - a._d; }).forEach(function (sn) {
      var cs = succ[sn.key] || [];
      if (!cs.length) {
        sn._col = sn._d;
        return;
      }
      var minC = Infinity;
      for (var i = 0; i < cs.length; i++) {
        var csn = byKey[cs[i]];
        if (csn && csn._col != null && csn._col < minC) minC = csn._col;
      }
      if (!isFinite(minC)) minC = sn._d + 1;
      sn._col = Math.max(sn._d, minC - 1);
    });

    // Prefer ASAP for pure sources that would otherwise jump right and create
    // long INPUT-spanning edges under intermediate cards. Only ALAP-pull a pure
    // source if every consumer is in the next column (edge length 1 after pull).
    stepNodes.forEach(function (sn) {
      if (stepDeps(sn.key).length > 0) return;
      var cs = succ[sn.key] || [];
      if (!cs.length) {
        sn._col = sn._d;
        return;
      }
      var minCons = Infinity;
      for (var i = 0; i < cs.length; i++) {
        var csn = byKey[cs[i]];
        if (csn && csn._col < minCons) minCons = csn._col;
      }
      // Keep at ASAP (usually 1) unless ALAP lands adjacent to all consumers.
      if (minCons - sn._d > 1) sn._col = sn._d;
    });

    var maxCol = stepNodes.length ? Math.max.apply(null, stepNodes.map(function (sn) { return sn._col; })) : 1;
    if (!isFinite(maxCol) || maxCol < 1) maxCol = 1;
    var totalCols = maxCol + 2; // INPUT=0, steps=1..maxCol, OUTPUT=maxCol+1

    // ── 2. Column buckets + barycenter ordering ──────────────────────────────
    var cols = {};
    for (var c = 1; c <= maxCol; c++) cols[c] = [];
    stepNodes.forEach(function (sn) {
      if (!cols[sn._col]) cols[sn._col] = [];
      cols[sn._col].push(sn);
    });

    // Stable initial order: definition order (stepNum).
    Object.keys(cols).forEach(function (ck) {
      cols[ck].sort(function (a, b) { return a.stepNum - b.stepNum; });
      cols[ck].forEach(function (sn, i) { sn._ord = i; });
    });

    // Fractional rank in [0,1] within a column so single-node columns contribute
    // a meaningful mid value (0.5) instead of always 0.
    function fracRank(sn) {
      if (!sn) return 0.5;
      if (sn.type === "input" || sn.type === "output") return 0.5;
      var arr = cols[sn._col];
      if (!arr || arr.length <= 1) return 0.5;
      return sn._ord / (arr.length - 1);
    }
    function predFracs(sn) {
      var ds = stepDeps(sn.key);
      if (!ds.length) return [0.5]; // INPUT
      var ranks = [];
      for (var i = 0; i < ds.length; i++) {
        var p = byKey[ds[i]];
        if (p) ranks.push(fracRank(p));
      }
      return ranks.length ? ranks : [0.5];
    }
    function succFracs(sn) {
      var cs = succ[sn.key] || [];
      if (!cs.length) return [0.5]; // OUTPUT / sink
      var ranks = [];
      for (var i = 0; i < cs.length; i++) {
        var s = byKey[cs[i]];
        if (s) ranks.push(fracRank(s));
      }
      return ranks.length ? ranks : [0.5];
    }
    function bary(ranks) {
      var sum = 0;
      for (var i = 0; i < ranks.length; i++) sum += ranks[i];
      return sum / ranks.length;
    }

    // Multi-sweep barycenter with fractional ranks (crossing reduction).
    var SWEEPS = 12;
    for (var sweep = 0; sweep < SWEEPS; sweep++) {
      if (sweep % 2 === 0) {
        for (var cF = 1; cF <= maxCol; cF++) {
          var arrF = cols[cF];
          if (!arrF || arrF.length < 2) continue;
          arrF.forEach(function (sn) { sn._bc = bary(predFracs(sn)); });
          arrF.sort(function (a, b) {
            if (a._bc !== b._bc) return a._bc - b._bc;
            return a.stepNum - b.stepNum;
          });
          arrF.forEach(function (sn, i) { sn._ord = i; });
        }
      } else {
        for (var cB = maxCol; cB >= 1; cB--) {
          var arrB = cols[cB];
          if (!arrB || arrB.length < 2) continue;
          arrB.forEach(function (sn) { sn._bc = bary(succFracs(sn)); });
          arrB.sort(function (a, b) {
            if (a._bc !== b._bc) return a._bc - b._bc;
            return a.stepNum - b.stepNum;
          });
          arrB.forEach(function (sn, i) { sn._ord = i; });
        }
      }
    }

    // ── 3. Coordinates ───────────────────────────────────────────────────────
    var maxRows = 1;
    Object.keys(cols).forEach(function (ck) {
      if (cols[ck].length > maxRows) maxRows = cols[ck].length;
    });

    // Card geometry in viewBox units. Wider columns when few layers so cards breathe.
    var COLW = maxRows >= 4 ? 118 : (totalCols <= 5 ? 128 : 112);
    var ROWH = maxRows >= 4 ? 118 : 130;
    var CARD_HH = 42;       // half-height used for collision + ports
    var HUB_HH = 48;
    var IO_HH = 36;
    var MARGIN_Y = 36;      // outer channel reserve above / below node band
    var LANE_GAP = 10;      // vertical spacing between detour lanes

    var VBW = totalCols * COLW;
    var VBH = Math.max(ROWH, (maxRows - 1) * ROWH + 2 * MARGIN_Y + 2 * CARD_HH);
    // Ensure room for a few top/bottom lanes
    VBH = Math.max(VBH, maxRows * ROWH + 2 * MARGIN_Y);

    function colX(col) {
      return (col + 0.5) * COLW;
    }

    inputNode.vx = colX(0);
    inputNode.vy = VBH / 2;
    inputNode._col = 0;
    outputNode.vx = colX(maxCol + 1);
    outputNode.vy = VBH / 2;
    outputNode._col = maxCol + 1;

    function meanPredY(sn) {
      var ds = stepDeps(sn.key);
      if (!ds.length) return inputNode.vy;
      var sum = 0;
      var cnt = 0;
      for (var i = 0; i < ds.length; i++) {
        var p = byKey[ds[i]];
        if (p && p.vy != null) { sum += p.vy; cnt++; }
      }
      return cnt ? sum / cnt : VBH / 2;
    }
    function meanSuccY(sn) {
      var cs = succ[sn.key] || [];
      if (!cs.length) return outputNode.vy;
      var sum = 0;
      var cnt = 0;
      for (var i = 0; i < cs.length; i++) {
        var s = byKey[cs[i]];
        if (s && s.vy != null) { sum += s.vy; cnt++; }
      }
      return cnt ? sum / cnt : VBH / 2;
    }
    function preferredY(sn, usePred) {
      return usePred ? meanPredY(sn) : meanSuccY(sn);
    }

    // Pack a column: multi-node stacks with ROWH spacing, centered on the mean of
    // each node's preferred Y so the block drifts toward its neighbors instead of
    // always sitting in the vertical middle of the board.
    function placeColumn(cP, usePred) {
      var arrP = cols[cP] || [];
      var k = arrP.length;
      if (!k) return;
      for (var i0 = 0; i0 < k; i0++) arrP[i0].vx = colX(cP);

      if (k === 1) {
        var ideal = preferredY(arrP[0], usePred);
        // Blend with board center so extreme singles do not pin to the edge.
        arrP[0].vy = ideal * 0.72 + (VBH / 2) * 0.28;
        arrP[0]._ord = 0;
        return;
      }

      var prefs = arrP.map(function (sn) { return preferredY(sn, usePred); });
      var meanPref = prefs.reduce(function (a, b) { return a + b; }, 0) / k;
      var blockH = (k - 1) * ROWH;
      var first = meanPref - blockH / 2;
      // Clamp so the stack stays inside the board margins.
      var minFirst = MARGIN_Y + CARD_HH * 0.3;
      var maxFirst = VBH - MARGIN_Y - CARD_HH * 0.3 - blockH;
      if (first < minFirst) first = minFirst;
      if (first > maxFirst) first = maxFirst;
      for (var iP = 0; iP < k; iP++) {
        arrP[iP].vy = first + iP * ROWH;
        arrP[iP]._ord = iP;
      }
    }

    // Seed positions (board-centered stacks) before neighbor-aware passes.
    for (var cP = 1; cP <= maxCol; cP++) {
      var arrSeed = cols[cP] || [];
      var kS = arrSeed.length;
      var firstS = (VBH - (kS - 1) * ROWH) / 2;
      for (var iS = 0; iS < kS; iS++) {
        arrSeed[iS].vx = colX(cP);
        arrSeed[iS].vy = firstS + iS * ROWH;
        arrSeed[iS]._ord = iS;
      }
    }

    // Coordinate-level barycenter fine-tune: reorder by mean neighbor Y and re-pack.
    for (var ySweep = 0; ySweep < 8; ySweep++) {
      var usePred = (ySweep % 2 === 0);
      if (usePred) {
        for (var cY = 1; cY <= maxCol; cY++) {
          var aY = cols[cY];
          if (!aY || !aY.length) continue;
          if (aY.length >= 2) {
            aY.forEach(function (sn) { sn._bc = meanPredY(sn); });
            aY.sort(function (a, b) {
              if (a._bc !== b._bc) return a._bc - b._bc;
              return a.stepNum - b.stepNum;
            });
          }
          placeColumn(cY, true);
        }
      } else {
        for (var cZ = maxCol; cZ >= 1; cZ--) {
          var aZ = cols[cZ];
          if (!aZ || !aZ.length) continue;
          if (aZ.length >= 2) {
            aZ.forEach(function (sn) { sn._bc = meanSuccY(sn); });
            aZ.sort(function (a, b) {
              if (a._bc !== b._bc) return a._bc - b._bc;
              return a.stepNum - b.stepNum;
            });
          }
          placeColumn(cZ, false);
        }
      }
    }

    // Final singleton alignment: nodes alone in a column snap onto exclusive
    // neighbors so A -> B chains share a row when either side is free to move.
    (function alignSingletons() {
      function clampY(y) {
        return Math.max(MARGIN_Y + CARD_HH, Math.min(VBH - MARGIN_Y - CARD_HH, y));
      }
      for (var iter = 0; iter < 8; iter++) {
        for (var cA = 1; cA <= maxCol; cA++) {
          var arr = cols[cA];
          if (!arr || arr.length !== 1) continue;
          var sn = arr[0];
          var ds = stepDeps(sn.key);
          var cs = succ[sn.key] || [];

          // Strong preference: if exactly one predecessor, align to it (exclusive
          // parent chain). Otherwise average all neighbors.
          var y;
          if (ds.length === 1 && byKey[ds[0]]) {
            y = byKey[ds[0]].vy;
            // Soft-pull toward single successor so fan-in hubs stay readable.
            if (cs.length === 1 && byKey[cs[0]]) {
              y = y * 0.75 + byKey[cs[0]].vy * 0.25;
            }
          } else if (cs.length === 1 && byKey[cs[0]] && !ds.length) {
            y = byKey[cs[0]].vy;
          } else {
            var vals = [];
            ds.forEach(function (d) {
              if (byKey[d]) vals.push(byKey[d].vy);
            });
            cs.forEach(function (s) {
              if (byKey[s]) vals.push(byKey[s].vy);
            });
            if (!vals.length) continue;
            var sum = 0;
            vals.forEach(function (v) { sum += v; });
            y = sum / vals.length;
          }
          sn.vy = clampY(y);
        }
      }
    })();

    // Align INPUT/OUTPUT y with average of connected step ports when helpful.
    (function refineIO() {
      var inTargets = stepNodes.filter(function (sn) {
        return stepDeps(sn.key).length === 0;
      });
      if (inTargets.length) {
        var sy = 0;
        inTargets.forEach(function (t) { sy += t.vy; });
        inputNode.vy = sy / inTargets.length;
      }
      var sinks = stepNodes.filter(function (sn) {
        return !(succ[sn.key] && succ[sn.key].length);
      });
      if (sinks.length) {
        var oy = 0;
        sinks.forEach(function (t) { oy += t.vy; });
        outputNode.vy = oy / sinks.length;
      }
    })();

    var workerWpct = (COLW * 0.78) / VBW * 100;
    var hubWpct = (COLW * 0.92) / VBW * 100;
    var ioWpct = (COLW * 0.64) / VBW * 100;

    nodes.forEach(function (nd) {
      nd._vbw = VBW;
      nd._hh = nd.hub ? HUB_HH : (nd.type === "ai" ? CARD_HH : IO_HH);
      nd.xPct = (nd.vx / VBW) * 100;
      nd.yPct = (nd.vy / VBH) * 100;
      nd.wPct = nd.hub ? hubWpct : (nd.type === "ai" ? workerWpct : ioWpct);
    });

    // ── 4. Edge list (transitive reduction) ──────────────────────────────────
    var edgeList = []; // {a, b}
    var dependedOn = {};
    stepNodes.forEach(function (sn) {
      stepDeps(sn.key).forEach(function (d) { dependedOn[d] = true; });
    });

    stepNodes.forEach(function (sn) {
      var ds = stepDeps(sn.key).filter(function (d) { return !isRedundant(d, sn.key); });
      if (!ds.length) {
        edgeList.push({ a: inputNode, b: sn });
      } else {
        ds.forEach(function (d) { edgeList.push({ a: byKey[d], b: sn }); });
      }
    });
    // Sinks feed OUTPUT. Prefer routing through the hub when it is a sink; otherwise
    // every true sink connects to OUTPUT (handles verifier-after-hub).
    stepNodes.forEach(function (sn) {
      if (!dependedOn[sn.key]) edgeList.push({ a: sn, b: outputNode });
    });
    if (!stepNodes.length) edgeList.push({ a: inputNode, b: outputNode });

    // ── 5. Free horizontal channels between node rows ────────────────────────
    // Build sorted unique node y positions, then place channels in the mid-gaps
    // plus outer top/bottom bands for long detours.
    var yCenters = nodes.map(function (nd) { return nd.vy; }).sort(function (a, b) { return a - b; });
    var channels = []; // { y, side: "mid"|"top"|"bot" }

    // Outer channels
    var nTop = Infinity;
    var nBot = -Infinity;
    nodes.forEach(function (nd) {
      nTop = Math.min(nTop, nd.vy - nd._hh);
      nBot = Math.max(nBot, nd.vy + nd._hh);
    });
    if (!isFinite(nTop)) { nTop = VBH * 0.25; nBot = VBH * 0.75; }

    channels.push({ y: Math.max(8, nTop - 22), side: "top", base: true });
    channels.push({ y: Math.min(VBH - 8, nBot + 22), side: "bot", base: true });

    // Mid-gap channels between vertically adjacent nodes (global y sort)
    var uniqY = [];
    yCenters.forEach(function (y) {
      if (!uniqY.length || Math.abs(uniqY[uniqY.length - 1] - y) > 4) uniqY.push(y);
    });
    for (var g = 0; g < uniqY.length - 1; g++) {
      var mid = (uniqY[g] + uniqY[g + 1]) / 2;
      // Only keep a gap channel if the nodes leave enough room
      var gap = uniqY[g + 1] - uniqY[g];
      if (gap >= ROWH * 0.55) channels.push({ y: mid, side: "mid", base: false });
    }

    // Lane counters per channel index
    var laneCount = channels.map(function () { return 0; });

    function pickChannel(a, b) {
      var midY = (a.vy + b.vy) / 2;
      var preferTop = midY < VBH / 2;
      // Score channels: prefer mid-gaps between a and b y-range, else outer on the preferred side
      var best = -1;
      var bestScore = -Infinity;
      for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        var score = 0;
        var yLo = Math.min(a.vy, b.vy);
        var yHi = Math.max(a.vy, b.vy);
        if (ch.side === "mid" && ch.y > yLo - 4 && ch.y < yHi + 4) {
          score = 100 - Math.abs(ch.y - midY) * 0.5 - laneCount[i] * 3;
        } else if (ch.side === "mid") {
          score = 40 - Math.abs(ch.y - midY) * 0.3 - laneCount[i] * 3;
        } else if (ch.side === "top" && preferTop) {
          score = 30 - laneCount[i] * 2;
        } else if (ch.side === "bot" && !preferTop) {
          score = 30 - laneCount[i] * 2;
        } else {
          score = 10 - laneCount[i] * 2;
        }
        // Prefer channels outside the vertical band of source/target centers so the
        // horizontal run does not sit on a node row.
        var onRow = false;
        for (var ni = 0; ni < nodes.length; ni++) {
          if (Math.abs(nodes[ni].vy - ch.y) < nodes[ni]._hh + 6) { onRow = true; break; }
        }
        if (onRow) score -= 50;
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      }
      if (best < 0) best = preferTop ? 0 : 1;
      var lane = laneCount[best]++;
      var dir = channels[best].side === "bot" ? 1 : (channels[best].side === "top" ? -1 : ((lane % 2) * 2 - 1));
      var y = channels[best].y + dir * lane * LANE_GAP;
      // Clamp into board
      y = Math.max(6, Math.min(VBH - 6, y));
      return { y: y, lane: lane, idx: best };
    }

    // ── 6. Route each edge ───────────────────────────────────────────────────
    var GAP = 8; // visible gap between line end and card edge
    var OCC_PAD = 4; // treat cards slightly larger when testing occlusion

    function portRight(nd) {
      return { x: nd.vx + halfW(nd) + GAP, y: nd.vy };
    }
    function portLeft(nd) {
      return { x: nd.vx - halfW(nd) - GAP, y: nd.vy };
    }

    // Stagger ports vertically when many edges share a node, so fan-in/out
    // lines do not fully overlap on the card edge.
    var outPortCount = {};
    var inPortCount = {};
    var outPortIdx = {};
    var inPortIdx = {};
    edgeList.forEach(function (e) {
      outPortCount[e.a.key] = (outPortCount[e.a.key] || 0) + 1;
      inPortCount[e.b.key] = (inPortCount[e.b.key] || 0) + 1;
    });

    function nextOutPort(nd) {
      var totalP = outPortCount[nd.key] || 1;
      var i = outPortIdx[nd.key] || 0;
      outPortIdx[nd.key] = i + 1;
      var spread = Math.min(halfH(nd) * 0.7, 14);
      var yOff = totalP === 1 ? 0 : ((i / (totalP - 1)) - 0.5) * 2 * spread;
      return { x: nd.vx + halfW(nd) + GAP, y: nd.vy + yOff };
    }
    function nextInPort(nd) {
      var totalP = inPortCount[nd.key] || 1;
      var i = inPortIdx[nd.key] || 0;
      inPortIdx[nd.key] = i + 1;
      var spread = Math.min(halfH(nd) * 0.7, 14);
      var yOff = totalP === 1 ? 0 : ((i / (totalP - 1)) - 0.5) * 2 * spread;
      return { x: nd.vx - halfW(nd) - GAP, y: nd.vy + yOff };
    }

    // Sort edges for stable port assignment: by source y then target y
    edgeList.sort(function (e1, e2) {
      if (e1.a.vy !== e2.a.vy) return e1.a.vy - e2.a.vy;
      return e1.b.vy - e2.b.vy;
    });

    function routeEdge(a, b) {
      var sp = nextOutPort(a);
      var tp = nextInPort(b);
      var sx = sp.x;
      var sy = sp.y;
      var tx = tp.x;
      var ty = tp.y;

      // Same-column should not happen for a proper layering; fall back to vertical.
      if (tx <= sx + 2) {
        return pathFromPoints([[sx, sy], [sx + 6, sy], [sx + 6, ty], [tx, ty]]);
      }

      // 1) Gentle cubic (preferred for clear L-R edges)
      if (!curveHitsAny(sx, sy, tx, ty, nodes, a, b, OCC_PAD)) {
        return curvePath(sx, sy, tx, ty);
      }

      // 2) Simple orth: out, mid-vertical, into target
      var mx = (sx + tx) / 2;
      var orthMid = [[sx, sy], [mx, sy], [mx, ty], [tx, ty]];
      if (!polylineHitsAny(orthMid, nodes, a, b, OCC_PAD)) {
        return pathFromPoints(orthMid);
      }

      // 3) Early elbow near source, late near target
      var ex = sx + Math.min(18, (tx - sx) * 0.25);
      var lx = tx - Math.min(18, (tx - sx) * 0.25);
      var orthEarly = [[sx, sy], [ex, sy], [ex, ty], [tx, ty]];
      if (!polylineHitsAny(orthEarly, nodes, a, b, OCC_PAD)) {
        return pathFromPoints(orthEarly);
      }
      var orthLate = [[sx, sy], [lx, sy], [lx, ty], [tx, ty]];
      if (!polylineHitsAny(orthLate, nodes, a, b, OCC_PAD)) {
        return pathFromPoints(orthLate);
      }

      // 4) Full detour through a free horizontal channel with its own lane
      var ch = pickChannel(a, b);
      var chY = ch.y;
      // Vertical risers offset per lane so parallel detours do not share segments
      var riserA = sx + 6 + ch.lane * 5;
      var riserB = tx - 6 - ch.lane * 5;
      if (riserA > riserB - 8) {
        riserA = sx + 4;
        riserB = tx - 4;
      }
      var detour = [
        [sx, sy],
        [riserA, sy],
        [riserA, chY],
        [riserB, chY],
        [riserB, ty],
        [tx, ty]
      ];
      // If the chosen channel still collides (rare), push further outward
      if (polylineHitsAny(detour, nodes, a, b, OCC_PAD)) {
        var outward = (sy + ty) / 2 < VBH / 2
          ? Math.max(6, nTop - 22 - (ch.lane + 1) * LANE_GAP)
          : Math.min(VBH - 6, nBot + 22 + (ch.lane + 1) * LANE_GAP);
        detour = [
          [sx, sy],
          [riserA, sy],
          [riserA, outward],
          [riserB, outward],
          [riserB, ty],
          [tx, ty]
        ];
      }
      return pathFromPoints(detour);
    }

    var lines = "";
    edgeList.forEach(function (e) {
      lines += routeEdge(e.a, e.b);
    });

    // Plain strokes only - no arrowheads.
    var svg = '<svg class="wfg-solar-links" viewBox="0 0 ' + VBW + " " + VBH
      + '" preserveAspectRatio="none" aria-hidden="true">'
      + '<g class="wfg-solar-flow" stroke="rgba(242,210,122,0.55)" stroke-width="1.35" fill="none" '
      + 'stroke-linejoin="round" stroke-linecap="round">'
      + lines
      + "</g></svg>";

    var cardsHtml = nodes.map(function (node) { return renderNode(node); }).join("");
    var boardHtml = svg + cardsHtml;

    return {
      nodes: nodes,
      total: total,
      boardHtml: boardHtml,
      aspect: VBW / VBH,
      edges: edgeList.length
    };
  }

  // Back-compat aliases used by workflows.js
  function buildCanvasLayout(steps, inputHint, outputHint, flow) {
    return buildLayout(steps, inputHint, outputHint, flow);
  }
  function renderCanvasNode(node) {
    return renderNode(node);
  }

  var api = {
    buildLayout: buildLayout,
    renderNode: renderNode,
    buildCanvasLayout: buildCanvasLayout,
    renderCanvasNode: renderCanvasNode
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (global) {
    global.buildLayout = buildLayout;
    global.renderNode = renderNode;
    global.buildCanvasLayout = buildCanvasLayout;
    global.renderCanvasNode = renderCanvasNode;
    global.FundlineWorkflowGraph = api;
  }
})(typeof window !== "undefined" ? window : (typeof global !== "undefined" ? global : this));
