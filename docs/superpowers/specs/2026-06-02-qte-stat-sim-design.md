# Spec — Quantile Treatment Effects (unconditional) in Stat & Simulation

**Date:** 2026-06-02
**Status:** OPEN
**Module:** Stat & Simulation (data-level, distributional two-sample comparison)
**Source of requirements:** LMU "Applied Causal Analysis" lecture — `index_qte_covAdjs.qmd`,
`part1_covariate_adjustment.qmd`, `part2_quantile_regression.qmd` (Butler–Broockman 2011;
Pennsylvania Re-employment Bonus experiment). Slides `QTE.pdf`, `lecture_03_no (2).pdf`.

## Goal

Add an **unconditional Quantile Treatment Effect** tool to Stat & Simulation: given a numeric
outcome and a binary treatment indicator, estimate

```
QTE_τ = F₁⁻¹(τ) − F₀⁻¹(τ)
```

over a τ grid, attach bootstrap confidence bands, and visualize it two ways (QTE-vs-τ curve with an
ATE reference line, and overlaid empirical CDFs showing the horizontal-distance reading). This is a
distributional generalization of the difference-in-means and directly reuses the seeded
bootstrap/PRNG infrastructure shipped in the inference-deepening spec.

## Why Stat & Simulation (not Modeling)

The course is explicit (`part2`, "Part A / Method 1"): **without covariates**, under random
assignment, the QTE is *identified as the difference in sample quantiles*
`F̂⁻¹(τ|D=1) − F̂⁻¹(τ|D=0)` — "the most transparent approach — directly analogous to computing
the ATE as a difference in sample means." Method 2 (quantile regression of Y on D) is shown to be
**numerically identical** to Method 1. So the unconditional case needs **no regression engine**:
it is a two-input distributional comparison over `number[]` columns — exactly the Stat & Simulation
contract (operate on column values, never on an `EstimationResult`), and it reuses the existing
`makeRNG`/`sampleWithReplacement`/`quantile` machinery.

**Deferred to a future Modeling spec (NOT in scope here):** covariate-adjusted QTE via quantile
regression `Q_τ(Y | D, X) = α(τ) + β(τ)D + γ(τ)'X` (the `rq(... )` route in `part2` "Part B").
That needs a genuine check-function / linear-program quantile-regression engine validated against
`quantreg::rq`, and the slides themselves frame the covariate case as the secondary, harder problem
(continuous covariates → kernel/propensity methods, the external `qte` package). It is **not on the
BA-thesis critical path**. We ship the unconditional tool first; only build the regression engine if
the unconditional tool proves its worth.

## Architectural invariants honoured

- **Zero React in `src/math/`** — new math is pure JS (`src/math/QTE.js`).
- **Single shared seeded PRNG** — bootstrap bands go through `rng.js` (`makeRNG`,
  `sampleWithReplacement`); every run is replayable from an echoed seed.
- **No new UI libraries** — UI is inline styles + `C` color object + `mono`; the QTE/CDF plots are
  hand-drawn SVG in the same style as `MCHistogram` in `SimulateTab.jsx`.
- **Surgical edits** — new math file + new panel component; wire into `StatWorkspace.jsx` with a
  collapsible section. No rewrites.
- **Self-contained script export** — emitted R/Python/Stata replicate by loading/simulating data
  and computing the quantile difference; they never reference a fitted model object.

---

## Section 1 — Math: `src/math/QTE.js` (new file)

### 1.1 Core estimator

```
quantileTreatmentEffect(outcome, treatment, {
  taus = [0.1, 0.25, 0.5, 0.75, 0.9],   // grid; UI may pass seq(0.1,0.9,0.05)
  treatedLevel = null,                   // value of `treatment` counted as treated; null ⇒ max level
  transform = "none",                    // "none" | "log"
  ci = "percentile",                     // "none" | "percentile" | "basic" | "bca"
  B = 2000,
  alpha = 0.05,
  seed = null,
}) → {
  taus, qte[], q0[], q1[],               // per-τ: estimate and each group's quantile
  ate, mean0, mean1,                     // difference-in-means benchmark (dashed line in plot)
  n0, n1, treatedLevel, controlLevel, transform,
  ci: { type, low[], high[] } | null,    // per-τ band (omitted when ci === "none")
  ecdf0: {x[], F[]}, ecdf1: {x[], F[]},  // step coordinates for the overlaid-CDF plot
  seed,
}
```

Implementation notes:

- **Group split.** `treatment` is cleaned to finite/defined entries paired row-wise with `outcome`;
  rows where either side is non-finite (after transform) are dropped. The control level is the
  *other* distinct value; if `treatment` has >2 distinct values, return an error
  (`"Treatment must be binary; found k levels."`). Default `treatedLevel` = the larger level
  (so `tg=2` vs `tg=0` and `1` vs `0` both behave like the slides).
- **Transform.** `"log"` applies `Math.log` and drops non-positive outcomes (with a count in the
  result so the UI can warn), matching `log(inuidur1)` in `part2`.
