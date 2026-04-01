// ─── ECON STUDIO · src/components/modeling/ResidualPlots.jsx ─────────────────
// Residual diagnostic plots for OLS, FE, and FD results.
// All components are stateless — receive engine output as props, render SVG.
//
// Exports:
//   ResidualVsFitted   — scatter of ê vs ŷ with LOWESS smoother + zero line
//   QQPlot             — Normal Q-Q plot with 45° reference line + confidence band
//   ResidualPlots      — Shell that renders both, collapsible, used in ModelingTab
//
// Data requirements (all present in LinearEngine / PanelEngine output):
//   resid  — array of residuals
//   Yhat   — array of fitted values
//
// Depends on: C, mono from ./shared.jsx

import { C, mono } from "./shared.jsx";

// ─── SHARED HELPERS ───────────────────────────────────────────────────────────

function niceTicks(lo, hi, n = 5) {
  const range = hi - lo;
  if (range === 0) return [lo];
  const step = Math.pow(10, Math.floor(Math.log10(range / n)));
  const nice = [1, 2, 2.5, 5, 10].find(s => range / (s * step) <= n) * step;
  const start = Math.ceil(lo / nice) * nice;
  const out = [];
  for (let v = start; v <= hi + nice * 0.01; v += nice)
    out.push(parseFloat(v.toFixed(10)));
  return out.length >= 2 ? out : [lo, hi];
}

function exportSVG(svgId, filename) {
  const el = document.getElementById(svgId);
  if (!el) return;
  let src = new XMLSerializer().serializeToString(el);
  if (!src.includes('xmlns="http://www.w3.org/2000/svg"')) {
    src = src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
  }
  src = src.replace(/<rect[^>]*fill="#080808"[^>]*\/>/g, '');
  src = src.replace(/<rect[^>]*fill="#0f0f0f"[^>]*\/>/g, '');
  src = '<?xml version="1.0" encoding="UTF-8"?>\n' + src;
  const blob = new Blob([src], { type: "image/svg+xml;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function AxisBottom({ sx, ticks, y, fmt = v => v.toFixed(2) }) {
  return (
    <g>
      <line x1={sx(ticks[0])} x2={sx(ticks[ticks.length - 1])}
        y1={y} y2={y} stroke={C.border2} strokeWidth={1} />
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={sx(t)} x2={sx(t)} y1={y} y2={y + 4}
            stroke={C.border2} strokeWidth={1} />
          <text x={sx(t)} y={y + 14} textAnchor="middle"
            fill={C.textMuted} fontSize={8} fontFamily={mono}>{fmt(t)}</text>
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
          <line x1={x - 4} x2={x} y1={sy(t)} y2={sy(t)}
            stroke={C.border2} strokeWidth={1} />
          <text x={x - 8} y={sy(t) + 3} textAnchor="end"
            fill={C.textMuted} fontSize={8} fontFamily={mono}>{fmt(t)}</text>
        </g>
      ))}
    </g>
  );
}

