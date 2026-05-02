// ─── ECON STUDIO · components/modeling/ModelComparison.jsx ───────────────────
// Side-by-side comparison panel for 2–8 pinned EstimationResult objects.
//
// Props:
//   models         EstimationResult[]   — from modelBuffer.getAll()
//   dataDictionary Record<string,string> | null
//   onClose()

import { useState, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { stars } from "../../math/index.js";
import { compareModels } from "../../services/AI/AIService.js";
import { generateMultiModelRScript }     from "../../services/export/rScript.js";
import { generateMultiModelPythonScript } from "../../services/export/pythonScript.js";
import { generateMultiModelStataScript }  from "../../services/export/stataScript.js";
import { buildStargazer }                 from "../../services/export/latexTable.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

const TYPE_COLOR = {
  OLS:"#7ab896", WLS:"#7ab896", FE:"#6e9ec8", FD:"#6e9ec8",
  "2SLS":"#a87ec8", DiD:"#c8a96e", TWFE:"#c8a96e",
  RDD:"#c88e6e", Logit:"#9e7ec8", Probit:"#9e7ec8",
};

function safeN(v, dp = 4) {
  return v != null && isFinite(v) ? v.toFixed(dp) : "N/A";
}

function CopyBtn({ text, label = "Copy" }) {
  const { C } = useTheme();
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text).then(() => { setOk(true); setTimeout(() => setOk(false), 1800); }); }}
      style={{ padding: "3px 10px", borderRadius: 3, cursor: "pointer", fontFamily: mono,
               fontSize: 10, border: `1px solid ${ok ? C.teal : C.border2}`,
               background: ok ? `${C.teal}18` : "transparent",
               color: ok ? C.teal : C.textDim, transition: "all 0.15s" }}
    >
      {ok ? "Copied ✓" : label}
    </button>
  );
}

