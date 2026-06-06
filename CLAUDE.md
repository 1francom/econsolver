# CLAUDE.md — Econ Studio

## What this project is
Browser-based econometrics research platform. Privacy-first, GUI-driven alternative to R and Stata. Runs entirely client-side. Target users: PhD students, thesis students, and policy analysts at LMU Munich and affiliated think tanks. The tool covers the full research workflow — data wrangling, causal estimation, and publication-ready output — in one interface. Institutional licensing is the go-to-market (department-level contracts).

Stack: React + Vite + JavaScript. No external UI libraries. Styling via inline styles using the `C` color constants object (dark/teal/gold scheme). IBM Plex Mono typography.

## Architectural invariants — never violate these
- **Non-destructive pipeline**: steps always replay on `rawData`, never mutate in place. `runner.js` is the source of truth.
- **Zero React in math files**: `src/math/` and `src/core/` are pure JS, no imports from React or UI.
- **Single API egress choke point**: all Anthropic calls go through `AIService.js`. Never add raw `fetch` to the Anthropic API elsewhere.
- **Prompt caching**: `callClaude()` in `AIService.js` sends `SHARED_CONTEXT` as a cached block (`cache_control: {type:"ephemeral"}`). Header `"anthropic-beta": "prompt-caching-2024-07-31"` must be present on every call.
- **IndexedDB, not localStorage**: persistence is in `services/persistence/indexedDB.js`. localStorage is deprecated for pipeline/data storage.
- **SE type is always passed explicitly to engines — never hardcoded inside engine functions**: every engine accepts an optional `seType` argument (`"classical" | "HC1" | "HC2" | "HC3" | "clustered" | "twoway" | "HAC"`). The default is `"classical"` for backward compatibility. Engines must not assume a SE variant internally.

