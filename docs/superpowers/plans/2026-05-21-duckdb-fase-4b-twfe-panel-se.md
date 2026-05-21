# DuckDB Fase 4b — TWFE + Panel Robust SE Completion

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** NEXT for Sonnet or Codex. Blocks Fase 5 (DiD/EventStudy lean on TWFE) and Fase 6 (Poisson FE entity dummies).

**Goal:** Complete the panel SQL push-down by adding:
1. **TWFE** (two-way fixed effects) double-demean for the classical / HC0 / HC1 path — closes the only estimator gap in `SQL_SUPPORTED_ESTIMATORS` on the panel side.
2. **Cluster-by-entity SE** for FE / FD / TWFE — the most-asked-for inference upgrade.
3. **HC2 / HC3** robust SE for FE / FD / TWFE via within-space leverage.
4. **Driscoll-Kraay HAC** for FE / FD / TWFE — single SQL pass with cross-sectional time-aggregated scores.

**Architecture rationale**

- Fase 4 (`duckdbWithin.buildWithinSuffStats`) already produces the within-transformed CTE chain ending in `wf(_y_, _x_0, …, _x_{k-1}, _u_)`. The same `withinCTEPrefix` is reused by `duckdbWithinRobustSE.computeWithinHCMeat`. Fase 4b extends this pattern: every new meat-pass module accepts `withinCTEPrefix` (plus the extras it needs — `_t_` for HAC, `_g` for cluster — generated inside the existing CTE chain) and emits a single SQL pass.
- **TWFE** is a new `mode` on `buildWithinSuffStats` (`"FE"|"FD"|"TWFE"`). The CTE chain adds a `tm` (time-mean) CTE and the final projection becomes `xᵢₜ − x̄ᵢ − x̄ₜ + x̄`. df adjusts to `n − G_units − G_times + 1 − k_reg`. No new engine — `runTWFEFromSuffStats` reuses the solve/sandwich helpers in `PanelSuffStatsEngine.js`.
- **Cluster-by-entity** is the existing `duckdbClusterSE.computeClusterMeat` pattern but executed inside `withinCTEPrefix`. The cluster column is `_u_` itself (entity ID is the natural cluster for FE; FD too — the differenced rows keep their entity ID). The score is `s_g = Σ_{t in g} ê_{it} x̃_{it}` where `x̃` is already the within-transformed regressor in `wf`.
- **HC2 / HC3** mirror `duckdbRobustSE.computeHCMeatWithLeverage`. Leverage is `hᵢᵢ = x̃ᵢ' (X̃'X̃)⁻¹ x̃ᵢ` — `X̃` is the within design, so `Ainv = XtXinv` from `PanelSuffStatsEngine` is the correct matrix. Bound as prepared params just like the OLS case.
- **Driscoll-Kraay HAC** is _not_ standard HAC. The classical HAC `LAG(e) OVER (ORDER BY t)` is wrong for panel because it conflates within-entity and cross-entity covariance. DK aggregates scores cross-sectionally first (`S_t = Σ_i ê_{it} x̃_{it}`), then applies Newey-West Bartlett over the time index of the aggregated series. One SQL pass: a CTE that aggregates by time, then LAG over the time-aggregated row. Auto-bandwidth `L = ⌊4·(T/100)^(2/9)⌋`, matching the existing `duckdbHACSE` convention.

**Key insight:** none of these require leaving `withinCTEPrefix`. The same CTE chain that builds X̃'X̃ in Fase 4 produces the residual / score in Fase 4b — exactly one within transformation per estimation regardless of which SE the user picks.

**Tech Stack:** DuckDB-Wasm 0.10, JS matrix helpers in `PanelSuffStatsEngine.js`, validation against R `fixest::feols(... cluster = ...)`, `clubSandwich::vcovCR` (HC2/HC3 for panels), `plm::vcovSCC` (Driscoll-Kraay), `sandwich::vcovHC` (HC2/HC3 baseline) at 6 dp coef / 4 dp SE.

---

## File Structure

**Create:**
- `src/services/data/duckdbTWFE.js` — thin wrapper that adds `mode = "TWFE"` support to `buildWithinSuffStats`. (Alternative implementation: extend `duckdbWithin.js` directly. Decision: keep `duckdbWithin.js` lean by importing TWFE-specific projection from a sibling file. See Task 2 for the split.)
- `src/services/data/duckdbWithinClusterSE.js` — `computeWithinClusterMeat({withinCTEPrefix, k, beta, clusterCol})`. Cluster column from the original table is carried into `wf` via a `_g` projection in the base CTE.
- `src/services/data/duckdbWithinHC23.js` — `computeWithinHCMeatWithLeverage({withinCTEPrefix, k, beta, Ainv, hcType})`. HC2 → `p=1`; HC3 → `p=2`.
- `src/services/data/duckdbWithinHAC.js` — `computeWithinDriscollKraayMeat({withinCTEPrefix, k, beta, timeCol, lag})`. Cross-sectional time-aggregated scores → Newey-West Bartlett kernel.
- `src/services/data/__validation__/fase4bRValidation.R` — generates `fase4b_data.csv` + `fase4bBenchmarks.json` covering 12 cells: {FE, FD, TWFE} × {cluster-by-entity, HC2, HC3, DK-HAC}.
- `src/services/data/__validation__/fase4bValidation.js` — `runFase4bNumericalValidation()` exposed at `window.__validation.fase4b`.

