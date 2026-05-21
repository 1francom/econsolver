# Pre-Launch Roadmap — Econ Studio

**Date:** 2026-05-21
**Owner:** Franco Medero
**Status:** Active. This is the spine for all work between today and the v1 launch.

## Premise

Before adding new features, we validate and correct every module we have using the same rigor we applied to the estimators: reference implementation in R (or theoretical truth), hard benchmarks file, browser validation harness, and tolerance-gated acceptance.

The DuckDB sufficient-statistics work (Fases 0–4) established the validation pattern. Fases 4b–8 finish that track. Tracks B and C apply the same pattern across spatial, calculate, simulation, plots, pipeline, replication, AI, performance, and bug-bash.

## Track structure

Three parallel tracks. Each fase has its own implementation plan filed under `docs/superpowers/plans/`. This spec only lists what each fase covers, its current status, and its position in the queue.

```
Track A — Estimator SQL push-down completion (in flight)
Track B — Module hardening (R validation parity for non-estimator modules)
Track C — Cross-cutting hardening (pipeline, replication, AI, perf, bugs)
```

Track A is sequential — each fase depends on the previous. Tracks B and C can run in parallel after Fase 4b ships, on any agent with a free slot.

## Validation pattern (every fase follows this)

1. **Reference truth.** R script under `src/services/data/__validation__/fase<N>RValidation.R` (or theoretical moments for DGPs).
2. **Hard benchmarks file.** `fase<N>Benchmarks.json` (or `.csv` if structured table) — committed.
3. **Browser validation harness.** `fase<N>Validation.js` exposed at `window.__validation.fase<N>`. Returns a structured per-cell pass/fail report.
4. **Tolerances.** Point estimates: 6 dp (1e-6). Standard errors: 4 dp (1e-4). Diagnostics statistics: 1e-6. Visual diffs (Track B Plot fase): structural, not pixel — see the Plot fase plan for the geom-by-geom checklist.
5. **Acceptance gate.** All cells pass at documented tolerance. No regression of prior fases. Bug fixes documented in CLAUDE.md "Key bugs fixed".
6. **Commit cadence.** One commit per logical file group; sequence documented in the plan's "Commits" task.

---

## Track A — Estimator SQL push-down completion

| Fase | Title | Plan file | Status |
|---|---|---|---|
| 4b | TWFE + panel robust SE | `2026-05-21-duckdb-fase-4b-twfe-panel-se.md` | **NEXT** for Sonnet / Codex |
| 5 | DiD 2×2 + TWFE DiD + Event Study | `2026-05-21-duckdb-fase-5-did-eventstudy.md` | Drafted (needs Fase 4b first) |
| 6 | IRLS (Logit, Probit, Poisson FE) | `2026-05-21-duckdb-fase-6-irls.md` | Drafted |
| 7 | Sharp + Fuzzy RDD | `2026-05-21-duckdb-fase-7-rdd.md` | Drafted |
| 8 | Robust-SE backfill (2SLS, WLS, LIML) | not yet written | Implementation complete pending browser validation |

### Fase 8 — Robust-SE backfill (consolidated)

Single plan covering the deferred SE variants that were not yet written:

- **2SLS:** HC2, HC3, cluster, twoway, HAC. Extends `duckdbIVRobustSE.computeIVHCMeat`.
- **WLS:**  HC2, HC3, cluster, twoway, HAC. Extends `duckdbWLSRobustSE.computeWLSHCMeat`.
- **LIML:** HC0, HC1, cluster, HAC. Currently classical-only. Mirrors 2SLS robust patterns.

Decision: **consolidated** plan (not three sub-fases). The meat-builder pattern is reusable across estimators, and the test matrix benefits from a single R validation script that covers all three at once.

- **Fase 8 implementation complete (2026-05-21):** `duckdbWLSRobustSE` now covers weighted HC2/HC3, one-way cluster, two-way cluster, and HAC score meats. `duckdbIVRobustSE` mirrors those paths on fitted IV design rows. `LIMLSuffStatsEngine` accepts robust meat so LIML can reuse HC0/HC1, clustered, and HAC SQL builders. Self-contained R fixtures and `window.__validation.fase8` cover the backfill; browser validation remains pending.

---

## Track B — Module hardening

Each fase follows the validation pattern. The reference is R when an R equivalent exists; otherwise theoretical truth from first principles. Plans for V1–V4 not yet written — see "Sequencing" below.