// ─── LOWESS SMOOTHER ─────────────────────────────────────────────────────────
// Locally weighted regression smoother. f = bandwidth fraction (0.3 default).
// Returns [{x, y}] sorted by x, ~40 evaluation points.
function lowess(xs, ys, f = 0.3) {
  const n = xs.length;
  if (n < 4) return xs.map((x, i) => ({ x, y: ys[i] }));
  const h = Math.max(2, Math.floor(f * n));

  // evaluate at 40 evenly-spaced x points
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const pts = Array.from({ length: 40 }, (_, i) => xMin + (i / 39) * (xMax - xMin));

  return pts.map(x0 => {
    // distances to all data points
    const dists = xs.map((x, i) => ({ i, d: Math.abs(x - x0) }))
      .sort((a, b) => a.d - b.d);
    const neighbors = dists.slice(0, h);
    const maxD = neighbors[neighbors.length - 1].d || 1;

    // tricube weights
    const w = neighbors.map(({ i, d }) => {
      const u = d / maxD;
      const t = Math.max(0, 1 - u * u * u);
      return { i, w: t * t * t };
    });

    const sw  = w.reduce((s, { w }) => s + w, 0);
    const swx = w.reduce((s, { i, w }) => s + w * xs[i], 0);
    const swy = w.reduce((s, { i, w }) => s + w * ys[i], 0);
    const swxx = w.reduce((s, { i, w }) => s + w * xs[i] * xs[i], 0);
    const swxy = w.reduce((s, { i, w }) => s + w * xs[i] * ys[i], 0);

    const det = sw * swxx - swx * swx;
    if (Math.abs(det) < 1e-12) return { x: x0, y: swy / (sw || 1) };
    const b = (sw * swxy - swx * swy) / det;
    const a = (swy - b * swx) / sw;
    return { x: x0, y: a + b * x0 };
  });
}

