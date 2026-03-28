// ─── ECON STUDIO · ReportingModule.jsx ───────────────────────────────────────
// Publication-ready reporting layer.
// Consumes a `result` object emitted by ModelingTab (the active regression result).
//
// result shape (normalised inside this module — see normaliseResult()):
//   { varNames, beta, se, tStats, pVals, R2, adjR2, n, df,
//     modelLabel, yVar, xVars, Fstat?, Fpval?, att?, attSE?, attP? }
//
// Usage from ModelingTab (or App.jsx):
//   <ReportingModule result={activeResult} onClose={...} />

import { useState, useEffect, useRef, useMemo } from "react";
import { stars, buildLatex } from "./EconometricsEngine.js";
import { interpretRegression } from "./AIService.js";

// ─── THEME ────────────────────────────────────────────────────────────────────
const C = {
  bg:"#080808", surface:"#0f0f0f", surface2:"#131313", surface3:"#161616",
  border:"#1c1c1c", border2:"#252525",
  gold:"#c8a96e", goldDim:"#7a6040", goldFaint:"#1a1408",
  text:"#ddd8cc", textDim:"#888", textMuted:"#444",
  green:"#7ab896", red:"#c47070", yellow:"#c8b46e",
  blue:"#6e9ec8", purple:"#a87ec8", teal:"#6ec8b4", orange:"#c88e6e",
  violet:"#9e7ec8",
};
const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── SAFE NUMBER FORMATTER ────────────────────────────────────────────────────
// Central utility: returns val.toFixed(dp) for valid finite numbers, 'N/A' for
// anything else (null, undefined, NaN, Infinity). Used everywhere a number is
// displayed so a single bad value can never crash the render cycle.
function safeNum(val, dp = 4) {
  if (val == null || !isFinite(val)) return "N/A";
  return val.toFixed(dp);
}

// ─── RESULT NORMALISER ────────────────────────────────────────────────────────
// Different estimators return slightly different shapes. This gives us one
// consistent object the rest of the module can rely on.
function normaliseResult(raw) {
  if (!raw) return null;

  // Engine returned an error object — surface it cleanly
  if (raw.error) return { __error: raw.error };

  // 2SLS wraps everything in raw.second
  const core = raw.second ?? raw;

  const {
    varNames = [], beta = [], se = [], tStats = [], pVals = [],
    R2 = null, adjR2 = null, n = null, df = null,
    Fstat = null, Fpval = null,
    att = null, attSE = null, attP = null,
    modelLabel = "OLS", yVar = "y", xVars = [],
  } = core;

  // Sanitise every numeric array: replace undefined/null entries with NaN so
  // downstream guards (isFinite) work uniformly instead of crashing on .toFixed()
  const clean = arr => (arr ?? []).map(v => (v == null ? NaN : v));

  return {
    varNames: varNames ?? [],
    beta:   clean(beta),
    se:     clean(se),
    tStats: clean(tStats),
    pVals:  clean(pVals),
    R2, adjR2, n, df, Fstat, Fpval,
    att, attSE, attP, modelLabel, yVar, xVars,
    firstStages: raw.firstStages ?? null,
  };
}

// ─── AI CALL ──────────────────────────────────────────────────────────────────
// Delegated to AIService.js — interpretRegression() handles prompts + API call.

// ─── ATOMS ────────────────────────────────────────────────────────────────────
function Lbl({ children, color = C.textMuted, mb = 6 }) {
  return (
    <div style={{ fontSize: 10, color, letterSpacing: "0.2em", textTransform: "uppercase",
                  marginBottom: mb, fontFamily: mono }}>
      {children}
    </div>
  );
}
function Btn({ onClick, ch, color = C.gold, v = "out", dis = false, sm = false }) {
  const b = { padding: sm ? "0.28rem 0.65rem" : "0.48rem 0.95rem", borderRadius: 3,
               cursor: dis ? "not-allowed" : "pointer", fontFamily: mono,
               fontSize: sm ? 10 : 11, transition: "all 0.13s", opacity: dis ? 0.4 : 1 };
  if (v === "solid") return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: color, color: C.bg, border: `1px solid ${color}`, fontWeight: 700 }}>
      {ch}
    </button>
  );
  if (v === "ghost") return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: "transparent", border: "none", color: dis ? C.textMuted : color }}>
      {ch}
    </button>
  );
  return (
    <button onClick={onClick} disabled={dis}
      style={{ ...b, background: "transparent", border: `1px solid ${C.border2}`,
               color: dis ? C.textMuted : C.textDim }}>
      {ch}
    </button>
  );
}
function Spin() {
  return (
    <div style={{ width: 14, height: 14, border: `2px solid ${C.border2}`,
                  borderTopColor: C.gold, borderRadius: "50%",
                  animation: "spin 0.7s linear infinite", flexShrink: 0 }} />
  );
}
function CopyBtn({ text, label = "Copy", successLabel = "Copied ✓", color = C.teal }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button onClick={copy}
      style={{ padding: "0.28rem 0.75rem", borderRadius: 3, cursor: "pointer",
               fontFamily: mono, fontSize: 10, border: `1px solid ${copied ? color : C.border2}`,
               background: copied ? `${color}18` : "transparent",
               color: copied ? color : C.textDim, transition: "all 0.15s" }}>
      {copied ? successLabel : label}
    </button>
  );
}

