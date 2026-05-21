# DuckDB Sufficient-Statistics Roadmap — Design

**Date:** 2026-05-19
**Status:** Fase 0 + Fase 1 + Fase 2 DONE (2026-05-20). Fase 3 (3a 2SLS + 3b GMM/LIML + 3c WLS) DONE (2026-05-21). Fases 4–7 pending.
**Owner:** Franco Medero

**Status update (2026-05-21):** Fase 4 + 4b and Fase 5 (DiD + Event Study) are complete. Fases 6-7 remain pending.

## Problem

Estimation on large datasets (n ≥ 100k) is bottlenecked by `extractAllRows` materializing the DuckDB Arrow result into JS objects before any math runs. The matrix algebra itself is fast; row materialization is what hurts. Today only one estimator (OLS, classical SE, no factors, no weights) has a SQL-pushdown path (`buildOLSSuffStats`, commit `7bba121`). Every other estimator falls back to materialization.

This roadmap extends the sufficient-statistics approach across estimators and standardizes the dispatch decision, the cache, the residual contract, and the diagnostics surface.

## Goals

- Push **all bilinear/quadratic forms of rows × columns** to DuckDB SQL — the only data that crosses the JS boundary is matrices of size O(k²), never O(n).
- Keep `EstimationResult` shape stable so consumers (`ResidualPlots`, `QQPlot`, `DiagnosticsPanel`, `ModelComparison`) don't refactor on every fase.
- Make path selection automatic and invisible to the user. No new UI to choose between SQL and JS.
- Validate every new SQL path against the existing JS engine (1e-10 on coef, 1e-6 on SE) and against R hard benchmarks (unchanged from today).

## Non-goals

- Synthetic Control (Frank-Wolfe over donor pool — JS path is fine).
- AR / bootstrap / Monte Carlo (each replica reuses the dispatched path transitively).
- `math/ml/` and `math/bayes/` (post-MVP per CLAUDE.md).
- Server-side computation (privacy-first constraint — data never leaves the browser).

## Decisions made during brainstorming

1. **Threshold strategy:** hardcoded constants (`N_THRESHOLD=50_000`, `K_THRESHOLD=100`) in `dispatchConfig.js`. No UI knob, no runtime calibration.
2. **Residual contract from SQL path:** lazy sample. Engine returns `resid: null, yhat: null, _hasLazyResiduals: true, _residualsThunk: () => sampleResiduals(...)`. Consumers `await` the thunk when they need rows. Sample size = 5000, fixed.
3. **Robust SE in Fase 1:** HC0/HC1/HC2/HC3 (all four heteroskedasticity-robust). Cluster (1-way, 2-way CGM) and HAC ship in Fase 2.
4. **Diagnostics in Fase 1:** Breusch-Pagan, Durbin-Watson, Jarque-Bera, VIF, condition number. White, Breusch-Godfrey, Shapiro-Wilk stay on JS path until Fase 2. Shapiro permanently gated to n ≤ 5000 (statistical limit of the test).

## Architecture

Three-layer split with a single dispatcher:

```
ModelingTab.estimate()
       │
       ▼
┌─────────────────────────────────┐
│  duckdbDispatch.js              │  ← single gate (n, k, seType, factors, weights)
│  shouldUseSQLPath() → bool      │
└──────────┬──────────┬───────────┘
           │          │
       SQL path    JS path
           │          │
           ▼          ▼
┌─────────────────┐  ┌─────────────────┐
│ services/data/  │  │ math/           │
│  duckdb<X>.js   │  │  LinearEngine   │
│  duckdbRobust.. │  │  PanelEngine    │
│  duckdbDiag..   │  │  ...            │
└─────────┬───────┘  └─────────┬───────┘
          │                    │
          └─────────┬──────────┘
                    ▼
          EstimationResult
       (+ _isSample, _nFull, _hasLazyResiduals when SQL)
```

### Invariants