**Modify:**
- `src/services/data/duckdbWithin.js` — accept `mode = "TWFE"`; add carry-through of optional `clusterCol` (project as `_g`) and `timeColForHAC` (project as `_t_h`) into the `wf` CTE so the downstream meat modules don't have to re-traverse the original table.
- `src/math/PanelSuffStatsEngine.js` — add `runTWFEFromSuffStats({n, n_units, n_times, XtX, XtY, YtY, sumY, varNames, meat, hcType, seType})`. Mirrors `runFE...` numerical conventions but with df `= n − G − T + 1 − k_reg`.
- `src/math/index.js` — re-export `runTWFEFromSuffStats`.
- `src/services/data/dispatchConfig.js` — add `"TWFE"` to `SQL_SUPPORTED_ESTIMATORS`.
- `src/services/data/duckdbDispatch.js` — drop the `classical/HC0/HC1` restriction for FE/FD; accept `clustered` / `HC2` / `HC3` / `HAC` when the operand columns are present. Add TWFE branch.
- `src/services/data/suffStatsCache.js` — extend `panel` sentinel to encode `mode = "TWFE"` so TWFE entries do not collide with FE for the same y/x.
- `src/components/ModelingTab.jsx` — TWFE branch (mirrors existing FE branch); FE/FD/TWFE branches route through new meat modules based on `seType`.

**Invariants preserved:**
- `src/math/PanelEngine.js` untouched. JS path remains authoritative for n < N_THRESHOLD, factor-explosion past K_THRESHOLD, and the staggered-TWFE-with-staggered-treat-time variant that needs a different model (deferred — see "Out of scope").
- `EstimationResult` shape from `runTWFEDiD` is **not** the target for `runTWFEFromSuffStats`. TWFE-as-DiD with a single treatment regressor lives in Fase 5. Fase 4b's `runTWFEFromSuffStats` is the generic TWFE OLS (multiple regressors, no DiD framing) — matches the shape returned by `runFEFromSuffStats`.
- `withinCTEPrefix` remains the single source of truth for the within transform. No meat-pass module re-emits demeaning logic.

---

## Task 1: Extend dispatcher + constants

**Files:**
- Modify: `src/services/data/dispatchConfig.js`
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Add TWFE to supported estimator set**

In `dispatchConfig.js`:

```js
export const SQL_SUPPORTED_ESTIMATORS = new Set([
  "OLS", "2SLS", "WLS", "GMM", "LIML",
  "FE", "FD", "TWFE",                       // ← add TWFE
]);
```

- [ ] **Step 2: Extend `ctx` schema JSDoc**

At the top of `duckdbDispatch.js`, extend the ctx documentation:

```
//   timeCol:       string | null  — time column (required for FD, TWFE, EventStudy; also for HAC)
//   clusterVar:    string | null  — one-way cluster column (required when seType="clustered"
//                                   or for panel cluster-by-entity, in which case it equals unitCol)
```

- [ ] **Step 3: Replace panel-SE gating block**

Locate the existing block (`duckdbDispatch.js:66-75`):

```js
if (["FE", "FD"].includes(ctx.estimator)) {
  ...
  if (!["classical", "HC0", "HC1"].includes(se)) return false;
  if (ctx.hasWeights) return false;
}
```

Replace with:

```js
if (["FE", "FD", "TWFE"].includes(ctx.estimator)) {
  if (!ctx.unitCol || typeof ctx.unitCol !== "string") return false;
  if (["FD", "TWFE"].includes(ctx.estimator)) {
    if (!ctx.timeCol || typeof ctx.timeCol !== "string") return false;
  }
  if (ctx.hasWeights) return false;

  // Fase 4b: classical / HC0 / HC1 / HC2 / HC3 / clustered / HAC
  const okSE = ["classical", "HC0", "HC1", "HC2", "HC3", "clustered", "HAC"];
  if (!okSE.includes(se)) return false;

  // Cluster: cluster column must be present; for panel cluster-by-entity the
  // dispatcher accepts clusterVar === unitCol OR clusterVar === null (engine
  // will default cluster=unit). Both are valid; the engine treats null as
  // "cluster on entity".
  if (se === "clustered" && ctx.clusterVar != null && typeof ctx.clusterVar !== "string") {
    return false;
  }

  // HAC for panel = Driscoll-Kraay. Requires timeCol (already validated for
  // FD/TWFE; for FE, timeCol must be supplied separately).
  if (se === "HAC" && !ctx.timeCol) return false;

  // Two-way cluster on panels not supported in 4b (defer to a later fase).
  if (se === "twoway") return false;
}
```

- [ ] **Step 4: Verify nothing routes TWFE through the OLS branch**

Grep `ctx.estimator === "OLS"` in `duckdbDispatch.js`. There should be no guard that needs to exclude TWFE; the panel branch above runs first because it precedes the implicit OLS fall-through. Add a comment marking the panel block as a "preempt before OLS" zone.

---

## Task 2: Within-transform with TWFE mode

**Files:**
- Modify: `src/services/data/duckdbWithin.js`

- [ ] **Step 1: Accept `mode = "TWFE"` in signature**

Update the JSDoc and the validation in `buildWithinSuffStats`:

```js
// at top of function
if (!["FE", "FD", "TWFE"].includes(mode)) {
  throw new Error(`buildWithinSuffStats: invalid mode "${mode}" (expected "FE", "FD", or "TWFE")`);
}
if ((mode === "FD" || mode === "TWFE") && !timeCol) {
  throw new Error(`buildWithinSuffStats: ${mode} mode requires timeCol`);
}
```