- **Quantiles.** Reuse the **type-7 linear-interpolated** empirical quantile already in
  `Resampling.js` (`idx = p·(n−1)`, linear interp) — this matches R's default `quantile(type=7)`,
  so point QTEs validate against R to 6 dp.
- **ATE.** `mean1 − mean0` on the (transformed) outcome — the dashed benchmark line; equals the OLS
  coefficient of Y on D, per `part1`'s APE/ATE identity.
- **Bootstrap band.** One seeded `makeRNG(seed)`; for `b = 1..B`, resample **within each group**
  with replacement (`sampleWithReplacement`), recompute the full τ-vector of QTEs, store. Per τ:
  percentile / basic / BCa band computed exactly as `bootstrapStatistic` does (BCa reuses the same
  `z0`/acceleration logic; acceleration via a per-τ jackknife over the pooled within-group LOO).
  Keep replicates out of the returned object by default (memory) — return only the per-τ band.
- **ECDF coordinates.** Sorted unique outcome values per group with cumulative proportion ≤ x, for
  the CDF plot (`stat_ecdf` analogue).

### 1.2 Reuse, don't duplicate

`QTE.js` imports `makeRNG`, `sampleWithReplacement` from `rng.js` and the `quantile` helper. If the
`quantile`/`clean` helpers in `Resampling.js` are not exported, export them (surgical) rather than
copy-pasting — single source of truth for the type-7 quantile.

---

## Section 2 — UI: `src/components/tabs/statsim/QTEPanel.jsx` (new) wired into `StatWorkspace.jsx`

A collapsible "▸ Quantile Treatment Effects" section, same visual grammar as the existing
resampling/test panels:

- **Inputs:** outcome column select, treatment column select, τ-grid (preset chips
  `{0.1,0.25,0.5,0.75,0.9}` / `seq(0.1,0.9,0.05)` / custom comma list), transform toggle
  (none / log), CI type (none / percentile / basic / BCa), B, seed.
- **Outputs:**
  1. **QTE table** — τ, Q̂₀, Q̂₁, QTE, CI low/high (when CI ≠ none).
  2. **QTE-vs-τ plot** (SVG) — QTE point/line across τ, shaded CI ribbon, dashed horizontal ATE line
     with an "OLS (ATE)" label — matching `plot_qte_1` + the dashed `geom_hline` in `part2`.
  3. **Overlaid empirical CDFs** (SVG) — control vs treatment step curves; at a hovered/selected τ
     draw the **horizontal arrow** between the two crossings to make `QTE_τ` visible (the
     "reading QTEs from the CDF plot" callout in `part2`).
- **SessionLog:** on each successful run, `appendLog({ module:"stat", opType:"qte", params:{ outcome,
  treatment, taus, transform, ci, B, seed }, label:\`QTE: \${outcome} ~ \${treatment} (τ grid, seed=\${seed})\` })`
  — project's actual payload shape.

`QTEPanel` is also embedded under simulated data in `SimulateTab.jsx` the same way `SampleTestPanel`
is, so users can simulate an RCT and immediately read its QTE curve.

---

## Section 3 — Validation

Add a suite to the existing Node harness (`src/math/__validation__/inferenceValidation.js`) and the
R reference (`inferenceRValidation.R`):

- **Point QTE vs R** — `quantile(Y1, τ, type=7) − quantile(Y0, τ, type=7)` for a fixed small
  fixture; assert engine `qte[]` matches to **6 dp** (deterministic — no RNG).
- **Equivalence check** — engine QTE at each τ equals the `rq(Y ~ D, tau=τ)$coef[2]` value to 6 dp
  (Method 1 == Method 2 identity from `part2`).
- **ATE check** — engine `ate` equals `lm(Y ~ D)` slope to 6 dp.
- **Bootstrap band** — method/coverage sanity only, loose 1e-2 band (seed-dependent; R's RNG ≠
  mulberry32 — same rationale as the existing bootstrap cross-check cell).

---

## Section 4 — Out of scope (explicit)

- Covariate-adjusted QTE / quantile regression (`rq(Y ~ D + X)`) — future Modeling spec.
- Simultaneous (uniform) confidence bands across τ — percentile/BCa pointwise bands only for now.
- The external `qte` package's continuous-covariate kernel/propensity estimators.

## Section 5 — File-touch checklist

| File | Change |
|------|--------|
| `src/math/QTE.js` | NEW — `quantileTreatmentEffect` + helpers |
| `src/math/Resampling.js` | export `quantile`/`clean` if not already (single source) |
| `src/math/index.js` | barrel-export `quantileTreatmentEffect` |
| `src/components/tabs/statsim/QTEPanel.jsx` | NEW — panel + 2 SVG plots |
| `src/components/tabs/statsim/StatWorkspace.jsx` | mount collapsible QTE section |
| `src/components/tabs/SimulateTab.jsx` | embed `QTEPanel` under generated data (mirror `SampleTestPanel`) |
| `src/math/__validation__/inferenceValidation.js` | add `qte` suite |
| `src/math/__validation__/inferenceRValidation.R` | add `quantile`/`rq`/`lm` reference block |
| `ClaudePlan.md` | flip this spec's index row to IN PROGRESS / DONE as work lands |
