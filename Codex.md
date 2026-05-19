# Litux / EconSolver Technical Handoff

This document summarizes the current product/code readiness audit and gives Claude Code a direct implementation roadmap. The app is deployed on Vercel today, but broad public usage by economics students, junior researchers, and non-programmers should wait for a stabilization phase.

## Product Goal

Litux should let users do data cleaning, spreadsheet-style edits, exploratory analysis, econometric modeling, replication exports, and eventually finance/general data analysis without writing code.

The core promise is:

1. Load data.
2. Inspect quality.
3. Clean and transform through an auditable pipeline.
4. Edit individual cells when needed.
5. Explore data visually.
6. Estimate models.
7. Export reproducible scripts, tables, charts, and reports.

The app is already close to this shape, but several runtime and architecture risks should be handled before a larger user phase.

## Current Architecture Snapshot

- Frontend: React + Vite.
- Deployment: Vercel, with `npm run build` as the build command.
- Persistence: IndexedDB, scoped by current Supabase user.
- Auth/API: Supabase auth and Edge Functions.
- Data engine: JavaScript arrays for most operations, DuckDB-WASM for large CSV/Parquet loading and table paging.
- Wrangling model: non-destructive pipeline steps replayed from raw data.
- Cell edits: represented as internal `patch` pipeline steps, not silent mutations.
- Econometrics: mostly pure JavaScript engines in `src/math`.
- AI: centralized in `src/services/AI/AIService.js`.
- Export: R, Python, Stata, replication bundle utilities.

Important files:

- `src/App.jsx`: root shell, dashboard, data viewer.
- `src/DataStudio.jsx`: dataset manager and wrangling shell.
- `src/WranglingModule.jsx`: pipeline orchestrator.
- `src/pipeline/runner.js`: applies pipeline steps.
- `src/pipeline/registry.js`: step metadata registry.
- `src/services/data/duckdb.js`: DuckDB-WASM singleton and loaders.
- `src/components/ModelingTab.jsx`: modeling orchestration.
- `src/components/PlotBuilder.jsx`: interactive plot builder.
- `src/components/wrangling/*`: cleaning, features, reshape, merge UI.
- `src/math/*`: econometric/statistical engines.

## Deployment vs Lint Reality

Vercel currently runs `npm run build`, and the build passes. That means the app can deploy.

However, `npx.cmd eslint src` currently reports many errors. This is not automatically a Vercel deployment blocker unless lint is added to the build command, but it is a launch-readiness blocker because lint catches runtime-risk code paths.

Key distinction:

- Passing build means the app bundle can be produced.
- Failing lint means some UI paths may still crash when a user clicks them.

Before broad users, fix the real runtime-risk lint errors first, especially `no-undef`, hook-order errors, and stale/broken feature branches.

## Runtime Bugs And Why They Matter

Runtime bugs affect both Vercel and future local/desktop installs:

- On Vercel, a broken tab or button throws in the browser for public users.
- In a packaged desktop/local app, the same bug is shipped inside the installer and cannot be fixed until the user updates.
- Non-programmer users usually cannot recover from console errors, so these become trust failures rather than technical annoyances.

High-priority runtime-risk classes:

- Undefined symbols in components.
- Conditional hook calls.
- Components/functions created inside render when they hold state.
- Direct user flows that silently fail because errors are swallowed.
- Large-data workflows that freeze the browser.

## Known Launch Blockers

Fix these before a large objective-user phase:

1. ~~Lint/runtime risks~~ — DONE (2026-05-18)
   - `npx.cmd eslint src` audited: 55 issues surfaced, 7 critical runtime bombs fixed (no-undef, hook-order).
   - Remaining lint entries are stylistic warnings, not runtime risks.

2. Edit cells flow
   - Verify the full path: enter edit mode, edit a cell, create `patch` step, rerun pipeline, undo/remove patch, persist, reload project, export.
   - Current architecture is good because `patch` is auditable.
   - Weakness: `patch` uses `__ri`, which survives most cleaning steps but can become ambiguous after reshape operations like `pivot_longer` or `group_summarize`.

3. Large data execution
   - DuckDB loads full large files and exposes 500-row previews.
   - Estimation currently extracts all rows from DuckDB into JavaScript before modeling.
   - That uses full data statistically, but can freeze/crash on large datasets.

