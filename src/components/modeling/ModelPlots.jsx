// ─── ECON STUDIO · src/components/modeling/ModelPlots.jsx ────────────────────
// Pure SVG visualization components for causal inference results.
// All components are stateless — they receive engine output as props and render.
//
// Exports:
//   PlotSelector         — tabbed shell: renders one plot at a time from a list
//   YFittedPlot          — Y vs Ŷ scatter with 45° reference line
//   PartialPlot          — Frisch-Waugh partial regression plot for one regressor
//   RDDPlot              — binned scatter + local linear fit + cutoff + LATE annotation
//   DiDPlot              — 2×2 parallel trends + counterfactual + ATT arrow
//   EventStudyPlot       — per-period means (treated vs control) + treatment line
//   FirstStagePlot       — 2SLS: instrument(s) vs endogenous, fitted line, F-stat
//   RDDBandwidthPlot     — LATE(h) sensitivity across bandwidth range
//   RDDCovariateBalance  — covariate means left/right of cutoff (balance check)
//
// Depends on: C, mono from ./shared.jsx
// No React state except PlotSelector (activeId only).

import { useState } from "react";
import { C, mono } from "./shared.jsx";

// ─── PLOT SELECTOR ────────────────────────────────────────────────────────────
// Tabbed shell that renders one plot at a time.
// plots: [{ id, label, node }]  — node is a pre-built React element
// accentColor: border color for the active tab
export function PlotSelector({ plots, defaultId, accentColor = C.teal }) {
  const [activeId, setActiveId] = useState(defaultId ?? plots[0]?.id);
  if (!plots?.length) return null;
  const active = plots.find(p => p.id === activeId) ?? plots[0];

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      {/* tab strip */}
      <div style={{ display: "flex", overflowX: "auto", background: "#0a0a0a", borderBottom: `1px solid ${C.border}` }}>
        {plots.map(p => {
          const isActive = p.id === active.id;
          return (
            <button
              key={p.id}
              onClick={() => setActiveId(p.id)}
              style={{
                flexShrink: 0,
                padding: "0.42rem 0.85rem",
                background: isActive ? `${accentColor}12` : "transparent",
                border: "none",
                borderBottom: isActive ? `2px solid ${accentColor}` : "2px solid transparent",
                color: isActive ? accentColor : C.textMuted,
                cursor: "pointer", fontFamily: mono, fontSize: 10,
                letterSpacing: "0.08em", transition: "all 0.12s",
                whiteSpace: "nowrap",
              }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = C.text; }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = C.textMuted; }}
            >
              {p.label}
            </button>
          );
        })}
      </div>
      {/* active plot */}
      <div style={{ background: C.bg }}>
        {active.node}
      </div>
    </div>
  );
}

// ─── Y VS Ŷ SCATTER ──────────────────────────────────────────────────────────
// Scatter of observed Y vs fitted Ŷ with 45° perfect-fit reference line.
// Points colored by |standardized residual| — darker = larger deviation.
// Props: resid, Yhat (both from engine output), yLabel
export function YFittedPlot({ resid, Yhat, yLabel = "Y", svgIdSuffix = "" }) {
  if (!resid?.length || !Yhat?.length) return null;

  const W = 480, H = 320;
  const PAD = { l: 58, r: 24, t: 24, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const Y = Yhat.map((yh, i) => yh + resid[i]);
  const pts = Y.map((y, i) => ({ y, yh: Yhat[i], e: resid[i] }))
    .filter(p => isFinite(p.y) && isFinite(p.yh));
  if (pts.length < 3) return null;

  const n    = pts.length;
  const sd   = (() => { const m = resid.reduce((s,v)=>s+v,0)/n; return Math.sqrt(resid.reduce((s,v)=>s+(v-m)**2,0)/Math.max(1,n-1)); })();

  const allV = [...pts.map(p=>p.y), ...pts.map(p=>p.yh)];
  const vMin = Math.min(...allV), vMax = Math.max(...allV);
  const vPad = (vMax - vMin) * 0.06 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;

  const sx = v => PAD.l + ((v - vLo) / (vHi - vLo)) * iW;
  const sy = v => PAD.t + iH - ((v - vLo) / (vHi - vLo)) * iH; // same scale both axes

  const ticks = niceTicks(vLo, vHi, 6);
  const svgId = `y-fitted${svgIdSuffix}`;

  return (
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 300, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
            <line x1={PAD.l} x2={PAD.l+iW} y1={sy(t)} y2={sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          </g>
        ))}

        {/* 45° reference line */}
        <line x1={sx(vLo)} y1={sy(vLo)} x2={sx(vHi)} y2={sy(vHi)}
          stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3" />

        {/* scatter — color by |z-score| */}
        {pts.map((p, i) => {
          const z   = sd > 0 ? Math.abs(p.e / sd) : 0;
          const big = z > 2;
          return (
            <circle key={i}
              cx={sx(p.yh)} cy={sy(p.y)} r={big ? 3.5 : 2.5}
              fill={big ? C.red : C.green}
              opacity={big ? 0.8 : 0.45}
            />
          );
        })}

        {/* axes */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t)>=1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
            <line x1={PAD.l-4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
            <text x={PAD.l-8} y={sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t)>=1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />

        {/* axis labels */}
        <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          Fitted values (ŷ)
        </text>
        <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          Observed ({yLabel})
        </text>

        {/* legend */}
        <circle cx={PAD.l+10} cy={PAD.t+12} r={3.5} fill={C.green} opacity={0.6} />
        <text x={PAD.l+18} y={PAD.t+16} fill={C.textDim} fontSize={8} fontFamily={mono}>|z| ≤ 2</text>
        <circle cx={PAD.l+70} cy={PAD.t+12} r={3.5} fill={C.red} opacity={0.8} />
        <text x={PAD.l+78} y={PAD.t+16} fill={C.textDim} fontSize={8} fontFamily={mono}>|z| &gt; 2</text>
        <line x1={PAD.l+130} x2={PAD.l+148} y1={PAD.t+12} y2={PAD.t+12} stroke={C.border2} strokeWidth={1.5} strokeDasharray="4 2" />
        <text x={PAD.l+152} y={PAD.t+16} fill={C.textDim} fontSize={8} fontFamily={mono}>perfect fit</text>
      </svg>
    </div>
  );
}

