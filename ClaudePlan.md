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

## Phase 9: Workspace Architecture — PENDING

Complete redesign of the application shell from a linear wizard to a spatial research workspace. Every section lives under the same project and session. All datasets are shared globally.

---

### 9.1 — Shell Restructure — PENDING

Replace the current top-level navigation with a persistent 7-tab workspace bar:

```
[ Data ]  [ Clean ]  [ Explore ]  [ Model ]  [ Simulate ]  [ Calculate ]  [ Report ]
```

**`App.jsx` / `DataStudio.jsx` changes:**
- Render the 7-tab bar at the top of every project view (below the project title bar)
- Each tab mounts its own module component; all share the same `sessionState` context
- `sessionState` holds: `datasets{}` registry, `globalPipeline[]`, `calcWorkspace{}`, `pinnedModels[]`
- The current `WranglingModule` becomes `[ Clean ]`, `ExplorerModule` becomes `[ Explore ]`, `ModelingTab` becomes `[ Model ]`, `ReportingModule` becomes `[ Report ]`

**Tab routing:** shallow hash-based (`#data`, `#clean`, `#explore`, `#model`, `#simulate`, `#calculate`, `#report`) — no full re-mount on tab switch, state preserved

---

### 9.2 — Session Dataset Manager — PENDING

