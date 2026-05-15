---
name: Add Estimator
description: Wire a new econometric estimator end-to-end in EconSolver. Use this skill whenever adding a new estimator (GMM, LIML, DML, etc.), adding a new variant of an existing one, or wiring an engine that exists in math/ but lacks a UI. Also use when the user mentions adding a new model to the estimator sidebar.
---

## Add Estimator — EconSolver

### Checklist (strict order)

**1. Math engine** (`src/math/`)
- Pure JS. No React, no UI. Validate vs R to 6 decimal places on coefficients, 4 on SE.
- R libs: `fixest`, `plm`, `rdrobust`, `AER`, `modelsummary`, base `glm`.
- Export from `src/math/index.js` barrel.
- **Reference PDFs** at `.claude/skills/Estimators/` — read **only the PDF(s) for the estimator being implemented**, not all of them:
  | Estimator | PDF(s) to read |
  |-----------|---------------|
  | RDD (Sharp/Fuzzy) | `rdrobust.pdf`, `RDD_Calonico-Cattaneo-Titiunik_2015_R.pdf` |
  | GMM / LIML | `gmm_R.pdf` |
  | Panel FE / FD / TWFE | `fixest.pdf`, `plm_R.pdf` |
  | Synthetic Control | `synthetic_control.pdf` |

  Each PDF covers all four areas — read once, extract all four:
  - **β (coefficients)**: estimator-specific derivations
  - **SE (standard errors)**: variance formulas, sandwich estimators, bandwidth-dependent SE — cross-check with `src/core/inference/robustSE.js`
  - **Distributions & p-values**: t vs z vs chi², two-sided vs one-sided CDF — set `testStatLabel` in `EstimationResult` to match
  - **Plots**: canonical diagnostic plots for this estimator (e.g. RD plot with bins/CI, SC gap chart, GMM moment conditions) — use as spec for `ModelPlots.jsx` component

**2. EstimationResult wrapper** (`src/math/EstimationResult.js`)
- Add `wrapXxx(engineOutput, spec)` internal function.
- Wire into `wrapResult(type, engineOutput, spec)` switch.
- ALL canonical fields must be populated (use `?? null` / `?? []` for nullable ones):
  `varNames[], beta[], se[], testStats[], testStatLabel, pVals[], R2, adjR2, n, df, Fstat, Fpval, resid[], Yhat[]`
- Add estimator metadata to MODELS object: `{ id, label, color }`.

**3. ModelingTab.jsx** — estimate() branch (lines ~990–1090)
Real pattern to follow (copy from nearest existing estimator):
```js
} else if (model === "NewEstimator") {
  if (!xVars.length) { setErr("Select at least one regressor (X)."); setRunning(false); return; }
  const res = runNewEstimator(rows, y, xVars, wVars);
  if (!res || res.error) { setErr(res?.error ?? "NewEstimator failed."); setRunning(false); return; }
  setResult(wrapResult("NewEstimator", res, { yVar: y, xVars, wVars }));
}
```
- Add to `buildModelAvail()` (~line 907): `NewEstimator: true` (or conditional on panelOk).
- Add to `buildModelHint()` if it requires panel structure.

**4. EstimatorSidebar.jsx**
- Add entry to MODELS array: `{ id: "NewEstimator", label: "New Estimator", color: C.xxx }`.
- Same id string must match `wrapResult()` type and `buildModelAvail()` key.

**5. ModelConfiguration.jsx**
- Add config section if estimator needs special inputs (instruments, bandwidth, cutoff, etc.).
- Follow existing pattern: conditional render based on `model === "NewEstimator"`.

**6. ModelPlots.jsx**
- Add plot component(s). Wire into result rendering section of ModelingTab.jsx.
- Use `PlotSelector` wrapper with `accentColor` matching the estimator's color.

**7. AIService.js**
- Does `_serializeModelContext()` handle the new type? Check the if/switch chain.
- Does `interpretRegression()` need new logic for this family (binary, IV, panel, etc.)?

**8. ReportingModule.jsx**
- Does `buildStargazer()` render `testStatLabel` correctly? (t vs z vs chi²)
- Does `normaliseResult()` pass through? With canonical shape it should be trivial.

**9. Export scripts** (non-destructive — add alongside existing single-model functions)
- `services/export/rScript.js` — model-specific R code.
- `services/export/pythonScript.js` — statsmodels equivalent.
- `services/export/stataScript.js` — Stata command.

### Validation gate (browser — all 5 must pass before done)
- [ ] Coefficient table renders with correct values
- [ ] Forest plot renders
- [ ] AI narrative generates without error
- [ ] LaTeX export works
- [ ] R script generates

### Token efficiency
- `semantic_search_nodes` to find the nearest existing estimator as template (e.g. for IV-based: GMM or 2SLS, for binary: Logit/Probit).
- Read one `wrapXxx()` as template — not all of them.
- Target: ≤ 10 tool calls for full end-to-end.
