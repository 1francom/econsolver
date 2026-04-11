# Econ Studio — Final Product Architecture Plan

## Context

Econ Studio is transitioning from a feature-based tool to a professional SaaS product. Three interdependent features are required: a standardised estimator interface (foundation), an advanced context-aware AI coach, and a multi-model comparison system. The standardised interface must land first — the other two consume its uniform result shape.

---

## Phase 1: Standardised Estimation Result (Foundation)

### New file: `src/math/EstimationResult.js`

Single `wrapResult(type, engineOutput, spec)` factory that normalises all 9 estimator outputs into one canonical `EstimationResult` shape:

```
EstimationResult {
  id, type, family, timestamp, label, color,

  // Core coefficients (EVERY estimator)
  varNames[], beta[], se[], testStats[], testStatLabel("t"|"z"), pVals[],

  // Fit (nullable per estimator)
  R2, adjR2, R2Within, R2Between, mcFaddenR2, logLik, AIC, BIC,
  n, df, Fstat, Fpval,

  // Treatment effects (nullable)
  att, attSE, attP, late, lateSE, lateP,

  // Arrays (always present)
  resid[], Yhat[],

  // Sub-results (nullable)
  firstStages[], marginalEffects, oddsRatios, rddPlotData,

  // Spec metadata (what the user configured)
  spec: { yVar, xVars, wVars, zVars, entityCol, timeCol, ... },

  // Binary model flags
  converged, iterations
}
```

Internal `wrapLinear`, `wrapFE`, `wrapFD`, `wrap2SLS`, `wrapDiD`, `wrapTWFE`, `wrapRDD`, `wrapBinary` map each engine's idiosyncratic fields to canonical positions. Also exports `getCoeffBlock(result)` for Stargazer/AI use.

Duplicate MODELS metadata (id, label, color) as a plain object here to avoid circular dependency with `EstimatorSidebar.jsx`.

### Changes to `src/components/ModelingTab.jsx`

All 9 branches in `estimate()` (lines 806-882) call `wrapResult()` instead of building ad-hoc `{ type, main/fe/fd/second }` objects. The `result` state becomes a single `EstimationResult`. For FE/FD dual display: wrap both as separate `EstimationResult` objects, store as `{ type: "panel", fe: EstimationResult, fd: EstimationResult }`.

All rendering branches (lines 1029+) read canonical fields: `result.varNames`, `result.R2`, `result.testStats` instead of `result.main.R2`, `result.main.tStats`.

### Changes to `src/ReportingModule.jsx`

`normaliseResult()` becomes trivial pass-through (canonical shape is already normalised). `buildStargazer()` reads `result.testStats` and `result.testStatLabel` for column header.

### Changes to `src/services/ai/AIService.js`

`_serializeModelContext()` and `interpretRegression()` drop the `result.second ?? result` unwrapping — read canonical fields directly.

### Changes to `src/math/index.js`

Add `export { wrapResult, getCoeffBlock } from "./EstimationResult.js"`

### Verification
Run all 9 estimators (OLS, WLS, FE, FD, 2SLS, DiD, TWFE, RDD, Logit, Probit) in browser, verify: coefficient table renders, forest plot renders, AI narrative generates, LaTeX export works, R/Python/Stata scripts generate.

---

## Phase 2: Advanced Context-Aware AI Coach

### New file: `src/core/validation/metadataExtractor.js`

`buildMetadataReport(headers, rows, info, panelReport?)` returns:

```
MetadataReport {
  temporal: { dateCol, periodicity, dateFormat, minDate, maxDate, span },
  panelQuality: { balance, tDistribution{min,max,mean,median}, gapRate, withinVar, betweenVar, withinShare },
  columns: ColMetadata[],   // per-column: kurtosis, normalityLabel, logFeasible, coeffOfVar, skewness, withinVar, betweenVar
  highCorrelations[]
}
```

Key computations:
- **Date periodicity**: scan non-numeric columns with `Date.parse()`, compute mode of diffs (1d=daily, 7=weekly, 28-31=monthly, 89-92=quarterly, 365=annual). Also detect numeric year columns (all integers 1900-2100).
- **Kurtosis**: `sum((x-mean)^4/std^4)/n - 3`. Label: |k|<1 normal, k>3 leptokurtic, k<-1 platykurtic.
- **Log feasibility**: `min > 0 && max/min > 10`
- **Within/between variance**: per-entity means, `withinVar = avg(var_within)`, `betweenVar = var(entity_means)`, standard ANOVA decomposition.