4. Supabase proxy security
   - `claude-proxy` is intentionally open today.
   - Before public AI use, add JWT validation, subscription/tier checks, and rate limits.

5. ~~Documentation/onboarding~~ — DONE (2026-05-18)
   - Root `README.md` replaced with user-facing and developer-facing content.

6. Open bugs from feedback
   - `.dta` loading correctness. — **PENDING**
   - Plot sizing/responsiveness. — open
   - ~~Spatial multipolygon geometry.~~ — DONE (2026-05-18)
   - Spatial grid border clipping. — open (Sutherland-Hodgman approach pending)
   - ~~Vague modeling errors such as "Matrix is singular or insufficient data."~~ — DONE (2026-05-18)
   - Edit cells flow — DONE (2026-05-18, minor bugs remain on watch)
   - DuckDB-WASM large-data freeze — DONE (2026-05-18)

## DuckDB Direction

DuckDB should become the data and matrix preparation engine for larger datasets.

Current large-data flow:

```text
DuckDB table
-> extract all rows into JavaScript objects
-> build Y and X matrices in JavaScript
-> estimate in JavaScript math engine
```

Better flow:

```text
DuckDB table
-> SQL builds model frame / Y / X columns
-> SQL applies filters, casts, missing-value drops, factor expansion
-> JavaScript receives compact numeric arrays or sufficient statistics
-> existing JS math engine estimates
```

For OLS, DuckDB can go further:

```text
DuckDB computes X'X, X'Y, Y'Y, n, column means
-> JavaScript receives small matrices
-> JavaScript computes beta = inv(X'X) X'Y
```

This is better because `X'X` is `k x k`, where `k` is number of regressors, not number of rows.

### DuckDB Implementation Milestones

1. Add a model-frame builder.
   - Inputs: DuckDB table name, y variable, x variables, weights, filters, factor variables, pipeline context.
   - Output: SQL-safe model frame with numeric-only columns.
   - Responsibilities: cast numeric fields, drop rows with missing model variables, apply filters, expand dummies/factors.

2. Add OLS sufficient-statistics path.
   - Compute `X'X`, `X'Y`, `Y'Y`, `n`.
   - Keep current JS matrix inverse and result formatting.
   - Validate against current JS OLS on small datasets.

3. Add WLS sufficient-statistics path.
   - Compute weighted cross-products.
   - Validate against current `runWLS`.

4. Add FE/TWFE preparation.
   - Start by demeaning in SQL using grouped aggregates/window functions.
   - Then pass compact de-meaned matrices to existing engines.

5. Add guardrails.
   - Estimate from preview only should never happen silently.
   - If a method requires full row extraction, show a clear warning for large datasets.
   - Add row/column thresholds and browser-memory-safe errors.

## Spreadsheet / Excel / PowerBI Direction

The existing `patch` cell-edit feature is the right base primitive.

Build upward in this order:

1. Spreadsheet basics
   - Editable grid.
   - Fill-down/fill-column.
   - Column formulas.
   - Formula preview before apply.
   - Undo via pipeline history.

2. Pivot Table Builder
   - Use existing `group_summarize` / reshape ideas.
   - UI should feel like Excel pivot tables: rows, columns, values, filters.
   - Output should be a new derived dataset and/or an auditable pipeline step.

3. Interactive Charts
   - Build on `PlotBuilder.jsx`.
   - Save chart configurations.
   - Let charts react to filters/slicers.
   - Export SVG/PNG plus reproducible code where possible.

4. PowerBI-lite dashboard layer
   - Multiple saved charts.
   - Shared filters/slicers.
   - Dataset relationships/joins.
   - Calculated columns and eventually calculated measures.

5. Finance/general analysis extension
   - Financial time series importers.
   - Returns/log returns.
   - Rolling means/regressions.
   - Volatility and drawdown.
   - Portfolio weights and performance.
   - CAPM/Fama-French-style factor models.
   - Event studies.

Recommended first new feature after stabilization: Pivot Table Builder powered by the existing pipeline.

## Product Workflow Improvements

For non-programmers, prioritize guided flows over raw controls.

Good target workflow:

```text
Load data
-> automatic quality report
-> suggested fixes
-> one-click preview
-> apply as pipeline step
-> explore
-> model with method guidance
-> diagnose model
-> export/report
```

