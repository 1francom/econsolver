// ─── ECON STUDIO · src/components/modeling/VariableSelector.jsx ───────────────
// Variable-assignment panel: Y (dependent), X (regressors), W (controls),
// and optional Interactions section (X1*X2 / X1:X2 builder).
//
// Props:
//   model              {string}    – active estimator ID
//   numericCols        {string[]}  – all numeric columns in the dataset
//   yVar               {string[]}  – selected Y (single-element array)
//   setYVar            {fn}
//   xVars              {string[]}  – selected X regressors
//   setXVars           {fn}
//   wVars              {string[]}  – selected controls
//   setWVars           {fn}
//   interactionTerms   {Array}     – [{var1, var2, type:"*"|":"}]
//   setInteractionTerms {fn}

import { VarPanel, useTheme } from "./shared.jsx";

// Models that expose an X (Features) selector.
//
// RDD is deliberately absent: its design is Y + running variable + cutoff, and
// the only other input the engine takes is a single covariate list, which it
// receives from W. `estimationDispatch` calls
// `runSharpRDD(rows, y, runningVar, cutoff, h, kernel, expW, …)` and does not
// even record xVars in the result spec, so an X picker there was dead UI —
// anything selected in it was silently discarded.
const SHOW_X = new Set(["OLS", "WLS", "FE", "FD", "2SLS", "Logit", "Probit", "Poisson", "GMM", "LIML", "PoissonFE", "NegBinFE", "LSDV"]);
// Models that expose a W (Controls) selector in this panel.
// DiD/TWFE controls are rendered in ModelConfiguration alongside group selectors.
//
// Only estimators where W is genuinely NOT the same thing as X appear here:
//   2SLS / GMM / LIML — X is endogenous and gets instrumented in stage 1, while
//     W is exogenous and serves as its OWN instrument (ModelingTab builds
//     `zAll2 = [...wVars, ...zVars]`). Folding W into X would drop those
//     instruments and silently under-identify the model.
//   RDD — W is the covariate list passed to the engine; X is not used there.
//
// For every other estimator the engine just does `[...xVars, ...wVars]`, so a
// separate Controls picker was pure duplication of the X picker and is gone.
// Those models are listed in FOLD_W_INTO_X below.
const SHOW_W = new Set(["2SLS", "RDD", "GMM", "LIML"]);

// Estimators that no longer show a Controls picker because W and X are combined
// identically by the engine. ModelingTab folds any leftover W selection into X
// when one of these is active, so a control picked under another estimator can
// never keep silently entering the model from a panel that is no longer visible.
export const FOLD_W_INTO_X = new Set([
  "OLS", "WLS", "FE", "FD", "Logit", "Probit", "Poisson", "PoissonFE", "NegBinFE", "LSDV",
]);