- `duckdbDispatch.shouldUseSQLPath()` is the **only** place that decides path. Neither `ModelingTab` nor any engine makes this decision independently.
- SQL engines live in `src/services/data/duckdb*.js`. `src/math/` stays pure JS — never imports DuckDB. Preserves the existing rule that math files are testable without a Wasm runtime.
- `EstimationResult` shape unchanged; new fields are additive and documented:
  - `_isSample: boolean` — residual array is a 5k sample, not full n
  - `_nFull: number` — true sample size behind the suff stats
  - `_hasLazyResiduals: boolean` — `_residualsThunk` must be awaited before reading `resid`/`yhat`
  - `_residualsThunk: () => Promise<{resid, yhat, _isSample, _nFull}>`
- **Path single per estimation.** If `shouldUseSQLPath` returns true, all subsequent operations on that result (SE recompute, diagnostics, residual sampling) go through SQL. No mixing mid-estimation.

## Fase 0 — Foundation: dispatcher, cache, instrumentation

### New files

```
src/services/data/
├── dispatchConfig.js
├── duckdbDispatch.js
├── suffStatsCache.js
└── perfLog.js
```

### `dispatchConfig.js`

```js
export const N_THRESHOLD = 50_000;
export const K_THRESHOLD = 100;
export const RESIDUAL_SAMPLE_SIZE = 5_000;
export const CACHE_MAX_ENTRIES = 50;
```

### `duckdbDispatch.shouldUseSQLPath(ctx)`

Cheap-first ordering:

1. `ctx.rawData._duckdb?.tableName` present — else JS.
2. `ctx.n >= N_THRESHOLD` — else JS.
3. `ctx.xColsExpanded.length <= K_THRESHOLD` — else JS (factor-expanded count).
4. `ctx.estimator` in SQL-supported set for current fase (Fase 0: `{OLS}`).
5. `ctx.seType` in supported set for current fase (Fase 0: `{classical}`; Fase 1: `+ HC0–3`; Fase 2: `+ cluster, twoway, HAC`).
6. `!ctx.hasWeights` — Fase 3 removes this check.
7. Factor expansion result still under `K_THRESHOLD` after expansion — Fase 1 removes the `!ctx.hasFactors` check.

Any failure → JS path. Silent. No warning to user.

### `suffStatsCache`

- `Map` instance held in `useRef` inside `ModelingTab`. Not IndexedDB, not persisted.
- Key: `${tableName}|${yCol}|${xCols.sort().join(',')}`. `seType` is **not** part of the key — suff stats don't depend on SE choice, only the meat pass does.
- Value: `{n, XtX, XtY, YtY, sumY, varNames, β, Ainv, ts}`.
- `β` and `Ainv` populated on first estimate; reused by subsequent meat passes (cheap SE flips).
- Invalidation: any `setPipeline` or `setRawData` clears the entire cache. Conservative but simple.
- LRU eviction at `CACHE_MAX_ENTRIES = 50`. Each entry ~200KB at k=20 → 10MB ceiling.
- Defensive validation on hit: if `XtX.length !== xCols.length + 1`, discard entry and invalidate cache (race protection).

### `perfLog`

- Ring buffer of last 50 estimates, in-memory.
- Schema: `{ts, path, estimator, n, k, seType, msExtract, msSQL, msMath, msTotal, sqlFailed?}`.
- Surfaced behind query param `?perf=1` — no new visible UI for normal users.
- Used to validate threshold empirically. If real-world data shows `N_THRESHOLD=50_000` is wrong, the constant gets adjusted in a one-line PR.

### Changes to `ModelingTab.estimate()`

Replace the existing ad-hoc gate (`OLS + classical + no weights + no factors + DuckDB present`) with:

```js
if (shouldUseSQLPath(ctx)) {
  return suffStatsPath(ctx);
}
return jsPath(ctx);  // extractAllRows + runOLS — unchanged from today
```

## Fase 1 — OLS complete in SQL

### New / modified files

```
src/services/data/
├── duckdbOLS.js              ← MOD: extend runOLSFromSuffStats with seType
├── duckdbFactors.js          ← NEW: expandFactors(), CASE WHEN dummies
├── duckdbRobustSE.js         ← NEW: HC0/HC1/HC2/HC3 meat pass
├── duckdbResiduals.js        ← NEW: sampleResiduals(), lazy
└── duckdbDiagnostics.js      ← NEW: BP, DW, JB
```

### Factor expansion (`duckdbFactors.js`)

