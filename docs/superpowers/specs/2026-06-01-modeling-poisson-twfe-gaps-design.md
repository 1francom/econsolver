# Design: Modeling Engine — Poisson TWFE & Count-Panel Gaps (ModelingSpec)
**Date:** 2026-06-01
**Status:** Draft / Proposed
**Scope:** Close the estimator gaps that block replication of an `fixest`-based count-panel research design, then extend the modeling stack toward modern count/DiD econometrics.

---

## Background

A replication audit of two Bachelor-thesis modeling scripts (`validation/BA check/Regressions_2016.R`, `Event_study.R` — crime-around-schools in CABA) found that the **entire econometric design rests on one estimator family Litux does not fully support**:

- **~100 models are `fepois(...)` with two high-dimensional fixed effects `| grid_id + date` and clustered SE** (`cluster = ~grid_id`, also `~comuna`, `~barrio`).
- The event study is **Sun-Abraham (`sunab(cohort_bim, bim_idx)`) run through `fepois`** with two-way FE — explicitly chosen to "correct TWFE heterogeneity bias" (Event_study.R:7).
- Heavy use of `fixest` formula sugar: `*` full interaction expansion, `:` interaction-only, **triple interactions** (`n_pub_schools:is_school_time:poverty_rate`), `i(factor, continuous, ref)` (franja-specific slopes), and **`i(f1, f2, ref, ref2)` factor×factor saturated interactions** (Regressions_2016.R:705–739).
- Post-estimation: `(exp(β)-1)*100` semi-elasticities, coefficient forest plots, `etable` → LaTeX, and a **joint F-test on cohort×time interactions** (Event_study.R:1315).

**What Litux already has (non-gaps):**
- `runPoisson` (NonLinearEngine.js:301) — Poisson with HC/clustered SE **and an offset** column.
- `runPoissonFE` (NonLinearEngine.js:446) — **one-way** entity-FE Poisson (IRLS, alpha-per-unit absorbed, McFadden R², AIC/BIC with `kTotal = k + nUnits`), with clustered SE working via `computeRobustSE` on the within-demeaned design (NonLinearEngine.js:671).
- Two-way FE for **OLS** (TWFE double-demean, PanelSuffStatsEngine) + TWFEDiD + classic EventStudy (PanelEngine).
- Continuous×dummy interaction (`factor_interactions` step, runner.js:1235), pairwise `ix`, `did`.
- Model comparison, model buffer, Spec Curve (H8), LaTeX stargazer, coefficient forest plots (PlotBuilder G13, ModelPlots).

**Architectural invariants (must hold):**
- `src/math/` stays **pure JS**, no React.
- Every engine accepts an explicit `seType`/`seOpts`; never hardcode the SE variant. Default `"classical"`.
- New estimators land via the `add-estimator` path: engine → barrel (`math/index.js`) → EstimatorSidebar → ModelConfiguration → EstimationResult shape → ModelPlots.
- R-validate to 6 dp on coefficients, 4 dp on SE — against `fixest::fepois`, `sunab`, with fixtures in `src/math/__validation__`.

---

## Part A — Critical gaps (block replication)

### A1. Two-way fixed effects for Poisson — **the central blocker**
**fixest:** `fepois(y ~ X | grid_id + date, cluster = ~grid_id)`.
**Today:** `runPoissonFE` absorbs a **single** `unitCol`; the within-demeaning (NonLinearEngine.js:653) is one-dimensional. **None of the ~100 thesis models replicate exactly** without a second FE dimension.
**Why hard:** the one-way engine absorbs `alpha_u` analytically. Two-way (and N-way) FE in a GLM requires **iterative within-transformation of the IRLS working response/weights each Newton step** (Gaure / Correia method of alternating projections), since FE don't separate in the nonlinear link. This is materially more than the OLS double-demean.

