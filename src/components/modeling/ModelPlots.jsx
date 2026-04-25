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
    <InlinePlotShell title="Y vs Ŷ — Observed vs Fitted" svgId={svgId} filename={`y_fitted${svgIdSuffix}.svg`}>
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: 700, minWidth: 300, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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
    </InlinePlotShell>
  );
}
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
    <InlinePlotShell title={`Partial: ${yCol} ~ ${xCol} | others`} svgId={svgId} filename={`partial_${xCol.replace(/[^a-z0-9]/gi,"-")}${svgIdSuffix}.svg`}>
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: 700, minWidth: 300, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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
    </InlinePlotShell>
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
  let src = new XMLSerializer().serializeToString(el);
  // Ensure SVG namespace is present (required for \includesvg in LaTeX)
  if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) {
    src = src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }
  // Strip dark background rect so export is transparent (journal-friendly)
  src = src.replace(/<rect[^>]*fill="#080808"[^>]*\/>/g, '');
  src = src.replace(/<rect[^>]*fill="#0f0f0f"[^>]*\/>/g, '');
  // Add XML declaration for strict SVG parsers
  src = '<?xml version="1.0" encoding="UTF-8"?>\n' + src;
  const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ─── INLINE PLOT SHELL ───────────────────────────────────────────────────────