// ─── NORMAL QUANTILES ─────────────────────────────────────────────────────────
// Rational approximation (Abramowitz & Stegun 26.2.17) — sufficient for Q-Q.
function normalQuantile(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  const a = [0, -3.969683028665376e1, 2.209460984245205e2,
    -2.759285104469687e2, 1.383577518672690e2,
    -3.066479806614716e1, 2.506628277459239];
  const b = [0, -5.447609879822406e1, 1.615858368580409e2,
    -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1,
    -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1,
    2.445134137142996, 3.754408661907416];
  const pLow = 0.02425, pHigh = 1 - pLow;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[1]*r+a[2])*r+a[3])*r+a[4])*r+a[5])*r+a[6])*q /
           (((((b[1]*r+b[2])*r+b[3])*r+b[4])*r+b[5])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// ─── RESIDUALS VS FITTED ──────────────────────────────────────────────────────
// Scatter of residuals (ê) vs fitted values (ŷ).
// - Zero reference line
// - LOWESS smoother to detect non-linearity / heteroskedasticity patterns
// - Outlier labels for |standardized residual| > 2.5
export function ResidualVsFitted({ resid, Yhat, svgIdSuffix = "" }) {
  if (!resid?.length || !Yhat?.length) return null;

  const W = 560, H = 320;
  const PAD = { l: 56, r: 24, t: 24, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  // standardize residuals for outlier detection
  const n    = resid.length;
  const mean = resid.reduce((s, v) => s + v, 0) / n;
  const sd   = Math.sqrt(resid.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));

  const pts = resid.map((e, i) => ({
    x: Yhat[i], y: e,
    z: sd > 0 ? (e - mean) / sd : 0,
  })).filter(p => isFinite(p.x) && isFinite(p.y));

  if (pts.length < 3) return null;

  const xVals = pts.map(p => p.x);
  const yVals = pts.map(p => p.y);
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(...yVals), yMax = Math.max(...yVals);
  const xPad = (xMax - xMin) * 0.04 || 1;
  const yPad = (yMax - yMin) * 0.1  || 1;
  const xLo = xMin - xPad, xHi = xMax + xPad;
  const yLo = yMin - yPad, yHi = yMax + yPad;

  const sx = v => PAD.l + ((v - xLo) / (xHi - xLo)) * iW;
  const sy = v => PAD.t + iH - ((v - yLo) / (yHi - yLo)) * iH;

  const xTicks = niceTicks(xLo, xHi, 6);
  const yTicks = niceTicks(yLo, yHi, 5);

  // LOWESS path
  const smooth = lowess(xVals, yVals);
  const smoothPath = smooth
    .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`)
    .join(" ");

  // outliers: |z| > 2.5, max 6 labels to avoid clutter
  const outliers = pts
    .map((p, i) => ({ ...p, i }))
    .filter(p => Math.abs(p.z) > 2.5)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
    .slice(0, 6);

  const svgId = `resid-fitted${svgIdSuffix}`;

  return (
    <div style={{ background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: 700, minWidth: 320, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
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

        {/* zero line */}
        {yLo < 0 && yHi > 0 && (
          <line x1={PAD.l} x2={PAD.l + iW} y1={sy(0)} y2={sy(0)}
            stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3" />
        )}

        {/* scatter */}
        {pts.map((p, i) => {
          const outlier = Math.abs(p.z) > 2.5;
          return (
            <circle key={i}
              cx={sx(p.x)} cy={sy(p.y)} r={outlier ? 3.5 : 2.5}
              fill={outlier ? C.red : C.blue}
              opacity={outlier ? 0.85 : 0.45}
            />
          );
        })}

        {/* LOWESS smoother */}
        <path d={smoothPath} fill="none" stroke={C.gold}
          strokeWidth={1.8} opacity={0.85} />

        {/* outlier index labels */}
        {outliers.map((p, i) => (
          <text key={i} x={sx(p.x) + 5} y={sy(p.y) - 5}
            fill={C.red} fontSize={7.5} fontFamily={mono} opacity={0.8}>
            {p.i}
          </text>
        ))}

        <AxisBottom sx={sx} ticks={xTicks} y={PAD.t + iH}
          fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)} />
        <AxisLeft sy={sy} ticks={yTicks} x={PAD.l}
          fmt={v => Math.abs(v) >= 1000 ? v.toExponential(1) : v.toFixed(2)} />

        {/* axis labels */}
        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>Fitted values (ŷ)</text>
        <text transform={`translate(11, ${PAD.t + iH / 2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          Residuals (ê)
        </text>

        {/* LOWESS legend */}
        <line x1={PAD.l + iW - 80} x2={PAD.l + iW - 60} y1={PAD.t + 12} y2={PAD.t + 12}
          stroke={C.gold} strokeWidth={1.8} />
        <text x={PAD.l + iW - 56} y={PAD.t + 16}
          fill={C.textDim} fontSize={8} fontFamily={mono}>LOWESS</text>
      </svg>
    </div>
  );
}

// ─── Q-Q PLOT ─────────────────────────────────────────────────────────────────
// Normal probability plot of standardized residuals.
// - 45° reference line (theoretical normal)
// - 95% pointwise confidence band (approximate: ±1.36/√n)
// - Outlier labels for extreme quantiles
export function QQPlot({ resid, svgIdSuffix = "" }) {
  if (!resid?.length) return null;

  const W = 560, H = 320;
  const PAD = { l: 56, r: 24, t: 24, b: 48 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;

  const n    = resid.length;
  const mean = resid.reduce((s, v) => s + v, 0) / n;
  const sd   = Math.sqrt(resid.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));

  if (sd === 0) return null;

  // standardize + sort
  const sorted = resid
    .map(e => (e - mean) / sd)
    .filter(isFinite)
    .sort((a, b) => a - b);
  const m = sorted.length;

  // theoretical quantiles (Blom formula: (i - 3/8) / (n + 1/4))
  const theoretical = sorted.map((_, i) => normalQuantile((i + 1 - 0.375) / (m + 0.25)));

  const pts = sorted.map((y, i) => ({ x: theoretical[i], y }))
    .filter(p => isFinite(p.x) && isFinite(p.y));

  if (pts.length < 3) return null;

  const allX = pts.map(p => p.x);
  const allY = pts.map(p => p.y);
  const lo = Math.min(Math.min(...allX), Math.min(...allY));
  const hi = Math.max(Math.max(...allX), Math.max(...allY));
  const pad = (hi - lo) * 0.06 || 0.3;
  const axLo = lo - pad, axHi = hi + pad;

  const sx = v => PAD.l + ((v - axLo) / (axHi - axLo)) * iW;
  const sy = v => PAD.t + iH - ((v - axLo) / (axHi - axLo)) * iH; // same scale both axes

  const ticks = niceTicks(axLo, axHi, 6);

  // 95% CI band: approximate KS-based envelope ±1.36/√n (Lilliefors)
  const ciHw = 1.36 / Math.sqrt(m);
  const bandPts = pts.map(p => ({ x: p.x, yLo: p.x - ciHw, yHi: p.x + ciHw }));
  const bandTop = bandPts.map((p, i) =>
    `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yHi).toFixed(1)}`).join(" ");
  const bandBot = [...bandPts].reverse().map((p, i) =>
    `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)},${sy(p.yLo).toFixed(1)}`).join(" ");

  // reference line: y = x
  const refPath = `M${sx(axLo).toFixed(1)},${sy(axLo).toFixed(1)} L${sx(axHi).toFixed(1)},${sy(axHi).toFixed(1)}`;

  // flag points outside band
  const outside = pts.filter(p => p.y < p.x - ciHw || p.y > p.x + ciHw);

  const svgId = `qq-plot${svgIdSuffix}`;

  return (
    <div style={{ background: C.bg, overflowX: "auto", display: "flex", justifyContent: "center" }}>
      <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", maxWidth: 700, minWidth: 320, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* grid */}
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={PAD.t + iH}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
            <line x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" opacity={0.4} />
          </g>
        ))}

        {/* CI band */}
        <path d={`${bandTop} ${bandBot} Z`}
          fill={C.teal} opacity={0.08} />
        <path d={bandTop} fill="none" stroke={C.teal} strokeWidth={1} opacity={0.3} strokeDasharray="3 3" />
        <path d={bandBot} fill="none" stroke={C.teal} strokeWidth={1} opacity={0.3} strokeDasharray="3 3" />

        {/* reference line y = x */}
        <path d={refPath} fill="none" stroke={C.border2} strokeWidth={1.5} strokeDasharray="5 3" />

        {/* scatter */}
        {pts.map((p, i) => {
          const out = outside.includes(p);
          return (
            <circle key={i}
              cx={sx(p.x)} cy={sy(p.y)} r={out ? 3.2 : 2.4}
              fill={out ? C.red : C.violet}
              opacity={out ? 0.9 : 0.55}
            />
          );
        })}

        <AxisBottom sx={sx} ticks={ticks} y={PAD.t + iH}
          fmt={v => v.toFixed(1)} />
        <AxisLeft sy={sy} ticks={ticks} x={PAD.l}
          fmt={v => v.toFixed(1)} />

        {/* axis labels */}
        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle"
          fill={C.textDim} fontSize={9} fontFamily={mono}>
          Theoretical quantiles (Normal)
        </text>
        <text transform={`translate(11, ${PAD.t + iH / 2}) rotate(-90)`}
          textAnchor="middle" fill={C.textDim} fontSize={9} fontFamily={mono}>
          Standardized residuals
        </text>

        {/* outside count annotation */}
        {outside.length > 0 && (
          <text x={PAD.l + iW - 4} y={PAD.t + 14} textAnchor="end"
            fill={C.red} fontSize={8} fontFamily={mono} opacity={0.8}>
            {outside.length} pt{outside.length > 1 ? "s" : ""} outside 95% band
          </text>
        )}

        {/* CI band legend */}
        <rect x={PAD.l + 8} y={PAD.t + 8} width={10} height={8}
          fill={C.teal} opacity={0.2} />
        <text x={PAD.l + 22} y={PAD.t + 16}
          fill={C.textDim} fontSize={8} fontFamily={mono}>95% CI band</text>
      </svg>
    </div>
  );
}

