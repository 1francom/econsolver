# Econ Studio — Final Product Architecture Plan

## Context

Econ Studio is transitioning from a feature-based tool to a professional SaaS product. Three interdependent features are required: a standardised estimator interface (foundation), an advanced context-aware AI coach, and a multi-model comparison system. The standardised interface must land first — the other two consume its uniform result shape.

---

## Status Legend
- DONE — file exists with required exports / feature fully wired
- IN PROGRESS — file exists but feature incomplete or not fully wired
- PENDING — not yet started
- BLOCKED — dependency missing

---

## Phase 1: Standardised Estimation Result (Foundation) — DONE

### New file: `src/math/EstimationResult.js` — DONE

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

### Changes to `src/components/ModelingTab.jsx` — DONE
All estimation branches call `wrapResult()`. `result` state is a single canonical `EstimationResult`. All 13 estimator branches verified in code (OLS, WLS, FE, FD, 2SLS, DiD, TWFE, RDD, FuzzyRDD, Logit/Probit, GMM, LIML, LSDV, EventStudy, PoissonFE, SyntheticControl). useCallback dep-array patched to include treatedUnit, synthTreatTime, treatTimeCol, kPre, kPost, lsdvTimeFE — fixing stale-closure crash for Synthetic Control, Event Study, and LSDV.

### Changes to `src/ReportingModule.jsx` — IN PROGRESS
`normaliseResult()` is a thin shim that spreads raw and fills in `modelLabel`, `yVar`, `xVars`, `tStats` aliases — not a pure pass-through but functionally equivalent. `buildStargazer()` multi-model path exists.

### Changes to `src/services/ai/AIService.js` — DONE
`interpretRegression()` accepts `metadataReport` and appends metadata context. `compareModels()` handles N-way (array) and legacy 2-way call signatures.

### Changes to `src/math/index.js` — DONE
`wrapResult` and `getCoeffBlock` are re-exported.

### Verification
All estimator branches use `wrapResult`. setXVars destructuring bug and stale-closure bug in estimate() useCallback both fixed.

---

## Phase 2: Advanced Context-Aware AI Coach — DONE

### New file: `src/core/validation/metadataExtractor.js` — DONE

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

### New file: `src/core/validation/coachingTriggers.js` — DONE

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

### Changes to `src/services/ai/Prompts/index.js` — DONE
`buildMetadataContext()` exists and is imported by AIService.js.

### Changes to `src/services/ai/AIService.js` — DONE
Both `researchCoach` and `interpretRegression` accept and append `metadataReport`.

### Changes to `src/components/modeling/ResearchCoach.jsx` — DONE (file exists, accepts metadataReport prop)

### Changes to `src/components/ModelingTab.jsx` — DONE
`metadataReport` useMemo and `signals` useMemo wired. ModelingTab imports and renders all Phase 2 components.

### Verification
Pending Franco browser-validation of coaching signals end-to-end.

---

## Phase 3: Multi-Model Comparison System — DONE (multi-model export PARTIAL)

### New file: `src/services/modelBuffer.js` — DONE
Module-level singleton exists with add/remove/getAll/get/clear/count.

### New file: `src/components/modeling/ModelBufferBar.jsx` — DONE
File exists and is rendered in ModelingTab.

### New file: `src/components/modeling/ModelComparison.jsx` — DONE
File exists and is rendered in ModelingTab when compare mode active.

### Changes to `src/components/ModelingTab.jsx` — DONE
`bufferVersion` state, `pinnedModels` useMemo, ModelBufferBar and ModelComparison renders all present.

### Changes to `src/services/ai/AIService.js` — DONE
`compareModels()` handles N-way array input with legacy 2-way compatibility.

### Changes to export scripts — DONE
- `src/services/export/rScript.js`: `generateMultiModelRScript()` exists — DONE
- `src/services/export/pythonScript.js`: `generateMultiModelPythonScript()` — DONE (wired in ModelComparison.jsx)
- `src/services/export/stataScript.js`: `generateMultiModelStataScript()` — DONE (wired in ModelComparison.jsx)

### Verification
Pending Franco browser-validation of full comparison flow.

---

## Phase 4: Integration (1 day) — IN PROGRESS

Thread `metadataReport` to all consumers. Display coaching signals in results panel. End-to-end test: load panel dataset → run OLS → pin → run FE → pin → compare → check AI coach signals → export multi-model LaTeX + R script.