- [ ] **Step 2: Carry optional `_g` and `_t_h` projections in base CTE**

Extend `opts` schema:

```js
// opts:
//   mode, timeCol, dummySQL: as before
//   clusterCol?:   string  — carried as _g into wf for cluster-by-cluster SE
//   timeColForHAC?: string — carried as _t_h into wf for Driscoll-Kraay HAC
//                            (typically equal to timeCol; passed separately so
//                             FE estimations without timeCol can opt in)
```

In the `base` CTE projection, after the existing `_yb_`, `_u_`, `_xb_*`, `_t_` projections, add:

```js
if (opts.clusterCol)    baseProj.push(`${esc(opts.clusterCol)} AS _g`);
if (opts.timeColForHAC) baseProj.push(`${esc(opts.timeColForHAC)} AS _t_h`);
```

Extend `baseFinite` filter:

```js
if (opts.clusterCol)    baseFinite.push(`_g IS NOT NULL`);
if (opts.timeColForHAC) baseFinite.push(`_t_h IS NOT NULL`);
```

Project `_g` and `_t_h` through every downstream CTE (`um`, `gm`, `tm` for TWFE; `diffs` for FD; final `wf`). For FE the change is a straight pass-through. For FD `_g` and `_t_h` come from the **second** row of each pair (`sub[i]`, not `sub[i-1]`) — this matches `runFD` line 152 in `PanelEngine.js`.

- [ ] **Step 3: Add TWFE mode CTE**

After the existing `if (mode === "FE")` block, add:

```js
if (mode === "TWFE") {
  // unit-mean CTE
  const umAggs = [`_u_`, `AVG(_yb_) AS m_y`];
  for (let i = 0; i < k; i++) umAggs.push(`AVG(_xb_${i}) AS m_x_${i}`);

  // time-mean CTE
  const tmAggs = [`_t_`, `AVG(_yb_) AS t_y`];
  for (let i = 0; i < k; i++) tmAggs.push(`AVG(_xb_${i}) AS t_x_${i}`);

  // grand-mean CTE (same as FE)
  const gmAggs = [`AVG(_yb_) AS g_y`];
  for (let i = 0; i < k; i++) gmAggs.push(`AVG(_xb_${i}) AS g_x_${i}`);

  // Double-demean projection
  const finalProj = [
    `(base._yb_ - um.m_y - tm.t_y + gm.g_y) AS _y_`,
  ];
  for (let i = 0; i < k; i++) {
    finalProj.push(
      `(base._xb_${i} - um.m_x_${i} - tm.t_x_${i} + gm.g_x_${i}) AS _x_${i}`
    );
  }
  finalProj.push(`base._u_ AS _u_`);
  finalProj.push(`base._t_ AS _t_`);
  if (opts.clusterCol)    finalProj.push(`base._g AS _g`);
  if (opts.timeColForHAC) finalProj.push(`base._t_h AS _t_h`);

  withinCTEPrefix = `WITH ${baseCTE},
    um AS (SELECT ${umAggs.join(", ")} FROM base GROUP BY _u_),
    tm AS (SELECT ${tmAggs.join(", ")} FROM base GROUP BY _t_),
    gm AS (SELECT ${gmAggs.join(", ")} FROM base),
    wf AS (
      SELECT ${finalProj.join(", ")}
      FROM base
      JOIN um ON base._u_ = um._u_
      JOIN tm ON base._t_ = tm._t_
      CROSS JOIN gm
    )`;
}
```

Also project `_t_` through `wf` in `FE` mode when `opts.timeColForHAC` is set (for Driscoll-Kraay on FE).

- [ ] **Step 4: Add `n_times` to aggregation**

After `COUNT(DISTINCT _u_) AS n_units`, add when `mode === "TWFE"`:

```js
aggs.push(`COUNT(DISTINCT _t_) AS n_times`);
```

Return value gains `n_times` (null for FE/FD modes unless the caller passed `timeColForHAC`).

- [ ] **Step 5: Sanity guard**

After the query: if `mode === "TWFE"` and either `n_units < 2` or `n_times < 2`, return null (degenerate panel — falls back to JS path which produces a clearer error).

---

## Task 3: TWFE engine

**Files:**
- Modify: `src/math/PanelSuffStatsEngine.js`
- Modify: `src/math/index.js`

- [ ] **Step 1: Add `runTWFEFromSuffStats`**

After `runFDFromSuffStats`, append:

