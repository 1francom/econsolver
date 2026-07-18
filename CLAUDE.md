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
│   ├── runner.js       ← applyStep + runPipeline — 53 step types
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
│   │   │   ├── rds.js            ← XDR binary R serialization reader (data.frame, tibble, named list); exports readSerializedStream/sexpToTable/XDRReader for rdata.js
│   │   │   ├── rdata.js          ← .RData/.rda workspace reader; reuses rds.js internals, returns MANY tables (one per data.frame) via a _multi envelope
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
│   │   ├── trimResult.js         ← shared comparison-sufficient EstimationResult projection (modelBuffer + sessionSnapshot)
│   │   └── artifactOrder.js      ← project-scoped global order across saved plots/maps/models (getArtifactOrder/saveArtifactOrder + makeArtifactId/parseArtifactId/orderArtifacts)
│   ├── sync/                     ← opt-in E2EE cloud sync: crypto.js only for WebCrypto, syncEngine.js/supabaseClient.js only for Supabase egress
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
| N-way FE (3+ dimensions, incl. nested e.g. state × state×year) | PanelEngine.js (`runFEMulti`/`runTWFEDiDMulti`, alternating-projection `demeanByFE` in `PanelWithinEngine.js`) | ✓ validated vs R fixest (2026-07-11, Franco ran `panelNwayFeRValidation.R`) — **18/18 checks pass** (coef/SE/df/n × 3 fixtures: 2-way independent state+industry, 3-way independent +year, nested state+state×year) at this project's standard tolerance (1e-5 coef, 1e-3 SE). The nested-pair case's df (183) matches R exactly using `feDegreesOfFreedom()`'s simple additive formula — the theoretical rank-based-correction risk flagged when this was written did not materialize for this fixture (fixest's own reported `nparams` for this nested structure appears to use the same additive count, not a rank-corrected one). Benchmarks: `panelNwayFeBenchmarks.json`/`panelNwayFeFixture.csv` in `src/math/__validation__/`. |
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
| Callaway & Sant'Anna (2021) staggered DiD | CallawayEngine.js (orchestrator), src/math/did/drdid.js, src/math/did/staggeredDiD.js | ✓ implemented; R validation pending Franco (run callawayRValidation.R → callawayBenchmarks.json) |

## Pipeline step types (runner.js) — 53 total
Cleaning (21): `rename, drop, filter, add_row, set_where, replace, drop_na, fill_na, type_cast, quickclean, recode, normalize_cats, distinct, winz, ai_tr, patch, fill_na_grouped, trim_outliers, flag_outliers, extract_regex, clean_strings`
Features (20): `add_column, str_splice, log, sq, std, dummy, lag, lead, diff, ix, did, date_extract, mutate, if_else, case_when, vector_assign, geocode, grouped_mutate, factor_interactions, inject_column`
Reshape (6): `arrange, group_summarize, group_transform, pivot_longer, pivot_wider, balance_panel`
Merge (6): `join` (`left, inner, right, full, semi, anti`), `append, bind_cols, union, intersect, setdiff`

**Registry must stay in sync with runner.js at all times.** This is now enforced by `src/pipeline/__validation__/pipelineReliabilityValidation.mjs` (Fase X1 — `node` it; T5 fails if any registry type lacks a runner case).