## File structure (current state)
```
src/
├── math/
│   ├── index.js                    ← single barrel export for all engines
│   ├── LinearEngine.js             ← OLS, WLS, matrix algebra, diagnostics, export helpers
│   ├── PanelEngine.js              ← FE, FD, TWFE, 2x2 DiD, EventStudy, LSDV
│   ├── CausalEngine.js             ← 2SLS/IV, Sharp RDD, Fuzzy RDD, McCrary density test, IK bandwidth
│   ├── NonLinearEngine.js          ← Logit/Probit, IRLS/Newton-Raphson MLE, McFadden R², MEM, PoissonFE
│   ├── GMMEngine.js                ← GMM, LIML
│   ├── SyntheticControlEngine.js   ← Frank-Wolfe synthetic control, placebo inference
│   ├── SpatialEngine.js            ← haversine/euclidean, buffer assign, grid assign (rect+H3), spatial join, nearest-neighbor
│   ├── timeSeries.js               ← time series utilities
│   ├── ModelHypothesis.js          ← post-estimation coefficient/effect hypothesis tests + R/Python/Stata snippet generator
│   ├── SampleTests.js              ← pre-model sample tests: one-sample mean t, variance χ², generic parameter t/z
│   ├── EstimationResult.js         ← shared result type for all engines
│   └── __validation__/
│       ├── README.md
│       └── engineValidation.js     ← systematic R comparison harness
│
├── core/
│   ├── diagnostics/
│   │   ├── heteroskedasticity.js   ← Breusch-Pagan, White
│   │   ├── autocorrelation.js      ← Durbin-Watson, Breusch-Godfrey
│   │   ├── normality.js            ← Jarque-Bera, Shapiro-Wilk
│   │   └── multicollinearity.js    ← VIF, condition number
│   ├── inference/
│   │   └── robustSE.js             ← HC0/HC1/HC2/HC3, clustered, two-way CGM, Newey-West HAC
│   └── validation/
│       ├── dataQuality.js          ← missing patterns, outlier flags, type consistency
│       ├── coachingTriggers.js     ← triggers for ResearchCoach suggestions
│       └── metadataExtractor.js    ← extracts variable metadata for AI context
│
├── pipeline/
│   ├── runner.js       ← applyStep + runPipeline — 23 step types
│   ├── validator.js    ← validatePanel, buildInfo
│   ├── registry.js     ← STEP_REGISTRY (must stay in sync with runner.js)
│   ├── auditor.js      ← auditPipeline → AuditTrail + markdown
│   └── stepValidator.js ← validateAISteps (registry-checked validation of AI-emitted steps)
│
├── services/
│   ├── AI/
│   │   ├── AIService.js          ← callClaude (exported), inferVariableUnits, interpretRegression, nlToPipeline
│   │   ├── appCapabilityMap.js   ← serializeAllowedSteps (NL step catalogue) + APP_CAPABILITY_MAP/serializeCapabilityMap (app structure for the coach)
│   │   ├── LocalAI.js            ← local/offline AI fallback
│   │   └── Prompts/
│   │       └── index.js          ← SHARED_CONTEXT, INFER_UNITS_PROMPT, INTERPRET_REGRESSION_PROMPT,
│   │                                WRANGLING_TRANSFORM_PROMPT, WRANGLING_QUERY_PROMPT,
│   │                                CLEANING_SUGGESTIONS_PROMPT, NL_TO_PIPELINE_PROMPT
│   ├── session/
│   │   ├── sessionState.jsx      ← React Context dataset registry (SessionStateProvider, useSessionState)
│   │   └── sessionLog.jsx        ← React Context cross-module operation log (SessionLogProvider, useSessionLog)
│   ├── Privacy/
│   │   ├── index.js              ← privacy module barrel export
│   │   ├── anonymizer.js         ← data anonymization utilities
│   │   ├── piiDetector.js        ← PII detection
│   │   ├── privacyFilter.js      ← filter sensitive data before AI calls
│   │   └── PrivacyConfigPanel.jsx ← privacy settings UI
│   ├── data/
│   │   ├── parsers/
│   │   │   ├── stata.js          ← .dta parser via readstat-wasm
│   │   │   ├── rds.js            ← XDR binary R serialization reader (data.frame, tibble, named list)
│   │   │   └── shapefile.js      ← dBase III DBF parser + SHP geometry WKT
│   │   └── fetchers/
│   │       ├── worldBank.js      ← World Bank API fetcher
│   │       └── oecd.js           ← OECD API fetcher
│   ├── export/
│   │   ├── rScript.js            ← pipeline + model → R script (fixest/modelsummary); generateSubsetRScript() for multi-subset lapply export
│   │   ├── stataScript.js        ← pipeline + model → Stata do-file; generateSubsetStataScript() with preserve/restore blocks
│   │   ├── pythonScript.js       ← pipeline + model → Python script; generateSubsetPythonScript() dict+comprehension pattern
│   │   └── replicationBundle.js  ← ZIP bundle (R + Stata + Python scripts + data); buildMultiSubsetBundle() + downloadMultiSubsetBundle()
│   ├── Persistence/
│   │   ├── indexedDB.js          ← loadPipeline, savePipeline, saveRawData, migrateFromLocalStorage; coach_chats store; v9 model_buffer + spatial_maps stores (save/load/delete per project; cascade on deleteProject)
│   │   └── trimResult.js         ← shared comparison-sufficient EstimationResult projection (modelBuffer + sessionSnapshot)
│   └── modelBuffer.js            ← model buffer state management
│
├── components/
│   ├── wrangling/
│   │   ├── shared.jsx            ← C, mono, Lbl, Tabs, Btn, Badge, Grid
│   │   ├── utils.js              ← lsGet/lsSave (deprecated), fuzzyGroups, callAI, audit
│   │   ├── History.jsx           ← pipeline sidebar with undo/redo
│   │   ├── ExportMenu.jsx        ← CSV + pipeline.json export
│   │   ├── CleanTab.jsx          ← NormalizePanel, FilterBuilder, FillNaSection
│   │   ├── PanelTab.jsx          ← heatmap + panel declaration
│   │   ├── FeatureTab.jsx        ← transforms: log, sq, z-score, winsorize, lag/lead, dates; Formatting tab (Numbers+Strings merged)
│   │   ├── ReshapeTab.jsx        ← pivot_longer, group_summarize
│   │   ├── DictionaryTab.jsx     ← AI inference + manual edit
│   │   ├── MergeTab.jsx          ← LEFT/INNER JOIN + APPEND
│   │   ├── DataQualityReport.jsx
│   │   ├── NLCommandBar.jsx      ← AI command bar: NL → validated pipeline steps (preview/apply); mounted by WranglingModule
│   │   ├── WorldBankFetcher.jsx  ← World Bank data fetch UI
│   │   ├── OECDFetcher.jsx       ← OECD data fetch UI
│   │   └── SubsetManager.jsx     ← multi-subset workflow UI
│   │
│   ├── modeling/
│   │   ├── shared.jsx            ← VarPanel, Section, Chip, C, mono (modeling-specific)
│   │   ├── EstimatorSidebar.jsx  ← grouped "Choose Model" dropdown
│   │   ├── VariableSelector.jsx  ← Y, X, W selectors
│   │   ├── ModelConfiguration.jsx ← estimator-specific config (Z instruments, DiD, RDD, WLS weights, SC config); setXVars destructured in props
│   │   ├── ModelPlots.jsx        ← RDDPlot, DiDPlot, EventStudyPlot, FirstStagePlot, ROC, etc.
│   │   ├── ResidualPlots.jsx     ← ResidualVsFitted, QQPlot
│   │   ├── DiagnosticsPanel.jsx  ← heteroskedasticity, autocorrelation, normality tests UI
│   │   ├── ModelBufferBar.jsx    ← model buffer / compare bar
│   │   ├── ModelComparison.jsx   ← side-by-side model comparison table
│   │   ├── ResearchCoach.jsx     ← AI-driven research coaching suggestions
│   │   ├── InferenceOptions.jsx  ← collapsible SE type selector (chips + cluster/lag inputs)
│   │   ├── CodeEditor.jsx        ← collapsible replication code viewer/editor: R / Python / Stata tabs
│   │   └── CoefficientTestPanel.jsx ← post-estimation hypothesis test on a pinned model's coefficients (below Predict from Model)
│   │
│   ├── tabs/
│   │   ├── CalculateTab.jsx      ← calculator tab; HintBox with calculator tips
│   │   ├── SimulateTab.jsx       ← simulate tab; DGP builder + Monte Carlo; embeds StatWorkspace + SampleTestPanel (simulated-data tests)
│   │   ├── statsim/
│   │   │   ├── StatWorkspace.jsx ← variables/computed/resampling/probability/distributions (embedded in SimulateTab)
│   │   │   └── SampleTestPanel.jsx ← shared collapsible pre-model test UI (mean/variance/parameter) over numeric columns
│   │   ├── SpatialTab.jsx        ← spatial analytics tab root shell only (245 lines): Analyze/Map/Plot tab router + pendingRows/OutputPanel save state
│   │   └── spatial/
│   │       ├── shared/
│   │       │   ├── constants.js  ← mono, arrMin, arrMax, BUFFER_RADIUS_PRESETS, formatRadiusLabel
│   │       │   ├── leaflet.js    ← BASEMAPS, CARTO_TILE, tile math (lonToTx/latToTy/txToLon/tyToLat/pickTileZ), addBasemap, loadLeaflet (CDN singleton)
│   │       │   ├── crs.js        ← loadProj4, PRESET_CRS, isProjectedWKT, makeCabaMetricGrid
│   │       │   ├── wkt.js        ← splitParenGroups, leafletPolygonLatLngs, wktToLeaflet ([lat,lon]), parseWktRings ([x,y] for SVG)
│   │       │   ├── color.js      ← CAT_PALETTE, buildColorScale
│   │       │   ├── atoms.jsx     ← ColSelect, NumInput, TextInput, ApplyBtn, SaveBtn, ResultPreview, ErrBanner, Section
│   │       │   └── guess.js      ← guessLatCol/guessLonCol/guessWktCol/guessPointCountCol/looksLikeWktValue/isGeometryHeader/guessAddressCol
│   │       ├── analyze/          ← one *Section per spatial op, each communicates via onResult(rows, newCols)
│   │       │   ├── CRSTransformSection.jsx
│   │       │   ├── DistanceSection.jsx
│   │       │   ├── BufferSection.jsx
│   │       │   ├── MetricBufferSection.jsx
│   │       │   ├── GridSection.jsx
│   │       │   ├── SpatialJoinSection.jsx
│   │       │   ├── AggregateToGridSection.jsx
│   │       │   ├── NearestNeighborSection.jsx
│   │       │   ├── GeocodeSection.jsx
│   │       │   ├── BoundaryDistanceSection.jsx
│   │       │   ├── OutputPanel.jsx ← save-bar for pendingRows
│   │       │   └── _parked/      ← defined-but-never-rendered orphans (kept, unimported)
│   │       │       ├── SpatialMapSection.jsx
│   │       │       └── SpatialRDDSection.jsx
│   │       ├── map/              ← Leaflet live map builder tab (self-contained)
│   │       │   ├── SpatialPlotTab.jsx ← the Map tab root
│   │       │   ├── SpatialLayerEditor.jsx
│   │       │   ├── ColorRow.jsx
│   │       │   ├── MapLegend.jsx
│   │       │   └── layers.js     ← LAYER_COLORS + mkSLayer
│   │       └── plot/            ← Observable Plot / SVG geo-plot tab (self-contained)
│   │           ├── SpatialGeoPlot.jsx ← the Plot tab root
│   │           ├── GeoPlotCanvas.jsx ← forwardRef SVG canvas; draws basemap tile underlay
│   │           ├── GeoLayerConfig.jsx
│   │           ├── geo.js        ← loadGeoPlt (CDN singleton), geoBbox, GEO_COLORS, mkGeoLayer
│   │           └── legend.js     ← GEO_MARGIN, appendSvgLegend
│   ├── workspace/
│   │   ├── WorkspaceBar.jsx      ← 7-tab nav bar (Data/Clean/Explore/Model/Simulate/Calculate/Report) + DatasetManager toggle + ? tour button
│   │   └── DatasetManager.jsx    ← collapsible D·N dataset button + dropdown panel showing all session datasets
│   ├── AIContextSidebar.jsx      ← AI context panel (sidebar)
│   ├── HelpSystem.jsx            ← HintBox (collapsible per-module tips) + TOUR_STEPS registry (9 steps) + TourOverlay (floating tour card, bottom-right)
│   ├── ModelingTab.jsx           ← modeling tab root; estimate useCallback dep array includes SC/EventStudy/LSDV state
│   ├── PlotBuilder.jsx           ← G1+G2+G8: layer-based plot builder (Observable Plot 0.6 CDN); point/line/bar/histogram/density geoms; aesthetic mappings (x, y, color); labels panel; ResizeObserver responsive; dark theme patched
│   └── validation/
│       └── AuditTrail.jsx        ← surfaces auditor.js output, pipeline audit UI
│
├── EconometricsEngine.js  ← legacy engine shim
├── WranglingModule.jsx    ← root orchestrator, pipeline state, tab router
├── ReportingModule.jsx    ← LaTeX Stargazer, forest plots, AI narrative
├── ExplorerModule.jsx     ← dataset explorer; G11: "◈ Plot Builder" tab renders PlotBuilder in free mode
├── App.jsx                ← top-level router
└── DataStudio.jsx         ← project shell (pid-scoped, IndexedDB)
```