// Lightweight wrapper for inline plots (no W/H needed — SVG is self-sizing).
// Adds a thin header with label + ↓ SVG export button.
function InlinePlotShell({ title, svgId, filename, children }) {
  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.35rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
          {title}
        </span>
        <button
          onClick={() => exportSVG(svgId, filename)}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, transition: "all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>
      {children}
    </div>
  );
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
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto", display: "flex", justifyContent: "center", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 700, minWidth: Math.min(W, 340), height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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

  // fit line paths — clipped strictly to their side of the cutoff
  const leftSorted  = [...leftFit].sort((a, b) => a.x - b.x).filter(p => p.x <= cutoff);
  const rightSorted = [...rightFit].sort((a, b) => a.x - b.x).filter(p => p.x >= cutoff);
  const leftPath  = leftSorted.map((p, i)  => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`).join(" ");
  const rightPath = rightSorted.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`).join(" ");

  // LATE annotation — use last left point and first right point (both at cutoff)
  const cx     = sx(cutoff);
  const leftY  = leftSorted.length  ? sy(leftSorted[leftSorted.length - 1].yhat)  : null;
  const rightY = rightSorted.length ? sy(rightSorted[0].yhat) : null;
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

  // ── Detect whether we have a real control group ──────────────────────────
  const hasCtrl = pts.some(e => e.ctrl != null);
  const hasTrt  = pts.some(e => e.trt  != null);

  // ── Infer treatment period ────────────────────────────────────────────────
  // Priority: explicit prop → first period where both exist → first trt period
  const inferredTreat = treatPeriod
    ?? pts.find(e => e.trt != null && e.ctrl != null)?.t
    ?? pts.find(e => e.trt != null)?.t
    ?? null;

  // ── Counterfactual when no control group ─────────────────────────────────
  // CF_t = trt_t - ATT  (shift post-treatment periods down by ATT)
  // Only shown post-treatment; labeled clearly as "counterfactual (−ATT)"
  const attVal = att ?? 0;
  const cfPts = (!hasCtrl && hasTrt && inferredTreat != null && isFinite(attVal))
    ? pts
        .filter(e => e.trt != null && e.t >= inferredTreat)
        .map(e => ({ t: e.t, cf: e.trt - attVal }))
    : [];

  const W = 620, H = 360;
  const PAD = { l: 60, r: 28, t: 32, b: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const times = pts.map(e => e.t);
  const tMin  = Math.min(...times);
  const tMax  = Math.max(...times);

  const allY = [
    ...pts.flatMap(e => [e.ctrl, e.trt].filter(v => v != null)),
    ...cfPts.map(p => p.cf),
  ].filter(isFinite);
  const yMin  = Math.min(...allY);
  const yMax  = Math.max(...allY);
  const yPad  = (yMax - yMin) * 0.15 || 1;
  const yLo   = yMin - yPad;
  const yHi   = yMax + yPad;

  const sx = t => PAD.l + ((t - tMin) / (tMax - tMin || 1)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(tMin, tMax, Math.min(times.length, 8));
  const yTicks = niceTicks(yLo, yHi, 5);

  // line paths (skip nulls — handles gaps)
  function makePath(key, ptArr) {
    const segs = [];
    let cur = null;
    ptArr.forEach(e => {
      const val = e[key];
      if (val != null && isFinite(val)) {
        const x = sx(e.t).toFixed(1), y = sy(val).toFixed(1);
        if (cur === null) { cur = [`M${x},${y}`]; } else { cur.push(`L${x},${y}`); }
      } else {
        if (cur) { segs.push(cur.join(" ")); cur = null; }
      }
    });
    if (cur) segs.push(cur.join(" "));
    return segs;
  }

  const ctrlSegs = makePath("ctrl", pts);
  const trtSegs  = makePath("trt",  pts);
  const cfPath   = cfPts.length >= 2
    ? cfPts.map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.t).toFixed(1)},${sy(p.cf).toFixed(1)}`).join(" ")
    : null;

  const attSig = attP != null && attP < 0.05;
  const svgId  = "event-study-plot";

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

      {/* counterfactual line (only when no real control group) */}
      {cfPath && (
        <path d={cfPath} fill="none" stroke={C.blue}
          strokeWidth={1.8} strokeDasharray="6 4" opacity={0.75} />
      )}
      {cfPts.map((p, i) => (
        <circle key={`cf${i}`} cx={sx(p.t)} cy={sy(p.cf)} r={3}
          fill="none" stroke={C.blue} strokeWidth={1.5} opacity={0.8} />
      ))}

      {/* control line + dots (real control group) */}
      {ctrlSegs.map((d, i) => (
        <path key={`cs${i}`} d={d} fill="none" stroke={C.blue} strokeWidth={2} opacity={0.85} />
      ))}
      {hasCtrl && pts.filter(e => e.ctrl != null).map((e, i) => (
        <circle key={`cd${i}`} cx={sx(e.t)} cy={sy(e.ctrl)} r={3.5}
          fill={C.blue} opacity={0.9} />
      ))}

      {/* treated line + dots */}
      {trtSegs.map((d, i) => (
        <path key={`ts${i}`} d={d} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.85} />
      ))}
      {pts.filter(e => e.trt != null).map((e, i) => (
        <circle key={`td${i}`} cx={sx(e.t)} cy={sy(e.trt)} r={3.5}
          fill={C.orange} opacity={0.9} />
      ))}

      {/* ATT annotation — only when both lines visible at last period */}
      {(() => {
        const last = pts[pts.length - 1];
        const trtY = last.trt != null ? sy(last.trt) : null;
        const refY = last.ctrl != null
          ? sy(last.ctrl)
          : cfPts.length > 0 ? sy(cfPts[cfPts.length - 1].cf) : null;
        if (trtY == null || refY == null) return null;
        if (Math.abs(trtY - refY) < 6) return null;
        const x = sx(last.t);
        const color = attSig ? C.teal : C.textMuted;
        return (
          <g>
            <line x1={x + 12} y1={refY} x2={x + 12} y2={trtY} stroke={color} strokeWidth={1.5} />
            <line x1={x + 8} y1={refY} x2={x + 16} y2={refY} stroke={color} strokeWidth={1} />
            <line x1={x + 8} y1={trtY} x2={x + 16} y2={trtY} stroke={color} strokeWidth={1} />
            <text x={x + 18} y={(refY + trtY) / 2 + 4} fill={color} fontSize={8} fontFamily={mono}>ATT</text>
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

      {/* legend — adapts to whether we have real control or counterfactual */}
      <g transform={`translate(${PAD.l + 10}, ${PAD.t + 10})`}>
        {hasCtrl ? (
          <>
            <line x1={0} x2={18} y1={5}  y2={5}  stroke={C.blue}   strokeWidth={2} />
            <text x={22} y={9}  fill={C.textDim} fontSize={8} fontFamily={mono}>Control</text>
          </>
        ) : cfPath ? (
          <>
            <line x1={0} x2={18} y1={5} y2={5} stroke={C.blue} strokeWidth={1.8} strokeDasharray="5 3" />
            <text x={22} y={9} fill={C.textDim} fontSize={8} fontFamily={mono}>Counterfactual (−ATT)</text>
          </>
        ) : null}
        <line x1={0} x2={18} y1={hasCtrl || cfPath ? 20 : 5} y2={hasCtrl || cfPath ? 20 : 5} stroke={C.orange} strokeWidth={2} />
        <text x={22} y={hasCtrl || cfPath ? 24 : 9} fill={C.textDim} fontSize={8} fontFamily={mono}>Treated</text>
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
      <div style={{ background: C.bg, overflowX: "auto", padding: "0.5rem", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${totalW} ${totalH}`}
          style={{ width: "100%", maxWidth: 700, minWidth: 320, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 700, minWidth: 320, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 700, minWidth: 320, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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

// ─── McCRARY DENSITY PLOT ─────────────────────────────────────────────────────
// Visualizes the McCrary (2008) density discontinuity test.
// Shows histogram of running variable density + local linear fit on each side.
// A visible jump at the cutoff → potential manipulation.
//
// Props: result from runMcCrary — { bins, leftFit, rightFit, fhatLeft, fhatRight,
//   theta, thetaSE, zStat, pVal, manipulation, cutoff, h, bw, n }
export function McCraryPlot({ result, xLabel = "Running variable" }) {
  if (!result?.bins?.length) return null;

  const {
    bins, leftFit, rightFit,
    fhatLeft, fhatRight,
    theta, thetaSE, zStat, pVal,
    manipulation, cutoff, h, bw, n,
  } = result;

  const W = 580, H = 340;
  const PAD = { l: 60, r: 24, t: 32, b: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const allX = bins.map(b => b.x);
  const allY = bins.map(b => b.density);
  const fitY = [...leftFit.map(p => p.yhat), ...rightFit.map(p => p.yhat)];

  const xMin = Math.min(...allX), xMax = Math.max(...allX);
  const yMax = Math.max(...allY, ...fitY) * 1.15;
  const xPad = (xMax - xMin) * 0.02;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = 0, yHi = yMax || 1;

  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(xLo, xHi, 6);
  const yTicks = niceTicks(yLo, yHi, 5);

  // bar width in SVG units
  const barW = Math.max(1, (sx(xLo + bw) - sx(xLo)) * 0.85);

  const accentColor = manipulation ? C.red : C.green;
  const svgId = "mccrary-plot";

  // fit line paths
  const leftPath = leftFit
    .sort((a, b) => a.x - b.x)
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`)
    .join(" ");
  const rightPath = rightFit
    .sort((a, b) => a.x - b.x)
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yhat).toFixed(1)}`)
    .join(" ");

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
            McCrary Density Test
          </span>
          <span style={{
            fontSize: 9, fontFamily: mono, padding: "1px 7px",
            border: `1px solid ${accentColor}50`, borderRadius: 2, color: accentColor,
          }}>
            {manipulation ? "⚠ manipulation detected" : "✓ no manipulation"}
          </span>
          <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>
            θ = {theta.toFixed(3)} · SE = {thetaSE.toFixed(3)} · z = {zStat.toFixed(3)} · p = {pVal < 0.001 ? "<0.001" : pVal.toFixed(4)}
          </span>
        </div>
        <button
          onClick={() => {
            const el = document.getElementById(svgId);
            if (!el) return;
            const src = new XMLSerializer().serializeToString(el);
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([src], { type: "image/svg+xml" }));
            a.download = "mccrary_density.svg"; a.click();
            URL.revokeObjectURL(a.href);
          }}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, transition: "all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>

      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 700, minWidth: 340, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
          <rect width={W} height={H} fill={C.bg} />

          {/* grid */}
          {xTicks.map((t, i) => (
            <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          ))}
          {yTicks.map((t, i) => (
            <line key={`gy${i}`} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          ))}

          {/* histogram bars */}
          {bins.map((b, i) => {
            const bx  = sx(b.x) - barW / 2;
            const by  = sy(b.density);
            const bh  = Math.max(0, sy(0) - by);
            const col = b.side === "left" ? C.blue : C.orange;
            return (
              <rect key={i} x={bx} y={by} width={barW} height={bh}
                fill={col} opacity={0.35} />
            );
          })}

          {/* local linear fit lines */}
          {leftPath  && <path d={leftPath}  fill="none" stroke={C.blue}   strokeWidth={2} opacity={0.9} />}
          {rightPath && <path d={rightPath} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.9} />}

          {/* cutoff line */}
          <line x1={sx(cutoff)} x2={sx(cutoff)} y1={PAD.t} y2={PAD.t + iH}
            stroke={C.gold} strokeWidth={1.5} strokeDasharray="5 3" />
          <text x={sx(cutoff) + 5} y={PAD.t + 12}
            fill={C.gold} fontSize={9} fontFamily={mono}>c = {cutoff}</text>

          {/* density jump annotation */}
          {isFinite(fhatLeft) && isFinite(fhatRight) && fhatLeft > 0 && fhatRight > 0 && (
            <g>
              <circle cx={sx(cutoff)} cy={sy(fhatLeft)}  r={4} fill={C.blue}   opacity={0.9} />
              <circle cx={sx(cutoff)} cy={sy(fhatRight)} r={4} fill={C.orange} opacity={0.9} />
              <line
                x1={sx(cutoff)} y1={sy(fhatLeft)}
                x2={sx(cutoff)} y2={sy(fhatRight)}
                stroke={accentColor} strokeWidth={2}
              />
            </g>
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
                {t.toFixed(3)}
              </text>
            </g>
          ))}
          <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
          <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

          {/* axis labels */}
          <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
            fill={C.textDim} fontSize={9} fontFamily={mono}>{xLabel}</text>
          <text transform={`translate(12, ${PAD.t + iH / 2}) rotate(-90)`}
            textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
            Density
          </text>

          {/* legend */}
          <g transform={`translate(${PAD.l + 10}, ${PAD.t + 10})`}>
            <rect x={0} y={0} width={10} height={8} fill={C.blue}   opacity={0.5} />
            <text x={14} y={8}  fill={C.textDim} fontSize={8} fontFamily={mono}>Left of c</text>
            <rect x={0} y={14} width={10} height={8} fill={C.orange} opacity={0.5} />
            <text x={14} y={22} fill={C.textDim} fontSize={8} fontFamily={mono}>Right of c</text>
          </g>
        </svg>
      </div>

      {/* footer */}
      <div style={{ padding: "0.4rem 0.9rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono, display: "flex", justifyContent: "space-between" }}>
        <span>n = {n} · bins = {result.nBins} · bw = {bw.toFixed(4)} · fit bandwidth = {h.toFixed(4)}</span>
        <span>H₀: density continuous at cutoff · McCrary (2008, JOE)</span>
      </div>
    </div>
  );
}

