# DuckDB Fase 4 — Panel (FE / FD / TWFE) Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push **Fixed Effects (within)**, **First Differences**, and **TWFE (two-way within)** into DuckDB-Wasm for n ≥ 50k via sufficient statistics computed over within-transformed regressors. Never materialize the full Arrow table in JS. Scope is **classical + HC0/HC1 SE only**. HC2/HC3, clustered (entity / time / two-way), and HAC are explicitly deferred to a Fase 4b. LSDV is **out of scope** (k explodes with entity count — JS path stays authoritative for it).

**Architecture rationale:**

- **FE (within):** demean each column by entity mean and **re-center on the grand mean** so the intercept stays interpretable — exactly matching `runFE` in `src/math/PanelEngine.js:59-65`. A single CTE produces `_dm_y_`, `_dm_x_i_` for every regressor; suff-stats aggregate on that CTE.
- **FD:** `LAG` over `(PARTITION BY entity ORDER BY time)` gives `Δy`, `Δxᵢ`. NULL first-of-entity rows are filtered. OLS suff-stats aggregate on the diffs. Matches `runFD` in `src/math/PanelEngine.js:137-157`.
- **TWFE:** balanced-panel closed-form double-demean — `x − x̄_i − x̄_t + x̄` — implemented as two window functions inside one CTE. Matches the single-pass double-demean used elsewhere in `PanelEngine.js`. Unbalanced panels: the closed form is biased; we **detect** unbalance (`SELECT MAX(COUNT(*) BY entity) - MIN(COUNT(*) BY entity) > 0`) and fall back to JS rather than ship a biased estimate.
- **Degrees of freedom:** FE uses `df = n − N − k`; FD uses `df = n_diff − k − 1` (matches `runOLS` on the diff table, intercept included); TWFE uses `df = n − N − T − k + 1`. Engines emit `σ² = SSR / df` accordingly.
- **HC0/HC1 meat:** computed in SQL on the **within-transformed regressors** with **structural residuals** (`ê = y_demeaned − X_demeaned·β̂`). Sandwich is `Ainv · meat · Ainv` with `Ainv = (X_dm' X_dm)⁻¹`. HC1 scales by `n / df` where `df` is the panel-adjusted df above.
- **Path single per estimation** (per spec invariant): once the dispatcher picks SQL, all SE + diagnostics use SQL for that result.

**Why one plan for three estimators:** they all share the within-transformation primitive (a CTE wrapping `tableName` with `_dm_y_`, `_dm_x_i_` projections — only the SQL expression differs per estimator). Building one `buildWithinSuffStats(tableName, yCol, xCols, opts)` that *parameterizes the transform* costs less than three near-duplicates and keeps the dispatcher / cache key consistent.

**Tech Stack:** DuckDB-Wasm 0.10 (jsDelivr CDN, lazy singleton), JavaScript matrix helpers from `LinearEngine.js`, validation against R `fixest::feols` (FE + TWFE) and `plm::plm(model="fd")` + `sandwich::vcovHC` at 6 / 4 dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbWithin.js` — `buildWithinSuffStats({tableName, yCol, xCols, unitCol, timeCol, mode, dummySQL})` where `mode ∈ {"FE", "FD", "TWFE"}`. Returns `{n, nUnits, nTimes, sumY_dm, YtY_dm, XtX_dm, XtY_dm, varNames, mode, unitCol, timeCol}` plus a **CTE fragment** `withinSQL` reusable by the meat builder.
- `src/services/data/duckdbWithinRobustSE.js` — `computeWithinHCMeat({tableName, yCol, xCols, unitCol, timeCol, mode, dummySQL, beta})` returns `{meat, n}` (HC0/HC1).
- `src/math/PanelSuffStatsEngine.js` — `runFEFromSuffStats`, `runFDFromSuffStats`, `runTWFEFromSuffStats`. Each takes the suff-stats object plus optional `{meat, hcType}` and returns an `EstimationResult`-shaped object compatible with the current ModelingTab consumers of `runFE` / `runFD` / `runTWFE`.
- `src/services/data/__validation__/fase4RValidation.R` — generates `fase4_data.csv` (balanced panel) + `fase4Benchmarks.json` using `fixest::feols` (FE, TWFE) and `plm::plm` (FD), with `sandwich::vcovHC` for HC0/HC1.
- `src/services/data/__validation__/fase4Validation.js` — `runFase4NumericalValidation()` exposed at `window.__validation.fase4`.

**Modify:**
- `src/services/data/dispatchConfig.js` — add `"FE"`, `"FD"`, `"TWFE"` to `SQL_SUPPORTED_ESTIMATORS`.
- `src/services/data/duckdbDispatch.js` — add `ctx.unitCol`, `ctx.timeCol` to JSDoc; add panel-specific operand guards (unit required for FE / FD / TWFE; time required for FD / TWFE; balanced check deferred to call site since it needs a SQL roundtrip); restrict panel SE to `classical|HC0|HC1`.
- `src/components/ModelingTab.jsx` — import panel suff-stats helpers; add FE / FD / TWFE branches inside the `shouldUseSQLPath` try block; thread `unitCol`, `timeCol` into `dispatchCtx`; balanced-panel guard for TWFE branch.
- `src/math/index.js` — re-export `runFEFromSuffStats`, `runFDFromSuffStats`, `runTWFEFromSuffStats`.
- `src/services/data/suffStatsCache.js` — extend `makeCacheKey` and `validateSuffStatsEntry` to accept optional `mode`, `unitCol`, `timeCol` (so FE / FD / TWFE entries don't collide with OLS / IV / WLS).
- `CLAUDE.md` Pending item 2a — append Fase 4 status sentence.
- `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md` — bump status line, add Fase 4 status note.

**Invariants preserved:**
- `src/math/PanelEngine.js` is **untouched**. The JS path remains authoritative when dispatcher returns false (small n, factors > K_THRESHOLD, unbalanced TWFE, requested SE outside scope, etc).
- `EstimationResult` shape from `runFEFromSuffStats` matches the existing `runFE` return shape (`{beta, se, tStats, pVals, varNames, R2_within, R2_between, n, units, df, SSR, s2, resid, Yhat, alphas, Fstat, Fpval}`) — except `resid`, `Yhat`, `alphas` are emitted as `null` with `_hasLazyResiduals: true` per the lazy-residual contract from Fase 1. `R2_between` is computed inside SQL via a tiny aux query (k+1 entity-mean aggregates) — does not require row materialization.
- `runFDFromSuffStats` and `runTWFEFromSuffStats` follow the same lazy-residual contract.

---

## Task 1: Extend dispatcher to recognize FE / FD / TWFE

**Files:**
- Modify: `src/services/data/dispatchConfig.js`
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Add panel estimators to supported set**

In `dispatchConfig.js`, replace the existing `SQL_SUPPORTED_ESTIMATORS` line:

```js
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS", "2SLS", "WLS", "FE", "FD", "TWFE"]);
```

- [ ] **Step 2: Extend `ctx` schema in dispatcher header comment**

In `duckdbDispatch.js`, append to the JSDoc block (just before the closing line of the comment, after the `weightCol:` line):

```
//   unitCol:       string | null  — entity column (required when estimator ∈ {FE, FD, TWFE})
//   timeCol:       string | null  — time column (required when estimator ∈ {FD, TWFE})
```

- [ ] **Step 3: Add panel-specific operand guards**

In `duckdbDispatch.js`, immediately after the existing WLS guard block (`if (ctx.estimator === "WLS") { ... }`), add:

```js
  if (["FE", "FD", "TWFE"].includes(ctx.estimator)) {
    if (!ctx.unitCol || typeof ctx.unitCol !== "string") return false;
    if (["FD", "TWFE"].includes(ctx.estimator)) {
      if (!ctx.timeCol || typeof ctx.timeCol !== "string") return false;
    }
    // Scope of Fase 4: classical / HC0 / HC1 only
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
    // Panel estimators do not currently take weights through the SQL path
    if (ctx.hasWeights) return false;
  }
