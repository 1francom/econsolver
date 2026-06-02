# Plan: BA-Thesis Replication Roadmap
**Date:** 2026-06-01
**Status:** Proposed
**Goal:** Make the four BA-thesis R scripts (`validation/BA check/`) fully replicable in Litux. Sequences the three audit specs — SpatialSpec, ModelingSpec, DescriptiveVizSpec — into one executable order, gated by the dependencies between them.

---

## Source specs
| Spec | Covers | File |
|------|--------|------|
| SpatialSpec | data-prep: areal interp, buffer exposure, expand_grid, spatial weights/regression | `specs/2026-06-01-spatial-engine-gaps-design.md` |
| ModelingSpec | two-way Poisson FE (blocker), Sun-Abraham, interaction builder, clustered SE | `specs/2026-06-01-modeling-poisson-twfe-gaps-design.md` |
| DescriptiveVizSpec | pivot_wider, quantiles, Table 1, static choropleth, dodge, KDE | `specs/2026-06-01-descriptive-viz-gaps-design.md` |

## The four scripts and what each needs
| Script | Litux coverage today | Blocking gaps |
|--------|---------------------|--------------|
| `Data preparation _oficial.R` | ~70% (grid, joins, distance, buffers exist) | Spatial A1 areal interp, A2 buffer exposure, A3 buffer-count, A4 expand_grid |
| `Summary statistics.R` | partial (group_summarize, nearest-neighbour) | Desc A1 pivot_wider, A2 quantiles, B1 overdispersion, C1 KDE |
| `Regressions_2016.R` | **blocked** (one-way Poisson FE only) | **Model A1 two-way Poisson FE**, A3 interaction builder, A4 clustered SE, B2 IRR |
| `Event_study.R` | **blocked** | Model A2 Sun-Abraham (needs A1+A3+A4), B1 joint F-test |
| `graphs and plots.R` | partial (PlotBuilder, Map tab choropleth) | Desc A3 static choropleth+labels, B2 position_dodge, B3 etable (≈done) |

---

## Dependency graph (what unblocks what)
```
Spatial A1 (areal interp) ──┐
Spatial A2 (buffer exposure)├─► Data-prep replicable ──► real panel to model on
Spatial A3 (buffer count)   │
Spatial A4 (expand_grid) ───┘

Model A1 (two-way Poisson FE)  ── THE central unlock
   ├─► Model A4 (clustered multi-FE SE)
   ├─► Model A2 (Sun-Abraham)  ── also needs A3 + B1
   └─► (composes: NB-FE, offset-FE — ModelingSpec Part C)
Model A3 (interaction builder: i(), *, :, triple)  ── independent, feeds A2
Model B1 (joint Wald/F)  ── feeds A2 aggregation
Model B2 (IRR/semi-elasticity)  ── independent UX

Desc A1 (pivot_wider) ─┐
Desc A2 (quantiles)   ─┼─► Desc B3 (Table 1 LaTeX)
                       └─► Desc C2 (cross-tab margins)
Desc A3 (static choropleth)  ── reuses buildColorScale, independent
Desc B2 (position_dodge)     ── thin PlotBuilder add, independent
Desc C1 (KDE heatmap)        ── independent, math-heavy
```

---

## Phases (executable order)

### Phase 1 — Data-prep parity (unblocks the real dataset)
**Spec:** SpatialSpec Part A.
1. ~~Spatial **A4 expand_grid** runner step~~ — **DONE via existing `balance_panel` step** (2026-06-02). `balance_panel` (registry + runner + `PanelTab.jsx` UI) already does entity × time × slot cross-expansion + constant fill of missing outcomes + static-control copy-by-entity — i.e. the thesis `expand_grid` + `left_join` + `coalesce(0)` fused into one step. Covers the `907 × 295 × 4` panel. A standalone general-N-column `expand_grid` primitive was judged redundant for replication and skipped.
2. Spatial **A1 areal-weighted interpolation** (`polygonOverlapWeights` + `arealInterpolate`) — the polygon area + clip/union primitive. This primitive also serves A2/A3 and Part C.
3. Spatial **A2 buffer dissolve + exposure share** (`dissolveBuffers` + `gridExposureShare`).
4. Spatial **A3 buffer-count overlap** (`countBuffersIntersectingGrid`).
**Exit:** `Data preparation _oficial.R` produces an equivalent grid×date panel; R-validate column-by-column.

### Phase 2 — Descriptive layer (pure runner.js, low risk)
**Spec:** DescriptiveVizSpec A1, A2, B1, B3.
1. **A1 pivot_wider** + **A2 quantile agg** in runner.js/registry.js.
2. **B1 overdispersion stat** (var/mean + Cameron-Trivedi) in Explorer.
3. **B3 Table 1 LaTeX export** (composes on A2).
**Exit:** `Summary statistics.R` tables reproduce (minus KDE map, deferred to Phase 5).