- Input: `xCols = ['x1', 'factor(country)', 'x2']`, `tableName`.
- Detect `factor(col)` by regex. `SELECT DISTINCT col FROM table WHERE col IS NOT NULL ORDER BY col`. Drop first level as reference category.
- Output: `{xColsExpanded, dummySQL}` where:
  - `xColsExpanded = ['x1', 'country_DE', 'country_FR', ..., 'x2']`
  - `dummySQL = {country_DE: "CASE WHEN country='DE' THEN 1 ELSE 0 END", ...}`
- `buildOLSSuffStats` accepts optional `dummySQL` and substitutes `esc(col)` for the SQL expression when the name matches a dummy.
- If `xColsExpanded.length > K_THRESHOLD` after expansion → dispatcher falls to JS path. Rare but possible with country dummies on 200-country panels.

### Robust SE (`duckdbRobustSE.js`)

All prepared statements. β and Ainv elements passed as parameters, never string-interpolated.

```js
// HC0 / HC1: no leverages
computeHCMeat({tableName, yCol, xColsExpanded, dummySQL, β, hcType: 'HC0'|'HC1'})
  → meat[i][j] = Σ êᵢ² xᵢ xⱼ   via SUM(POWER(?, 2) * x_i * x_j)
  → HC1 scales by n/(n-k) in JS

// HC2 / HC3: leverages hᵢᵢ = xᵢ' Ainv xᵢ
computeHCMeatWithLeverage({tableName, yCol, xColsExpanded, dummySQL, β, Ainv, hcType: 'HC2'|'HC3'})
  → h_expr = SUM over j,k of Ainv[j][k] * x_j * x_k   (all aᵢⱼ as bound params)
  → denom = POWER(1 - h, p)   with p=1 (HC2) or p=2 (HC3)
  → meat[i][j] = Σ (êᵢ² / denom) xᵢ xⱼ
```

`runOLSFromSuffStats({suff, seType, dummySQL, tableName, yCol, xCols})`:
- If `seType === 'classical'`: β, SE, t, p, F all from suff stats. Zero extra SQL passes.
- If `seType ∈ {HC0, HC1}`: one extra SQL pass via `computeHCMeat`.
- If `seType ∈ {HC2, HC3}`: one extra SQL pass via `computeHCMeatWithLeverage`. Ainv computed in JS once and cached on suffStats entry.
- Sandwich variance: `V = Ainv · meat · Ainv`, all (k+1)×(k+1) matrices in JS.

### Lazy residuals (`duckdbResiduals.js`)

```js
sampleResiduals({tableName, yCol, xColsExpanded, dummySQL, β, sampleSize=5000})
  → SELECT
      y - (b0 + b1*x1 + ...) AS resid,
      b0 + b1*x1 + ...       AS yhat,
      x1, x2, ...
    FROM table USING SAMPLE ? ROWS
    WHERE finite filter
  → returns {resid, yhat, xSample, _isSample: true, _nFull: n}
```

Called **on demand** from `ResidualPlots.jsx` / `QQPlot.jsx` / `DiagnosticsPanel.jsx` when those panels mount. Not eagerly in `estimate()`. Avoids work when the user never opens diagnostics.

`EstimationResult` from SQL path returns:
```js
{
  ...standardFields,
  resid: null,
  yhat: null,
  _hasLazyResiduals: true,
  _residualsThunk: () => sampleResiduals({...bound})
}
```

Consumer pattern:
```js
const r = result._hasLazyResiduals ? await result._residualsThunk() : result;
// Then use r.resid, r.yhat normally
```

### Cheap diagnostics (`duckdbDiagnostics.js`)

| Test | SQL strategy |
|------|--------------|
| **Breusch-Pagan** | Aux-reg of ê² on X. Same `buildOLSSuffStats` machinery with `POWER(y - ŷ, 2)` substituted as pseudo-y. Statistic = nR² of aux-reg. |
| **Durbin-Watson** | `SUM(POWER(e - LAG(e) OVER (ORDER BY __ri), 2)) / SUM(e * e)`. If panel id present in pipeline, `PARTITION BY entity` added. |
| **Jarque-Bera** | `SUM(POWER(e, 3))`, `SUM(POWER(e, 4))` — derives skew and kurtosis with mean=0 (residuals from OLS sum to 0 by construction). |
| **VIF** | Aux-reg of each xⱼ on the other Xs — uses cached X'X only. **Zero SQL passes.** |
| **Condition number** | Eigenvalues of X'X — JS on cached matrix. **Zero SQL passes.** |