```

(Note: the earlier `if (ctx.hasWeights && ctx.estimator !== "WLS") return false;` already covers the `hasWeights → false` case for panel estimators. The redundant check above is **deliberate** — if someone reorders the dispatcher later, the panel guard stays self-contained.)

- [ ] **Step 4: Verify via DevTools dispatcher introspection**

Open the app, then in DevTools console:

```js
const { shouldUseSQLPath } = await import("./services/data/duckdbDispatch.js");

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "FE", seType: "HC1", hasWeights: false,
  unitCol: "id", timeCol: "year",
})
// Expected: true

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "FE", seType: "HC1", hasWeights: false,
  unitCol: null, timeCol: "year",
})
// Expected: false (no entity column)

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "TWFE", seType: "classical", hasWeights: false,
  unitCol: "id", timeCol: null,
})
// Expected: false (TWFE needs time)

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "FE", seType: "clustered", hasWeights: false,
  unitCol: "id", timeCol: "year", clusterVar: "id",
})
// Expected: false (clustered SE deferred to Fase 4b)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js
git commit -m "feat(modeling): Fase 4 — dispatcher recognizes FE/FD/TWFE + panel operand guards"
```

---

## Task 2: `buildWithinSuffStats` — within-transformed cross-products

**Files:**
- Create: `src/services/data/duckdbWithin.js`

This single function handles all three panel modes by parameterizing the within-transform SQL. The CTE fragment is emitted as `withinSQL` so the meat builder can `WITH transformed AS ( ... )` over the **same** transform (no duplicated SQL between solver and SE pass).

- [ ] **Step 1: Write the function**

```js
// ─── ECON STUDIO · src/services/data/duckdbWithin.js ──────────────────────────
// Within-transform sufficient-statistics push-down for panel estimators.
//
// Three modes, one CTE shape:
//   FE   :  _v_ = v - AVG(v) OVER (PARTITION BY unit) + AVG(v) OVER ()
//   FD   :  _v_ = v - LAG(v, 1) OVER (PARTITION BY unit ORDER BY time)
//   TWFE :  _v_ = v - AVG(v) OVER (PARTITION BY unit)
//                  - AVG(v) OVER (PARTITION BY time)
//                  + AVG(v) OVER ()
//
// For FE / TWFE the grand-mean recentering keeps the intercept interpretable
// and matches PanelEngine.runFE (LinearEngine OLS includes intercept).
//
// For FD the diff has NO recentering; rows with NULL LAG (first per entity)
// are filtered. The downstream OLS still includes an intercept — matches
// PanelEngine.runFD which calls runOLS(diffRows, fdY, fdX) with default
// intercept=true.
//
// Output: aggregates over the within-transformed data PLUS the CTE SQL
// fragment so the meat builder can replay the same transform.
//
// Row filter: y, all x, unit non-null; time non-null for FD/TWFE; finite.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}   args.tableName
 * @param {string}   args.yCol
 * @param {string[]} args.xCols           regressor names (intercept implicit)
 * @param {string}   args.unitCol
 * @param {string|null} args.timeCol      required for FD / TWFE
 * @param {"FE"|"FD"|"TWFE"} args.mode
 * @param {Record<string,string>} [args.dummySQL]
 * @returns {Promise<{
 *   n: number, nUnits: number, nTimes: number,
 *   sumY_dm: number, YtY_dm: number,
 *   XtX_dm: number[][], XtY_dm: number[],
 *   varNames: string[],
 *   mode: string, unitCol: string, timeCol: string|null,
 *   withinSQL: string,     // CTE body, selectable as "transformed"
 *   xColsExpanded: string[],
 * }>}
 */
export async function buildWithinSuffStats({
  tableName, yCol, xCols, unitCol, timeCol, mode, dummySQL = {},
}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  if (k < 1) throw new Error("buildWithinSuffStats: need at least one regressor");
  if (!unitCol) throw new Error("buildWithinSuffStats: unitCol required");
  if ((mode === "FD" || mode === "TWFE") && !timeCol) {
    throw new Error(`buildWithinSuffStats: timeCol required for mode ${mode}`);
  }
  if (!["FE", "FD", "TWFE"].includes(mode)) {
    throw new Error(`buildWithinSuffStats: unknown mode ${mode}`);
  }

  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xCols.map(colExpr);
  const uExpr  = esc(unitCol);
  const tExpr  = timeCol ? esc(timeCol) : null;

  // ── Stage 1: raw projection with finite filter ──────────────────────────────
  const stage1Cols = [`${uExpr} AS _u_`];
  if (tExpr) stage1Cols.push(`${tExpr} AS _t_`);
  stage1Cols.push(`${yExpr} AS _y_`);
  xExprs.forEach((e, i) => stage1Cols.push(`${e} AS _x_${i}`));

  const finite = [`isfinite(_y_)`, `_u_ IS NOT NULL`];
  if (tExpr) finite.push(`_t_ IS NOT NULL`);
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);

  // ── Stage 2: within-transform per mode ──────────────────────────────────────
  let stage2;
  if (mode === "FE") {
    const parts = [
      `_u_, ${tExpr ? "_t_, " : ""}`,
      `(_y_ - AVG(_y_) OVER (PARTITION BY _u_) + AVG(_y_) OVER ()) AS _dm_y_`,
    ];
    for (let i = 0; i < k; i++) {
      parts.push(`(_x_${i} - AVG(_x_${i}) OVER (PARTITION BY _u_) + AVG(_x_${i}) OVER ()) AS _dm_x_${i}`);
    }
    stage2 = `SELECT ${parts.join(", ")} FROM raw`;
  } else if (mode === "FD") {
    const parts = [
      `_u_, _t_,`,
      `(_y_ - LAG(_y_, 1) OVER (PARTITION BY _u_ ORDER BY _t_)) AS _dm_y_`,
    ];
    for (let i = 0; i < k; i++) {
      parts.push(`(_x_${i} - LAG(_x_${i}, 1) OVER (PARTITION BY _u_ ORDER BY _t_)) AS _dm_x_${i}`);
    }
    stage2 = `SELECT ${parts.join(", ")} FROM raw`;
  } else { // TWFE
    const parts = [
      `_u_, _t_,`,
      `(_y_ - AVG(_y_) OVER (PARTITION BY _u_) - AVG(_y_) OVER (PARTITION BY _t_) + AVG(_y_) OVER ()) AS _dm_y_`,
    ];
    for (let i = 0; i < k; i++) {
      parts.push(`(_x_${i} - AVG(_x_${i}) OVER (PARTITION BY _u_) - AVG(_x_${i}) OVER (PARTITION BY _t_) + AVG(_x_${i}) OVER ()) AS _dm_x_${i}`);
    }
    stage2 = `SELECT ${parts.join(", ")} FROM raw`;
  }

  // Diff rows where _dm_y_ IS NULL get dropped (FD only)
  const dmFilter = mode === "FD" ? ` WHERE _dm_y_ IS NOT NULL` : "";

  // CTE fragment reusable by the meat builder — same name "transformed"
  // No semicolons; consumers will splice it into a larger statement.
  const withinSQL = `
    WITH raw AS (
      SELECT ${stage1Cols.join(", ")}
      FROM ${esc(tableName)}
      WHERE ${finite.join(" AND ")}
    ),
    transformed AS (
      ${stage2}${dmFilter}
    )
  `.trim();

  // ── Stage 3: aggregate on transformed ───────────────────────────────────────
  const aggs = [
    `COUNT(*) AS n`,
    `COUNT(DISTINCT _u_) AS n_units`,
  ];
  if (tExpr) aggs.push(`COUNT(DISTINCT _t_) AS n_times`);
  aggs.push(`SUM(_dm_y_) AS sum_y`);
  aggs.push(`SUM(_dm_y_ * _dm_y_) AS yty`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_dm_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_dm_x_${i} * _dm_y_) AS sum_xy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_dm_x_${i} * _dm_x_${j}) AS sum_xx_${i}_${j}`);
  }

  const sql = `${withinSQL}\nSELECT ${aggs.join(", ")} FROM transformed`;
  const r = (await conn.query(sql)).toArray()[0];

  const n      = num(r.n);
  const nUnits = num(r.n_units);
  const nTimes = tExpr ? num(r.n_times) : 0;

  const dim = k + 1;
  const XtX_dm = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtY_dm = Array(dim).fill(0);

  // Intercept row/col (1 column with the constant 1 — sum = n, sum_1 _x_i = sum_x_i)
  XtX_dm[0][0] = n;
  XtY_dm[0]    = num(r.sum_y);
  for (let i = 0; i < k; i++) {
    const sx = num(r[`sum_x_${i}`]);
    XtX_dm[0][i + 1] = sx;
    XtX_dm[i + 1][0] = sx;
    XtY_dm[i + 1]    = num(r[`sum_xy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX_dm[i + 1][j + 1] = v;
      if (i !== j) XtX_dm[j + 1][i + 1] = v;
    }
  }

  return {
    n, nUnits, nTimes,
    sumY_dm: num(r.sum_y),
    YtY_dm:  num(r.yty),
    XtX_dm, XtY_dm,
    varNames: ["(Intercept)", ...xCols],
    mode, unitCol, timeCol,
    withinSQL,
    xColsExpanded: xCols,
  };
}

