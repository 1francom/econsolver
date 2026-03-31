// ─── ECON STUDIO · src/components/modeling/ModelPlots.jsx ────────────────────
// Pure SVG visualization components for causal inference results.
// All components are stateless — they receive engine output as props and render.
//
// Exports:
//   RDDPlot        — binned scatter + local linear fit + cutoff + LATE annotation
//   DiDPlot        — 2×2 parallel trends + counterfactual + ATT arrow
//   EventStudyPlot — per-period means (treated vs control) + treatment line
//
// Depends on: C, mono from ./shared.jsx
// No React state. No side effects.

import { C, mono } from "./shared.jsx";

// ─── SHARED SVG HELPERS ───────────────────────────────────────────────────────

function AxisBottom({ sx, ticks, y, fmt = v => v.toFixed(2) }) {
  return (
    <g>
      <line x1={sx(ticks[0])} x2={sx(ticks[ticks.length - 1])} y1={y} y2={y}
        stroke={C.border2} strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={sx(t)} x2={sx(t)} y1={y} y2={y + 4} stroke={C.border2} strokeWidth={1} />
          <text x={sx(t)} y={y + 14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
            {fmt(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function AxisLeft({ sy, ticks, x, fmt = v => v.toFixed(2) }) {
  return (
    <g>
      <line x1={x} x2={x} y1={sy(ticks[0])} y2={sy(ticks[ticks.length - 1])}
        stroke={C.border2} strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={x - 4} x2={x} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
          <text x={x - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
            {fmt(t)}
          </text>
        </g>
      ))}
    </g>
  );
}

function GridLines({ sx, sy, xTicks, yTicks, x0, x1, y0, y1 }) {
  return (
    <g opacity={0.4}>
      {xTicks.map((t, i) => (
        <line key={`x${i}`} x1={sx(t)} x2={sx(t)} y1={y0} y2={y1}
          stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
      ))}
      {yTicks.map((t, i) => (
        <line key={`y${i}`} x1={x0} x2={x1} y1={sy(t)} y2={sy(t)}
          stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
      ))}
    </g>
  );
}

function niceTicks(lo, hi, n = 5) {
  const range = hi - lo;
  if (range === 0) return [lo];
  const step = Math.pow(10, Math.floor(Math.log10(range / n)));
  const nice = [1, 2, 2.5, 5, 10].find(s => range / (s * step) <= n) * step;
  const start = Math.ceil(lo / nice) * nice;
  const out = [];
  for (let v = start; v <= hi + nice * 0.01; v += nice) out.push(parseFloat(v.toFixed(10)));
  return out.length >= 2 ? out : [lo, hi];
}

function exportSVG(svgId, filename) {
  const el = document.getElementById(svgId);
  if (!el) return;
  const src = new XMLSerializer().serializeToString(el);
  const blob = new Blob([src], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── PLOT WRAPPER ─────────────────────────────────────────────────────────────
function PlotShell({ title, subtitle, svgId, filename, children, W, H }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div>
          <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
            {title}
          </span>
          {subtitle && (
            <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginLeft: 10 }}>
              {subtitle}
            </span>
          )}
        </div>
        <button
          onClick={() => exportSVG(svgId, filename)}
          style={{
            padding: "0.2rem 0.6rem", background: "transparent",
            border: `1px solid ${C.border2}`, borderRadius: 3,
            color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >
          ↓ SVG
        </button>
      </div>
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", minWidth: Math.min(W, 340), display: "block", fontFamily: mono }}>
          <rect width={W} height={H} fill={C.bg} />
          {children}
        </svg>
      </div>
    </div>
  );
}

// ─── RDD PLOT ─────────────────────────────────────────────────────────────────
// Binned scatter (equal-frequency bins) + local linear fit lines + cutoff.
// Props: result from runSharpRDD — { valid, Y, D, xc, leftFit, rightFit, cutoff, h, late, lateP, kernelType }
// yLabel, xLabel: axis labels

export function RDDPlot({ result, yLabel = "Y", xLabel = "Running variable" }) {
  if (!result?.valid?.length) return null;

  const W = 620, H = 380;
  const PAD = { l: 56, r: 24, t: 24, b: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const { valid, Y, D, xc, leftFit, rightFit, cutoff, h, late, lateP, kernelType } = result;

  // ── Bin the scatter (20 bins per side) ──
  const BINS = 20;
  function binSide(pts) {
    if (!pts.length) return [];
    const xs = pts.map(p => p.x).sort((a, b) => a - b);
    const ys = pts.map(p => p.y);
    // equal-width bins
    const xmin = xs[0], xmax = xs[xs.length - 1];
    const bw = (xmax - xmin) / BINS || 1;
    const bins = Array.from({ length: BINS }, () => ({ xs: [], ys: [] }));
    pts.forEach(p => {
      const bi = Math.min(BINS - 1, Math.floor((p.x - xmin) / bw));
      bins[bi].xs.push(p.x);
      bins[bi].ys.push(p.y);
    });
    return bins
      .filter(b => b.xs.length > 0)
      .map(b => ({
        x: b.xs.reduce((s, v) => s + v, 0) / b.xs.length,
        y: b.ys.reduce((s, v) => s + v, 0) / b.ys.length,
        n: b.xs.length,
      }));
  }

  const runningVals = valid.map(r => r[Object.keys(r).find(k => !k.startsWith("__"))]);
  // reconstruct x from xc + cutoff
  const rawPts = valid.map((r, i) => ({ x: xc[i] + cutoff, y: Y[i], d: D[i] }));
  const leftPts  = rawPts.filter(p => p.d === 0);
  const rightPts = rawPts.filter(p => p.d === 1);
  const leftBins  = binSide(leftPts);
  const rightBins = binSide(rightPts);
  const allBins   = [...leftBins, ...rightBins];

  const allX = allBins.map(b => b.x);
  const allY = allBins.map(b => b.y);
  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMin = Math.min(...allY), yMax = Math.max(...allY);
  const xPad = (xMax - xMin) * 0.04 || 0.5;
  const yPad = (yMax - yMin) * 0.08 || 0.5;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(xLo, xHi, 6);
  const yTicks = niceTicks(yLo, yHi, 5);

  // fit line paths
  const leftPath  = leftFit.sort((a, b) => a.x - b.x).map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`).join(" ");
  const rightPath = rightFit.sort((a, b) => a.x - b.x).map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`).join(" ");

  // LATE annotation positions
  const cx     = sx(cutoff);
  const leftY  = leftFit.length  ? sy(leftFit[leftFit.length - 1].yhat)  : null;
  const rightY = rightFit.length ? sy(rightFit[0].yhat) : null;
  const lateStr = late != null && isFinite(late)
    ? `LATE = ${late >= 0 ? "+" : ""}${late.toFixed(3)}`
    : "";

  const svgId = "rdd-plot";

  return (
    <PlotShell
      title="RDD Binned Scatter"
      subtitle={`cutoff = ${cutoff} · bw = ${h?.toFixed(3)} · ${kernelType} kernel`}
      svgId={svgId}
      filename="rdd_plot.svg"
      W={W} H={H}
    >
      <GridLines sx={sx} sy={sy} xTicks={xTicks} yTicks={yTicks}
        x0={PAD.l} x1={PAD.l + iW} y0={PAD.t} y1={PAD.t + iH} />

      {/* bandwidth shading */}
      <rect
        x={sx(cutoff - h)} y={PAD.t}
        width={sx(cutoff + h) - sx(cutoff - h)} height={iH}
        fill={C.gold} opacity={0.04}
      />

      {/* scatter bins — left (control) */}
      {leftBins.map((b, i) => (
        <circle key={`l${i}`} cx={sx(b.x)} cy={sy(b.y)} r={Math.min(5, 2 + b.n * 0.3)}
          fill={C.blue} opacity={0.75} />
      ))}

      {/* scatter bins — right (treated) */}
      {rightBins.map((b, i) => (
        <circle key={`r${i}`} cx={sx(b.x)} cy={sy(b.y)} r={Math.min(5, 2 + b.n * 0.3)}
          fill={C.orange} opacity={0.75} />
      ))}

      {/* fit lines */}
      {leftPath  && <path d={leftPath}  fill="none" stroke={C.blue}   strokeWidth={2} opacity={0.9} />}
      {rightPath && <path d={rightPath} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.9} />}

      {/* cutoff line */}
      <line x1={cx} x2={cx} y1={PAD.t} y2={PAD.t + iH}
        stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" />
      <text x={cx + 5} y={PAD.t + 12} fill={C.gold} fontSize={9} fontFamily={mono}>
        c = {cutoff}
      </text>

      {/* LATE jump arrow */}
      {leftY != null && rightY != null && (
        <g>
          <line x1={cx} x2={cx} y1={leftY} y2={rightY}
            stroke={lateP < 0.05 ? C.teal : C.textDim}
            strokeWidth={2} markerEnd="url(#arrowhead)" />
          <text
            x={cx + 8}
            y={(leftY + rightY) / 2 + 4}
            fill={lateP < 0.05 ? C.teal : C.textDim}
            fontSize={9} fontFamily={mono}
          >
            {lateStr}
          </text>
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6"
              refX="3" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill={lateP < 0.05 ? C.teal : C.textDim} />
            </marker>
          </defs>
        </g>
      )}

      <AxisBottom sx={sx} ticks={xTicks} y={PAD.t + iH}
        fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(1)} />
      <AxisLeft sy={sy} ticks={yTicks} x={PAD.l}
        fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)} />

      {/* axis labels */}
      <text x={PAD.l + iW / 2} y={H - 6} textAnchor="middle"
        fill={C.textDim} fontSize={9} fontFamily={mono}>{xLabel}</text>
      <text
        transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
        textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}
      >{yLabel}</text>

      {/* legend */}
      <g transform={`translate(${PAD.l + 10}, ${PAD.t + 10})`}>
        <circle cx={5} cy={5} r={4} fill={C.blue} opacity={0.8} />
        <text x={13} y={9} fill={C.textDim} fontSize={8} fontFamily={mono}>Control</text>
        <circle cx={5} cy={20} r={4} fill={C.orange} opacity={0.8} />
        <text x={13} y={24} fill={C.textDim} fontSize={8} fontFamily={mono}>Treated</text>
      </g>
    </PlotShell>
  );
}

