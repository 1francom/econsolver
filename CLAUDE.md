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
│   ├── timeSeries.js               ← time series utilities
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
│   └── auditor.js      ← auditPipeline → AuditTrail + markdown
│
├── services/
│   ├── AI/
│   │   ├── AIService.js          ← callClaude (exported), inferVariableUnits, interpretRegression
│   │   ├── LocalAI.js            ← local/offline AI fallback
│   │   └── Prompts/
│   │       └── index.js          ← SHARED_CONTEXT, INFER_UNITS_PROMPT, INTERPRET_REGRESSION_PROMPT,
│   │                                WRANGLING_TRANSFORM_PROMPT, WRANGLING_QUERY_PROMPT,
│   │                                CLEANING_SUGGESTIONS_PROMPT
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
│   │   ├── rScript.js            ← pipeline + model → R script (fixest/modelsummary)
│   │   ├── stataScript.js        ← pipeline + model → Stata do-file
│   │   ├── pythonScript.js       ← pipeline + model → Python script
│   │   └── replicationBundle.js  ← ZIP bundle (R + Stata + Python scripts + data)
│   ├── Persistence/
│   │   └── indexedDB.js          ← loadPipeline, savePipeline, saveRawData, migrateFromLocalStorage
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
│   │   ├── FeatureTab.jsx        ← transforms: log, sq, z-score, winsorize, lag/lead, dummies, dates
│   │   ├── ReshapeTab.jsx        ← pivot_longer, group_summarize
│   │   ├── DictionaryTab.jsx     ← AI inference + manual edit
│   │   ├── MergeTab.jsx          ← LEFT/INNER JOIN + APPEND
│   │   ├── DataQualityReport.jsx
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
│   │   └── CodeEditor.jsx        ← collapsible replication code viewer/editor: R / Python / Stata tabs
│   │
│   ├── AIContextSidebar.jsx      ← AI context panel (sidebar)
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
| TWFE DiD | PanelEngine.js | ✓ |
| 2x2 DiD | PanelEngine.js | ✓ |
| 2SLS / IV | CausalEngine.js | ✓ validated vs R AER::ivreg (6dp coef, 4dp SE) — hard benchmarks in engineValidation.js |
| Sharp RDD | CausalEngine.js | ✓ validated vs R rdrobust (LATE 6dp, SE 4dp) — IK bandwidth, triangular kernel; hard benchmarks in engineValidation.js |
| McCrary density test | CausalEngine.js | ✓ |
| Logit / Probit | NonLinearEngine.js | ✓ validated vs R 4.4.1 glm() (6dp coef, 4dp SE) — IRLS/Newton-Raphson MLE |
| GMM / LIML | GMMEngine.js | ✓ validated vs R (6dp coef, 4dp SE) — hard benchmarks in engineValidation.js; just-id + overid cases; SE bug fixed: was /n, now ×n |
| Fuzzy RDD | CausalEngine.js | planned |
| Event Study | PanelEngine.js | planned |
| Panel LSDV | PanelEngine.js | planned |
| Poisson FE | NonLinearEngine.js | planned |
| Synthetic Control | SyntheticControlEngine.js | ✓ validated vs R Synth package (weights 2dp, gaps 2dp) — Frank-Wolfe vs ipop; hard benchmarks in engineValidation.js |

## Pipeline step types (runner.js) — 23 total
Cleaning: `rename, drop, filter, drop_na, fill_na, fill_na_grouped, type_cast, quickclean, recode, normalize_cats, winz, trim_outliers, flag_outliers, extract_regex, ai_tr`
Features: `log, sq, std, dummy, lag, lead, diff, ix, did, date_parse, date_extract, mutate, factor_interactions`
Reshape: `arrange, group_summarize, pivot_longer`
Merge: `join, append`

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
1. ~~**Estimator validation vs R**~~ — FE (fixest), RDD (rdrobust), 2SLS (AER), Logit/Probit (glm), GMM/LIML, Synthetic Control (Synth) — all validated with hard benchmarks in `engineValidation.js`.
2. **DuckDB-WASM** — final compute target for datasets > 50k rows.
3. **PlotBuilder — remaining G-track** — G10 (estimator templates), G12 (guided mode in ModelingTab), G13 (multi-model overlay). ~~G3~~ (smooth, boxplot, errorbar, ribbon), ~~G5~~ (stack/jitter via stackY+dodgeX), ~~G6~~ (hline/vline), ~~G7~~ (palette presets), ~~G9~~ (SVG/PNG export) done. G1+G2+G4+G8+G11 also done.
4. **Multi-subset workflow — remaining H-track** — H5 (pipeline branch point UI), H6–H10 (replication code, session export bundle, specification curve, buffer metadata, script overhaul). H1–H4 done.
5. **Contextual export architecture (I-track)** — I1–I7: pipeline export in CleanTab, dataset export in Explorer, comparison export in ModelComparison, auto-detect map vs separate, refactor export services, LaTeX table from comparison.
6. ~~**Phase 6 — Robust Standard Errors**~~ — `src/core/inference/robustSE.js` implemented with HC0/HC1/HC2/HC3, clustered, two-way (Cameron-Gelbach-Miller), Newey-West HAC. `seType` wired into engines. `InferenceOptions.jsx` SE type selector implemented. Validation vs R `sandwich::vcovHC` still pending.
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
- Franco validates in the browser before proceeding to next task
- Patches are surgical — state what to add, what to delete, and exact location
- Math files get validated against R to 6 decimal places on coefficients, 4 on SE
- R validation libraries: `fixest`, `plm`, `rdrobust`, `AER`, `modelsummary`

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