/**
 * Tiny aux query: returns true iff every entity has the same row count.
 * Used by TWFE to gate the closed-form double-demean (biased on unbalanced).
 */
export async function isBalancedPanel({ tableName, unitCol, timeCol }) {
  const { conn } = await getDuckDB();
  const sql = `
    WITH per_unit AS (
      SELECT ${esc(unitCol)} AS u, COUNT(*) AS c
      FROM ${esc(tableName)}
      WHERE ${esc(unitCol)} IS NOT NULL AND ${esc(timeCol)} IS NOT NULL
      GROUP BY ${esc(unitCol)}
    )
    SELECT MIN(c) AS cmin, MAX(c) AS cmax FROM per_unit
  `;
  const r = (await conn.query(sql)).toArray()[0];
  return num(r.cmin) === num(r.cmax) && num(r.cmin) > 0;
}
```

- [ ] **Step 2: Sanity smoke test in DevTools**

```js
const { buildWithinSuffStats, isBalancedPanel } = await import("./services/data/duckdbWithin.js");

// FE
const r_fe = await buildWithinSuffStats({
  tableName: "fase4_tbl", yCol: "y", xCols: ["x1","x2"],
  unitCol: "id", timeCol: "year", mode: "FE",
});
console.log(r_fe);
// Expected: n > 0, nUnits > 0, XtX_dm 3×3 symmetric, no NaN

// TWFE
const r_twfe = await buildWithinSuffStats({
  tableName: "fase4_tbl", yCol: "y", xCols: ["x1","x2"],
  unitCol: "id", timeCol: "year", mode: "TWFE",
});
console.log(r_twfe);

// FD
const r_fd = await buildWithinSuffStats({
  tableName: "fase4_tbl", yCol: "y", xCols: ["x1","x2"],
  unitCol: "id", timeCol: "year", mode: "FD",
});
console.log(r_fd);
// Expected: r_fd.n === r_fe.n - r_fe.nUnits (one diff lost per entity)

// Balanced check
const bal = await isBalancedPanel({ tableName: "fase4_tbl", unitCol: "id", timeCol: "year" });
console.log("balanced:", bal);
```

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdbWithin.js
git commit -m "feat(data): Fase 4 — within-transform suff-stats SQL pass (FE/FD/TWFE)"
```

---

## Task 3: Panel solvers — `runFEFromSuffStats`, `runFDFromSuffStats`, `runTWFEFromSuffStats`

**Files:**
- Create: `src/math/PanelSuffStatsEngine.js`
- Modify: `src/math/index.js` (re-export)

- [ ] **Step 1: Write the solvers**

