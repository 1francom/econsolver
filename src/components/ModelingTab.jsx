// ─── ECON STUDIO · ModelingTab.jsx ───────────────────────────────────────────
// Clean orchestrator. Owns all model state, the estimate() callback,
// and the results rendering pipeline. UI chrome extracted to:
//   src/components/modeling/EstimatorSidebar.jsx
//   src/components/modeling/VariableSelector.jsx
//   src/components/modeling/ModelConfiguration.jsx
// Math lives in src/math/index.js (split from the monolithic EconometricsEngine.js).

import { useState, useMemo, useCallback } from "react";
import {
  runOLS, runWLS, run2SLS, runFE, runFD, runSharpRDD, runMcCrary,
  run2x2DiD, runTWFEDiD, ikBandwidth,
  breuschPagan, computeVIF, hausmanTest,
  stars, buildLatex, buildCSVExport, downloadText,
  runLogit, runProbit, buildBinaryLatex, buildBinaryCSV,
} from "../math/index.js";
import { generateRScript } from "../services/export/rScript.js";
import ReportingModule from "../ReportingModule.jsx";

import EstimatorSidebar   from "../components/modeling/EstimatorSidebar.jsx";
import VariableSelector   from "../components/modeling/VariableSelector.jsx";
import ModelConfiguration from "../components/modeling/ModelConfiguration.jsx";
import { C, mono }        from "../components/modeling/shared.jsx";
import { PlotSelector, YFittedPlot, PartialPlot, YXhatPlot, XvsXhatPlot, EndogeneityPlot, RDDPlot, DiDPlot, EventStudyPlot, FirstStagePlot, RDDBandwidthPlot, RDDCovariateBalance, McCraryPlot, ROCCurve, PredProbHistogram } from "../components/modeling/ModelPlots.jsx";
import { ResidualVsFitted, QQPlot } from "../components/modeling/ResidualPlots.jsx";
import DiagnosticsPanel    from "../components/modeling/DiagnosticsPanel.jsx";
import ResearchCoach       from "../components/modeling/ResearchCoach.jsx";

// ─── LOCAL DISPLAY PRIMITIVES ─────────────────────────────────────────────────
// Result-rendering atoms — kept here because they depend on result shapes,
// not on the UI chrome that was extracted.

function Lbl({ children, color = C.textMuted }) {
  return (
    <div style={{ fontSize: 9, color, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8, fontFamily: mono }}>
      {children}
    </div>
  );
}
function Badge({ label, color }) {
  return (
    <span style={{ fontSize: 9, padding: "2px 7px", border: `1px solid ${color}`, color, borderRadius: 2, letterSpacing: "0.1em", fontFamily: mono }}>
      {label}
    </span>
  );
}
function InfoBox({ children, color = C.blue }) {
  return (
    <div style={{
      padding: "0.65rem 0.9rem", background: `${color}08`,
      border: `1px solid ${color}30`, borderLeft: `3px solid ${color}`,
      borderRadius: 4, fontSize: 11, color: C.textDim, lineHeight: 1.7,
      fontFamily: mono, marginBottom: "1rem",
    }}>
      {children}
    </div>
  );
}

// ─── REGRESSION EQUATION ──────────────────────────────────────────────────────
function RegressionEquation({ varNames, beta, yVar }) {
  if (!varNames.length || !beta.length) return null;
  const interceptIdx = varNames.indexOf("(Intercept)");
  const b0 = interceptIdx >= 0 ? beta[interceptIdx] : null;
  const regressors = varNames.map((v, i) => ({ v, b: beta[i] })).filter(({ v }) => v !== "(Intercept)");
  const fmt = b => {
    if (b == null || !isFinite(b)) return "N/A";
    const s = Math.abs(b).toFixed(4);
    return s === "0.0000" ? "0.0000" : s;
  };
  return (
    <div style={{
      background: C.surface2, border: `1px solid ${C.border2}`,
      borderLeft: `3px solid ${C.teal}`, borderRadius: 4,
      padding: "0.9rem 1.1rem", marginBottom: "1.2rem",
      overflowX: "auto", whiteSpace: "nowrap",
    }}>
      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 6 }}>
        Estimated Regression Equation
      </div>
      <div style={{ fontSize: 13, fontFamily: mono, color: C.text, lineHeight: 1.8 }}>
        <span style={{ color: C.teal }}>{yVar ? `${yVar}̂` : "ŷ"}</span>
        <span style={{ color: C.textDim }}> = </span>
        {b0 != null && <span style={{ color: b0 >= 0 ? C.text : C.red }}>{b0 < 0 ? "–" : ""}{fmt(b0)}</span>}
        {regressors.map(({ v, b }) => {
          const bOk = b != null && isFinite(b);
          const op = bOk && b < 0 ? " – " : " + ";
          return (
            <span key={v}>
              <span style={{ color: C.textMuted }}>{op}</span>
              <span style={{ color: bOk ? (b >= 0 ? C.teal : C.red) : C.textMuted }}>{fmt(b)}</span>
              <span style={{ color: C.textMuted }}>·</span>
              <span style={{ color: C.text }}>{v.replace(/_/g, "​_")}</span>
            </span>
          );
        })}
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.06em" }}>
        <span style={{ color: C.teal }}>teal</span> = significant (p&lt;0.05) ·{" "}
        <span style={{ color: C.red }}>red</span> = negative · coefficients rounded to 4 d.p.
      </div>
    </div>
  );
}

