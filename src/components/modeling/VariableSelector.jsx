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

import { VarPanel, mono, useTheme } from "./shared.jsx";

// Models that expose an X (Features) selector
const SHOW_X = new Set(["OLS", "WLS", "FE", "FD", "2SLS", "RDD", "Logit", "Probit", "Poisson", "GMM", "LIML", "PoissonFE", "NegBinFE", "LSDV"]);
// Models that expose a W (Controls) selector in this panel
// DiD/TWFE controls are rendered in ModelConfiguration alongside group selectors
const SHOW_W = new Set(["OLS", "WLS", "FE", "FD", "2SLS", "RDD", "Logit", "Probit", "Poisson", "GMM", "LIML", "PoissonFE", "NegBinFE", "LSDV"]);

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
  const availForX = xwCols.filter(h => !yVar.includes(h));
  const availForW = xwCols.filter(h => !yVar.includes(h) && !xVars.includes(h));

  const addTerm = () =>
    setInteractionTerms?.(prev => [...prev, { var1: "", var2: "", type: "*" }]);
  const removeTerm = i =>
    setInteractionTerms?.(prev => prev.filter((_, j) => j !== i));
  const updateTerm = (i, key, val) =>
    setInteractionTerms?.(prev => prev.map((t, j) => j === i ? { ...t, [key]: val } : t));

  const selStyle = {
    background: C.bg, color: C.text, border: `1px solid ${C.border2}`,
    borderRadius: 3, padding: "1px 4px", fontFamily: mono, fontSize: T?.caption?.fontSize ?? 10,
    flex: 1, minWidth: 0, cursor: "pointer",
  };
  const typeBtnStyle = {
    background: C.surface, color: C.teal, border: `1px solid ${C.teal}`,
    borderRadius: 3, padding: "1px 6px", fontFamily: mono, fontSize: T?.caption?.fontSize ?? 10,
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
          <div style={{ fontFamily: mono, fontSize: T?.caption?.fontSize ?? 10, color: C.teal, marginBottom: 6, letterSpacing: "0.04em" }}>
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
          {interactionTerms.length > 0 && (
            <div style={{ fontFamily: mono, fontSize: (T?.caption?.fontSize ?? 10) - 1, color: C.textMuted, marginTop: 6 }}>
              * = main effects + interaction · : = interaction only
            </div>
          )}
        </div>
      )}
    </>
  );
}