A scrollable dataset registry panel, persistent across all tabs (rendered in every tab's left sidebar or as a collapsible panel).

**Dataset entry:**
```
● df_main        1842 × 12    [source: loaded]
● df_regions      412 × 4     [source: loaded]
◎ df_merged      1842 × 14    [source: G1 — left_join]
◎ df_final       1601 × 14    [source: G2 — intersect]
```

- `●` = source dataset (loaded from file, simulated, or created in Calculate)
- `◎` = derived dataset (output of a global pipeline step)
- Click to set as active dataset in the current tab
- Rename / delete actions per entry (delete warns on derived datasets — see 9.4)
- Scrollable when > 5 datasets

**World Bank and OECD fetchers** move here from their current locations. `[ Data ]` tab is the canonical place to load external data.

**Global interaction log** — collapsible at the bottom of the manager:
```
▾ Interactions
G1  left_join(df_main, df_regions) → df_merged   [key: region_id]
G2  intersect(df_merged, df_controls) → df_final
```
- Clicking a G-step shows its parameters inline (join type, key columns, selected columns)
- Add / delete G-steps from here

---

### 9.3 — Two-Tier Pipeline Architecture — PENDING

**Tier 1 — Local pipelines (per-dataset):**
- Each dataset in the registry carries its own `localPipeline[]` — the existing `runner.js` step array
- Steps operate on one dataset in isolation
- Shown in `[ Clean ]` tab when that dataset is active
- Numbered locally: 1, 2, 3…
- Implicit rule: **local steps always describe the dataset before it enters any global step**

**Tier 2 — Global pipeline (cross-dataset):**
- Session-level `globalPipeline[]` of cross-dataset operations
- Step types: `left_join`, `right_join`, `inner_join`, `append`, `intersect`, `union`, `setdiff`
- Each step has: `{ id, type, leftDatasetId, rightDatasetId, outputDatasetId, params }`
- Managed from the Dataset Manager interaction log (9.2), not from Clean tab
- G-steps numbered globally for export ordering

**Execution order rule:**
1. All local pipeline steps on source datasets run first
2. Then the global step runs (producing a derived dataset)
3. Then local pipeline steps on the derived dataset run (post-merge transformations)

This order is deterministic and matches how `runner.js` already replays steps.

---

### 9.4 — Step Deletion Behavior — PENDING

**Local pipeline step deletion:**
- Optimistic delete: remove the step and replay the pipeline from `rawData`
- If downstream steps fail (reference a column that no longer exists), show which steps broke
- Present two options: *Delete broken steps* or *Undo deletion*
- No blocking warning before the delete attempt — failure feedback is sufficient

**Global pipeline step deletion:**
- Blocking warn before delete, showing full cascade:
  - Derived datasets that will be removed
  - Downstream G-steps that depend on those datasets
  - Pinned models that used any of the removed datasets
- Two options in the warning dialog:
  - **Save snapshot first** — materializes the derived dataset's current state as a new standalone source dataset (no G-step dependency), then proceeds with the delete
  - **Delete cascade** — removes the G-step, all downstream G-steps, and orphaned derived datasets

---

### 9.5 — Pipeline Export Architecture — PENDING

**Problem:** the current export scripts emit steps as a flat sequence. With a two-tier pipeline and multiple datasets, the exporter must understand dependency order.

**Solution:** each step in `runner.js` gains a `datasetId` field (which dataset it operates on). The exporter builds a **dependency graph** and does a topological traversal:

```
For each G-step in global pipeline order:
  1. Recursively emit local pipeline of left dataset (and its own G-step dependencies)
  2. Recursively emit local pipeline of right dataset (and its dependencies)
  3. Emit the join/intersect/append as a named assignment
After all G-steps:
  4. Emit any local pipeline steps on derived datasets
```

**Per-step export methods:** each step type in the registry gets `toR()`, `toStata()`, `toPython()` methods. The exporter calls the appropriate method per step, tracking the current dataset name in scope.

**Language-specific rules:**
- **R / dplyr:** steps on the same dataset chain with `|>`. A join is an inline `left_join()`. The right-hand dataset is pre-assigned if it has its own local pipeline; otherwise inlined as `right_df |> select(...)`.
- **Python / pandas:** same chaining logic with `.merge()`. Multi-step chains use intermediate assignments for readability.
- **Stata:** every intermediate dataset must be pre-materialized as a named `.dta` file. No inline sub-queries. The exporter emits `preserve/restore` or `use/save/merge` blocks sequentially. The right-hand dataset in any merge is always a separate `use ... using "file.dta"` block.

---

### 9.6 — Per-Tab Section Exports — DONE

Every tab gets a consistent export bar (top-right of the tab content area) with three buttons: **R**, **Stata**, **Python**. Each exports only the content of that tab as a standalone, runnable script.

| Tab | What the script contains |
|-----|--------------------------|
| Data | Dataset loading code (file paths, read_dta / read.csv calls) |
| Clean | Full local pipeline for the active dataset (all step types via toR/toStata/toPython) |
| Explore | Summary stats code + plot code for all plots built in the session |
| Model | Estimation code for all models run (existing CodeEditor logic, promoted) |
| Simulate | DGP definition code (set.seed, distributions, variable construction) |
| Calculate | Variable definitions and computed expressions |
| Report | Full bundle export (existing) |

These are **deterministic exports** — no AI involved. Fast, always available, free tier.

---

### 9.7 — Calculate Tab — PENDING

A structured **variable workspace** — not a REPL, but a form-based table of named scalar/vector values.

**Variable table:**
```
Name              Type        Value
────────────────────────────────────────────────
n                 Integer     1000
discount_rate     Float       0.06
city              String      "Munich"
start_date        Date        2020-01-01
treated           Boolean     TRUE
coeffs            Vector      1.2, 0.8, -0.3
```

**Add variable form:**
- Name field (validates: alphanumeric + underscore, no spaces)
- Type dropdown: Integer / Float / String / Date / Boolean / Vector
- Value input adapts to type: number input / text / date picker / toggle / comma-separated

**Computed rows** (separate section, labeled "Computed from dataset"):
```
mean_wage         Computed    mean(wage)    [from: df_main]
n_treated         Computed    sum(treated)  [from: df_main]
```
- Expression references active dataset columns
- Evaluated against current dataset state

**`as.data.frame` creator:**
- "New dataset from variables" button
- User selects which vector-type variables become columns, sets `n` (row count)
- Names the dataset and saves it to the Dataset Manager as a source dataset (`●`)

**Export (R):**
```r
n <- 1000L
discount_rate <- 0.06
city <- "Munich"
start_date <- as.Date("2020-01-01")
treated <- TRUE
coeffs <- c(1.2, 0.8, -0.3)
mean_wage <- mean(df$wage)
```

**Export (Stata):**
```stata
scalar n = 1000
scalar discount_rate = 0.06
local city "Munich"
scalar treated = 1
matrix coeffs = (1.2, 0.8, -0.3)
summarize wage, meanonly
scalar mean_wage = r(mean)
```

Workspace saved per project in IndexedDB alongside the pipeline.

---

### 9.8 — Simulate Tab — PENDING

A **DGP (Data Generating Process) builder** for generating synthetic datasets in the browser.

**Interface:**
- `n` input (number of observations)
- `seed` input (for reproducibility)
- Variable builder table — each row defines one variable:
  ```
  Name     Distribution    Parameters           Role
  ─────────────────────────────────────────────────────
  X1       Normal          μ=0, σ=1             covariate
  X2       Uniform         min=0, max=10        covariate
  eps      Normal          μ=0, σ=0.5           error
  Y        Expression      2 + 1.5*X1 - 0.8*X2 + eps   outcome
  ```
- Distributions: Normal, Uniform, Bernoulli, Poisson, Exponential, t, Chi-squared
- Expression rows reference previously defined variables (ordered evaluation)
- "Generate" button → produces a real dataset → saves to Dataset Manager as a source dataset
- Re-generate re-runs with same seed (deterministic)

**Export** produces `set.seed()` + generation code in R/Python/Stata.

---

### 9.9 — Plot Exports and Style Presets — PENDING

All plots throughout the app (Explore, Model, Report) gain a consistent export button: `.jpg`, `.svg`, `.pdf`.

**Style presets** (selectable before export):
- Default (current dark theme)
- Journal (white background, serif axis labels, minimal gridlines — APA/AER style)
- Presentation (high contrast, larger fonts, bold lines)
- Minimal (no gridlines, no border, axis lines only)

Presets apply at export time — the in-app dark theme is unchanged.

**Implementation:** export functions render the plot into an offscreen canvas/SVG with the chosen style applied, then trigger a download. No external dependencies.

---

### 9.10 — AI Unified Script Export (Premium) — PENDING

Available only from `[ Report ]` tab. User selects one target language (R, Stata, or Python — not all three simultaneously).

**Input to AI:** deterministic section scripts from all tabs (Clean + Calculate + Explore + Model + Simulate), dataset dictionary, variable units, research question (from project metadata).

**Output:** one complete, documented, runnable script in the chosen language:
- Section headers (`# 1. Setup`, `# 2. Data Loading`, `# 3. Cleaning`, etc.)
- Inline comments explaining non-obvious transformations
- Steps reordered for logical flow (variable definitions before models, cleaning before estimation)
- Redundant intermediate assignments collapsed
- Plots excluded (replaced with a comment: `# See exported plots`)

**Model:** `claude-sonnet-4-6` (same as narratives — consistent cost tier). Single API call with all section scripts concatenated as user message. Cached `SHARED_CONTEXT` block applies.

**Premium gating:** the button is visible to all users but triggers an upgrade prompt for free-tier users.

---

### Phase 9 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/components/workspace/DatasetManager.jsx` | Scrollable session dataset registry, interaction log | PENDING |
| `src/components/workspace/WorkspaceBar.jsx` | 7-tab top navigation bar | PENDING |
| `src/components/tabs/DataTab.jsx` | Data loading, external fetchers, dataset preview | PENDING |
| `src/components/tabs/SimulateTab.jsx` | DGP builder, synthetic dataset generator | PENDING |
| `src/components/tabs/CalculateTab.jsx` | Variable workspace, as.data.frame creator | PENDING |
| `src/services/session/sessionState.js` | Session-level dataset registry + global pipeline store | PENDING |
| `src/pipeline/exporter.js` | Topological DAG traversal, per-step toR/toStata/toPython | PENDING |

### Phase 9 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/App.jsx` | Mount WorkspaceBar, route 7 tabs, thread sessionState context | PENDING |
| `src/DataStudio.jsx` | Integrate DatasetManager, move file upload to DataTab | PENDING |
| `src/pipeline/runner.js` | Add `datasetId` to step schema; expose `localPipeline` per dataset | DONE — field tagged in addStep (WranglingModule), documented in runner.js header |
| `src/pipeline/registry.js` | Add `toR`, `toStata`, `toPython` method stubs per step type | PENDING |
| `src/WranglingModule.jsx` | Become `CleanTab` — read active dataset from sessionState | PENDING |
| `src/ExplorerModule.jsx` | Become `ExploreTab` — read active dataset from sessionState | PENDING |
| `src/components/ModelingTab.jsx` | Read active dataset from sessionState; add tab-level export bar | PENDING |
| `src/ReportingModule.jsx` | Add AI unified script export button (premium) | PENDING |

### Phase 9 Build Order

Steps must be done in this order — each unlocks the next:

1. **`sessionState.js`** — dataset registry + global pipeline; the shared state all tabs depend on
2. **`WorkspaceBar.jsx` + `App.jsx` routing** — shell exists, tabs render existing modules
3. **`DatasetManager.jsx`** — dataset picker visible everywhere; active dataset selection works
4. **`runner.js` `datasetId` field** — each step tagged to a dataset; no behavior change yet
5. **`DataTab.jsx`** — move file upload + World Bank / OECD fetchers here
6. **`CalculateTab.jsx`** — variable workspace + `as.data.frame` creator
7. **`SimulateTab.jsx`** — DGP builder
8. **`exporter.js`** — DAG traversal, per-step export methods, section script generation
9. **Per-tab export bars** — wire exporter into each tab's R/Stata/Python buttons
10. **Plot style presets + .jpg/.svg/.pdf export** — last because it's self-contained
11. **AI unified script export** — depends on exporter (step 8) being complete

---

---

## Phase 10: Probability & Simulation Analytics — PENDING

Extends the already-built Calculate and Simulate tabs with probability functions, Monte Carlo, and output visualization. All math stays in `src/math/calcEngine.js` (pure JS, no React).

### Already done (do not re-implement)
- `solveRoot` (Brent's method), `derivative`, `nthDerivative`, `gradient`, `predict` — all in `calcEngine.js`
- ForLoop and WhileLoop variable types in `SimulateTab.jsx`
- Model prediction section (section 6) in `CalculateTab.jsx`

---

### 10.1 — Probability density and distribution functions in `calcEngine.js` — PENDING

Add to `calcEngine.js` (pure JS, no external dependency):

| Function | Signature | Algorithm |
|----------|-----------|-----------|
| `dnorm(x, mean, sd)` | PDF | `(1/σ√2π) exp(-½((x-μ)/σ)²)` |
| `pnorm(x, mean, sd)` | CDF | error function approximation (Abramowitz & Stegun 7.1.26) |
| `qnorm(p, mean, sd)` | quantile | rational approximation (Peter Acklam's algorithm) |
| `dt(x, df)` | t PDF | `Γ((ν+1)/2) / (√νπ Γ(ν/2)) (1 + x²/ν)^(-(ν+1)/2)` |
| `pt(x, df)` | t CDF | regularized incomplete beta: `I(ν/(ν+x²); ν/2, 1/2)` |
| `qt(p, df)` | t quantile | Newton refinement from rational seed |
| `dbinom(k, n, p)` | Binomial PMF | `C(n,k) pᵏ (1-p)^(n-k)` |
| `pbinom(k, n, p)` | Binomial CDF | sum over `j = 0..k` |
| `dpois(k, lambda)` | Poisson PMF | `λᵏ e^{-λ} / k!` |
| `ppois(k, lambda)` | Poisson CDF | sum over `j = 0..k` |
| `dchisq(x, df)` | Chi-sq PDF | gamma distribution special case |
| `pchisq(x, df)` | Chi-sq CDF | regularized incomplete gamma |

These functions become available as named functions inside **Calculate tab expression rows** (section 1 Expression type) and inside **Simulate tab Expression rows** — no new UI needed, just register them in `buildScope()` in `calcEngine.js`.

**Validation:** Compare to R outputs (`dnorm`, `pnorm`, `qnorm`, `pt`, `pbinom`, `ppois`) at 4 decimal places.

---

### 10.2 — Monte Carlo section in `SimulateTab.jsx` — PENDING

A new collapsible section below the DGP builder: **Monte Carlo Experiment**.

**Interface:**
```
Replications    [  1000  ]    Seed  [ 42 ]
Target variable  [ Y ▾ ]     (any scalar expression variable in the DGP)
[  Run Monte Carlo  ]
```

**Algorithm:**
1. Re-run the entire DGP `R` times, each time advancing the seed by +1
2. Collect the value of the target variable at each replication → array of length R
3. Output as a new dataset (rows = replications, columns = target variable + replication index)
4. Save to Dataset Manager via `onAddDataset`

**Output panel (shown after run):**
- Mean, SD, min, max, p5, p25, p50, p75, p95 of the collected distribution
- Inline histogram (50-bin) rendered via Observable Plot (same CDN pattern as PlotBuilder)

**Export:**
```r
set.seed(42)
mc_results <- replicate(1000, { ... dgp code ... })
hist(mc_results)
```

---

### 10.3 — Probability calculator panel in `CalculateTab.jsx` — PENDING

A new collapsible section: **Probability Calculator**. Form-based, no expression typing needed.

```
Distribution  [ Normal ▾ ]    μ = [  0  ]   σ = [  1  ]

P(X ≤ x)    x = [  1.96  ]   →   0.9750
P(X ≥ x)    x = [  1.96  ]   →   0.0250
P(a ≤ X ≤ b)  a = [  -1  ]  b = [  1  ]   →   0.6827
Quantile     p = [  0.95  ]  →   1.6449
```

Distributions available: Normal, t (df input), Binomial (n, p inputs), Poisson (λ input), Chi-squared (df input).

Updates live as inputs change (no "run" button). Calls the functions from 10.1.

---

### Phase 10 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| — | No new files — all additions extend existing files | — |

### Phase 10 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/math/calcEngine.js` | Add `dnorm`, `pnorm`, `qnorm`, `dt`, `pt`, `qt`, `dbinom`, `pbinom`, `dpois`, `ppois`, `dchisq`, `pchisq`; register in `buildScope()` | PENDING |
| `src/components/tabs/SimulateTab.jsx` | Add Monte Carlo section (10.2) | PENDING |
| `src/components/tabs/CalculateTab.jsx` | Add Probability Calculator section (10.3) | PENDING |

---

## Phase 11: Spatial Analytics — PENDING

Browser-side spatial toolkit for research workflows common in development economics, urban economics, and policy evaluation: geocoding, distance-to-treatment, buffer indicators, grid assignment, and spatial joins.

All math in a new pure-JS engine `src/math/SpatialEngine.js`. Pipeline integration follows the existing runner.js pattern. UI lives in a new **Spatial** section of the wrangling FeatureTab.

---

### 11.1 — `src/math/SpatialEngine.js` — PENDING

Pure JS, no external dependencies. Exports:

**Distance functions:**
```js
haversine(lat1, lon1, lat2, lon2)  → distance in km
euclidean(x1, y1, x2, y2)         → distance in projected units
```
Haversine formula: `a = sin²(Δφ/2) + cos φ₁ cos φ₂ sin²(Δλ/2)`, `d = 2R arcsin(√a)`, R = 6371 km.

**Buffer:**
```js
isWithinBuffer(lat, lon, centerLat, centerLon, radiusKm)  → boolean
assignBuffer(rows, latCol, lonCol, centerLat, centerLon, radiusKm, outCol)  → rows[]
```
Uses haversine. Output column is 0/1 integer (ready for use as treatment indicator).

**Grid assignment:**
```js
assignRectGrid(rows, latCol, lonCol, cellSizeKm, outCol)  → rows[]
assignH3Grid(rows, latCol, lonCol, resolution, outCol)    → rows[]  // H3-like hex IDs
```
Rectangular: floor(lat / latStep) × floor(lon / lonStep) → integer cell ID. H3-like: approximate hexagonal grid using axial coordinates at given resolution.

**Spatial join (point-in-polygon):**
```js
pointInPolygon(lat, lon, polygonWKT)  → boolean
spatialJoin(pointRows, latCol, lonCol, polyRows, wktCol, joinCols[])  → rows[]
```
Ray-casting algorithm for WKT polygon strings (from `.shp` parser output). `spatialJoin` does a left join — each point row gets attribute columns from the first matching polygon.

**Nearest neighbor:**
```js
nearestNeighbor(rows, latCol, lonCol, referenceRows, refLatCol, refLonCol, outDistCol, outIdCol)  → rows[]
```
For each observation finds the closest point in a reference set and returns the distance and ID. Brute-force O(n×m) — acceptable up to ~10k × ~1k.

---

### 11.2 — Geocoding pipeline step — PENDING

New step type `geocode` in `runner.js` and `registry.js`.

**Step schema:**
```js
{ type: "geocode", addressCol: string, latOutCol: string, lonOutCol: string, provider: "nominatim" }
```

**Algorithm:**
- Calls OpenStreetMap Nominatim API (`https://nominatim.openstreetmap.org/search?q=...&format=json`)
- Rate-limited: 1 request per second (Nominatim ToS)
- Results cached in `sessionStorage` keyed by address string — avoids re-fetching on pipeline replay
- Skips rows where `addressCol` is empty or already geocoded (cache hit)
- Adds `latOutCol` and `lonOutCol` as new columns (null if geocoding failed)

**UI in FeatureTab (new "Spatial" subsection):**
```
Address column  [ country_name ▾ ]
Lat column name  [ lat ]
Lon column name  [ lon ]
Provider  [ OpenStreetMap (free) ]
[ Geocode column ]   — progress bar during batch geocoding
```

Warning shown: "Geocoding sends address data to OpenStreetMap. Do not use with sensitive or personal addresses."

---

### 11.3 — Distance, buffer, and grid pipeline steps — PENDING

Four new step types in `runner.js` / `registry.js`:

**`distance` step:**
```js
{ type: "distance", latCol, lonCol, refLat: number, refLon: number, outCol, unit: "km"|"m" }
```
Computes haversine distance from each row to a fixed reference point (e.g. capital city, policy center). UI: lat/lon inputs for reference point, or "pick from dataset" dropdown to use a filtered row as reference.

**`buffer` step:**
```js
{ type: "buffer", latCol, lonCol, refLat: number, refLon: number, radiusKm: number, outCol }
```
Outputs 0/1 column. UI: reference point + radius slider (1–500 km).

**`assign_grid` step:**
```js
{ type: "assign_grid", latCol, lonCol, gridType: "rectangular"|"hex", cellSizeKm: number, outCol }
```
Outputs a string grid cell ID. Suitable as a fixed effect variable. UI: grid type toggle + cell size input + preview count of distinct cells.

**`spatial_join` step:**
```js
{ type: "spatial_join", latCol, lonCol, rightDatasetId, wktCol, joinCols: string[] }
```
Joins polygon attributes from a shapefile dataset. Right dataset must have a WKT geometry column (from `.shp` parser). UI: polygon dataset dropdown, WKT column auto-detected, columns to join multi-select.

---

### 11.4 — Spatial UI in FeatureTab — PENDING

New collapsible "Spatial" section at the bottom of `FeatureTab.jsx`, below the existing "Interactions" section.

Contains five sub-panels (each collapsed by default):
1. **Geocode** — address column → lat/lon (wires step 11.2)
2. **Distance to point** — lat/lon + reference → distance column (wires `distance` step)
3. **Buffer indicator** — lat/lon + reference + radius → 0/1 column (wires `buffer` step)
4. **Grid assignment** — lat/lon + cell size → grid ID column (wires `assign_grid` step)
5. **Spatial join** — lat/lon + polygon dataset → attribute columns (wires `spatial_join` step)

Each sub-panel follows the existing FeatureTab pattern: form inputs → "Add to pipeline" button → step appears in History.jsx.

---

### 11.5 — Map view in PlotBuilder — PENDING

New geom type `map` in `PlotBuilder.jsx`.

When `map` geom is selected:
- X mapping locked to `lon`, Y mapping locked to `lat`
- Renders as a scatter plot with aspect ratio locked to `cos(mean_lat)` (Mercator approximation)
- Color, size aesthetic mappings still available
- Optional: basemap tiles toggle (uses OpenStreetMap tile CDN `https://tile.openstreetmap.org/{z}/{x}/{y}.png` — shown only if user enables it, with a privacy notice)

No new dependencies — Observable Plot handles the scatter rendering; tile layer is an optional `<img>` underlay positioned via CSS transform if enabled.

---

### Phase 11 New Files Summary

| File | Purpose | Status |
|------|---------|--------|
| `src/math/SpatialEngine.js` | Haversine, buffer, grid, point-in-polygon, nearest neighbor | DONE |

### Phase 11 Modified Files Summary

| File | Changes | Status |
|------|---------|--------|
| `src/pipeline/runner.js` | Add `geocode`, `distance`, `buffer`, `assign_grid`, `spatial_join` step types | DONE |
| `src/pipeline/registry.js` | Register 5 new step types with labels and param schemas | DONE |
| `src/components/wrangling/FeatureTab.jsx` | Add Spatial section with 5 sub-panels | DONE |
| `src/components/PlotBuilder.jsx` | Add `map` geom type with locked lat/lon axes and tile option | PENDING |

### Phase 11 Build Order

1. **`SpatialEngine.js`** — pure math, no UI, validates independently
2. **`runner.js` + `registry.js`** — wire 4 deterministic steps (distance, buffer, grid, spatial_join) — no network, testable offline
3. **`FeatureTab.jsx` Spatial section** — UI for all 4 deterministic steps
4. **Geocode step** — last because it requires network + rate limiting + cache logic
5. **PlotBuilder `map` geom** — self-contained, can ship independently of geocoding

---

## Phase 12: Excel-style Cell Editing — PENDING

Inline cell editing directly in the DataViewer grid. Edits are non-destructive: each committed change becomes a `patch` pipeline step (already implemented in `runner.js` and `registry.js`), so all downstream transforms (mutate, log, etc.) automatically reflect the new value.

### Infrastructure already in place (do not re-implement)
- `patch` step type in `runner.js` and `registry.js` — matches row by `__ri`, sets column value
- `__ri` stable row ID — assigned at load time in `DataStudio.ensureRowIds`, survives filter/sort/rename
- `addPatchStep(ri, col, value)` exposed via `DataStudio` `useImperativeHandle`
- `addStepRef` / `wranglingAddStepRef` bridge from DataStudio → WranglingModule
- History.jsx collapsible "Cell edits (N)" group with per-item remove and bulk "clear" button
- `clearPatches` in WranglingModule
- `✎ edit cells` toggle button in DataViewer toolbar (gates editing behind explicit activation)
- `isEditing` guard: `editingCell != null && row.__ri != null && editingCell.ri === row.__ri && editingCell.col === h`
- runner.js patch guard: `s.ri != null` — prevents stale `ri:undefined` step from nuking all rows
- DataStudio sync useEffect fix: `ensureRowIds` applied in both `newFile` and `else` branches

### What is NOT working (as of 2026-05-04)
Double-click to edit fails silently — the input either does not appear or does not receive focus. Root cause not yet identified despite multiple approaches:
- `autoFocus` on input
- `requestAnimationFrame` + `useRef` focus
- `onMouseDown` + `e.preventDefault()` (removed — suspected to suppress dblclick in some browsers)

### Recommended next approach
Use a **native DOM event listener** on the table container instead of React's `onDoubleClick` synthetic event, to rule out synthetic event system issues:

```js
const tbodyRef = useRef(null);
useEffect(() => {
  if (!editMode) return;
  const handler = e => {
    const td = e.target.closest('td[data-ri]');
    if (!td) return;
    const ri = Number(td.dataset.ri);
    const col = td.dataset.col;
    const val = td.dataset.val ?? "";
    startEdit(ri, col, val);
  };
  tbodyRef.current?.addEventListener('dblclick', handler);
  return () => tbodyRef.current?.removeEventListener('dblclick', handler);
}, [editMode]);
```

Each `<td>` gets `data-ri={row.__ri} data-col={h} data-val={row[h]}`. The `<tbody>` gets `ref={tbodyRef}`.

### Script export (also PENDING)
`src/services/export/rScript.js`, `pythonScript.js`, `stataScript.js` must emit `patch` steps as language-appropriate cell assignment statements before the main pipeline chain:
- R: `df[df$__ri == 47, "wage"] <- 1500`
- Python: `df.loc[df['__ri'] == 47, 'wage'] = 1500`
- Stata: `replace wage = 1500 if __ri == 47`

---

---

## Phase 13: Project Isolation & User Authentication — PENDING

Pre-condition for the web launch. Two distinct problems: (1) projects are not properly scoped — files loaded inside one project can leak into the project list as separate projects, and (2) there is no user identity, so the app is single-user only.

---

### 13.1 — Project Isolation Fix — DONE

**Current bug:** when a user loads multiple datasets inside a project, each file may create a top-level project entry rather than being scoped as a dataset within the current project. The project picker on the home screen shows file names instead of project names.

**Root cause area:** `DataStudio.jsx` — project creation on file upload; `App.jsx` — project list reading from IndexedDB.

**Fix:**
- Enforce that a **project** is created only when the user explicitly names and creates one (or on first load).
- All `onAddDataset` calls within an active project scope to `pid` — never create a new `pid`.
- The `App.jsx` project list reads `project.name` (user-set), not `dataset.filename`.
- If no project name is set, default to `"Untitled project — YYYY-MM-DD"`.
- IndexedDB schema: `projects` store keyed by `pid` with `{ pid, name, createdAt, updatedAt }`. Datasets and pipelines reference `pid`, never appear as project entries.

**Files modified:**
| File | Change | Status |
|------|--------|--------|
| `src/App.jsx` | Dashboard reads `listProjects()`; migration from pipelines; rename in-place; `handleReady` calls `saveProject` | DONE |
| `src/WranglingModule.jsx` | On pipeline save, also calls `saveProject` for primary pids (starts with "proj_") | DONE |
| `src/services/Persistence/indexedDB.js` | v3 — `projects` store; `saveProject`, `listProjects`, `deleteProject`, `clearAllProjects` | DONE |

---

### 13.2 — User Authentication — PENDING

**Backend choice: Supabase** — open-source, free tier covers the test launch, has auth + PostgreSQL + row-level security. No custom server needed to ship v0.1.

**Auth flows:**
- Email + password (primary)
- Magic link (secondary, lower friction for academic users)
- Google OAuth (optional — adds adoption for non-LMU users)

**Privacy-first constraint:** dataset content **never leaves the browser**. Only the following is stored server-side:
- `user_id`, email, `created_at`
- Project metadata: `{ pid, name, created_at, updated_at }`
- Pipeline steps (JSON, no raw data): `{ pid, pipeline[] }` — enables cross-device project resume without uploading data

**Implementation:**
- Install `@supabase/supabase-js` (CDN import to avoid bundle size — same pattern as Leaflet/Observable Plot)
- `src/services/auth/authService.js` — wraps Supabase auth: `signUp`, `signIn`, `signOut`, `getSession`, `onAuthStateChange`
- `src/services/auth/AuthContext.jsx` — React context: `{ user, session, loading }`, available app-wide
- `src/components/auth/AuthGate.jsx` — renders login/signup UI if no session; renders `<App>` if authenticated
- `src/components/auth/LoginForm.jsx` — email + password form with "send magic link" toggle; IBM Plex Mono, dark theme
- `src/components/auth/SignupForm.jsx` — name, email, password, institution (optional — useful for LMU targeting)

**Session persistence:** Supabase SDK handles token refresh automatically. `AuthContext` initializes on mount by calling `supabase.auth.getSession()`.

**Supabase tables (RLS enforced — users only see their own rows):**
```sql
projects (pid text PK, user_id uuid FK, name text, created_at timestamptz, updated_at timestamptz)
pipelines (pid text FK, steps jsonb, updated_at timestamptz)
```
Datasets are never stored in Supabase — they remain in the user's IndexedDB, keyed by `pid`.

**New files:**
| File | Purpose |
|------|---------|
| `src/services/auth/authService.js` | Supabase auth wrapper |
| `src/services/auth/AuthContext.jsx` | React auth context provider |
| `src/components/auth/AuthGate.jsx` | Auth guard wrapping App |
| `src/components/auth/LoginForm.jsx` | Login UI |
| `src/components/auth/SignupForm.jsx` | Signup UI |

**Modified files:**
| File | Change |
|------|--------|
| `src/App.jsx` | Wrap with `<AuthGate>` |
| `src/DataStudio.jsx` | Attach `user_id` to projects; sync pipeline to Supabase on save |
| `src/services/Persistence/indexedDB.js` | Add project store; `listProjects` scoped to current user |

---

### 13.3 — Tier & Access Control — PENDING

Three tiers for the initial launch:

| Tier | Price | Limits | Notes |
|------|-------|--------|-------|
| **Free** | €0 | 3 projects, no AI features, no export scripts | For onboarding and testing |
| **Researcher** | €19/mo | Unlimited projects, full AI, all exports | Individual academic users |
| **Institution** | €499/seat-yr | All Researcher features + team projects + priority support | LMU department licensing target |

Tier stored on Supabase in `users.tier` column. Checked client-side (gated in `AuthContext`) — not security-critical for v0.1 since the product is client-side anyway. Proper server-side enforcement comes in v0.2.

**Premium gates (v0.1):**
- AI narrative interpretation → Researcher+
- AI unified script export → Researcher+
- More than 3 projects → Researcher+

Gate implementation: thin `usePremium()` hook returning `{ canUse: bool, showUpgrade: fn }`. Upgrade prompt is a modal with "Email us" CTA for v0.1 (no Stripe yet).

---

### Phase 13 Build Order

1. **`indexedDB.js` project store** — adds `projects` object store without breaking existing data
2. **Project isolation fix** (`App.jsx` + `DataStudio.jsx`) — testable locally before auth
3. **Supabase project setup** — create project, configure RLS, get API keys
4. **`authService.js` + `AuthContext.jsx`** — auth logic, no UI yet
5. **`LoginForm.jsx` + `SignupForm.jsx`** — auth UI
6. **`AuthGate.jsx` + wire into `App.jsx`** — gate the whole app
7. **Pipeline sync to Supabase** — on save, write pipeline JSON to `pipelines` table
8. **Tier gates** — `usePremium()` hook, upgrade modal

---

## Phase 14: Web Launch (v0.1 Public Beta) — PENDING

**Goal:** a hosted URL to share with test users (friends, thesis group, LMU contacts). Fast feedback loop. Not production — some rough edges expected.

---

### 14.1 — Frontend Deployment — PENDING

**Host: Vercel** (free tier, auto-deploy from main branch, CDN-edge delivery).

- `vite.config.js` already configured for React; just needs `vercel.json` with SPA fallback:
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
  ```
- Environment variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ANTHROPIC_KEY`
  - Anthropic key: user supplies their own for v0.1 (entered in app settings, stored in `sessionStorage` — never logged or sent to our backend)
  - For v0.2: proxy all Anthropic calls through a serverless function (removes key exposure)
- Custom domain: `app.litux.io` (or similar — TBD)

**New files:**
| File | Purpose |
|------|---------|
| `vercel.json` | SPA rewrite rule |
| `.env.example` | Document all required env vars |

---

### 14.2 — Anthropic Key Handling for Web — PENDING

**v0.1 approach (fast):** user enters their own Anthropic API key in a Settings modal. Key stored in `sessionStorage` only — cleared on tab close.

**Settings modal** (`src/components/SettingsModal.jsx`):
- API key input (password type) + "Test connection" button
- Privacy notice: "Your key is stored only in this browser tab's session memory. It is never sent to our servers."
- Persistent across the session (re-enter on each browser session)

**`AIService.js` change:** read API key from `sessionStorage` instead of hardcoded env var, with a fallback to `import.meta.env.VITE_ANTHROPIC_KEY` for local development.

**v0.2 approach (proper):** serverless proxy on Vercel (`/api/claude`) — Anthropic key lives server-side, never exposed to browser. Users authenticate with their Econ Studio session token to call the proxy. This enables Researcher tier metering (track token usage per user).

---

### 14.3 — Landing Page & Marketing Site — PENDING

**Separate from the app.** Hosted at `litux.io` (root domain). Built with the same Vite + React stack but as a standalone page — no app logic, no Supabase dependency.

**Sections:**
1. **Hero** — headline + subheadline + "Request early access" CTA (email capture)
   - Headline: *"Research-grade econometrics. No code required."*
   - Subheadline: *"The tool PhD students and policy analysts use to go from raw data to publication-ready results — entirely in the browser."*

2. **Feature highlights** — 3 cards:
   - *Estimation suite* — OLS, IV, RDD, DiD, FE, Synthetic Control with validated math
   - *Spatial analytics* — Maps, grid construction, buffer analysis, choropleth from shapefiles
   - *Replication export* — One-click R, Python, Stata scripts from every analysis

3. **Who it's for** — PhD students · Thesis students · Policy analysts · Research assistants

4. **How it works** — 3 steps: Load data → Build pipeline → Estimate + export

5. **Privacy first** — *"Your data never leaves your browser. All computation is client-side."*

6. **Early access form** — email + institution + use case (3 fields, submits to Supabase `waitlist` table or Airtable)

7. **Footer** — links, LMU affiliation note, contact email

**Design:**
- Same IBM Plex Mono + dark theme as the app (brand consistency)
- Accent: teal `#6ec8b4` for CTAs, gold `#c8a96e` for feature badges
- Background: near-black `#080808`
- No stock photos — code/plot screenshots from actual app only

**New files:**
| File | Purpose |
|------|---------|
| `landing/index.html` | Standalone landing page (separate Vite app or `public/index.html` at root domain) |
| `landing/App.jsx` | Landing page component |
| `landing/sections/` | Hero, Features, HowItWorks, Privacy, EarlyAccess, Footer components |

---

### 14.4 — Feedback Collection — PENDING

Built into the app for v0.1 beta users. Lightweight — no external service needed.

- **"Send feedback" button** in the app header (top-right, always visible)
- Opens a small modal: text area + category dropdown (Bug / Feature request / Question / Other) + optional email field
- Submits to `feedback` table in Supabase
- No AI processing — just stored as raw text for Franco to review

**New file:** `src/components/FeedbackModal.jsx`

---

### Phase 14 Build Order

1. **`vercel.json` + env vars** — deploy the current app to Vercel (no auth yet — just confirms it builds)
2. **`SettingsModal.jsx` + APIkey sessionStorage** — unblocks AI for web users
3. **Landing page** — parallel work, independent of app code
4. **`FeedbackModal.jsx`** — quick win, high value for beta feedback
5. **Auth (Phase 13) integration** — add login gate once landing page is live
6. **Custom domain** — point `app.litux.io` at Vercel deployment

---

## Phase 15: Local Installable Version — PENDING

**Prerequisite:** web version is validated (Phase 14). The local version is the web app packaged as a desktop app with offline support.

**Goal:** users install once, get offline access, and the app auto-updates from the hosted version. No cloud sync required — all data stays local in IndexedDB.

---

### 15.1 — Tauri Packaging — PENDING

**Why Tauri over Electron:**
- ~10× smaller binary (no bundled Chromium — uses system WebView)
- Rust backend gives native file system access (load local `.csv`, `.dta`, `.shp` directly from disk — no drag-and-drop required)
- Auto-update via `tauri-plugin-updater` pointing to GitHub Releases

**Implementation:**
- Add `src-tauri/` directory with standard Tauri scaffold (`tauri.conf.json`, `Cargo.toml`, `main.rs`)
- `tauri.conf.json` build target: `src/` (existing Vite app), no changes to React code needed
- Rust commands exposed to frontend:
  - `read_file(path) → ArrayBuffer` — for loading files from arbitrary disk paths
  - `list_recent_files() → string[]` — MRU list for the Data tab "Open recent" feature
- `src/services/data/fileLoader.js` — detects Tauri (`window.__TAURI__`) and uses `invoke("read_file", { path })` instead of `<input type="file">`

**Auto-update strategy:**
- Tauri updater polls `https://litux.io/releases/latest.json` on startup
- `latest.json` is a static file updated on every Vercel deploy (via a Vercel build hook that writes the file to the CDN)
- Update dialog: *"A new version is available. Update now or later."* — inline, non-blocking

**New files:**
| File | Purpose |
|------|---------|
| `src-tauri/` | Full Tauri scaffold (generated by `cargo tauri init`) |
| `src/services/data/fileLoader.js` | Abstraction: web file input vs Tauri `read_file` command |

**Modified files:**
| File | Change |
|------|--------|
| `vite.config.js` | Add Tauri dev server config (`server.port = 1420`, `clearScreen = false`) |
| `src/DataStudio.jsx` | Use `fileLoader.js` instead of direct `<input>` for file loading |

---

### 15.2 — Offline AI Fallback — PENDING

When the user is offline (no internet) or has no Anthropic key set, AI features degrade gracefully:
- AI narrative → replaced by a deterministic template-based summary (uses `LocalAI.js`, already exists)
- AI unit inference → falls back to column name heuristics (already in codebase)
- AI coaching → shows rule-based signals only (already in `coachingTriggers.js`)

No new code required — just ensure the error handling in `AIService.js` falls through to `LocalAI.js` on network failure.

---

### 15.3 — Build & Release Pipeline — PENDING

**GitHub Actions workflow** (`releases.yml`):
1. On push to `main`: run `vite build`, deploy to Vercel (web version)
2. On tag `v*.*.*`: additionally run `cargo tauri build`, upload binaries to GitHub Releases (macOS `.dmg`, Windows `.msi`, Linux `.AppImage`)
3. After binaries upload: write `latest.json` to the CDN (triggers auto-update check in installed apps)

**New files:**
| File | Purpose |
|------|---------|
| `.github/workflows/deploy.yml` | Vercel deploy on push to main |
| `.github/workflows/releases.yml` | Tauri build + GitHub release on version tag |

---

### Phase 15 Build Order

1. **Tauri scaffold** — `cargo tauri init`; confirm app loads in Tauri WebView
2. **`fileLoader.js`** — abstract file loading; no behavior change on web
3. **`vite.config.js` Tauri dev mode** — `npm run tauri dev` works
4. **Rust `read_file` command** — enables drag-to-path and "Open recent"
5. **Auto-update config** — `tauri.conf.json` updater section + `latest.json` endpoint
6. **GitHub Actions** — deploy + release workflows
7. **Offline AI fallback** — verify `LocalAI.js` is called correctly on `fetch` error

---

## Overall Status Summary (last updated 2026-05-04)

| Phase | Title | Status |
|-------|-------|--------|
| 1 | Standardised Estimation Result | DONE |
| 2 | Advanced Context-Aware AI Coach | DONE |
| 3 | Multi-Model Comparison System | DONE |
| 4 | Integration | IN PROGRESS |
| 5 | New Estimators | DONE |
| 6 | Robust Standard Errors | DONE |
| 7 | New File Format Support | DONE |
| 8 | Modeling UI Overhaul | DONE |
| 9 | Workspace Architecture | DONE |
| 10 | Probability & Simulation Analytics | IN PROGRESS (10.1 done) |
| 11 | Spatial Analytics | IN PROGRESS (11.1–11.5 done) |
| 12 | Excel-style Cell Editing | PENDING — double-click focus bug |
| 13 | Project Isolation & User Auth | IN PROGRESS (13.1 done) |
| 14 | Web Launch v0.1 Beta | PENDING — blocked on 13 |
| 15 | Local Installable Version (Tauri) | PENDING — blocked on 14 validation |

---

## Next unblocked tasks

1. **Browser validation of Phase 4** — pin 3 models (OLS, FE, 2SLS), open ModelComparison, verify stargazer table shows 3 columns, AI narrative references all three, all three multi-model export scripts (R/Python/Stata) generate correctly.

2. **Phase 9 remaining** — ~~cascade delete dialog in DatasetManager~~ (DONE), ~~`runner.js` datasetId field~~ (DONE), ~~AI unified script export in Report tab~~ (DONE — `AIUnifiedScript` collapsible in ReportingModule, calls `generateUnifiedScript` via AIService).

3. **Phase 10.1** — add probability functions (`dnorm`, `pnorm`, `qnorm`, `dt`, `pt`, `qt`, `dbinom`, `pbinom`, `dpois`, `ppois`) to `calcEngine.js` and register in `buildScope()`. Unblocks 10.2 and 10.3.

4. **Phase 13.1** — fix project isolation bug. Fast, no dependencies, unblocks auth.

5. **Phase 13.2** — Supabase auth. Unblocks web deployment.

6. **Phase 12** — Excel-style cell editing. Infrastructure complete; blocker is double-click → focus handoff. Use native DOM listener on `<tbody>` — see Phase 12 notes above.