// ─── FOREST PLOT ─────────────────────────────────────────────────────────────
function ForestPlot({ varNames, beta, se, pVals, svgId = "forest-plot", filename = "coefficient_plot.svg" }) {
  const items = varNames
    .map((v, i) => ({ v, b: beta[i], s: se[i], p: pVals[i] }))
    .filter(d => d.v !== "(Intercept)" && isFinite(d.b) && isFinite(d.s));
  if (!items.length) return null;

  const rowH = 34, PAD = { l: 148, r: 76, t: 22, b: 26 }, W = 600;
  const iW = W - PAD.l - PAD.r;
  const H = items.length * rowH + PAD.t + PAD.b;
  const rawLo = Math.min(0, ...items.map(d => d.b - 1.96 * d.s));
  const rawHi = Math.max(0, ...items.map(d => d.b + 1.96 * d.s));
  const pad = (rawHi - rawLo) * 0.08 || 0.1;
  const lo = rawLo - pad, hi = rawHi + pad, range = hi - lo;
  const sx = v => PAD.l + ((v - lo) / range) * iW;
  const zero = sx(0);
  const ticks = Array.from({ length: 5 }, (_, i) => lo + (range * i) / 4);

  const handleExport = () => {
    const el = document.getElementById(svgId);
    if (!el) return;
    let src = new XMLSerializer().serializeToString(el);
    if (!src.includes('xmlns="http://www.w3.org/2000/svg"'))
      src = src.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    src = src.replace(/<rect[^>]*fill="#080808"[^>]*\/>/g, '');
    src = src.replace(/<rect[^>]*fill="#0f0f0f"[^>]*\/>/g, '');
    src = '<?xml version="1.0" encoding="UTF-8"?>\n' + src;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([src], { type: "image/svg+xml;charset=utf-8" }));
    a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0.35rem 0.9rem", background: "#0a0a0a",
        borderBottom: `1px solid ${C.border}`,
      }}>
        <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: mono }}>
          Coefficient plot · 95% CI
        </span>
        <button onClick={handleExport}
          style={{ padding: "0.2rem 0.6rem", background: "transparent", border: `1px solid ${C.border2}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 9, transition: "all 0.12s" }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textMuted; }}
        >↓ SVG</button>
      </div>
      <div style={{ background: C.bg, padding: "0.5rem", overflowX: "auto", display: "flex", justifyContent: "center" }}>
        <svg id={svgId} viewBox={`0 0 ${W} ${H}`}
          style={{ width: "100%", maxWidth: 700, minWidth: 360, height: "auto", maxHeight: "45vh", display: "block", fontFamily: mono }}>
          <rect width={W} height={H} fill={C.bg} />
          {items.map((_, i) => (
            <rect key={i} x={PAD.l} y={PAD.t + i * rowH} width={iW} height={rowH}
              fill={i % 2 === 0 ? C.surface : C.surface2} opacity={0.7} />
          ))}
          {ticks.map((t, i) => (
            <line key={i} x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b}
              stroke={C.border} strokeWidth={1} strokeDasharray="3 3" />
          ))}
          {zero >= PAD.l && zero <= PAD.l + iW && (
            <line x1={zero} x2={zero} y1={PAD.t} y2={H - PAD.b}
              stroke={C.border2} strokeWidth={1.5} strokeDasharray="4 3" />
          )}
          {items.map((d, i) => {
            const cy = PAD.t + i * rowH + rowH / 2;
            const cx = sx(d.b);
            const ciLo = sx(d.b - 1.96 * d.s), ciHi = sx(d.b + 1.96 * d.s);
            const sig = d.p < 0.05;
            const dot = sig ? C.teal : C.textMuted;
            const lbl = sig ? C.text : C.textDim;
            const CAP = 5;
            const ciLoC = Math.max(PAD.l, ciLo), ciHiC = Math.min(PAD.l + iW, ciHi);
            return (
              <g key={d.v}>
                <text x={PAD.l - 10} y={cy + 4} textAnchor="end" fill={lbl} fontSize={10.5}>
                  {d.v.length > 18 ? d.v.slice(0, 17) + "…" : d.v}
                </text>
                <line x1={ciLoC} x2={ciHiC} y1={cy} y2={cy} stroke={dot} strokeWidth={sig ? 1.6 : 1.1} opacity={sig ? 0.85 : 0.45} />
                <line x1={ciLo} x2={ciLo} y1={cy - CAP} y2={cy + CAP} stroke={dot} strokeWidth={1} opacity={0.65} />
                <line x1={ciHi} x2={ciHi} y1={cy - CAP} y2={cy + CAP} stroke={dot} strokeWidth={1} opacity={0.65} />
                <rect x={cx - 5} y={cy - 5} width={10} height={10}
                  fill={sig ? dot : "transparent"} stroke={dot}
                  strokeWidth={sig ? 0 : 1.5} opacity={sig ? 0.95 : 0.55}
                  transform={`rotate(45,${cx},${cy})`} />
                <text x={PAD.l + iW + 8} y={cy + 3} textAnchor="start" fill={dot} fontSize={10}>
                  {d.b > 0 ? "+" : ""}{d.b.toFixed(3)}{stars(d.p)}
                </text>
                <text x={PAD.l + iW + 8} y={cy + 14} textAnchor="start" fill={C.textMuted} fontSize={8}>
                  p={d.p < 0.001 ? "<.001" : d.p.toFixed(3)}
                </text>
              </g>
            );
          })}
          <line x1={PAD.l} x2={PAD.l + iW} y1={H - PAD.b} y2={H - PAD.b} stroke={C.border2} strokeWidth={1} />
          {ticks.map((t, i) => (
            <text key={i} x={sx(t)} y={H - PAD.b + 13} textAnchor="middle" fill={C.textMuted} fontSize={8}>
              {t === 0 ? "0" : Math.abs(t) < 0.01 ? t.toExponential(1) : t.toFixed(2)}
            </text>
          ))}
          <text x={PAD.l + iW / 2} y={H - 4} textAnchor="middle" fill={C.textMuted} fontSize={8}>
            Coefficient estimate · 95% CI · ◆ p&lt;0.05 (teal) · ◇ n.s. (grey)
          </text>
        </svg>
      </div>
    </div>
  );
}

// ─── COEFFICIENT TABLE ────────────────────────────────────────────────────────
function ciMultiplier(df) {
  if (!df || df >= 120) return 1.96;
  const table = {
    1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,
    8:2.306,9:2.262,10:2.228,15:2.131,20:2.086,25:2.060,30:2.042,
    40:2.021,60:2.000,80:1.990,100:1.984,120:1.980,
  };
  const keys = Object.keys(table).map(Number).sort((a, b) => a - b);
  for (let k = keys.length - 1; k >= 0; k--) {
    if (df >= keys[k]) {
      const lo = keys[k], hi = keys[k + 1];
      if (!hi) return table[lo];
      return table[lo] + ((df - lo) / (hi - lo)) * (table[hi] - table[lo]);
    }
  }
  return 1.96;
}

function CoeffTable({ varNames, beta, se, tStats, pVals, yVar, df, statLabel = "t", meMap = null }) {
  const [open, setOpen] = useState(null);
  const z    = ciMultiplier(df);
  const COLS = "1.8fr 0.9fr 0.9fr 0.9fr 0.9fr 0.8fr 0.8fr 0.45fr";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{
        display: "grid", gridTemplateColumns: COLS,
        background: "#0a0a0a", padding: "0.5rem 0.75rem",
        fontSize: 9, color: C.textMuted, letterSpacing: "0.13em",
        textTransform: "uppercase", gap: 6,
        borderBottom: `1px solid ${C.border}`, fontFamily: mono,
      }}>
        <div>Variable</div>
        <div style={{ textAlign: "right" }}>β̂</div>
        <div style={{ textAlign: "right" }}>(SE)</div>
        <div style={{ textAlign: "right", color: C.teal + "cc" }}>CI 2.5%</div>
        <div style={{ textAlign: "right", color: C.teal + "cc" }}>CI 97.5%</div>
        <div style={{ textAlign: "right" }}>{statLabel}</div>
        <div style={{ textAlign: "right" }}>p</div>
        <div style={{ textAlign: "center" }}>sig</div>
      </div>

      {varNames.map((v, i) => {
        const b = beta[i], s = se[i], p = pVals[i];
        const lo = b - z * s, hi = b + z * s;
        const isInt = v === "(Intercept)", isOpen = open === i, sig = p < 0.05;
        return (
          <div key={v} style={{ borderTop: i > 0 ? `1px solid ${C.border}` : "none" }}>
            <div
              onClick={() => !isInt && setOpen(isOpen ? null : i)}
              style={{
                display: "grid", gridTemplateColumns: COLS,
                padding: "0.65rem 0.75rem", gap: 6,
                background: isOpen ? "#0e0c09" : i % 2 === 0 ? C.surface : C.surface2,
                cursor: isInt ? "default" : "pointer",
                alignItems: "center", transition: "background 0.1s", fontFamily: mono,
              }}
              onMouseOver={e => { if (!isInt) e.currentTarget.style.background = "#0e0c09"; }}
              onMouseOut={e => { if (!isOpen) e.currentTarget.style.background = i % 2 === 0 ? C.surface : C.surface2; }}
            >
              <div style={{ fontSize: 12, color: isInt ? C.textMuted : C.text, display: "flex", alignItems: "center", gap: 5 }}>
                {sig && !isInt && <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.teal, display: "inline-block", flexShrink: 0 }} />}
                {v}{!isInt && <span style={{ fontSize: 9, color: "#333" }}>▾</span>}
              </div>
              <div style={{ textAlign: "right", fontSize: 13, color: b >= 0 ? C.green : C.red, fontFamily: mono }}>{b.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>({s.toFixed(4)})</div>
              <div style={{ textAlign: "right", fontSize: 11, color: sig ? C.teal + "cc" : C.textMuted }}>{lo.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: sig ? C.teal + "cc" : C.textMuted }}>{hi.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{tStats[i].toFixed(3)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: p < 0.05 ? C.gold : C.textMuted }}>{p < 0.001 ? "<0.001" : p.toFixed(4)}</div>
              <div style={{ textAlign: "center", fontSize: 12, color: C.gold }}>{stars(p)}</div>
            </div>
            {isOpen && (
              <div style={{
                padding: "0.8rem 1.1rem 0.8rem 1.4rem", background: "#0c0b08",
                borderTop: `1px solid #2a2010`, borderLeft: `3px solid ${C.gold}`,
                animation: "fadeUp 0.18s ease", fontSize: 12,
                color: "#b0a888", lineHeight: 1.8, fontFamily: mono,
              }}>
                <span style={{ color: C.goldDim, fontSize: 9, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                  Economic Interpretation ·{" "}
                </span>
                {meMap?.[v] != null ? (
                  <>
                    A one-unit increase in <span style={{ color: C.text }}>{v}</span> is associated with a{" "}
                    <span style={{ color: meMap[v] >= 0 ? C.green : C.red }}>
                      {meMap[v] >= 0 ? "+" : ""}{meMap[v].toFixed(4)} change in P(Y=1)
                    </span>{" "}
                    at the covariate means (MEM). Latent-index coefficient:{" "}
                    <span style={{ color: b >= 0 ? C.teal : C.red }}>{b >= 0 ? "+" : ""}{b.toFixed(4)}</span>.{" "}
                  </>
                ) : (
                  <>
                    A one-unit increase in <span style={{ color: C.text }}>{v}</span> is associated with a{" "}
                    <span style={{ color: b >= 0 ? C.green : C.red }}>
                      {b >= 0 ? "+" : ""}{b.toFixed(4)} {b >= 0 ? "increase" : "decrease"}
                    </span>{" "}
                    in <span style={{ color: C.text }}>{yVar}</span>, ceteris paribus.{" "}
                  </>
                )}
                <span style={{ color: C.teal }}>95% CI: [{lo.toFixed(4)}, {hi.toFixed(4)}].</span>{" "}
                <span style={{ color: p < 0.05 ? C.gold : C.textDim }}>
                  {p < 0.01 ? "Highly significant (p < 0.01)."
                    : p < 0.05 ? "Significant (p < 0.05)."
                    : p < 0.1  ? "Marginally significant (p < 0.1)."
                    : `Not significant (p = ${p.toFixed(3)}).`}
                </span>
              </div>
            )}
          </div>
        );
      })}

      <div style={{
        padding: "0.4rem 0.75rem", background: "#0a0a0a",
        borderTop: `1px solid ${C.border}`,
        fontSize: 9, color: C.textMuted, fontFamily: mono,
        display: "flex", justifyContent: "space-between",
      }}>
        <span>● significant at 5% · SE in parentheses</span>
        <span>95% CI = β̂ ± {z.toFixed(3)} × SE{df ? ` (t-dist, df=${df})` : " (z≈1.96)"}</span>
      </div>
    </div>
  );
}