`DiagnosticsPanel.jsx` updates:
- Detects `_hasLazyResiduals` flag.
- For BP/DW/JB/VIF/cond: routes to SQL functions.
- For White/BG/Shapiro: shows button with tooltip `"Not available in fast mode — extracts full residuals to run"`. If user clicks anyway, `extractAllRows` runs with a spinner and the test executes on the JS path. Escape hatch — never blocks functionality.

## Fases 2–7 — Sketch

Detailed design for each fase deferred to its own implementation plan. Only the structure documented here.

### Fase 2 — Cluster + HAC + remaining diagnostics

- `duckdbClusterSE.js`: 1-way (`GROUP BY cluster` → G×(k+1) score matrix → outer product in SQL if G large, JS if small). 2-way CGM = V₁ + V₂ − V₁₂, three passes.
- `duckdbHACSE.js`: Newey-West, L passes with `LAG(e, l) OVER (ORDER BY t)`. L default 4, configurable in `InferenceOptions`.
- `duckdbDiagnostics.js` extends with White (suff stats over design [X, X², X⊗X] generated in SQL) and BG (aux-reg with `LAG(e, 1..p)`). Shapiro permanently gated to n ≤ 5000.
- Dispatcher: removes the `seType ∈ {classical, HC0–3}` restriction, allows `cluster`, `twoway`, `HAC`.
- Cluster degeneration: `G > n/2` → fallback JS with warning.

### Fase 3 — WLS + 2SLS + IV + GMM/LIML

- `duckdbWLS.js`: `buildWLSSuffStats(tableName, yCol, xCols, wCol)` — same aggs with `wᵢ` factor. Reuses all HC* infra with residuals scaled by √wᵢ.
- `duckdbIV.js`: `buildIVSuffStats(tableName, yCol, xCols, zCols)` — adds `Z'Z`, `Z'X`, `Z'Y`, `X'X`. `run2SLSFromSuffStats` applies `(X'PzX)⁻¹ X'PzY` with `Pz = Z(Z'Z)⁻¹Z'`, all on small matrices in JS.
- `duckdbGMM.js`: reuses `duckdbIV` with weighting matrix W; LIML uses eigen-problem on small matrices.
- Dispatcher: removes `!hasWeights` restriction, adds support for `WLS`, `2SLS`, `IV`, `GMM`, `LIML`.

**Fase 3a status (2026-05-20):** 2SLS classical + HC0/HC1 implemented.
  - `duckdbIV.js` `buildIVSuffStats` — Z'Z / Z'X / X'X / Z'Y / X'Y / Y'Y in one SQL pass.
  - `IV2SLSEngine.js` `run2SLSFromSuffStats` — Pz on small matrices; SSR closed-form on suff-stats.
  - `duckdbIVRobustSE.js` `computeIVHCMeat` — structural residuals × first-stage x̂ outer products in SQL; β + per-endogenous α prepared as params.
  - First-stage F per endogenous regressor via paired `buildOLSSuffStats` calls (`firstStageFFromSuffStats`).
  - Cache: `makeCacheKey` / `validateSuffStatsEntry` extended with optional `zCols` (single LRU for OLS + IV, keys disjoint).
  - Dispatcher (`duckdbDispatch.shouldUseSQLPath`) routes 2SLS when `zVars`, `xColsEndog` present, order condition `q ≥ endogCount`, `k + q ≤ K_THRESHOLD`.
  - Guards in `ModelingTab` 2SLS branch: seType ∈ {classical, HC0, HC1} only, endogenous factor variables forbid HC0/HC1.
  - Validated vs `AER::ivreg` + `sandwich::vcovHC` at 6dp coef / 4dp SE (`fase3aBenchmarks.json`, `window.__validation.fase3a`).
  - Deferred to 3b/3c: HC2/HC3, clustered, twoway, HAC for 2SLS; WLS; GMM/LIML.

