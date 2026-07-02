// ─── ECON STUDIO · results/IVResults.jsx ──────────────────────────────────────
// IV-family result panels: 2SLS, two-step GMM, LIML. Extracted from ModelingTab.jsx.
// All three share the firstStages structure and tabbed second-stage layout.

import { useState } from "react";
import { useTheme } from "../shared.jsx";
import { Lbl, Badge, InfoBox, RegressionEquation, ForestPlot, CoeffTable, FitBar, ExportBar } from "../resultDisplay.jsx";
import {
  PlotSelector, YFittedPlot, YXhatPlot, XvsXhatPlot, EndogeneityPlot, FirstStagePlot,
} from "../ModelPlots.jsx";
import { ResidualVsFitted, QQPlot } from "../ResidualPlots.jsx";

// ─── 2SLS RESULTS ─────────────────────────────────────────────────────────────
export function TwoSLSResults({ result, yVar, xVars, wVars, zVars, rows, dict = {}, openReport, baseReplicateConfig }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("second");
  // canonical: second-stage fields are at root; firstStages sub-array is engine-shaped.
  // Pinned models restored from IndexedDB are trimmed — firstStages may be absent.
  const firstStages = result.firstStages ?? [];
  const second = result;
  const safeR = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.24em", textTransform: "uppercase" }}>2SLS / IV Results</span>
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
              cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
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
            <CoeffTable dict={dict} rows={rows} varNames={second.varNames} beta={second.beta} se={second.se} tStats={second.testStats} pVals={second.pVals} yVar={yVar[0]} df={second.df} />
          </div>
          {second.arCI && xVars.length === 1 && (() => {
            const fmt = v => (v == null || !isFinite(v)) ? "—" : v.toFixed(4);
            const ar = second.arCI;
            const idx = second.varNames.indexOf(xVars[0]);
            const wald = idx >= 0 && isFinite(second.beta[idx]) && isFinite(second.se[idx])
              ? [second.beta[idx] - 1.96 * second.se[idx], second.beta[idx] + 1.96 * second.se[idx]]
              : null;
            const arText =
              ar.type === "bounded"   ? `[${fmt(ar.lo)}, ${fmt(ar.hi)}]` :
              ar.type === "unbounded" ? `(−∞, ${fmt(ar.lo)}] ∪ [${fmt(ar.hi)}, +∞)` :
              ar.type === "all"       ? "(−∞, +∞)  — unidentified" :
              ar.type === "empty"     ? "∅  — rejects all values" :
              "—";
            return (
              <div style={{ marginBottom: "1.2rem", padding: "0.7rem 0.9rem", border: `1px solid ${C.border}`, background: C.surface, borderRadius: 4 }}>
                <div style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.18em", textTransform: "uppercase", marginBottom: 6 }}>
                  Weak-IV robust CI (Anderson-Rubin, 95%)
                </div>
                <div style={{ fontSize: T.code.fontSize, color: C.text, fontFamily: T.code.fontFamily }}>
                  β<sub>{xVars[0]}</sub> ∈ {arText}
                </div>
                {wald && (
                  <div style={{ fontSize: T.code.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginTop: 4 }}>
                    Wald (asymptotic): [{fmt(wald[0])}, {fmt(wald[1])}]
                  </div>
                )}
                {ar.type !== "bounded" && (
                  <div style={{ fontSize: T.caption.fontSize, color: C.textDim, marginTop: 6, lineHeight: 1.5 }}>
                    Non-convex / unbounded AR region signals weak identification — the Wald CI is unreliable here.
                  </div>
                )}
              </div>
            );
          })()}
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
            onReport={() => openReport({ ...result, modelLabel: "2SLS / IV", yVar: yVar[0], xVars })}
            replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "2SLS", yVar: yVar[0], xVars, wVars, zVars } } : null}
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
          <CoeffTable dict={dict} rows={rows} varNames={fs.varNames} beta={fs.beta} se={fs.se} tStats={fs.tStats} pVals={fs.pVals} yVar={fs.endVar} />
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