### Fase V1 — Spatial validation

**Scope:** every function in `src/math/SpatialEngine.js` and `src/services/data/parsers/shapefile.js` validated against R `sf`.

| Operation | EconSolver fn | R reference |
|---|---|---|
| Haversine distance | `haversineDistance` | `sf::st_distance` with `longlat=TRUE` |
| Euclidean distance | `euclideanDistance` | `sf::st_distance` with `longlat=FALSE` |
| Buffer assign | `assignToBuffers` | `sf::st_buffer` + `sf::st_intersects` |
| Rectangular grid | `assignToGridRect` | manual grid construction + `st_intersects` |
| H3 grid | `assignToGridH3` | `h3jsr::point_to_cell` |
| Spatial join | `spatialJoin` | `sf::st_join` |
| Nearest neighbor | `nearestNeighbor` | `sf::st_nearest_feature` |
| Polygon-in-polygon | grid clipping path | `sf::st_intersection` (area-weighted) |
| Shapefile parse | `parseShapefile` | `sf::st_read` |
| Geocoding | `GeocodeSection` cache | known-coordinate truth set for München, Berlin, LMU |

**Tolerances:**
- Distance (haversine, planar): 1 m absolute, 1e-6 relative.
- Polygon area: 1e-6 relative.
- Point-in-polygon: exact match on assignment IDs across a 1k-row test set.
- Geocoding: ±50 m on known landmarks; document provider precision limits.

**Known bugs to verify fixed during this fase:** MULTIPOLYGON parsing, grid clipping at irregular shapefile borders, per-op dataset selector (per `spatial-module` skill notes in memory).

Plan file: `docs/superpowers/plans/2026-05-22-fase-v1-spatial-validation.md` (to write).

### Fase V2 — Calculate tab validation

**Scope:** every expression and operation in `src/components/tabs/CalculateTab.jsx`. The Calculate tab is a free-form computation surface — users enter expressions and the tab evaluates them.

**What to audit:**
- Expression parser: operator precedence, unary minus, parentheses, function calls.
- Built-in functions: `log`, `exp`, `sqrt`, `abs`, `round`, `mean`, `sum`, `sd`, `var`, `quantile`, `cor`, `cov`, plus the units helper.
- NA / NaN / Inf propagation: every function must match R's `NA` semantics (NA in → NA out, except aggregations with `na.rm=TRUE` behavior documented).
- Type coercion: string → number paths, date arithmetic, factor levels.
- Edge cases: empty inputs, single-element vectors, division by zero, log of negative.

**Reference:** R direct evaluation of the same expression. The validation script generates a CSV with `expression`, `expected_result`, `r_eval_log` columns; harness re-evaluates each expression in EconSolver and diffs.

**Tolerances:** numerical 1e-10; NA/NaN/Inf must match exactly.

Plan file: `docs/superpowers/plans/2026-05-22-fase-v2-calculate-validation.md` (to write).

### Fase V3 — Simulation (DGP) validation

**Scope:** every DGP in `src/components/tabs/SimulateTab.jsx` and supporting math in `src/math/`. DGPs generate data with known parameters; the validation confirms (a) the data has the theoretical moments and (b) the estimators recover the true parameters.

**DGPs to validate:**
- OLS: classical linear with normal errors. Check: β̂ → β; σ̂² → σ²; SE coverage at 95%.
- IV / 2SLS: instrument relevance (F > 10), exogeneity (cov(Z, ε) = 0); β̂_2SLS → β.
- DiD: parallel trends pre-treatment; ATT recoverable.
- Event Study: event-time pattern visible; β̂_k → β_k.
- Panel FE: entity effects absorb; β̂ within → β.
- Logit / Probit: latent-variable formulation; β̂ from glm matches.
- RDD: discontinuity at cutoff with correct LATE recovered.
- Spatial: spatial AR structure produces autocorrelated residuals at correct lag.

**Validation approach:**
1. Generate N = 1e6 replications in R with `simstudy` or hand-coded.
2. Compute sample moments (mean, var, cov) from R.
3. Generate N = 1e6 in EconSolver, compute same moments.
4. Compare moments at 3 dp.
5. Estimate β̂ at N = 1e5; check |β̂ − β| < 2·SE.

**Bonus deliverable:** a small "DGP catalog" PDF documenting which DGP corresponds to which estimator, with the theoretical setup and the EconSolver knobs.