```js
/**
 * Two-Way Fixed Effects from double-demean sufficient statistics.
 *
 * df = n - G_units - G_times + 1 - k_reg  (subtract 1 because unit and time
 * dummies overlap by one degree — the grand mean is double-counted).
 * Matches PanelEngine.runTWFEDiD line 622.
 */
export function runTWFEFromSuffStats({
  n, n_units, n_times, XtX, XtY, YtY, sumY, varNames,
  meat = null, hcType = null,
}) {
  if (typeof hcType === "string") hcType = hcType.toUpperCase();
  const k    = XtX.length;
  const kReg = k - 1;
  if (!Number.isFinite(n) || !Number.isFinite(n_units) || !Number.isFinite(n_times)) return null;
  if (n_units < 2 || n_times < 2) return null;

  const solved = solve(XtX, XtY);
  if (!solved) return null;
  const { XtXinv, beta } = solved;

  const SSR = YtY - beta.reduce((s, b, i) => s + b * XtY[i], 0);
  const df_fe = n - n_units - n_times + 1 - kReg;
  if (df_fe <= 0) return null;
  const s2 = SSR / df_fe;

  const SST = YtY - (sumY * sumY) / n;
  const R2_within = SST > 0 ? 1 - SSR / SST : 0;

  let se;
  if (meat !== null) {
    // HC1 scale matches PanelEngine.runTWFEDiD which uses twfeK = 1 + treat + controls
    // → here that is just kReg + 1.
    const dfRobust = Math.max(1, n - kReg - 1);
    const scale = hcType === "HC1" ? n / dfRobust : 1;
    se = sandwich(XtXinv, meat, scale);
  } else {
    se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  }

  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df_fe));

  const Fstat = kReg > 0 ? ((SST - SSR) / kReg) / s2 : 0;
  const Fpval = kReg > 0 ? fCDF(Fstat, kReg, df_fe)  : 1;

  return {
    beta:     beta.slice(1),
    se:       se.slice(1),
    tStats:   tStats.slice(1),
    pVals:    pVals.slice(1),
    varNames: varNames.slice(1),
    R2_within,
    R2_between: null,
    n,
    units: n_units,
    times: n_times,
    df:   df_fe,
    SSR,
    s2,
    resid: null,
    Yhat:  null,
    alphas: null,
    timeFE: null,
    Fstat, Fpval,
    XtXinv,
    _betaFull: beta,
    _seFull:   se,
    _suffStats: true,
    _hcType: hcType,
  };
}
```

- [ ] **Step 2: Re-export from barrel**

In `src/math/index.js`, add to the `PanelEngine` re-export block (or alongside `runFEFromSuffStats`):

```js
export {
  runFEFromSuffStats,
  runFDFromSuffStats,
  runTWFEFromSuffStats,           // ← new
} from "./PanelSuffStatsEngine.js";
```

---

## Task 4: Cluster-by-entity meat for FE / FD / TWFE

**Files:**
- Create: `src/services/data/duckdbWithinClusterSE.js`

- [ ] **Step 1: Module skeleton**

