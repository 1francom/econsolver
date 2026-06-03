# Spec A — Stat & Simulation inference deepening (data-level)

**Date:** 2026-06-01
**Status:** OPEN
**Module:** Stat & Simulation (data-level statistics only)
**Source of requirements:** "Applied Causal Inference" NotebookLM notebook (potential outcomes, finite-sample exact permutation inference, asymptotic validity of bootstrap/parametric tests).

## Goal

Deepen the inference toolkit in the Stat & Simulation module along three axes the user prioritised:

1. **Parametric hypothesis tests** — go beyond the existing one-sample mean / variance / generic-parameter tests.
2. **General bootstrap + reproducibility** — arbitrary statistic, three CI flavours, jackknife, and a single seeded RNG so every run is replayable.
3. **Permutation / randomization inference** — generalize the existing two-sample-mean permutation test to arbitrary statistics with exact enumeration when feasible.

## Hard scope boundary (why this is Spec A, not Spec B)

This spec covers **data-level inference only** — tests and resampling computed directly on numeric columns of loaded or simulated data. Inference on **regression coefficients of a pinned model** (bootstrap/permutation of β) is explicitly **out of scope** and deferred to **Spec B (Modeling module)**.

**Why the split:** the user requires that script export — both the *unified* script and the *separate* scripts — replicate cleanly. If a model is pinned in Modeling and a test/bootstrap on its coefficients lived in a different module, the generated R/Python/Stata scripts would have to stitch state across modules. Keeping data-level inference in Stat & Simulation and coefficient-level inference attached to the pinned model in Modeling keeps each generated script self-contained.

**How to apply:** every function and UI surface in this spec operates on `number[]` column values, never on an `EstimationResult`. Standalone scripts emitted here load/simulate data and run the test — they never reference a fitted model object.

## Architectural invariants honoured

- **Zero React in `src/math/`** — all new math is pure JS (`SampleTests.js`, `Resampling.js`, `rng.js`).
- **No new UI libraries** — UI extensions use inline styles + the `C` color object + `mono`.
- **Surgical edits** — extend existing files in place; no full rewrites.
- **Reproducibility** — a single shared seeded PRNG replaces all `Math.random` use in resampling.

---

## Section 1 — Parametric hypothesis tests

### 1.1 Math — `src/math/SampleTests.js` (extend in place)

Existing exports kept unchanged: `oneSampleMeanTest`, `varianceTest`, `parameterTest`.

New exports, all following the existing result contract
`{ test, n, estimate, sd, se, df, nullValue, statLabel, stat, alternative, pValue }`
(plus a few test-specific fields noted below), and all reusing the existing helpers
`finite`, `clamp01`, `pFromCdf`, `cleanNumeric`, `sampleMoments`:

| Function | Signature | Statistic | Distribution |
|----------|-----------|-----------|--------------|
| `twoSampleMeanTest` | `(a, b, { alternative, pooled=false, mu0=0 })` | difference of means | Welch t (default) or pooled t |
| `pairedMeanTest` | `(a, b, { alternative, mu0=0 })` | mean of paired diffs | t, df = n−1 |
| `onePropTest` | `(successes, n, { p0=0.5, alternative })` | (p̂−p₀)/√(p₀(1−p₀)/n) | z (normal approx) |
| `twoPropTest` | `(s1, n1, s2, n2, { alternative })` | pooled-proportion two-sample z | z |
| `correlationTest` | `(a, b, { method="pearson"\|"spearman", alternative })` | r·√((n−2)/(1−r²)) | t, df = n−2 |
| `varianceRatioTest` | `(a, b, { alternative })` | s²ₐ / s²_b | F, df = (nₐ−1, n_b−1) |

Details:

- **Welch** df via Welch–Satterthwaite; **pooled** uses pooled variance with df = nₐ+n_b−2. The `pooled` flag selects between them. Result carries `estimate` = (x̄ₐ − x̄_b), plus `meanA`, `meanB`, `nA`, `nB`.
- **Paired** test cleans to pairs where *both* values are finite (drops a row if either side is NaN), then runs `oneSampleMeanTest` semantics on the diffs.
- **Proportions** validate `0 ≤ successes ≤ n` and `n ≥ 1`; result carries `phat` (and `phat1`/`phat2` for two-prop). `statLabel: "z"`.
- **Spearman** ranks both vectors (average ranks for ties) then applies the Pearson formula on ranks; carries `method` in the result.
- **Variance ratio** needs an **F CDF** that does not yet exist in `calcEngine.js` — see 1.3.

