// ─── ECON STUDIO · results/PanelResults.jsx ──────────────────────────────────
// Panel FE/FD result panel. Extracted from ModelingTab.jsx.
// Must be a named component (not an IIFE) — React Rules of Hooks.

import { useState } from "react";
import { useTheme } from "../shared.jsx";
import { hausmanTest } from "../../../math/index.js";
import { Lbl, Badge, InfoBox, RegressionEquation, ForestPlot, CoeffTable, FitBar, ExportBar } from "../resultDisplay.jsx";
import { PlotSelector, YFittedPlot } from "../ModelPlots.jsx";
import { ResidualVsFitted, QQPlot } from "../ResidualPlots.jsx";
import DiagnosticsPanel from "../DiagnosticsPanel.jsx";

export default function PanelResults({ result, panel, xVars, wVars, yVar, panelFE, panelFD, rows, dict = {}, openReport, baseReplicateConfig }) {
  const { C, T } = useTheme();
  // A freshly estimated panel model arrives as the wrapper { type, fe, fd }.
  // A model restored from the pinned buffer arrives as the bare EstimationResult
  // (modelBuffer unwraps it, so `n`/`spec` survive) — accept both shapes.
  const fe = result.fe ?? (result.type === "FE" ? result : null);
  const fd = result.fd ?? (result.type === "FD" ? result : null);
  // Default to whichever tab actually has a result: an FD-only result under a
  // hardcoded "fe" default rendered an empty panel.
  const [tab, setTab] = useState(fe ? "fe" : "fd");
  const hausman = fe && fd ? hausmanTest(fe, fd, [...xVars, ...wVars]) : null;
  const active  = tab === "fe" ? fe : fd;
  const safeR   = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";
  // Sidebar state is the source of truth for the outcome name, but a restored
  // model renders before that state settles — fall back to the model's own spec
  // rather than printing "undefined (within)".
  const yName = yVar?.[0] ?? active?.spec?.yVar ?? result?.spec?.yVar ?? "y";

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.blue, letterSpacing: "0.24em", textTransform: "uppercase" }}>Panel Results</span>
        {panel && <Badge label={`${panel.entityCol} × ${panel.timeCol}`} color={C.blue} />}
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[["fe", "Fixed Effects (Within)"], ["fd", "First Differences"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{
              flex: 1, padding: "0.6rem 1rem",
              background: tab === k ? C.goldFaint : C.surface,
              border: "none", color: tab === k ? C.gold : C.textDim,
              cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
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
            yVar={`${yName} (within)`}
          />
          <FitBar items={[
            // FE reports fixest's pair: "Within R2" (fit of the demeaned
            // regression) and "Adj. R2" (fit of the full model, FE included).
            // This slot used to show Stata xtreg's R²-between (an OLS on entity
            // means) — a real statistic, but one no R output shows next to these,
            // and one only the single-way JS path could compute, so it read "—"
            // for any multi-way FE set.
            { label: tab === "fe" ? "R² within" : "R²", value: safeR(tab === "fe" ? active.R2Within : active.R2), color: C.blue },
            { label: "Adj. R²", value: safeR(active.adjR2), color: C.blue },
            { label: "n",     value: active.n ?? "—",     color: C.text },
            { label: "Units", value: active.units ?? "—", color: C.textDim },
            { label: "df",    value: active.df ?? "—",    color: C.textDim },
          ]} />
          <Lbl color={C.textMuted}>Coefficient Table — {tab === "fe" ? "FE" : "FD"}</Lbl>
          <div style={{ marginBottom: "1.2rem" }}>
            <CoeffTable dict={dict} rows={rows} varNames={active.varNames || xVars} beta={active.beta} se={active.se} tStats={active.testStats ?? active.tStats} pVals={active.pVals} yVar={yName} df={active.df} factorMap={active.factorMap} />
          </div>
          <PlotSelector
            accentColor={C.blue}
            defaultId="yhat"
            plots={[
              { id: "yhat",   label: "Y vs Ŷ",
                node: <YFittedPlot resid={active.resid} Yhat={active.Yhat} yLabel={yName} svgIdSuffix={`-${tab}`} /> },
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
          yVar={yName}
          results={{ ...active, varNames: active.varNames || xVars }}
          model={tab.toUpperCase()}
          onReport={() => openReport({
            ...active,
            varNames: active.varNames || xVars,
            modelLabel: tab === "fe" ? "Fixed Effects" : "First Differences",
            yVar: yName,
            xVars: [...xVars, ...wVars],
          })}
          replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model,
            type: tab === "fe" ? "FE" : "FD", yVar: yName, xVars, wVars } } : null}
        />
      )}
    </div>
  );
}