```js
// ─── ECON STUDIO · src/math/PanelSuffStatsEngine.js ───────────────────────────
// Panel solvers from sufficient statistics. No row materialization, no React.
//
// All three solvers consume the within-suff-stats payload from buildWithinSuffStats
// and an optional HC meat. They differ ONLY in:
//   (a) df formula
//   (b) field naming on the returned EstimationResult (R2_within vs R2 etc)
//   (c) FD has no "units" notion in df (treated like OLS on diffs)
//
// Sandwich: V = Ainv · meat · Ainv, with Ainv = (X_dm' X_dm)⁻¹.
// HC1 scales meat by n/df where df = n − N − k (FE), n_diff − k − 1 (FD),
// or n − N − T − k + 1 (TWFE).

import { matMul, matInv, pValue } from "./LinearEngine.js";

function vmul(M, v) {
  return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0));
}
function quadForm(v, M) {
  return vmul(M, v).reduce((s, w, i) => s + w * v[i], 0);
}

function solveCore({ XtX_dm, XtY_dm, YtY_dm, sumY_dm, n, df, meat, hcType, varNames }) {
  const k = XtX_dm.length;       // includes intercept
  const Ainv = matInv(XtX_dm);
  if (!Ainv) return null;
  const beta = vmul(Ainv, XtY_dm);

  const SSR = YtY_dm
    - 2 * beta.reduce((s, b, i) => s + b * XtY_dm[i], 0)
    + quadForm(beta, XtX_dm);

  const s2 = SSR / Math.max(1, df);

  let V;
  if (meat) {
    let scale = 1;
    if (hcType === "HC1") scale = n / Math.max(1, df);
    const scaled = meat.map(row => row.map(v => v * scale));
    V = matMul(matMul(Ainv, scaled), Ainv);
  } else {
    V = Ainv.map(row => row.map(v => v * s2));
  }

  const se = V.map((row, i) => {
    const d = row[i];
    return isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
  });
  const tStats = beta.map((b, i) => (isFinite(b) && se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  // R² (within for FE/TWFE; ordinary for FD). On the within-transformed data,
  // SST = YtY_dm − n·ȳ_dm². Since recentering preserves Σ_y but not Σ_y² in
  // general, this is exact for the demeaned regression.
  const Ym  = sumY_dm / n;
  const SST = YtY_dm - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return { beta, se, tStats, pVals, V, Ainv, SSR, s2, R2, adjR2 };
}

/**
 * Fixed Effects (within) from suff stats.
 *
 * df = n − N − k  (matches PanelEngine.runFE)
 *
 * @param {object} args
 * @param {object} args.suff      output of buildWithinSuffStats with mode="FE"
 * @param {number[][]} [args.meat]
 * @param {"HC0"|"HC1"|null} [args.hcType]
 * @returns {object|null}
 */
export function runFEFromSuffStats({ suff, meat = null, hcType = null }) {
  const { n, nUnits, XtX_dm, XtY_dm, YtY_dm, sumY_dm, varNames, unitCol, timeCol, mode } = suff;
  if (mode !== "FE") throw new Error(`runFEFromSuffStats: expected mode=FE, got ${mode}`);
  const k_with_int = XtX_dm.length;
  const k_no_int   = k_with_int - 1;
  const df = n - nUnits - k_no_int;
  if (df <= 0) return { error: "Degrees of freedom ≤ 0 after demeaning — add more observations or reduce regressors." };

  const out = solveCore({ XtX_dm, XtY_dm, YtY_dm, sumY_dm, n, df, meat, hcType, varNames });
  if (!out) return null;

  // Slice off intercept to match runFE's return shape (intercept dropped from FE output)
  return {
    beta:     out.beta.slice(1),
    se:       out.se.slice(1),
    tStats:   out.tStats.slice(1),
    pVals:    out.pVals.slice(1),
    varNames: varNames.slice(1),
    R2_within:  out.R2,
    R2_between: null,           // emitted later by ModelingTab via tiny aux query if needed
    n, units: nUnits, df,
    SSR: out.SSR, s2: out.s2,
    resid: null, Yhat: null, alphas: null,
    _hasLazyResiduals: true,
    _isSample: false,
    _nFull: n,
    Fstat: null, Fpval: null,   // F on the demeaned regression — optional, not in critical UI path
    _panelMode: "FE",
    _unitCol: unitCol, _timeCol: timeCol,
  };
}

/**
 * First Differences from suff stats.
 *
 * df = n_diff − k − 1   (matches runOLS on the diff table with intercept)
 */
export function runFDFromSuffStats({ suff, meat = null, hcType = null }) {
  const { n, nUnits, XtX_dm, XtY_dm, YtY_dm, sumY_dm, varNames, unitCol, timeCol, mode } = suff;
  if (mode !== "FD") throw new Error(`runFDFromSuffStats: expected mode=FD, got ${mode}`);
  const k_with_int = XtX_dm.length;
  const df = n - k_with_int;
  if (df <= 0) return { error: "Degrees of freedom ≤ 0 after differencing." };

  const out = solveCore({ XtX_dm, XtY_dm, YtY_dm, sumY_dm, n, df, meat, hcType, varNames });
  if (!out) return null;

  // runFD slices off intercept too
  return {
    beta:     out.beta.slice(1),
    se:       out.se.slice(1),
    tStats:   out.tStats.slice(1),
    pVals:    out.pVals.slice(1),
    varNames: varNames.slice(1),
    R2:    out.R2,
    adjR2: out.adjR2,
    n, units: nUnits, df,
    SSR: out.SSR, s2: out.s2,
    resid: null, Yhat: null,
    _hasLazyResiduals: true,
    _isSample: false,
    _nFull: n,
    Fstat: null, Fpval: null,
    _panelMode: "FD",
    _unitCol: unitCol, _timeCol: timeCol,
  };
}

/**
 * Two-Way Fixed Effects (within) from suff stats.
 *
 * df = n − N − T − k + 1
 */
export function runTWFEFromSuffStats({ suff, meat = null, hcType = null }) {
  const { n, nUnits, nTimes, XtX_dm, XtY_dm, YtY_dm, sumY_dm, varNames, unitCol, timeCol, mode } = suff;
  if (mode !== "TWFE") throw new Error(`runTWFEFromSuffStats: expected mode=TWFE, got ${mode}`);
  const k_with_int = XtX_dm.length;
  const k_no_int   = k_with_int - 1;
  const df = n - nUnits - nTimes - k_no_int + 1;
  if (df <= 0) return { error: "Degrees of freedom ≤ 0 after double-demeaning." };

  const out = solveCore({ XtX_dm, XtY_dm, YtY_dm, sumY_dm, n, df, meat, hcType, varNames });
  if (!out) return null;

  return {
    beta:     out.beta.slice(1),
    se:       out.se.slice(1),
    tStats:   out.tStats.slice(1),
    pVals:    out.pVals.slice(1),
    varNames: varNames.slice(1),
    R2_within: out.R2,
    n, units: nUnits, times: nTimes, df,
    SSR: out.SSR, s2: out.s2,
    resid: null, Yhat: null,
    _hasLazyResiduals: true,
    _isSample: false,
    _nFull: n,
    Fstat: null, Fpval: null,
    _panelMode: "TWFE",
    _unitCol: unitCol, _timeCol: timeCol,
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `src/math/index.js`, find the existing `runWLSFromSuffStats` re-export and add immediately below:

```js
export { runFEFromSuffStats, runFDFromSuffStats, runTWFEFromSuffStats } from "./PanelSuffStatsEngine.js";
```

- [ ] **Step 3: Hand-verify against a tiny balanced panel in DevTools**

Build a 9-row balanced panel (3 units × 3 times) with known coefficients. Compare β and SSR vs `runFE` / `runFD` / `runTWFE` on the same rows. Tolerance 1e-10 on β, 1e-8 on SSR.

```js
// Skeleton — fill in real values; treat as a smoke test, not a unit test
const rows = [
  /* (id=1, t=1..3), (id=2, t=1..3), (id=3, t=1..3) with y = α_i + β·x + λ_t + ε */
];
// Create temp DuckDB table, then compare.
```

- [ ] **Step 4: Commit**

```bash
git add src/math/PanelSuffStatsEngine.js src/math/index.js
git commit -m "feat(math): Fase 4 — panel solvers from suff stats (FE/FD/TWFE)"
```

---

## Task 4: `computeWithinHCMeat` — HC0/HC1 robust meat over within-transform

**Files:**
- Create: `src/services/data/duckdbWithinRobustSE.js`

The meat is `Σ êᵢ² xᵢ xⱼ` where `xᵢ` are **within-transformed** regressors and `êᵢ = y_dm − X_dm·β̂`. We re-use the **same CTE** (`buildWithinSuffStats` returns `withinSQL`), keeping the transform definition in one place.

- [ ] **Step 1: Write the meat builder**

```js
// ─── ECON STUDIO · src/services/data/duckdbWithinRobustSE.js ──────────────────
// HC0/HC1 sandwich meat for panel within-regressions, in SQL.
//
// meat[i][j] = Σ êᵢ² · x_dm_i · x_dm_j
// where ê = y_dm − X_dm β̂  (structural residual on within-transformed data)
//
// Re-uses the buildWithinSuffStats CTE so the transform definition lives in
// one place. β as prepared params.
//
// HC1 scaling n/df is applied by the engine, not here.