// ─── Y vs X̂ PLOT (2SLS) ──────────────────────────────────────────────────────
// Y vs instrumented endogenous X̂. Slope = β_IV.
export function YXhatPlot({ Y, Xhat, beta_iv, pVal, yLabel = "Y", xLabel = "X̂", resid2, svgIdSuffix = "" }) {
  if (!Y?.length || !Xhat?.length) return null;
  const pts = Y.map((y, i) => ({ y, x: Xhat[i], e: resid2?.[i] ?? 0 }))
    .filter(p => isFinite(p.y) && isFinite(p.x));
  if (pts.length < 4) return null;

  const W = 480, H = 320;
  const PAD = { l: 58, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;

  const xVals = pts.map(p => p.x), yVals = pts.map(p => p.y);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const xPad = (xMax - xMin) * 0.05 || 1, yPad = (yMax - yMin) * 0.08 || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad, yLo = yMin - yPad, yHi = yMax + yPad;
  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;
  const xTicks = niceTicks(xLo, xHi, 5), yTicks = niceTicks(yLo, yHi, 5);

  const n = pts.length;
  const em = pts.reduce((s, p) => s + p.e, 0) / n;
  const esd = Math.sqrt(pts.reduce((s, p) => s + (p.e - em) ** 2, 0) / Math.max(1, n - 1));
  const xm = xVals.reduce((s, v) => s + v, 0) / n;
  const ym = yVals.reduce((s, v) => s + v, 0) / n;
  const slope = beta_iv ?? (() => { const sxx = xVals.reduce((s,v)=>s+(v-xm)**2,0); const sxy = xVals.reduce((s,v,i)=>s+(v-xm)*(yVals[i]-ym),0); return sxx>0?sxy/sxx:0; })();
  const intercept = ym - slope * xm;
  const sig = pVal != null && pVal < 0.05;
  const lColor = sig ? C.gold : C.textMuted;
  const svgId = `y-xhat${svgIdSuffix}`;

  return (
    <InlinePlotShell title={`${yLabel} vs ${xLabel} — IV exogenous variation`} svgId={svgId} filename={`y_xhat${svgIdSuffix}.svg`}>
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, minWidth: 300, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />
        <text x={PAD.l+iW/2} y={16} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>{yLabel} vs {xLabel} — IV exogenous variation</text>
        {xTicks.map((t,i) => <line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />)}
        {yTicks.map((t,i) => <line key={`gy${i}`} x1={PAD.l} x2={PAD.l+iW} y1={sy(t)} y2={sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />)}
        {pts.map((p, i) => { const z = esd>0?Math.abs(p.e/esd):0; const big = z>2; return <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={big?3.5:2.5} fill={big?C.red:C.violet} opacity={big?0.8:0.4} />; })}
        <line x1={sx(xLo)} y1={sy(slope*xLo+intercept)} x2={sx(xHi)} y2={sy(slope*xHi+intercept)} stroke={lColor} strokeWidth={2} opacity={0.9} />
        <text x={PAD.l+iW-4} y={PAD.t+14} textAnchor="end" fill={lColor} fontSize={9} fontFamily={mono}>β_IV = {slope>=0?"+":""}{slope.toFixed(4)}{pVal!=null?(pVal<0.01?"***":pVal<0.05?"**":pVal<0.1?"*":""):""}</text>
        {pVal!=null&&<text x={PAD.l+iW-4} y={PAD.t+25} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>p = {pVal<0.001?"<0.001":pVal.toFixed(4)}</text>}
        {xTicks.map((t,i)=><g key={i}><line x1={sx(t)} x2={sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1}/><text x={sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text></g>)}
        {yTicks.map((t,i)=><g key={i}><line x1={PAD.l-4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1}/><text x={PAD.l-8} y={sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text></g>)}
        <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>{xLabel} (instrumented)</text>
        <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>{yLabel}</text>
      </svg>
    </div>
    </InlinePlotShell>
  );
}

// ─── X vs X̂ PLOT (2SLS first stage) ─────────────────────────────────────────
// Original endogenous X vs instrumented X̂. Tight diagonal = strong instrument.
export function XvsXhatPlot({ rows, endVar, Xhat, Fstat, weak, svgIdSuffix = "" }) {
  if (!rows?.length || !endVar || !Xhat?.length) return null;
  const xVals = rows.map(r => r[endVar]).filter(v => typeof v === "number" && isFinite(v));
  if (xVals.length !== Xhat.length) return null;
  const pts = xVals.map((x, i) => ({ x, xh: Xhat[i] })).filter(p => isFinite(p.x) && isFinite(p.xh));
  if (pts.length < 4) return null;

  const W = 420, H = 300;
  const PAD = { l: 56, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
  const allV = [...pts.map(p=>p.x),...pts.map(p=>p.xh)];
  const vMin = Math.min(...allV), vMax = Math.max(...allV);
  const vPad = (vMax-vMin)*0.05||1, vLo = vMin-vPad, vHi = vMax+vPad;
  const sx = v => PAD.l + ((v-vLo)/(vHi-vLo))*iW;
  const sy = v => PAD.t + iH - ((v-vLo)/(vHi-vLo))*iH;
  const ticks = niceTicks(vLo, vHi, 5);
  const fColor = weak ? C.red : C.green;
  const svgId = `x-xhat${svgIdSuffix}`;

  return (
    <InlinePlotShell title={`${endVar} vs X̂ — instrument relevance`} svgId={svgId} filename={`x_xhat_${endVar}${svgIdSuffix}.svg`}>
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, minWidth: 280, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />
        <text x={PAD.l+iW/2} y={16} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>{endVar} vs {endVar} instrumented (X̂)</text>
        {ticks.map((t,i)=><g key={i}><line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/><line x1={PAD.l} x2={PAD.l+iW} y1={sy(t)} y2={sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/></g>)}
        <line x1={sx(vLo)} y1={sy(vLo)} x2={sx(vHi)} y2={sy(vHi)} stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3"/>
        {pts.map((p,i)=><circle key={i} cx={sx(p.xh)} cy={sy(p.x)} r={2.5} fill={C.teal} opacity={0.4}/>)}
        <rect x={PAD.l+iW-92} y={PAD.t+4} width={88} height={22} fill={weak?"#100505":"#050f08"} stroke={fColor+"40"} rx={3}/>
        <text x={PAD.l+iW-48} y={PAD.t+14} textAnchor="middle" fill={fColor} fontSize={8} fontFamily={mono}>F = {Fstat!=null&&isFinite(Fstat)?Fstat.toFixed(2):"—"}</text>
        <text x={PAD.l+iW-48} y={PAD.t+23} textAnchor="middle" fill={weak?C.red:C.textMuted} fontSize={7} fontFamily={mono}>{weak?"⚠ weak (F<10)":"✓ relevant"}</text>
        {ticks.map((t,i)=><g key={i}><line x1={sx(t)} x2={sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1}/><text x={sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text><line x1={PAD.l-4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1}/><text x={PAD.l-8} y={sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text></g>)}
        <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>X̂ (instrumented)</text>
        <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>{endVar} (observed)</text>
      </svg>
    </div>
    </InlinePlotShell>
  );
}

// ─── ENDOGENEITY CHECK PLOT (2SLS) ────────────────────────────────────────────
// First-stage residuals vs second-stage residuals.
// Correlation confirms endogeneity was real. Flat = OLS would have been fine.
export function EndogeneityPlot({ residFirst, residSecond, endVar = "X_endog", svgIdSuffix = "" }) {
  if (!residFirst?.length || !residSecond?.length) return null;
  const n = Math.min(residFirst.length, residSecond.length);
  const pts = Array.from({ length: n }, (_, i) => ({ x: residFirst[i], y: residSecond[i] }))
    .filter(p => isFinite(p.x) && isFinite(p.y));
  if (pts.length < 4) return null;

  const W = 480, H = 300;
  const PAD = { l: 58, r: 24, t: 28, b: 48 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;
  const xVals = pts.map(p=>p.x), yVals = pts.map(p=>p.y);
  const xMin=Math.min(...xVals),xMax=Math.max(...xVals),yMin=Math.min(...yVals),yMax=Math.max(...yVals);
  const xPad=(xMax-xMin)*0.05||1,yPad=(yMax-yMin)*0.08||1;
  const xLo=xMin-xPad,xHi=xMax+xPad,yLo=yMin-yPad,yHi=yMax+yPad;
  const sx = v => PAD.l+((v-xLo)/(xHi-xLo))*iW;
  const sy = v => PAD.t+iH-((v-yLo)/(yHi-yLo))*iH;
  const xTicks=niceTicks(xLo,xHi,5),yTicks=niceTicks(yLo,yHi,5);
  const xm=xVals.reduce((s,v)=>s+v,0)/pts.length,ym=yVals.reduce((s,v)=>s+v,0)/pts.length;
  const sxx=xVals.reduce((s,v)=>s+(v-xm)**2,0),syy=yVals.reduce((s,v)=>s+(v-ym)**2,0),sxy=xVals.reduce((s,v,i)=>s+(v-xm)*(yVals[i]-ym),0);
  const corr=(sxx>0&&syy>0)?sxy/Math.sqrt(sxx*syy):0;
  const slope=sxx>0?sxy/sxx:0,intcp=ym-slope*xm;
  const hasCorr=Math.abs(corr)>0.05,lColor=hasCorr?C.red:C.green;
  const svgId=`endogeneity${svgIdSuffix}`;

  return (
    <InlinePlotShell title={`Endogeneity check — ${endVar}`} svgId={svgId} filename={`endogeneity_${endVar}${svgIdSuffix}.svg`}>
    <div style={{ padding: "0.5rem", background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 700, minWidth: 300, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />
        <text x={PAD.l+iW/2} y={16} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>Endogeneity check — first vs second stage residuals</text>
        {xTicks.map((t,i)=><line key={`gx${i}`} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/>)}
        {yTicks.map((t,i)=><line key={`gy${i}`} x1={PAD.l} x2={PAD.l+iW} y1={sy(t)} y2={sy(t)} stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4}/>)}
        {xLo<0&&xHi>0&&<line x1={sx(0)} x2={sx(0)} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3"/>}
        {yLo<0&&yHi>0&&<line x1={PAD.l} x2={PAD.l+iW} y1={sy(0)} y2={sy(0)} stroke={C.border2} strokeWidth={1} strokeDasharray="4 3"/>}
        {pts.map((p,i)=><circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={2.2} fill={hasCorr?C.red:C.blue} opacity={0.4}/>)}
        <line x1={sx(xLo)} y1={sy(slope*xLo+intcp)} x2={sx(xHi)} y2={sy(slope*xHi+intcp)} stroke={lColor} strokeWidth={1.8} opacity={0.85}/>
        <rect x={PAD.l+6} y={PAD.t+4} width={110} height={22} fill={hasCorr?"#100505":"#050f08"} stroke={lColor+"40"} rx={3}/>
        <text x={PAD.l+61} y={PAD.t+14} textAnchor="middle" fill={lColor} fontSize={8} fontFamily={mono}>r = {corr.toFixed(3)}</text>
        <text x={PAD.l+61} y={PAD.t+23} textAnchor="middle" fill={lColor} fontSize={7} fontFamily={mono}>{hasCorr?"⚠ endogeneity confirmed":"✓ residuals uncorrelated"}</text>
        {xTicks.map((t,i)=><g key={i}><line x1={sx(t)} x2={sx(t)} y1={PAD.t+iH} y2={PAD.t+iH+4} stroke={C.border2} strokeWidth={1}/><text x={sx(t)} y={PAD.t+iH+14} textAnchor="middle" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text></g>)}
        {yTicks.map((t,i)=><g key={i}><line x1={PAD.l-4} x2={PAD.l} y1={sy(t)} y2={sy(t)} stroke={C.border2} strokeWidth={1}/><text x={PAD.l-8} y={sy(t)+3} textAnchor="end" fill={C.textMuted} fontSize={8} fontFamily={mono}>{Math.abs(t)>=1000?t.toExponential(1):t.toFixed(2)}</text></g>)}
        <line x1={PAD.l} x2={PAD.l+iW} y1={PAD.t+iH} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={PAD.t+iH} stroke={C.border2} strokeWidth={1}/>
        <text x={PAD.l+iW/2} y={H-4} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>ν̂ (first-stage residuals — {endVar})</text>
        <text transform={`translate(12,${PAD.t+iH/2}) rotate(-90)`} textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>ê (second-stage residuals)</text>
      </svg>
    </div>
    </InlinePlotShell>
  );
}
