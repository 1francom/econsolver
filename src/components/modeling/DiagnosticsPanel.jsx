// ─── ECON STUDIO · components/modeling/DiagnosticsPanel.jsx ──────────────────
// Post-estimation diagnostic tests panel.
// Replaces the inline DiagnosticsPanel in ModelingTab.jsx.
//
// Props:
//   resid      number[]    — residuals from the estimator
//   rows       object[]    — cleaned data rows
//   xCols      string[]    — regressor names (excl. intercept)
//   yCol       string      — dependent variable name (for X reconstruction)
//   model      string      — "OLS" | "FE" | "FD" | "2SLS" | "DiD" | "TWFE" | "RDD"
//   panelFE    object|null — FE result (for Hausman)
//   panelFD    object|null — FD result (for Hausman)
//   panel      object|null — {entityCol, timeCol}
//
// All tests are computed lazily via useMemo — zero cost if not rendered.

import { useState, useMemo } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { breuschPagan, whiteTest }      from "../../core/diagnostics/heteroskedasticity.js";
import { durbinWatson, breuschGodfrey } from "../../core/diagnostics/autocorrelation.js";
import { jarqueBera, shapiroWilk }      from "../../core/diagnostics/normality.js";
import { computeVIF, conditionNumber }  from "../../core/diagnostics/multicollinearity.js";
import { hausmanTest }                  from "../../math/LinearEngine.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ── Helpers ───────────────────────────────────────────────────────────────────
function sevColor(C, reject, inconclusive) {
  if (inconclusive) return C.yellow;
  return reject ? C.red : C.green;
}
function vifColor(C, severity) {
  return severity === "severe" ? C.red : severity === "moderate" ? C.yellow : C.green;
}
function fmt4(v) { return v != null && isFinite(v) ? v.toFixed(4) : "—"; }
function fmtP(p) {
  if (p == null) return "—";
  return p < 0.001 ? "<0.001" : p.toFixed(4);
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHdr({ children }) {
  const { C } = useTheme();
  return (
    <div style={{
      padding: "0.28rem 0.85rem",
      fontSize: 9, color: C.textMuted, letterSpacing: "0.16em",
      textTransform: "uppercase", fontFamily: mono,
      background: C.surface2, borderBottom: `1px solid ${C.border}`,
    }}>
      {children}
    </div>
  );
}

// ── Single test result card ───────────────────────────────────────────────────
function TestCard({ name, stat, statLabel = "stat", df, pVal, reject, inconclusive, note }) {
  const { C } = useTheme();
  const color = sevColor(C, reject, inconclusive);
  return (
    <div style={{
      padding: "0.6rem 0.85rem",
      background: C.surface,
      border: `1px solid ${color}30`,
      borderLeft: `3px solid ${color}`,
      display: "flex", flexDirection: "column", gap: 3,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 9, color, letterSpacing: "0.14em",
          textTransform: "uppercase", fontFamily: mono }}>{name}</span>
        <span style={{ fontSize: 9, padding: "1px 5px",
          border: `1px solid ${color}40`, color, borderRadius: 2, fontFamily: mono }}>
          {inconclusive ? "Inconclusive" : reject ? "Reject H₀" : "Fail to reject H₀"}
        </span>
      </div>
      <div style={{ fontSize: 12, color: C.text, fontFamily: mono }}>
        {statLabel} = {stat != null ? stat : "—"}
        {df != null && <span style={{ color: C.textMuted }}> · df = {df}</span>}
        {pVal != null && <span style={{ color: C.textDim }}> · p = {fmtP(pVal)}</span>}
      </div>
      {note && (
        <div style={{ fontSize: 10, color: C.textDim, fontFamily: mono }}>{note}</div>
      )}
    </div>
  );
}

// ── VIF cards ─────────────────────────────────────────────────────────────────
function VIFCards({ vifResults }) {
  const { C } = useTheme();
  if (!vifResults?.length) return null;
  return (
    <div style={{ padding: "0.6rem 0.85rem" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 6 }}>
        {vifResults.map(({ col, vif: v, severity }) => {
          const color = vifColor(C, severity);
          return (
            <div key={col} style={{
              padding: "0.3rem 0.6rem",
              background: C.surface2, border: `1px solid ${color}40`,
              borderRadius: 3, fontFamily: mono,
            }}>
              <div style={{ fontSize: 9, color: C.textMuted }}>{col}</div>
              <div style={{ fontSize: 13, color }}>{isFinite(v) ? v.toFixed(2) : "∞"}</div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>
        VIF &gt; 5 → moderate · VIF &gt; 10 → severe multicollinearity
      </div>
    </div>
  );
}

// ── Diagnostic alert builder ──────────────────────────────────────────────────
// Returns a list of prioritised AI coach prompts derived from test outcomes.
function buildAlerts(bp, white, dw, bg, vif, hausman) {
  const alerts = [];

  if (bp?.reject || white?.reject) {
    const tests = [bp?.reject && "Breusch-Pagan", white?.reject && "White"].filter(Boolean).join(" & ");
    alerts.push({
      type: "heteroskedasticity",
      severity: "high",
      message: `Heteroskedasticity detected (${tests}).`,
      coachPrompt: `My ${tests} test(s) reject homoskedasticity (p=${bp?.reject ? bp.pVal?.toFixed(4) : white?.pVal?.toFixed(4)}). Should I switch to HC1 robust standard errors? What are the tradeoffs, and does this affect my coefficient estimates or just my inference?`,
    });
  }

  if (dw?.positive || dw?.negative || bg?.reject) {
    alerts.push({
      type: "autocorrelation",
      severity: "medium",
      message: `Serial correlation detected${bg?.reject ? ` (BG p=${bg.pVal?.toFixed(4)})` : ""}.`,
      coachPrompt: `My Durbin-Watson / Breusch-Godfrey test suggests serial correlation in the residuals. Should I add a lag of the dependent variable, use HAC standard errors, or switch to a GLS specification? What does this imply for my inference?`,
    });
  }

  const severeVIF = vif?.filter(v => v.severity === "severe");
  const modVIF    = vif?.filter(v => v.severity === "moderate");
  if (severeVIF?.length) {
    alerts.push({
      type: "multicollinearity",
      severity: "high",
      message: `Severe multicollinearity: ${severeVIF.map(v => v.col).join(", ")} (VIF > 10).`,
      coachPrompt: `VIF is above 10 for ${severeVIF.map(v => `${v.col} (VIF=${v.vif?.toFixed(1)})`).join(", ")}. How should I address this? Should I drop a variable, create a composite index, or use ridge regression?`,
    });
  } else if (modVIF?.length) {
    alerts.push({
      type: "multicollinearity",
      severity: "low",
      message: `Moderate multicollinearity: ${modVIF.map(v => v.col).join(", ")} (VIF 5–10).`,
      coachPrompt: `VIF is between 5 and 10 for ${modVIF.map(v => v.col).join(", ")}. Is this a problem for my interpretation? What does it do to my standard errors?`,
    });
  }

  if (hausman && parseFloat(hausman.pVal) < 0.05) {
    alerts.push({
      type: "specification",
      severity: "medium",
      message: `Hausman test rejects FE/FD consistency (p=${parseFloat(hausman.pVal).toFixed(4)}).`,
      coachPrompt: `The Hausman test between FE and FD is significant (H=${hausman.H}, p=${parseFloat(hausman.pVal).toFixed(4)}). What does this divergence imply about serial correlation in my panel? Which estimator should I prefer?`,
    });
  }

  return alerts;
}

// ── Alert card ────────────────────────────────────────────────────────────────
function DiagAlertCard({ alert, onCoachQuery }) {
  const { C } = useTheme();
  const sevColor = { high: C.red, medium: C.yellow, low: C.textDim };
  const color = sevColor[alert.severity] ?? C.textDim;
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", justifyContent: "space-between",
      gap: 12, padding: "0.55rem 0.85rem",
      background: C.surface,
      borderLeft: `3px solid ${color}`,
      border: `1px solid ${color}25`,
    }}>
      <div style={{ flex: 1 }}>
        <span style={{ fontSize: 9, color, letterSpacing: "0.1em", textTransform: "uppercase", fontFamily: mono }}>
          {alert.severity === "high" ? "⚠ " : "△ "}
        </span>
        <span style={{ fontSize: 11, color: C.text, fontFamily: mono }}>{alert.message}</span>
      </div>
      {onCoachQuery && (
        <button
          onClick={() => onCoachQuery(alert.coachPrompt)}
          style={{
            flexShrink: 0, padding: "0.22rem 0.6rem",
            background: "transparent", border: `1px solid ${color}50`,
            borderRadius: 3, color, cursor: "pointer",
            fontFamily: mono, fontSize: 9, whiteSpace: "nowrap",
            transition: "all 0.12s",
          }}
          onMouseEnter={e => { e.currentTarget.style.background = `${color}18`; }}
          onMouseLeave={e => { e.currentTarget.style.background = "transparent"; }}
        >
          Ask Coach →
        </button>
      )}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function DiagnosticsPanel({
  resid, rows = [], xCols = [], yCol,
  model = "OLS", panelFE, panelFD, panel,
  onCoachQuery,
}) {
  const { C } = useTheme();
  const [open, setOpen] = useState(true);

  // Build design matrix X from rows + xCols (needed for BP and White)
  const X = useMemo(() => {
    if (!rows?.length || !xCols?.length) return null;
    const valid = rows.filter(r => xCols.every(c => typeof r[c] === "number" && isFinite(r[c])));
    if (valid.length < 4) return null;
    return valid.map(r => [1, ...xCols.map(c => r[c])]);
  }, [rows, xCols]);

  // Which tests apply per model
  const showHetero = !["RDD"].includes(model);
  const showWhite  =  model === "OLS";
  const showAuto   = ["OLS", "FE", "FD"].includes(model);
  const showNorm   = true;
  const showVIF    = ["OLS", "FE", "2SLS"].includes(model) && xCols.length >= 2;
  const showCond   =  model === "OLS";
  const showHaus   = !!(panelFE && panelFD);

  // Run tests
  const bp      = useMemo(() => showHetero && resid?.length && X ? breuschPagan(resid, X)         : null, [resid, X, showHetero]);
  const white   = useMemo(() => showWhite  && resid?.length && X ? whiteTest(resid, X)             : null, [resid, X, showWhite]);
  const dw      = useMemo(() => showAuto   && resid?.length       ? durbinWatson(resid)             : null, [resid, showAuto]);
  const bg      = useMemo(() => showAuto   && resid?.length && X  ? breuschGodfrey(resid, X, 1)    : null, [resid, X, showAuto]);
  const jb      = useMemo(() => showNorm   && resid?.length       ? jarqueBera(resid)               : null, [resid]);
  const sw      = useMemo(() => showNorm   && resid?.length <= 5000 ? shapiroWilk(resid)            : null, [resid]);
  const vif     = useMemo(() => showVIF    && rows?.length         ? computeVIF(rows, xCols)         : null, [rows, xCols, showVIF]);
  const cond    = useMemo(() => showCond   && X                    ? conditionNumber(X)              : null, [X, showCond]);
  const hausman = useMemo(() => showHaus                           ? hausmanTest(panelFE, panelFD, xCols) : null, [panelFE, panelFD, xCols, showHaus]);

  const hasAny = bp || white || dw || bg || jb || sw || vif || cond || hausman;
  if (!hasAny) return null;

  const alerts = buildAlerts(bp, white, dw, bg, vif, hausman);

  return (
    <div style={{
      border: `1px solid ${C.border}`, borderRadius: 4,
      overflow: "hidden", marginBottom: "1.2rem",
    }}>
      {/* Toggle header */}
      <button
        onClick={() => setOpen(s => !s)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          background: C.surface2, padding: "0.5rem 1rem",
          border: "none", borderBottom: open ? `1px solid ${C.border}` : "none",
          cursor: "pointer", fontFamily: mono, color: C.textMuted,
          fontSize: 9, letterSpacing: "0.18em", textTransform: "uppercase",
        }}
      >
        <span style={{ flex: 1, textAlign: "left" }}>◈ Post-Estimation Diagnostics · {model}</span>
        <span>{open ? "▲" : "▼"}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 0, animation: "fadeUp 0.18s ease" }}>

          {/* ── AI Coach Alerts ── */}
          {alerts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              {alerts.map((a, i) => (
                <DiagAlertCard key={i} alert={a} onCoachQuery={onCoachQuery} />
              ))}
            </div>
          )}

          {/* ── Heteroskedasticity ── */}
          {(bp || white) && (
            <>
              <SectionHdr>Heteroskedasticity</SectionHdr>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0.5rem 0.5rem" }}>
                {bp && (
                  <TestCard name="Breusch-Pagan" stat={bp.LM} statLabel="LM"
                    df={bp.df} pVal={bp.pVal} reject={bp.reject}
                    note={bp.reject ? "⚠ Evidence of heteroskedasticity — consider robust (HC) SEs." : "✓ No evidence of heteroskedasticity at 5%."}
                  />
                )}
                {white && (
                  <TestCard name="White" stat={white.LM} statLabel="LM"
                    df={white.df} pVal={white.pVal} reject={white.reject}
                    note={white.reject ? "⚠ Nonlinear heteroskedasticity detected." : "✓ No evidence of nonlinear heteroskedasticity."}
                  />
                )}
              </div>
            </>
          )}

          {/* ── Serial Correlation ── */}
          {(dw || bg) && (
            <>
              <SectionHdr>Serial Correlation</SectionHdr>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0.5rem 0.5rem" }}>
                {dw && (
                  <TestCard name="Durbin-Watson" stat={fmt4(dw.stat)} statLabel="DW"
                    reject={dw.positive || dw.negative}
                    inconclusive={dw.inconclusive}
                    note={dw.interpretation}
                  />
                )}
                {bg && (
                  <TestCard name={`Breusch-Godfrey (lag ${bg.lags})`}
                    stat={bg.LM} statLabel="LM"
                    df={bg.df} pVal={bg.pVal} reject={bg.reject}
                    note={bg.reject ? "⚠ Serial correlation detected — consider HAC SEs or GLS." : "✓ No serial correlation up to lag 1."}
                  />
                )}
              </div>
            </>
          )}

          {/* ── Normality ── */}
          {(jb || sw) && (
            <>
              <SectionHdr>Normality of Residuals</SectionHdr>
              <div style={{ display: "flex", flexDirection: "column", gap: 1, padding: "0.5rem 0.5rem" }}>
                {jb && (
                  <TestCard name="Jarque-Bera" stat={jb.JB} statLabel="JB"
                    df={2} pVal={jb.pVal} reject={jb.reject}
                    note={`Skewness = ${fmt4(jb.skewness)} · Excess kurtosis = ${fmt4(jb.kurtosis)}`}
                  />
                )}
                {sw && (
                  <TestCard name="Shapiro-Wilk" stat={sw.W} statLabel="W"
                    pVal={sw.pVal} reject={sw.reject}
                    note={sw.reject ? "⚠ Residuals may not be normally distributed." : "✓ No evidence against normality."}
                  />
                )}
              </div>
            </>
          )}

          {/* ── Multicollinearity ── */}
          {(vif || cond) && (
            <>
              <SectionHdr>Multicollinearity</SectionHdr>
              {vif && <VIFCards vifResults={vif} />}
              {cond && (
                <div style={{ padding: "0.4rem 0.85rem 0.6rem", fontFamily: mono, fontSize: 10, color: C.textDim, display: "flex", gap: 12, alignItems: "center" }}>
                  <span>Condition number</span>
                  <span style={{ color: vifColor(C, cond.severity), fontSize: 13 }}>κ = {cond.kappa}</span>
                  <span style={{
                    fontSize: 9, padding: "1px 5px",
                    border: `1px solid ${vifColor(C, cond.severity)}40`,
                    color: vifColor(C, cond.severity), borderRadius: 2,
                  }}>
                    {cond.severity === "none" ? "Acceptable" : cond.severity === "moderate" ? "Moderate" : "Severe"}
                  </span>
                </div>
              )}
            </>
          )}

          {/* ── Hausman ── */}
          {hausman && (
            <>
              <SectionHdr>Specification</SectionHdr>
              <div style={{ padding: "0.5rem 0.5rem" }}>
                <TestCard
                  name="Hausman (FE vs FD)"
                  stat={hausman.H} statLabel="H"
                  df={hausman.df} pVal={parseFloat(hausman.pVal)}
                  reject={parseFloat(hausman.pVal) < 0.05}
                  note={parseFloat(hausman.pVal) < 0.05
                    ? "⚠ FE and FD estimates differ — check for serial correlation (favors FD)."
                    : "✓ FE and FD consistent — FE preferred (more efficient)."}
                />
              </div>
            </>
          )}

          {/* Footer */}
          <div style={{ padding: "0.35rem 0.85rem", fontSize: 9, color: C.textMuted,
            fontFamily: mono, background: C.surface2, borderTop: `1px solid ${C.border}` }}>
            Significance at 5% · BP/White/BG: LM ~ χ² · DW: consult tables for exact bounds · SW: Royston (1992)
          </div>
        </div>
      )}
    </div>
  );
}
