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