// ─── STARGAZER TABLE ──────────────────────────────────────────────────────────
// HTML coefficient table: variables in rows, models in columns.
function StargazerTable({ models }) {
  const { C } = useTheme();
  // Collect all variable names (union), intercept last
  const allVars = useMemo(() => {
    const set = new Set();
    models.forEach(m => (m.varNames ?? []).forEach(v => { if (v !== "(Intercept)") set.add(v); }));
    const arr = [...set];
    // check if any model has intercept
    const hasIntercept = models.some(m => (m.varNames ?? []).includes("(Intercept)"));
    if (hasIntercept) arr.push("(Intercept)");
    return arr;
  }, [models]);

  const colW = Math.max(90, Math.floor(360 / models.length));

  const hdrBg  = C.surface2;
  const cellSt = { padding: "5px 8px", fontFamily: mono, fontSize: 10, textAlign: "right", borderBottom: `1px solid ${C.border}` };
  const labelSt = { ...cellSt, textAlign: "left", color: C.textDim };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", borderSpacing: 0, fontFamily: mono, fontSize: 10 }}>
        <thead>
          <tr style={{ background: hdrBg }}>
            <th style={{ ...labelSt, color: C.textMuted, fontWeight: 400, minWidth: 140 }}>Variable</th>
            {models.map((m, i) => {
              const clr = TYPE_COLOR[m.type] ?? C.teal;
              return (
                <th key={m.id ?? i} style={{ ...cellSt, color: clr, fontWeight: 600, minWidth: colW }}>
                  {m.label ?? m.type ?? `M${i+1}`}
                </th>
              );
            })}
          </tr>
          {/* Model number row */}
          <tr style={{ background: C.surface }}>
            <td style={{ ...labelSt, fontSize: 9, color: C.textMuted }}></td>
            {models.map((_, i) => (
              <td key={i} style={{ ...cellSt, fontSize: 9, color: C.textMuted }}>({i+1})</td>
            ))}
          </tr>
        </thead>
        <tbody>
          {allVars.map(v => {
            const isIntercept = v === "(Intercept)";
            return (
              <tr key={v}>
                <td style={{ ...labelSt, color: isIntercept ? C.textMuted : C.text }}>
                  {v.length > 24 ? v.slice(0, 23) + "…" : v}
                </td>
                {models.map((m, mi) => {
                  const idx  = (m.varNames ?? []).indexOf(v);
                  const b    = idx >= 0 ? m.beta?.[idx]  : null;
                  const se   = idx >= 0 ? m.se?.[idx]    : null;
                  const p    = idx >= 0 ? m.pVals?.[idx] : null;
                  if (b == null || !isFinite(b)) {
                    return (
                      <td key={mi} style={{ ...cellSt, color: C.textMuted }}>—</td>
                    );
                  }
                  const sig  = stars(p);
                  const clr  = p != null && p < 0.05 ? C.text : C.textDim;
                  return (
                    <td key={mi} style={{ ...cellSt }}>
                      <div style={{ color: clr }}>{safeN(b, 4)}{sig}</div>
                      <div style={{ color: C.textMuted, fontSize: 9 }}>({safeN(se, 4)})</div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
        {/* Fit statistics footer */}
        <tfoot>
          <tr style={{ background: hdrBg }}>
            <td style={{ ...labelSt, color: C.textMuted }}>N</td>
            {models.map((m, i) => (
              <td key={i} style={{ ...cellSt, color: C.textDim }}>{m.n ?? "?"}</td>
            ))}
          </tr>
          <tr style={{ background: C.surface }}>
            <td style={{ ...labelSt, color: C.textMuted }}>R²</td>
            {models.map((m, i) => {
              const r2 = m.R2 ?? m.mcFaddenR2 ?? null;
              return <td key={i} style={{ ...cellSt, color: C.textDim }}>{r2 != null && isFinite(r2) ? r2.toFixed(4) : "—"}</td>;
            })}
          </tr>
          <tr style={{ background: hdrBg }}>
            <td style={{ ...labelSt, color: C.textMuted }}>Adj. R²</td>
            {models.map((m, i) => {
              const ar2 = m.adjR2 ?? null;
              return <td key={i} style={{ ...cellSt, color: C.textDim }}>{ar2 != null && isFinite(ar2) ? ar2.toFixed(4) : "—"}</td>;
            })}
          </tr>
          <tr style={{ background: C.surface }}>
            <td style={{ ...labelSt, color: C.textMuted, paddingBottom: 8 }}>AIC / BIC</td>
            {models.map((m, i) => {
              const aic = m.AIC ?? null;
              const bic = m.BIC ?? null;
              return (
                <td key={i} style={{ ...cellSt, color: C.textDim, paddingBottom: 8 }}>
                  {aic != null && isFinite(aic) ? aic.toFixed(1) : "—"} / {bic != null && isFinite(bic) ? bic.toFixed(1) : "—"}
                </td>
              );
            })}
          </tr>
          <tr>
            <td style={{ ...labelSt, fontSize: 8, color: C.textMuted, paddingTop: 4 }}>
              * p&lt;0.1 · ** p&lt;0.05 · *** p&lt;0.01 · SE in parentheses
            </td>
            {models.map((_, i) => <td key={i} style={{ ...cellSt, paddingTop: 4 }} />)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── COEFFICIENT STABILITY HEATMAP ───────────────────────────────────────────
// Per variable, shows β across models + color-codes by sign change / significance.
function StabilityHeatmap({ models }) {
  const { C } = useTheme();
  const allVars = useMemo(() => {
    const set = new Set();
    models.forEach(m => (m.varNames ?? []).forEach(v => { if (v !== "(Intercept)") set.add(v); }));
    return [...set];
  }, [models]);

  if (!allVars.length) return null;

  const rowH    = 30;
  const colW    = Math.max(70, Math.floor(560 / models.length));
  const labelW  = 150;
  const PAD     = { t: 36, b: 8 };
  const W       = labelW + models.length * colW + 16;
  const H       = allVars.length * rowH + PAD.t + PAD.b;

  // For each cell: compute fill color based on β sign, significance
  function cellColor(b, p) {
    if (b == null || !isFinite(b)) return C.surface2;
    const sig = p != null && p < 0.05;
    if (b > 0) return sig ? "#1f4a38" : "#182b22";  // green shades
    return sig ? "#4a1f1f" : "#2b1818";             // red shades
  }

  return (
    <div style={{ overflowX: "auto" }}>
      <svg viewBox={`0 0 ${W} ${H}`}
           style={{ width: "100%", minWidth: 400, display: "block", fontFamily: mono }}>
        <rect width={W} height={H} fill={C.bg} />

        {/* Column headers */}
        {models.map((m, mi) => {
          const clr = TYPE_COLOR[m.type] ?? C.teal;
          const x = labelW + mi * colW + colW / 2;
          return (
            <text key={mi} x={x} y={PAD.t - 8} textAnchor="middle"
                  fill={clr} fontSize={9} fontFamily={mono}>
              {(m.label ?? m.type ?? `M${mi+1}`).slice(0, 10)}
            </text>
          );
        })}

        {/* Rows */}
        {allVars.map((v, vi) => {
          const y0 = PAD.t + vi * rowH;
          const cy = y0 + rowH / 2;
          // Row background alternation
          const hasSgChange = models.some((m, i) => {
            const idxA = (models[0].varNames ?? []).indexOf(v);
            const idxI = (m.varNames ?? []).indexOf(v);
            if (idxA < 0 || idxI < 0) return false;
            const bA = models[0].beta?.[idxA] ?? null;
            const bI = m.beta?.[idxI] ?? null;
            return bA != null && bI != null && isFinite(bA) && isFinite(bI) && Math.sign(bA) !== Math.sign(bI);
          });

          return (
            <g key={v}>
              {/* Variable label */}
              <text x={labelW - 8} y={cy + 4} textAnchor="end"
                    fill={hasSgChange ? C.yellow : C.textDim} fontSize={9.5}>
                {v.length > 19 ? v.slice(0, 18) + "…" : v}
              </text>

              {/* Model cells */}
              {models.map((m, mi) => {
                const idx = (m.varNames ?? []).indexOf(v);
                const b   = idx >= 0 ? m.beta?.[idx]  : null;
                const p   = idx >= 0 ? m.pVals?.[idx] : null;
                const x0  = labelW + mi * colW;
                const fill = cellColor(b, p);

                return (
                  <g key={mi}>
                    <rect x={x0 + 1} y={y0 + 1} width={colW - 2} height={rowH - 2}
                          fill={fill} rx={2} />
                    {b != null && isFinite(b) && (
                      <text x={x0 + colW / 2} y={cy + 3} textAnchor="middle"
                            fill={b > 0 ? C.green : C.red} fontSize={9} fontFamily={mono}>
                        {b > 0 ? "+" : ""}{safeN(b, 3)}{stars(p)}
                      </text>
                    )}
                    {(b == null || !isFinite(b)) && (
                      <text x={x0 + colW / 2} y={cy + 3} textAnchor="middle"
                            fill={C.textMuted} fontSize={9}>—</text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
      <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginTop: 4 }}>
        Green cells = positive β · Red cells = negative β · Bright fill = p &lt; 0.05 · Yellow label = sign change across models
      </div>
    </div>
  );
}

// ─── FIT STATS GRID ───────────────────────────────────────────────────────────
function FitGrid({ models }) {
  const { C } = useTheme();
  const rows = [
    { label: "R²",      fn: m => m.R2     != null && isFinite(m.R2)     ? m.R2.toFixed(4)     : "—" },
    { label: "Adj. R²", fn: m => m.adjR2  != null && isFinite(m.adjR2)  ? m.adjR2.toFixed(4)  : "—" },
    { label: "F-stat",  fn: m => m.Fstat  != null && isFinite(m.Fstat)  ? m.Fstat.toFixed(3)  : "—" },
    { label: "p(F)",    fn: m => m.Fpval  != null && isFinite(m.Fpval)  ? (m.Fpval < 0.001 ? "<0.001" : m.Fpval.toFixed(4)) : "—" },
    { label: "N",       fn: m => m.n ?? "—" },
    { label: "AIC",     fn: m => m.AIC    != null && isFinite(m.AIC)    ? m.AIC.toFixed(1)    : "—" },
    { label: "BIC",     fn: m => m.BIC    != null && isFinite(m.BIC)    ? m.BIC.toFixed(1)    : "—" },
    { label: "ATT",     fn: m => m.att    != null && isFinite(m.att)    ? m.att.toFixed(4)    : "—" },
    { label: "LATE",    fn: m => m.late   != null && isFinite(m.late)   ? m.late.toFixed(4)   : "—" },
    { label: "McF. R²", fn: m => m.mcFaddenR2 != null && isFinite(m.mcFaddenR2) ? m.mcFaddenR2.toFixed(4) : "—" },
  ];

  const st  = { padding: "4px 10px", fontFamily: mono, fontSize: 10, borderBottom: `1px solid ${C.border}` };

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: C.surface2 }}>
            <th style={{ ...st, textAlign: "left", color: C.textMuted, fontWeight: 400, width: 100 }}>Statistic</th>
            {models.map((m, i) => {
              const clr = TYPE_COLOR[m.type] ?? C.teal;
              return (
                <th key={i} style={{ ...st, textAlign: "right", color: clr, fontWeight: 600 }}>
                  {m.label ?? m.type ?? `M${i+1}`}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ label, fn }) => {
            const vals = models.map(fn);
            if (vals.every(v => v === "—")) return null;  // skip empty rows
            return (
              <tr key={label}>
                <td style={{ ...st, color: C.textDim }}>{label}</td>
                {vals.map((v, i) => (
                  <td key={i} style={{ ...st, textAlign: "right", color: v === "—" ? C.textMuted : C.text }}>{v}</td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── MULTI-MODEL EXPORT ───────────────────────────────────────────────────────
function ExportBlock({ models, dataDictionary }) {
  const { C } = useTheme();
  const [lang, setLang] = useState("r");

  const script = useMemo(() => {
    if (lang === "latex") {
      return buildStargazer(models.map((m, i) => ({
        label:  m.label ?? m.type ?? `M${i + 1}`,
        result: m,
        yVar:   m.spec?.yVar ?? m.yVar ?? "y",
      })));
    }
    const configs = models.map(m => ({
      model: {
        type: m.type,
        yVar:       m.spec?.yVar       ?? m.yVar       ?? "y",
        xVars:      m.spec?.xVars      ?? m.xVars      ?? [],
        wVars:      m.spec?.wVars      ?? m.wVars      ?? [],
        zVars:      m.spec?.zVars      ?? m.zVars      ?? [],
        entityCol:  m.spec?.entityCol  ?? null,
        timeCol:    m.spec?.timeCol    ?? null,
        postVar:    m.spec?.postVar    ?? null,
        treatVar:   m.spec?.treatVar   ?? null,
        runningVar: m.spec?.runningVar ?? null,
        cutoff:     m.spec?.cutoff     ?? null,
        bandwidth:  m.spec?.bandwidth  ?? null,
        kernel:     m.spec?.kernel     ?? "triangular",
      },
      label: m.label ?? m.type ?? "Model",
    }));
    if (lang === "r")      return generateMultiModelRScript(configs, dataDictionary);
    if (lang === "python") return generateMultiModelPythonScript(configs, dataDictionary);
    if (lang === "stata")  return generateMultiModelStataScript(configs, dataDictionary);
    return "";
  }, [models, dataDictionary, lang]);

  const ext = lang === "r" ? ".R" : lang === "python" ? ".py" : lang === "stata" ? ".do" : ".tex";
  const LANGS = [
    { id: "r",      label: "R" },
    { id: "python", label: "Python" },
    { id: "stata",  label: "Stata" },
    { id: "latex",  label: "LaTeX" },
  ];

  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 10, alignItems: "center" }}>
        {LANGS.map(({ id, label }) => (
          <button key={id} onClick={() => setLang(id)}
            style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                     border: `1px solid ${lang === id ? C.teal : C.border2}`,
                     background: lang === id ? `${C.teal}14` : "transparent",
                     color: lang === id ? C.teal : C.textDim, cursor: "pointer" }}>
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <CopyBtn text={script} label={`Copy ${ext}`} />
        <button
          onClick={() => {
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([script], { type: "text/plain" }));
            a.download = `comparison_script${ext}`;
            a.click();
          }}
          style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                   border: `1px solid ${C.border2}`, background: "transparent",
                   color: C.textDim, cursor: "pointer" }}
        >
          Download
        </button>
      </div>
      {lang === "latex" && (
        <div style={{ fontSize: 9, color: C.textMuted, marginBottom: 8, fontFamily: mono }}>
          Add <span style={{ color: C.gold }}>{"\\usepackage{booktabs}"}</span> to your preamble if needed.
          Paste into your <span style={{ color: C.gold }}>\\begin{"{document}"}</span> body.
        </div>
      )}
      <pre style={{
        background: C.surface2, border: `1px solid ${C.border}`,
        borderRadius: 4, padding: "0.8rem", fontSize: 9, color: C.textDim,
        fontFamily: mono, overflowX: "auto", maxHeight: 240, lineHeight: 1.6,
        margin: 0,
      }}>
        {script}
      </pre>
    </div>
  );
}

// ─── AI NARRATIVE ─────────────────────────────────────────────────────────────
function AICompareNarrative({ models, dataDictionary }) {
  const { C } = useTheme();
  const [text, setText]       = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const run = async () => {
    setLoading(true); setError(null);
    try {
      const result = await compareModels(models, dataDictionary);
      setText(result);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      {!text && !loading && (
        <button onClick={run}
          style={{ padding: "5px 14px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                   border: `1px solid ${C.teal}`, background: `${C.teal}14`,
                   color: C.teal, cursor: "pointer" }}>
          ◈ Generate AI Comparison
        </button>
      )}
      {loading && (
        <div style={{ fontSize: 11, color: C.textDim, fontFamily: mono }}>
          <span style={{ display: "inline-block", animation: "spin 0.8s linear infinite", marginRight: 8 }}>◌</span>
          Generating comparison…
        </div>
      )}
      {error && (
        <div style={{ fontSize: 10, color: C.red, fontFamily: mono }}>{error}</div>
      )}
      {text && (
        <div>
          <div style={{
            fontSize: 12, color: C.textDim, lineHeight: 1.9,
            fontFamily: "'IBM Plex Sans', sans-serif",
            background: C.surface2, padding: "1rem", borderRadius: 4,
            border: `1px solid ${C.border}`, whiteSpace: "pre-wrap",
          }}>
            {text}
          </div>
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <CopyBtn text={text} label="Copy narrative" />
            <button onClick={run} style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 10,
                                           border: `1px solid ${C.border2}`, background: "transparent",
                                           color: C.textDim, cursor: "pointer" }}>
              Regenerate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────────────────────
function SectionHdr({ children }) {
  const { C } = useTheme();
  return (
    <div style={{
      fontSize: 9, color: C.textMuted, letterSpacing: "0.22em",
      textTransform: "uppercase", marginBottom: 10, marginTop: 24,
      borderBottom: `1px solid ${C.border}`, paddingBottom: 6,
      fontFamily: mono,
    }}>
      {children}
    </div>
  );
}

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────
export default function ModelComparison({ models, dataDictionary, onClose }) {
  const { C } = useTheme();
  const [tab, setTab] = useState("table");

  if (!models?.length) return null;

  const tabs = [
    { id: "table",   label: "Coefficients" },
    { id: "fit",     label: "Fit Stats" },
    { id: "heatmap", label: "Stability" },
    { id: "ai",      label: "AI Analysis" },
    { id: "export",  label: "Export" },
  ];

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 200,
      background: "rgba(0,0,0,0.72)",
      display: "flex", alignItems: "center", justifyContent: "center",
    }}>
      <div style={{
        width: "min(92vw, 900px)", maxHeight: "88vh",
        background: C.bg, border: `1px solid ${C.border2}`,
        borderRadius: 6, display: "flex", flexDirection: "column",
        overflow: "hidden",
      }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", gap: 12,
          padding: "0.9rem 1.2rem",
          borderBottom: `1px solid ${C.border}`,
          background: C.surface,
          flexShrink: 0,
        }}>
          <div style={{ fontSize: 10, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase" }}>
            Model Comparison
          </div>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            {models.length} model{models.length > 1 ? "s" : ""} pinned
          </div>
          {/* Model labels */}
          <div style={{ display: "flex", gap: 6, flex: 1, flexWrap: "wrap" }}>
            {models.map((m, i) => {
              const clr = TYPE_COLOR[m.type] ?? C.teal;
              return (
                <span key={i} style={{
                  fontSize: 9, color: clr, border: `1px solid ${clr}40`,
                  borderRadius: 2, padding: "1px 6px", fontFamily: mono,
                }}>
                  ({i+1}) {m.label ?? m.type}
                </span>
              );
            })}
          </div>
          <button onClick={onClose}
            style={{ background: "none", border: "none", cursor: "pointer",
                     color: C.textMuted, fontSize: 16, padding: "0 4px" }}>
            ×
          </button>
        </div>

        {/* Tab bar */}
        <div style={{
          display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`,
          background: C.surface2, flexShrink: 0,
        }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "0.55rem 1rem",
                background: "transparent",
                border: "none",
                borderBottom: tab === t.id ? `2px solid ${C.teal}` : "2px solid transparent",
                color: tab === t.id ? C.teal : C.textDim,
                fontFamily: mono, fontSize: 10, cursor: "pointer",
                letterSpacing: "0.1em",
                transition: "color 0.12s",
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "1.2rem 1.4rem" }}>

          {tab === "table" && (
            <>
              <SectionHdr>Coefficient Table</SectionHdr>
              <StargazerTable models={models} />
            </>
          )}

          {tab === "fit" && (
            <>
              <SectionHdr>Fit Statistics</SectionHdr>
              <FitGrid models={models} />
            </>
          )}

          {tab === "heatmap" && (
            <>
              <SectionHdr>Coefficient Stability</SectionHdr>
              <StabilityHeatmap models={models} />
            </>
          )}

          {tab === "ai" && (
            <>
              <SectionHdr>AI Comparative Analysis</SectionHdr>
              <AICompareNarrative models={models} dataDictionary={dataDictionary} />
            </>
          )}

          {tab === "export" && (
            <>
              <SectionHdr>Multi-Model Replication Script</SectionHdr>
              <ExportBlock models={models} dataDictionary={dataDictionary} />
            </>
          )}

        </div>
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