Plan file: `docs/superpowers/plans/2026-05-22-fase-v3-simulation-validation.md` (to write).

### Fase V4 — Plot validation

**Scope:** `PlotBuilder.jsx`, all geoms in `ModelPlots.jsx`, `ResidualPlots.jsx`, forest plots in `ReportingModule.jsx`.

**Reference:** ggplot2 (referenced PDFs at `.claude/skills/ggplot2/`). The `ggplot2-plot-design` skill is already authoritative — this fase is the audit that confirms code matches the skill.

**Structural checks (not pixel diffs):**
- Scale expansion: ggplot2 expands x/y limits by 5% by default; verify PlotBuilder matches.
- Legend ordering: factor levels in original order, not alphabetical.
- Boxplot grouping: `fill = factor` produces side-by-side boxes, not stacked.
- Color palettes: dark theme uses `C.teal` / `C.gold` / `C.blue` consistently.
- Facets (if implemented): facet labels match ggplot2 strip styling.
- Error bars / CI ribbons: half-width is 1.96·SE for 95% CI, not 1·SE.
- Forest plots: coefficient ordering bottom-to-top with intercept omitted.
- ROC curves (Logit/Probit): TPR/FPR axes 0–1, diagonal reference line at slope 1.
- First-stage scatter (2SLS): fitted line uses first-stage β, not naïve regression.
- DiD plot: pre/post group means with treatment-difference annotation.
- Event Study plot: 0-line at reference period (k = −1), CI ribbons.

**Acceptance:** for each plot type, produce a side-by-side screenshot vs a ggplot2-generated equivalent on the same data; reviewer (Franco) confirms structural parity.

Plan file: `docs/superpowers/plans/2026-05-22-fase-v4-plot-validation.md` (to write).

---

## Track C — Cross-cutting hardening

These fases are independent of the estimator track. Each can run on any free agent slot.

### Fase X1 — Pipeline runner reliability

**Scope:** `src/pipeline/runner.js` and the 23 step types listed in CLAUDE.md.

- Each step type tested in isolation: input → expected output table.
- Composability: apply 10 random steps, undo all, redo all → output equals raw.
- IndexedDB round-trip: save, reload, re-apply → identical hash.
- Non-destructive guarantee: rawData unchanged after all replays.
- Registry / runner sync check: every step in runner has a registry entry and vice versa.

Plan file: `docs/superpowers/plans/2026-05-22-fase-x1-pipeline-reliability.md` (to write).

### Fase X2 — Replication bundle integrity

**Scope:** `src/services/export/replicationBundle.js` and the three script generators (`rScript.js`, `pythonScript.js`, `stataScript.js`).

- Every pipeline step type emits valid R / Python / Stata.
- Multi-subset bundle: `buildMultiSubsetBundle` produces N scripts that all execute cleanly.
- Smoke test: run the exported R script in actual R; assert exit code 0 and coefficient match within 1e-6 of EconSolver's reported estimates.
- Same for Python (statsmodels) and Stata (if a Stata license is available; otherwise script lint only).

Plan file: `docs/superpowers/plans/2026-05-22-fase-x2-replication-integrity.md` (to write).

### Fase X3 — AI service hardening

**Scope:** `src/services/AI/AIService.js`, prompts in `src/services/AI/Prompts/index.js`, privacy filters.

- Prompt caching: every `callClaude` request includes the cached SHARED_CONTEXT block and the cache-control header. Telemetry log confirms cache hit on subsequent calls.
- Privacy filter applied pre-egress for every call. Audit log of what fields were stripped per call.
- Variable inference accuracy: 100-variable test set with hand-coded ground-truth labels; assert ≥ 95% match.
- Coefficient interpretation guardrails: regression with known sign/magnitude → narrative does not invert sign or invent significance.
- Model routing: narratives → Sonnet, unit inference → Haiku. Assert via mocked client.

Plan file: `docs/superpowers/plans/2026-05-22-fase-x3-ai-hardening.md` (to write).

### Fase X4 — Performance + persistence

**Scope:** DuckDB-Wasm performance strategy (CLAUDE.md `DuckDB-Wasm performance strategy` section).

- COOP/COEP headers verified in `vercel.json` (threaded WASM).
- OPFS persistence: load a project, close tab, reopen → DuckDB table reuses OPFS Parquet without re-importing.
- Pipeline cache memory ceiling: `suffStatsCache` LRU at 50 entries stays under 10 MB at k=20.
- 900k-row benchmark suite: tab transitions, estimate, export all under 5 s.
- Memory leak check: 100 estimations in a row do not grow heap beyond 100 MB.