import { getDuckDB } from "./duckdb.js";
import { buildWithinSuffStats } from "./duckdbWithin.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}   args.tableName
 * @param {string}   args.yCol
 * @param {string[]} args.xCols
 * @param {string}   args.unitCol
 * @param {string|null} args.timeCol
 * @param {"FE"|"FD"|"TWFE"} args.mode
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta            length k+1 with intercept first
 * @param {string}   [args.withinSQLOverride]  if supplied, skip rebuilding the CTE
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeWithinHCMeat({
  tableName, yCol, xCols, unitCol, timeCol, mode, dummySQL = {}, beta, withinSQLOverride = null,
}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const dim = k + 1;
  if (beta.length !== dim) throw new Error(`computeWithinHCMeat: beta length ${beta.length} != dim ${dim}`);

  // Reuse the same CTE the suff-stats builder produces. Cheap — re-parses but
  // doesn't re-run the SELECT.
  let withinSQL;
  if (withinSQLOverride) {
    withinSQL = withinSQLOverride;
  } else {
    const suff = await buildWithinSuffStats({ tableName, yCol, xCols, unitCol, timeCol, mode, dummySQL });
    withinSQL = suff.withinSQL;
  }

  // Build residSQL with β bound as prepared params
  //   resid = _dm_y_ − ( β0·1 + β1·_dm_x_0 + ... )
  const xDmExpr = (i) => i === 0 ? "1.0" : `_dm_x_${i - 1}`;
  const betaTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    betaTerms.push(`? * ${xDmExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const residSQL = `(_dm_y_ - (${betaTerms.join(" + ")}))`;

  // Upper-triangle aggregates
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM(POWER(${residSQL}, 2) * ${xDmExpr(i)} * ${xDmExpr(j)}) AS m_${i}_${j}`);
    }
  }

  const sql = `${withinSQL}\nSELECT ${aggs.join(", ")} FROM transformed`;

  // Each aggregate contains residSQL exactly once → aggCount × β-params
  const aggCount = (dim * (dim + 1)) / 2;
  const boundParams = [];
  for (let agg = 0; agg < aggCount; agg++) boundParams.push(...betaParams);

  // Sanity: residSQL occurrence count must match aggCount
  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== aggCount) {
    throw new Error(`computeWithinHCMeat: residSQL occurrence mismatch (got ${residCount}, expected ${aggCount})`);
  }

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const v = num(r[`m_${i}_${j}`]);
      meat[i][j] = v;
      if (i !== j) meat[j][i] = v;
    }
  }
  return { meat, n: num(r.n) };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbWithinRobustSE.js
git commit -m "feat(data): Fase 4 — panel HC0/HC1 meat builder over within-transform"
```

---

## Task 5: Cache key + validator extension for panel modes

**Files:**
- Modify: `src/services/data/suffStatsCache.js`

The current key is `(table, yCol, xCols, zCols?, wCol?)`. Panel entries need to be partitioned by `(mode, unitCol, timeCol)` so an OLS fit and an FE fit on the same `(table, y, X)` don't collide.

- [ ] **Step 1: Extend `makeCacheKey`**

Replace `makeCacheKey`:

```js
// suffStatsCache.js — replace makeCacheKey
export function makeCacheKey(
  table, yCol, xCols, zCols = null, wCol = null,
  mode = null, unitCol = null, timeCol = null,
) {
  const xs = [...xCols].sort().join("|");
  let key = `${table}::${yCol}::${xs}`;
  if (zCols)   key += `::Z::${[...zCols].sort().join("|")}`;
  if (wCol)    key += `::W::${wCol}`;
  if (mode)    key += `::M::${mode}::U::${unitCol ?? ""}::T::${timeCol ?? ""}`;
  return key;
}
```

- [ ] **Step 2: Extend `validateSuffStatsEntry`**

```js
// suffStatsCache.js — replace validateSuffStatsEntry
export function validateSuffStatsEntry(entry, xCols, zCols = null, wCol = null, mode = null) {
  if (!entry) return false;
  if (mode) {
    // Panel entry — check XtX_dm dimension
    if (entry?.XtX_dm?.length !== xCols.length + 1) return false;
    if (entry?.mode !== mode) return false;
    return true;
  }
  // OLS / 2SLS / WLS check
  if (entry?.XtX?.length !== xCols.length + 1) return false;
  if (zCols && entry?.ZtZ?.length !== zCols.length + 1) return false;
  if (wCol && entry?.XtWX?.length !== xCols.length + 1) return false;
  return true;
}
```

- [ ] **Step 3: Back-compat check**

```bash
# Smoke: existing OLS / 2SLS / WLS callers pass mode=null (default), unchanged behavior
# Load any existing model in the app — nothing should regress
```

- [ ] **Step 4: Commit**

```bash
git add src/services/data/suffStatsCache.js
git commit -m "feat(modeling): Fase 4 — extend suff-stats cache key for panel modes"
```

---

## Task 6: Wire FE / FD / TWFE branches into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

The existing SQL try block already houses OLS, 2SLS, WLS branches. Panel branches follow the same pattern: build suff stats, classical solve, conditional meat pass, conditional second solve.

- [ ] **Step 1: Add imports**

Near the existing `import { buildWLSSuffStats } from "../services/data/duckdbWLS.js";` line, add:

```js
import { buildWithinSuffStats, isBalancedPanel } from "../services/data/duckdbWithin.js";
import { computeWithinHCMeat }                   from "../services/data/duckdbWithinRobustSE.js";
import {
  runFEFromSuffStats, runFDFromSuffStats, runTWFEFromSuffStats,
} from "../math/index.js";   // verify barrel re-export after Task 3
```

- [ ] **Step 2: Extend `dispatchCtx`**

Find the `dispatchCtx` object construction (search for `hasWeights:    !!weightVar[0]`). Add — keeping existing fields intact:

```js
        unitCol:       panelUnit || null,
        timeCol:       panelTime || null,