// ─── GMM RESULTS ──────────────────────────────────────────────────────────────
export function GMMResults({ result, yVar, xVars, wVars, zVars, rows, dict = {}, openReport, baseReplicateConfig }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("second");
  const { firstStages } = result;
  const safeR = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";
  const safeJ = v => (v != null && isFinite(v)) ? v.toFixed(3) : "—";
  const jOk = result.jDf > 0;

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.24em", textTransform: "uppercase" }}>Two-Step GMM Results</span>
        <Badge label={`n = ${result.n}`} color={C.textDim} />
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[["second", "Structural Equation"], ...(firstStages ?? []).map((s, i) => [`fs_${i}`, `First Stage: ${s.endVar}`])].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: "0.6rem 0.8rem", background: tab === k ? C.goldFaint : C.surface, border: "none", color: tab === k ? C.gold : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent", transition: "all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "second" && (
        <>
          <RegressionEquation varNames={result.varNames} beta={result.beta} yVar={yVar[0]} />
          <FitBar items={[
            { label: "R²",       value: safeR(result.R2),    color: C.gold },
            { label: "Adj. R²",  value: safeR(result.adjR2), color: C.gold },
            { label: "n",   value: result.n,  color: C.text },
            { label: "df",  value: result.df, color: C.textDim },
          ]} />
          {jOk && (
            <div style={{ padding: "0.55rem 0.8rem", background: result.jPval > 0.05 ? `${C.green}10` : `${C.red}10`, border: `1px solid ${result.jPval > 0.05 ? C.green : C.red}40`, borderRadius: 3, marginBottom: "1rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, display: "flex", gap: 16 }}>
              <span style={{ color: C.textMuted }}>Hansen J-stat</span>
              <span style={{ color: C.text }}>{safeJ(result.jStat)}</span>
              <span style={{ color: C.textMuted }}>df = {result.jDf}</span>
              <span style={{ color: C.textMuted }}>p = {safeJ(result.jPval)}</span>
              <span style={{ color: result.jPval > 0.05 ? C.green : C.red }}>{result.jPval > 0.05 ? "✓ Overid. not rejected" : "⚠ Overid. rejected"}</span>
            </div>
          )}
          <Lbl color={C.textMuted}>GMM Coefficients (HC-robust SE)</Lbl>
          <div style={{ marginBottom: "1.2rem" }}>
            <CoeffTable dict={dict} rows={rows} varNames={result.varNames} beta={result.beta} se={result.se} tStats={result.testStats} pVals={result.pVals} yVar={yVar[0]} df={result.df} />
          </div>
          <PlotSelector accentColor={C.gold} defaultId="yhat"
            plots={[
              { id: "yhat", label: "Y vs Ŷ", node: <YFittedPlot resid={result.resid} Yhat={result.Yhat} yLabel={yVar[0]} svgIdSuffix="-gmm" /> },
              { id: "forest", label: "Coefficient plot", node: <ForestPlot varNames={result.varNames} beta={result.beta} se={result.se} pVals={result.pVals} svgId="forest-gmm" filename="gmm_coefficients.svg" /> },
              { id: "resid", label: "Residuals vs Fitted", node: <ResidualVsFitted resid={result.resid} Yhat={result.Yhat} svgIdSuffix="-gmm-resid" /> },
              { id: "qq", label: "Q-Q", node: <QQPlot resid={result.resid} svgIdSuffix="-gmm-qq" /> },
            ]} />
          <ExportBar yVar={yVar[0]} results={result} model="GMM"
            onReport={() => openReport({ ...result, modelLabel: "Two-Step GMM", yVar: yVar[0], xVars })}
            replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "GMM", yVar: yVar[0], xVars, wVars, zVars } } : null}
          />
        </>
      )}
      {(firstStages ?? []).map((fs, i) => tab === `fs_${i}` && (
        <div key={i}>
          <FitBar items={[
            { label: "R²", value: safeR(fs.R2), color: C.gold },
            { label: "F-stat", value: (fs.Fstat != null && isFinite(fs.Fstat)) ? fs.Fstat.toFixed(3) : "—", color: fs.weak ? C.red : C.green },
            { label: "Weak?", value: fs.weak ? "YES ⚠" : "No", color: fs.weak ? C.red : C.green },
            { label: "n", value: fs.n, color: C.text },
          ]} />
          {fs.weak && <InfoBox color={C.red}>⚠ Weak instrument: F = {fs.Fstat?.toFixed(2)}. GMM efficiency gains diminish with weak instruments.</InfoBox>}
          <CoeffTable dict={dict} rows={rows} varNames={fs.varNames} beta={fs.beta} se={fs.se} tStats={fs.tStats} pVals={fs.pVals} yVar={fs.endVar} />
        </div>
      ))}
    </div>
  );
}