// ─── DiD 2×2 PLOT ─────────────────────────────────────────────────────────────
// Parallel trends visualization with counterfactual and ATT annotation.
// Props: result from run2x2DiD — { means: {ctrl_pre,ctrl_post,trt_pre,trt_post}, att, attP }
// yLabel: axis label

export function DiDPlot({ result, yLabel = "Y" }) {
  if (!result?.means) return null;

  const { ctrl_pre, ctrl_post, trt_pre, trt_post, att, attP } = {
    ...result.means,
    att:  result.att,
    attP: result.attP,
  };

  // need all four means
  if ([ctrl_pre, ctrl_post, trt_pre, trt_post].some(v => v == null)) return null;

  const W = 520, H = 340;
  const PAD = { l: 64, r: 48, t: 32, b: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const allY  = [ctrl_pre, ctrl_post, trt_pre, trt_post];
  const yMin  = Math.min(...allY);
  const yMax  = Math.max(...allY);
  const yPad  = (yMax - yMin) * 0.2 || 1;
  const yLo   = yMin - yPad;
  const yHi   = yMax + yPad;

  // x: 0 = pre, 1 = post
  const sx = v => PAD.l + v * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const yTicks = niceTicks(yLo, yHi, 5);

  // counterfactual: treated trend if parallel assumption holds
  const trend      = ctrl_post - ctrl_pre;
  const trt_cf     = trt_pre + trend;

  const pts = {
    ctrl_pre:  { x: sx(0), y: sy(ctrl_pre)  },
    ctrl_post: { x: sx(1), y: sy(ctrl_post) },
    trt_pre:   { x: sx(0), y: sy(trt_pre)   },
    trt_post:  { x: sx(1), y: sy(trt_post)  },
    trt_cf:    { x: sx(1), y: sy(trt_cf)    },
  };

  const attSig  = attP != null && attP < 0.05;
  const attColor = attSig ? C.teal : C.textDim;
  const svgId = "did-plot";

  return (
    <PlotShell
      title="DiD 2×2 Parallel Trends"
      subtitle={`ATT = ${att >= 0 ? "+" : ""}${att?.toFixed(4)} ${attSig ? "(p<0.05)" : "(n.s.)"}`}
      svgId={svgId}
      filename="did_parallel_trends.svg"
      W={W} H={H}
    >
      {/* grid */}
      {yTicks.map((t, i) => (
        <line key={i} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
          stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />
      ))}

      {/* pre/post divider */}
      <line x1={sx(0.5)} x2={sx(0.5)} y1={PAD.t} y2={PAD.t + iH}
        stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />
      <text x={sx(0.5) + 5} y={PAD.t + 12} fill={C.textMuted} fontSize={8} fontFamily={mono}>
        Treatment
      </text>

      {/* counterfactual line (dashed) */}
      <line
        x1={pts.trt_pre.x} y1={pts.trt_pre.y}
        x2={pts.trt_cf.x}  y2={pts.trt_cf.y}
        stroke={C.gold} strokeWidth={1.5} strokeDasharray="6 4" opacity={0.7}
      />
      <text x={pts.trt_cf.x + 5} y={pts.trt_cf.y + 3}
        fill={C.gold} fontSize={8} fontFamily={mono} opacity={0.8}>
        counterfactual
      </text>

      {/* control line */}
      <line
        x1={pts.ctrl_pre.x} y1={pts.ctrl_pre.y}
        x2={pts.ctrl_post.x} y2={pts.ctrl_post.y}
        stroke={C.blue} strokeWidth={2} />

      {/* treated line */}
      <line
        x1={pts.trt_pre.x} y1={pts.trt_pre.y}
        x2={pts.trt_post.x} y2={pts.trt_post.y}
        stroke={C.orange} strokeWidth={2} />

      {/* ATT brace */}
      <line
        x1={pts.trt_post.x + 16} y1={pts.trt_cf.y}
        x2={pts.trt_post.x + 16} y2={pts.trt_post.y}
        stroke={attColor} strokeWidth={1.5} />
      <line x1={pts.trt_post.x + 12} y1={pts.trt_cf.y}   x2={pts.trt_post.x + 20} y2={pts.trt_cf.y}   stroke={attColor} strokeWidth={1} />
      <line x1={pts.trt_post.x + 12} y1={pts.trt_post.y} x2={pts.trt_post.x + 20} y2={pts.trt_post.y} stroke={attColor} strokeWidth={1} />
      <text
        x={pts.trt_post.x + 22}
        y={(pts.trt_cf.y + pts.trt_post.y) / 2 + 4}
        fill={attColor} fontSize={9} fontFamily={mono}
      >
        ATT
      </text>

      {/* dots */}
      {[
        { pt: pts.ctrl_pre,  c: C.blue,   label: ctrl_pre.toFixed(3)  },
        { pt: pts.ctrl_post, c: C.blue,   label: ctrl_post.toFixed(3) },
        { pt: pts.trt_pre,   c: C.orange, label: trt_pre.toFixed(3)   },
        { pt: pts.trt_post,  c: C.orange, label: trt_post.toFixed(3)  },
      ].map(({ pt, c, label }, i) => (
        <g key={i}>
          <circle cx={pt.x} cy={pt.y} r={5} fill={c} opacity={0.9} />
          <text x={pt.x} y={pt.y - 9} textAnchor="middle"
            fill={c} fontSize={8.5} fontFamily={mono}>{label}</text>
        </g>
      ))}

      {/* axes */}
      <AxisLeft sy={sy} ticks={yTicks} x={PAD.l}
        fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)} />

      {/* x axis labels */}
      <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH}
        stroke={C.border2} strokeWidth={1} />
      {[0, 1].map(v => (
        <text key={v} x={sx(v)} y={PAD.t + iH + 16} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          {v === 0 ? "Pre" : "Post"}
        </text>
      ))}

      {/* y label */}
      <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
        textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
        {yLabel}
      </text>

      {/* legend */}
      <g transform={`translate(${PAD.l + 10}, ${PAD.t + 10})`}>
        <line x1={0} x2={18} y1={5} y2={5} stroke={C.blue}   strokeWidth={2} />
        <text x={22} y={9}  fill={C.textDim} fontSize={8} fontFamily={mono}>Control</text>
        <line x1={0} x2={18} y1={20} y2={20} stroke={C.orange} strokeWidth={2} />
        <text x={22} y={24} fill={C.textDim} fontSize={8} fontFamily={mono}>Treated</text>
        <line x1={0} x2={18} y1={35} y2={35} stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" />
        <text x={22} y={39} fill={C.textDim} fontSize={8} fontFamily={mono}>Counterfactual</text>
      </g>
    </PlotShell>
  );
}