```js
// ─── ECON STUDIO · src/services/data/duckdbWithinClusterSE.js ─────────────────
// One-way clustered meat-matrix for within-transformed panel designs.
// Reuses the withinCTEPrefix from buildWithinSuffStats. The cluster column is
// carried into wf as _g (see duckdbWithin.js Step 2). The engine receives
// pre-scaled meat (Stata-equivalent small-sample correction applied here).

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.withinCTEPrefix
 * @param {number} args.k         number of regressors (excl. intercept)
 * @param {number[]} args.beta    length k+1, intercept first
 * @returns {Promise<{meat:number[][], n:number, G:number}>}
 */
export async function computeWithinClusterMeat({ withinCTEPrefix, k, beta }) {
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  const yhatTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // Per-cluster score sums
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(${residSQL} * ${xExpr(j)}) AS s_${j}`);
  }

  // Outer-product upper-triangular aggregates
  const meatAggs = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      meatAggs.push(`SUM(s_${j} * s_${l}) AS m_${j}_${l}`);
    }
  }

  const sql = `${withinCTEPrefix},
    clusters AS (
      SELECT _g, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM wf
      GROUP BY _g
    )
    SELECT
      COUNT(*)  AS G,
      SUM(_cn)  AS n,
      ${meatAggs.join(", ")}
    FROM clusters
  `;

  // residSQL appears `dim` times in scoreAggs (one per j); each occurrence
  // inlines `dim` β-params. Total params = dim × dim.
  const literalCount = sql.split(residSQL).length - 1;
  const expectedCount = dim;  // dim score aggregates, each has one residSQL
  if (literalCount !== expectedCount) {
    throw new Error(
      `computeWithinClusterMeat: residSQL occurrence count mismatch ` +
      `(found ${literalCount}, expected ${expectedCount}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...betaParams);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const G = num(r.G);
  const n = num(r.n);
  if (G <= 1) {
    throw new Error(
      `computeWithinClusterMeat: need G > 1 (found G=${G}). Use HC1 instead.`,
    );
  }
  // Stata small-sample correction: G/(G-1) * (n-1)/(n-k_reg-1)
  // Use dim (= k_reg + 1) since the within design includes the intercept.
  const scale = (G / (G - 1)) * ((n - 1) / (n - dim));

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`m_${j}_${l}`]) * scale;
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n, G };
}
```

- [ ] **Step 2: Default cluster column = unit**

If the caller does not pass `clusterCol` to `buildWithinSuffStats`, it defaults to `unitCol` — entity is the natural cluster for panel data. This default lives in **ModelingTab** (Task 8), not in this module. This module is shape-agnostic: it just reads `wf._g`.

- [ ] **Step 3: Validate residSQL inlining count**

The defensive guard above expects `dim` occurrences. If a future refactor adds `_yhat` or similar to the wf projection, the guard catches it before silently producing wrong SE.

---

## Task 5: HC2 / HC3 leverage meat for within designs

**Files:**
- Create: `src/services/data/duckdbWithinHC23.js`

- [ ] **Step 1: Module skeleton**

```js
// ─── ECON STUDIO · src/services/data/duckdbWithinHC23.js ──────────────────────
// HC2 / HC3 sandwich meat for within-transformed panel designs.
// Leverage h_ii = x̃_i' Ainv x̃_i computed inline in SQL with both β and Ainv
// bound as prepared params.
//   HC2: meat[j][l] = Σ (ê² / (1-h)) x̃_j x̃_l
//   HC3: meat[j][l] = Σ (ê² / (1-h)²) x̃_j x̃_l

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.withinCTEPrefix
 * @param {number} args.k                regressor count (excl. intercept)
 * @param {number[]} args.beta           length k+1, intercept first
 * @param {number[][]} args.Ainv         (k+1)×(k+1), XtXinv from PanelSuffStatsEngine
 * @param {"HC2"|"HC3"} args.hcType
 * @returns {Promise<{meat:number[][], n:number}>}
 */
export async function computeWithinHCMeatWithLeverage({
  withinCTEPrefix, k, beta, Ainv, hcType,
}) {
  if (!["HC2", "HC3"].includes(hcType)) {
    throw new Error(`computeWithinHCMeatWithLeverage: bad hcType "${hcType}"`);
  }
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  // ŷ and ê
  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // h = Σ_{a,b} Ainv[a][b] x_a x_b  (symmetric so we collapse double-tri sum)
  const hTerms = [];
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      hTerms.push(`? * ${xExpr(a)} * ${xExpr(b)}`);
      params.push(Ainv[a][b]);
    }
  }
  const hSQL = hTerms.join(" + ");
  const pPow = hcType === "HC2" ? 1 : 2;
  // Floor (1 - h) at a tiny epsilon to avoid divide-by-zero; matches sandwich
  // package behavior (it returns NaN at h=1 which propagates as a coefficient
  // with NaN SE — we mirror that by allowing the SUM to push NaN through).
  const denom = pPow === 1 ? `(1.0 - (${hSQL}))` : `POWER(1.0 - (${hSQL}), 2)`;

  const aggs = ["COUNT(*) AS n"];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) / ${denom} * ${xExpr(j)} * ${xExpr(l)}) AS m_${j}_${l}`
      );
    }
  }

  const sql = `${withinCTEPrefix}
    SELECT ${aggs.join(", ")} FROM wf`;

  // residSQL appears once per aggregate; hSQL appears once per aggregate.
  // β params: `dim` per residSQL; Ainv params: `dim²` per hSQL.
  // Total per aggregate = dim + dim².
  // aggCount = dim(dim+1)/2.
  const aggCount = dim * (dim + 1) / 2;
  const residCount = sql.split(residSQL).length - 1;
  const hCount     = sql.split(hSQL).length - 1;
  if (residCount !== aggCount || hCount !== aggCount) {
    throw new Error(
      `computeWithinHCMeatWithLeverage: occurrence mismatch ` +
      `(resid=${residCount}, h=${hCount}, expected ${aggCount}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < aggCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`m_${j}_${l}`]);
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n: num(r.n) };
}
```

- [ ] **Step 2: Caller passes `Ainv` from the suff-stats result**

`runFEFromSuffStats` exposes `XtXinv` on the result. The HC2/HC3 path in ModelingTab passes `result.XtXinv` as `Ainv` to this builder. No new fields needed.

- [ ] **Step 3: Watch the prepared-statement param count**

At `k = 100` (max regressor count), each aggregate has `100 + 100² = 10_100` params, and there are `101·102/2 = 5_151` aggregates — total `~52M` params. **This will exceed DuckDB-Wasm's prepared-statement limit** if k approaches K_THRESHOLD. The plan documents this as a known risk and falls back to JS via the dispatcher: when `dim² > 1000` and `seType ∈ {HC2, HC3}` for panel, return false from `shouldUseSQLPath`. Add this guard in Task 1 Step 3.

**Concrete dispatcher guard** (add inside the panel branch):

```js
if (["HC2", "HC3"].includes(se) && (ctx.xColsExpanded.length + 1) ** 2 > 1000) {
  return false;  // prepared-statement param budget — falls to JS
}
```

---

## Task 6: Driscoll-Kraay HAC meat for panel

**Files:**
- Create: `src/services/data/duckdbWithinHAC.js`

- [ ] **Step 1: Module skeleton**

```js
// ─── ECON STUDIO · src/services/data/duckdbWithinHAC.js ───────────────────────
// Driscoll-Kraay HAC meat-matrix for within-transformed panel data.
//
// DK aggregates cross-sectional scores per time period first:
//     S_t = Σ_i ê_{it} x̃_{it}   (vector, length k+1)
// Then applies Newey-West Bartlett kernel over the time-aggregated series:
//     meat = Γ₀ + Σ_{l=1..L} w_l (Γ_l + Γ_l')      w_l = 1 - l/(L+1)
//     Γ_l  = Σ_t S_t S_{t-l}'
//
// Auto-bandwidth: L = floor(4 · (T / 100)^(2/9)) clipped to [1, T-1].

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.withinCTEPrefix  must project _t_h into wf
 * @param {number} args.k
 * @param {number[]} args.beta
 * @param {number|null} [args.lag]       null → auto-bandwidth
 * @returns {Promise<{meat:number[][], n:number, T:number, lag:number}>}
 */
export async function computeWithinDriscollKraayMeat({
  withinCTEPrefix, k, beta, lag = null,
}) {
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  const yhatTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // Step 1: aggregate scores per time period
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(${residSQL} * ${xExpr(j)}) AS S_${j}`);
  }
  const scoreCTE = `score_by_t AS (
    SELECT _t_h, COUNT(*) AS n_t, ${scoreAggs.join(", ")}
    FROM wf
    GROUP BY _t_h
    ORDER BY _t_h
  )`;

  // Step 2: pull S_t into JS, do Newey-West there. The score matrix is T × dim
  // and dim ≤ K_THRESHOLD+1 — small enough to leave SQL.
  const sql = `${withinCTEPrefix}, ${scoreCTE}
    SELECT _t_h, n_t, ${Array.from({length: dim}, (_, j) => `S_${j}`).join(", ")}
    FROM score_by_t
    ORDER BY _t_h
  `;

  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== dim) {
    throw new Error(
      `computeWithinDriscollKraayMeat: residSQL occurrence mismatch ` +
      `(found ${residCount}, expected ${dim}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < residCount; i++) boundParams.push(...betaParams);

  const stmt = await conn.prepare(sql);
  const rows = (await stmt.query(...boundParams)).toArray();
  await stmt.close();

  const T = rows.length;
  if (T < 2) {
    throw new Error(`computeWithinDriscollKraayMeat: need T ≥ 2 (found T=${T}).`);
  }

  // Build S as T × dim
  const S = rows.map(r => {
    const v = new Array(dim);
    for (let j = 0; j < dim; j++) v[j] = num(r[`S_${j}`]);
    return v;
  });
  const n = rows.reduce((s, r) => s + num(r.n_t), 0);

  const L = lag != null
    ? Math.max(1, Math.min(T - 1, lag))
    : Math.max(1, Math.min(T - 1, Math.floor(4 * Math.pow(T / 100, 2 / 9))));

  // Γ_l = Σ_{t=l+1..T} S_t S_{t-l}'
  const gamma = (l) => {
    const G = Array.from({ length: dim }, () => Array(dim).fill(0));
    for (let t = l; t < T; t++) {
      const a = S[t];
      const b = S[t - l];
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          G[i][j] += a[i] * b[j];
        }
      }
    }
    return G;
  };

  const meat = gamma(0);
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    const Gl = gamma(l);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        meat[i][j] += w * (Gl[i][j] + Gl[j][i]);
      }
    }
  }

  return { meat, n, T, lag: L };
}
```

- [ ] **Step 2: ModelingTab passes `timeColForHAC`**

When the user picks `seType = "HAC"` on a panel estimator, ModelingTab sets `buildWithinSuffStats(..., {timeColForHAC: panel.timeCol})`. For FE this requires a time column even though FE itself doesn't need one — surface this as a "HAC requires a time column" UI warning if missing.

---

## Task 7: Cache key extension

**Files:**
- Modify: `src/services/data/suffStatsCache.js`

- [ ] **Step 1: Encode TWFE in the `panel` sentinel**

The current sentinel for FE/FD is `|P|${mode}|${unitCol}|${timeCol ?? ""}`. Extend to also encode TWFE as `mode = "TWFE"` with `timeCol` required. No other change — the sentinel already distinguishes mode strings.

- [ ] **Step 2: Cluster / HAC do NOT enter the key**

The cache key represents X'X / X'Y / Y'Y (suff stats themselves) and does not depend on SE choice. The cluster column / HAC lag column live in the meat builders, which run after the cache lookup. **However:** if `clusterCol` or `timeColForHAC` is passed to `buildWithinSuffStats` (Task 2), the within CTE projects `_g` / `_t_h` and the resulting `withinCTEPrefix` differs. Two options:

- **Option A:** Always project `_g = _u_` and `_t_h = _t_` (or `_t_` from base) regardless of SE choice. Single canonical CTE; SE choice only affects the meat-pass SELECT, not the prefix. Cache hits across SE flips.
- **Option B:** Include `clusterCol` / `timeColForHAC` in the cache key. SE flips invalidate.

**Decision:** Option A. The CTE projection is essentially free (DuckDB column-aware) and the meat-pass cache-hit win is large. Implement Option A in Task 2 by always carrying `_g = _u_` and `_t_h = base._t_` (`base._t_` exists for FD/TWFE; for FE, only carry `_t_h` when `timeColForHAC` is explicitly passed — but document the divergence).

Actually, on reflection: **always carry `_t_h` when the panel has a `timeCol` passed in**. FE estimations that don't have a time column don't get HAC anyway (dispatcher gate). So the rule simplifies: if `timeCol` is in `ctx`, project it into `wf` as `_t_h`. The cache key stays mode-only.

---

## Task 8: Wire ModelingTab.estimate()

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: TWFE branch**

Locate the existing TWFE branch in `estimate()` (`runTWFEDiD`). Add a parallel "vanilla TWFE" branch — distinct from `TWFEDiD` which is a single-treat DiD framing. The vanilla TWFE estimator is selected from the sidebar dropdown as `TWFE` and is the generic two-way FE OLS.

Pattern:

```js
if (estimator === "TWFE" && shouldUseSQLPath({ ...ctx, estimator: "TWFE" })) {
  const suff = await buildWithinSuffStats(table, yVar, xColsExpanded, panel.unitCol, {
    mode: "TWFE",
    timeCol: panel.timeCol,
    clusterCol: panel.unitCol,             // default cluster on entity (Option A)
    timeColForHAC: panel.timeCol,           // carry _t_h for HAC
    dummySQL,
  });
  // … classical → no meat …
  // … HC0/HC1 → computeWithinHCMeat …
  // … HC2/HC3 → computeWithinHCMeatWithLeverage with suff XtXinv (after solve)
  // … clustered → computeWithinClusterMeat
  // … HAC → computeWithinDriscollKraayMeat
  const result = runTWFEFromSuffStats({ ...suff, meat, hcType });
  setTWFE(result);
}
```

The same SE-dispatch sub-block applies to the FE and FD branches — refactor into a helper if duplication grows. Recommended: `dispatchPanelMeat({withinCTEPrefix, k, beta, XtXinv, seType, clusterVar, lag})` in `duckdbDispatch.js` (next to the gate function) that returns `{meat, hcType}` or null for classical.

- [ ] **Step 2: Resolve `clusterCol`**

When `seType === "clustered"`:
- If `seOpts.clusterVar` is present and equals a real column → use it.
- If absent (null/empty) → default to `panel.unitCol`. Matches Stata's `cluster(id)` convention.

Reflect this default in the help text on `InferenceOptions.jsx` (out of scope for Fase 4b code changes; note for the docs commit).

- [ ] **Step 3: HC2/HC3 fallback path**

If `dim² > 1000`, the dispatcher refuses SQL. Add a brief inline comment in `ModelingTab.jsx` noting the fallback so a future reader doesn't think it's a bug.

- [ ] **Step 4: HAC needs time column**

In the TWFE / FE / FD branches: if `seType === "HAC"` and `panel.timeCol` is missing for FE, throw a user-visible error (`"HAC standard errors require a time column. Set one in the Panel tab."`) and abort estimation — do not silently fall through to classical.

---

## Task 9: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase4bRValidation.R`

- [ ] **Step 1: Generate balanced panel data**

```r
library(fixest)
library(plm)
library(sandwich)
library(lmtest)
library(clubSandwich)

set.seed(20260521)
G <- 200       # entities
T <- 30        # time periods
n <- G * T

panel <- expand.grid(id = 1:G, t = 1:T)
panel$x1 <- rnorm(n)
panel$x2 <- rnorm(n)
panel$alpha_i <- rnorm(G)[panel$id]
panel$alpha_t <- rnorm(T)[panel$t]
panel$cluster_extra <- sample(1:50, n, replace = TRUE)  # for two-way (deferred)
panel$y <- 0.5 * panel$x1 - 0.3 * panel$x2 +
           panel$alpha_i + panel$alpha_t +
           rnorm(n, sd = 0.5 + abs(panel$x1) * 0.2)     # heteroskedastic

write.csv(panel, "fase4b_data.csv", row.names = FALSE)
```

- [ ] **Step 2: 12-cell golden values**

Compute and persist 12 estimator × SE combinations:

| Estimator | SE | R function |
|---|---|---|
| FE | cluster-by-entity | `feols(y ~ x1 + x2 | id, data = panel, cluster = "id")` |
| FE | HC2 | `feols(y ~ x1 + x2 | id, vcov = "hetero")` + `clubSandwich::vcovCR(... type="CR2")` baseline cross-check |
| FE | HC3 | same with `type="CR3"` |
| FE | DK-HAC | `plm(y ~ x1 + x2, model = "within", data = panel); vcovSCC(...)` |
| FD | cluster-by-entity | `feols(y ~ x1 + x2, data = differenced, cluster = "id")` |
| FD | HC2 | `lm(diff_y ~ diff_x1 + diff_x2); vcovHC(... type="HC2")` |
| FD | HC3 | same `type="HC3"` |
| FD | DK-HAC | `vcovSCC` on diff regression |
| TWFE | cluster-by-entity | `feols(y ~ x1 + x2 | id + t, cluster = "id")` |
| TWFE | HC2 | `feols(... | id + t); vcovHC(... type="HC2")` |
| TWFE | HC3 | same `type="HC3"` |
| TWFE | DK-HAC | `plm(... model = "within", effect = "twoways"); vcovSCC` |

Persist `coef` (point), `se`, `t`, `p`, `df`, `n` per cell to `fase4bBenchmarks.json`:

```json
{
  "fe_cluster": { "coef": [0.4982, -0.3014], "se": [0.0173, 0.0182], ... },
  "fe_hc2":     { ... },
  ...
}
```

- [ ] **Step 3: Note `clubSandwich` baseline**

R's `sandwich::vcovHC(type="HC2")` applied to a `fixest` object handles within-design leverage differently than `lm`. The reference here is `clubSandwich::vcovCR(..., type="CR2")` which **is** the leverage-corrected panel HC2. Note this in a comment in the R script and in the Tolerance section of Task 10 — Driscoll-Kraay and CR2 use slightly different df adjustments, so tolerance on SE may need to be 1e-3 instead of 1e-4 for those cells.

---

## Task 10: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase4bValidation.js`

- [ ] **Step 1: Harness structure**

Mirror `fase4Validation.js`:

```js
// window.__validation.fase4b()
export async function runFase4bNumericalValidation() {
  // 1. Load fase4b_data.csv into a DuckDB table
  // 2. Load fase4bBenchmarks.json
  // 3. For each of the 12 cells:
  //    - Build ctx (estimator, seType, panel cols)
  //    - Assert shouldUseSQLPath(ctx) === true
  //    - Call dispatchPanelMeat to build meat
  //    - Call runFEFromSuffStats / runFDFromSuffStats / runTWFEFromSuffStats
  //    - Compare result.beta to benchmark.coef at 1e-6
  //    - Compare result.se   to benchmark.se   at 1e-4 (1e-3 for HAC cells)
  // 4. Report pass/fail per cell with diffs
}
```

- [ ] **Step 2: Expose at `window.__validation.fase4b`**

Per the existing convention in `fase4Validation.js`. The harness must be callable from the dev console without rebuilding.

- [ ] **Step 3: Acceptance gate**

A fase ships only when **all 12 cells** pass at the documented tolerance. The harness returns a structured report `{cell, pass, maxCoefDiff, maxSeDiff, message}` per cell so a fail is diagnosable.

---

## Task 11: CLAUDE.md update + commits

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md`

- [ ] **Step 1: Update CLAUDE.md "Pending" item 2a**

Append a Fase 4b extension paragraph after the existing Fase 4 paragraph (mirroring the prose style of Fase 3b/3c entries). State: TWFE classical/HC0/HC1; cluster-by-entity for FE/FD/TWFE; HC2/HC3 for FE/FD/TWFE; Driscoll-Kraay HAC for FE/FD/TWFE. Reference `fase4bBenchmarks.json`, `window.__validation.fase4b`.

- [ ] **Step 2: Update CLAUDE.md "Estimators implemented" table**

Add TWFE row (separate from "TWFE DiD" which already exists).

- [ ] **Step 3: Update roadmap design doc**

In `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md`, replace the Fase 4 deferred-list paragraph with the as-shipped Fase 4b summary.

- [ ] **Step 4: Commits**

Suggested commit sequence (one per file group, mirroring the Fase 4 commit cadence):

1. `feat(data): Fase 4b — extend buildWithinSuffStats with TWFE mode + carry _g, _t_h`
2. `feat(math): Fase 4b — runTWFEFromSuffStats double-demean engine`
3. `feat(data): Fase 4b — within cluster-by-entity meat builder`
4. `feat(data): Fase 4b — within HC2/HC3 leverage meat builder`
5. `feat(data): Fase 4b — Driscoll-Kraay HAC meat builder`
6. `feat(modeling): Fase 4b — dispatcher allows panel cluster/HC2/HC3/HAC + TWFE`
7. `feat(modeling): Fase 4b — ModelingTab routes panel SE to new meat builders`
8. `test(data): Fase 4b — R fixest + plm + clubSandwich golden values`
9. `test(modeling): Fase 4b — browser harness vs R for 12 panel SE cells`
10. `docs: Fase 4b — TWFE + panel robust SE complete`

---

## Risks

| Risk | Mitigation |
|---|---|
| HC2/HC3 prepared-statement param explosion at high k | Dispatcher refuses when `dim² > 1000`; falls to JS. Documented in Task 5 Step 3. |
| Driscoll-Kraay df adjustment differs across R packages (`plm::vcovSCC` vs `sandwich::NeweyWest`) | Validate against `plm::vcovSCC` specifically; document tolerance as 1e-3 SE for HAC cells (Task 9 Step 3). |
| FD with `clusterCol`: which row of each pair carries `_g`? | Matches `runFD` JS — takes second row (sub[i], not sub[i-1]). Codified in Task 2 Step 2. |
| TWFE on unbalanced panels — double-demean is biased | Out of scope: dispatcher rejects unbalanced panels via a balance check (deferred to Fase 4c if needed). For 4b, assume balanced; otherwise JS path. |
| Cache hit reuses prefix that was built without `_t_h` | Resolved by always projecting `_t_h` when `timeCol` is in ctx (Task 7 Step 2). |

## Out of scope (Fase 4c+)

- Two-way clustering on panels (`clustered_id_t`). Standard but more SQL plumbing.
- Staggered TWFE with treatment heterogeneity (Callaway-Sant'Anna, de Chaisemartin-D'Haultfœuille). Different model; not just an SE change.
- LSDV (least-squares dummy variable) with many entity dummies. Dispatcher rejects post-K_THRESHOLD; LSDV stays JS-side.
- Cluster bootstrap (wild cluster bootstrap, pairs bootstrap). Resampling — uses the dispatched path transitively, no dedicated work.
- Panel with serial correlation correction at the within-entity level (Arellano-style HAC). Different formula from Driscoll-Kraay.
- HC2/HC3 for cluster-correlated panels (CR2 in clubSandwich). Tolerance permitting, `computeWithinHCMeatWithLeverage` already approximates CR2 closely; if the validation harness shows >1e-3 SE divergence, lift this into Fase 4c with a proper CR2 builder.

## Done criteria

A Fase 4b ships when:

1. All 12 cells in `runFase4bNumericalValidation()` pass at:
   - β: 6 dp (max abs diff ≤ 1e-6)
   - SE: 4 dp (max abs diff ≤ 1e-4), or 3 dp (≤ 1e-3) for HAC cells with documented df-adjustment differences.
2. The 5 Fase 4 validation cells still pass (no regression).
3. The dispatcher correctly refuses HC2/HC3 when `dim² > 1000` (unit test).
4. Manual smoke test: load `data/example_large_panel.parquet`, estimate FE with cluster SE, open Diagnostics, switch to HC3, switch to HAC — all complete without spinner stuck.
5. `perfLog` shows SQL path activated for n ≥ 50k panel estimations.
6. CLAUDE.md "Pending" item 2a updated with the as-shipped Fase 4b paragraph.

---

**Author:** Franco Medero (planning) · Sonnet/Codex (execution)
**Created:** 2026-05-21
**Status:** Queued — next after Fase 4 commit