### New file: `src/core/validation/coachingTriggers.js`

`generateCoachingSignals(metadata, activeResult?)` returns `CoachingSignal[]`:

```
CoachingSignal { id, severity, category, title, detail, suggestion, question }
```

Rule examples:
| Condition | Signal |
|-----------|--------|
| Daily periodicity + panel + FE model | Suggest TWFE for day-of-week/seasonal effects |
| Column skewness > 2 + logFeasible + column in xVars | Suggest log transform |
| Panel withinShare < 0.15 + FE model | Warn low within-variance, FE may lack power |
| Residual kurtosis > 5 (post-estimation) | Suggest robust SEs |
| Y is positive + level-level form + logFeasible | Suggest log-Y for elasticity interpretation |

### Changes to `src/services/ai/Prompts/index.js`

Add `buildMetadataContext(metadataReport)` — serialises metadata into a compact text block (~200 tokens) appended to user messages (not system, to preserve prompt caching).

### Changes to `src/services/ai/AIService.js`

- `researchCoach({ ..., metadataReport })` — append metadata context
- `interpretRegression(result, dataDictionary, metadataReport)` — append metadata context
- Both append to the **user** message, preserving cached system block

### Changes to `src/components/modeling/ResearchCoach.jsx`

Accept `metadataReport` prop. Display coaching signals as clickable chips above starter questions. Click auto-submits `signal.question` to the coach.

### Changes to `src/components/ModelingTab.jsx`

```js
const metadataReport = useMemo(
  () => buildMetadataReport(headers, rows, info, panelReport),
  [headers, rows, info, panelReport]
);
const signals = useMemo(
  () => result ? generateCoachingSignals(metadataReport, result) : [],
  [metadataReport, result]
);
```

Display signals as collapsible "Coach Insights" section between fit stats bar and coefficient table.

### Verification
Load a panel dataset with daily dates, run FE — verify periodicity signal appears. Load a skewed dataset, run OLS — verify log-transform suggestion. Check AI narrative mentions distributional properties.

---

## Phase 3: Multi-Model Comparison System

### New file: `src/services/modelBuffer.js`

Module-level singleton (survives component unmount across tab switches):

```
add(result: EstimationResult)    // max 8, FIFO eviction
remove(id)
getAll() → EstimationResult[]
get(id)
clear()
count()
```

### New file: `src/components/modeling/ModelBufferBar.jsx`

Horizontal strip at bottom of results panel. Each pinned model is a compact card: `[OLS (1) · R²=0.43]`. Color-coded by estimator. Click restores that result as active display. X button removes. "Compare" button opens comparison panel when 2+ models pinned.

### New file: `src/components/modeling/ModelComparison.jsx`

Full comparison panel with:
1. **Stargazer table** — calls existing `buildStargazer(models[])` from ReportingModule (already multi-model capable, just never called with >1)
2. **Fit statistics grid** — R2, AdjR2, N, F, AIC/BIC across all models
3. **Coefficient stability heatmap** — per variable, coefficient + significance across models, color-coded for sign changes
4. **AI narrative** — calls extended `compareModels(models[], dataDictionary)`

### Changes to `src/components/ModelingTab.jsx`

- Add `[bufferVersion, setBufferVersion] = useState(0)` to trigger re-render on buffer mutations
- "Pin Model" button in results header after successful estimation
- Buffer count badge
- Render `<ModelBufferBar>` at bottom of results panel
- Render `<ModelComparison>` when compare mode active

### Changes to `src/services/ai/AIService.js`

Extend `compareModels` for N models (2-8):
```js
export async function compareModels(models, dataDictionary = null)
// models: EstimationResult[]
```
`formatModel` helper already works per-model — map over array. Extend `COMPARE_MODELS_PROMPT` for N-way comparison.

### Changes to export scripts

Each gets a new `generateMultiModelScript(configs[])`:
- R: loops model configs, `modelsummary(list(m1=fit1, m2=fit2, ...))`
- Stata: `estimates store` per model, `esttab` at end
- Python: `summary_col()` from `statsmodels`

Non-destructive — existing single-model functions untouched.

### Verification
Pin 3 models (OLS, FE, 2SLS), open comparison, verify: stargazer table shows 3 columns, AI narrative references all three, R script generates multi-model `modelsummary()` call.

---

## Phase 4: Integration (1 day)

