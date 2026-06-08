// ─── ECON STUDIO · resultDisplay.jsx ──────────────────────────────────────────
// Shared result-rendering display atoms. Extracted from ModelingTab.jsx.
// These depend on result shapes (varNames/beta/se/pVals), not on UI chrome.
// Imported by ModelingTab's inline result JSX AND by the per-estimator panels
// in ./results/. Keep this module free of estimator-specific logic.

import { useState, useMemo, useEffect, useRef } from "react";
import { useTheme, mono } from "./shared.jsx";
import { stars, buildLatex, buildCSVExport, downloadText } from "../../math/index.js";
import { generateRScript }      from "../../services/export/rScript.js";
import { generatePythonScript } from "../../services/export/pythonScript.js";
import { generateStataScript }  from "../../services/export/stataScript.js";
import { downloadReplicationBundle } from "../../services/export/replicationBundle.js";

export function Lbl({ children, color }) {
  const { C } = useTheme();
  color = color ?? C.textMuted;
  return (
    <div style={{ fontSize: 9, color, letterSpacing: "0.22em", textTransform: "uppercase", marginBottom: 8, fontFamily: mono }}>
      {children}
    </div>
  );
}
export function Badge({ label, color }) {
  const { C } = useTheme();
  return (
    <span style={{ fontSize: 9, padding: "2px 7px", border: `1px solid ${color}`, color, borderRadius: 2, letterSpacing: "0.1em", fontFamily: mono }}>
      {label}
    </span>
  );
}
export function InfoBox({ children, color }) {
  const { C } = useTheme();
  color = color ?? C.blue;
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
function buildEquationLatex(varNames, beta, yVar) {
  const fmt  = b => parseFloat(Math.abs(b).toFixed(4)).toString();
  const toTx = v => v.replace(/×/g, "\\times").replace(/−/g, "-").replace(/\^(\d+)/g, "^{$1}");
  const interceptIdx = varNames.indexOf("(Intercept)");
  const b0 = interceptIdx >= 0 ? beta[interceptIdx] : null;
  const regs = varNames.map((v, i) => ({ v, b: beta[i] })).filter(({ v }) => v !== "(Intercept)");
  const yTex = yVar ? `\\hat{${yVar.replace(/_/g, "\\_")}}` : "\\hat{y}";
  let eq = `${yTex} = `;
  if (b0 != null && isFinite(b0)) eq += (b0 < 0 ? "-" : "") + fmt(b0);
  regs.forEach(({ v, b }) => {
    if (!isFinite(b)) return;
    eq += (b < 0 ? " - " : " + ") + fmt(b) + " \\cdot \\text{" + toTx(v) + "}";
  });
  return eq;
}

export function RegressionEquation({ varNames, beta, yVar }) {
  const { C } = useTheme();
  const [latexCopied, setLatexCopied] = useState(false);
  if (!varNames.length || !beta.length) return null;
  const interceptIdx = varNames.indexOf("(Intercept)");
  const b0 = interceptIdx >= 0 ? beta[interceptIdx] : null;
  const regressors = varNames.map((v, i) => ({ v, b: beta[i] })).filter(({ v }) => v !== "(Intercept)");
  const fmt = b => {
    if (b == null || !isFinite(b)) return "N/A";
    const s = Math.abs(b).toFixed(4);
    return s === "0.0000" ? "0.0000" : s;
  };
  const copyLatex = () => {
    navigator.clipboard.writeText(buildEquationLatex(varNames, beta, yVar)).then(() => {
      setLatexCopied(true);
      setTimeout(() => setLatexCopied(false), 1800);
    });
  };
  return (
    <div style={{
      background: C.surface2, border: `1px solid ${C.border2}`,
      borderLeft: `3px solid ${C.teal}`, borderRadius: 4,
      padding: "0.9rem 1.1rem", marginBottom: "1.2rem",
    }}>
      {/* header row: title + copy LaTeX button */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
        <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono }}>
          Estimated Regression Equation
        </div>
        <button
          onClick={copyLatex}
          title="Copy as LaTeX equation"
          style={{
            fontSize: 8, fontFamily: mono, letterSpacing: "0.1em",
            padding: "2px 8px", borderRadius: 3, cursor: "pointer",
            border: `1px solid ${latexCopied ? C.teal : C.border2}`,
            background: latexCopied ? `${C.teal}18` : "transparent",
            color: latexCopied ? C.teal : C.textMuted,
            transition: "all 0.15s",
          }}
        >
          {latexCopied ? "✓ copied" : "copy LaTeX"}
        </button>
      </div>
      {/* equation line — only this row scrolls horizontally */}
      <div style={{ overflowX: "auto", whiteSpace: "nowrap" }}>
        <div style={{ fontSize: 13, fontFamily: mono, color: C.text, lineHeight: 1.8, display: "inline" }}>
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
      </div>
      <div style={{ marginTop: 6, fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.06em" }}>
        <span style={{ color: C.teal }}>teal</span> = significant (p&lt;0.05) ·{" "}
        <span style={{ color: C.red }}>red</span> = negative · coefficients rounded to 4 d.p.
      </div>
    </div>
  );
}

// ─── FOREST PLOT ─────────────────────────────────────────────────────────────
export function ForestPlot({ varNames, beta, se, pVals, svgId = "forest-plot", filename = "coefficient_plot.svg" }) {
  const { C } = useTheme();
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
        padding: "0.35rem 0.9rem", background: C.surface,
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

export function CoeffTable({ varNames, beta, se, tStats, pVals, yVar, df, statLabel = "t", meMap = null, dict = {}, rows = [], binaryVars = [] }) {
  const binarySet = new Set(binaryVars);
  const { C } = useTheme();
  const [open, setOpen] = useState(null);
  const [copied, setCopied] = useState(null);
  const z    = ciMultiplier(df);

  function toLatex() {
    const bodyRows = varNames.map((v, i) => {
      const b = beta[i], s = se[i], p = pVals[i];
      const st = stars(p);
      const vEsc = v.replace(/[_^&%$#{}~\\]/g, m => "\\" + m);
      return `  ${vEsc} & ${b.toFixed(4)} & (${s.toFixed(4)}) & ${st} \\\\`;
    });
    return [
      "\\begin{table}[htbp]",
      "\\centering",
      "\\begin{tabular}{lrrl}",
      "\\toprule",
      `Variable & $\\hat{\\beta}$ & (SE) & \\\\`,
      "\\midrule",
      ...bodyRows,
      "\\bottomrule",
      "\\end{tabular}",
      `\\caption{Dependent variable: ${yVar}}`,
      "\\label{tab:results}",
      "\\end{table}",
    ].join("\n");
  }

  function toMarkdown() {
    const header = "| Variable | β̂ | (SE) | p |";
    const sep    = "| :--- | ---: | ---: | ---: |";
    const bodyRows = varNames.map((v, i) => {
      const b = beta[i], s = se[i], p = pVals[i];
      const pStr = p < 0.001 ? "<0.001" : p?.toFixed(4) ?? "—";
      return `| ${v} | ${b.toFixed(4)} | (${s.toFixed(4)}) | ${pStr} ${stars(p)} |`;
    });
    return [header, sep, ...bodyRows].join("\n");
  }

  function copyFmt(fmt) {
    const text = fmt === "latex" ? toLatex() : toMarkdown();
    navigator.clipboard.writeText(text).then(() => {
      setCopied(fmt);
      setTimeout(() => setCopied(null), 2000);
    });
  }
  const COLS = "1.8fr 0.9fr 0.9fr 0.9fr 0.9fr 0.8fr 0.8fr 0.45fr";

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden" }}>
      <div style={{
        display: "grid", gridTemplateColumns: COLS,
        background: C.surface, padding: "0.5rem 0.75rem",
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
                background: isOpen ? C.surface2 : i % 2 === 0 ? C.surface : C.surface2,
                cursor: isInt ? "default" : "pointer",
                alignItems: "center", transition: "background 0.1s", fontFamily: mono,
              }}
              onMouseOver={e => { if (!isInt) e.currentTarget.style.background = C.surface2; }}
              onMouseOut={e => { if (!isOpen) e.currentTarget.style.background = i % 2 === 0 ? C.surface : C.surface2; }}
            >
              <div style={{ fontSize: 12, color: isInt ? C.textMuted : C.text, display: "flex", alignItems: "center", gap: 5 }}>
                {sig && !isInt && <span style={{ width: 5, height: 5, borderRadius: "50%", background: C.teal, display: "inline-block", flexShrink: 0 }} />}
                {v}{!isInt && <span style={{ fontSize: 9, color: C.textDim }}>▾</span>}
              </div>
              <div style={{ textAlign: "right", fontSize: 13, color: b >= 0 ? C.green : C.red, fontFamily: mono }}>{b.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>({s.toFixed(4)})</div>
              <div style={{ textAlign: "right", fontSize: 11, color: sig ? C.teal + "cc" : C.textMuted }}>{lo.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: sig ? C.teal + "cc" : C.textMuted }}>{hi.toFixed(4)}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: C.textDim }}>{tStats?.[i] != null ? Number(tStats[i]).toFixed(3) : "—"}</div>
              <div style={{ textAlign: "right", fontSize: 11, color: p < 0.05 ? C.gold : C.textMuted }}>{p < 0.001 ? "<0.001" : p?.toFixed(4) ?? "—"}</div>
              <div style={{ textAlign: "center", fontSize: 12, color: C.gold }}>{stars(p)}</div>
            </div>
            {isOpen && (
              <div style={{
                padding: "0.8rem 1.1rem 0.8rem 1.4rem", background: C.surface2,
                borderTop: `1px solid ${C.border}`, borderLeft: `3px solid ${C.gold}`,
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
                ) : (() => {
                  const desc = dict[v] ?? "";
                  const dummyMatch = desc.match(/^dummy\s+1\s*=\s*(.+)$/i);
                  // Binary detection: all non-null values are 0 or 1
                  const isBinary = rows.length > 0 && (() => {
                    const vals = rows.map(r => r[v]).filter(x => x != null && x !== "");
                    return vals.length > 0 && vals.every(x => { const n = Number(x); return (n === 0 || n === 1) && !isNaN(n); });
                  })();
                  const cleanDesc = desc && !/^entity identifier$/i.test(desc) ? desc : null;

                  // Helper: is `name` a 0/1 dummy? (explicit hint, dict "dummy 1 = …",
                  // or all of its values in the data are 0/1).
                  const isBinaryName = (name) => {
                    if (binarySet.has(name)) return true;
                    if (/^dummy\s+1\s*=/i.test(dict[name] ?? "")) return true;
                    if (rows.length > 0) {
                      const vals = rows.map(r => r[name]).filter(x => x != null && x !== "");
                      if (vals.length > 0 && vals.every(x => { const n = Number(x); return (n === 0 || n === 1) && !isNaN(n); })) return true;
                    }
                    return false;
                  };

                  // Interaction / DiD treatment terms: a "one-unit increase" reading is
                  // wrong — the slope is conditional on the other factor. Parse components
                  // from the label (strip a trailing "(…)" tag like "(ATT)", split on
                  // ×, _x_, or " x ") so it works even for synthetic labels that are not
                  // real columns (e.g. "Post × Treated (ATT)").
                  const tag   = v.match(/\(([^)]*)\)\s*$/);
                  const isATT = tag != null && /\bATT\b/i.test(tag[1]);
                  const core  = v.replace(/\s*\([^)]*\)\s*$/, "").trim();
                  const parts = core.split(/\s*[×·*]\s*|_x_| x /i).map(s => s.trim()).filter(Boolean);
                  const isInteraction = parts.length >= 2;

                  if (isInteraction || isATT) {
                    // Dummy × dummy (or an ATT, whose components are 0/1 treatment flags):
                    // read as a joint condition "when X1 = 1 and X2 = 1".
                    if (isInteraction && (isATT || parts.every(isBinaryName))) {
                      return (
                        <>
                          When {parts.map((pn, k) => (
                            <span key={pn}>
                              {k > 0 ? " and " : ""}<span style={{ color: C.text }}>{pn}</span> = 1
                            </span>
                          ))},{" "}
                          <span style={{ color: C.text }}>{yVar}</span> is{" "}
                          <span style={{ color: b >= 0 ? C.green : C.red }}>
                            {b >= 0 ? "+" : ""}{b.toFixed(4)} {b >= 0 ? "higher" : "lower"}
                          </span>{" "}
                          than the baseline group, ceteris paribus.
                          {isATT ? " This is the difference-in-differences treatment effect (ATT) under parallel trends." : ""}{" "}
                        </>
                      );
                    }
                    // ATT with no parseable components (e.g. TWFE "Treatment (ATT)").
                    if (isATT) {
                      return (
                        <>
                          Difference-in-differences estimate (ATT): the treated group&apos;s{" "}
                          <span style={{ color: C.text }}>{yVar}</span> changed by{" "}
                          <span style={{ color: b >= 0 ? C.green : C.red }}>
                            {b >= 0 ? "+" : ""}{b.toFixed(4)}
                          </span>{" "}
                          after treatment relative to the control group&apos;s trend — the causal
                          effect under the parallel-trends assumption.{" "}
                        </>
                      );
                    }
                    // Continuous × dummy: the dummy's marginal effect is conditional on the
                    // continuous term. With Y = … + β_c·C + β_d·D + β_int·(C·D), the effect of
                    // D switching 0→1 is β_d + β_int·C, and the slope of C shifts by β_int when
                    // D = 1. Pull main-effect βs from the table when present to show numbers.
                    if (parts.length === 2 && parts.filter(isBinaryName).length === 1) {
                      const binFirst  = isBinaryName(parts[0]);
                      const dummyName = binFirst ? parts[0] : parts[1];
                      const contName  = binFirst ? parts[1] : parts[0];
                      const cBeta     = beta[varNames.indexOf(contName)];
                      const dBeta     = beta[varNames.indexOf(dummyName)];
                      const slopeWhen1 = typeof cBeta === "number" ? (cBeta + b) : null;
                      return (
                        <>
                          Continuous × dummy interaction (<span style={{ color: C.text }}>{dummyName}</span> is binary).
                          When <span style={{ color: C.text }}>{dummyName}</span> = 1, the marginal effect of{" "}
                          <span style={{ color: C.text }}>{contName}</span> on <span style={{ color: C.text }}>{yVar}</span> shifts by{" "}
                          <span style={{ color: b >= 0 ? C.green : C.red }}>{b >= 0 ? "+" : ""}{b.toFixed(4)}</span>
                          {slopeWhen1 != null
                            ? <> (slope becomes <span style={{ color: C.text }}>{slopeWhen1.toFixed(4)}</span>)</>
                            : null}.{" "}
                          Equivalently, the effect of <span style={{ color: C.text }}>{dummyName}</span> (0→1) on{" "}
                          <span style={{ color: C.text }}>{yVar}</span> equals{" "}
                          <span style={{ color: C.text }}>
                            {typeof dBeta === "number" ? dBeta.toFixed(4) : `β(${dummyName})`} {b >= 0 ? "+" : "−"} {Math.abs(b).toFixed(4)}·{contName}
                          </span>
                          {" "}— it depends on the level of <span style={{ color: C.text }}>{contName}</span>, ceteris paribus.{" "}
                        </>
                      );
                    }
                    // Continuous × continuous (or 3+ way): symmetric marginal-effect reading.
                    return (
                      <>
                        Interaction term <span style={{ color: C.text }}>{v}</span>: a one-unit
                        increase in one component shifts the marginal effect of the other on{" "}
                        <span style={{ color: C.text }}>{yVar}</span> by{" "}
                        <span style={{ color: b >= 0 ? C.green : C.red }}>
                          {b >= 0 ? "+" : ""}{b.toFixed(4)}
                        </span>, ceteris paribus. Interpret jointly with the constituent main
                        effects, not in isolation.{" "}
                      </>
                    );
                  }

                  if (dummyMatch) {
                    const lbl = dummyMatch[1].trim();
                    return (
                      <>
                        When <span style={{ color: C.text }}>{v}</span> = 1 ({lbl}),{" "}
                        <span style={{ color: C.text }}>{yVar}</span> is{" "}
                        <span style={{ color: b >= 0 ? C.green : C.red }}>
                          {b >= 0 ? "+" : ""}{b.toFixed(4)} {b >= 0 ? "higher" : "lower"}
                        </span> than the reference group, ceteris paribus.{" "}
                      </>
                    );
                  }
                  if (isBinary || binarySet.has(v)) {
                    return (
                      <>
                        {cleanDesc
                          ? <>{cleanDesc} (<span style={{ color: C.text }}>{v}</span> = 1):</>
                          : <>When <span style={{ color: C.text }}>{v}</span> = 1,</>
                        }{" "}
                        <span style={{ color: C.text }}>{yVar}</span> is{" "}
                        <span style={{ color: b >= 0 ? C.green : C.red }}>
                          {b >= 0 ? "+" : ""}{b.toFixed(4)} {b >= 0 ? "higher" : "lower"}
                        </span>
                        {cleanDesc
                          ? <> compared to the reference group, ceteris paribus.{" "}</>
                          : <> than when <span style={{ color: C.text }}>{v}</span> = 0, ceteris paribus.{" "}</>
                        }
                      </>
                    );
                  }
                  // Continuous — append dict description as unit hint if available
                  const unitHint = cleanDesc ? ` (${cleanDesc})` : "";
                  return (
                    <>
                      A one-unit increase in <span style={{ color: C.text }}>{v}</span>{unitHint} is associated with a{" "}
                      <span style={{ color: b >= 0 ? C.green : C.red }}>
                        {b >= 0 ? "+" : ""}{b.toFixed(4)} {b >= 0 ? "increase" : "decrease"}
                      </span>{" "}
                      in <span style={{ color: C.text }}>{yVar}</span>, ceteris paribus.{" "}
                    </>
                  );
                })()}
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
        padding: "0.4rem 0.75rem", background: C.surface,
        borderTop: `1px solid ${C.border}`,
        fontSize: 9, color: C.textMuted, fontFamily: mono,
        display: "flex", justifyContent: "space-between", alignItems: "center",
      }}>
        <span>● significant at 5% · SE in parentheses</span>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span>95% CI = β̂ ± {z.toFixed(3)} × SE{df ? ` (t-dist, df=${df})` : " (z≈1.96)"}</span>
          {(["latex", "md"]).map(fmt => (
            <button key={fmt} onClick={() => copyFmt(fmt)} style={{
              background: "none", border: `1px solid ${C.border}`, borderRadius: 3,
              color: copied === fmt ? C.teal : C.textMuted,
              fontFamily: mono, fontSize: 8, padding: "1px 6px",
              cursor: "pointer", letterSpacing: "0.08em",
              transition: "color 0.15s, border-color 0.15s",
              borderColor: copied === fmt ? C.teal : C.border,
            }}>
              {copied === fmt ? "copied!" : fmt === "latex" ? "copy LaTeX" : "copy MD"}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── FIT STATS BAR ────────────────────────────────────────────────────────────
export function FitBar({ items }) {
  const { C } = useTheme();
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

// ─── REPLICATE DROPDOWN ───────────────────────────────────────────────────────
function ReplicateDropdown({ replicateConfig, model }) {
  const { C } = useTheme();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const handler = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (!replicateConfig) return null;

  const stem = (replicateConfig.filename ?? "analysis").replace(/\.[^.]+$/, "");

  const download = (content, ext) => {
    const blob = new Blob([content], { type: "text/plain" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${stem}_${model}${ext}`; a.click(); URL.revokeObjectURL(a.href);
    setOpen(false);
  };

  const options = [
    {
      label: "↓ R Script",
      color: C.green,
      action: () => download(generateRScript(replicateConfig), ".R"),
    },
    {
      label: "↓ Python Script",
      color: C.teal,
      action: () => download(generatePythonScript(replicateConfig), ".py"),
    },
    {
      label: "↓ Stata Do-file",
      color: C.blue,
      action: () => download(generateStataScript(replicateConfig), ".do"),
    },
    {
      label: "↓ ZIP Bundle  (R + Py + Do)",
      color: C.teal,
      action: () => { downloadReplicationBundle(replicateConfig); setOpen(false); },
      divider: true,
    },
  ];

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          height: "100%", padding: "0.6rem 1rem", background: open ? `${C.gold}14` : C.surface,
          border: "none", borderLeft: `1px solid ${C.border}`,
          color: open ? C.gold : C.textDim,
          cursor: "pointer", fontFamily: mono, fontSize: 11, transition: "background 0.15s",
          display: "flex", alignItems: "center", gap: 5, borderRadius: "0 0 4px 0",
        }}
        onMouseOver={e => { e.currentTarget.style.background = `${C.gold}14`; e.currentTarget.style.color = C.gold; }}
        onMouseOut={e =>  { if (!open) { e.currentTarget.style.background = C.surface; e.currentTarget.style.color = C.textDim; } }}
      >
        ⟨/⟩ Replicate <span style={{ fontSize: 9 }}>▾</span>
      </button>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0, zIndex: 200,
          background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 4, overflow: "hidden", minWidth: 160,
          boxShadow: "0 4px 16px rgba(0,0,0,0.6)", animation: "fadeUp 0.12s ease",
        }}>
          {options.map(({ label, color, action, divider }) => (
            <div key={label}>
              {divider && <div style={{ height: 1, background: C.border, margin: "3px 0" }} />}
              <button onClick={action}
                style={{
                  display: "block", width: "100%", textAlign: "left",
                  padding: "0.55rem 1rem", background: "transparent", border: "none",
                  color, cursor: "pointer", fontFamily: mono, fontSize: 11,
                  transition: "background 0.1s",
                }}
                onMouseOver={e => { e.currentTarget.style.background = `${color}14`; }}
                onMouseOut={e =>  { e.currentTarget.style.background = "transparent"; }}
              >{label}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── EXPORT BAR ───────────────────────────────────────────────────────────────
export function ExportBar({ yVar, results, model, onReport, replicateConfig, latexBuilder, csvBuilder }) {
  const { C } = useTheme();
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

  return (
    <div style={{ border: `1px solid ${C.border}`, borderRadius: 4, marginBottom: "1.2rem" }}>
      <div style={{ background: C.surface, padding: "0.45rem 1rem", fontSize: 9, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", borderBottom: `1px solid ${C.border}`, fontFamily: mono, borderRadius: "4px 4px 0 0" }}>
        Export
      </div>
      {/* Button row — inner group has overflow:hidden for rounded corners; Replicate sits outside it */}
      <div style={{ display: "flex", background: C.border, borderRadius: "0 0 4px 4px", gap: 1 }}>
        <div style={{ display: "flex", flex: 1, gap: 1, overflow: "hidden", borderRadius: "0 0 0 4px" }}>
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
              onMouseOver={e => { if (!active) e.currentTarget.style.background = C.surface2; }}
              onMouseOut={e =>  { if (!active) e.currentTarget.style.background = C.surface; }}
            >
              {label}
            </button>
          ))}
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
        <ReplicateDropdown replicateConfig={replicateConfig} model={model} />
      </div>
      {showLatex && (
        <div style={{ background: C.surface2, borderTop: `1px solid ${C.border}`, padding: "1rem", animation: "fadeUp 0.18s ease" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ fontSize: 10, color: "#5a8a5a", letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono }}>LaTeX · {model}</span>
            <button
              onClick={() => { navigator.clipboard.writeText(latex); setCopied(true); setTimeout(() => setCopied(false), 2000); }}
              style={{
                padding: "0.28rem 0.8rem",
                background: copied ? `${C.green}18` : "transparent",
                border: `1px solid ${copied ? C.green : C.border2}`,
                color: copied ? C.green : C.textMuted,
                borderRadius: 3, cursor: "pointer", fontSize: 10, fontFamily: mono, transition: "all 0.2s",
              }}
            >
              {copied ? "✓ Copied!" : "Copy"}
            </button>
          </div>
          <pre style={{ margin: 0, fontFamily: mono, fontSize: 10, color: C.green, lineHeight: 1.7, overflowX: "auto", whiteSpace: "pre" }}>
            {latex}
          </pre>
        </div>
      )}
    </div>
  );
}