## Key bugs fixed (do not reintroduce)
- **RDD SE**: use unweighted SSR in `runWLS` for σ² — never weight the SSR.
- **React hooks in conditionals**: caused 2SLS black screen. Never put `useState` inside conditional IIFEs.
- **Project state bleed**: always generate fresh `pid` unconditionally; scope sessionStorage keys per `pid`; force `<DataStudio key={pid}>` remount on project change.
- **Lag/lead panel ops**: must group by entity before sorting to prevent cross-unit contamination.
- **Winsorize**: computes p1/p99 at step-creation time, not at runtime.
- **Fuzzy groups**: numeric variants like "comuna 1" vs "comuna 2" must never be grouped regardless of Levenshtein distance.
- **`PartialPlot` with no controls**: it used to plot DEMEANED Y vs DEMEANED X and call it "Partial: Y ~ X | others". Residual axes are mean-zero, so the fitted line was pinned to the origin and its intercept never matched the coefficient table — read as a plot bug, was actually a degenerate added-variable plot (with `otherX` empty there is nothing to partial out). Now falls back to the raw scatter in original units with the model's own fitted line. Keep the AVP only when controls actually exist.
- **SyntheticControl crash on predictor click**: `setXVars` was not destructured in `ModelConfiguration` props — passed as `undefined` to `SyntheticControlConfig`, crashing on any variable toggle.
- **Stale closure in estimate() for SC/EventStudy/LSDV**: `treatedUnit`, `synthTreatTime`, `treatTimeCol`, `kPre`, `kPost`, `lsdvTimeFE` were missing from `estimate` useCallback dep array — estimation always saw initial empty state.
- **CSP `connect-src` must include every CDN origin fetched at runtime, not just `script-src`**: DuckDB-Wasm's worker `fetch()`es its `.wasm` binary from jsDelivr at init time — that's governed by `connect-src`, not `script-src`. `cdn.jsdelivr.net` was allowlisted in `script-src`/`style-src`/`font-src` (P3 CSP hardening, 2026-05-26) but never added to `connect-src`, silently breaking DuckDB init — and therefore any file load >10MB — on the deployed (Vercel) site only, since `vercel.json` headers don't apply to local dev. Fixed 2026-07-02. When adding a new CDN dependency, check whether it's `<script>`-loaded (script-src) or `fetch()`-loaded at runtime (connect-src) — most WASM/worker libraries need both.

## AI service details
- **Model routing** (never bypass without a reason):
  - `claude-haiku-4-5-20251001` (`MODEL_FAST`) — unit inference, NL-to-pipeline dispatch. 0 credits.
  - `claude-sonnet-4-6` (`MODEL`, `MODEL_ADVISOR`) — narratives, coach, cleaning, comparison, coach dispatch check. 2 credits.
  - `claude-opus-4-8` — script replication only (`maxTokens=8000` call in `generateUnifiedScript`). 15 credits.
- All prompts live in `services/AI/Prompts/index.js`
- `SHARED_CONTEXT` (~2200 tokens) is the cached block — sized to clear the 2048-token Haiku cache minimum
- `callClaude({ system, user, maxTokens, model? })` prepends `SHARED_CONTEXT` as a cached system block automatically
- Proxy (`api/anthropic.js`) deducts credits atomically via `spend_credits()` RPC before forwarding to Anthropic:
  - 0 credits: Haiku model
  - 15 credits: `max_tokens >= 5000` (replication)
  - 2 credits: everything else
  - Returns HTTP 402 `{error:"insufficient_credits"}` → `AIService` throws `INSUFFICIENT_CREDITS`

## Pending (ordered by priority)

**LMU tutorial parity (2026-07-18)** — gap analysis of Litux against the LMU Applied/Intermediate Econometrics problem sets in `LMU tutorials/` (PS1–PS7 R scripts + PS2–PS6 Rmd notebooks). PS2_sol_code.R already replicates fully. Two items shipped this session, the rest are open and ordered by cost/benefit.

**DONE 2026-07-18 — regression through the origin.** `runOLS(rows, y, x, seOpts, { noIntercept })` in `LinearEngine.js` drops the constant column, sets `k = xCols.length`, and switches R²/F to the **uncentered** convention (TSS = Σy², adj-R² divides by n not n−1) — matching R's `summary.lm` and Stata's `regress, noconstant`. A centered R² on a no-intercept fit can exceed 1 or go negative, so the convention must move with the design matrix. Verified against hand computation: β/SE agree to 7dp, F = t². Wired through `estimationDispatch.js` (OLS branch only — panel/IV engines build their own design matrices), `ModelingTab` state + `specExtras` + the `_runEstimation` dep array, and a "Constant" chip pair in `ModelConfiguration` (OLS × linear family only). **`duckdbDispatch.shouldUseSQLPath` returns false when `noIntercept`** — every suff-stats builder emits a constant into X'X unconditionally, so without the guard n≥50k would have silently returned an intercept-fitted model. Exports emit `y ~ 0 + x` (R), `"y ~ x - 1"` (patsy), `reg y x, noconstant` (Stata, reusing `opt`'s comma). Unblocks PS5.Rmd §5/§6/§7 and PS6_Ex2's dynamic TWFE. **Any auxiliary regression run for display must share the model's intercept convention** — `PartialPlot` residualizes Y and X on the controls to draw the added-variable plot, and residualizing WITH a constant against a through-the-origin fit put the annotated slope 6% off (1.5194 vs 1.6138 on a 4k-row synthetic). Fixed by threading `noIntercept` into its `runOLS` calls; check for the same trap if any other plot or diagnostic fits its own auxiliary. **Gotcha for any future spec field:** `spec` → export needs THREE whitelist edits — `CodeEditor.jsx`'s config object, `ReportingModule.jsx`'s equivalent, and *every* `transpileModel({...})` call site in the three exporters (10 sites across single-model / multi-model / subset paths). A field added only to `spec` reaches R but not Python/Stata.

