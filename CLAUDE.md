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

## File structure (current state)
```
src/
├── math/
│   ├── index.js              ← single barrel export for all engines
│   ├── LinearEngine.js       ← OLS, WLS, matrix algebra, diagnostics, export helpers
│   ├── PanelEngine.js        ← FE, FD, TWFE, 2x2 DiD
│   └── CausalEngine.js       ← 2SLS/IV, Sharp RDD, McCrary density test, IK bandwidth
│
├── core/
│   ├── diagnostics/
│   │   ├── heteroskedasticity.js   ← Breusch-Pagan, White
│   │   ├── autocorrelation.js      ← Durbin-Watson, Breusch-Godfrey
│   │   ├── normality.js            ← Jarque-Bera, Shapiro-Wilk
│   │   └── multicollinearity.js    ← VIF, condition number
│   └── validation/
│       └── dataQuality.js          ← missing patterns, outlier flags, type consistency
│
├── pipeline/
│   ├── runner.js       ← applyStep + runPipeline — 23 step types
│   ├── validator.js    ← validatePanel, buildInfo
│   ├── registry.js     ← STEP_REGISTRY (must stay in sync with runner.js)
│   └── auditor.js      ← auditPipeline → AuditTrail + markdown
│
├── services/
│   ├── ai/
│   │   ├── AIService.js          ← callClaude (exported), inferVariableUnits, interpretRegression
│   │   └── prompts/
│   │       └── index.js          ← SHARED_CONTEXT, INFER_UNITS_PROMPT, INTERPRET_REGRESSION_PROMPT,
│   │                                WRANGLING_TRANSFORM_PROMPT, WRANGLING_QUERY_PROMPT,
│   │                                CLEANING_SUGGESTIONS_PROMPT
│   ├── geo/
│   │   └── photon.js             ← Geocoding Photon/Komoot
│   ├── data/
│   │   └── parsers/
│   │       ├── csv.js
│   │       └── excel.js          ← SheetJS (CDN: https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs)
│   ├── export/
│   │   ├── latex.js              ← Stargazer-style tables
│   │   ├── csv.js
│   │   └── rScript.js            ← pipeline + model → R script (fixest/modelsummary)
│   └── persistence/
│       └── indexedDB.js          ← loadPipeline, savePipeline, saveRawData, migrateFromLocalStorage
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
│   │   └── DataQualityReport.jsx
│   │
│   └── modeling/
│       ├── shared.jsx            ← VarPanel, Section, Chip, C, mono (modeling-specific)
│       ├── EstimatorSidebar.jsx
│       ├── VariableSelector.jsx  ← Y, X, W selectors
│       ├── ModelConfiguration.jsx ← estimator-specific config (Z instruments, DiD, RDD, WLS weights)
│       ├── ModelPlots.jsx        ← RDDPlot, DiDPlot, EventStudyPlot, FirstStagePlot, etc.
│       └── ResidualPlots.jsx     ← ResidualVsFitted, QQPlot
│
├── WranglingModule.jsx    ← root orchestrator, pipeline state, tab router
├── ModelingTab.jsx        ← modeling orchestrator, estimate(), all model state
├── ReportingModule.jsx    ← LaTeX Stargazer, forest plots, AI narrative
├── ExplorerModule.jsx     ← dataset explorer
├── App.jsx                ← top-level router
└── DataStudio.jsx         ← project shell (pid-scoped, IndexedDB)
```

## Estimators implemented
| Estimator | File | Status |
|-----------|------|--------|
| OLS | LinearEngine.js | ✓ validated vs R (6 decimal places) |
| WLS (survey weights) | LinearEngine.js | ✓ runWLS — (X'WX)⁻¹X'WY, unweighted SSR for σ² |
| FE (within) | PanelEngine.js | ✓ |
| FD (first differences) | PanelEngine.js | ✓ |
| TWFE DiD | PanelEngine.js | ✓ |
| 2x2 DiD | PanelEngine.js | ✓ |
| 2SLS / IV | CausalEngine.js | ✓ |
| Sharp RDD | CausalEngine.js | ✓ IK bandwidth, triangular/epanechnikov/uniform kernel |
| McCrary density test | CausalEngine.js | ✓ |
| Logit / Probit | NonLinearEngine.js | ✓ IRLS/Newton-Raphson MLE — McFadden R², AIC/BIC, MEM, odds ratios |

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

## AI service details
- Model for narratives: `claude-sonnet-4-20250514`
- Model for unit inference: `claude-haiku-4-5-20251001` (fast, cheap)
- All prompts live in `services/ai/prompts/index.js`
- `SHARED_CONTEXT` (~800 tokens) is the cached block — always > 1024 tokens combined with any task prompt
- `callClaude({ system, user, maxTokens })` strips `SHARED_CONTEXT` from exported prompts before sending (it adds it as the cached block automatically)

## Pending (ordered by priority)
1. **Logit/Probit UI** — wire `NonLinearEngine.js` into `ModelingTab.jsx` + `EstimatorSidebar.jsx` + plots (ROC, confusion matrix, predicted probability histogram).
2. **Replication Package** — R script (started), Stata do-file, ZIP bundle UI.
3. **AuditTrail UI** — `components/validation/AuditTrail.jsx`, surfaces `auditor.js` output.
4. **Estimator validation vs R** — systematic benchmark: RDD (rdrobust), Panel FE (fixest), 2SLS (AER), Logit/Probit (base R `glm`).
5. **DuckDB-WASM** — final compute target for datasets > 50k rows.

## Reserved (post-MVP)
- `core/math/gmm/` — GMM, LIML
- `core/math/ml/` — DML, Lasso, Ridge, Forest
- `core/math/bayes/` — MCMC
- `services/data/stata.js` — .dta parser via readstat-wasm
- `services/data/fetchers/` — World Bank, OECD APIs
- `services/ai/agents/` — DataAgent, CausalAgent, WritingAgent
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