Thread `metadataReport` to all consumers. Display coaching signals in results panel. End-to-end test: load panel dataset → run OLS → pin → run FE → pin → compare → check AI coach signals → export multi-model LaTeX + R script.

---

## New Files Summary (6)

| File | Purpose |
|------|---------|
| `src/math/EstimationResult.js` | Canonical result wrapper (Phase 1 foundation) |
| `src/core/validation/metadataExtractor.js` | Deep metadata extraction engine |
| `src/core/validation/coachingTriggers.js` | Rule-based coaching signal generator |
| `src/services/modelBuffer.js` | Session-level model registry |
| `src/components/modeling/ModelBufferBar.jsx` | Pinned models strip UI |
| `src/components/modeling/ModelComparison.jsx` | Side-by-side comparison UI |

## Modified Files Summary (9)

| File | Changes |
|------|---------|
| `src/math/index.js` | Re-export wrapResult, getCoeffBlock |
| `src/components/ModelingTab.jsx` | estimate() rewiring, buffer integration, metadata threading, coaching signals display |
| `src/ReportingModule.jsx` | Simplified normaliseResult, canonical shape reads |
| `src/services/ai/AIService.js` | Metadata-enriched coach/narrative, N-model comparison |
| `src/services/ai/Prompts/index.js` | buildMetadataContext(), extended COMPARE_MODELS_PROMPT |
| `src/components/modeling/ResearchCoach.jsx` | metadataReport prop, coaching signal chips |
| `src/services/export/rScript.js` | generateMultiModelScript |
| `src/services/export/pythonScript.js` | generateMultiModelScript |
| `src/services/export/stataScript.js` | generateMultiModelScript |

## Key Design Decisions

1. **Module singleton for ModelBuffer** — survives component unmount across tab navigation; avoids Context provider at App.jsx level. Re-render via version counter.
2. **Metadata in user message, not system** — preserves SHARED_CONTEXT prompt caching. Metadata varies per dataset (~200 tokens), appended to user block.
3. **MODELS metadata duplicated in EstimationResult.js** — avoids circular dependency with EstimatorSidebar.jsx. Just `{ id, label, color }` per estimator (~15 lines).
4. **Metadata computed at ModelingTab level** — uses final cleaned rows (post-pipeline), not intermediate wrangling state.
5. **Non-destructive multi-model exports** — new `generateMultiModelScript` functions alongside existing single-model ones.

---

## Phase 5: New Estimators

Five new estimators in implementation order. Each section specifies the target file, function signature, algorithm, output contract, and UI touch-points.

---

### 5.1 Fuzzy RDD

**Target file:** `src/math/CausalEngine.js` (extends existing file)

**Signature:**
```js
runFuzzyRDD(rows, yCol, treatCol, runningCol, cutoff, { bandwidth, kernel, controls })
```

**Algorithm:**
Two-stage least squares where the sharp cutoff indicator `Z = 1(X >= c)` is the instrument and `D` (actual treatment receipt) is the endogenous variable. LATE is estimated as the ratio of the Y-discontinuity to the P(D=1)-discontinuity at the cutoff. Uses the existing `runWLS` kernel-weighting infrastructure for both stages.

- Stage 1: regress `D` on `Z`, controls, within bandwidth — produces `firstStageDisc` and `complianceRate`
- Stage 2: regress `Y` on `D_hat`, controls, within bandwidth — produces the fuzzy LATE
- SE via delta method propagating both stage variances
- Reuses `ikBandwidth`, kernel weight helpers already in `CausalEngine.js`

**New output fields:**
```
complianceRate     — P(D=1|X>=c) - P(D=1|X<c)
firstStageDisc     — first-stage discontinuity coefficient
LATE               — local average treatment effect
lateSE             — SE of LATE
```

**UI changes:**
- `ModelConfiguration.jsx` — add treatment-receipt variable selector (separate from running variable)
- `ModelPlots.jsx` — add compliance plot (P(D=1) vs running variable with cutoff line) and fuzzy scatter (Y vs X, colored by treatment receipt)

---

### 5.2 Event Study

**Target file:** `src/math/PanelEngine.js` (extends existing file)

**Signature:**
```js
runEventStudy(rows, yCol, xCols, unitCol, timeCol, treatVar, treatTimeCol, { kPre, kPost })
```