// ─── RESIDUAL PLOTS SHELL ─────────────────────────────────────────────────────
// Collapsible panel rendering both plots side by side (or stacked on narrow screens).
// Accepts the raw engine result object — pulls resid and Yhat automatically.
// modelLabel: shown in the header (e.g. "OLS", "FE", "FD")
export function ResidualPlots({ result, modelLabel = "OLS", svgIdSuffix = "" }) {
  const resid = result?.resid;
  const Yhat  = result?.Yhat;
  if (!resid?.length || !Yhat?.length) return null;

  const n   = resid.length;
  const mean = resid.reduce((s, v) => s + v, 0) / n;
  const sd   = Math.sqrt(resid.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, n - 1));

  // Jarque-Bera approximation for the header annotation
  const skew = resid.reduce((s, v) => s + ((v - mean) / sd) ** 3, 0) / n;
  const kurt = resid.reduce((s, v) => s + ((v - mean) / sd) ** 4, 0) / n - 3;
  const JB   = n / 6 * (skew ** 2 + kurt ** 2 / 4);
  const JBp  = Math.exp(-JB / 2); // chi2(2) approx
  const normalOk = JBp > 0.05;

  const handleExportBoth = () => {
    exportSVG(`resid-fitted${svgIdSuffix}`, `${modelLabel}_resid_fitted.svg`);
    setTimeout(() => exportSVG(`qq-plot${svgIdSuffix}`, `${modelLabel}_qq_plot.svg`), 300);
  };

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 4,
      overflow: "hidden", marginBottom: "1.2rem",
    }}>
      {/* header */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.45rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{
            fontSize: 9, color: C.textMuted, letterSpacing: "0.18em",
            textTransform: "uppercase", fontFamily: mono,
          }}>
            ◈ Residual Diagnostics · {modelLabel}
          </span>
          <span style={{
            fontSize: 9, fontFamily: mono, padding: "1px 6px",
            border: `1px solid ${normalOk ? C.green + "50" : C.yellow + "50"}`,
            borderRadius: 2,
            color: normalOk ? C.green : C.yellow,
          }}>
            Jarque-Bera p = {JBp < 0.001 ? "<0.001" : JBp.toFixed(3)}
            {normalOk ? " · ✓ normality" : " · ⚠ non-normal"}
          </span>
        </div>
        <button
          onClick={handleExportBoth}
          style={{
            padding: "0.2rem 0.6rem", background: "transparent",
            border: `1px solid ${C.border2}`, borderRadius: 3,
            color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9,
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >
          ↓ both SVG
        </button>
      </div>

      {/* two plots side by side */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr",
        gap: 1, background: C.border,
      }}>
        <div style={{ background: C.bg }}>
          <div style={{
            padding: "0.35rem 0.7rem", borderBottom: `1px solid ${C.border}`,
            fontSize: 8, color: C.textMuted, letterSpacing: "0.14em",
            textTransform: "uppercase", fontFamily: mono, background: "#0a0a0a",
          }}>
            Residuals vs Fitted
          </div>
          <div style={{ padding: "0.4rem" }}>
            <ResidualVsFitted resid={resid} Yhat={Yhat} svgIdSuffix={svgIdSuffix} />
          </div>
        </div>
        <div style={{ background: C.bg }}>
          <div style={{
            padding: "0.35rem 0.7rem", borderBottom: `1px solid ${C.border}`,
            fontSize: 8, color: C.textMuted, letterSpacing: "0.14em",
            textTransform: "uppercase", fontFamily: mono, background: "#0a0a0a",
          }}>
            Normal Q-Q
          </div>
          <div style={{ padding: "0.4rem" }}>
            <QQPlot resid={resid} svgIdSuffix={svgIdSuffix} />
          </div>
        </div>
      </div>

      {/* footer note */}
      <div style={{
        padding: "0.4rem 0.9rem", background: "#0a0a0a",
        borderTop: `1px solid ${C.border}`,
        fontSize: 9, color: C.textMuted, fontFamily: mono,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>n = {n} residuals · LOWESS smoother (f = 0.30) · red = |z| &gt; 2.5</span>
        <span>Q-Q band: ±1.36/√n (95% Lilliefors) · Blom quantile formula</span>
      </div>
    </div>
  );
}
