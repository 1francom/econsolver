// ─── ECON STUDIO · results/FuzzyRDDResults.jsx ────────────────────────────────
// Fuzzy RDD (IV-LATE) result panel + its LaTeX export helpers.
// Extracted from ModelingTab.jsx.

import { useState, useMemo } from "react";
import { useTheme } from "../shared.jsx";
import { stars, runMcCrary, downloadText } from "../../../math/index.js";
import { Lbl, Badge, RegressionEquation, ForestPlot, CoeffTable, FitBar, ExportBar } from "../resultDisplay.jsx";
import { PlotSelector, RDDPlot, McCraryPlot } from "../ModelPlots.jsx";

// ─── FUZZY RDD LATEX EXPORT ──────────────────────────────────────────────────
function buildFuzzyLatex(stage, result, yVar, fsVarNames, treatVarName) {
  const fmtP = p => p == null ? "N/A" : p < 0.001 ? "$<$0.001" : p.toFixed(4);
  if (stage === "second") {
    const vars = result.varNames ?? [];
    const rows = vars.map((v, i) => {
      const b = result.beta?.[i], se = result.se?.[i];
      const t = result.tStats?.[i], p = result.pVals?.[i];
      const strs = p != null ? stars(p) : "";
      return `  ${v.replace(/_/g, "\\_")} & ${b?.toFixed(4) ?? "N/A"}${strs} & ${se?.toFixed(4) ?? "N/A"} & ${t?.toFixed(3) ?? "N/A"} & ${fmtP(p)} \\\\`;
    }).join("\n");
    return `\\begin{table}[htbp]
\\centering
\\caption{Fuzzy RDD --- Second Stage (IV): \\texttt{${yVar}}}
\\begin{tabular}{lrrrr}
\\hline\\hline
Variable & Estimate & Std. Error & t-value & Pr($>|t|$) \\\\
\\hline
${rows}
\\hline
\\multicolumn{5}{l}{$R^2 = ${result.R2?.toFixed(4) ?? "N/A"}$, $n = ${result.n ?? "N/A"}$, bw $= ${result.bandwidth?.toFixed(4) ?? "N/A"}$, FS $F = ${result.firstStageFstat?.toFixed(2) ?? "N/A"}$} \\\\
\\multicolumn{5}{l}{Significance: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\
\\hline
\\end{tabular}
\\end{table}`;
  } else {
    const fs = result.firstStage;
    const vars = fsVarNames ?? [];
    const rows = vars.map((v, i) => {
      const b = fs?.beta?.[i], se = fs?.se?.[i];
      const t = fs?.tStats?.[i], p = fs?.pVals?.[i];
      const strs = p != null ? stars(p) : "";
      return `  ${v.replace(/_/g, "\\_")} & ${b?.toFixed(4) ?? "N/A"}${strs} & ${se?.toFixed(4) ?? "N/A"} & ${t?.toFixed(3) ?? "N/A"} & ${fmtP(p)} \\\\`;
    }).join("\n");
    return `\\begin{table}[htbp]
\\centering
\\caption{Fuzzy RDD --- First Stage: \\texttt{${treatVarName ?? "D"}} $\\sim$ Z + running variable}
\\begin{tabular}{lrrrr}
\\hline\\hline
Variable & Estimate & Std. Error & t-value & Pr($>|t|$) \\\\
\\hline
${rows}
\\hline
\\multicolumn{5}{l}{$R^2 = ${fs?.R2?.toFixed(4) ?? "N/A"}$, $F\\text{-stat} = ${result.firstStageFstat?.toFixed(2) ?? "N/A"}$, Jump in D $= ${result.firstStageJumpD?.toFixed(4) ?? "N/A"}$} \\\\
\\multicolumn{5}{l}{Significance: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\
\\hline
\\end{tabular}
\\end{table}`;
  }
}