export default function VariableSelector({
  model,
  numericCols,
  allCols,
  yVar,
  setYVar,
  xVars,
  setXVars,
  wVars,
  setWVars,
  factorVars,
  onToggleFactor,
  interactionTerms = [],
  setInteractionTerms,
}) {
  const { C, T } = useTheme();
  // X/W pickers show all columns (numeric + categorical); Y picker is numeric-only
  const xwCols = allCols ?? numericCols;
  const showX = SHOW_X.has(model);
  const availForX = xwCols.filter(h => !yVar.includes(h));
  // Only hide already-assigned X columns when the X picker is actually on screen.
  // For an estimator without one (RDD), a stale xVars left over from a previous
  // model would otherwise remove those columns from the W picker too, making them
  // unselectable in both — invisible rather than merely unused.
  const availForW = xwCols.filter(h => !yVar.includes(h) && !(showX && xVars.includes(h)));

  const addTerm = () =>
    setInteractionTerms?.(prev => [...prev, { var1: "", var2: "", type: "*" }]);
  const removeTerm = i =>
    setInteractionTerms?.(prev => prev.filter((_, j) => j !== i));
  const updateTerm = (i, key, val) =>
    setInteractionTerms?.(prev => prev.map((t, j) => j === i ? { ...t, [key]: val } : t));

  const selStyle = {
    background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    borderRadius: 3, padding: "1px 4px", fontFamily: T?.code?.fontFamily, fontSize: T?.caption?.fontSize ?? 10,
    flex: 1, minWidth: 0, cursor: "pointer",
  };
  const typeBtnStyle = {
    background: C.surface, color: C.teal, border: `1px solid ${C.teal}`,
    borderRadius: 3, padding: "1px 6px", fontFamily: T?.code?.fontFamily, fontSize: T?.caption?.fontSize ?? 10,
    cursor: "pointer", flexShrink: 0, minWidth: 22, textAlign: "center",
  };

  const showInteractions = SHOW_X.has(model) && setInteractionTerms;

  return (
    <>
      {/* ── Y · Dependent Variable ── */}
      <VarPanel
        title="Y · Dependent Variable"
        color={C.gold}
        vars={numericCols}
        selected={yVar}
        onToggle={setYVar}
        multi={false}
      />

      {/* ── X · Regressors / Endogenous (model-specific label) ── */}
      {SHOW_X.has(model) && (
        <VarPanel
          title={
            (model === "2SLS" || model === "GMM" || model === "LIML")
              ? "X · Endogenous Regressors"
              : "X · Features (regressors)"
          }
          color={C.green}
          vars={availForX}
          selected={xVars}
          onToggle={setXVars}
          info={
            model === "2SLS" ? "These regressors will be instrumented in Stage 1." :
            model === "GMM"  ? "Endogenous regressors — instrumented via Z in both GMM steps." :
            model === "LIML" ? "Endogenous regressors — LIML k-class correction applied." :
            undefined
          }
          factorVars={factorVars}
          onToggleFactor={onToggleFactor}
        />
      )}

      {/* ── W · Controls ── */}
      {SHOW_W.has(model) && (
        <VarPanel
          title="W · Controls"
          color={C.blue}
          vars={availForW}
          selected={wVars}
          onToggle={setWVars}
          factorVars={factorVars}
          onToggleFactor={onToggleFactor}
        />
      )}

      {/* ── Interactions ── */}
      {showInteractions && (
        <div style={{ marginTop: 8, padding: "6px 8px", border: `1px solid ${C.border}`, borderRadius: 4 }}>
          <div style={{ fontFamily: T?.code?.fontFamily, fontSize: T?.caption?.fontSize ?? 10, color: C.teal, marginBottom: 6, letterSpacing: "0.04em" }}>
            INTERACTIONS
          </div>
          {interactionTerms.map((term, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>
              <select
                value={term.var1}
                onChange={e => updateTerm(i, "var1", e.target.value)}
                style={selStyle}
              >
                <option value="">— var1 —</option>
                {xwCols.filter(c => !yVar.includes(c)).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={() => updateTerm(i, "type", term.type === "*" ? ":" : "*")}
                style={typeBtnStyle}
                title={term.type === "*" ? "main effects + interaction (A*B)" : "interaction only (A:B)"}
              >
                {term.type}
              </button>
              <select
                value={term.var2}
                onChange={e => updateTerm(i, "var2", e.target.value)}
                style={selStyle}
              >
                <option value="">— var2 —</option>
                {xwCols.filter(c => !yVar.includes(c) && c !== term.var1).map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button
                onClick={() => removeTerm(i)}
                style={{ ...typeBtnStyle, color: C.textDim, borderColor: C.border2 }}
                title="Remove"
              >✕</button>
            </div>
          ))}
          <button
            onClick={addTerm}
            style={{ ...typeBtnStyle, color: C.textDim, borderColor: C.border2, padding: "2px 8px", marginTop: 2 }}
          >
            + add
          </button>
          {/* fontSize below was `(T.caption.fontSize ?? 10) - 1`, but the token is
              the string "10px", so "10px" - 1 evaluated to NaN and React dropped
              the property — this hint had no explicit size at all. Caption already
              sits at the 9px density floor, so there is no smaller step to take. */}
          {interactionTerms.length > 0 && (
            <div style={{ fontFamily: T?.code?.fontFamily, fontSize: T?.caption?.fontSize, color: C.textMuted, marginTop: 6 }}>
              * = main effects + interaction · : = interaction only
            </div>
          )}
        </div>
      )}
    </>
  );
}