All multi-model export scripts (R, Python, Stata) are implemented and wired into ModelComparison.jsx. Remaining: browser validation of full Phase 3 comparison flow.

---

## New Files Summary (6)

| File | Purpose | Status |
|------|---------|--------|
| `src/math/EstimationResult.js` | Canonical result wrapper (Phase 1 foundation) | DONE |
| `src/core/validation/metadataExtractor.js` | Deep metadata extraction engine | DONE |
| `src/core/validation/coachingTriggers.js` | Rule-based coaching signal generator | DONE |
| `src/services/modelBuffer.js` | Session-level model registry | DONE |
| `src/components/modeling/ModelBufferBar.jsx` | Pinned models strip UI | DONE |
| `src/components/modeling/ModelComparison.jsx` | Side-by-side comparison UI | DONE |

## Modified Files Summary (9)

| File | Changes | Status |
|------|---------|--------|
| `src/math/index.js` | Re-export wrapResult, getCoeffBlock | DONE |
| `src/components/ModelingTab.jsx` | estimate() rewiring, buffer integration, metadata threading, coaching signals display, stale-closure dep-array fix | DONE |
| `src/ReportingModule.jsx` | Simplified normaliseResult (thin shim, not pure pass-through), canonical shape reads | IN PROGRESS |
| `src/services/ai/AIService.js` | Metadata-enriched coach/narrative, N-model comparison | DONE |
| `src/services/ai/Prompts/index.js` | buildMetadataContext(), extended COMPARE_MODELS_PROMPT | DONE |
| `src/components/modeling/ResearchCoach.jsx` | metadataReport prop, coaching signal chips | DONE |
| `src/services/export/rScript.js` | generateMultiModelRScript — DONE | DONE |
| `src/services/export/pythonScript.js` | `generateMultiModelPythonScript` — implemented + wired | DONE |
| `src/services/export/stataScript.js` | `generateMultiModelStataScript` — implemented + wired | DONE |

## Key Design Decisions

1. **Module singleton for ModelBuffer** — survives component unmount across tab navigation; avoids Context provider at App.jsx level. Re-render via version counter.
2. **Metadata in user message, not system** — preserves SHARED_CONTEXT prompt caching. Metadata varies per dataset (~200 tokens), appended to user block.
3. **MODELS metadata duplicated in EstimationResult.js** — avoids circular dependency with EstimatorSidebar.jsx. Just `{ id, label, color }` per estimator (~15 lines).
4. **Metadata computed at ModelingTab level** — uses final cleaned rows (post-pipeline), not intermediate wrangling state.
5. **Non-destructive multi-model exports** — new `generateMultiModelScript` functions alongside existing single-model ones.

---

## Phase 5: New Estimators — DONE (all 5 estimators implemented; crash bugs fixed)

Five new estimators in implementation order. Each section specifies the target file, function signature, algorithm, output contract, and UI touch-points.

---

### 5.1 Fuzzy RDD — DONE

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

### 5.2 Event Study — DONE (stale-closure crash fixed)

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

### 5.3 Panel LSDV — DONE (stale-closure crash fixed)

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

### 5.4 Poisson FE — DONE

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

### 5.5 Synthetic Control — DONE (setXVars destructuring bug and stale-closure crash fixed)

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

| File | Purpose | Status |
|------|---------|--------|
| `src/math/SyntheticControlEngine.js` | Frank-Wolfe convex optimization for synthetic control weights and gap series | DONE |

## Phase 5 Modified Files Summary (6)

| File | Changes | Status |
|------|---------|--------|
| `src/math/CausalEngine.js` | Add `runFuzzyRDD` | DONE |
| `src/math/PanelEngine.js` | Add `runEventStudy`, `runLSDV` | DONE |
| `src/math/NonLinearEngine.js` | Add `runPoissonFE` | DONE |
| `src/math/index.js` | Re-export all 5 new functions + `SyntheticControlEngine` | DONE |
| `src/components/modeling/ModelConfiguration.jsx` | Fuzzy RDD treatment selector, Event Study time selectors, Synthetic Control config | DONE |
| `src/components/modeling/ModelPlots.jsx` | Compliance plot, donor weights bar, gap plot, placebo overlay, Poisson diagnostics, LSDV heatmap | DONE |

---

## Phase 6: Robust Standard Errors — DONE

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

| File | Purpose | Status |
|------|---------|--------|
| `src/core/inference/robustSE.js` | HC0-HC3 sandwich, one-way clustered, two-way (CGM), Newey-West HAC | DONE |