**DONE 2026-07-18 — `.RData` / `.rda` workspace loading.** `services/data/parsers/rdata.js`. A workspace is the same serialization stream as `.rds`, differing only in a 5-byte `RDX2\n`/`RDX3\n` magic and a root that is a **pairlist of name→value bindings** rather than one object — so `rds.js` was refactored (not duplicated) to export `XDRReader`, `readObject`, `decompressGzip`, plus two new shared helpers `readSerializedStream(buf, startPos)` and `sexpToTable(root)`; `parseRDS` now calls both. **This is the only parser that yields more than one dataset from one file**: it returns a `_multi` envelope that `parseFiles` and `handleLoadFile` fan out, one dataset per data.frame, named after the R object. Non-tabular bindings and **ragged named lists** are reported in `skipped` rather than dropped — `sexpToTable` sizes the table off the first column, so a ragged list would silently truncate. gzip is handled (R's `save()` default); bzip2/xz throw a "re-save with compress=gzip" message. `loadOpts.objectName` is recorded so exports emit `load(f); df <- <obj>` (R) and `pyreadr.read_r(f)["<obj>"]` (Python); Stata gets a documented no-support comment. Validated against 4 hand-built fixtures (multi-object, gzipped, RDX3-with-locale, ragged) plus a 3-case `.rds` regression check — no R on this machine, so fixtures are byte-constructed from the format spec, NOT R-generated. Unblocks PS5.R, which previously could not even open its data file.

**Open, ordered by cost/benefit:**
1. **Goodman-Bacon decomposition** (`bacondecomp::bacon`) — nothing in repo. PS6.R Q5's central teaching point: the 2×2 weights and the weight-vs-estimate plot that show *why* TWFE breaks under heterogeneous effects. Medium.
2. **Synthetic Control `special.predictors`** — predictors averaged over per-predictor time windows (`gdpcap` mean 1960–69, `sec.agriculture` odd years 1961–69, `popdens` at 1969 only), and `time.predictors.prior` separate from `time.optimize.ssr`. The engine averages over the whole pre-period; this *is* Abadie et al.'s Basque spec, so PS7.R Q6–Q9 can't be reproduced. Medium.
3. **CR2/CR3 cluster-robust SE** (bias-reduced, `clubSandwich`-style) — `robustSE.js` has HC0–HC3, CGM cluster, Newey-West. PS1.R Q5 asks for `se_type = "CR2"` explicitly. Medium.
4. **RDD: CCT MSE-optimal bandwidth + bias-corrected CI + `rddensity`** — only IK bandwidth and McCrary exist. PS3.R Q9c/Q11. Medium. (Kernel choice and polynomial order are already exposed in the UI — verified 2026-07-18, not a gap.)
5. **Fixed-effect estimates extraction + join back to rows** (`fixef()`) — LSDV returns dummy coefficients but there is no way to write `worker_fe`/`firm_fe` back as columns. Blocks PS4.R Ex2. Medium.
6. **Graph connected-components** (`igraph::components`) — absent. AKM is not identified without the largest connected set. PS4.R Ex2. High.
7. **Matrix-algebra workspace** — `t()`, `%*%`, `solve()`, `rankMatrix()`, `det()`, `diag()`. The Calculate tab is scalar-only. PS2.Rmd is *entirely* explicit matrix algebra (X'X, its inverse, the vcov, manual t-stats) and is unreplicable end to end. Needs a new surface, not a pipeline step. High.
8. **Staggered-panel DGP in Simulate** — the DGP builder emits iid variables, not a person×period panel with treatment cohorts and per-cohort effects. PS6.R Q1. Medium.
9. **PlotBuilder `geom_tile` + `facet_wrap`** — PS4.R Q10 residual heatmap by FE quintile, Q11 three-scenario facets. Medium.
10. **Bundled teaching datasets** (wooldridge `wage1`/`bwght`/`mroz`/`jtrain`/`kielmc`, `Synth::basque`) — 5 of the 6 notebooks open with `data("…")`, so an LMU student cannot start without sourcing CSVs themselves. Trivial technically, high go-to-market weight given institutional licensing is the GTM. Low.

**Not gaps (checked 2026-07-18, do not re-add):** fitted/residual extraction to a column (`ExtractPanel.jsx` already does it); RDD kernel + polynomial order UI (`ModelConfiguration.jsx` `PolyOrderSection` + kernel chips); event-study reference period (PS5's `ref = 2014` and PS7's `ref = 1974` are both k = −1 relative to treatment, which `runEventStudyMulti` already omits by default — a configurable ref is only worth it for k = −2 robustness checks).

**Spatial pipeline integration (2026-07-16)** — code-complete, browser-validation pending Franco. Spatial Analyze ops are pipeline citizens: 11 new `sp_*` step types in runner/registry (category "spatial", excluded from NL catalogue via serializeAllowedSteps whitelist); column-adders (Distance/CRS/Buffer/GridAssign/SpatialJoin/Nearest/BoundaryDist + geocode reuse) commit via preview → "➕ Add to pipeline" (`addStepTo` in DataStudio handles Clean-active vs Spatial-active dataset mismatch with a pending-step queue drained after WranglingModule remount); dataset-producers (MetricBuffers/BufferExposure/AggregateToGrid/ArealInterp) save through `handleSaveSubset(recipe)` → derive edge in globalPipeline. **R/Python/Stata translators for all 11 `sp_*` steps DONE 2026-07-17** — `spatialR`/`spatialPy`/`spatialStata` in `pipeline/stepTranslators.js` (dispatched from `toR`/`toPython`/`toStata` and each script file's local `transpileStep` via a `sp_*` prefix check). R uses `sf`(+`dplyr`, namespaced so no `library()` needed); Python uses `geopandas`(+`shapely`/`numpy`/`tobler`, imports inlined per block); Stata emits a documented "no geometry stack" comment (never a silent drop). Column-adders append columns; dataset-producers reassign `df` to the derived shape. Referenced datasets resolve to `df_<name>`; `self`/`active` sentinels → current frame; unknown ids → readable placeholder + a bind-this-dataset NOTE. Export-integrity harness 329/0 (auto-enumerated). Semantic notes: metric distance bins hard-coded to 0/100/200/300m (matches `addDistanceBins` defaults); rect/hex grid IDs replicate the engine's `<latIdx>_<lonIdx>` / `h<res>_<q>_<r>` string formulas; `sp_areal_interp` uses `sf::st_interpolate_aw` (R) / `tobler.area_interpolate` (Py). Spec: `docs/superpowers/specs/2026-07-16-spatial-pipeline-integration-design.md`; plan: `docs/superpowers/plans/2026-07-16-spatial-pipeline-integration.md`. **Franco: browser-test — each column op preview→Add to pipeline, undo/redo in History, reload persistence, spatial step on a non-Clean-active dataset, derived grid joined in Clean, unified script shows `[unknown step: sp_*]` comments.**

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
~~5b. **Report module — AI script generation context**~~ — ✓ DONE (2026-06-09 — code verified complete) — Session-aware Report-AI implemented. (1) `DataStudio.parseFile` now captures `_loadOpts` per parsed dataset (format/delimiter/encoding/sheetName/engine) and surfaces it through `sessionState` (`DatasetMeta.loadOpts`). (2) `WranglingModule` propagates `pipeline` + `loadOpts` in `onReady`/`onComplete` payloads. (3) New `src/services/AI/sessionSnapshot.js` (`buildSessionSnapshot`, `serializeSnapshot`, `loadOptsToScriptHint`) consolidates dataLoadOpts + pipeline + dict + activeResult + pinnedModels + subsets + inferenceOpts. (4) `interpretRegression` and `generateUnifiedScript` accept `{ snapshot }` and inject the serialized block + a REQUIRED LOAD CALL hint into the user payload. (5) `UNIFIED_SCRIPT_PROMPT` rule 8 instructs Claude to honor load options verbatim (e.g. `read_delim(..., delim=";")`, Excel sheet names, `read_stata` for .dta) and walk pipeline in order. (6) New `src/services/export/loadLine.js` (`buildRLoadLine`/`buildPyLoadLine`/`buildStataLoadLine`) replaces 6 hardcoded `read.csv`/`pd.read_csv`/`import delimited` sites across `rScript.js`/`pythonScript.js`/`stataScript.js` (single, multi-model, subset variants). (7) `ReportingModule` builds snapshot once via `useMemo` and threads through `AINarrative` and `AIUnifiedScript._buildModelScript` (via `dataLoadOpts` in config). **Franco: validate on Vercel by loading a `;`-delimited CSV / Excel-with-sheet / .dta and verify R/Python/Stata unified scripts emit the correct load call.** **2026-06-12 browser-validation round:** load call ✓ (`read_delim` `;` correct), but two gaps surfaced + fixed: (1) MULTI-DATASET BUG — unified script loaded only the Report-active dataset and ran the model on it (DiD estimated on dataset_DiD.csv emitted against comunas.csv → unrunnable). Fix: `ModelingTab._runEstimation` stamps `spec.filename` (model's source dataset, + `cleanedData` added to its useCallback deps); `AIUnifiedScript` builds its deterministic skeleton via Phase-9 `generateWorkspaceScript` (ALL session datasets topo-sorted + globalPipeline G-steps, per-dataset pipelines from IDB `loadProjectPipelines`, pid threaded App→ReportingModule) instead of single-dataset `generateCleanScript`; model section renamed `\bdf\b`→`df_<name>`; `buildSessionSnapshot` gains `datasets[]` + `modelDataset`; `serializeSnapshot` emits SESSION DATASETS + MODEL SOURCE DATASET blocks (single-dataset DATA LOAD OPTIONS block suppressed when present); `generateUnifiedScript` emits one REQUIRED LOAD CALL per dataset via loadLine builders (extension-inferred, so .dta → `haven::read_dta` even without loadOpts); UNIFIED_SCRIPT_PROMPT rules 8b/8f updated (load ALL datasets verbatim; estimating on a non-source df is a fatal error). Also fixed: `generateWorkspaceScript` hardcoded `read_csv`/`import delimited` — now honors per-dataset loadOpts (DatasetManager workspace export benefits too). (2) DATASET RENAME feature — datasets renamable inline in Data tab (✎ button); `name` persisted in IDB `dataset_registry` + sessionState meta (`UPDATE_DATASET_META`); the user-given name drives `df_<name>` in workspace scripts, REQUIRED LOAD CALLS, and snapshot, while the original filename is kept for load calls. `toDfVar` now strips file extensions and is exported from `exporter.js`. Build + lint:undef green. **Franco: re-validate a multi-dataset session (3 datasets incl. .dta) → script must load all 3 with the correct readers and estimate on the model's source df; try renaming a dataset and confirm the new name appears as `df_<name>`.**
5a. **Polynomial RDD validation — PENDING** — Base math validated for p=1/2/3 (21-cell harness, all green as of 2026-05-29). `ikBandwidth` extended: accepts `polyOrder`, fits degree-(p+1) pilot, extracts β[p+1], uses rate 1/(2p+3); `pilotDeg = p+1` (was p+2 — caused Vandermonde ill-conditioning for p=3). ModelingTab call sites pass `polyOrder` to `ikBandwidth`. Still PENDING: (1) rdrobust comparison for p>1 using `rdrobust(y, x, c=0, p=2/3)` — needs R fixtures; (2) Fuzzy RDD polynomial validation; (3) DuckDB SQL path for poly RDD (currently falls back to JS for all p>1); (4) SE type coverage for poly (HC/clustered benchmarks).
6. ~~**Phase 6 — Robust Standard Errors**~~ — `src/core/inference/robustSE.js` implemented with HC0/HC1/HC2/HC3, clustered, two-way (Cameron-Gelbach-Miller), Newey-West HAC. `seType` wired into all engines. `InferenceOptions.jsx` SE type selector implemented. RDD HC SE bug fixed: seOpts was not threaded through runSharpRDD into local runWLS.
7. ~~**Phase 7 — New File Format Support**~~ — `.rds`, `.shp/.dbf`, `.xlsx/.xls` (SheetJS CDN in DataStudio.jsx), CSV auto-delimiter detection — all implemented.
8. ~~**Phase 8 — Modeling UI Overhaul**~~ — `EstimatorSidebar.jsx` grouped dropdown, `InferenceOptions.jsx`, `CodeEditor.jsx` all implemented.
9. ~~**Multi-subset workflow H1–H4**~~ — `SubsetManager.jsx` (named subsets + filter UI), wired into `ModelingTab.jsx` with `runAllSubsets` → auto-pins results to model buffer with subset labels.
10. ~~**PlotBuilder G1+G2+G8+G11**~~ — `PlotBuilder.jsx` (Observable Plot 0.6 CDN, layer system, point/line/bar/histogram/density, aesthetic mappings, labels panel, dark theme). Wired into ExplorerModule as "◈ Plot Builder" tab.

~~**Litux Credits system + tier limits (2026-06-27)**~~ — ✓ complete.
- Supabase: `profiles.credits` (int, default 30) + `profiles.credits_reset_at` (timestamptz). Migration `add_credits_system` seeds existing users (Free=30, Pro=200, Premium=1000). `spend_credits(p_amount integer)` SECURITY DEFINER RPC: locks row, auto-resets monthly by tier, deducts atomically, returns remaining or -1.
- `api/anthropic.js`: tier gate removed — all authenticated users can call AI. Credit cost (Haiku=0, standard=2, replication=15) deducted server-side before forwarding. 402 `insufficient_credits` on empty balance.
- `authService.js`: `getProfile(userId)` (tier+credits in one query), `getCredits(userId)`.
- `AuthContext.jsx`: `credits`, `setCredits`, `refreshCredits` exposed app-wide.
- `AIContextSidebar.jsx`: `✦ N` badge in header (teal→gold→red), yellow out-of-credits banner, disabled input at 0, credits refreshed from Supabase after every send. Gate changed from tier-based to session-based (any signed-in user can open coach).
- Sync limits in `enableCloud()`: Free=3, Pro=25, Premium=100 projects. Re-enabling an existing pid is exempt (upsert path). Human-readable error surfaced in `syncError` UI label.
- Share limits in `createShare()`: Free=1, Pro=5, Premium=20 shares per project. Human-readable error surfaced in `shareErr` UI label.

**Guest AI Coach access via Supabase Anonymous Auth (2026-07-15)** — client-side done, **Supabase-side PENDING (Franco)**. Bug: guest mode (`?guest=1`, `enterGuest()`) was a pure client-side flag with no Supabase session, so `AIContextSidebar`'s `hasAccess = !PROXY_ENABLED || !!session` gate always showed "Premium Feature" for guests — `api/anthropic.js` requires a JWT for everything, including credit metering, and guests had none. Fix: `enterGuest()` in `AuthContext.jsx` now also calls `authService.signInAnonymously()` (Supabase Anonymous Auth) in the background so guest mode is backed by a real (anonymous) session — this makes the *existing* session-based gate and the *existing* credit-metering RPC work for guests with zero changes to `AIContextSidebar.jsx` or `api/anthropic.js`. `applySession` now branches on `user.is_anonymous`: keeps `guest=true` instead of clearing it, skips cloud-project listing. `exitGuest()` signs the anonymous session out. Returning guests (persisted local flag, expired/missing anon session) re-establish one on load. **PENDING — needs Franco in Supabase dashboard/MCP:** (1) enable Anonymous Sign-Ins (Authentication → Providers) — `signInAnonymously()` 403s until this is on — ✓ done; (2) apply `supabase/migrations/20260715130000_guest_anonymous_credits.sql` — ✓ applied, but guests still landed at 30 credits, not 20 (see follow-up fix below); (3) decide whether `spend_credits()`'s monthly reset-by-tier should apply to anonymous users at all (as written, guests get 20 once — if the RPC's reset logic resets by tier to the tier's default, a guest could get bumped to 30 on reset since anon rows use `tier='free'`) — still open.

**Follow-up fix — guests still got 30 credits (2026-07-15)**: root-caused via `pg_trigger` + a live test row (`ce31433a-...`, tier=free, credits=30, is_anonymous=true). Supabase's `signInAnonymously()` inserts the `auth.users` row first with `is_anonymous` still false/null, then flips it to `true` via a **separate UPDATE** afterward. The first migration's trigger was `AFTER INSERT` only, so `NEW.is_anonymous` read false at the moment it fired and the 20-credit branch never ran — only the base signup trigger's unconditional 30-credit seed landed. `supabase/migrations/20260715140000_fix_guest_credits_anonymous_update.sql` replaces that trigger with one firing on `AFTER INSERT OR UPDATE OF is_anonymous`, gated by `WHEN (new.is_anonymous IS TRUE AND coalesce(old.is_anonymous, false) IS DISTINCT FROM true)` — deliberately only the true-transition edge, not every `auth.users` update (that table updates on every login/token refresh, which would otherwise reset a returning guest's already-spent balance back to 20 each time). **PENDING — Franco: apply this migration too.** Does NOT retroactively fix already-created test rows stuck at 30 (see one-off UPDATE in the migration's header comment if you want those corrected).

**hCaptcha wired for login/signup/guest (2026-07-15)** — client-side done. Franco enabled "Confirm email" + "Enable Captcha protection" (hCaptcha) in Supabase Auth settings, motivated directly by the guest-credits abuse vector above (free-email signups farming 30 credits, or anonymous sign-in loops farming 20). `src/services/auth/hcaptcha.js` (CDN singleton loader, explicit-render mode, matches the Leaflet/proj4 loader pattern) + `src/components/auth/HCaptchaWidget.jsx` (forwardRef wrapper, exposes `.reset()`). `authService.js`'s `signIn`/`signUp`/`signInAnonymously` all take an optional `captchaToken` → `options: { captchaToken }`. `LoginForm.jsx` renders one shared widget above the submit button; login, signup, and the guest button are all disabled until solved, and the widget resets on any auth error. Site key in `VITE_HCAPTCHA_SITE_KEY` (public, safe in bundle) — **the secret key goes ONLY in Supabase Dashboard → Auth → Bot and Abuse Protection, never in this repo.** `vercel.json` CSP extended with `https://*.hcaptcha.com` on script-src/connect-src/style-src, plus a new `frame-src` directive (previously absent, so the hCaptcha challenge iframe would've been blocked under `default-src 'self'`). **⚠️ Untested interaction to watch for:** this project already sets `Cross-Origin-Embedder-Policy: require-corp` for DuckDB-Wasm threading (see CSP bug entry above) — `require-corp` is known to block third-party iframes that don't send `Cross-Origin-Resource-Policy` headers, which can include hCaptcha's challenge iframe. If the widget fails to render/click-through in Franco's browser testing, try `Cross-Origin-Embedder-Policy: credentialless` instead of `require-corp` (still preserves SharedArrayBuffer/DuckDB threading, just stops requiring CORP opt-in from embedded content). **Franco: set `VITE_HCAPTCHA_SITE_KEY` in Vercel's env vars too (build-time Vite var, not just local `.env`), then browser-test login/signup/guest end to end.**

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
- **Never use browser preview/automation tools (preview_start, screenshots, etc.) to validate changes in this repo.** After any change, just confirm `npm run build` is green (and `npm run lint:undef` if touched). Franco does all browser validation himself.
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
- Any server-side computation (DuckDB on server, Postgres, ClickHouse, BigQuery) — plaintext data never leaves the browser; opt-in cloud uploads only client-side-encrypted blobs the server can't decrypt.

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