// ─── 1. COEFFICIENT FOREST PLOT ───────────────────────────────────────────────
// Teal diamond = significant (p < 0.05), grey = not significant.
// Each row: label | CI whisker + point | β value
function ForestPlot({ varNames, beta, se, pVals }) {
  const items = useMemo(() =>
    varNames
      .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
      .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s)),
  [varNames, beta, se, pVals]);

  if (!items.length) return (
    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono, padding: "1rem" }}>
      No coefficients to plot (intercept-only or empty result).
    </div>
  );

  // Dynamic sizing
  const rowH    = 34;
  const PAD     = { l: 148, r: 72, t: 20, b: 24 };
  const W       = 620;
  const iW      = W - PAD.l - PAD.r;
  const H       = items.length * rowH + PAD.t + PAD.b;

  // Scale: include all CI endpoints + zero
  const lo = Math.min(0, ...items.map(d => d.b - 1.96 * d.s));
  const hi = Math.max(0, ...items.map(d => d.b + 1.96 * d.s));
  const range = hi - lo || 1;
  const sx  = v => PAD.l + ((v - lo) / range) * iW;
  const zero = sx(0);

  // Nice axis ticks: 5 evenly spaced
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (range * i) / 4);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", minWidth: 400, display: "block", fontFamily: mono }}>
        {/* Background */}
        <rect width={W} height={H} fill={C.bg} />

        {/* Alternating row bands */}
        {items.map((_, i) => (
          <rect key={i}
            x={PAD.l} y={PAD.t + i * rowH}
            width={iW} height={rowH}
            fill={i % 2 === 0 ? C.surface : C.surface2}
            opacity={0.6} />
        ))}

        {/* Tick grid lines */}
        {ticks.map((t, i) => (
          <line key={i}
            x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b}
            stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* Zero reference line */}
        {zero >= PAD.l && zero <= PAD.l + iW && (
          <line x1={zero} x2={zero} y1={PAD.t} y2={H - PAD.b}
                stroke={C.border2} strokeWidth={1.5} />
        )}

        {/* Rows */}
        {items.map((d, i) => {
          const cy   = PAD.t + i * rowH + rowH / 2;
          const cx   = sx(d.b);
          const ciLo = Math.max(PAD.l, sx(d.b - 1.96 * d.s));
          const ciHi = Math.min(PAD.l + iW, sx(d.b + 1.96 * d.s));
          const sig  = d.p < 0.05;
          const dotC = sig ? C.teal : C.textMuted;
          const lblC = sig ? C.text : C.textDim;
          const capLen = 5;

          return (
            <g key={d.v}>
              {/* CI whisker */}
              <line x1={ciLo} x2={ciHi} y1={cy} y2={cy}
                    stroke={dotC} strokeWidth={sig ? 1.5 : 1} opacity={sig ? 0.8 : 0.45} />
              {/* CI caps */}
              <line x1={sx(d.b - 1.96 * d.s)} x2={sx(d.b - 1.96 * d.s)}
                    y1={cy - capLen} y2={cy + capLen}
                    stroke={dotC} strokeWidth={1} opacity={0.6} />
              <line x1={sx(d.b + 1.96 * d.s)} x2={sx(d.b + 1.96 * d.s)}
                    y1={cy - capLen} y2={cy + capLen}
                    stroke={dotC} strokeWidth={1} opacity={0.6} />
              {/* Point — filled diamond if sig, hollow if not */}
              <rect x={cx - 5} y={cy - 5} width={10} height={10}
                    fill={sig ? dotC : "transparent"}
                    stroke={dotC} strokeWidth={sig ? 0 : 1.5}
                    opacity={sig ? 0.9 : 0.55}
                    transform={`rotate(45,${cx},${cy})`} />
              {/* Variable label */}
              <text x={PAD.l - 10} y={cy + 4} textAnchor="end"
                    fill={lblC} fontSize={10.5}>
                {d.v.length > 18 ? d.v.slice(0, 17) + "…" : d.v}
              </text>
              {/* β value + stars */}
              <text x={PAD.l + iW + 8} y={cy + 4} textAnchor="start"
                    fill={dotC} fontSize={9.5} fontFamily={mono}>
                {isFinite(d.b) && d.b > 0 ? "+" : ""}{safeNum(d.b, 3)}{stars(d.p)}
              </text>
              {/* p-value hint */}
              <text x={PAD.l + iW + 8} y={cy + 15} textAnchor="start"
                    fill={C.textMuted} fontSize={8} fontFamily={mono}>
                p={!isFinite(d.p) ? "N/A" : d.p < 0.001 ? "<.001" : safeNum(d.p, 3)}
              </text>
            </g>
          );
        })}

        {/* X axis */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={H - PAD.b} y2={H - PAD.b}
              stroke={C.border2} strokeWidth={1} />
        {ticks.map((t, i) => (
          <text key={i} x={sx(t)} y={H - PAD.b + 12}
                textAnchor="middle" fill={C.textMuted} fontSize={8}>
            {t === 0 ? "0" : safeNum(t, 2)}
          </text>
        ))}
        <text x={PAD.l + iW / 2} y={H - 3}
              textAnchor="middle" fill={C.textMuted} fontSize={8}>
          Coefficient estimate with 95% CI  ·  ◆ p&lt;0.05  ◇ n.s.
        </text>
      </svg>
    </div>
  );
}