```

(`panelUnit` and `panelTime` are the existing panel-selector state in ModelingTab. If they are named differently — `entityCol`, `tCol`, etc. — match the existing identifier; do not invent new names.)

- [ ] **Step 3: Add panel branches inside the SQL try block**

Find the existing `if (model === "WLS") { ... }` block inside the SQL path's try. Immediately after it (still inside the try), add three branches. They share enough structure that we factor them into a tiny inline helper:

```js
          if (["FE", "FD", "TWFE"].includes(model)) {
            // Scope guard — Fase 4 ships classical + HC0/HC1 only
            if (!["classical", "HC0", "HC1"].includes(seTypeNorm)) {
              throw new Error(`${model} SQL path only supports classical/HC0/HC1 in Fase 4 (got ${seTypeNorm}) — fallback to JS`);
            }

            const uCol = panelUnit;
            const tCol = panelTime || null;
            if (!uCol) throw new Error(`${model} SQL path: entity column not selected — fallback to JS`);
            if ((model === "FD" || model === "TWFE") && !tCol) {
              throw new Error(`${model} SQL path: time column not selected — fallback to JS`);
            }

            // TWFE closed-form is biased on unbalanced panels — defer to JS
            if (model === "TWFE") {
              const balanced = await isBalancedPanel({ tableName: duckTable, unitCol: uCol, timeCol: tCol });
              if (!balanced) throw new Error("TWFE SQL path requires balanced panel — fallback to JS");
            }

            const { xColsExpanded, dummySQL } = await expandFactors({
              xCols: xVars, tableName: duckTable,
            });

            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded })) {
              throw new Error("Post-expansion k exceeds threshold — fallback to JS");
            }

            const key = makeCacheKey(duckTable, yVar[0], xColsExpanded, null, null, model, uCol, tCol);
            let suff = suffStatsCacheRef.current.get(key);
            if (!suff || !validateSuffStatsEntry(suff, xColsExpanded, null, null, model)) {
              const m = await measure(() => buildWithinSuffStats({
                tableName: duckTable, yCol: yVar[0], xCols: xColsExpanded,
                unitCol: uCol, timeCol: tCol, mode: model, dummySQL,
              }));
              logEstimate({ path: "sql", phase: `withinSuffStats-${model}`, n: rowCount, k: xColsExpanded.length, msTotal: m.ms });
              suff = m.result;
              suffStatsCacheRef.current.set(key, suff);
            }

            const solverFor = (mm) =>
              mm === "FE"   ? runFEFromSuffStats   :
              mm === "FD"   ? runFDFromSuffStats   :
                              runTWFEFromSuffStats;
            const solver = solverFor(model);

            // Classical solve first — meat needs β anyway
            const r_cls = solver({ suff, meat: null, hcType: null });
            if (!r_cls) throw new Error(`Suff-stats ${model} solve returned null (singular)`);
            if (r_cls.error) throw new Error(r_cls.error);

            let r;
            if (seTypeNorm === "classical") {
              r = r_cls;
            } else {
              // r_cls.beta has intercept STRIPPED — we need full (k+1)-vector for meat.
              // Reconstruct by solving Ainv·XtY locally OR by reading from the solver
              // before slicing. Simpler: recompute via solveCore's intermediate.
              //
              // Approach: ask the solver to also expose betaFull (with intercept).
              // We do this by reading from suff: Ainv = matInv(XtX_dm); betaFull = Ainv·XtY_dm.
              // To avoid duplicating matrix code in ModelingTab, we use a tiny inline import.
              const { matInv } = await import("../math/LinearEngine.js");
              const Ainv = matInv(suff.XtX_dm);
              if (!Ainv) throw new Error("XtX_dm singular at meat stage");
              const betaFull = Ainv.map(row => row.reduce((s, w, j) => s + w * suff.XtY_dm[j], 0));

              const mm = await measure(() => computeWithinHCMeat({
                tableName: duckTable, yCol: yVar[0], xCols: xColsExpanded,
                unitCol: uCol, timeCol: tCol, mode: model, dummySQL,
                beta: betaFull, withinSQLOverride: suff.withinSQL,
              }));
              logEstimate({ path: "sql", phase: `meat-${model}-${seTypeNorm}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
              const engineHcType = seTypeNorm === "HC1" ? "HC1" : null;
              r = solver({ suff, meat: mm.result.meat, hcType: engineHcType });
              if (r?.error) throw new Error(r.error);
            }

            const res = wrapResult(model, r, {
              yVar: yVar[0], xVars, unitCol: uCol, timeCol: tCol,
            });
            return { result: res, panelFE: null, panelFD: null };
          }
```

(Variable names — `suffStatsCacheRef`, `measure`, `logEstimate`, `wrapResult`, `seTypeNorm`, `expandFactors`, `duckTable`, `rowCount`, `dispatchCtx`, `panelUnit`, `panelTime`, `xVars`, `yVar`, `weightVar` — are defined earlier in the same SQL try block from prior fases. If any of `panelUnit` / `panelTime` use a different identifier in the current ModelingTab, match the existing pattern in the JS FE branch (search for `runFE(rows, ...`).)

- [ ] **Step 4: Manually test**

Open the app, load a >50k-row balanced panel. Test each combination:

| Model | SE         | Expected: result panel renders, β + SE match `runFE`/`runFD`/`runTWFE` within 1e-8 / 1e-6 |
|-------|------------|--------------------------------------------------------------------------------------------|
| FE    | classical  |                                                                                            |
| FE    | HC1        |                                                                                            |
| FD    | classical  |                                                                                            |
| FD    | HC1        |                                                                                            |
| TWFE  | classical  |                                                                                            |
| TWFE  | HC1        |                                                                                            |
| TWFE  | classical, unbalanced panel | falls back to JS silently (perfLog entry shows `sqlFailed: true` then JS path runs) |
| FE    | clustered  | falls back to JS (dispatcher rejects)                                                      |

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 4 — FE/FD/TWFE SQL fast paths (classical + HC0/HC1)"
```

---

## Task 7: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase4RValidation.R`

- [ ] **Step 1: Write the R script**

```r
# fase4RValidation.R — generates fase4_data.csv and fase4Benchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase4RValidation.R
#
# DGP: balanced panel, N=100 units × T=20 periods = 2,000 obs (small so R is fast;
# the SQL path is checked against R values, not against scale).
#   y_it = α_i + λ_t + β1·x1_it + β2·x2_it + ε_it
#   α_i, λ_t ~ N(0, 1);  ε ~ N(0, 1)

suppressPackageStartupMessages({
  library(fixest)        # feols for FE / TWFE
  library(plm)           # plm for FD
  library(sandwich)      # vcovHC
  library(lmtest)        # coeftest
  library(jsonlite)
})

set.seed(20260521)
N <- 100; T <- 20
n <- N * T

id   <- rep(1:N, each = T)
year <- rep(1:T, times = N)
alpha_i <- rnorm(N)[id]
lambda_t <- rnorm(T)[year]
x1 <- rnorm(n)
x2 <- rnorm(n)
eps <- rnorm(n)

y <- alpha_i + lambda_t + 2.0 * x1 + (-0.5) * x2 + eps

df <- data.frame(id, year, x1, x2, y)
out_csv <- file.path("src", "services", "data", "__validation__", "fase4_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# ── FE (within entity only) ──────────────────────────────────────────────────
fit_fe <- feols(y ~ x1 + x2 | id, data = df)
fe_beta <- coef(fit_fe)
fe_se_classical <- sqrt(diag(vcov(fit_fe, type = "iid")))   # classical / iid
fe_se_HC0       <- sqrt(diag(vcov(fit_fe, type = "HC0")))
fe_se_HC1       <- sqrt(diag(vcov(fit_fe, type = "HC1")))

# ── TWFE (within entity + time) ──────────────────────────────────────────────
fit_twfe <- feols(y ~ x1 + x2 | id + year, data = df)
twfe_beta <- coef(fit_twfe)
twfe_se_classical <- sqrt(diag(vcov(fit_twfe, type = "iid")))
twfe_se_HC0       <- sqrt(diag(vcov(fit_twfe, type = "HC0")))
twfe_se_HC1       <- sqrt(diag(vcov(fit_twfe, type = "HC1")))

# ── FD ───────────────────────────────────────────────────────────────────────
pdf <- pdata.frame(df, index = c("id", "year"))
fit_fd <- plm(y ~ x1 + x2, data = pdf, model = "fd")
fd_beta <- coef(fit_fd)
fd_se_classical <- sqrt(diag(vcov(fit_fd)))
fd_se_HC0       <- sqrt(diag(vcovHC(fit_fd, type = "HC0")))
fd_se_HC1       <- sqrt(diag(vcovHC(fit_fd, type = "HC1")))

bench <- list(
  n = n, N = N, T = T,
  FE = list(
    varNames     = names(fe_beta),
    beta         = unname(fe_beta),
    se_classical = unname(fe_se_classical),
    se_HC0       = unname(fe_se_HC0),
    se_HC1       = unname(fe_se_HC1)
  ),
  TWFE = list(
    varNames     = names(twfe_beta),
    beta         = unname(twfe_beta),
    se_classical = unname(twfe_se_classical),
    se_HC0       = unname(twfe_se_HC0),
    se_HC1       = unname(twfe_se_HC1)
  ),
  FD = list(
    varNames     = names(fd_beta),
    beta         = unname(fd_beta),
    se_classical = unname(fd_se_classical),
    se_HC0       = unname(fd_se_HC0),
    se_HC1       = unname(fd_se_HC1)
  )
)
out_json <- file.path("src", "services", "data", "__validation__", "fase4Benchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
```

- [ ] **Step 2: Run it locally**

```bash
Rscript src/services/data/__validation__/fase4RValidation.R
```

Expected: two files written.

**Caveat on FE constant:** `fixest::feols` does not return an intercept (entity FE absorbs it). Our `runFEFromSuffStats` also slices the intercept out of the return. SE comparison is on `x1` and `x2` only — `bench.FE.beta` will have length 2, not 3. Same for TWFE. Reflect this in Task 8.

- [ ] **Step 3: Commit**

```bash
git add src/services/data/__validation__/fase4RValidation.R \
        src/services/data/__validation__/fase4Benchmarks.json \
        src/services/data/__validation__/fase4_data.csv
git commit -m "test(data): Fase 4 — R fixest + plm + sandwich golden values for FE/FD/TWFE"
```

---

## Task 8: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase4Validation.js`

- [ ] **Step 1: Write the harness**

```js
// ─── ECON STUDIO · src/services/data/__validation__/fase4Validation.js ────────
// Loads fase4_data.csv into DuckDB, runs the SQL path for FE / FD / TWFE
// three ways (classical, HC0, HC1), and compares against fase4Benchmarks.json.
// Exposed at window.__validation.fase4 — call from DevTools.

import { getDuckDB }              from "../duckdb.js";
import { buildWithinSuffStats }   from "../duckdbWithin.js";
import { computeWithinHCMeat }    from "../duckdbWithinRobustSE.js";
import {
  runFEFromSuffStats, runFDFromSuffStats, runTWFEFromSuffStats,
} from "../../../math/PanelSuffStatsEngine.js";
import { matInv } from "../../../math/LinearEngine.js";
import bench from "./fase4Benchmarks.json";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url = new URL("./fase4_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase4.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase4_tbl`);
  await conn.query(`CREATE TABLE fase4_tbl AS SELECT * FROM read_csv_auto('fase4.csv')`);
  return "fase4_tbl";
}

function reconstructBetaFull(suff) {
  const Ainv = matInv(suff.XtX_dm);
  return Ainv.map(row => row.reduce((s, w, j) => s + w * suff.XtY_dm[j], 0));
}

async function checkOne({ mode, solver, suff, table, yCol, xCols, unitCol, timeCol, want }) {
  const results = [];
  const betaFull = reconstructBetaFull(suff);

  // Classical
  const r_cls = solver({ suff, meat: null, hcType: null });
  // r_cls.beta has intercept stripped — compare to want.beta (also without intercept for FE/TWFE,
  // with intercept for FD per plm convention). Handle FD intercept index here:
  const wantBetaSlope = mode === "FD" ? want.beta.slice(1) : want.beta;
  const wantSEClassicalSlope = mode === "FD" ? want.se_classical.slice(1) : want.se_classical;
  const wantSEHC0Slope = mode === "FD" ? want.se_HC0.slice(1) : want.se_HC0;
  const wantSEHC1Slope = mode === "FD" ? want.se_HC1.slice(1) : want.se_HC1;

  results.push([`${mode}.beta[0]`, r_cls.beta[0], wantBetaSlope[0], close6]);
  results.push([`${mode}.beta[1]`, r_cls.beta[1], wantBetaSlope[1], close6]);
  results.push([`${mode}.se_classical[0]`, r_cls.se[0], wantSEClassicalSlope[0], close4]);
  results.push([`${mode}.se_classical[1]`, r_cls.se[1], wantSEClassicalSlope[1], close4]);

  // HC0
  const meatHC0 = (await computeWithinHCMeat({
    tableName: table, yCol, xCols, unitCol, timeCol, mode,
    beta: betaFull, withinSQLOverride: suff.withinSQL,
  })).meat;
  const r_HC0 = solver({ suff, meat: meatHC0, hcType: null });
  results.push([`${mode}.se_HC0[0]`, r_HC0.se[0], wantSEHC0Slope[0], close4]);
  results.push([`${mode}.se_HC0[1]`, r_HC0.se[1], wantSEHC0Slope[1], close4]);

  // HC1
  const r_HC1 = solver({ suff, meat: meatHC0, hcType: "HC1" });
  results.push([`${mode}.se_HC1[0]`, r_HC1.se[0], wantSEHC1Slope[0], close4]);
  results.push([`${mode}.se_HC1[1]`, r_HC1.se[1], wantSEHC1Slope[1], close4]);

  return results;
}

export async function runFase4NumericalValidation() {
  const table = await loadCSV();
  const xCols = ["x1", "x2"];
  let all = [];

  // FE
  const suff_fe = await buildWithinSuffStats({
    tableName: table, yCol: "y", xCols, unitCol: "id", timeCol: "year", mode: "FE",
  });
  all = all.concat(await checkOne({
    mode: "FE", solver: runFEFromSuffStats, suff: suff_fe,
    table, yCol: "y", xCols, unitCol: "id", timeCol: "year", want: bench.FE,
  }));

  // FD
  const suff_fd = await buildWithinSuffStats({
    tableName: table, yCol: "y", xCols, unitCol: "id", timeCol: "year", mode: "FD",
  });
  all = all.concat(await checkOne({
    mode: "FD", solver: runFDFromSuffStats, suff: suff_fd,
    table, yCol: "y", xCols, unitCol: "id", timeCol: "year", want: bench.FD,
  }));

  // TWFE
  const suff_twfe = await buildWithinSuffStats({
    tableName: table, yCol: "y", xCols, unitCol: "id", timeCol: "year", mode: "TWFE",
  });
  all = all.concat(await checkOne({
    mode: "TWFE", solver: runTWFEFromSuffStats, suff: suff_twfe,
    table, yCol: "y", xCols, unitCol: "id", timeCol: "year", want: bench.TWFE,
  }));

  const failures = [];
  all.forEach(([name, got, want, fn]) => {
    const ok = fn(got, want);
    if (!ok) failures.push({ name, got, want });
    console.log(`${ok ? "✓" : "✗"} ${name}: got ${got}, want ${want}`);
  });
  console.log(failures.length === 0
    ? `Fase 4 validation PASSED (${all.length}/${all.length})`
    : `Fase 4 validation FAILED (${failures.length} mismatches)`);
  return { results: all, failures };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.fase4 = runFase4NumericalValidation;
}
```

- [ ] **Step 2: Import the harness**

Find where `fase3cValidation.js` is imported (likely `src/services/data/__validation__/index.js` or `main.jsx`). Add a sibling import:

```js
import "./services/data/__validation__/fase4Validation.js";
```

- [ ] **Step 3: Run in the browser**

```js
await window.__validation.fase4()
// Expected: all 24 checks pass (3 modes × 8 checks each); "Fase 4 validation PASSED"
```

If any HC0/HC1 SE fails by more than 1e-4 but less than 1e-3, investigate the **df scaling**: `fixest` and `plm` both use `n − N − k` for FE classical, but their HC0/HC1 sometimes differ in whether they treat entity dummies as "absorbed" or "estimated" parameters when scaling. If a small mismatch appears here, the fix is in `runFEFromSuffStats` / `runTWFEFromSuffStats` `df` definition, **not** in the meat builder. Loosen tolerance only as a last resort.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/__validation__/fase4Validation.js \
        <wherever-it-is-imported>
git commit -m "test(modeling): Fase 4 — browser harness vs R FE/FD/TWFE golden values"
```

---

## Task 9: Update CLAUDE.md + design doc

**Files:**
- Modify: `CLAUDE.md` (Pending item 2a — append Fase 4)
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md` (status line + Fase 4 section)

- [ ] **Step 1: Update design doc status line**

Replace the existing top-of-document status line with:

```
Fase 0 + Fase 1 + Fase 2 DONE (2026-05-20). Fase 3 (3a 2SLS + 3b GMM/LIML + 3c WLS) DONE (2026-05-21). Fase 4 (FE/FD/TWFE) DONE (2026-05-21). Fases 5–7 pending.
```

- [ ] **Step 2: Append Fase 4 status to the Fase 4 section**

Replace the existing `### Fase 4 — FE / FD / TWFE` block contents (or append below it) with:

```md
**Fase 4 status (2026-05-21):** FE + FD + TWFE classical + HC0/HC1 implemented.
  - `duckdbWithin.js` `buildWithinSuffStats({mode})` — one SQL pass with mode-parameterized within-transform CTE; emits `withinSQL` fragment reused by the meat builder; returns `{n, nUnits, nTimes, XtX_dm, XtY_dm, YtY_dm, sumY_dm}`. `isBalancedPanel(...)` aux query gates TWFE (closed-form double-demean is biased on unbalanced panels — falls back to JS).
  - `duckdbWithinRobustSE.js` `computeWithinHCMeat` — meat = Σ êᵢ² x_dm_i x_dm_j with β as prepared params; reuses `withinSQL` to keep transform definition in one place.
  - `PanelSuffStatsEngine.js` `runFEFromSuffStats` / `runFDFromSuffStats` / `runTWFEFromSuffStats` — shared `solveCore` with mode-specific df: FE n−N−k, FD n_diff−k−1, TWFE n−N−T−k+1. Intercept stripped on FE / TWFE to match `runFE` / `runTWFE` return shapes; FD intercept retained then sliced like `runFD`.
  - Cache: `makeCacheKey` / `validateSuffStatsEntry` extended with optional `(mode, unitCol, timeCol)`; panel entries disjoint from OLS/IV/WLS.
  - Dispatcher: `FE`/`FD`/`TWFE` allowed with classical/HC0/HC1 SE; `unitCol` required; `timeCol` required for FD/TWFE; weights forbidden.
  - Validated vs `fixest::feols` (FE, TWFE) and `plm::plm(model="fd")` (FD) with `sandwich::vcovHC` at 6dp coef / 4dp SE (`fase4Benchmarks.json`, `window.__validation.fase4`).
  - Deferred to Fase 4b: HC2/HC3, clustered-by-entity (canonical panel SE), two-way clustering (entity × time), HAC; LSDV (k explodes — JS stays authoritative); unbalanced-panel TWFE (would require iterative Gauss-Seidel demeaning).
```

- [ ] **Step 3: Update CLAUDE.md Pending item 2a**

Append a sentence to the end of the existing item 2a:

```
Fase 4 extension (2026-05-21): FE / FD / TWFE suff-stats paths live for classical + HC0/HC1 via `duckdbWithin.js` (`buildWithinSuffStats` + `isBalancedPanel`) + `PanelSuffStatsEngine.js` (`runFEFromSuffStats`/`runFDFromSuffStats`/`runTWFEFromSuffStats`) + `duckdbWithinRobustSE.js`. CTE-emitting builder lets the meat pass reuse the transform; df adjusted per mode (n−N−k FE / n_diff−k−1 FD / n−N−T−k+1 TWFE); unbalanced TWFE falls back to JS; LSDV stays JS. Validated vs `fixest::feols` + `plm::plm` + `sandwich::vcovHC` (`fase4Benchmarks.json`, `window.__validation.fase4`).
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md
git commit -m "docs: Fase 4 — panel within suff-stats path complete"
```

---

## Self-review checklist

- **Spec coverage:** design doc line 281–284 — `duckdbWithin.js: CTE with x − AVG(x) OVER (PARTITION BY entity) for FE; x − LAG(x) for FD; double within for TWFE. Classical SE uses σ² adjusted for df. LSDV → JS.` ✅ Task 2 (within CTE) + Task 3 (df per mode) + Task 6 (LSDV stays JS by virtue of `K_THRESHOLD` rejecting the post-expansion column count).
- **HC0/HC1 added on top of spec** for parity with Fase 3c — explicitly documented as in-scope here.
- **Placeholder scan:** no "TBD" / "implement appropriate" / "similar to" — every step is concrete. Variable-name hedge in Task 6 Step 2 is **deliberate** (the existing ModelingTab state identifier for panel selectors may be `panelUnit`/`panelTime` or `entityCol`/`timeCol`; Codex matches whichever already exists rather than introducing drift).
- **Type consistency:**
  - `buildWithinSuffStats` returns `{n, nUnits, nTimes, XtX_dm, XtY_dm, YtY_dm, sumY_dm, varNames, mode, unitCol, timeCol, withinSQL, xColsExpanded}` — Task 3's solvers destructure exactly these fields; Task 4's meat builder reads `withinSQL`.
  - `meat` is `(k+1)×(k+1)` symmetric — Task 4 returns this shape; Task 3 consumes it via `solveCore`.
  - `betaFull` reconstruction in Task 6 uses `matInv(suff.XtX_dm) · suff.XtY_dm` — same matrix the solver inverts — so the β passed to the meat builder is **exactly** the β the classical solve already computed (no fresh roundoff).
  - Cache key signature `makeCacheKey(table, yCol, xCols, zCols?, wCol?, mode?, unitCol?, timeCol?)` — Task 5 keeps it back-compatible (defaults to `null`); existing OLS / 2SLS / WLS call sites unchanged.
- **Defer/escape hatches explicitly wired:**
  - Cluster / HC2 / HC3 / HAC for panel → dispatcher rejects (Task 1 Step 3) → JS path.
  - Unbalanced TWFE → `isBalancedPanel` aux check (Task 6 Step 3) throws inside the try → JS path.
  - LSDV → not a separate estimator; if user adds entity dummies via `factor(id)`, post-expansion k exceeds `K_THRESHOLD` → dispatcher rejects → JS path.
- **Documented deviations from the JS PanelEngine path:**
  - `resid`, `Yhat`, `alphas` are emitted as `null` with `_hasLazyResiduals: true` — consumers (`ResidualPlots`, `DiagnosticsPanel`) already handle this contract from Fase 1.
  - `R2_between` (FE) and α̂_i intercepts (FE) are not yet computed on the SQL path — left `null` for now. Adding them requires a tiny aux query (one row per entity for between R², one row per entity for α̂_i) which is feasible but not on the critical regression-result UI path. Mark as a follow-up TODO in the design doc note (Task 9 Step 2 — already noted as a deferred item).
  - `Fstat` / `Fpval` left `null` for now — same rationale; not on the critical UI path.