**Algorithm:**
TWFE regression with relative-time dummies `D_it^k = 1(t - treat_time_i = k)` for `k` in `[-kPre, kPost]`, omitting `k = -1` as the reference period. Coefficient vector maps one-to-one to event-time periods. Pre-trend F-test: joint significance of all lead coefficients (`k < -1`).

- Build relative-time column per unit from `treatTimeCol`
- Construct dummy matrix, drop `k = -1`
- Run within (FE) regression via existing `runFE` demeaning
- Extract `eventCoeffs` with 95% CI per period
- Compute `preTrendF` and `preTrendP` via Wald test on lead sub-vector

**New output fields:**
```
eventCoeffs[]   — [{ k, coeff, se, ciLow, ciHigh }]
preTrendF       — F-statistic on pre-period leads
preTrendP       — p-value for pre-trend test
```

**UI changes:**
- `EstimatorSidebar.jsx` — expose Event Study as a named estimator option
- `ModelConfiguration.jsx` — add `treatTimeCol` selector and `kPre`/`kPost` numeric inputs
- `ModelPlots.jsx` — `EventStudyPlot` component already exists; wire it to the formal `runEventStudy` output (currently only a stub/plot shell)

---

### 5.3 Panel LSDV

**Target file:** `src/math/PanelEngine.js` (extends existing file)

**Signature:**
```js
runLSDV(rows, yCol, xCols, unitCol, timeCol, { timeFE })
```

**Algorithm:**
OLS on the augmented design matrix that includes entity dummy columns (and optionally time dummy columns). Mathematically equivalent to the within estimator but explicitly recovers entity fixed effects `alpha_i` and, when `timeFE: true`, time fixed effects `lambda_t`. Uses the existing OLS path in `LinearEngine.js` after constructing the dummy matrix.

- Construct entity dummy matrix (drop one for identification)
- Optionally append time dummy matrix
- Call `runOLS` on the full design matrix
- Partition coefficient vector: `beta` (structural), `alphas` (entity dummies), `lambdas` (time dummies)

**New output fields:**
```
alphas    — { [unit]: coeff }   entity fixed effects
lambdas   — { [time]: coeff }   time fixed effects (null if timeFE: false)
```

**UI changes:**
- `ModelPlots.jsx` — heatmap of entity-by-time fixed effects (entity on y-axis, time on x-axis, alpha_i + lambda_t fill color)

---

### 5.4 Poisson FE

**Target file:** `src/math/NonLinearEngine.js` (extends existing file)

**Signature:**
```js
runPoissonFE(rows, yCol, xCols, unitCol, timeCol?)
```

**Algorithm:**
Poisson pseudo-maximum likelihood (PPML) with entity fixed effects via iterative demeaning (Guimaraes-Portugal 2010). Avoids inverting the full entity-dummy design matrix, which is infeasible for large `N`.

- Initialize `mu_it = Y_it` or uniform starting values
- IRLS outer loop (same skeleton as `runLogit`/`runProbit`): working weights `W = diag(mu)`, working response `z = eta + (Y - mu)/mu`
- Inner demeaning step per IRLS iteration: subtract entity means from `z` and `X` (within transform on working variables)
- Convergence: `||beta_new - beta_old||_inf < 1e-8` or 200 iterations
- Overdispersion check: Pearson chi-squared / df — flag if > 1.5

**New output fields:**
```
IRR[]          — exp(beta) per covariate, incidence rate ratios
pseudoR2       — 1 - logLik_full / logLik_null
overdispersion — Pearson chi-sq / df
entityAlphas   — { [unit]: alpha_i } (recovered post-convergence)
```

**UI changes:**
- `EstimatorSidebar.jsx` — add Poisson FE as estimator option (family: Panel)
- `ModelPlots.jsx` — predicted vs actual count scatter, Pearson residual histogram

---

### 5.5 Synthetic Control

**Target file:** `src/math/SyntheticControlEngine.js` (new file)

**Signature:**
```js
runSyntheticControl(rows, yCol, unitCol, timeCol, treatUnit, preperiods, predictors[])
```

**Algorithm:**
Convex optimization: find donor weights `W` (W >= 0, sum(W) = 1) minimizing `||X1 - X0'W||^2_V` where `X1` is the treated unit's pre-period predictor vector, `X0` is the donor matrix, and `V` is a diagonal predictor-importance matrix (initialized as identity; optionally learned by outer loop minimizing pre-period MSPE).