// ─── 2. LATEX EXPORT ──────────────────────────────────────────────────────────
// Generates a stargazer-style tabular with footnotes, significance stars,
// fit statistics. Supports multi-model comparison if models[] is provided.
function buildStargazer(models) {
  // models: [{ label, result, yVar }]
  // Collect union of varNames across all models (minus Intercept, added at bottom)
  const allVars = [];
  models.forEach(({ result: r }) => {
    (r.varNames ?? []).forEach(v => {
      if (v !== "(Intercept)" && !allVars.includes(v)) allVars.push(v);
    });
  });

  const fmtB = (b, p) => {
    if (b == null || !isFinite(b)) return "        N/A";
    return `${b >= 0 ? " " : ""}${b.toFixed(4)}${stars(p ?? 1)}`.padStart(12);
  };
  const fmtSE = se => {
    if (se == null || !isFinite(se)) return "      (N/A)";
    return `(${se.toFixed(4)})`.padStart(12);
  };
  const fmtP  = p  => (p < 0.001 ? "<0.001" : p.toFixed(4)).padStart(12);
  const dash  = "            ";

  const colsN  = models.length;
  const colFmt = "l" + " r".repeat(colsN);
  const header = ["Variable", ...models.map((m, i) => `(${i + 1}) ${m.label}`)];
  const hline  = "\\hline";
  const sep    = " & ";

  function modelVal(m, varName, key) {
    const idx = m.result.varNames?.indexOf(varName) ?? -1;
    if (idx < 0) return dash;
    const r = m.result;
    const b = r.beta?.[idx], p = r.pVals?.[idx], se = r.se?.[idx];
    if (key === "b")  return fmtB(b, p);
    if (key === "se") return fmtSE(se);
    return dash;
  }

  const rows = [];

  // Regressors (no intercept yet)
  allVars.forEach(v => {
    const label = v.replace(/_/g, "\\_");
    rows.push(`  ${label}${sep}${models.map(m => modelVal(m, v, "b")).join(sep)} \\\\`);
    rows.push(`  ${" ".repeat(label.length)}${sep}${models.map(m => modelVal(m, v, "se")).join(sep)} \\\\`);
  });

  // Intercept always last
  const intV = "(Intercept)";
  rows.push(`  \\hline`);
  rows.push(`  Intercept${sep}${models.map(m => modelVal(m, intV, "b")).join(sep)} \\\\`);
  rows.push(`  ${" ".repeat(9)}${sep}${models.map(m => modelVal(m, intV, "se")).join(sep)} \\\\`);

  // Fit stats
  rows.push(`  \\hline`);
  rows.push(`  $R^2$${sep}${models.map(m =>
    (m.result.R2 != null && isFinite(m.result.R2)) ? m.result.R2.toFixed(4).padStart(12) : dash).join(sep)} \\\\`);
  rows.push(`  Adj. $R^2$${sep}${models.map(m =>
    (m.result.adjR2 != null && isFinite(m.result.adjR2)) ? m.result.adjR2.toFixed(4).padStart(12) : dash).join(sep)} \\\\`);
  rows.push(`  $n$${sep}${models.map(m =>
    m.result.n != null ? String(m.result.n).padStart(12) : dash).join(sep)} \\\\`);

  const yVarDisplay = models.map(m => `\\texttt{${(m.yVar ?? "y").replace(/_/g, "\\_")}}`);
  const caption = colsN === 1
    ? `Regression Results: ${yVarDisplay[0]}`
    : `Regression Results`;

  return [
    `% Generated by Econ Studio · LMU Munich`,
    `\\begin{table}[htbp]`,
    `\\centering`,
    `\\caption{${caption}}`,
    `\\label{tab:results}`,
    `\\begin{tabular}{${colFmt}}`,
    `\\hline\\hline`,
    header.map(h => h.replace(/_/g, "\\_")).join(sep) + " \\\\",
    hline,
    ...rows,
    `\\hline`,
    `\\multicolumn{${colsN + 1}}{l}{\\textit{Note: }Standard errors in parentheses.} \\\\`,
    `\\multicolumn{${colsN + 1}}{l}{Significance codes: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\`,
    `\\hline`,
    `\\end{tabular}`,
    `\\end{table}`,
  ].join("\n");
}

function LatexPanel({ result, modelLabel, yVar }) {
  const latex = useMemo(
    () => buildStargazer([{ label: modelLabel, result, yVar }]),
    [result, modelLabel, yVar]
  );
  return (
    <div>
      <div style={{ fontSize: 11, color: C.textDim, fontFamily: mono, lineHeight: 1.7,
                    marginBottom: "1rem", padding: "0.65rem 1rem",
                    background: C.surface, border: `1px solid ${C.border}`,
                    borderLeft: `3px solid ${C.gold}`, borderRadius: 4 }}>
        Stargazer-style table. Paste directly into your{" "}
        <span style={{ color: C.gold }}>LaTeX</span> document.
        Add <code style={{ color: C.teal, fontSize: 10 }}>{"\\usepackage{booktabs}"}</code>{" "}
        to your preamble if you use <code style={{ color: C.teal, fontSize: 10 }}>\\toprule</code>.
      </div>
      <div style={{ position: "relative" }}>
        <pre style={{
          background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 4,
          padding: "1rem 1rem 1rem 1rem", fontSize: 10.5, color: C.text,
          fontFamily: mono, overflowX: "auto", lineHeight: 1.65,
          maxHeight: 440, overflowY: "auto", margin: 0,
        }}>
          {latex}
        </pre>
        <div style={{ position: "absolute", top: 8, right: 8 }}>
          <CopyBtn text={latex} label="⎘ Copy LaTeX" successLabel="✓ Copied!" color={C.gold} />
        </div>
      </div>
    </div>
  );
}

// ─── RDD BINNED SCATTER PLOT ──────────────────────────────────────────────────
// Pure SVG — no external libs.
// Bins raw data (~20 bins per side) for performance, draws two fitted lines
// (local linear from engine) that meet/jump at the cutoff threshold.
function RDDScatterPlot({ rddResult }) {
  const { valid, xc, D, Y, leftFit, rightFit, cutoff, h, kernelType } = rddResult ?? {};

  if (!valid || valid.length < 4) return (
    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono, padding: "1rem" }}>
      Not enough observations within bandwidth to render scatter.
    </div>
  );

  // Bin each side into ≤20 mean-points for performance
  const binSide = (pts, nbins = 20) => {
    if (!pts.length) return [];
    const xs = pts.map(p => p.x);
    const lo = Math.min(...xs), rng = (Math.max(...xs) - lo) || 1;
    const bw = rng / nbins;
    return Array.from({ length: nbins }, (_, i) => {
      const inside = pts.filter(p => p.x >= lo + i * bw && p.x < lo + (i + 1) * bw);
      if (!inside.length) return null;
      return {
        x: inside.reduce((s, p) => s + p.x, 0) / inside.length,
        y: inside.reduce((s, p) => s + p.y, 0) / inside.length,
      };
    }).filter(Boolean);
  };

  const rawLeft  = valid.map((_, i) => ({ x: xc[i] + cutoff, y: Y[i] })).filter((_, i) => D[i] === 0);
  const rawRight = valid.map((_, i) => ({ x: xc[i] + cutoff, y: Y[i] })).filter((_, i) => D[i] === 1);
  const bL = binSide(rawLeft);
  const bR = binSide(rawRight);

  // Layout
  const W = 620, H = 300;
  const PAD = { l: 52, r: 24, t: 22, b: 42 };
  const iW = W - PAD.l - PAD.r, iH = H - PAD.t - PAD.b;

  const allPts = [...bL, ...bR, ...(leftFit ?? []), ...(rightFit ?? [])];
  const allX = allPts.map(p => p.x ?? 0), allY = allPts.map(p => p.y ?? p.yhat ?? 0);
  const xLo = Math.min(...allX), xHi = Math.max(...allX);
  const yLo = Math.min(...allY), yHi = Math.max(...allY);
  const xR = (xHi - xLo) || 1, yR = (yHi - yLo) || 1;
  const xPad = xR * 0.04, yPad = yR * 0.1;

  const sx = x  => PAD.l + ((x - xLo + xPad) / (xR + 2 * xPad)) * iW;
  const sy = y  => PAD.t + iH - ((y - yLo + yPad) / (yR + 2 * yPad)) * iH;
  const cx0 = sx(cutoff);

  const linePath = (pts, acc) => {
    if (!pts || pts.length < 2) return "";
    return [...pts].sort((a, b) => a.x - b.x)
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(p.x).toFixed(1)} ${sy(acc(p)).toFixed(1)}`)
      .join(" ");
  };

  const yTicks = Array.from({ length: 5 }, (_, i) => yLo - yPad + ((yR + 2 * yPad) * i) / 4);

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", minWidth: 400, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* Horizontal grid */}
        {yTicks.map((t, i) => (
          <line key={i} x1={PAD.l} x2={PAD.l + iW} y1={sy(t)} y2={sy(t)}
                stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
        ))}

        {/* Control-side scatter */}
        {bL.map((p, i) => (
          <circle key={`L${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3.5}
                  fill={C.blue} opacity={0.55} />
        ))}
        {/* Treatment-side scatter */}
        {bR.map((p, i) => (
          <circle key={`R${i}`} cx={sx(p.x)} cy={sy(p.y)} r={3.5}
                  fill={C.orange} opacity={0.55} />
        ))}

        {/* Fitted lines */}
        {leftFit  && <path d={linePath(leftFit,  p => p.yhat)} fill="none" stroke={C.blue}   strokeWidth={2} opacity={0.9} />}
        {rightFit && <path d={linePath(rightFit, p => p.yhat)} fill="none" stroke={C.orange} strokeWidth={2} opacity={0.9} />}

        {/* Cutoff threshold */}
        {cx0 >= PAD.l && cx0 <= PAD.l + iW && (
          <>
            <line x1={cx0} x2={cx0} y1={PAD.t} y2={PAD.t + iH}
                  stroke={C.gold} strokeWidth={1.5} strokeDasharray="6 3" opacity={0.85} />
            <text x={cx0 + 5} y={PAD.t + 13} fill={C.gold} fontSize={9} fontFamily={mono}>
              c = {cutoff}
            </text>
          </>
        )}

        {/* Axes */}
        <line x1={PAD.l} x2={PAD.l + iW} y1={PAD.t + iH} y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />
        <line x1={PAD.l} x2={PAD.l}       y1={PAD.t}       y2={PAD.t + iH} stroke={C.border2} strokeWidth={1} />

        {/* Y-axis labels */}
        {yTicks.map((t, i) => (
          <text key={i} x={PAD.l - 5} y={sy(t) + 3} textAnchor="end" fill={C.textMuted} fontSize={8}>
            {safeNum(t, 2)}
          </text>
        ))}

        {/* X-axis label */}
        <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textMuted} fontSize={8}>
          Running variable · h = {safeNum(h, 3)} · kernel: {kernelType ?? "—"}
        </text>

        {/* Legend */}
        <circle cx={PAD.l + 10} cy={PAD.t + 10} r={4} fill={C.blue}   opacity={0.7} />
        <text x={PAD.l + 18} y={PAD.t + 14} fill={C.textDim} fontSize={9}>Control side</text>
        <circle cx={PAD.l + 88} cy={PAD.t + 10} r={4} fill={C.orange} opacity={0.7} />
        <text x={PAD.l + 96} y={PAD.t + 14} fill={C.textDim} fontSize={9}>Treatment side</text>
        <line  x1={PAD.l + 168} x2={PAD.l + 186} y1={PAD.t + 10} y2={PAD.t + 10}
               stroke={C.gold} strokeWidth={1.5} strokeDasharray="4 2" />
        <text x={PAD.l + 190} y={PAD.t + 14} fill={C.textDim} fontSize={9}>Cutoff</text>
      </svg>
    </div>
  );
}

// ─── 3. AI NARRATIVE ──────────────────────────────────────────────────────────
// Delegates to AIService.interpretRegression which handles:
//   - Functional form detection (log-log / log-level / level-log)
//   - Natural language phrasing from dataDictionary
//   - Dummy variable group comparison framing
// Fires automatically when the Narrative tab is selected (component mounts).

// Loading skeleton — shown while API is generating
function NarrativeSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: "1rem" }}>
      {[0, 1].map(i => (
        <div key={i} style={{
          padding: "0.9rem 1.1rem",
          background: C.surface,
          border: `1px solid ${C.border}`,
          borderLeft: `3px solid ${i === 0 ? C.teal : C.purple}`,
          borderRadius: 4,
        }}>
          <div style={{
            fontSize: 9, color: i === 0 ? C.teal : C.purple,
            letterSpacing: "0.18em", textTransform: "uppercase",
            fontFamily: mono, marginBottom: 10,
          }}>
            {i === 0 ? "¶1 · Statistical Findings" : "¶2 · Model Reliability"}
          </div>
          {/* Animated shimmer lines */}
          {[100, 92, 87, 60].map((w, j) => (
            <div key={j} style={{
              height: 10, borderRadius: 3, marginBottom: 7,
              width: `${w}%`,
              background: `linear-gradient(90deg, ${C.surface2} 25%, ${C.border2} 50%, ${C.surface2} 75%)`,
              backgroundSize: "200% 100%",
              animation: "shimmer 1.6s ease-in-out infinite",
              animationDelay: `${j * 0.12}s`,
            }} />
          ))}
        </div>
      ))}
    </div>
  );
}

function AINarrative({ result, modelLabel, yVar, dataDictionary }) {
  const [text, setText]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [hasRun, setHasRun]   = useState(false);
  const abortRef              = useRef(null);

  const hasDictionary = dataDictionary && Object.values(dataDictionary).some(v => v?.trim());

  const run = async () => {
    if (loading) return;
    if (abortRef.current) abortRef.current = false;
    const token = {};
    abortRef.current = token;

    setLoading(true);
    setHasRun(true);
    setText("");
    setError("");

    try {
      const out = await interpretRegression(result, hasDictionary ? dataDictionary : null);
      if (abortRef.current === token) {
        setText(out.trim());
      }
    } catch (e) {
      if (abortRef.current === token) {
        setError(`Generation failed: ${e?.message ?? "check your API connection"}.`);
      }
    } finally {
      if (abortRef.current === token) {
        setLoading(false);
      }
    }
  };

  // Fire automatically when this tab mounts — only once per result
  useEffect(() => {
    run();
    return () => { abortRef.current = null; }; // cancel on unmount
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean);

  return (
    <div>
      {/* Context banner */}
      <div style={{
        fontSize: 11, color: C.textDim, fontFamily: mono, lineHeight: 1.7,
        marginBottom: "1.2rem", padding: "0.65rem 1rem",
        background: C.surface, border: `1px solid ${C.border}`,
        borderLeft: `3px solid ${C.purple}`, borderRadius: 4,
        display: "flex", alignItems: "flex-start", gap: 10,
      }}>
        <span style={{ color: C.purple, fontSize: 13, lineHeight: 1 }}>✦</span>
        <div>
          <div style={{ color: C.text, marginBottom: 2 }}>
            AI-generated executive summary for{" "}
            <span style={{ color: C.gold }}>{modelLabel}</span> on{" "}
            <span style={{ color: C.teal }}>{yVar}</span>.
          </div>
          <div>
            Sends to Claude: estimated equation, R², N, all β̂, SE, 95% CI, p-values
            {hasDictionary
              ? <>, and <span style={{ color: C.violet }}>Data Dictionary</span>
                  {" "}— coefficients will be phrased in natural units.
                </>
              : <>. No Data Dictionary detected — add one in Data Studio for richer narrative.</>
            }
          </div>
          <div style={{ marginTop: 4, fontSize: 10, color: C.textMuted }}>
            Verify before submitting — AI can err on economic plausibility.
          </div>
        </div>
      </div>

      {/* Loading state */}
      {loading && (
        <>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            color: C.purple, fontSize: 11, fontFamily: mono,
            marginBottom: "0.8rem",
          }}>
            <Spin />
            <span>Generating insight…</span>
            <span style={{ color: C.textMuted, fontSize: 10 }}>
              ({result.varNames?.filter(v => v !== "(Intercept)").length ?? 0} regressors
              {hasDictionary ? " · dictionary-aware" : ""})
            </span>
          </div>
          <NarrativeSkeleton />
        </>
      )}

      {/* Error state */}
      {error && !loading && (
        <div style={{
          fontSize: 11, color: C.red, fontFamily: mono, lineHeight: 1.6,
          padding: "0.75rem 1rem", border: `1px solid ${C.red}40`,
          borderLeft: `3px solid ${C.red}`, borderRadius: 4, marginBottom: "1rem",
        }}>
          ⚠ {error}
        </div>
      )}

      {/* Paragraph output */}
      {paragraphs.length > 0 && !loading && (
        <div style={{ marginBottom: "1.2rem" }}>
          {paragraphs.map((p, i) => {
            const labels = ["¶1 · Statistical Findings", "¶2 · Model Reliability"];
            const accents = [C.teal, C.purple];
            return (
              <div key={i} style={{
                fontSize: 12.5, color: C.text, lineHeight: 1.9,
                fontFamily: "'Georgia','Times New Roman',serif",
                padding: "1rem 1.2rem",
                background: i % 2 === 0 ? C.surface : C.surface2,
                border: `1px solid ${C.border}`,
                borderLeft: `3px solid ${accents[i] ?? C.gold}`,
                borderRadius: 4, marginBottom: 8,
                animation: "fadeUp 0.22s ease",
              }}>
                <div style={{
                  fontSize: 9, color: accents[i] ?? C.gold,
                  letterSpacing: "0.2em", textTransform: "uppercase",
                  fontFamily: mono, marginBottom: 8,
                }}>
                  {labels[i] ?? `¶${i + 1}`}
                </div>
                {p}
              </div>
            );
          })}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        {text && !loading && (
          <CopyBtn text={text} label="⎘ Copy as plain text" successLabel="✓ Copied!" color={C.purple} />
        )}
        <Btn
          onClick={run}
          dis={loading}
          color={C.purple}
          sm
          ch={loading ? "Generating…" : hasRun ? "↻ Regenerate narrative" : "✦ Generate narrative"}
        />
        {hasRun && !loading && !error && (
          <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>
            Results are non-deterministic — regeneration may vary.
          </span>
        )}
      </div>
    </div>
  );
}

// ─── FIT STATS SUMMARY BAR ────────────────────────────────────────────────────
function FitBar({ result }) {
  const { R2, adjR2, n, df, Fstat, Fpval, modelLabel } = result;
  const items = [
    { l: "Model",    v: modelLabel ?? "—",               c: C.gold },
    { l: "R²",       v: safeNum(R2),                     c: C.teal },
    { l: "Adj. R²",  v: safeNum(adjR2),                  c: C.teal },
    { l: "n",        v: n  != null ? n  : "—",           c: C.text },
    { l: "df",       v: df != null ? df : "—",           c: C.textDim },
    ...(Fstat != null && isFinite(Fstat)
      ? [
          { l: "F-stat",  v: safeNum(Fstat, 3),           c: C.orange },
          { l: "F p-val", v: (Fpval != null && isFinite(Fpval))
              ? (Fpval < 0.001 ? "<.001" : safeNum(Fpval)) : "—",    c: C.orange },
        ]
      : []),
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`,
                  gap: 1, background: C.border, borderRadius: 4,
                  overflow: "hidden", marginBottom: "1.4rem" }}>
      {items.map(s => (
        <div key={s.l} style={{ background: C.surface, padding: "0.6rem 0.85rem" }}>
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.1em",
                        textTransform: "uppercase", marginBottom: 3, fontFamily: mono }}>
            {s.l}
          </div>
          <div style={{ fontSize: 15, color: s.c, fontFamily: mono }}>{s.v}</div>
        </div>
      ))}
    </div>
  );
}