// ─── LIML RESULTS ─────────────────────────────────────────────────────────────
export function LIMLResults({ result, yVar, xVars, wVars, zVars, rows, dict = {}, openReport, baseReplicateConfig }) {
  const { C, T } = useTheme();
  const [tab, setTab] = useState("second");
  const { firstStages } = result;
  const safeR = v => (v != null && isFinite(v)) ? v.toFixed(4) : "—";

  return (
    <div style={{ animation: "fadeUp 0.22s ease" }}>
      <div style={{ marginBottom: "1rem", display: "flex", alignItems: "baseline", gap: 10 }}>
        <span style={{ fontSize: T.caption.fontSize, color: C.gold, letterSpacing: "0.24em", textTransform: "uppercase" }}>LIML Results</span>
        <Badge label={`n = ${result.n}`} color={C.textDim} />
        {result.kappa != null && (
          <Badge label={`κ = ${result.kappa.toFixed(4)}`} color={Math.abs(result.kappa - 1) < 0.01 ? C.textDim : C.gold} />
        )}
      </div>
      <div style={{ display: "flex", gap: 1, background: C.border, borderRadius: 4, overflow: "hidden", marginBottom: "1.2rem" }}>
        {[["second", "Structural Equation"], ...(firstStages ?? []).map((s, i) => [`fs_${i}`, `First Stage: ${s.endVar}`])].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            style={{ flex: 1, padding: "0.6rem 0.8rem", background: tab === k ? C.goldFaint : C.surface, border: "none", color: tab === k ? C.gold : C.textDim, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, borderBottom: tab === k ? `2px solid ${C.gold}` : "2px solid transparent", transition: "all 0.15s" }}>
            {l}
          </button>
        ))}
      </div>

      {tab === "second" && (
        <>
          {result.kappa != null && (
            <div style={{ padding: "0.45rem 0.8rem", background: `${C.gold}10`, border: `1px solid ${C.gold}40`, borderRadius: 3, marginBottom: "1rem", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, display: "flex", gap: 16 }}>
              <span style={{ color: C.textMuted }}>k-class κ</span>
              <span style={{ color: C.gold }}>{result.kappa.toFixed(6)}</span>
              <span style={{ color: C.textMuted }}>{Math.abs(result.kappa - 1) < 1e-4 ? "(= 1 → exactly identified, same as 2SLS)" : "(> 1 → overidentified, LIML corrects finite-sample bias)"}</span>
            </div>
          )}
          <RegressionEquation varNames={result.varNames} beta={result.beta} yVar={yVar[0]} />
          <FitBar items={[
            { label: "R²",      value: safeR(result.R2),    color: C.gold },
            { label: "Adj. R²", value: safeR(result.adjR2), color: C.gold },
            { label: "n",  value: result.n,  color: C.text },
            { label: "df", value: result.df, color: C.textDim },
          ]} />
          <Lbl color={C.textMuted}>LIML Coefficients</Lbl>
          <div style={{ marginBottom: "1.2rem" }}>
            <CoeffTable dict={dict} rows={rows} varNames={result.varNames} beta={result.beta} se={result.se} tStats={result.testStats} pVals={result.pVals} yVar={yVar[0]} df={result.df} />
          </div>
          <PlotSelector accentColor={C.gold} defaultId="yhat"
            plots={[
              { id: "yhat", label: "Y vs Ŷ", node: <YFittedPlot resid={result.resid} Yhat={result.Yhat} yLabel={yVar[0]} svgIdSuffix="-liml" /> },
              { id: "forest", label: "Coefficient plot", node: <ForestPlot varNames={result.varNames} beta={result.beta} se={result.se} pVals={result.pVals} svgId="forest-liml" filename="liml_coefficients.svg" /> },
              { id: "resid", label: "Residuals vs Fitted", node: <ResidualVsFitted resid={result.resid} Yhat={result.Yhat} svgIdSuffix="-liml-resid" /> },
              { id: "qq", label: "Q-Q", node: <QQPlot resid={result.resid} svgIdSuffix="-liml-qq" /> },
            ]} />
          <ExportBar yVar={yVar[0]} results={result} model="LIML"
            onReport={() => openReport({ ...result, modelLabel: "LIML / k-class", yVar: yVar[0], xVars })}
            replicateConfig={baseReplicateConfig ? { ...baseReplicateConfig, model: { ...baseReplicateConfig.model, type: "LIML", yVar: yVar[0], xVars, wVars, zVars } } : null}
          />
        </>
      )}
      {(firstStages ?? []).map((fs, i) => tab === `fs_${i}` && (
        <div key={i}>
          <FitBar items={[
            { label: "R²", value: safeR(fs.R2), color: C.gold },
            { label: "F-stat", value: (fs.Fstat != null && isFinite(fs.Fstat)) ? fs.Fstat.toFixed(3) : "—", color: fs.weak ? C.red : C.green },
            { label: "Weak?", value: fs.weak ? "YES ⚠" : "No", color: fs.weak ? C.red : C.green },
            { label: "n", value: fs.n, color: C.text },
          ]} />
          {fs.weak && <InfoBox color={C.red}>⚠ Weak instrument: F = {fs.Fstat?.toFixed(2)}. LIML is particularly sensitive to weak instruments.</InfoBox>}
          <CoeffTable dict={dict} rows={rows} varNames={fs.varNames} beta={fs.beta} se={fs.se} tStats={fs.tStats} pVals={fs.pVals} yVar={fs.endVar} />
        </div>
      ))}
    </div>
  );
}