Plan file: `docs/superpowers/plans/2026-05-22-fase-x4-performance.md` (to write).

### Fase X5 — Bug bash + UX

**Scope:** every open item in `BugTriage.md` and unprocessed feedback in `ClaudeFB.md`.

- Sweep `BugTriage.md`: verify each open row against current code (per memory note: docs lag behind reality).
- Resolve or close each row with a commit reference.
- Sweep `ClaudeFB.md`: triage user feedback into fix-now / fix-later / wontfix.
- Tour overlay coverage: every tab has a TOUR_STEPS entry; HintBox content present.
- Visual polish: dark theme consistent across all tabs; IBM Plex Mono on all numeric output; `C` color constants used everywhere (no hex literals).

Plan file: `docs/superpowers/plans/2026-05-22-fase-x5-bug-bash.md` (to write).

---

## Queue / sequencing

```
NOW         Fase 4b (Sonnet/Codex) ────────────┐
                                                │
                                                ▼
NEXT        Fase 5  ◀── Fase 4b ships          (then 5 unblocked)
            Fase V1 (Spatial)                  ─┐
            Fase V2 (Calculate)                  │── parallel slot 1, 2, 3
            Fase X1 (Pipeline)                  ─┘
                                                │
LATER       Fase 6                              │
            Fase V3 (Simulation)                │── parallel slot 1, 2
            Fase X2 (Replication)              ─┘
                                                │
            Fase 7                              │
            Fase V4 (Plots)                     │── parallel slot 1, 2
            Fase X3 (AI)                       ─┘
                                                │
PRE-LAUNCH  Fase 8                              │
            Fase X4 (Perf)                      │── final cleanup
            Fase X5 (Bug bash)                 ─┘
```

Strict orderings:
- **Fase 4b → Fase 5** (DiD/EventStudy lean on TWFE).
- **Fase 4b → Fase 6** (Poisson FE wants entity FE in within space).
- **Fase 5, 6, 7 → Fase 8** (Fase 8 backfills SE on estimators that must already be SQL-pushed-down).
- **Fase X1 (Pipeline)** before any cross-cutting bug bash so X5 doesn't chase pipeline regressions.

Soft orderings:
- Track B (V1–V4) can interleave with Track A whenever a parallel slot is free.
- Track C (X1–X5) likewise, though X5 (bug bash) should be last so it sees the cumulative state.

## Out of scope (explicitly post-launch)

- `math/ml/` — DML, Lasso, Ridge, Forest.
- `math/bayes/` — MCMC samplers.
- `services/AI/agents/` — DataAgent, CausalAgent, WritingAgent.
- Tauri desktop packaging.
- Cloud sync (post-MVP per project memory).
- Plugin / extension system (post-adoption per project memory).
- Two-way clustering on panels (Fase 4c if needed).
- Staggered DiD with treatment heterogeneity (Callaway-Sant'Anna).
- Cluster bootstrap / wild bootstrap inference.

## Done criteria for pre-launch

The launch gate fires when:

1. **All Track A fases shipped.** OLS, FE, FD, TWFE, 2SLS, IV, WLS, GMM, LIML, Logit, Probit, Poisson FE, DiD 2×2, TWFE DiD, Event Study, Sharp RDD, Fuzzy RDD have:
   - A SQL fast path for n ≥ N_THRESHOLD.
   - Classical + at least HC0/HC1 robust SE on the SQL path.
   - Validated vs R at 6 dp coef / 4 dp SE.
2. **All Track B fases shipped.** Spatial, Calculate, Simulation, Plots — each has a `fase<V>Benchmarks.json` and a passing harness.
3. **Track C complete.** Pipeline, replication, AI, perf, bug bash — each has a completion commit.
4. **CLAUDE.md "Pending" list emptied** for items 1–10 (all marked done).
5. **`engineValidation.js` passes end-to-end** on a fresh load.
6. **One smoke-test project** loads, estimates 5 models, exports a replication bundle, regenerates the same coefficients in R — all in under 60 s.

---

**Updates to this doc:** when any fase ships, append a one-line entry to that fase's row with the shipping commit hash, and update CLAUDE.md "Pending" in the same commit.