// ─── SIGNIFICANT COEFFICIENTS CALLOUT ────────────────────────────────────────
function SigCallout({ result }) {
  const { varNames, beta, se, pVals } = result;
  const sig = varNames
    .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
    .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s) && d.p < 0.05);

  if (!sig.length) return (
    <div style={{ fontSize: 11, color: C.textMuted, fontFamily: mono,
                  padding: "0.65rem 1rem", border: `1px solid ${C.border}`,
                  borderRadius: 4, marginBottom: "1.2rem" }}>
      No regressors are significant at the 5% level.
    </div>
  );

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: "1.2rem" }}>
      {sig.map(d => (
        <div key={d.v} style={{
          padding: "0.45rem 0.85rem",
          background: `${C.teal}10`, border: `1px solid ${C.teal}40`,
          borderRadius: 4, fontFamily: mono,
        }}>
          <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 2 }}>{d.v}</div>
          <div style={{ fontSize: 13, color: d.b >= 0 ? C.teal : C.red }}>
            {d.b >= 0 ? "+" : ""}{safeNum(d.b)}
            <span style={{ fontSize: 9, color: C.gold, marginLeft: 4 }}>{stars(d.p)}</span>
          </div>
          <div style={{ fontSize: 9, color: C.textMuted }}>
            95% CI [{safeNum(d.b - 1.96 * d.s, 3)}, {safeNum(d.b + 1.96 * d.s, 3)}]
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── ROOT ─────────────────────────────────────────────────────────────────────
export default function ReportingModule({ result: rawResult, cleanedData, onClose }) {
  const [tab, setTab] = useState("forest");

  // ── Debug: log raw result so any NaN/undefined shows in console ──────────────
  console.log("DEBUG_RESULTS:", rawResult);

  const result = useMemo(() => normaliseResult(rawResult), [rawResult]);

  // Detect Sharp RDD — raw result carries .valid / .leftFit / .rightFit
  const isRDD = !!(rawResult?.valid && rawResult?.leftFit && rawResult?.rightFit);

  if (!result) return (
    <div style={{ padding: "2rem", color: C.textMuted, fontFamily: mono, fontSize: 12 }}>
      No regression result to display. Run a model first.
    </div>
  );

  // ── Safety guard: engine returned an error instead of valid results ───────────
  if (result.__error) return (
    <div style={{ padding: "2rem", fontFamily: mono }}>
      <div style={{
        padding: "1.2rem 1.4rem",
        background: "#0d0808",
        border: `1px solid ${C.red}40`,
        borderLeft: `3px solid ${C.red}`,
        borderRadius: 4,
      }}>
        <div style={{ fontSize: 9, color: C.red, letterSpacing: "0.22em",
                      textTransform: "uppercase", marginBottom: 8 }}>
          Estimation Error
        </div>
        <div style={{ fontSize: 13, color: C.text, marginBottom: 6 }}>
          {result.__error}
        </div>
        <div style={{ fontSize: 11, color: C.textMuted, lineHeight: 1.7 }}>
          Common causes: perfect multicollinearity, fewer observations than parameters,
          or a degenerate panel structure. Return to the Modeling Lab and verify your
          variable selection and data coverage.
        </div>
      </div>
      {onClose && (
        <button onClick={onClose}
          style={{ marginTop: "1rem", padding: "0.4rem 0.9rem", borderRadius: 3,
                   cursor: "pointer", fontFamily: mono, fontSize: 10,
                   background: "transparent", border: `1px solid ${C.border2}`,
                   color: C.textMuted }}>
          ✕ Close
        </button>
      )}
    </div>
  );

  const { modelLabel = "OLS", yVar = "y" } = result;

  const tabs = [
    ["forest",    "⬡ Forest Plot"],
    ...(isRDD ? [["rdd", "◉ RDD Scatter"]] : []),
    ["latex",     "⊞ LaTeX Export"],
    ["narrative", "✦ AI Narrative"],
  ];

  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: mono,
                  height: "100%", display: "flex", flexDirection: "column",
                  overflow: "hidden" }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(6px) } to { opacity:1; transform:translateY(0) } }
        @keyframes shimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>

      {/* ── Header ── */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}`,
                    padding: "0.75rem 1.4rem",
                    display: "flex", alignItems: "center", gap: 12,
                    background: C.surface }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.26em",
                        textTransform: "uppercase", marginBottom: 2 }}>
            Reporting Module
          </div>
          <div style={{ fontSize: 16, color: C.text, letterSpacing: "-0.01em" }}>
            <span style={{ color: C.gold }}>{modelLabel}</span>
            {" · "}
            <span style={{ color: C.textDim }}>dep. var.: </span>
            <span style={{ color: C.teal }}>{yVar}</span>
          </div>
        </div>
        {onClose && (
          <button onClick={onClose}
            style={{ background: "transparent", border: `1px solid ${C.border2}`,
                     borderRadius: 3, color: C.textMuted, cursor: "pointer",
                     fontFamily: mono, fontSize: 10, padding: "0.3rem 0.7rem" }}>
            ✕ Close
          </button>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto",
                    padding: "1.4rem", paddingBottom: "3rem" }}>

        {/* Fit stats always visible */}
        <FitBar result={result} />

        {/* Significant coefficients callout */}
        <Lbl color={C.teal}>Significant regressors (p &lt; 0.05)</Lbl>
        <SigCallout result={result} />

        {/* Tab navigation */}
        <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4,
                      overflow: "hidden", marginBottom: "1.4rem" }}>
          {tabs.map(([k, l]) => (
            <button key={k} onClick={() => setTab(k)}
              style={{ flex: 1, padding: "0.6rem 0.7rem",
                       background: tab === k ? C.goldFaint : C.surface,
                       border: "none", color: tab === k ? C.gold : C.textDim,
                       cursor: "pointer", fontFamily: mono, fontSize: 11,
                       borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent",
                       transition: "all 0.12s" }}>
              {l}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {tab === "forest" && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <Lbl>Coefficient Estimates · 95% Confidence Intervals</Lbl>
            <div style={{ marginBottom: "0.8rem", fontSize: 11, color: C.textDim,
                          fontFamily: mono, lineHeight: 1.6 }}>
              <span style={{ color: C.teal }}>◆ Teal</span> = significant at 5% ·{" "}
              <span style={{ color: C.textMuted }}>◇ Grey</span> = not significant ·{" "}
              Intercept excluded from plot.
            </div>
            <ForestPlot
              varNames={result.varNames}
              beta={result.beta}
              se={result.se}
              pVals={result.pVals}
            />
          </div>
        )}

        {tab === "rdd" && isRDD && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <Lbl color={C.orange}>Sharp RDD · Binned Scatter + Fitted Lines</Lbl>
            <div style={{ marginBottom: "0.8rem", fontSize: 11, color: C.textDim,
                          fontFamily: mono, lineHeight: 1.6 }}>
              <span style={{ color: C.blue }}>● Blue</span> = control side (running var &lt; cutoff) ·{" "}
              <span style={{ color: C.orange }}>● Orange</span> = treatment side ·{" "}
              Lines are local linear fits (kernel-weighted).{" "}
              <span style={{ color: C.gold }}>— Dashed</span> = cutoff threshold.
            </div>
            <div style={{ border: `1px solid ${C.border}`, borderRadius: 4,
                          padding: "0.5rem", background: C.bg, marginBottom: "1rem" }}>
              <RDDScatterPlot rddResult={rawResult} />
            </div>
          </div>
        )}

        {tab === "latex" && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <LatexPanel result={result} modelLabel={modelLabel} yVar={yVar} />
          </div>
        )}

        {tab === "narrative" && (
          <div style={{ animation: "fadeUp 0.18s ease" }}>
            <AINarrative
              result={result}
              modelLabel={modelLabel}
              yVar={yVar}
              dataDictionary={cleanedData?.dataDictionary ?? null}
            />
          </div>
        )}
      </div>
    </div>
  );
}