Implemented via Frank-Wolfe projected gradient descent in pure JS — no external solver dependency:
1. Initialize `W = 1/n_donors` (uniform)
2. Gradient step: `g = -2 * X0 * V * (X1 - X0'W)`
3. Frank-Wolfe update: move weight toward donor `argmin g'e_j`
4. Project onto simplex: clip negatives, renormalize
5. Repeat until `||delta W||_inf < 1e-9` or 2000 iterations

Synthetic outcome series: `Y_synthetic[t] = W' * Y_donors[t]` for all `t`. Gap series: `gap[t] = Y_treat[t] - Y_synthetic[t]`. In-space placebo: jackknife leave-one-out — repeat optimization treating each donor as the "treated" unit, collect gap distributions for inference.

**New output fields:**
```
weights[]         — [{ unit, weight }] sorted descending, donors with w > 0.01
syntheticSeries[] — [{ time, synthetic }]
gapSeries[]       — [{ time, gap }]
preMSPE           — mean squared prediction error in pre-period
postMSPE          — mean squared prediction error in post-period (placebo benchmark)
placebos[]        — jackknife gap series per donor unit
```

**UI changes:**
- `EstimatorSidebar.jsx` — add Synthetic Control as estimator (family: Causal)
- `ModelConfiguration.jsx` — treated unit selector (dropdown of unique unit values), pre-period boundary input, predictor variable multi-select
- `ModelPlots.jsx` — three new plot components:
  - `SyntheticGapPlot` — gap series with zero line and pre/post shading
  - `SyntheticDonorWeights` — horizontal bar chart of donor weights
  - `SyntheticPlaceboPlot` — donor placebo gaps overlaid as grey lines, treated gap as colored foreground

---

## Phase 5 New Files Summary (1)

| File | Purpose |
|------|---------|
| `src/math/SyntheticControlEngine.js` | Frank-Wolfe convex optimization for synthetic control weights and gap series |

## Phase 5 Modified Files Summary (6)

| File | Changes |
|------|---------|
| `src/math/CausalEngine.js` | Add `runFuzzyRDD` |
| `src/math/PanelEngine.js` | Add `runEventStudy`, `runLSDV` |
| `src/math/NonLinearEngine.js` | Add `runPoissonFE` |
| `src/math/index.js` | Re-export all 5 new functions + `SyntheticControlEngine` |
| `src/components/modeling/ModelConfiguration.jsx` | Fuzzy RDD treatment selector, Event Study time selectors, Synthetic Control config |
| `src/components/modeling/ModelPlots.jsx` | Compliance plot, donor weights bar, gap plot, placebo overlay, Poisson diagnostics, LSDV heatmap |

---

## Phase 6: Robust Standard Errors (MOST URGENT)

Add a `src/core/inference/robustSE.js` pure-JS module exporting:

- `hcSE(X, e, n, k, variant)` — HC0/HC1/HC2/HC3 sandwich estimator. HC1 is the default (matches R `vcovHC`). Formula: `V = (X'X)^{-1} B (X'X)^{-1}` where `B = Σ h_i² x_i x_i'` and h_i is the leverage-adjusted residual per variant.
- `clusteredSE(X, e, clusters, n, k)` — one-way clustered SE. Groups residuals by cluster variable, computes `B = Σ_g X_g' e_g e_g' X_g`, applies small-sample correction `G/(G-1) * (n-1)/(n-k)`.
- `twowayClusteredSE(X, e, clusters1, clusters2, n, k)` — Cameron-Gelbach-Miller two-way clustering (entity + time). `V = V_1 + V_2 - V_12`.
- `neweyWestSE(X, e, t_index, maxLag, n, k)` — HAC Newey-West with Bartlett kernel. For panel/time-series with autocorrelation.

Wire into ALL engines: LinearEngine, PanelEngine, CausalEngine, NonLinearEngine, GMMEngine. Each engine receives an optional `seType` argument: `"classical" | "HC1" | "HC2" | "HC3" | "clustered" | "twoway" | "HAC"` plus `clusterVar` and `timeVar`. Default remains classical for backward compatibility.

UI changes:
- Add SE type selector to `ModelConfiguration.jsx` — radio group: Classical / HC1 (Robust) / HC3 / Clustered / Two-Way / HAC (Newey-West)
- Cluster variable selector appears conditionally when Clustered or Two-Way selected
- Max lag input appears for HAC
- Display chosen SE type in CoeffTable header and in replication scripts

Validation: compare HC1 and clustered SE against R `sandwich::vcovHC` and `lmtest::coeftest` to 4 decimal places.