**Fase 3c status (2026-05-21):** WLS classical + HC0/HC1 implemented.
  - `duckdbWLS.js` `buildWLSSuffStats` — single SQL pass produces both weighted (X'WX, X'WY, sumW) and unweighted (X'X, X'Y, Y'Y, sumY) cross-products. Row filter rejects NULL / non-finite y/x/w and w ≤ 0 (matches `runWLS` in `LinearEngine.js:233-238`).
  - `WLSEngine.js` `runWLSFromSuffStats` — β = (X'WX)⁻¹X'WY; SSR = Y'Y − 2β'X'Y + β'X'Xβ (UNweighted, matches `runWLS`); R² emitted from unweighted SST (documented deviation from `runWLS`'s weighted R²; `_wlsR2Note: "unweighted"` flag on the result).
  - `duckdbWLSRobustSE.js` `computeWLSHCMeat` — meat = Σ wᵢ² êᵢ² xᵢ xⱼ computed in SQL with β as prepared params. HC1 scaling n/(n−k) is applied by the engine, not the builder.
  - Cache: `makeCacheKey` / `validateSuffStatsEntry` extended with optional `wCol` (single LRU; weighted keys disjoint from unweighted via `|W|` sentinel).
  - Dispatcher: `hasWeights = true` allowed iff `estimator === "WLS"` AND `weightCol` is non-empty; SE restricted to `{classical, HC0, HC1}` for WLS in Fase 3c.
  - Validated vs R `lm(..., weights = w)` + `sandwich::vcovHC` at 6dp coef / 4dp SE (`fase3cBenchmarks.json`, `window.__validation.fase3c`).
  - Deferred to a later fase: HC2/HC3, clustered, twoway, HAC × WLS.

**Fase 3b status (2026-05-21):** GMM (two-step efficient) + LIML implemented, classical SE only.
  - `duckdbGMM.js` `buildGMMSuffStats` — single SQL pass producing X'X, Z'Z, Z'X, X'Y, Z'Y, Y'Y over the full GMM design (X = [1, wCols, xCols]; Z = [1, wCols, zCols]).
  - `duckdbGMMOmega.js` `computeGMMOmega` — (1/n)·Σ êᵢ² zᵢ zⱼ in SQL with β̂₁ as prepared params.
  - `GMMSuffStatsEngine.js` `runGMMFromSuffStats` — step-2 solve β = (X'Z Ω̂⁻¹ Z'X)⁻¹ X'Z Ω̂⁻¹ Z'Y; SE = √(n·diag(Ainv)) (matches `GMMEngine`); Hansen J = n·g'Ω̂⁻¹g with g = (Z'Y − Z'X β)/n on small matrices.
  - `duckdbLIML.js` `buildLIMLSuffStats` — extends GMM aggregates with W-block (W'W, W'X, W'Y, Z'W) needed for M_W projections.
  - `LIMLSuffStatsEngine.js` `runLIMLFromSuffStats` — assembles A = [Y, X_endo]' M_Z [Y, X_endo] and B = [Y, X_endo]' M_W [Y, X_endo] via closed forms `v'Mu = v'u − v'P(P'P)⁻¹P'u` on small matrices; reuses existing `limlKappa2x2` / `limlKappaPower` from `GMMEngine.js` for κ.
  - Dispatcher: GMM/LIML routed when zVars, xVars present, order condition holds, and (k+l) ≤ K_THRESHOLD; SE restricted to "classical" only.
  - Validated vs `gmm::gmm()` and hand-coded LIML (over-id case, κ ≥ 1) at 6dp coef / 4dp SE (`fase3bBenchmarks.json`, `window.__validation.fase3b`).
  - Deferred to a later sub-fase: HC0/HC1 + clustered/HAC for LIML (parallel to 2SLS); GMM HC overrides (GMM's classical SE is already heteroskedasticity-robust via Ω̂, so this is genuinely deferred).

### Fase 4 — FE / FD / TWFE

- `duckdbWithin.js`: CTE with `x - AVG(x) OVER (PARTITION BY entity)` for FE; `x - LAG(x) OVER (PARTITION BY entity ORDER BY time)` for FD; double within (entity, then time) for TWFE.
- Suff stats computed over within-transformed table. Classical SE uses σ² adjusted for df (n − N − k for FE).
- LSDV with many levels → falls back to JS (k passes `K_THRESHOLD` rapidly).
- **Status (2026-05-21):** FE + FD live for classical / HC0 / HC1.
  - `duckdbWithin.buildWithinSuffStats({mode})` emits a single CTE chain ending in `wf`: FE recenters with unit+grand means (matching `PanelEngine.runFE`); FD uses LAG over `PARTITION BY unit ORDER BY time`. Returns standard OLS cross-products plus `n_units` and a reusable `withinCTEPrefix`.
  - `PanelSuffStatsEngine.runFEFromSuffStats` / `runFDFromSuffStats`: FE df = n − G − k_reg; FD df = n_diff − k_reg − 1. HC1 scaling uses `n/(n−k_reg−1)` to match `PanelEngine.runFE`'s passing of `k_reg+1` to `computeRobustSE`. `_betaFull` and `_seFull` exposed for the meat builder + validation harness.
  - `duckdbWithinRobustSE.computeWithinHCMeat` reuses `withinCTEPrefix` so the within transform is computed once per estimation; HC0 raw meat; HC1 scaling applied inside the engine.
  - Cache key extended with `panel = {mode, unitCol, timeCol}` via `|P|` sentinel so FE/FD entries don't collide with OLS for the same y/x.
  - Dispatcher gates FE/FD on `unitCol` (and `timeCol` for FD), classical/HC0/HC1 only, no weights.
  - Validated vs R manually-demeaned `lm` + `sandwich::vcovHC` (`fase4Benchmarks.json`, `window.__validation.fase4`) at 6dp coef / 4dp SE.
- **Deferred to Fase 4b:** TWFE double-demean (closed-form requires balanced panel); cluster-by-entity SE; HC2/HC3 (need leverage of the within design); HAC.

### Fase 5 — DiD (2x2, TWFE) + Event Study

- DiD 2x2: OLS with `treat × post` dummy — falls onto Fase 1 once interaction generated in SQL (`CASE WHEN treat=1 AND t>=t0 THEN 1 ELSE 0 END`).
- TWFE DiD: falls onto Fase 4.
- **Fase 5 status (2026-05-21):** live for the large-n `DiD`, `TWFE`, and `EventStudy` UI paths.
  - `duckdbDiDSynthetic.js` emits the OLS DiD interaction payload, the TWFE DiD regressor payload, and Event Study horizon dummies plus endpoint bins without adding a new solver.
  - `ModelingTab` routes DiD through the Fase 1 OLS suff-stats path and TWFE/Event Study through the Fase 4b TWFE within path. Event Study keeps the JS result contract, including the reference-period coefficient and pre-trend Wald test.
  - Dispatcher guards operand presence and Event Study horizon width before SQL routing. SQL inference scope is DiD classical + HC0-HC3, TWFE/EventStudy classical + HC0/HC1.
  - Validation fixtures: base-R `fase5RValidation.R`, generated `fase5_data.csv` / `fase5Benchmarks.json`, and browser harness `window.__validation.fase5`.
- Event Study: event-time dummies generated in SQL (`CASE WHEN t - t_treat = -3 THEN 1 ELSE 0`, one per lag/lead). k grows with horizon — `K_THRESHOLD` check.

### Fase 6 — IRLS (Logit / Probit / Poisson FE)

- `duckdbIRLS.js`: loop in JS, per-iter `buildWeightedSuffStats(tableName, yCol, xCols, β)` computes IRLS weights inline (logit: `μ(1−μ)` with `μ=σ(Xβ)`; probit analogous; Poisson: `μ=exp(Xβ)`). One SQL pass per iter, typically 5–10 iters.
- McFadden R², log-likelihood aggregated on final SQL pass.
- For n < N_THRESHOLD, dispatcher falls to JS — 10 roundtrips × ~100ms is worse than JS path on small data.

### Fase 7 — RDD sharp / fuzzy

- `duckdbRDD.js`: triangular kernel as factor `GREATEST(0, 1 - ABS(r - c) / h)` on aggs. Local WLS over window `WHERE r BETWEEN c-h AND c+h`.
- IK bandwidth: stays in JS, receives local moments from SQL (`SELECT SUM(POWER(r, k)) WHERE ...`).
- Fuzzy RDD: uses `duckdbIV` with kernel weight applied across the board.

## Error handling

| Failure mode | Behavior |
|--------------|----------|
| DuckDB query fails (Wasm crash, OOM, invalid SQL) | Catch → `perfLog` entry with `sqlFailed: true` → automatic fallback to JS path → no user warning |
| Singular X'X | Returns `EstimationResult.error = "Matrix is singular near column X"` — same message as today |
| β contains `NaN` / `Inf` before meat pass | Skip robust SE, return `seType: 'classical'` with warning `"Robust SE skipped — coefficient estimates not finite"` |
| Cluster degenerate (`G > n/2` or `G < 2`) | Explicit user warning, fallback to JS classical |
| IRLS non-convergence within `max_iter` (Fase 6) | Return last β with flag `_converged: false` — same as JS path today |
| Cache hit with mismatched dimensions (race with pipeline change) | Defensive check: `XtX.length !== xCols.length + 1` → discard entry, invalidate cache |

Every JS fallback caused by SQL failure gets logged to `perfLog`. Never silent.

## Testing — three layers

### 1. Synthetic unit tests — `__validation__/duckdbVsJS.test.js`

For each new SQL path: generate synthetic data n=10k, k=5, run SQL and JS paths, compare.

Tolerances:
- Coefficients: 1e-10
- Standard errors: 1e-6
- Diagnostics test statistics: 1e-6
- Log-likelihood (Fase 6): 1e-8

Edge cases:
- NA scattered across rows
- Perfect collinearity (singular X'X)
- n = N_THRESHOLD ± 1 (boundary of gate)
- Factor expansion with 50+ levels

Test matrix: `[estimator × seType × hasFactors × hasWeights]` — combinatorial but manageable. Use parameterized test setup.

### 2. Hard benchmarks vs R — `engineValidation.js` (existing)

Unchanged. Six estimators already validated against R (OLS, FE, RDD, 2SLS, Logit/Probit, GMM/LIML, SC) continue to validate. Path-agnostic — same `EstimationResult` checked.

Gate: every fase runs hard benchmarks before merge. Failure blocks merge.

### 3. Performance regression — `__validation__/perfRegression.test.js`

Synthetic data n ∈ {10k, 100k, 1M}, k ∈ {5, 20}. Measure `msTotal` for both paths.

Qualitative asserts:
- At n=1M: SQL path ≥ 5× faster than JS path
- At n=10k: JS path ≥ 2× faster than SQL path (sanity check on threshold)

Output written to `docs/perf-baseline.json` for commit-to-commit tracking.

## Done criteria per fase

A fase ships when:
1. SQL-vs-JS unit tests pass at specified tolerances.
2. Hard benchmarks vs R still pass.
3. Performance regression passes.
4. Manual smoke test: load `data/example_large.parquet`, estimate, open Diagnostics and ResidualPlots.
5. `perfLog` confirms SQL path activated in the target scenario.

## Known risks to monitor

- **Floating-point accumulation in SUM over 900k rows.** DuckDB uses IEEE 754 double, same as JS, but order of accumulation differs. If a validation fails by <1e-6 on SE, decide whether to loosen tolerance or use Kahan summation.
- **`prepare` with many parameters.** HC2/HC3 injects (k+1)² elements of Ainv. At k=100, that's 10 201 params in a single statement. Untested at that scale. If DuckDB-Wasm hits a limit, switch to a temp table approach (insert Ainv as a 2-column table, join on indices).
- **Cache memory growth with many models.** `useRef` Map grows over a session. LRU eviction at 50 entries with each ~200KB at k=20 → 10MB ceiling. Acceptable.

## Out of scope (explicitly)

- Synthetic Control (Frank-Wolfe over donor pool — optimization-bound, not row-bound).
- AR / bootstrap / Monte Carlo resampling (each replica reuses dispatched path transitively — no dedicated work needed).
- Anything in `math/ml/` or `math/bayes/` (post-MVP per CLAUDE.md).