function FuzzyLatexExport({ stage, result, yVar, fsVarNames, treatVarName }) {
  const { C, T } = useTheme();
  const [open, setOpen] = useState(false);
  const latex = useMemo(
    () => buildFuzzyLatex(stage, result, yVar, fsVarNames, treatVarName),
    [stage, result, yVar, fsVarNames, treatVarName]
  );
  return (
    <div style={{ marginBottom: "0.8rem" }}>
      <button
        onClick={() => setOpen(s => !s)}
        style={{ padding: "0.4rem 0.9rem", background: open ? C.goldFaint : C.surface2, border: `1px solid ${C.border}`, color: open ? C.gold : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, borderRadius: 3, transition: "all 0.15s" }}
      >
        {open ? "▾" : "▸"} LaTeX table
      </button>
      {open && (
        <div style={{ position: "relative", marginTop: 4 }}>
          <pre style={{ background: C.surface2, border: `1px solid ${C.border}`, borderRadius: 3, padding: "0.7rem 1rem", fontSize: T.caption.fontSize, color: C.text, fontFamily: T.code.fontFamily, overflowX: "auto", margin: 0 }}>
            {latex}
          </pre>
          <button
            onClick={() => downloadText(latex, `fuzzyrdd_${stage}_stage_${yVar}.tex`)}
            style={{ position: "absolute", top: 6, right: 8, padding: "0.25rem 0.6rem", background: C.surface, border: `1px solid ${C.border}`, color: C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, borderRadius: 3 }}
          >
            ↓ .tex
          </button>
        </div>
      )}
    </div>
  );
}