### Phase 6 New Files Summary (1)

| File | Purpose |
|------|---------|
| `src/core/inference/robustSE.js` | HC0-HC3 sandwich, one-way clustered, two-way (CGM), Newey-West HAC |

### Phase 6 Modified Files Summary (6)

| File | Changes |
|------|---------|
| `src/math/LinearEngine.js` | Accept `seType`, `clusterVar`, `timeVar`; delegate to `robustSE.js` |
| `src/math/PanelEngine.js` | Same SE wiring |
| `src/math/CausalEngine.js` | Same SE wiring |
| `src/math/NonLinearEngine.js` | Same SE wiring |
| `src/math/GMMEngine.js` | Same SE wiring |
| `src/components/modeling/ModelConfiguration.jsx` | SE type radio group, cluster var selector, max lag input |

---

## Phase 7: New File Format Support

### .rds (R Data Files)
Add `src/services/data/parsers/rds.js`. Use the `r-data.js` npm package (or implement subset parser for common RDS types: data.frame, tibble, named list). Falls back gracefully if unsupported RDS type detected. Wire into DataStudio file upload alongside existing CSV/Excel parsers.

### .shp (Shapefiles)
Add `src/services/data/parsers/shapefile.js`. Use `shapefile` npm package (pure JS). Reads the attribute table (DBF component) as the data frame — geometry columns stored as WKT strings for potential future map viz. Wire into DataStudio file upload. Show a note in the UI: "Geometry columns detected — spatial join and choropleth map coming soon."

Both parsers must return `{ headers: string[], rows: object[] }` — same shape as CSV/Excel parsers so the pipeline is format-agnostic.

### Phase 7 New Files Summary (2)

| File | Purpose |
|------|---------|
| `src/services/data/parsers/rds.js` | R data file parser (data.frame, tibble, named list) |
| `src/services/data/parsers/shapefile.js` | Shapefile attribute table parser, geometry as WKT |

### Phase 7 Modified Files Summary (1)

| File | Changes |
|------|---------|
| `src/DataStudio.jsx` | Register rds.js and shapefile.js in file upload handler; show geometry note |

---

## Phase 8: Modeling UI Overhaul

Three independent improvements to `src/components/ModelingTab.jsx` and `src/components/modeling/`:

### 8.1 — "Choose Model" selector
Replace the current `EstimatorSidebar.jsx` vertical list with a compact primary button "Choose Model ▾" that opens a grouped dropdown/popover panel. Groups: Linear (OLS, WLS), Panel (FE, FD, TWFE, LSDV), Causal (2SLS, DiD, RDD, Fuzzy RDD, Event Study), Count (Poisson FE), Binary (Logit, Probit), Advanced (GMM, LIML, Synthetic Control). Selected model shown as a badge next to the button. Saves vertical space for results.

### 8.2 — SE & Options Visual Panel
Add `src/components/modeling/InferenceOptions.jsx`. A compact collapsible panel below the variable selectors showing:
- SE type: radio chips (Classical · Robust HC1 · HC3 · Clustered · Two-Way · HAC)
- Cluster variable: dropdown (appears when Clustered or Two-Way selected)
- FE type: for panel models — entity only / time only / two-way
- Max lag: number input (appears for HAC)
- All options feed into the `estimate()` call in ModelingTab

### 8.3 — Inline Code Editor
Add `src/components/modeling/CodeEditor.jsx`. A collapsible panel with three tabs: R / Python / Stata. Uses a `<textarea>` with monospace styling (no external editor dependency). Pre-populates with the replication script for the active model. User can edit and copy. Diff-highlighting optional (post-MVP). Wire into the existing `generateRScript` / `generatePythonScript` / `generateStataScript` exports — edits are local state only, not fed back into the engine.

### Phase 8 New Files Summary (2)

| File | Purpose |
|------|---------|
| `src/components/modeling/InferenceOptions.jsx` | Collapsible SE type / cluster / FE type / HAC lag options panel |
| `src/components/modeling/CodeEditor.jsx` | Inline R/Python/Stata replication script viewer with textarea editing |

### Phase 8 Modified Files Summary (2)

| File | Changes |
|------|---------|
| `src/components/modeling/EstimatorSidebar.jsx` | Replace vertical list with grouped "Choose Model" dropdown/popover |
| `src/components/ModelingTab.jsx` | Wire InferenceOptions props into estimate(); render CodeEditor panel |