### Phase 3 — The modeling unlock (the central blocker)
**Spec:** ModelingSpec A1, A4, A3, B2.
1. ~~**A1 `runPoissonFEMulti`**~~ — **ENGINE DONE + R-VALIDATED (2026-06-02).** Alternating-projection (Gaure/Correia) weighted MAP within-demeaning inside IRLS; barrel-exported; UI wired (ModelConfiguration multi-FE selector → ModelingTab routes to `runPoissonFEMulti` when >1 FE dim; SQL fast-path guarded to JS fallback for multi-FE; `wrapPoissonFE` exposes `nFE`/`feDims`/`feLevels`/drops; result panel shows N-way badge + absorbed-FE dims). R-validation vs `fepois(y ~ x1+x2 | f1+f2)` (fixest 0.14.0, R 4.4.1, shared CSV, 30×12 balanced panel): **coef exact to 8 dp, logLik exact, HC0 SE ~6 dp, cluster-f1 SE matches fixest-nossc × CR1 correction ~5-6 dp, two-way cluster meat matches (~2% on the finite-sample multiplier — documented df-adjustment divergence).** Browser validation still PENDING — see "Validations pending (Phase 3 A1)" below.
2. **A4 clustered/multi-way SE** for multi-FE Poisson — thread `seOpts` through `computeRobustSE` on the final multi-demeaned design.
3. **A3 interaction builder** (`i()`, `*`, `:`, triple) — emits pipeline steps (`dummy` + `factor_interactions` + `ix`), design stays inspectable.
4. **B2 IRR / `(exp(β)−1)·100`** display toggle.
**Exit:** all ~100 `Regressions_2016.R` models replicate to 6 dp coef / 4 dp SE.

### Phase 4 — Event study
**Spec:** ModelingSpec A2, B1.
1. **B1 joint Wald/F test** (`waldTest`) — also powers A2 aggregation.
2. **A2 `runSunAbraham`** — saturated cohort×period, aggregate to event-time ATTs, delta-method SE. Composes on Phase 3.
**Exit:** `Event_study.R` Sun-Abraham ATTs + joint F-test replicate.

### Phase 5 — Publication graphics
**Spec:** DescriptiveVizSpec A3, B2, C1.
1. **A3 static choropleth** fill-by-var + centroid labels in the geo plot tab (reuse `buildColorScale`).
2. **B2 position_dodge** in PlotBuilder (grouped errorbar/pointrange → coefficient gradient plot).
3. **C1 2-D KDE heatmap** (`kde2d` → raster overlay) — validate vs `bkde2D`.
**Exit:** `graphs and plots.R` figures reproduce.

### Phase 6 — Robustness & "and more" (opportunistic)
Spatial Part C (spatial weights, Moran's I, SAR/SEM/SLX/SDM), ModelingSpec Part C (NB-FE, offset-FE, wild cluster bootstrap, Callaway-Sant'Anna/dCDH/Borusyak, AME), DescriptiveVizSpec Part C (cross-tab margins, correlation heatmap, faceting, ECDF/Lorenz, map furniture). Drive by user demand, not the thesis.

---

## Validation
Each phase R-validates before the next starts (Franco's rule: browser-validate before proceeding). Fixtures per spec:
`spatialEngineGapsRValidation.R`, `modelingGapsRValidation.R`, `descriptiveVizRValidation.R` → respective `*Benchmarks.json` → `window.__validation.*`. Tolerances: coef 6 dp, SE 4 dp (3 dp for bootstrap/df-sensitive cells).

### Validations pending (Phase 3 A1 — multi-FE Poisson UI) — PENDING, browser
R-validation vs `fepois` already passed (coef 8 dp). Remaining = browser checks on a real dataset before this lands as fully DONE:
1. **One-way no-op:** PoissonFE with entity only, no extra FE → identical coefs/SE to pre-change `runPoissonFE` (confirms the existing path is untouched).
2. **Two-way FE:** entity + 1 extra FE (e.g. time) → `2-way FE` badge, formula `Poisson(y) ~ x | entity + time`, "Absorbed Fixed-Effect Dimensions" block shows correct level counts, coefs ≈ `fepois(y ~ x | f1 + f2)`.
3. **SE types:** toggle HC0 / clustered / two-way in InferenceOptions → SE values change (flow through `computeRobustSE`).
4. **PPML separation:** dataset with an all-zero-Y or singleton FE level → "dropped levels" badges appear, `n` falls accordingly, no crash.
5. **Large n (>200k):** confirm multi-FE falls back to the JS engine (SQL single-FE fast-path is guarded), no single-FE-only SQL run.
6. **Replication code (KNOWN GAP, separate task):** CodeEditor R/Python/Stata export for PoissonFE was NOT extended for multiple FE dims — likely emits a single FE. Decide whether to extend (own task) or document the limitation.

## Critical path
**Phase 1 → Phase 3** is the spine: real panel, then the two-way Poisson FE engine. Everything else (descriptive, event study, graphics) hangs off those two. **Model A1 (`runPoissonFEMulti`) is the single most important deliverable** — it unblocks the entire modeling and event-study arc plus most of ModelingSpec Part C.