**Proposed API:**
```
runPoissonFEMulti(rows, yCol, xCols, feCols /* [unit, time, ...] */, seOpts={}, {offsetCol, tol, maxIter})
  → EstimationResult { beta, se, ..., feDims, droppedSingletons, nFE }
```
- Alternating-projection demean of weighted X and working response z over all `feCols` inside each IRLS iteration.
- df = n − k − Σ(levels per FE) + (nFE − 1) overlaps; singleton-dropping per FE dimension.
- Clustered/HC SE via existing `computeRobustSE` on the final multi-demeaned design (A4 below).
**UI:** ModelConfiguration "Poisson FE" gains a **multi-FE selector** (add grid_id, date, …) mirroring the OLS TWFE control.
**Validation:** `fixest::fepois(y ~ x | f1 + f2)` coef 6 dp, clustered SE 4 dp.

### A2. Sun-Abraham heterogeneity-robust event study (on Poisson)
**fixest:** `fepois(y ~ sunab(cohort, period) + X | unit + period, cluster=~unit)` (Event_study.R:803–831, 654, 1171).
**Today:** Litux has a **classic** TWFE EventStudy (PanelEngine) — the exact specification Sun-Abraham (2021) was designed to fix under staggered/heterogeneous treatment. No cohort-interacted, saturated, weight-aggregated estimator exists, and certainly not over Poisson.
**Proposed:** `runSunAbraham(rows, yCol, xCols, {cohortCol, periodCol, refPeriod, feCols, family:"poisson"|"ols"}, seOpts)`:
- Build saturated `cohort × relative-period` interaction dummies (drop ref period + never-treated cohort).
- Estimate via `runPoissonFEMulti` (A1) or OLS TWFE.
- **Aggregate** interaction coefficients to event-time ATTs using cohort-share weights; delta-method SE on the linear combination.
**Depends on:** A1 (multi-FE Poisson) + A3 (saturated factor interactions) + A4 (clustered SE) + A5 (linear-combination/joint test for aggregation).
**UI:** new "Event Study (Sun-Abraham)" estimator; cohort + period selectors, family toggle.
**Validation:** `fixest::sunab` aggregated ATTs + SE.

### A3. fixest interaction operators in the UI (`i()`, `*`, `:`, triple)
**fixest formula sugar used:** `A*B*C` (main + all 2-way + 3-way), `A:B:C` (interaction-only), `i(factor, continuous, ref)` (factor-specific slopes, ref dropped), **`i(f1, f2, ref, ref2)`** (factor×factor saturated, two refs).
**Today:** replicable only by hand — `dummy` then `factor_interactions` (continuous×dummy) then many `ix` — and **factor×factor saturated and triple interactions have no native builder**. Error-prone; the thesis formulas cannot be typed directly.
**Proposed:** a thin **interaction-term builder** in ModelConfiguration (not a full formula parser):
- `i(factor, continuous, ref)` → auto-dummy(factor, drop ref) × continuous.
- `i(f1, f2, ref, ref2)` → full cross-dummy product minus reference cells.
- `*` expansion (main + interactions) and triple via nested products.
- Emits pipeline steps (`dummy` + `factor_interactions` + `ix`) so the design stays inspectable and exportable.
**Validation:** column-equivalence vs `model.matrix`/`fixest` design.

### A4. Clustered & multi-way SE for multi-FE Poisson
**Used:** `cluster = ~grid_id`, `~comuna`, `~barrio`.
**Today:** one-way clustered SE works for one-way Poisson FE. Once A1 lands, the multi-demeaned design must thread `seOpts` (cluster var, two-way CGM) through `computeRobustSE` exactly as the one-way path does (NonLinearEngine.js:671).
**Proposed:** ensure `runPoissonFEMulti` passes final multi-demeaned `X̃`, `resid`, and `valid` (carrying cluster cols) to `computeRobustSE`; add two-way cluster for Poisson (CGM) parallel to OLS.
**Validation:** `fepois(..., cluster=~g)` and `cluster=~g+t` SE 3–4 dp.

---

## Part B — Moderate gaps