Each function returns `{ error: "…" }` on degenerate input (n<2, zero variance, out-of-range counts) — matching the existing convention so `SampleTestPanel` can render the error string.

### 1.2 UI — `src/components/tabs/statsim/SampleTestPanel.jsx` (extend in place)

Current modes: `mean | variance | parameter` (single column select). Add modes:

- `two-mean` — **two** column selectors (variable A, variable B) + a "pooled / Welch" toggle.
- `paired` — two column selectors.
- `two-prop` — four numeric inputs (s₁, n₁, s₂, n₂) — no column needed, like the existing `parameter` mode.
- `one-prop` — two numeric inputs (successes, n) + p₀ field.
- `correlation` — two column selectors + Pearson/Spearman toggle.
- `var-ratio` — two column selectors.

Implementation notes:
- Add a `colNameB` state + a second `<select>` rendered only for the two-column modes.
- Add `pooled` (bool), `corrMethod` ("pearson"|"spearman"), and proportion-count states (`s1,n1,s2,n2,succ,nObs,p0`).
- The result-rendering block gains branches keyed on `result.test` for the new shapes (difference of means with both group means; correlation r; F ratio). Reuse the existing gold result-card styling.
- `H0_LABEL` / `STAT_GLYPH` maps extended: add `two-mean → "H₀: μₐ − μ_b ="`, `paired → "H₀: μ_d ="`, `correlation → "H₀: ρ ="`, `one-prop → "H₀: p ="`, `two-prop → "H₀: p₁ − p₂ ="`, `var-ratio → "H₀: σ²ₐ/σ²_b ="`; glyph `F → "F"`.

Both the Stat tab (`StatWorkspace`) and Simulate tab (`SimulateTab`) already mount this panel — no wiring change needed; they just gain the new modes for free.

### 1.3 `calcEngine.js` — add `pf`

Add an exported `pf(x, df1, df2)` (F-distribution CDF) built on the **already-present** internal `_incompleteBeta`:

```
F_CDF(x; d1, d2) = I_{ (d1·x)/(d1·x + d2) }( d1/2, d2/2 )   for x > 0, else 0
```

Export it alongside `pt`/`pnorm`/`pchisq` and add it to the `calc` barrel object (lines ~489). `SampleTests.js` imports `pf` for `varianceRatioTest`.

---

## Section 2 — General bootstrap + reproducibility

### 2.1 Shared RNG — new file `src/math/rng.js`

Single source of truth for seeded pseudo-randomness, eliminating the three duplicated `mulberry32` copies (SimulateTab, StatWorkspace) and the unseeded `Math.random` in Resampling.js.

```js
export function mulberry32(seed)            // returns () => float in [0,1)
export function makeRNG(seed)               // mulberry32; if seed null/undefined → seed from Date.now()+random, returns { rand, seed }
export function randInt(rand, nExclusive)   // integer in [0, n)
export function shuffle(rand, arr)          // Fisher-Yates, returns NEW array
export function sampleWithReplacement(rand, arr, m)  // returns NEW array length m
```

`makeRNG` returns the resolved seed so the UI can display "seed used: N" even when the user left the field blank (auto-seed), making auto-seeded runs reproducible after the fact.

### 2.2 Math — `src/math/Resampling.js` (extend in place)

Keep existing exports (`bootstrapMean`, `subsampleMean`, `permutationTwoSampleMean`) as thin wrappers for backward compatibility, but route them through the new seeded engine.

Replace direct `Math.random` / local `shuffleInPlace` with imports from `rng.js`.

New statistic registry (pure functions on `number[]`):

```js
const STATISTICS = { mean, median, sd, variance, trimmedMean10, iqr }
```

New exports:

- `bootstrapStatistic(values, statName, { B=2000, alpha=0.05, ciType="percentile", seed=null })`
  - `ciType ∈ {"percentile","basic","bca"}`.
  - **percentile**: `[Q(α/2), Q(1−α/2)]` of the bootstrap replicates.
  - **basic**: `[2θ̂ − Q(1−α/2), 2θ̂ − Q(α/2)]`.
  - **BCa**: bias-correction `z₀` from the proportion of replicates < θ̂ (via `qnorm`/`pnorm`), acceleration `a` from the **jackknife** skewness of the statistic; adjusted percentiles. Falls back to percentile CI if `a`/`z₀` are non-finite (e.g. zero-variance statistic).
  - Returns `{ stat: statName, estimate: θ̂, B, alpha, ciType, ciLow, ciHigh, bootSE, bias, seed, replicates }`.
- `jackknife(values, statName)`
  - Returns `{ estimate, jackEstimate, bias, se, values: leaveOneOutEstimates }` (leave-one-out).
- The CI quantile uses the existing linear-interpolated `quantile` helper.

### 2.3 UI — `StatWorkspace.jsx` resampling section (extend in place)

The existing Resampling & permutation section (~lines 960–1130) gains:

- A **statistic** dropdown (mean / median / sd / variance / trimmed-mean / IQR) for the bootstrap mode.
- A **CI type** dropdown (percentile / basic / BCa).
- A **seed** input (blank = auto; the resolved seed is shown after running).
- The `ReplicateHistogram` already exists — feed it `result.replicates`; overlay the CI bounds as two `vline`s.
- StatWorkspace's local `mulberry32`/`makeRNG` is deleted in favour of importing from `rng.js`.

`SimulateTab` and `StatWorkspace` both switch their PRNG import to `rng.js` (no behavioural change — same algorithm, now shared).

---

## Section 3 — Generalized permutation / randomization inference

### 3.1 Math — `src/math/Resampling.js`

New export:

- `permutationTest(a, b, statName, { B=2000, exact=null, seed=null, alternative="two-sided" })`
  - **Statistic** drawn from the same `STATISTICS` registry but applied as a **two-group** contrast: `diffMeans`, `diffMedians`, `diffSd`, plus `meanRatio`. (Registry of *contrasts* separate from the single-sample `STATISTICS`.)
  - **Exact enumeration** when `exact` is true, or when `exact` is null and the number of distinct group-A choices `C(nA+nB, nA) ≤ 50_000`. Enumerate all splits of the pooled sample into sizes (nA, nB), compute the contrast for each, and get the exact permutation p-value.
  - **Monte Carlo** otherwise: shuffle the pooled labels `B` times via the seeded RNG.
  - **p-value** keeps the existing +1 finite-sample correction for Monte Carlo: `p = (1 + #{|t*| ≥ |t_obs|}) / (B + 1)`; exact enumeration uses the unbiased count over all permutations (no +1).
  - `alternative` selects two-sided / greater / less on the contrast.
  - Returns `{ stat, contrast, observed, pValue, exact: bool, nPerm, seed, replicates, alternative }`.
- `permutationTwoSampleMean` becomes a wrapper: `permutationTest(a, b, "mean", {...})` with the mean-difference contrast.

The 50 000 enumeration threshold is a guard against combinatorial blow-up; above it we fall back to seeded Monte Carlo transparently and the result's `exact` flag tells the UI which path ran.

### 3.2 UI — `StatWorkspace.jsx`

The permutation mode gains a **contrast** dropdown (diff of means / medians / sd / ratio of means), an **alternative** dropdown, and reuses the shared seed input. The result card shows `exact: yes/no` and `nPerm`.

---

## Section 4 — Standalone script export + SessionLog

Each data-level inference operation must emit a **standalone** R / Python / Stata snippet that loads or simulates the data and runs exactly that test — self-contained, never referencing a pinned model.

### 4.1 Snippet generators

Add small generators (co-located with the existing `generateCalcScript` in StatWorkspace, or a new `src/services/export/statInferenceScript.js` if the switch grows large) producing:

| Op | R | Python | Stata |
|----|---|--------|-------|
| two-sample mean | `t.test(a, b, var.equal=)` | `scipy.stats.ttest_ind(a,b,equal_var=)` | `ttest a == b, unpaired` |
| paired | `t.test(a, b, paired=TRUE)` | `scipy.stats.ttest_rel(a,b)` | `ttest a == b` |
| one/two prop | `prop.test(x, n)` | `statsmodels.stats.proportion.proportions_ztest` | `prtest` / `prtesti` |
| correlation | `cor.test(a, b, method=)` | `scipy.stats.pearsonr` / `spearmanr` | `pwcorr, sig` / `spearman` |
| variance ratio | `var.test(a, b)` | `scipy.stats.f_oneway`-adjacent / manual F | `sdtest a == b` |
| bootstrap | `boot::boot` + `boot.ci(type=c("perc","basic","bca"))` | `scipy.stats.bootstrap` | `bootstrap, reps(): summarize` |
| permutation | explicit `replicate()` loop with `set.seed()` | seeded numpy loop | `permute` |

All seeded snippets emit `set.seed(N)` / `numpy.random.seed(N)` / `set seed N` using the **resolved** seed from `makeRNG`, so the generated script reproduces the in-app result.

### 4.2 SessionLog

Each run logs to the cross-module `SessionLog` (`useSessionLog`) as a **`stat`-module** op (module tag `"stat"`), recording test name, columns/inputs, key result (stat, p, CI), and seed. This keeps the audit trail consistent with how other modules log, and — critically — tags these as data-level so Spec B's model-coefficient ops stay distinguishable in the unified-script assembly.

---

## Section 5 — R validation plan

Validate every new statistic against R to the project standard (**6 dp on the statistic/estimate, 4 dp on SE / CI bounds**), with hard benchmarks added to the `__validation__` harness:

| New function | R reference |
|--------------|-------------|
| `twoSampleMeanTest` (Welch + pooled) | `t.test(a, b, var.equal=FALSE/TRUE)` |
| `pairedMeanTest` | `t.test(a, b, paired=TRUE)` |
| `onePropTest` / `twoPropTest` | `prop.test(..., correct=FALSE)` (normal approx, no continuity correction) |
| `correlationTest` (pearson/spearman) | `cor.test(a, b, method="pearson"/"spearman")` |
| `varianceRatioTest` | `var.test(a, b)` |
| `bootstrapStatistic` perc/basic/bca | `boot::boot` + `boot.ci(type=c("perc","basic","bca"))` with matched seed |
| `permutationTest` exact | hand-enumerated exact permutation p-value for small n |

Bootstrap CI validation uses a fixed seed on both sides; because R's RNG ≠ mulberry32, validate the **method** (CI formula) by feeding R and JS the *same* replicate matrix where possible, or accept a tolerance band (1e-2 on CI bounds) for seed-dependent cells, mirroring how the DuckDB HAC/HC2/HC3 cells use a loosened tolerance.

---

## Files touched (summary)

**New:**
- `src/math/rng.js` — shared seeded PRNG.
- `docs/superpowers/specs/2026-06-01-stat-sim-inference-deepening-design.md` — this spec.
- (optional) `src/services/export/statInferenceScript.js` — if snippet generators outgrow StatWorkspace.

**Modified:**
- `src/math/SampleTests.js` — 6 new parametric tests.
- `src/math/Resampling.js` — `bootstrapStatistic`, `jackknife`, `permutationTest`, statistic/contrast registries, seed via `rng.js`; existing exports become wrappers.
- `src/math/calcEngine.js` — add `pf` (F CDF) + barrel entry.
- `src/components/tabs/statsim/SampleTestPanel.jsx` — new modes (two-mean, paired, one/two-prop, correlation, var-ratio) + second column selector + count inputs.
- `src/components/tabs/statsim/StatWorkspace.jsx` — statistic/CI/seed/contrast controls; drop local PRNG; import `rng.js`; SessionLog tagging.
- `src/components/tabs/SimulateTab.jsx` — import PRNG from `rng.js` (drop local copy).
- `__validation__/engineValidation.js` (+ R fixtures) — benchmarks for all new functions.

## Out of scope (Spec B, later)

- Bootstrap / permutation of **regression coefficients** of a pinned model.
- Any inference surface in the Modeling module (`CoefficientTestPanel.jsx`, `ModelHypothesis.js`).
- Randomization inference for treatment effects tied to an estimated model.