// ─── PARTIAL REGRESSION PLOT ─────────────────────────────────────────────────
// Frisch-Waugh partial plot for one regressor Xi.
// X-axis: residuals of Xi ~ (all other X)
// Y-axis: residuals of Y  ~ (all other X)
// Slope of the fitted line = βi exactly.
//
// Props:
//   rows     — original data rows
//   yCol     — dependent variable name
//   xCol     — regressor to plot
//   otherX   — all other regressors (controls)
//   beta_i   — coefficient of xCol (for annotation)
//   pVal_i   — p-value of xCol (for significance color)
//   runOLS   — engine function passed in to avoid circular import
export function PartialPlot({ rows, yCol, xCol, otherX, beta_i, pVal_i, runOLS, svgIdSuffix = "" }) {
  if (!rows?.length || !yCol || !xCol || !runOLS) return null;

  // Frisch-Waugh: regress Y on otherX, take residuals
  // then regress xCol on otherX, take residuals
  // scatter those residuals against each other
  let eY, eX;

  if (otherX.length === 0) {
    // No other regressors — partial = raw demeaned
    const yVals = rows.map(r => r[yCol]).filter(v => typeof v === "number" && isFinite(v));
    const xVals = rows.map(r => r[xCol]).filter(v => typeof v === "number" && isFinite(v));
    if (yVals.length < 4 || xVals.length < 4) return null;
    const yMean = yVals.reduce((s,v)=>s+v,0)/yVals.length;
    const xMean = xVals.reduce((s,v)=>s+v,0)/xVals.length;
    eY = rows.map(r => (typeof r[yCol]==="number" && isFinite(r[yCol])) ? r[yCol]-yMean : null);
    eX = rows.map(r => (typeof r[xCol]==="number" && isFinite(r[xCol])) ? r[xCol]-xMean : null);
  } else {
    const resY = runOLS(rows, yCol,  otherX);
    const resX = runOLS(rows, xCol,  otherX);
    if (!resY || !resX) return null;
    // runOLS filters to valid rows — we need residuals aligned to the same valid rows
    const validRows = rows.filter(r =>
      typeof r[yCol]==="number" && isFinite(r[yCol]) &&
      typeof r[xCol]==="number" && isFinite(r[xCol]) &&
      otherX.every(c => typeof r[c]==="number" && isFinite(r[c]))
    );
    if (validRows.length < 4) return null;
    eY = resY.resid;
    eX = resX.resid;
  }

  // align — both must be same length
  const pts = eY.map((y, i) => ({ y, x: eX[i] }))
    .filter(p => p.y != null && p.x != null && isFinite(p.y) && isFinite(p.x));
  if (pts.length < 4) return null;

  const W = 480, H = 320;
  const PAD = { l: 58, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const xVals = pts.map(p=>p.x), yVals = pts.map(p=>p.y);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const xPad = (xMax-xMin)*0.05||1, yPad = (yMax-yMin)*0.08||1;
  const xLo=xMin-xPad, xHi=xMax+xPad, yLo=yMin-yPad, yHi=yMax+yPad;

  const sx = v => PAD.l + ((v-xLo)/(xHi-xLo))*iW;
  const sy = v => PAD.t + iH - ((v-yLo)/(yHi-yLo))*iH;

  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(yLo, yHi, 5);

  // fitted line — slope = beta_i
  const xm  = xVals.reduce((s,v)=>s+v,0)/xVals.length;
  const ym  = yVals.reduce((s,v)=>s+v,0)/yVals.length;
  const slope = beta_i ?? (() => {
    const sxx = xVals.reduce((s,v)=>s+(v-xm)**2,0);
    const sxy = xVals.reduce((s,v,i)=>s+(v-xm)*(yVals[i]-ym),0);
    return sxx>0 ? sxy/sxx : 0;
  })();
  const intercept = ym - slope * xm;
  const fitY1 = slope*xLo + intercept;
  const fitY2 = slope*xHi + intercept;

  const sig   = pVal_i != null && pVal_i < 0.05;
  const lColor = sig ? C.teal : C.textMuted;
  const svgId  = `partial-${xCol.replace(/[^a-z0-9]/gi,"-")}${svgIdSuffix}`;

  return (
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 300, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* title */}
        <text x={PAD.l+iW/2} y={16} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          Partial: {yCol} ~ {xCol} | others
        </text>

        {/* grid */}
        {xTicks.map((t,i) => (
          <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t+iH}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}
        {yTicks.map((t,i) => (
          <line key={`gy${i}`} x1={PAD.l} x2={PAD.l+iW} y1={sy(t)} y2={sy(t)}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}

        {/* zero lines */}
        {xLo<0&&xHi>0&&<line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />}
        {yLo<0&&yHi>0&&<line x1={PAD.l} x2={PAD.l+iW} y1={sy(0)} y2={sy(0)} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />}

        {/* scatter */}
        {pts.map((p,i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.5}
            fill={C.violet} opacity={0.5} />
        ))}

        {/* partial regression line */}
        <line x1={sx(xLo)} y1={sy(fitY1)} x2={sx(xHi)} y2={sy(fitY2)}
          stroke={lColor} strokeWidth={2} opacity={0.9} />

        {/* β annotation */}
        <text x={PAD.l+iW-4} y={PAD.t+14} textAnchor="end"
          fill={lColor} fontSize={9} fontFamily={mono}>
          β = {slope>=0?"+":""}{slope.toFixed(4)}{pVal_i!=null ? (pVal_i<0.01?"***":pVal_i<0.05?"**":pVal_i<0.1?"*":"") : ""}
        </text>
        {pVal_i!=null&&(
          <text x={PAD.l+iW-4} y={PAD.t+25} textAnchor="end"
            fill={C.textMuted} fontSize={8} fontFamily={mono}>
            p = {pVal_i<0.001?"<0.001":pVal_i.toFixed(4)}
          </text>
        )}

        {/* axes */}
        {xTicks.map((t,i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}
            </text>
          </g>
        ))}
        {yTicks.map((t,i) => (
          <g key={i}>
            <line x1={PAD.l-4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
            <text x={PAD.l-8} y={sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} />

        <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          e({xCol} | others)
        </text>
        <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          e({yCol} | others)
        </text>
      </svg>
    </div>
  );
}

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

// ─── FIRST STAGE PLOT (2SLS) ──────────────────────────────────────────────────
// Scatter of instrument(s) vs endogenous variable with OLS fit line.
// One panel per instrument. Shows F-stat and weak instrument threshold.
//
// Props:
//   firstStages — array from run2SLS: [{ endVar, Fstat, Fpval, weak, beta, Yhat, varNames, firstXCols }]
//   rows        — the original data rows (for raw scatter)
//   instrVars   — instrument column names (zVars from ModelingTab)
//   endogVars   — endogenous column names (xVars from ModelingTab)

export function FirstStagePlot({ firstStages, rows, instrVars, endogVars }) {
  if (!firstStages?.length || !rows?.length) return null;

  const W = 420, H = 300;
  const PAD = { l: 52, r: 20, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // one panel per (instrument × endogenous) pair — cap at 4 to avoid overflow
  const panels = [];
  firstStages.forEach(fs => {
    instrVars.forEach(z => {
      if (panels.length >= 4) return;
      const pts = rows
        .map(r => ({ x: r[z], y: r[fs.endVar] }))
        .filter(p => typeof p.x === "number" && typeof p.y === "number" && isFinite(p.x) && isFinite(p.y));
      if (pts.length < 4) return;

      const xs = pts.map(p => p.x);
      const ys = pts.map(p => p.y);
      const xMin = Math.min(...xs), xMax = Math.max(...xs);
      const yMin = Math.min(...ys), yMax = Math.max(...ys);
      const xPad = (xMax - xMin) * 0.05 || 1;
      const yPad = (yMax - yMin) * 0.08 || 1;

      // OLS fit line through raw data (instrument → endogenous)
      const n   = pts.length;
      const xm  = xs.reduce((s, v) => s + v, 0) / n;
      const ym  = ys.reduce((s, v) => s + v, 0) / n;
      const sxx = xs.reduce((s, v) => s + (v - xm) ** 2, 0);
      const sxy = xs.reduce((s, v, i) => s + (v - xm) * (ys[i] - ym), 0);
      const b1  = sxx > 0 ? sxy / sxx : 0;
      const b0  = ym - b1 * xm;

      panels.push({
        z, endVar: fs.endVar,
        pts, xMin, xMax, yMin, yMax, xPad, yPad,
        b0, b1,
        Fstat: fs.Fstat, weak: fs.weak,
      });
    });
  });

  if (!panels.length) return null;

  const cols  = Math.min(panels.length, 2);
  const rows_ = Math.ceil(panels.length / cols);
  const totalW = cols * W + (cols - 1) * 1;
  const totalH = rows_ * H + (rows_ - 1) * 1;

  const svgId = "first-stage-plot";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
          First Stage — Instrument Relevance
        </span>
        <button
          onClick={() => {
            const el = document.getElementById(svgId);
            if (!el) return;
            const src = new XMLSerializer().serializeToString(el);
            const blob = new Blob([src], { type: "image/svg+xml" });
            const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
            a.download = "first_stage.svg"; a.click(); URL.revokeObjectURL(a.href);
          }}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, transition: "all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>
      <div style={{ background: C.bg, overflowX: "auto", padding: "0.5rem" }}>
        <svg id={svgId} viewBox={`0 0 ${totalW} ${totalH}`}
          style={{ width: "100%", minWidth: 320, display: "block", fontFamily: mono }}>
          <rect width={totalW} height={totalH} fill={C.bg} />
          {panels.map((p, pi) => {
            const col = pi % cols;
            const row = Math.floor(pi / cols);
            const ox  = col * (W + 1);
            const oy  = row * (H + 1);

            const xLo = p.xMin - p.xPad, xHi = p.xMax + p.xPad;
            const yLo = p.yMin - p.yPad, yHi = p.yMax + p.yPad;
            const sx = v => ox + PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
            const sy = v => oy + PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

            const xTicks = niceTicks(xLo, xHi, 5);
            const yTicks = niceTicks(yLo, yHi, 4);

            const fitX1 = xLo, fitX2 = xHi;
            const fitY1 = p.b0 + p.b1 * fitX1;
            const fitY2 = p.b0 + p.b1 * fitX2;
            const fitClipped = fitY1 >= yLo && fitY1 <= yHi && fitY2 >= yLo && fitY2 <= yHi;

            const fColor = p.weak ? C.red : C.green;

            return (
              <g key={pi}>
                {/* panel bg */}
                <rect x={ox} y={oy} width={W} height={H} fill={C.bg} />

                {/* title */}
                <text x={ox + PAD.l + iW / 2} y={oy + 14} textAnchor="middle"
                  fill={C.textDim} fontSize={9} fontFamily={mono}>
                  {p.z} → {p.endVar}
                </text>

                {/* grid */}
                {xTicks.map((t, i) => (
                  <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={oy + PAD.t} y2={oy + PAD.t + iH}
                    stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
                ))}
                {yTicks.map((t, i) => (
                  <line key={`gy${i}`} x1={ox + PAD.l} x2={ox + PAD.l + iW} y1={sy(t)} y2={sy(t)}
                    stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
                ))}

                {/* scatter */}
                {p.pts.map((pt, i) => (
                  <circle key={i} cx={sx(pt.x)} cy={sy(pt.y)} r={2.2}
                    fill={C.violet} opacity={0.45} />
                ))}

                {/* fit line */}
                {fitClipped && (
                  <line x1={sx(fitX1)} y1={sy(fitY1)} x2={sx(fitX2)} y2={sy(fitY2)}
                    stroke={C.gold} strokeWidth={1.8} opacity={0.9} />
                )}

                {/* F-stat badge */}
                <rect x={ox + PAD.l + iW - 90} y={oy + PAD.t + 4} width={86} height={22}
                  fill={p.weak ? "#100505" : "#050f08"}
                  stroke={fColor + "40"} rx={3} />
                <text x={ox + PAD.l + iW - 47} y={oy + PAD.t + 14} textAnchor="middle"
                  fill={fColor} fontSize={8} fontFamily={mono}>
                  F = {p.Fstat != null && isFinite(p.Fstat) ? p.Fstat.toFixed(2) : "—"}
                </text>
                <text x={ox + PAD.l + iW - 47} y={oy + PAD.t + 23} textAnchor="middle"
                  fill={p.weak ? C.red : C.textMuted} fontSize={7} fontFamily={mono}>
                  {p.weak ? "⚠ weak (F<10)" : "✓ relevant"}
                </text>

                {/* axes */}
                {xTicks.map((t, i) => (
                  <g key={i}>
                    <line x1={sx(t)} x2={sx(t)} y1={oy + PAD.t + iH} y2={oy + PAD.t + iH + 4} stroke={C.border2} strokeWidth={1} />
                    <text x={sx(t)} y={oy + PAD.t + iH + 14} textAnchor="middle" fill={C.textMuted} fontSize={7.5} fontFamily={mono}>
                      {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(1)}
                    </text>
                  </g>
                ))}
                {yTicks.map((t, i) => (
                  <g key={i}>
                    <line x1={ox + PAD.l - 4} x2={ox + PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
                    <text x={ox + PAD.l - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={7.5} fontFamily={mono}>
                      {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(1)}
                    </text>
                  </g>
                ))}
                <line x1={ox + PAD.l} x2={ox + PAD.l + iW} y1={oy + PAD.t + iH} y2={oy + PAD.t + iH} stroke={C.border2} strokeWidth={1} />
                <line x1={ox + PAD.l} x2={ox + PAD.l} y1={oy + PAD.t} y2={oy + PAD.t + iH} stroke={C.border2} strokeWidth={1} />

                {/* axis labels */}
                <text x={ox + PAD.l + iW / 2} y={oy + H - 4} textAnchor="middle" fill={C.textDim} fontSize={8} fontFamily={mono}>
                  {p.z}
                </text>
                <text transform={`translate(${ox + 11}, ${oy + PAD.t + iH / 2}) rotate(-90)`}
                  textAnchor="middle" fill={C.textDim} fontSize={8} fontFamily={mono}>
                  {p.endVar}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
        Stock-Yogo weak instrument threshold: F &gt; 10 · gold line = OLS fit · each panel = one instrument
      </div>
    </div>
  );
}

// ─── RDD BANDWIDTH SENSITIVITY ────────────────────────────────────────────────
// Re-estimates RDD LATE across a range of bandwidths around the IK-optimal h.
// Plots LATE(h) ± 1.96·SE with the optimal bandwidth highlighted.
//
// Props:
//   rows, yCol, runCol, cutoff, optH, kernel — same params used in runSharpRDD
//   controls — wVars
//   runSharpRDD — the engine function (passed in to avoid circular imports)

export function RDDBandwidthPlot({ rows, yCol, runCol, cutoff, optH, kernel = "triangular", controls = [], runSharpRDD }) {
  if (!rows?.length || !optH || !runSharpRDD) return null;

  // evaluate at 15 bandwidths: 0.4h to 1.8h
  const factors  = Array.from({ length: 15 }, (_, i) => 0.4 + i * 0.1);
  const results  = factors.map(f => {
    const h   = f * optH;
    const res = runSharpRDD(rows, yCol, runCol, cutoff, h, kernel, controls);
    if (!res || !isFinite(res.late) || !isFinite(res.lateSE)) return null;
    return { h, late: res.late, lo: res.late - 1.96 * res.lateSE, hi: res.late + 1.96 * res.lateSE, sig: res.lateP < 0.05 };
  }).filter(Boolean);

  if (results.length < 3) return null;

  const W = 560, H = 300;
  const PAD = { l: 60, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const hVals    = results.map(r => r.h);
  const allY     = results.flatMap(r => [r.lo, r.hi]).filter(isFinite);
  const hMin = Math.min(...hVals), hMax = Math.max(...hVals);
  const yMin = Math.min(...allY),  yMax = Math.max(...allY);
  const yPad = (yMax - yMin) * 0.1 || 0.1;
  const yLo  = yMin - yPad, yHi = yMax + yPad;

  const sx = v => PAD.l + ((v - hMin) / (hMax - hMin || 1)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const hTicks = niceTicks(hMin, hMax, 6);
  const yTicks = niceTicks(yLo, yHi, 5);

  // CI band polygon
  const bandTop = results.map((r, i) => `${i === 0 ? "M" : "L"}${sx(r.h).toFixed(1)},${sy(r.hi).toFixed(1)}`).join(" ");
  const bandBot = [...results].reverse().map((r, i) => `${i === 0 ? "M" : "L"}${sx(r.h).toFixed(1)},${sy(r.lo).toFixed(1)}`).join(" ");
  const latePath = results.map((r, i) => `${i === 0 ? "M" : "L"}${sx(r.h).toFixed(1)},${sy(r.late).toFixed(1)}`).join(" ");

  const svgId = "rdd-bw-plot";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
          RDD Bandwidth Sensitivity · LATE(h) ± 1.96 SE
        </span>
        <button
          onClick={() => {
            const el = document.getElementById(svgId);
            if (!el) return;
            const src = new XMLSerializer().serializeToString(el);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
            a.download = "rdd_bandwidth_sensitivity.svg"; a.click();
            URL.revokeObjectURL(a.href);
          }}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", minWidth: 320, display: "block", fontFamily: mono }}>
          <rect width={W} height={H} fill={C.bg} />

          {/* grid */}
          {hTicks.map((t, i) => (
            <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          ))}
          {yTicks.map((t, i) => (
            <line key={`gy${i}`} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          ))}

          {/* zero line */}
          {yLo < 0 && yHi > 0 && (
            <line x1={PAD.l} x2={PAD.l + iW} y1={sy(0)} y2={sy(0)}
              stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3" />
          )}

          {/* CI band */}
          <path d={`${bandTop} ${bandBot} Z`} fill={C.orange} opacity={0.1} />
          <path d={bandTop} fill="none" stroke={C.orange} strokeWidth={1} opacity={0.4} strokeDasharray="3 3" />
          <path d={bandBot} fill="none" stroke={C.orange} strokeWidth={1} opacity={0.4} strokeDasharray="3 3" />

          {/* LATE line */}
          <path d={latePath} fill="none" stroke={C.orange} strokeWidth={2} />

          {/* dots colored by significance */}
          {results.map((r, i) => (
            <circle key={i} cx={sx(r.h)} cy={sy(r.late)} r={3}
              fill={r.sig ? C.orange : C.textMuted} opacity={0.9} />
          ))}

          {/* optimal h line */}
          <line x1={sx(optH)} x2={sx(optH)} y1={PAD.t} y2={PAD.t + iH}
            stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={sx(optH) + 4} y={PAD.t + 12} fill={C.gold} fontSize={8} fontFamily={mono}>
            IK h = {optH.toFixed(3)}
          </text>

          {/* axes */}
          {hTicks.map((t, i) => (
            <g key={i}>
              <line x1={sx(t)} x2={sx(t)} y1={PAD.t + iH} y2={PAD.t + iH + 4} stroke={C.border2} strokeWidth={1} />
              <text x={sx(t)} y={PAD.t + iH + 14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
                {t.toFixed(3)}
              </text>
            </g>
          ))}
          {yTicks.map((t, i) => (
            <g key={i}>
              <line x1={PAD.l - 4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
              <text x={PAD.l - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
                {Math.abs(t) >= 100 ? t.toFixed(1) : t.toFixed(3)}
              </text>
            </g>
          ))}
          <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
          <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

          {/* axis labels */}
          <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
            Bandwidth (h)
          </text>
          <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
            textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
            LATE estimate
          </text>
        </svg>
      </div>
      <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
        15 bandwidths from 0.4h to 1.8h · filled = p&lt;0.05 · band = ±1.96 SE · gold = IK-optimal
      </div>
    </div>
  );
}

// ─── RDD COVARIATE BALANCE ────────────────────────────────────────────────────
// For each control variable, plots mean left vs right of cutoff within bandwidth.
// If RDD assumptions hold, covariates should be balanced at the cutoff.
//
// Props:
//   result   — from runSharpRDD: { valid, D, xc, h, cutoff }
//   controls — wVars (covariate column names)
//   rows     — original data rows (needed to read covariate values)

export function RDDCovariateBalance({ result, controls, rows }) {
  if (!result?.valid?.length || !controls?.length || !rows?.length) return null;

  const { valid, D, xc, h, cutoff } = result;

  // for each covariate: mean and SE left / right of cutoff
  const stats = controls.map(col => {
    const leftVals  = valid.filter((_, i) => D[i] === 0).map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
    const rightVals = valid.filter((_, i) => D[i] === 1).map(r => r[col]).filter(v => typeof v === "number" && isFinite(v));
    if (!leftVals.length || !rightVals.length) return null;

    const mean = arr => arr.reduce((s, v) => s + v, 0) / arr.length;
    const se   = arr => {
      const m = mean(arr);
      const v = arr.reduce((s, v) => s + (v - m) ** 2, 0) / Math.max(1, arr.length - 1);
      return Math.sqrt(v / arr.length);
    };
    const lMean = mean(leftVals), rMean = mean(rightVals);
    const lSE   = se(leftVals),   rSE   = se(rightVals);
    // t-test for difference at cutoff
    const diff  = rMean - lMean;
    const seDiff = Math.sqrt(lSE ** 2 + rSE ** 2);
    const tStat  = seDiff > 0 ? diff / seDiff : 0;
    const imbal  = Math.abs(tStat) > 1.96;

    return { col, lMean, rMean, lSE, rSE, diff, tStat, imbal };
  }).filter(Boolean);

  if (!stats.length) return null;

  const W = 560;
  const rowH = 44;
  const PAD = { l: 120, r: 20, t: 24, b: 36 };
  const iW = W - PAD.l - PAD.r;
  const H = stats.length * rowH + PAD.t + PAD.b;

  // scale: centered on 0, symmetric
  const allVals = stats.flatMap(s => [s.lMean - 1.96 * s.lSE, s.lMean + 1.96 * s.lSE, s.rMean - 1.96 * s.rSE, s.rMean + 1.96 * s.rSE]);
  const vMin = Math.min(...allVals), vMax = Math.max(...allVals);
  const vPad = (vMax - vMin) * 0.05 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;

  const sx = v => PAD.l + ((v - vLo) / (vHi - vLo)) * iW;
  const vTicks = niceTicks(vLo, vHi, 5);

  const svgId = "rdd-covariate-balance";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
            RDD Covariate Balance
          </span>
          {stats.some(s => s.imbal) && (
            <span style={{ fontSize: 9, color: C.red, fontFamily: mono, padding: "1px 6px", border: `1px solid ${C.red}40`, borderRadius: 2 }}>
              ⚠ {stats.filter(s => s.imbal).length} imbalanced
            </span>
          )}
          {!stats.some(s => s.imbal) && (
            <span style={{ fontSize: 9, color: C.green, fontFamily: mono, padding: "1px 6px", border: `1px solid ${C.green}40`, borderRadius: 2 }}>
              ✓ all balanced
            </span>
          )}
        </div>
        <button
          onClick={() => {
            const el = document.getElementById(svgId);
            if (!el) return;
            const src = new XMLSerializer().serializeToString(el);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
            a.download = "rdd_covariate_balance.svg"; a.click();
            URL.revokeObjectURL(a.href);
          }}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9 }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", minWidth: 320, display: "block", fontFamily: mono }}>
          <rect width={W} height={H} fill={C.bg} />

          {/* header ticks */}
          {vTicks.map((t, i) => (
            <g key={i}>
              <line x1={sx(t)} x2={sx(t)} y1={PAD.t - 4} y2={PAD.t + stats.length * rowH}
                stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
              <text x={sx(t)} y={PAD.t - 6} textAnchor="middle" fill={C.textMuted} fontSize={7.5} fontFamily={mono}>
                {Math.abs(t) >= 100 ? t.toFixed(0) : t.toFixed(2)}
              </text>
            </g>
          ))}

          {stats.map((s, i) => {
            const cy = PAD.t + i * rowH + rowH / 2;
            const lx  = sx(s.lMean), rx = sx(s.rMean);
            const lLo = sx(s.lMean - 1.96 * s.lSE), lHi = sx(s.lMean + 1.96 * s.lSE);
            const rLo = sx(s.rMean - 1.96 * s.rSE), rHi = sx(s.rMean + 1.96 * s.rSE);
            const rowBg = i % 2 === 0 ? C.surface : C.surface2;
            const dotColor = s.imbal ? C.red : C.green;

            return (
              <g key={i}>
                <rect x={0} y={PAD.t + i * rowH} width={W} height={rowH} fill={rowBg} opacity={0.5} />

                {/* covariate label */}
                <text x={PAD.l - 10} y={cy + 4} textAnchor="end" fill={s.imbal ? C.red : C.text} fontSize={10} fontFamily={mono}>
                  {s.col.length > 16 ? s.col.slice(0, 15) + "…" : s.col}
                </text>

                {/* left CI */}
                <line x1={lLo} x2={lHi} y1={cy - 3} y2={cy - 3} stroke={C.blue} strokeWidth={1.4} opacity={0.8} />
                <circle cx={lx} cy={cy - 3} r={3.5} fill={C.blue} opacity={0.9} />

                {/* right CI */}
                <line x1={rLo} x2={rHi} y1={cy + 3} y2={cy + 3} stroke={C.orange} strokeWidth={1.4} opacity={0.8} />
                <circle cx={rx} cy={cy + 3} r={3.5} fill={C.orange} opacity={0.9} />

                {/* t-stat */}
                <text x={W - PAD.r + 2} y={cy + 4} textAnchor="start" fill={dotColor} fontSize={8} fontFamily={mono}>
                  t={s.tStat.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* bottom axis */}
          <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + stats.length * rowH + 6} y2={PAD.t + stats.length * rowH + 6}
            stroke={C.border2} strokeWidth={1} />
          <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
            Covariate mean within bandwidth
          </text>
        </svg>
      </div>
      <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono, display: "flex", justifyContent: "space-between" }}>
        <span>● blue = left of cutoff · ● orange = right · bars = 95% CI</span>
        <span>imbalanced if |t| &gt; 1.96</span>
      </div>
    </div>
  );
}

// ─── Y vs X̂ PLOT (2SLS) ──────────────────────────────────────────────────────
// Scatter of Y vs instrumented endogenous variable (X̂ from first stage).
// The slope of the fitted line = β_IV (the 2SLS coefficient on that endogenous var).
// This shows the exogenous variation the instrument is exploiting.
//
// Props:
//   Y         — array of outcome values (Yhat + resid from second stage)
//   Xhat      — array of first-stage fitted values for one endogenous variable
//   beta_iv   — 2SLS coefficient on the endogenous variable (for annotation)
//   pVal      — p-value of that coefficient
//   yLabel    — outcome variable name
//   xLabel    — endogenous variable name
//   resid2    — second stage residuals (for coloring points)
export function YXhatPlot({ Y, Xhat, beta_iv, pVal, yLabel = "Y", xLabel = "X̂", resid2, svgIdSuffix = "" }) {
  if (!Y?.length || !Xhat?.length) return null;

  const pts = Y.map((y, i) => ({ y, x: Xhat[i], e: resid2?.[i] ?? 0 }))
    .filter(p => isFinite(p.y) && isFinite(p.x));
  if (pts.length < 4) return null;

  const W = 480, H = 320;
  const PAD = { l: 58, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const xVals = pts.map(p => p.x), yVals = pts.map(p => p.y);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.08 || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(yLo, yHi, 5);

  // standardize resid2 for coloring
  const n   = pts.length;
  const em  = pts.reduce((s, p) => s + p.e, 0) / n;
  const esd = Math.sqrt(pts.reduce((s, p) => s + (p.e - em) ** 2, 0) / Math.max(1, n - 1));

  // IV fit line: y = intercept + beta_iv * x
  // intercept estimated from means: ȳ - beta_iv * x̄
  const xm  = xVals.reduce((s, v) => s + v, 0) / n;
  const ym  = yVals.reduce((s, v) => s + v, 0) / n;
  const slope = beta_iv ?? (() => {
    const sxx = xVals.reduce((s, v) => s + (v - xm) ** 2, 0);
    const sxy = xVals.reduce((s, v, i) => s + (v - xm) * (yVals[i] - ym), 0);
    return sxx > 0 ? sxy / sxx : 0;
  })();
  const intercept = ym - slope * xm;
  const fitY1 = slope * xLo + intercept;
  const fitY2 = slope * xHi + intercept;

  const sig    = pVal != null && pVal < 0.05;
  const lColor = sig ? C.gold : C.textMuted;
  const svgId  = `y-xhat${svgIdSuffix}`;

  return (
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 300, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* title */}
        <text x={PAD.l + iW / 2} y={16} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          {yLabel} vs {xLabel} — IV exogenous variation
        </text>

        {/* grid */}
        {xTicks.map((t, i) => (
          <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}
        {yTicks.map((t, i) => (
          <line key={`gy${i}`} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}

        {/* scatter — colored by |z| of second-stage residual */}
        {pts.map((p, i) => {
          const z   = esd > 0 ? Math.abs(p.e / esd) : 0;
          const big = z > 2;
          return (
            <circle key={i}
              cx={sx(p.x)} cy={sy(p.y)} r={big ? 3.5 : 2.5}
              fill={big ? C.red : C.violet}
              opacity={big ? 0.8 : 0.4}
            />
          );
        })}

        {/* IV fit line */}
        <line
          x1={sx(xLo)} y1={sy(fitY1)}
          x2={sx(xHi)} y2={sy(fitY2)}
          stroke={lColor} strokeWidth={2} opacity={0.9}
        />

        {/* β annotation */}
        <text x={PAD.l + iW - 4} y={PAD.t + 14} textAnchor="end"
          fill={lColor} fontSize={9} fontFamily={mono}>
          β_IV = {slope >= 0 ? "+" : ""}{slope.toFixed(4)}
          {pVal != null ? (pVal < 0.01 ? "***" : pVal < 0.05 ? "**" : pVal < 0.1 ? "*" : "") : ""}
        </text>
        {pVal != null && (
          <text x={PAD.l + iW - 4} y={PAD.t + 25} textAnchor="end"
            fill={C.textMuted} fontSize={8} fontFamily={mono}>
            p = {pVal < 0.001 ? "<0.001" : pVal.toFixed(4)}
          </text>
        )}

        {/* axes */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t + iH} y2={PAD.t + iH + 4} stroke={C.border2} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t + iH + 14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l - 4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
            <text x={PAD.l - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>{xLabel} (instrumented)</text>
        <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          {yLabel}
        </text>
      </svg>
    </div>
  );
}

// ─── X vs X̂ PLOT (2SLS first stage) ─────────────────────────────────────────
// Scatter of original endogenous X vs instrumented X̂.
// Tight diagonal = strong instrument. Loose = weak.
// Props:
//   rows     — original data rows
//   endVar   — endogenous variable column name
//   Xhat     — first-stage fitted values array (aligned to valid rows)
//   Fstat    — first-stage F-statistic (shown as annotation)
//   weak     — boolean weak instrument flag
export function XvsXhatPlot({ rows, endVar, Xhat, Fstat, weak, svgIdSuffix = "" }) {
  if (!rows?.length || !endVar || !Xhat?.length) return null;

  const xVals = rows
    .map(r => r[endVar])
    .filter(v => typeof v === "number" && isFinite(v));

  // Xhat is aligned to valid rows from OLS — match length
  if (xVals.length !== Xhat.length) return null;

  const pts = xVals.map((x, i) => ({ x, xh: Xhat[i] }))
    .filter(p => isFinite(p.x) && isFinite(p.xh));
  if (pts.length < 4) return null;

  const W = 420, H = 300;
  const PAD = { l: 56, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const allV = [...pts.map(p => p.x), ...pts.map(p => p.xh)];
  const vMin = Math.min(...allV), vMax = Math.max(...allV);
  const vPad = (vMax - vMin) * 0.05 || 1;
  const vLo = vMin - vPad, vHi = vMax + vPad;

  const sx = v => PAD.l + ((v - vLo) / (vHi - vLo)) * iW;
  const sy = v => PAD.t + iH - ((v - vLo) / (vHi - vLo)) * iH; // same scale

  const ticks  = niceTicks(vLo, vHi, 5);
  const fColor = weak ? C.red : C.green;
  const svgId  = `x-xhat${svgIdSuffix}`;

  return (
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 280, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* title */}
        <text x={PAD.l + iW / 2} y={16} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          {endVar} vs {endVar} instrumented (X̂)
        </text>

        {/* grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
            <line x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          </g>
        ))}

        {/* 45° reference */}
        <line x1={sx(vLo)} y1={sy(vLo)} x2={sx(vHi)} y2={sy(vHi)}
          stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3" />

        {/* scatter */}
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p.xh)} cy={sy(p.x)} r={2.5}
            fill={C.teal} opacity={0.4} />
        ))}

        {/* F-stat badge */}
        <rect x={PAD.l + iW - 92} y={PAD.t + 4} width={88} height={22}
          fill={weak ? "#100505" : "#050f08"}
          stroke={fColor + "40"} rx={3} />
        <text x={PAD.l + iW - 48} y={PAD.t + 14} textAnchor="middle"
          fill={fColor} fontSize={8} fontFamily={mono}>
          F = {Fstat != null && isFinite(Fstat) ? Fstat.toFixed(2) : "—"}
        </text>
        <text x={PAD.l + iW - 48} y={PAD.t + 23} textAnchor="middle"
          fill={weak ? C.red : C.textMuted} fontSize={7} fontFamily={mono}>
          {weak ? "⚠ weak (F<10)" : "✓ relevant"}
        </text>

        {/* axes */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t + iH} y2={PAD.t + iH + 4} stroke={C.border2} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t + iH + 14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
            <line x1={PAD.l - 4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
            <text x={PAD.l - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>X̂ (instrumented)</text>
        <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          {endVar} (observed)
        </text>
      </svg>
    </div>
  );
}

// ─── ENDOGENEITY CHECK PLOT (2SLS) ────────────────────────────────────────────
// Scatter of first-stage residuals vs second-stage residuals.
// If the instrument is valid and endogeneity was real:
//   - first-stage residuals (ν̂) correlate with second-stage residuals (ê)
//   - this confirms the endogeneity problem and the instrument's relevance
// A flat cloud = no endogeneity (OLS would have been fine).
// Props:
//   residFirst  — first-stage residuals (fs.resid from engine)
//   residSecond — second-stage residuals (second.resid)
//   endVar      — endogenous variable name (for axis label)
export function EndogeneityPlot({ residFirst, residSecond, endVar = "X_endog", svgIdSuffix = "" }) {
  if (!residFirst?.length || !residSecond?.length) return null;

  const n = Math.min(residFirst.length, residSecond.length);
  const pts = Array.from({ length: n }, (_, i) => ({
    x: residFirst[i], y: residSecond[i],
  })).filter(p => isFinite(p.x) && isFinite(p.y));
  if (pts.length < 4) return null;

  const W = 480, H = 300;
  const PAD = { l: 58, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const xVals = pts.map(p => p.x), yVals = pts.map(p => p.y);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const xPad = (xMax - xMin) * 0.05 || 1;
  const yPad = (yMax - yMin) * 0.08 || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(xLo, xHi, 5);
  const yTicks = niceTicks(yLo, yHi, 5);

  // Pearson correlation for annotation
  const xm  = xVals.reduce((s, v) => s + v, 0) / pts.length;
  const ym  = yVals.reduce((s, v) => s + v, 0) / pts.length;
  const sxx = xVals.reduce((s, v) => s + (v - xm) ** 2, 0);
  const syy = yVals.reduce((s, v) => s + (v - ym) ** 2, 0);
  const sxy = xVals.reduce((s, v, i) => s + (v - xm) * (yVals[i] - ym), 0);
  const corr = (sxx > 0 && syy > 0) ? sxy / Math.sqrt(sxx * syy) : 0;

  // OLS fit line through residuals
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intcp = ym - slope * xm;
  const hasCorr = Math.abs(corr) > 0.05;
  const lColor  = hasCorr ? C.red : C.green;

  const svgId = `endogeneity${svgIdSuffix}`;

  return (
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", minWidth: 300, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* title */}
        <text x={PAD.l + iW / 2} y={16} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          Endogeneity check — first vs second stage residuals
        </text>

        {/* grid */}
        {xTicks.map((t, i) => (
          <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}
        {yTicks.map((t, i) => (
          <line key={`gy${i}`} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
        ))}

        {/* zero lines */}
        {xLo < 0 && xHi > 0 && <line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />}
        {yLo < 0 && yHi > 0 && <line x1={PAD.l} x2={PAD.l + iW} y1={sy(0)} y2={sy(0)} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3" />}

        {/* scatter */}
        {pts.map((p, i) => (
          <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2}
            fill={hasCorr ? C.red : C.blue} opacity={0.4} />
        ))}

        {/* fit line */}
        <line
          x1={sx(xLo)} y1={sy(slope * xLo + intcp)}
          x2={sx(xHi)} y2={sy(slope * xHi + intcp)}
          stroke={lColor} strokeWidth={1.8} opacity={0.85}
        />

        {/* correlation annotation */}
        <rect x={PAD.l + 6} y={PAD.t + 4} width={110} height={22}
          fill={hasCorr ? "#100505" : "#050f08"}
          stroke={lColor + "40"} rx={3} />
        <text x={PAD.l + 61} y={PAD.t + 14} textAnchor="middle"
          fill={lColor} fontSize={8} fontFamily={mono}>
          r = {corr.toFixed(3)}
        </text>
        <text x={PAD.l + 61} y={PAD.t + 23} textAnchor="middle"
          fill={lColor} fontSize={7} fontFamily={mono}>
          {hasCorr ? "⚠ endogeneity confirmed" : "✓ residuals uncorrelated"}
        </text>

        {/* axes */}
        {xTicks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t + iH} y2={PAD.t + iH + 4} stroke={C.border2} strokeWidth={1} />
            <text x={sx(t)} y={PAD.t + iH + 14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={PAD.l - 4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1} />
            <text x={PAD.l - 8} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>
              {Math.abs(t) >= 1000 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          </g>
        ))}
        <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          ν̂ (first-stage residuals — {endVar})
        </text>
        <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          ê (second-stage residuals)
        </text>
      </svg>
    </div>
  );
}