// ─── FUZZY RDD RESULTS ───────────────────────────────────────────────────────
export default function FuzzyRDDResults({ result, yVar, treatVarName, runningVar, dict = {}, rows = [], openReport, baseReplicateConfig }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("second");
  const r  = result;
  const fs = r.firstStage;
  const fsVarNames = r.firstStageVarNames ?? ["(Intercept)", "Z (instrument)", "running − c", "Z × (running − c)"];

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.orange, letterSpacing: "0.24em", textTransform: "uppercase" }}>Fuzzy RDD Results</span>
        <Badge label={`n = ${r.n}`} color={C.textDim} />
        {r.weak && <Badge label="⚠ Weak instrument (F < 10)" color={C.red} />}
      </div>

      {/* LATE highlight */}
      <div style={{ padding: "1rem 1.2rem", marginBottom: "1.2rem", background: C.surface2, border: `1px solid ${C.orange}30`, borderLeft: `3px solid ${C.orange}`, borderRadius: 4 }}>
        <div style={{ fontSize: T.caption.fontSize, color: C.orange, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: 6 }}>Local Average Treatment Effect (LATE)</div>
        <div style={{ fontSize: T.h2.fontSize, color: r.lateP < 0.05 ? C.orange : C.textDim, fontFamily: T.code.fontFamily }}>
          {r.late >= 0 ? "+" : ""}{r.late?.toFixed(4) ?? "—"}{stars(r.lateP)}
        </div>
        <div style={{ fontSize: T.code.fontSize, color: C.textDim, marginTop: 4 }}>
          SE = {r.lateSE?.toFixed(4) ?? "—"} · p = {r.lateP < 0.001 ? "<0.001" : r.lateP?.toFixed(4) ?? "—"}
        </div>
        <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, marginTop: 8 }}>
          Compliance (first-stage jump): {r.firstStageJumpD?.toFixed(4) ?? "—"} · F = {r.firstStageFstat?.toFixed(2) ?? "—"} · Wald ratio: {r.waldRatio?.toFixed(4) ?? "—"}
        </div>
      </div>

      {/* Stage tab switcher */}
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[["second", "Second Stage (Structural)"], ["first", "First Stage (Instrument)"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: "0.6rem 0.8rem", background: tab === k ? `${C.orange}20` : C.surface, border: "none", color: tab === k ? C.orange : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, borderBottom: tab === k ? `2px solid ${C.orange}` : "2px solid transparent", transition: "all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>

      {/* Second stage */}
      {tab === "second" && (
        <>
          <FitBar items={[
            { label: "n (bw)", value: r.n,                                         color: C.text },
            { label: "df",     value: r.df,                                         color: C.textDim },
            { label: "R²",     value: r.R2?.toFixed(4) ?? "—",                     color: C.orange },
            { label: "FS-F",   value: r.firstStageFstat?.toFixed(2) ?? "—",        color: r.weak ? C.red : C.gold },
          ]} />
          <Lbl color={C.textMuted}>Second-Stage Coefficient Table</Lbl>
          <CoeffTable dict={dict} rows={rows} varNames={r.varNames} beta={r.beta} se={r.se} tStats={r.testStats} pVals={r.pVals} yVar={yVar} df={r.df} />
          <FuzzyLatexExport stage="second" result={r} yVar={yVar} fsVarNames={fsVarNames} treatVarName={treatVarName} />
          <PlotSelector accentColor={C.orange} defaultId="rdd" plots={[
            { id: "rdd",    label: "RDD Plot",
              node: <RDDPlot result={r.rddData ?? {}} yLabel={yVar} xLabel={runningVar} /> },
            { id: "forest", label: "Coefficient plot",
              node: <ForestPlot varNames={r.varNames} beta={r.beta} se={r.se} pVals={r.pVals} svgId="forest-fuzzyrdd" filename="fuzzyrdd_coefficients.svg" /> },
            { id: "mccrary", label: "McCrary density",
              node: <McCraryPlot
                result={r.mcCrary ?? (r.rddData?.cutoff != null ? runMcCrary(rows, runningVar, r.rddData.cutoff) : null)}
                xLabel={runningVar}
              /> },
          ]} />
        </>
      )}

      {/* First stage */}
      {tab === "first" && fs && (
        <>
          <FitBar items={[
            { label: "R²",     value: fs.R2?.toFixed(4)                 ?? "—", color: C.gold },
            { label: "F-stat", value: r.firstStageFstat?.toFixed(2)     ?? "—", color: r.weak ? C.red : C.gold },
            { label: "Jump D", value: r.firstStageJumpD?.toFixed(4)     ?? "—", color: C.text },
            { label: "df",     value: fs.df,                                      color: C.textDim },
          ]} />
          {r.weak && (
            <div style={{ padding: "0.6rem 0.8rem", marginBottom: "0.8rem", background: C.surface2, border: `1px solid ${C.red}40`, borderLeft: `3px solid ${C.red}`, borderRadius: 4, fontSize: T.caption.fontSize, color: C.red, fontFamily: T.code.fontFamily }}>
              ⚠ F-stat = {r.firstStageFstat?.toFixed(2)} &lt; 10 — weak instrument. LATE estimate may be unreliable.
            </div>
          )}
          <Lbl color={C.textMuted}>First-Stage Coefficient Table — D ~ Z + running variable</Lbl>
          <CoeffTable dict={dict} rows={rows} varNames={fsVarNames} beta={fs.beta} se={fs.se} tStats={fs.tStats} pVals={fs.pVals} yVar={treatVarName ?? "D"} df={fs.df} />
          <FuzzyLatexExport stage="first" result={r} yVar={yVar} fsVarNames={fsVarNames} treatVarName={treatVarName} />
          <PlotSelector accentColor={C.gold} defaultId="fs_forest" plots={[
            { id: "fs_forest", label: "Coefficient plot",
              node: <ForestPlot varNames={fsVarNames} beta={fs.beta} se={fs.se} pVals={fs.pVals} svgId="forest-fuzzyrdd-fs" filename="fuzzyrdd_first_stage.svg" /> },
          ]} />
        </>
      )}
      <ExportBar
        yVar={yVar}
        results={r}
        model="FuzzyRDD"
        onReport={() => openReport({
          ...r,
          modelLabel: "Fuzzy RDD (IV-LATE)",
          yVar,
          xVars: r.spec?.wVars ?? [],
        })}
        replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: {
          ...baseReplicateConfig.model,
          type: "FuzzyRDD",
          yVar,
          wVars: r.spec?.wVars ?? [],
          treatVar: treatVarName,
          runningVar,
          cutoff: r.cutoff,
          bandwidth: r.bandwidth,
          kernel: r.kernel,
        }} : null}
      />
    </div>
  );
}