// ─── EVENT STUDY PLOT (TWFE) ──────────────────────────────────────────────────
// Per-period mean of Y for treated vs control groups + treatment indicator line.
// Props: result from runTWFEDiD — { eventMeans: [{t, ctrl, trt}], att, attP }
// treatPeriod: first treated period (optional — drawn as vertical line if provided)
// yLabel: axis label

export function EventStudyPlot({ result, treatPeriod = null, yLabel = "Y" }) {
  if (!result?.eventMeans?.length) return null;

  const { eventMeans, att, attP } = result;

  // filter to periods where at least one side has data
  const pts = eventMeans.filter(e => e.ctrl != null || e.trt != null);
  if (pts.length < 2) return null;

  const W = 620, H = 360;
  const PAD = { l: 60, r: 28, t: 32, b: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const times = pts.map(e => e.t);
  const tMin  = Math.min(...times);
  const tMax  = Math.max(...times);

  const allY  = pts.flatMap(e => [e.ctrl, e.trt].filter(v => v != null));
  const yMin  = Math.min(...allY);
  const yMax  = Math.max(...allY);
  const yPad  = (yMax - yMin) * 0.15 || 1;
  const yLo   = yMin - yPad;
  const yHi   = yMax + yPad;

  const sx = t => PAD.l + ((t - tMin) / (tMax - tMin || 1)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(tMin, tMax, Math.min(times.length, 8));
  const yTicks = niceTicks(yLo, yHi, 5);

  // detect treatment period: first period where any unit has trt data and control gaps
  const inferredTreat = treatPeriod
    ?? pts.find(e => e.trt != null && e.ctrl != null)?.t
    ?? null;

  // line paths (skip nulls)
  function makePath(key, color) {
    const segs = [];
    let cur = null;
    pts.forEach(e => {
      if (e[key] != null) {
        const x = sx(e.t).toFixed(1), y = sy(e[key]).toFixed(1);
        if (cur === null) { cur = [`M${x},${y}`]; } else { cur.push(`L${x},${y}`); }
      } else {
        if (cur) { segs.push({ d: cur.join(" "), color }); cur = null; }
      }
    });
    if (cur) segs.push({ d: cur.join(" "), color });
    return segs;
  }

  const ctrlSegs = makePath("ctrl", C.blue);
  const trtSegs  = makePath("trt",  C.orange);

  const attSig   = attP != null && attP < 0.05;
  const svgId    = "event-study-plot";

  return (
    <PlotShell
      title="Event Study — Per-Period Means"
      subtitle={`ATT = ${att >= 0 ? "+" : ""}${att?.toFixed(4)} ${attSig ? "· p<0.05" : "· n.s."}`}
      svgId={svgId}
      filename="event_study.svg"
      W={W} H={H}
    >
      <GridLines sx={sx} sy={sy} xTicks={xTicks} yTicks={yTicks}
        x0={PAD.l} x1={PAD.l + iW} y0={PAD.t} y1={PAD.t + iH} />

      {/* treatment period line */}
      {inferredTreat != null && sx(inferredTreat) >= PAD.l && sx(inferredTreat) <= PAD.l + iW && (
        <g>
          <rect
            x={sx(inferredTreat)} y={PAD.t}
            width={PAD.l + iW - sx(inferredTreat)} height={iH}
            fill={C.teal} opacity={0.04}
          />
          <line
            x1={sx(inferredTreat)} x2={sx(inferredTreat)}
            y1={PAD.t} y2={PAD.t + iH}
            stroke={C.teal} strokeWidth={1.5} strokeDasharray="5 3"
          />
          <text x={sx(inferredTreat) + 4} y={PAD.t + 12}
            fill={C.teal} fontSize={8} fontFamily={mono}>
            Treatment
          </text>
        </g>
      )}

      {/* control line + dots */}
      {ctrlSegs.map((seg, i) => (
        <path key={`cs${i}`} d={seg.d} fill="none" stroke={C.blue} strokeWidth={2} opacity={0.85} />
      ))}
      {pts.filter(e => e.ctrl != null).map((e, i) => (
        <circle key={`cd${i}`} cx={sx(e.t)} cy={sy(e.ctrl)} r={3.5}
          fill={C.blue} opacity={0.9} />
      ))}

      {/* treated line + dots */}
      {trtSegs.map((seg, i) => (
        <path key={`ts${i}`} d={seg.d} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.85} />
      ))}
      {pts.filter(e => e.trt != null).map((e, i) => (
        <circle key={`td${i}`} cx={sx(e.t)} cy={sy(e.trt)} r={3.5}
          fill={C.orange} opacity={0.9} />
      ))}

      {/* ATT annotation at last period */}
      {(() => {
        const last = pts[pts.length - 1];
        if (last.ctrl == null || last.trt == null) return null;
        const x = sx(last.t);
        const y1 = sy(last.ctrl);
        const y2 = sy(last.trt);
        if (Math.abs(y1 - y2) < 6) return null;
        const color = attSig ? C.teal : C.textMuted;
        return (
          <g>
            <line x1={x + 12} y1={y1} x2={x + 12} y2={y2} stroke={color} strokeWidth={1.5} />
            <line x1={x + 8} y1={y1} x2={x + 16} y2={y1} stroke={color} strokeWidth={1} />
            <line x1={x + 8} y1={y2} x2={x + 16} y2={y2} stroke={color} strokeWidth={1} />
            <text x={x + 18} y={(y1 + y2) / 2 + 4} fill={color} fontSize={8} fontFamily={mono}>ATT</text>
          </g>
        );
      })()}

      <AxisBottom sx={sx} ticks={xTicks} y={PAD.t + iH}
        fmt={v => Number.isInteger(v) ? String(v) : v.toFixed(1)} />
      <AxisLeft sy={sy} ticks={yTicks} x={PAD.l}
        fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)} />

      {/* axis labels */}
      <text x={PAD.l + iW / 2} y={H - 6} textAnchor="middle"
        fill={C.textDim} fontSize={9} fontFamily={mono}>Time period</text>
      <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
        textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
        {yLabel}
      </text>

      {/* legend */}
      <g transform={`translate(${PAD.l + 10}, ${PAD.t + 10})`}>
        <line x1={0} x2={18} y1={5}  y2={5}  stroke={C.blue}   strokeWidth={2} />
        <text x={22} y={9}  fill={C.textDim} fontSize={8} fontFamily={mono}>Control</text>
        <line x1={0} x2={18} y1={20} y2={20} stroke={C.orange} strokeWidth={2} />
        <text x={22} y={24} fill={C.textDim} fontSize={8} fontFamily={mono}>Treated</text>
      </g>
    </PlotShell>
  );
}