Important UX principles:

- Never silently mutate data.
- Always preview destructive or broad transformations.
- Keep raw data recoverable.
- Explain model errors in user language.
- Prefer "Fix this" actions over only textual advice.
- Keep all AI-generated transformations confirmable before apply.

The AI Coach dispatch design in `docs/superpowers/specs/2026-05-17-ai-coach-dispatch-design.md` is the correct direction: diagnose, propose a fix, navigate to the right tool, confirm, preview, then apply.

## Suggested Stabilization Sprint

Sprint goal: make Litux reliable enough for a controlled beta.

1. ~~Make build and lint meaningful~~ — DONE (2026-05-18)
   - `npm.cmd run build` passes.
   - `no-undef` and hook-order errors fixed (7 critical bombs out of 55 surfaced).

2. Verify critical flows manually and with tests.
   - Upload CSV/XLSX/DTA.
   - Edit cell and reload.
   - Add cleaning step.
   - Create feature.
   - Make plot.
   - Run OLS.
   - Export replication bundle.

3. Add smoke tests.
   - Use minimal fixture datasets.
   - Cover pipeline replay.
   - Cover `patch`.
   - Cover `group_summarize`.
   - Cover OLS.

4. Harden large datasets.
   - Add DuckDB model-frame builder.
   - Avoid silent full extraction for huge datasets.
   - Add user-facing warnings and fallback choices.

5. Lock down Supabase AI proxy.
   - Require JWT.
   - Check tier/subscription.
   - Add basic rate limiting.
   - Keep service role keys out of client code.

6. Improve docs.
   - Replace Vite README.
   - Add "How to test core flows."
   - Add "Known limitations."
   - Add "Data privacy and AI usage."

## Code Structure Refactor Suggestions

Do not do a giant rewrite. Refactor by workflow.

Recommended target modules:

```text
src/features/data/
src/features/wrangling/
src/features/explore/
src/features/modeling/
src/features/reporting/
src/features/spatial/
src/features/calculate/
src/features/ai/
src/shared/ui/
src/shared/data/
src/shared/math/
```

First extraction targets:

- Move `DataViewer` out of `App.jsx`.
- Move dashboard/project management out of `App.jsx`.
- Split `ModelingTab.jsx` into:
  - model state/hooks
  - estimate dispatch
  - result rendering
  - export controls
  - diagnostics/coach integration
- Split `SpatialTab.jsx` into parser, layer controls, grid tools, joins, map rendering.
- Split `CalculateTab.jsx` into calculator, symbolic math, simulations, probability tools.

Avoid changing behavior during refactor. Move code first, then improve.

## Testing Priorities

Add tests around pure logic first:

- `src/pipeline/runner.js`
  - `patch`
  - `filter`
  - `mutate`
  - `group_summarize`
  - `pivot_longer`
  - `join`

- `src/math/*`
  - OLS
  - WLS
  - FE/FD
  - 2SLS
  - RDD
  - Logit/Probit

- `src/services/data/parsers/*`
  - Stata variants.
  - RDS happy-path and error messages.
  - Shapefile multipolygon cases.

- `src/services/export/*`
  - R/Python/Stata code generation for common pipelines.

Then add UI smoke tests for the critical journey.

## Quality Bar Before Broad Beta

Minimum acceptable state:

- Production build passes.
- Lint has no real runtime-risk errors.
- Core flows tested manually.
- Top feedback bugs resolved or documented.
- AI proxy protected.
- Large dataset behavior is clear and guarded.
- User-facing docs exist.
- Error messages are understandable to non-programmers.

## Highest-Leverage Next Task

Updated 2026-05-18:

1. ~~Fix `no-undef` runtime risks~~ — DONE.
2. ~~Verify and repair edit-cells end to end~~ — DONE (minor bugs remain on watch).
3. ~~Build the first DuckDB model-frame helper for OLS~~ — DONE (DuckDB-WASM integration shipped).
4. Add `patch` pipeline tests (smoke fixtures: patch survives reshape/group_summarize, undo, reload, export).
5. Fix `.dta` parser correctness (next data-tab priority).
6. Lock down Supabase `claude-proxy` (JWT + tier + rate limits) before broader public AI use.

This sequence protects current users and creates the technical base for Excel/PowerBI-style expansion.
