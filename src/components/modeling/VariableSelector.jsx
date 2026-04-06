// ─── ECON STUDIO · src/components/modeling/VariableSelector.jsx ───────────────
// Variable-assignment panel: Y (dependent), X (regressors), W (controls).
// Renders only the columns relevant to the active estimator.
// Model-specific extras (Z, DiD dummies, RDD running var) live in ModelConfiguration.
//
// Props:
//   model        {string}    – active estimator ID
//   numericCols  {string[]}  – all numeric columns in the dataset
//   yVar         {string[]}  – selected Y (single-element array)
//   setYVar      {fn}
//   xVars        {string[]}  – selected X regressors
//   setXVars     {fn}
//   wVars        {string[]}  – selected controls
//   setWVars     {fn}

import { VarPanel, C, mono } from "./shared.jsx";

// Models that expose an X (Features) selector
const SHOW_X = new Set(["OLS", "FE", "FD", "2SLS", "RDD", "Logit", "Probit"]);
// Models that expose a W (Controls) selector in this panel
// DiD/TWFE controls are rendered in ModelConfiguration alongside group selectors
const SHOW_W = new Set(["OLS", "FE", "FD", "2SLS", "RDD", "Logit", "Probit"]);

export default function VariableSelector({
  model,
  numericCols,
  yVar,
  setYVar,
  xVars,
  setXVars,
  wVars,
  setWVars,
}) {
  // Exclude already-assigned columns from downstream pickers
  const availForX = numericCols.filter(h => !yVar.includes(h));
  const availForW = numericCols.filter(h => !yVar.includes(h) && !xVars.includes(h));

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
            model === "2SLS"
              ? "X · Endogenous Regressors"
              : "X · Features (regressors)"
          }
          color={C.green}
          vars={availForX}
          selected={xVars}
          onToggle={setXVars}
          info={model === "2SLS" ? "These regressors will be instrumented in Stage 1." : undefined}
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
        />
      )}
    </>
  );
}