## Estimators implemented
| Estimator | File | Status |
|-----------|------|--------|
| OLS | LinearEngine.js | ✓ validated vs R (6 decimal places) |
| WLS (survey weights) | LinearEngine.js | ✓ runWLS — (X'WX)⁻¹X'WY, unweighted SSR for σ² |
| FE (within) | PanelEngine.js | ✓ validated vs R fixest::feols (6dp coef, 4dp SE) — hard benchmarks in engineValidation.js |
| FD (first differences) | PanelEngine.js | ✓ |
| TWFE (generic two-way FE OLS) | PanelSuffStatsEngine.js | ✓ SQL fast path — classical/HC0/HC1/HC2/HC3/clustered/HAC via Fase 4b |
| TWFE DiD | PanelEngine.js | ✓ |
| 2x2 DiD | PanelEngine.js | ✓ |
| 2SLS / IV | CausalEngine.js | ✓ validated vs R AER::ivreg (6dp coef, 4dp SE) — hard benchmarks in engineValidation.js |
| Sharp RDD | CausalEngine.js | ✓ validated vs R rdrobust (LATE 6dp, SE 4dp) — IK bandwidth, triangular kernel; hard benchmarks in engineValidation.js; HC SE bug fixed: seOpts now threaded through runSharpRDD → local runWLS → computeRobustSE |
| McCrary density test | CausalEngine.js | ✓ |
| Logit / Probit | NonLinearEngine.js | ✓ validated vs R 4.4.1 glm() (6dp coef, 4dp SE) — IRLS/Newton-Raphson MLE |
| GMM / LIML | GMMEngine.js | ✓ validated vs R (6dp coef, 4dp SE) — hard benchmarks in engineValidation.js; just-id + overid cases; SE bug fixed: was /n, now ×n |
| Fuzzy RDD | CausalEngine.js | ✓ |
| Event Study | PanelEngine.js | ✓ |
| Panel LSDV | PanelEngine.js | ✓ |
| Poisson FE | NonLinearEngine.js | ✓ |
| Synthetic Control | SyntheticControlEngine.js | ✓ validated vs R Synth package (weights 2dp, gaps 2dp) — Frank-Wolfe vs ipop; hard benchmarks in engineValidation.js |
| Sun & Abraham (2021) event study | NonLinearEngine.js (`runSunAbraham`) | ✓ validated vs R fixest::fepois + sunab() (coef 6dp, SE 4dp) — IW per-relative-period aggregation w/ delta-method clustered SE; single-cohort reduces exactly to Poisson TWFE `i(rel)`. Harness: `sunAbrahamRValidation.R` → `sunAbrahamBenchmarks.json` → `sunAbrahamValidation.js`. Clustered SE uses sandwich convention = fixest `ssc(fixef.K="none")`; differs from fixest default `nested` by a known df factor (~1-2%) |

## Pipeline step types (runner.js) — 35 total
Cleaning: `rename, drop, filter, add_row, set_where, replace, drop_na, fill_na, fill_na_grouped, type_cast, quickclean, recode, normalize_cats, winz, trim_outliers, flag_outliers, extract_regex, ai_tr, distinct`
Features: `add_column, log, sq, std, dummy, lag, lead, diff, ix, did, date_parse, date_extract, mutate, str_splice, factor_interactions, vector_assign`
Reshape: `arrange, group_summarize, group_transform, pivot_longer`
Merge: `join` (`left, inner, right, full, semi, anti`), `append, bind_cols, union, intersect, setdiff`

**Registry must stay in sync with runner.js at all times.**

## Key bugs fixed (do not reintroduce)
- **RDD SE**: use unweighted SSR in `runWLS` for σ² — never weight the SSR.
- **React hooks in conditionals**: caused 2SLS black screen. Never put `useState` inside conditional IIFEs.
- **Project state bleed**: always generate fresh `pid` unconditionally; scope sessionStorage keys per `pid`; force `<DataStudio key={pid}>` remount on project change.
- **Lag/lead panel ops**: must group by entity before sorting to prevent cross-unit contamination.
- **Winsorize**: computes p1/p99 at step-creation time, not at runtime.
- **Fuzzy groups**: numeric variants like "comuna 1" vs "comuna 2" must never be grouped regardless of Levenshtein distance.
- **SyntheticControl crash on predictor click**: `setXVars` was not destructured in `ModelConfiguration` props — passed as `undefined` to `SyntheticControlConfig`, crashing on any variable toggle.
- **Stale closure in estimate() for SC/EventStudy/LSDV**: `treatedUnit`, `synthTreatTime`, `treatTimeCol`, `kPre`, `kPost`, `lsdvTimeFE` were missing from `estimate` useCallback dep array — estimation always saw initial empty state.

## AI service details
- Model for narratives: `claude-sonnet-4-20250514`
- Model for unit inference: `claude-haiku-4-5-20251001` (fast, cheap)
- All prompts live in `services/AI/Prompts/index.js`
- `SHARED_CONTEXT` (~800 tokens) is the cached block — always > 1024 tokens combined with any task prompt
- `callClaude({ system, user, maxTokens })` strips `SHARED_CONTEXT` from exported prompts before sending (it adds it as the cached block automatically)

## Pending (ordered by priority)

~~**DuckDB Fase 5 — DiD + Event Study SQL fast paths (2026-05-21)**~~ — ✓ complete + browser validated. `duckdbDiDSynthetic` emits DiD interaction and Event Study horizon/bin SQL payloads. Large-n `DiD` reuses OLS suff stats; `TWFE` and `EventStudy` reuse TWFE within suff stats and preserve ATT/event-coefficient/pre-trend result contracts. Validation fixtures: base-R `fase5RValidation.R`, generated `fase5Benchmarks.json`, `window.__validation.fase5` — all cells green.
~~**DuckDB Fase 6 — IRLS SQL fast paths (2026-05-21)**~~ — ✓ complete + browser validated. Logit/Probit/Poisson FE SQL fast paths live with 200k dispatch threshold, HC0/HC1 score-residual meat. Poisson FE AIC/BIC fixed to use `kTotal = k + nUnits` (matches R LSDV AIC). Entity FEs displayed in collapsible panel. Validation fixtures: `fase6RValidation.R`, `fase6Benchmarks.json`, `window.__validation.fase6` — all cells green.
~~**DuckDB Fase 7 — RDD SQL fast paths (2026-05-23)**~~ — ✓ complete + browser validated. Large-n `RDD` and `FuzzyRDD` route through triangular-kernel WLS suff stats with SQL IK bandwidth moments. `duckdbWLS`/`duckdbWLSRobustSE` accept kernel `weightSQL`; `RDDSuffStatsEngine` returns sharp discontinuities and fuzzy Wald/delta-method results; McCrary density bins aggregated in SQL. JS `runFuzzyRDD` SE fixed: now uses delta method (Wald ratio propagation) matching R's `fuzzy_wald` — first stage and reduced form both receive `seOpts` for HC1 propagation. Validation fixtures: `fase7RValidation.R`, `fase7Benchmarks.json`, `window.__validation.fase7` — all cells green.
~~**DuckDB Fase 8 — robust-SE backfill (2026-05-23)**~~ — ✓ complete + browser validated. WLS/2SLS/LIML robust SE backfill. Two JS bugs fixed: (1) `runLIML` was passing `XtPzXi * s2` as bread to `computeRobustSE` — removed s² pre-multiplication so sandwich uses raw `(X'P_Z X)^{-1}`; (2) `runWLS` passed `valid` (array of `{r,w}` objects) to `computeRobustSE` — now passes `valid.map(v => v.r)` so cluster/time columns resolve correctly (was causing NaN clustered SE and 0 two-way SE). HAC added to `HAC_COMPATIBLE` for WLS/2SLS/GMM/LIML/TWFEDiD/EventStudy. Validation fixtures: `fase8RValidation.R`, `fase8Benchmarks.json` — all cells green.
0. ~~**Phase 11.2 — Geocoding pipeline step**~~ — implemented by Codex. `GeocodeSection` in `SpatialTab.jsx` wired; Photon/Komoot default provider (CORS-enabled, München bbox preset); advanced opt-in via Settings for Nominatim-compatible endpoint (custom URL + API key); `geocode` step in `runner.js`/`registry.js` with sessionStorage cache keyed by address.
1. ~~**Estimator validation vs R**~~ — FE (fixest), RDD (rdrobust), 2SLS (AER), Logit/Probit (glm), GMM/LIML, Synthetic Control (Synth) — all validated with hard benchmarks in `engineValidation.js`.
2. ~~**DuckDB-WASM**~~ — ✓ complete. `services/data/duckdb.js` singleton (jsDelivr CDN, lazy init). `DataStudio.jsx` routes CSV/TSV >10MB and .parquet to DuckDB loaders. `pipeline/duckdbRunner.js` translates 11 step types (filter, arrange, rename, drop, group_summarize, log, sq, std, lag, lead, diff) to SQL; falls back to JS for the rest. WranglingModule dual-path: async DuckDB when `rawData._duckdb` present, sync JS otherwise. ⚡ DuckDB badge + truncation notice in wrangling header.
2a. ~~**DuckDB OLS suff-stats SQL push-down (Fase 0+1+2)**~~ — large-n OLS never materializes data in JS. `duckdbDispatch.shouldUseSQLPath` routes to SQL when n≥50k, k≤100, OLS, classical/HC0-3/clustered/twoway/HAC, no weights, with operand-presence checks (clusterVar, clusterVar2, timeVar). `duckdbOLS.buildOLSSuffStats` builds X'X/X'Y/Y'Y/sumY in SQL; cached LRU by `(table, y, sorted xColsExpanded)` in `suffStatsCache`. Fase 1 extensions: `duckdbFactors.expandFactors` (CASE WHEN dummies, first level dropped), `duckdbRobustSE.computeHCMeat`/`computeHCMeatWithLeverage` (HC0/HC1 + leverage-based HC2/HC3 with β/Ainv as prepared params + aggCount sanity throw), `duckdbResiduals.sampleResiduals` (lazy 5k-row thunk via `USING SAMPLE`), `duckdbDiagnostics` (BP/DW/JB via CTE). Fase 2 extensions: `duckdbClusterSE.computeClusterMeat` (grouped score CTE + small-sample correction G/(G-1)·(n-1)/(n-k)), `computeTwowayClusterMeat` (single-SQL-pass CGM with three grouped CTEs c1/c2/c1×c2), `duckdbHACSE.computeHACMeat` (Newey-West Bartlett kernel with LAG over ORDER BY orderCol [+ optional PARTITION BY entityCol], auto-bandwidth L=floor(4·(n/100)^(2/9))), `duckdbDiagnostics.whiteTestSQL` (aux regression e² ~ X + X² + X⊗X) and `breuschGodfreySQL` (e_t ~ X + LAG(e_t,1..p)). `runOLSFromSuffStats({meat, hcType})` does V=Ainv·meat·Ainv; HC1 scales n/(n-k); cluster/twoway/HAC meat pre-scaled inside builder (caller passes hcType:null); hcType uppercased at boundary. ModelingTab `estimate()` canonicalizes lowercase UI seType (hc1→HC1, hac→HAC) before dispatch; cluster preflight aborts SQL path when G>n/2 → JS fallback. Validation: 52/52 structural + R `sandwich::vcovHC` (`fase1Benchmarks.json`, `window.__validation.fase1`) + R `sandwich::vcovCL` / `NeweyWest` / `lmtest::bgtest` (`fase2Benchmarks.json`, `window.__validation.fase2`). Fase 3a extension (2026-05-20): 2SLS suff-stats path live for classical/HC0/HC1 via `duckdbIV.buildIVSuffStats` + `IV2SLSEngine.run2SLSFromSuffStats` + `duckdbIVRobustSE.computeIVHCMeat`; first-stage F via paired `buildOLSSuffStats`; `suffStatsCache` key extended with optional `zCols`; ModelingTab 2SLS branch guards against HC2/HC3/cluster/twoway/HAC and endogenous-factor HC. Validated vs `AER::ivreg` + `sandwich::vcovHC` (`fase3aBenchmarks.json`, `window.__validation.fase3a`). Fase 3c extension (2026-05-21): WLS suff-stats path live for classical/HC0/HC1 via `duckdbWLS.buildWLSSuffStats` (single SQL pass producing both weighted X'WX/X'WY/sumW and unweighted X'X/X'Y/Y'Y/sumY cross-products) + `WLSEngine.runWLSFromSuffStats` (β=(X'WX)⁻¹X'WY; UNweighted SSR matches `runWLS`; unweighted R² flagged via `_wlsR2Note`) + `duckdbWLSRobustSE.computeWLSHCMeat` (meat = Σ wᵢ² êᵢ² xᵢxⱼ in SQL with β as prepared params); `suffStatsCache` key extended with optional `wCol` via `|W|` sentinel; ModelingTab WLS branch guards against HC2/HC3/cluster/twoway/HAC. Validated vs R `lm(..., weights = w)` + `sandwich::vcovHC` (`fase3cBenchmarks.json`, `window.__validation.fase3c`). Fase 3b extension (2026-05-21): GMM (two-step efficient) and LIML suff-stats paths live for classical SE via `duckdbGMM.buildGMMSuffStats` + `duckdbGMMOmega.computeGMMOmega` + `GMMSuffStatsEngine.runGMMFromSuffStats` (β=(X'ZΩ̂⁻¹Z'X)⁻¹X'ZΩ̂⁻¹Z'Y; Hansen J=n·g'Ω̂⁻¹g on small matrices) and `duckdbLIML.buildLIMLSuffStats` + `LIMLSuffStatsEngine.runLIMLFromSuffStats` (κ=min eig(A⁻¹B) with A=V'M_ZV, B=V'M_WV; reuses `limlKappa2x2`/`limlKappaPower` from `GMMEngine`); dispatcher enforces order condition and classical-SE-only for GMM/LIML. Validated vs `gmm::gmm()` and hand-coded over-identified LIML (`fase3bBenchmarks.json`, `window.__validation.fase3b`). Fase 4 extension (2026-05-21): Panel FE and FD suff-stats paths live for classical/HC0/HC1 via `duckdbWithin.buildWithinSuffStats({mode})` (single CTE chain: FE = base + unit-means + grand-means + recentered `wf`; FD = base + LAG-by-unit-ordered-by-time + non-null filter `wf`; emits standard X'X/X'Y/Y'Y/sumY plus `n_units` and a reusable `withinCTEPrefix`) + `PanelSuffStatsEngine.runFEFromSuffStats`/`runFDFromSuffStats` (FE df = n − G − k_reg; FD df = n_diff − k_reg − 1; HC1 scaling matches `PanelEngine.runFE` at n/(n−k_reg−1)) + `duckdbWithinRobustSE.computeWithinHCMeat` (reuses `withinCTEPrefix`, computes Σ êᵢ² x̃ᵢx̃ⱼ with β as prepared params); `suffStatsCache` key extended with optional `panel = {mode, unitCol, timeCol}` via `|P|` sentinel; dispatcher gates FE/FD on `unitCol` (and `timeCol` for FD), classical/HC0/HC1 only, no weights; ModelingTab routes through `panel?.entityCol`/`panel?.timeCol` and writes results to `setPanelFE`/`setPanelFD`. Cluster-by-entity SE, HC2/HC3, HAC, and TWFE deferred to Fase 4b. Validated vs R `fixest`/manually demeaned `lm` + `sandwich::vcovHC` (`fase4Benchmarks.json`, `window.__validation.fase4`). Fase 4b extension (2026-05-21): TWFE double-demean (unit-mean + time-mean − grand-mean; df = n − G − T + 1 − k_reg) + cluster-by-entity SE for FE/FD/TWFE via `duckdbWithinClusterSE.computeWithinClusterMeat` (grouped score CTE; Stata small-sample correction G/(G−1)·(n−1)/(n−dim)) + HC2/HC3 leverage meat for panel via `duckdbWithinHC23.computeWithinHCMeatWithLeverage` (h_ii = x̃'Ainv x̃ inline in SQL; dispatcher guard dim²>1000 → JS fallback) + Driscoll-Kraay HAC via `duckdbWithinHAC.computeWithinDriscollKraayMeat` (cross-sectional score aggregation in SQL → Newey-West Bartlett in JS; auto-bandwidth L=⌊4·(T/100)^(2/9)⌋); `duckdbWithin.buildWithinSuffStats` extended to mode="TWFE" (new `tm` CTE + double-demean projection) + Option-A canonical `_g`/`_t_h` projections always present for SE reuse; `PanelSuffStatsEngine.runTWFEFromSuffStats` added; dispatcher updated for FE/FD/TWFE × {classical,HC0,HC1,HC2,HC3,clustered,HAC}. Validated vs R `fixest` (cluster) + `clubSandwich::vcovCR` (HC2/HC3) + `plm::vcovSCC` (DK-HAC) (`fase4bBenchmarks.json`, `window.__validation.fase4b`; SE tolerance 1e-3 for HAC/HC2/HC3 cells due to df-adjustment differences across R packages).
Fase 8 supplement (2026-05-21): the Fase 3a/3c robust-SE guards above are lifted for 2SLS and WLS SQL paths. `duckdbIVRobustSE` now adds fitted-design HC2/HC3, cluster, two-way cluster, and HAC meats; `duckdbWLSRobustSE` adds weighted equivalents; LIML keeps GMM's classical-only split but accepts HC0/HC1, clustered, and HAC SQL meat via `LIMLSuffStatsEngine`.
3. ~~**PlotBuilder G-track complete**~~ — G1+G2+G3+G4+G5+G6+G7+G8+G9+G10+G11+G12+G13 all done. PlotBuilder.jsx: 11 geoms (point/line/bar/histogram/density/smooth/boxplot/errorbar/ribbon/hline/vline), stack+jitter positions, palette presets, SVG+PNG export. ModelingTab: collapsible ◈ Plot Builder with result-augmented rows, 4 G10 templates, G13 multi-model coefficient comparison mode (compRows from pinnedModels, mode toggle, "Coef comparison" template).
4. ~~**Multi-subset workflow H-track**~~ — H1–H10 complete. H6: multi-subset R/Python/Stata replication scripts. H7: "Download subset bundle" button in ModelingTab. H8: Spec Curve collapsible panel (threshold col/op/range/coefVar, runSpecCurve loop, ribbon+line+point+hline chart). H9: buffer metadata. H10: script overhaul. H5: pipeline branch point UI.
~~5. **Contextual export architecture (I-track)**~~ — ✓ complete. I1 pipeline export in CleanTab, I2 dataset export in Explorer, I3 comparison export in ModelComparison, I4 auto-detect real filenames for join/append steps (stepTranslators.js), I5 allDatasets threaded into CodeEditor → rScript/stataScript/pythonScript, I6 LaTeX table from ModelComparison (buildStargazer).
5b. **Report module — AI script generation context (VALIDATION PENDING 2026-05-30)** — Session-aware Report-AI implemented. (1) `DataStudio.parseFile` now captures `_loadOpts` per parsed dataset (format/delimiter/encoding/sheetName/engine) and surfaces it through `sessionState` (`DatasetMeta.loadOpts`). (2) `WranglingModule` propagates `pipeline` + `loadOpts` in `onReady`/`onComplete` payloads. (3) New `src/services/AI/sessionSnapshot.js` (`buildSessionSnapshot`, `serializeSnapshot`, `loadOptsToScriptHint`) consolidates dataLoadOpts + pipeline + dict + activeResult + pinnedModels + subsets + inferenceOpts. (4) `interpretRegression` and `generateUnifiedScript` accept `{ snapshot }` and inject the serialized block + a REQUIRED LOAD CALL hint into the user payload. (5) `UNIFIED_SCRIPT_PROMPT` rule 8 instructs Claude to honor load options verbatim (e.g. `read_delim(..., delim=";")`, Excel sheet names, `read_stata` for .dta) and walk pipeline in order. (6) New `src/services/export/loadLine.js` (`buildRLoadLine`/`buildPyLoadLine`/`buildStataLoadLine`) replaces 6 hardcoded `read.csv`/`pd.read_csv`/`import delimited` sites across `rScript.js`/`pythonScript.js`/`stataScript.js` (single, multi-model, subset variants). (7) `ReportingModule` builds snapshot once via `useMemo` and threads through `AINarrative` and `AIUnifiedScript._buildModelScript` (via `dataLoadOpts` in config). **Franco: validate on Vercel by loading a `;`-delimited CSV / Excel-with-sheet / .dta and verify R/Python/Stata unified scripts emit the correct load call.**
5a. **Polynomial RDD validation — PENDING** — Base math validated for p=1/2/3 (21-cell harness, all green as of 2026-05-29). `ikBandwidth` extended: accepts `polyOrder`, fits degree-(p+1) pilot, extracts β[p+1], uses rate 1/(2p+3); `pilotDeg = p+1` (was p+2 — caused Vandermonde ill-conditioning for p=3). ModelingTab call sites pass `polyOrder` to `ikBandwidth`. Still PENDING: (1) rdrobust comparison for p>1 using `rdrobust(y, x, c=0, p=2/3)` — needs R fixtures; (2) Fuzzy RDD polynomial validation; (3) DuckDB SQL path for poly RDD (currently falls back to JS for all p>1); (4) SE type coverage for poly (HC/clustered benchmarks).
6. ~~**Phase 6 — Robust Standard Errors**~~ — `src/core/inference/robustSE.js` implemented with HC0/HC1/HC2/HC3, clustered, two-way (Cameron-Gelbach-Miller), Newey-West HAC. `seType` wired into all engines. `InferenceOptions.jsx` SE type selector implemented. RDD HC SE bug fixed: seOpts was not threaded through runSharpRDD into local runWLS.
7. ~~**Phase 7 — New File Format Support**~~ — `.rds`, `.shp/.dbf`, `.xlsx/.xls` (SheetJS CDN in DataStudio.jsx), CSV auto-delimiter detection — all implemented.
8. ~~**Phase 8 — Modeling UI Overhaul**~~ — `EstimatorSidebar.jsx` grouped dropdown, `InferenceOptions.jsx`, `CodeEditor.jsx` all implemented.
9. ~~**Multi-subset workflow H1–H4**~~ — `SubsetManager.jsx` (named subsets + filter UI), wired into `ModelingTab.jsx` with `runAllSubsets` → auto-pins results to model buffer with subset labels.
10. ~~**PlotBuilder G1+G2+G8+G11**~~ — `PlotBuilder.jsx` (Observable Plot 0.6 CDN, layer system, point/line/bar/histogram/density, aesthetic mappings, labels panel, dark theme). Wired into ExplorerModule as "◈ Plot Builder" tab.

## Reserved (post-MVP)
- `math/ml/` — DML, Lasso, Ridge, Forest
- `math/bayes/` — MCMC
- `services/AI/agents/` — DataAgent, CausalAgent, WritingAgent
- Tauri desktop packaging — defer until feature-complete
- Cloud sync — defer; IndexedDB solves the immediate problem

## Style conventions
- Inline styles only, using the `C` object from `shared.jsx`
- `mono` = IBM Plex Mono
- Color palette: `C.bg` (#080808), `C.teal` (#6ec8b4), `C.gold` (#c8a96e), `C.blue` (#6e9ec8)
- No external UI component libraries
- All UI labels and AI outputs in English
- Surgical `str_replace` patches preferred over full rewrites
- Small focused files over monoliths (WranglingModule refactor: 3200 lines → 11 files)

## Working conventions
- **When adding a workspace tab/sub-tab, add its row to `APP_CAPABILITY_MAP` in `src/services/AI/appCapabilityMap.js`** so the AI coach's navigation guidance stays accurate. (Pipeline steps are auto-derived from `STEP_REGISTRY` — no edit needed there.)
- Franco validates in the browser before proceeding to next task
- Patches are surgical — state what to add, what to delete, and exact location
- Math files get validated against R to 6 decimal places on coefficients, 4 on SE
- R validation libraries: `fixest`, `plm`, `rdrobust`, `AER`, `modelsummary`

## Planning & spec tracking — never orphan a spec
- **Every spec or plan doc you create (under `docs/superpowers/specs/` or `docs/superpowers/plans/`) MUST get a one-line reference in the `## Spec & Plan Index` at the top of `ClaudePlan.md`, with a status: `OPEN` / `IN PROGRESS` / `DONE` / `DROPPED`.** Add the index row in the *same change* that creates the spec — not later.
- **Update the status when work lands, is abandoned, or changes scope.** ClaudePlan.md's index is the single source of truth for what is specced vs shipped.
- **Before starting new work, scan the index** to avoid duplicating or re-orphaning an existing spec.
- **Why:** specs were getting written and then silently dropped — e.g. Phase 13.2 specced `projects`/`pipelines` RLS tables + Supabase pipeline sync that were never built, and nothing tracked the gap until a security review surfaced it months later.

## DuckDB-Wasm performance strategy

**Problem:** tab/module transitions take ~15 s with large datasets (900 k rows). Root cause: JS object allocation + React re-renders on the full table, not SQL performance.

**Non-starters (break privacy-first constraint):**
- Any server-side computation (DuckDB on server, Postgres, ClickHouse, BigQuery) — dataset never leaves the browser.

**Agreed rules (enforce in all new code):**

1. **DuckDB as the data boundary.** Never pull the full Arrow result into JS objects. Query only the columns needed, filter/aggregate/sort/paginate inside DuckDB. Avoid `SELECT *` on large tables.

2. **Parquet as primary format for large data.** Pipeline: CSV/TSV upload → convert to Parquet in DuckDB → all subsequent queries hit the cached Parquet. Already wired for `.parquet` uploads; extend to auto-convert large CSV on first load.

3. **OPFS persistence.** Cache the DuckDB Parquet file in OPFS so re-opening the same project skips re-import. Load-once, query-many.

4. **Threaded Wasm (COOP/COEP headers).** `vercel.json` must include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` to unlock `SharedArrayBuffer` and full parallel execution in DuckDB-Wasm.

5. **Display limit ≠ computation limit.** Rendering is limited to 200–500 rows (virtualized table). But pipeline steps — filter, log, z-score, lag, etc. — always run on the **full dataset** (900 k rows). Never truncate `rawData` before passing it to runner.js or duckdbRunner.js.

6. **Precompute summaries.** Column stats (mean, sd, min, max, n_distinct), histogram bins, and category counts are computed once via SQL and cached in component state. Never computed from the full JS array on render.

7. **Split preview from full analysis.** Wrangling/Explore tabs show a 500-row sample for instant display. When the user triggers an analysis (run model, export, group_summarize), the operation runs on the full DuckDB table. Show a progress indicator for operations >1 s.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.