### Phase 6 Modified Files Summary (6)

| File | Changes | Status |
|------|---------|--------|
| `src/math/LinearEngine.js` | Accept `seType`, delegate to `robustSE.js` | DONE |
| `src/math/PanelEngine.js` | Same SE wiring | DONE |
| `src/math/CausalEngine.js` | Same SE wiring | DONE |
| `src/math/NonLinearEngine.js` | Same SE wiring | DONE |
| `src/math/GMMEngine.js` | Same SE wiring | DONE |
| `src/components/modeling/ModelConfiguration.jsx` | SE type radio group via InferenceOptions.jsx (rendered in ModelingTab) | DONE — wired through InferenceOptions.jsx |

---

## Phase 7: New File Format Support — DONE

### .rds (R Data Files) — DONE
`src/services/data/parsers/rds.js` exists. Custom XDR binary parser (no npm dependency). Wired in `src/DataStudio.jsx` via dynamic import.

### .shp (Shapefiles) — DONE
`src/services/data/parsers/shapefile.js` exists. Reads DBF attribute table as data frame, geometry as WKT. Wired in `src/DataStudio.jsx`. Note shown for .shp-only uploads directing user to upload .dbf. File accept list includes `.rds,.dbf`.

### Phase 7 New Files Summary (2)

| File | Purpose | Status |
|------|---------|--------|
| `src/services/data/parsers/rds.js` | R data file parser (data.frame, tibble, named list) | DONE |
| `src/services/data/parsers/shapefile.js` | Shapefile attribute table parser, geometry as WKT | DONE |

### Phase 7 Modified Files Summary (1)

| File | Changes | Status |
|------|---------|--------|
| `src/DataStudio.jsx` | Registers rds.js and shapefile.js in file upload handler; shows geometry note | DONE |

---

## Phase 8: Modeling UI Overhaul — DONE

Three independent improvements to `src/components/ModelingTab.jsx` and `src/components/modeling/`:

### 8.1 — "Choose Model" selector — DONE
`EstimatorSidebar.jsx` exists and is rendered. Grouped dropdown implemented.

### 8.2 — SE & Options Visual Panel — DONE
`src/components/modeling/InferenceOptions.jsx` exists with full SE type chips, cluster var selector, cluster2 var selector (two-way), HAC max lag input. All props flow into `estimate()` via ModelingTab.

### 8.3 — Inline Code Editor — DONE
`src/components/modeling/CodeEditor.jsx` exists. Three tabs (R/Python/Stata), textarea-based, pre-populated from active result. Rendered in ModelingTab with `<CodeEditor result={result} />`.

### Phase 8 New Files Summary (2)

| File | Purpose | Status |
|------|---------|--------|
| `src/components/modeling/InferenceOptions.jsx` | Collapsible SE type / cluster / FE type / HAC lag options panel | DONE |
| `src/components/modeling/CodeEditor.jsx` | Inline R/Python/Stata replication script viewer with textarea editing | DONE |

### Phase 8 Modified Files Summary (2)

| File | Changes | Status |
|------|---------|--------|
| `src/components/modeling/EstimatorSidebar.jsx` | Grouped "Choose Model" dropdown/popover | DONE |
| `src/components/ModelingTab.jsx` | InferenceOptions props wired into estimate(); CodeEditor rendered | DONE |

---

## Overall Status Summary (last updated 2026-04-12)

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Standardised Estimation Result | DONE |
| 2 | Advanced Context-Aware AI Coach | DONE |
| 3 | Multi-Model Comparison System | DONE |
| 4 | Integration | IN PROGRESS — pending browser validation of full comparison flow |
| 5 | New Estimators (Fuzzy RDD, Event Study, LSDV, Poisson FE, Synthetic Control) | DONE (crash bugs fixed) |
| 6 | Robust Standard Errors | DONE |
| 7 | New File Format Support (.rds, .shp/.dbf) | DONE |
| 8 | Modeling UI Overhaul (EstimatorSidebar, InferenceOptions, CodeEditor) | DONE |

## Next unblocked tasks

1. **Browser validation of Phase 3 comparison flow** — pin 3 models (OLS, FE, 2SLS), open ModelComparison, verify stargazer table shows 3 columns, AI narrative references all three, all three multi-model export scripts (R/Python/Stata) generate correctly.

2. **CLAUDE.md pending list** — mark off Python/Stata multi-model exports as done; they were already implemented and wired.