// ─── FIT STATS BAR ────────────────────────────────────────────────────────────
function FitBar({ items }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`,
      gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem",
    }}>
      {items.map(s => (
        <div key={s.label} style={{ background: C.surface, padding: "0.65rem 0.9rem" }} title={s.hint || ""}>
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3, fontFamily: mono }}>{s.label}</div>
          <div style={{ fontSize: 16, color: s.color || C.gold, fontFamily: mono }}>{s.value}</div>
          {s.sub && <div style={{ fontSize: 9, color: C.textMuted, marginTop: 2, fontFamily: mono }}>{s.sub}</div>}
        </div>
      ))}
    </div>
  );
}

// ─── EXPORT BAR ───────────────────────────────────────────────────────────────
function ExportBar({ yVar, results, model, onReport, rScriptConfig, latexBuilder, csvBuilder }) {
  const [showLatex, setShowLatex] = useState(false);
  const [copied, setCopied]       = useState(false);
  const latex = useMemo(
    () => latexBuilder ? latexBuilder(yVar, results) : buildLatex(yVar, results?.varNames?.slice(1) || [], results, model),
    [yVar, results, model, latexBuilder]
  );
  const csv = useMemo(
    () => csvBuilder ? csvBuilder(yVar, results) : buildCSVExport(yVar, results),
    [yVar, results, csvBuilder]
  );

  const handleRScript = () => {
    if (!rScriptConfig) return;
    const script = generateRScript(rScriptConfig);
    const blob   = new Blob([script], { type: "text/plain" });
    const a      = document.createElement("a");
    a.href       = URL.createObjectURL(blob);
    a.download   = `${(rScriptConfig.filename ?? "analysis").replace(/\.[^.]+$/, "")}_${model}.R`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
      <div style={{ background: "#0a0a0a", padding: "0.45rem 1rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono }}>
        Export
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border }}>
        {[
          { label: "LaTeX table",  action: () => setShowLatex(s => !s), active: showLatex },
          { label: "Download CSV", action: () => downloadText(csv, `${model}_${yVar}.csv`) },
        ].map(({ label, action, active }) => (
          <button key={label} onClick={action}
            style={{
              flex: 1, padding: "0.6rem 1rem",
              background: active ? C.goldFaint : C.surface,
              border: "none", color: active ? C.gold : C.textDim,
              cursor: "pointer", fontFamily: mono, fontSize: 11, transition: "background 0.15s",
            }}
            onMouseOver={e => { if (!active) e.currentTarget.style.background = "#0e0e0e"; }}
            onMouseOut={e =>  { if (!active) e.currentTarget.style.background = C.surface; }}
          >
            {label}
          </button>
        ))}
        {rScriptConfig && (
          <button onClick={handleRScript}
            style={{
              flex: 1, padding: "0.6rem 1rem", background: C.surface,
              border: "none", color: C.green, cursor: "pointer", fontFamily: mono,
              fontSize: 11, transition: "background 0.15s",
            }}
            onMouseOver={e => { e.currentTarget.style.background = `${C.green}14`; }}
            onMouseOut={e =>  { e.currentTarget.style.background = C.surface; }}
          >
            ↓ R Script
          </button>
        )}
        {onReport && (
          <button onClick={onReport}
            style={{
              flex: 1, padding: "0.6rem 1rem", background: C.surface,
              border: "none", color: C.purple, cursor: "pointer", fontFamily: mono,
              fontSize: 11, transition: "background 0.15s",
            }}
            onMouseOver={e => { e.currentTarget.style.background = `${C.purple}14`; }}
            onMouseOut={e =>  { e.currentTarget.style.background = C.surface; }}
          >
            ✦ Full Report
          </button>
        )}
      </div>
      {showLatex && (
        <div style={{ background: "#080a06", borderTop: `1px solid ${C.border}`, padding: "1rem", animation: "fadeUp 0.18s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#5a8a5a", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono }}>LaTeX · {model}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(latex); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{
                padding: "0.28rem 0.8rem",
                background: copied ? "#0a2010" : "transparent",
                border: `1px solid ${copied ? C.green : C.border2}`,
                color: copied ? C.green : C.textMuted,
                borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: mono, transition: "all 0.2s",
              }}
            >
              {copied ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, color: "#8ab878", lineHeight: 1.7, overflowX: "auto", whiteSpace: "pre" }}>
            {latex}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── PANEL FE/FD RESULTS ─────────────────────────────────────────────────────
// Must be a named component (not an IIFE) — React Rules of Hooks.
function PanelResults({ result, panel, xVars, wVars, yVar, panelFE, panelFD, rows, openReport, baseRConfig }) {
  const [tab, setTab] = useState("fe");
  const fe     = result.fe, fd = result.fd;
  const hausman = fe && fd ? hausmanTest(fe, fd, [...xVars, ...wVars]) : null;
  const active  = tab === "fe" ? fe : fd;
  const safeR   = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 10, color: C.blue, letterSpacing: "0.24em", textTransform: "uppercase" }}>Panel Results</span>
        {panel && <Badge label={`${panel.entityCol} × ${panel.timeCol}`} color={C.blue} />}
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[["fe", "Fixed Effects (Within)"], ["fd", "First Differences"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              flex: 1, padding: "0.6rem 1rem",
              background: tab === k ? C.goldFaint : C.surface,
              border: "none", color: tab === k ? C.gold : C.textDim,
              cursor: "pointer", fontFamily: mono, fontSize: 11,
              borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent",
              transition: "all 0.15s",
            }}>
            {l}
          </button>
        ))}
      </div>
      {active && (
        <>
          <RegressionEquation
            varNames={["(Intercept)", ...(active.varNames || xVars)]}
            beta={[null, ...active.beta]}
            yVar={`${yVar[0]} (within)`}
          />
          <FitBar items={[
            { label: tab === "fe" ? "R² within"  : "R²",      value: safeR(tab === "fe" ? active.R2_within  : active.R2),    color: C.blue },
            { label: tab === "fe" ? "R² between" : "Adj. R²", value: safeR(tab === "fe" ? active.R2_between : active.adjR2), color: C.blue },
            { label: "n",     value: active.n,     color: C.text },
            { label: "Units", value: active.units, color: C.textDim },
            { label: "df",    value: active.df,    color: C.textDim },
          ]} />
          <Lbl color={C.textMuted}>Coefficient Table — {tab === "fe" ? "FE" : "FD"}</Lbl>
          <div style={{ marginBottom: "1.2rem" }}>
            <CoeffTable varNames={active.varNames || xVars} beta={active.beta} se={active.se} tStats={active.tStats} pVals={active.pVals} yVar={yVar[0]} df={active.df} />
          </div>
          <PlotSelector
            accentColor={C.blue}
            defaultId="yhat"
            plots={[
              { id: "yhat",   label: "Y vs Ŷ",
                node: <YFittedPlot resid={active.resid} Yhat={active.Yhat} yLabel={yVar[0]} svgIdSuffix={`-${tab}`} /> },
              { id: "forest", label: "Coefficient plot",
                node: <ForestPlot varNames={active.varNames || xVars} beta={active.beta} se={active.se} pVals={active.pVals} svgId={`forest-${tab}`} filename={`${tab}_coefficients.svg`} /> },
              { id: "resid",  label: "Residuals vs Fitted",
                node: <ResidualVsFitted resid={active.resid} Yhat={active.Yhat} svgIdSuffix={`-${tab}-rv`} /> },
              { id: "qq",     label: "Q-Q",
                node: <QQPlot resid={active.resid} svgIdSuffix={`-${tab}-qq`} /> },
            ]}
          />
        </>
      )}
      {hausman && (
        <InfoBox color={parseFloat(hausman.pVal) < 0.05 ? C.red : C.green}>
          Hausman test: H = {hausman.H} · df = {hausman.df} · p = {hausman.pVal} ·{" "}
          {parseFloat(hausman.pVal) < 0.05
            ? "⚠ Reject H₀ — FE and FD differ. Investigate serial correlation."
            : "✓ FE preferred (consistent and more efficient)."}
        </InfoBox>
      )}
      <DiagnosticsPanel resid={panelFE?.resid} rows={rows} xCols={[...xVars, ...wVars]} model="FE" panelFE={panelFE} panelFD={panelFD} />
      {active && (
        <ExportBar
          yVar={yVar[0]}
          results={{ ...active, varNames: active.varNames || xVars }}
          model={tab.toUpperCase()}
          onReport={() => openReport({
            ...active,
            varNames: active.varNames || xVars,
            modelLabel: tab === "fe" ? "Fixed Effects" : "First Differences",
            yVar: yVar[0],
            xVars: [...xVars, ...wVars],
          })}
          rScriptConfig={baseRConfig ? { ...baseRConfig, model: { ...baseRConfig.model,
            type: tab === "fe" ? "FE" : "FD", yVar: yVar[0], xVars, wVars } } : null}
        />
      )}
    </div>
  );
}

// ─── 2SLS RESULTS ─────────────────────────────────────────────────────────────
function TwoSLSResults({ result, yVar, xVars, wVars, zVars, rows, openReport, baseRConfig }) {
  const [tab, setTab] = useState("second");
  const { firstStages, second } = result;
  const safeR = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: 10, color: C.gold, letterSpacing: "0.24em", textTransform: "uppercase" }}>2SLS / IV Results</span>
        <Badge label={`n = ${second.n}`} color={C.textDim} />
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[
          ["second", "Second Stage (Structural)"],
          ...firstStages.map((s, i) => [`fs_${i}`, `First Stage: ${s.endVar}`]),
        ].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              flex: 1, padding: "0.6rem 0.8rem",
              background: tab === k ? C.goldFaint : C.surface,
              border: "none", color: tab === k ? C.gold : C.textDim,
              cursor: "pointer", fontFamily: mono, fontSize: 11,
              borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent",
              transition: "all 0.15s",
            }}>
            {l}
          </button>
        ))}
      </div>
      {tab === "second" && (
        <>
          <RegressionEquation varNames={second.varNames} beta={second.beta} yVar={yVar[0]} />
          <FitBar items={[
            { label: "R²",      value: safeR(second.R2),    color: C.gold },
            { label: "Adj. R²", value: safeR(second.adjR2), color: C.gold },
            { label: "n",  value: second.n,  color: C.text },
            { label: "df", value: second.df, color: C.textDim },
          ]} />
          <Lbl color={C.textMuted}>Second Stage Coefficients</Lbl>
          <div style={{ marginBottom: "1.2rem" }}>
            <CoeffTable varNames={second.varNames} beta={second.beta} se={second.se} tStats={second.tStats} pVals={second.pVals} yVar={yVar[0]} df={second.df} />
          </div>
          <PlotSelector
            accentColor={C.gold}
            defaultId="yhat"
            plots={[
              { id: "yhat",   label: "Y vs Ŷ",
                node: <YFittedPlot resid={second.resid} Yhat={second.Yhat} yLabel={yVar[0]} svgIdSuffix="-2sls" /> },
              ...xVars.map((xc, i) => {
                const fs   = firstStages[i];
                const idx  = second.varNames.indexOf(xc);
                return {
                  id: `yxhat_${xc}`,
                  label: `Y vs ${xc}̂`,
                  node: <YXhatPlot
                    Y={second.Yhat?.map((yh, j) => yh + (second.resid?.[j] ?? 0))}
                    Xhat={fs?.Yhat}
                    beta_iv={idx >= 0 ? second.beta[idx] : null}
                    pVal={idx >= 0 ? second.pVals[idx] : null}
                    yLabel={yVar[0]} xLabel={xc}
                    resid2={second.resid}
                    svgIdSuffix={`-${i}`}
                  />,
                };
              }),
              { id: "forest", label: "Coefficient plot",
                node: <ForestPlot varNames={second.varNames} beta={second.beta} se={second.se} pVals={second.pVals} svgId="forest-2sls-second" filename="2sls_second_stage_coefficients.svg" /> },
              { id: "resid",  label: "Residuals vs Fitted",
                node: <ResidualVsFitted resid={second.resid} Yhat={second.Yhat} svgIdSuffix="-2sls-resid" /> },
              { id: "qq",     label: "Q-Q",
                node: <QQPlot resid={second.resid} svgIdSuffix="-2sls-qq" /> },
              ...firstStages.map((fs, i) => ({
                id: `endog_${i}`,
                label: `Endogeneity: ${fs.endVar}`,
                node: <EndogeneityPlot
                  residFirst={fs.resid}
                  residSecond={second.resid}
                  endVar={fs.endVar}
                  svgIdSuffix={`-${i}`}
                />,
              })),
            ]}
          />
          <ExportBar
            yVar={yVar[0]} results={second} model="2SLS"
            onReport={() => openReport({ second, firstStages, modelLabel: "2SLS / IV", yVar: yVar[0], xVars })}
            rScriptConfig={baseRConfig ? { ...baseRConfig, model: { ...baseRConfig.model, type: "2SLS", yVar: yVar[0], xVars, wVars, zVars } } : null}
          />
        </>
      )}
      {firstStages.map((fs, i) => tab === `fs_${i}` && (
        <div key={i}>
          <FitBar items={[
            { label: "R²",     value: safeR(fs.R2), color: C.gold },
            { label: "F-stat", value: (fs.Fstat != null && isFinite(fs.Fstat)) ? fs.Fstat.toFixed(3) : "—", color: fs.weak ? C.red : C.green },
            { label: "Weak?",  value: fs.weak ? "YES ⚠" : "No", color: fs.weak ? C.red : C.green },
            { label: "n",      value: fs.n, color: C.text },
          ]} />
          {fs.weak && (
            <InfoBox color={C.red}>
              ⚠ Weak instrument: F = {fs.Fstat?.toFixed(2)}. Stock-Yogo threshold is F &gt; 10. 2SLS estimates may be biased toward OLS.
            </InfoBox>
          )}
          <CoeffTable varNames={fs.varNames} beta={fs.beta} se={fs.se} tStats={fs.tStats} pVals={fs.pVals} yVar={fs.endVar} />
          <PlotSelector
            accentColor={C.gold}
            defaultId="xhat"
            plots={[
              { id: "xhat",   label: `${fs.endVar} vs X̂`,
                node: <XvsXhatPlot rows={rows} endVar={fs.endVar} Xhat={fs.Yhat} Fstat={fs.Fstat} weak={fs.weak} svgIdSuffix={`-fs${i}`} /> },
              { id: "scatter", label: "Instrument scatter",
                node: <FirstStagePlot firstStages={[fs]} rows={rows} instrVars={zVars} endogVars={[fs.endVar]} /> },
              { id: "forest", label: "Coefficient plot",
                node: <ForestPlot varNames={fs.varNames} beta={fs.beta} se={fs.se} pVals={fs.pVals} svgId={`forest-2sls-fs${i}`} filename={`2sls_first_stage_${fs.endVar}_coefficients.svg`} /> },
            ]}
          />
        </div>
      ))}
    </div>
  );
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function buildModelAvail(panelOk) {
  return { OLS: true, FE: panelOk, FD: panelOk, "2SLS": true, DiD: true, TWFE: panelOk, RDD: true, Logit: true, Probit: true };
}
function buildModelHint(panel, panelOk) {
  const noPanel = "No panel structure declared — set Entity & Time columns in Wrangling.";
  const dupObs  = "Duplicate observations detected — fix in Wrangling.";
  return {
    FE:   panelOk ? "" : panel ? dupObs : noPanel,
    FD:   panelOk ? "" : panel ? dupObs : noPanel,
    TWFE: panelOk ? "" : noPanel,
  };
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────
export default function ModelingTab({ cleanedData, onBack }) {
  const rows    = cleanedData?.cleanRows  ?? [];
  const headers = cleanedData?.headers    ?? [];
  const panel   = cleanedData?.panelIndex ?? null;

  const numericCols = useMemo(
    () => headers.filter(h => rows.some(r => typeof r[h] === "number" && isFinite(r[h]))),
    [headers, rows]
  );

  // ── Spec state ───────────────────────────────────────────────────────────────
  const [model,      setModel]      = useState("OLS");
  const [yVar,       setYVar]       = useState([]);
  const [xVars,      setXVars]      = useState([]);
  const [wVars,      setWVars]      = useState([]);
  const [zVars,      setZVars]      = useState([]);
  const [postVar,    setPostVar]    = useState([]);
  const [treatVar,   setTreatVar]   = useState([]);
  const [runningVar, setRunningVar] = useState([]);
  const [cutoff,     setCutoff]     = useState("");
  const [bwMode,     setBwMode]     = useState("ik");
  const [bwManual,   setBwManual]   = useState("");
  const [kernel,     setKernel]     = useState("triangular");
  const [weightVar, setWeightVar] = useState([]);

  // ── Results state ─────────────────────────────────────────────────────────
  const [result,       setResult]       = useState(null);
  const [panelFE,      setPanelFE]      = useState(null);
  const [panelFD,      setPanelFD]      = useState(null);
  const [running,      setRunning]      = useState(false);
  const [err,          setErr]          = useState(null);
  const [reportResult, setReportResult] = useState(null);

  const panelOk    = !!panel && !panel.blockFE;
  const modelAvail = useMemo(() => buildModelAvail(panelOk),        [panelOk]);
  const modelHint  = useMemo(() => buildModelHint(panel, panelOk),  [panel, panelOk]);

  const handleModelSelect = useCallback((id) => {
    setModel(id); setResult(null); setErr(null);
  }, []);

  // ── ESTIMATE ────────────────────────────────────────────────────────────────
  const estimate = useCallback(() => {
    setErr(null); setResult(null); setPanelFE(null); setPanelFD(null); setRunning(true);
    const y = yVar[0];
    if (!y) { setErr("Select a dependent variable (Y)."); setRunning(false); return; }
    try {
      const allX = [...xVars, ...wVars];

      if (model === "OLS") {
      if (!allX.length) { setErr("Select at least one regressor."); setRunning(false); return; }
        const wCol = weightVar[0];
       let res;
      if (wCol) {
       const weights = rows.map(r => {
       const v = r[wCol];
       return typeof v === "number" && isFinite(v) && v > 0 ? v : null;
       });
      if (weights.every(w => w === null)) {
        setErr(`Weight column '${wCol}' has no valid positive values.`);
        setRunning(false); return;
       }
        res = runWLS(rows, y, allX, weights);
      if (res) res.modelLabel = "WLS";
      } else {
          res = runOLS(rows, y, allX);
      }
      if (!res) { setErr("Matrix is singular or insufficient data."); setRunning(false); return; }
      setResult({ type: "OLS", main: { ...res, varNames: ["(Intercept)", ...allX] } });
      }
       else if (model === "FE" || model === "FD") {
        if (!allX.length) { setErr("Select at least one regressor."); setRunning(false); return; }
        const ec = panel.entityCol, tc = panel.timeCol;
        const feRaw = runFE(rows, y, allX, ec, tc);
        const fdRaw = runFD(rows, y, allX, ec, tc);
        const fe = feRaw?.error ? null : feRaw;
        const fd = fdRaw?.error ? null : fdRaw;
        setPanelFE(fe); setPanelFD(fd);
        if (!fe && !fd) {
          setErr(feRaw?.error ?? fdRaw?.error ?? "Panel estimation failed. Check that Y and X are numeric and the panel is valid.");
          setRunning(false); return;
        }
        setResult({ type: model, fe, fd, y, x: allX });

      } else if (model === "2SLS") {
        if (!xVars.length) { setErr("Select endogenous regressor(s) in Features (X)."); setRunning(false); return; }
        if (!zVars.length) { setErr("Select at least one instrument (Z)."); setRunning(false); return; }
        const res = run2SLS(rows, y, xVars, wVars, zVars);
        if (!res || res.error) { setErr(res?.error ?? "2SLS failed. Check that instruments are valid (not in X) and data is sufficient."); setRunning(false); return; }
        setResult({ type: "2SLS", ...res });

      } else if (model === "DiD") {
        if (!postVar[0] || !treatVar[0]) { setErr("Select Post and Treated binary columns for DiD."); setRunning(false); return; }
        const res = run2x2DiD(rows, y, postVar[0], treatVar[0], wVars);
        if (!res) { setErr("DiD failed. Post and Treated must be 0/1 binary variables."); setRunning(false); return; }
        setResult({ type: "DiD", main: res });

      } else if (model === "TWFE") {
        if (!treatVar[0]) { setErr("Select the treatment indicator column."); setRunning(false); return; }
        const ec = panel.entityCol, tc = panel.timeCol;
        const res = runTWFEDiD(rows, y, ec, tc, treatVar[0], wVars);
        if (!res) { setErr("TWFE DiD failed. Check panel structure and treatment variable."); setRunning(false); return; }
        setResult({ type: "TWFE", main: res });

      } else if (model === "RDD") {
        if (!runningVar[0]) { setErr("Select a running variable."); setRunning(false); return; }
        const c0 = parseFloat(cutoff);
        if (isNaN(c0)) { setErr("Enter a valid cutoff value."); setRunning(false); return; }
        const runVals = rows.map(r => r[runningVar[0]]).filter(v => typeof v === "number" && isFinite(v));
        const yVals   = rows.map(r => r[y]).filter(v => typeof v === "number" && isFinite(v));
        const h = bwMode === "ik" ? ikBandwidth(runVals, yVals, c0) : parseFloat(bwManual);
        if (isNaN(h) || h <= 0) { setErr("Invalid bandwidth."); setRunning(false); return; }
        const res = runSharpRDD(rows, y, runningVar[0], c0, h, kernel, wVars);
        if (!res) { setErr("RDD failed. Not enough observations within bandwidth."); setRunning(false); return; }
        setResult({ type: "RDD", main: res, h });

      } else if (model === "Logit" || model === "Probit") {
        if (!allX.length) { setErr("Select at least one regressor (X)."); setRunning(false); return; }
        const fn  = model === "Logit" ? runLogit : runProbit;
        const res = fn(rows, y, allX);
        if (!res || res.error) {
          setErr(res?.error ?? `${model} failed. Ensure Y is binary (0/1) and X columns are numeric.`);
          setRunning(false); return;
        }
        if (!res.converged) console.warn(`${model} did not converge after ${res.iterations} iterations.`);
        setResult({ type: model, main: res });
      }
    } catch (e) {
      setErr(`Estimation error: ${e.message}`);
    }
    setRunning(false);
    } ,[model, yVar, xVars, wVars, zVars, postVar, treatVar, runningVar, cutoff, bwMode, bwManual, kernel,weightVar, rows, panel]);

  const openReport = useCallback((raw) => setReportResult(raw), []);
  const diagX = [...xVars, ...wVars];

  // ── R Script config — base object shared by all ExportBar callsites ──────────
  // Each callsite merges this with its specific model params.
  const baseRConfig = useMemo(() => ({
    filename:        cleanedData?.filename ?? "dataset.csv",
    pipeline:        cleanedData?.changeLog ?? [],
    dataDictionary:  cleanedData?.dataDictionary ?? null,
    auditTrail:      null,  // auditor runs on-demand inside generateRScript
    model: {
      entityCol: panel?.entityCol ?? null,
      timeCol:   panel?.timeCol   ?? null,
    },
  }), [cleanedData, panel]);

  // ── RENDER ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: C.bg, color: C.text, fontFamily: mono, height: "100%", display: "flex", flexDirection: "column", position: "relative" }}>
      <style>{`
        @keyframes fadeUp  { from { opacity:0; transform:translateY(6px);  } to { opacity:1; transform:translateY(0); } }
        @keyframes spin    { to   { transform:rotate(360deg); } }
        @keyframes slideIn { from { opacity:0; transform:translateX(32px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      {/* ══ Reporting Overlay ══ */}
      {reportResult && (
        <div
          style={{ position: "absolute", inset: 0, zIndex: 100, display: "flex", background: "rgba(8,8,8,0.72)", backdropFilter: "blur(2px)" }}
          onClick={e => { if (e.target === e.currentTarget) setReportResult(null); }}
        >
          <div style={{
            marginLeft: "auto", width: "min(780px,95vw)", height: "100%",
            background: C.bg, borderLeft: `1px solid ${C.border}`,
            display: "flex", flexDirection: "column",
            animation: "slideIn 0.22s ease", overflow: "hidden",
          }}>
            <ReportingModule result={reportResult} cleanedData={cleanedData} onClose={() => setReportResult(null)} />
          </div>
        </div>
      )}

      {/* ══ Lab Header ══ */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0.6rem 1.4rem", display: "flex", alignItems: "center", gap: 12, background: C.surface, flexShrink: 0 }}>
        <button onClick={onBack} style={{ background: "transparent", border: "none", color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 11 }}>
          ← Back
        </button>
        <span style={{ color: C.border2 }}>|</span>
        <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>◈ Modeling Lab</span>
        <span style={{ marginLeft: "auto", fontSize: 9, color: C.textMuted, letterSpacing: "0.12em" }}>
          {rows.length} obs · {numericCols.length} numeric cols
          {panel && <span style={{ color: C.blue }}> · Panel {panel.entityCol}×{panel.timeCol}</span>}
        </span>
      </div>

      {/* ══ Body ══ */}
      <div style={{ flex: 1, display: "flex", minHeight: 0 }}>

        {/* ── LEFT: Spec Panel ── */}
        <div style={{ width: 300, flexShrink: 0, borderRight: `1px solid ${C.border}`, overflowY: "auto", padding: "1.2rem", paddingBottom: "3rem" }}>

          <EstimatorSidebar
            model={model}
            onSelect={handleModelSelect}
            modelAvail={modelAvail}
            modelHint={modelHint}
            panel={panel}
          />

          <VariableSelector
            model={model}
            numericCols={numericCols}
            yVar={yVar}   setYVar={setYVar}
            xVars={xVars} setXVars={setXVars}
            wVars={wVars} setWVars={setWVars}
          />

          <ModelConfiguration
            model={model}
            numericCols={numericCols}
            yVar={yVar}
            xVars={xVars}
            wVars={wVars}         setWVars={setWVars}
            zVars={zVars}         setZVars={setZVars}
            treatVar={treatVar}   setTreatVar={setTreatVar}
            postVar={postVar}     setPostVar={setPostVar}
            runningVar={runningVar} setRunningVar={setRunningVar}
            cutoff={cutoff}       setCutoff={setCutoff}
            bwMode={bwMode}       setBwMode={setBwMode}
            bwManual={bwManual}   setBwManual={setBwManual}
            kernel={kernel}       setKernel={setKernel}
            weightVar={weightVar} setWeightVar={setWeightVar}
          />

          <button
            onClick={estimate}
            disabled={running || !yVar.length}
            style={{
              width: "100%", padding: "0.75rem",
              background: !running && yVar.length ? `${C.teal}18` : "transparent",
              border: `1px solid ${!running && yVar.length ? C.teal : C.border}`,
              color: !running && yVar.length ? C.teal : C.textMuted,
              borderRadius: 4, cursor: !running && yVar.length ? "pointer" : "not-allowed",
              fontFamily: mono, fontSize: 13, letterSpacing: "0.12em",
              transition: "all 0.15s", marginTop: "0.5rem",
            }}
          >
            {running
              ? <span style={{ display: "inline-block", animation: "spin 1s linear infinite" }}>◌</span>
              : "▶ Estimate"}
          </button>

          {err && (
            <div style={{
              marginTop: "0.8rem", padding: "0.6rem 0.8rem",
              background: "#0d0808", border: `1px solid ${C.red}40`,
              borderLeft: `3px solid ${C.red}`, borderRadius: 4,
              fontSize: 11, color: C.red, fontFamily: mono, lineHeight: 1.6,
            }}>
              {err}
            </div>
          )}
        </div>

        {/* ── RIGHT: Results Panel ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.4rem 1.6rem", paddingBottom: "3rem" }}>

          {!result && !err && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "60%", gap: "1rem" }}>
              <div style={{ fontSize: 32, opacity: 0.15 }}>◈</div>
              <div style={{ fontSize: 11, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                Configure your model specification and click Estimate
              </div>
              <div style={{ fontSize: 10, color: C.textMuted, maxWidth: 420, textAlign: "center", lineHeight: 1.8 }}>
                Supported estimators: OLS · Fixed Effects · First Differences · 2SLS/IV · DiD 2×2 · TWFE · Sharp RDD · Logit · Probit
              </div>
            </div>
          )}

          {/* OLS */}
          {result?.type === "OLS" && result.main && (() => {
            const r = result.main;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1.2rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.green, letterSpacing: "0.24em", textTransform: "uppercase" }}>{r.modelLabel || "OLS"} Results</span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                  <span style={{ fontSize: 12, color: C.textMuted }}>{yVar[0]} ~ {[...xVars, ...wVars].join(" + ")}</span>
                </div>
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",     value: r.R2.toFixed(4),     color: C.green },
                  { label: "Adj. R²",value: r.adjR2.toFixed(4),  color: C.green },
                  { label: "F-stat", value: r.Fstat?.toFixed(3) ?? "—", color: C.gold },
                  { label: "p(F)",   value: r.Fpval != null ? (r.Fpval < 0.001 ? "<0.001" : r.Fpval.toFixed(4)) : "—", color: r.Fpval < 0.05 ? C.gold : C.textMuted },
                  { label: "n", value: r.n, color: C.text },
                  { label: "df",value: r.df, color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Coefficient Table — 95% Confidence Intervals</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.tStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                <Lbl color={C.textMuted}>Coefficient Plot & Diagnostics</Lbl>
                <PlotSelector
                  accentColor={C.green}
                  defaultId="yhat"
                  plots={[
                    { id: "yhat",  label: "Y vs Ŷ",
                      node: <YFittedPlot resid={r.resid} Yhat={r.Yhat} yLabel={yVar[0]} /> },
                    ...[...xVars, ...wVars].map((xc, i) => {
                      const idx = r.varNames.indexOf(xc);
                      return {
                        id: `partial_${xc}`,
                        label: `Y ~ ${xc}`,
                        node: <PartialPlot
                          rows={rows} yCol={yVar[0]} xCol={xc}
                          otherX={[...xVars, ...wVars].filter(x => x !== xc)}
                          beta_i={idx >= 0 ? r.beta[idx] : null}
                          pVal_i={idx >= 0 ? r.pVals[idx] : null}
                          runOLS={runOLS}
                          svgIdSuffix={`-${i}`}
                        />,
                      };
                    }),
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-ols" filename="ols_coefficients.svg" /> },
                    { id: "resid",  label: "Residuals vs Fitted",
                      node: <ResidualVsFitted resid={r.resid} Yhat={r.Yhat} /> },
                    { id: "qq",     label: "Q-Q",
                      node: <QQPlot resid={r.resid} /> },
                  ]}
                />
                <Lbl color={C.textMuted}>Note on Significance</Lbl>
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "1.4rem" }}>
                  *** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1 · Standard errors in parentheses
                </div>
                <DiagnosticsPanel resid={r.resid} rows={rows} xCols={diagX} model="OLS" />
                <ExportBar yVar={yVar[0]} results={r} model="OLS"
                  onReport={() => openReport({ ...r, modelLabel: "OLS", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  rScriptConfig={{ ...baseRConfig, model: { ...baseRConfig.model, type: "OLS", yVar: yVar[0], xVars, wVars } }} />
              </div>
            );
          })()}

          {/* Panel FE / FD */}
          {(result?.type === "FE" || result?.type === "FD") && (
            <PanelResults result={result} panel={panel} xVars={xVars} wVars={wVars} yVar={yVar} panelFE={panelFE} panelFD={panelFD} openReport={openReport} baseRConfig={baseRConfig} />
          )}

          {/* 2SLS */}
          {result?.type === "2SLS" && (
            <TwoSLSResults result={result} yVar={yVar} xVars={xVars} wVars={wVars} zVars={zVars} rows={rows} openReport={openReport} baseRConfig={baseRConfig} />
          )}

          {/* DiD / TWFE */}
          {(result?.type === "DiD" || result?.type === "TWFE") && result.main && (() => {
            const r = result.main;
            const isATT = r.att != null;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.teal, letterSpacing: "0.24em", textTransform: "uppercase" }}>
                    {result.type === "DiD" ? "DiD 2×2 Results" : "TWFE DiD Results"}
                  </span>
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                </div>
                {isATT && (
                  <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: "#081210", border: `1px solid ${C.teal}30`, borderLeft: `3px solid ${C.teal}`, borderRadius: 4 }}>
                    <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                      Average Treatment Effect on the Treated (ATT)
                    </div>
                    <div style={{ fontSize: 24, color: r.attP < 0.05 ? C.teal : C.textDim, fontFamily: mono }}>
                      {r.att >= 0 ? "+" : ""}{r.att.toFixed(4)}{stars(r.attP)}
                    </div>
                    <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                      SE = {r.attSE.toFixed(4)} · t = {r.attT.toFixed(3)} · p = {r.attP < 0.001 ? "<0.001" : r.attP.toFixed(4)}
                    </div>
                  </div>
                )}
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",     value: r.R2?.toFixed(4)    ?? "—", color: C.teal },
                  { label: "Adj. R²",value: r.adjR2?.toFixed(4) ?? "—", color: C.teal },
                  { label: "n",  value: r.n,        color: C.text },
                  { label: "df", value: r.df ?? "—", color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>Full Coefficient Table</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.tStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                <PlotSelector
                  accentColor={C.teal}
                  defaultId="main"
                  plots={[
                    result.type === "DiD"
                      ? { id: "main", label: "Parallel trends", node: <DiDPlot result={r} yLabel={yVar[0]} /> }
                      : { id: "main", label: "Event study",     node: <EventStudyPlot result={r} yLabel={yVar[0]} /> },
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId={`forest-${result.type.toLowerCase()}`} filename={`${result.type.toLowerCase()}_coefficients.svg`} /> },
                  ]}
                />
                <ExportBar yVar={yVar[0]} results={r} model={result.type}
                  onReport={() => openReport({ ...r, modelLabel: result.type === "DiD" ? "DiD 2×2" : "TWFE DiD", yVar: yVar[0], xVars: [...wVars] })}
                  rScriptConfig={{ ...baseRConfig, model: { ...baseRConfig.model, type: result.type, yVar: yVar[0], wVars,
                    postVar: postVar[0], treatVar: treatVar[0] } }}
                />
              </div>
            );
          })()}

          {/* Logit / Probit */}
          {(result?.type === "Logit" || result?.type === "Probit") && result.main && (() => {
            const r      = result.main;
            const family = r.family;
            const color  = C.violet;
            const meMap  = Object.fromEntries((r.marginalEffects ?? []).map(m => [m.variable, m.dy_dx]));
            const safeF  = (v, d = 4) => (v != null && isFinite(v)) ? v.toFixed(d) : "—";
            const convergenceWarn = !r.converged;
            // Y array for the valid rows (matches engine filtering logic)
            const allX = [...xVars, ...wVars];
            const validY = rows
              .filter(row => {
                const yv = row[yVar[0]];
                return (yv === 0 || yv === 1) && allX.every(c => typeof row[c] === "number" && isFinite(row[c]));
              })
              .map(row => row[yVar[0]]);

            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                {/* ── Header ── */}
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 10, color, letterSpacing: "0.24em", textTransform: "uppercase" }}>
                    {family === "logit" ? "Logistic Regression" : "Probit"} Results
                  </span>
                  <Badge label={`n = ${r.n}`}  color={C.textDim} />
                  <Badge label={`k = ${r.k}`}  color={C.textDim} />
                  {convergenceWarn && <Badge label={`⚠ did not converge (${r.iterations} iter)`} color={C.red} />}
                  {r.converged    && <Badge label={`✓ converged (${r.iterations} iter)`} color={C.green} />}
                </div>

                {convergenceWarn && (
                  <InfoBox color={C.red}>
                    ⚠ IRLS did not converge in {r.iterations} iterations. Results may be unreliable. Check for perfect separation or near-multicollinearity.
                  </InfoBox>
                )}

                {/* ── Fit statistics bar ── */}
                <FitBar items={[
                  { label: "McFadden R²", value: safeF(r.mcFaddenR2),          color,       hint: "1 − ℓ(β̂)/ℓ₀ — analogous to R² but not directly comparable" },
                  { label: "Log-lik",     value: safeF(r.logLik, 3),            color: C.gold },
                  { label: "AIC",         value: safeF(r.AIC, 2),               color: C.textDim },
                  { label: "BIC",         value: safeF(r.BIC, 2),               color: C.textDim },
                  { label: "n",           value: r.n,                            color: C.text },
                  { label: "df",          value: r.df,                           color: C.textDim },
                ]} />

                {/* ── Coefficient table ── */}
                <Lbl color={C.textMuted}>Coefficient Table (z-statistics · asymptotic SE)</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable
                    varNames={r.varNames} beta={r.beta} se={r.se}
                    tStats={r.zStats} pVals={r.pVals}
                    yVar={yVar[0]} df={null}
                    statLabel="z"
                    meMap={meMap}
                  />
                </div>

                {/* ── Marginal Effects at the Mean ── */}
                {r.marginalEffects?.length > 0 && (
                  <>
                    <Lbl color={C.textMuted}>Marginal Effects at the Mean (MEM) · dP(Y=1)/dx</Lbl>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", background: "#0a0a0a", padding: "0.45rem 0.75rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.13em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono }}>
                        <div>Variable</div>
                        <div style={{ textAlign: "right" }}>dP/dx at x̄</div>
                      </div>
                      {r.marginalEffects.map(({ variable, dy_dx }, i) => (
                        <div key={variable} style={{ display: "grid", gridTemplateColumns: "2fr 1fr", padding: "0.55rem 0.75rem", borderTop: i > 0 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? C.surface : C.surface2, fontFamily: mono }}>
                          <div style={{ fontSize: 12, color: C.text }}>{variable}</div>
                          <div style={{ textAlign: "right", fontSize: 13, color: dy_dx >= 0 ? C.green : C.red, fontFamily: mono }}>
                            {dy_dx >= 0 ? "+" : ""}{dy_dx.toFixed(4)}
                          </div>
                        </div>
                      ))}
                      <div style={{ padding: "0.35rem 0.75rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
                        Evaluated at sample means of all covariates
                      </div>
                    </div>
                  </>
                )}

                {/* ── Odds Ratios (Logit only) ── */}
                {family === "logit" && r.oddsRatios?.length > 0 && (
                  <>
                    <Lbl color={C.textMuted}>Odds Ratios · exp(β) with 95% CI</Lbl>
                    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
                      <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", background: "#0a0a0a", padding: "0.45rem 0.75rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.13em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono }}>
                        <div>Variable</div>
                        <div style={{ textAlign: "right" }}>OR</div>
                        <div style={{ textAlign: "right" }}>2.5%</div>
                        <div style={{ textAlign: "right" }}>97.5%</div>
                      </div>
                      {r.oddsRatios.map(({ variable, or, ciLo, ciHi }, i) => {
                        const isRef = variable === "(Intercept)";
                        return (
                          <div key={variable} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", padding: "0.55rem 0.75rem", borderTop: i > 0 ? `1px solid ${C.border}` : "none", background: i % 2 === 0 ? C.surface : C.surface2, fontFamily: mono }}>
                            <div style={{ fontSize: 12, color: isRef ? C.textMuted : C.text }}>{variable}</div>
                            <div style={{ textAlign: "right", fontSize: 13, color: or >= 1 ? C.green : C.red }}>{or.toFixed(4)}</div>
                            <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{ciLo.toFixed(4)}</div>
                            <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{ciHi.toFixed(4)}</div>
                          </div>
                        );
                      })}
                      <div style={{ padding: "0.35rem 0.75rem", background: "#0a0a0a", borderTop: `1px solid ${C.border}`, fontSize: 9, color: C.textMuted, fontFamily: mono }}>
                        OR &gt; 1 = positive association · OR &lt; 1 = negative association · CI based on ±1.96 × SE
                      </div>
                    </div>
                  </>
                )}

                {/* ── Plots ── */}
                <Lbl color={C.textMuted}>Model Diagnostics</Lbl>
                <PlotSelector
                  accentColor={color}
                  defaultId="roc"
                  plots={[
                    { id: "roc",  label: "ROC Curve",
                      node: <ROCCurve fitted={r.fitted} Y={validY} /> },
                    { id: "hist", label: "Predicted Probabilities",
                      node: <PredProbHistogram fitted={r.fitted} Y={validY} /> },
                    { id: "forest", label: "Coefficient plot",
                      node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId={`forest-${family}`} filename={`${family}_coefficients.svg`} /> },
                  ]}
                />

                {/* ── Significance note ── */}
                <div style={{ fontSize: 10, color: C.textMuted, fontFamily: mono, marginBottom: "1.4rem" }}>
                  *** p &lt; 0.01 · ** p &lt; 0.05 · * p &lt; 0.1 · z-statistics · SE from Fisher information matrix
                </div>

                {/* ── Export ── */}
                <ExportBar
                  yVar={yVar[0]}
                  results={r}
                  model={family === "logit" ? "Logit" : "Probit"}
                  latexBuilder={(yv, res) => buildBinaryLatex(yv, res)}
                  csvBuilder={(yv, res)   => buildBinaryCSV(yv, res)}
                  onReport={() => openReport({ ...r, modelLabel: family === "logit" ? "Logistic Regression" : "Probit", yVar: yVar[0], xVars: [...xVars, ...wVars] })}
                  rScriptConfig={baseRConfig ? { ...baseRConfig, model: { ...baseRConfig.model, type: result.type, yVar: yVar[0], xVars, wVars } } : null}
                />
              </div>
            );
          })()}

          {/* RDD */}
          {result?.type === "RDD" && result.main && (() => {
            const r = result.main;
            return (
              <div style={{ animation: "fadeUp 0.22s ease" }}>
                <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
                  <span style={{ fontSize: 10, color: C.orange, letterSpacing: "0.24em", textTransform: "uppercase" }}>Sharp RDD Results</span>
                  <Badge label={`bw = ${result.h.toFixed(3)}`} color={C.textDim} />
                  <Badge label={`n = ${r.n}`} color={C.textDim} />
                </div>
                <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: "#100a04", border: `1px solid ${C.orange}30`, borderLeft: `3px solid ${C.orange}`, borderRadius: 4 }}>
                  <div style={{ fontSize: 9, color: C.orange, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>
                    Local Average Treatment Effect (LATE) at cutoff = {r.cutoff}
                  </div>
                  <div style={{ fontSize: 24, color: r.lateP != null && r.lateP < 0.05 ? C.orange : C.textDim }}>
                    {r.late != null && isFinite(r.late) ? (r.late >= 0 ? "+" : "") + r.late.toFixed(4) : "N/A"}{r.lateP != null ? stars(r.lateP) : ""}
                  </div>
                  <div style={{ fontSize: 11, color: C.textDim, marginTop: 4 }}>
                    SE = {r.lateSE != null && isFinite(r.lateSE) ? r.lateSE.toFixed(4) : "N/A"} · p = {r.lateP != null && isFinite(r.lateP) ? (r.lateP < 0.001 ? "<0.001" : r.lateP.toFixed(4)) : "N/A"} · Kernel: {r.kernelType}
                  </div>
                </div>
                <RegressionEquation varNames={r.varNames} beta={r.beta} yVar={yVar[0]} />
                <FitBar items={[
                  { label: "R²",        value: r.R2?.toFixed(4) ?? "—", color: C.orange },
                  { label: "n in bw",   value: r.n,                     color: C.text },
                  { label: "cutoff",    value: r.cutoff,                 color: C.textDim },
                  { label: "bandwidth", value: result.h.toFixed(3),      color: C.textDim },
                ]} />
                <Lbl color={C.textMuted}>RDD Coefficient Table</Lbl>
                <div style={{ marginBottom: "1.2rem" }}>
                  <CoeffTable varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.tStats} pVals={r.pVals} yVar={yVar[0]} df={r.df} />
                </div>
                <PlotSelector
                  accentColor={C.orange}
                  defaultId="scatter"
                  plots={[
                    { id: "scatter", label: "Binned scatter",
                      node: <RDDPlot result={r} yLabel={yVar[0]} xLabel={runningVar[0]} /> },
                    { id: "bw",      label: "Bandwidth sensitivity",
                      node: <RDDBandwidthPlot
                        rows={rows} yCol={yVar[0]} runCol={runningVar[0]}
                        cutoff={parseFloat(cutoff)} optH={result.h}
                        kernel={kernel} controls={wVars} runSharpRDD={runSharpRDD}
                      /> },
                    { id: "mccrary", label: "McCrary density",
                      node: <McCraryPlot
                        result={runMcCrary(rows, runningVar[0], parseFloat(cutoff))}
                        xLabel={runningVar[0]}
                      /> },
                    ...wVars.map(xc => ({
                      id: `bal_${xc}`,
                      label: `Balance: ${xc}`,
                      node: <RDDCovariateBalance result={r} controls={[xc]} rows={rows} />,
                    })),
                  ]}
                />
                <ExportBar
                  yVar={yVar[0]}
                  results={{ ...r, varNames: r.varNames, adjR2: null }}
                  model="RDD"
                  onReport={() => openReport({ ...r, varNames: r.varNames, adjR2: null, modelLabel: "Sharp RDD", yVar: yVar[0], xVars: [...wVars] })}
                  rScriptConfig={{ ...baseRConfig, model: { ...baseRConfig.model, type: "RDD", yVar: yVar[0], wVars,
                    runningVar: runningVar[0], cutoff: parseFloat(cutoff), bandwidth: result.h, kernel } }}
                />
              </div>
            );
          })()}

          {/* ══ Research Coach ══ */}
          {result && (
            <ResearchCoach
              result={result}
              dataDictionary={cleanedData?.dataDictionary ?? null}
            />
          )}

        </div>
      </div>
    </div>
  );
}