| # | Gap | Script ref | Proposal |
|---|-----|-----------|----------|
| B1 | **Joint hypothesis test** (Wald/F on a coefficient set) | Event_study.R:1315 joint F on cohort×time; pre-trend tests | Post-estimation `waldTest(result, terms)` → χ²/F + p; UI "joint test" picker over selected coefficients. Also powers A2 aggregation. |
| B2 | **Semi-elasticity / IRR display** `(exp(β)−1)·100` | Regressions_2016.R:33,203,1047 | Built-in transform toggle for log/Poisson results: show IRR `exp(β)`, % effect, and delta-method CI alongside raw β. |
| B3 | **Batch model families + etable table** | A1–A9, b1–b9, c1–c8, W/s/z/q families; `etable` → LaTeX | Mostly covered (ModelComparison, model buffer, Spec Curve, stargazer). Gap = a **formula-family generator** (vary outcome / controls / cluster across a grid of specs) and a denser multi-model LaTeX matching `etable`. |

---

## Part C — "And more" (round out the count / DiD stack)

- **C1. Negative Binomial (`fenegbin`) + quasi-Poisson / overdispersion test.** Natural companion to Poisson for over-dispersed counts; the thesis leans on cluster-robust Poisson but a dispersion check + NB is the standard robustness move. New `runNegBin` / `runNegBinFE`; Cameron-Trivedi dispersion test.
- **C2. Offset / exposure in Poisson FE.** `runPoisson` already supports `offsetCol`; `runPoissonFE`/`runPoissonFEMulti` should too (rate models, `log(exposure)`).
- **C3. Modern staggered-DiD estimators.** Callaway-Sant'Anna (group-time ATT), de Chaisemartin-D'Haultfœuille (`did_multiplegt`), Borusyak imputation. Sun-Abraham (A2) is the first; this is the suite.
- **C4. Conditional (CML) Poisson FE** (Hausman-Hall-Griliches) — exact conditional-likelihood FE Poisson, an alternative to LSDV-style absorption for incidental-parameters robustness.
- **C5. Wild cluster bootstrap** for few clusters — comuna (~15) and barrio (~48) clustering have few groups; CRVE is unreliable. `boottest`-style WCR p-values/CIs. High value given the thesis clusters at comuna/barrio for robustness.
- **C6. Average marginal effects (AME) / `predict`** for nonlinear models — fitted values, AME with delta-method SE (Litux has MEM for logit; generalize).
- **C7. LR / Wald model-comparison stats** in the comparison table (nested-model tests).

---

## Implementation notes
- **A1 is the unlock.** A2 (Sun-Abraham), A4 (clustered multi-FE SE), C1 (NB-FE), C2 (offset-FE) all compose on the multi-FE IRLS demeaning kernel. Build and R-validate `runPoissonFEMulti` first.
- **Reuse, don't fork:** the IRLS skeleton, singleton-dropping, McFadden/AIC/BIC, and `computeRobustSE` wiring already exist in `runPoissonFE` — extend the demeaning step from one-way to alternating-projection N-way rather than writing a new engine.
- **Performance:** large-n Poisson already has a DuckDB IRLS fast path (Fase 6, one-way). Two-way demeaning in SQL is a later fast-path; JS first, validate, then push down.
- **A3 interaction builder emits pipeline steps**, keeping the design matrix inspectable and exportable to R/Python/Stata (no opaque formula engine).

## Validation plan
`src/math/__validation__/modelingGapsRValidation.R` → `modelingGapsBenchmarks.json` → `window.__validation.modelingGaps`. Targets: `fixest::fepois(y ~ x | g + t, cluster=~g)`, `sunab` aggregated ATTs, two-way cluster, NB-FE vs `fenegbin`. Tolerances: coef 6 dp, SE 4 dp (3 dp for bootstrap/df-sensitive cells).

## Priority & sequencing
1. **A1 two-way (N-way) Poisson FE** — unblocks the entire thesis + most of Part C.
2. **A4 clustered/multi-way SE** for multi-FE Poisson (thread through `computeRobustSE`).
3. **A3 interaction builder** + **B2 IRR/semi-elasticity** — independent UX, high leverage.
4. **A2 Sun-Abraham** + **B1 joint test** — the event-study arc.
5. **C1/C2/C5** (NB, offset-FE, wild bootstrap) — robustness layer.
6. **C3/C4/C6/C7** — modern-DiD suite + nonlinear marginal effects, opportunistic.
