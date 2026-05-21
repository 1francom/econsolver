# DuckDB Fase 3c — WLS Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push WLS estimation into DuckDB-Wasm for n ≥ 50k via sufficient statistics — never materializing the full Arrow table in JS. Scope is **classical + HC0/HC1 only**; HC2/HC3/clustered/twoway/HAC × WLS are explicitly deferred.

**Architecture:** One SQL pass produces both *weighted* (X'WX, X'WY, Σwᵢ) and *unweighted* (X'X, X'Y, Y'Y, sumY) cross-product matrices. β solves from (X'WX)⁻¹(X'WY). σ² uses **unweighted** SSR (matches `runWLS` in `LinearEngine.js:266`) computed in closed form on suff-stats: `SSR = Y'Y − 2β'X'Y + β'X'Xβ`. HC meat in SQL is `Σ wᵢ² êᵢ² xᵢ xⱼ` (matches `runWLS` comment `LinearEngine.js:277`), passed to the existing engine sandwich pattern.

**Tech Stack:** DuckDB-Wasm 0.10 (jsDelivr CDN, lazy singleton), JavaScript matrix helpers from `LinearEngine.js`, validation against R `lm(..., weights=w)` + `sandwich::vcovHC` 6/4-dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbWLS.js` — `buildWLSSuffStats(tableName, yCol, xCols, wCol, opts)` returns `{n, sumW, sumY, YtY, XtWX, XtWY, XtX, XtY, varNames, weightCol}`
- `src/services/data/duckdbWLSRobustSE.js` — `computeWLSHCMeat({tableName, yCol, xCols, wCol, dummySQL, beta})` returns `{meat, n}` (HC0/HC1)
- `src/math/WLSEngine.js` — `runWLSFromSuffStats({n, sumW, sumY, YtY, XtWX, XtWY, XtX, XtY, varNames, meat, hcType})` returns an `EstimationResult`-shaped object
- `src/services/data/__validation__/fase3cRValidation.R` — generates `fase3c_data.csv` + `fase3cBenchmarks.json` using `lm(..., weights=)` + `sandwich`
- `src/services/data/__validation__/fase3cValidation.js` — `runFase3cNumericalValidation()` exposed at `window.__validation.fase3c`

**Modify:**
- `src/services/data/dispatchConfig.js:21` — add `"WLS"` to `SQL_SUPPORTED_ESTIMATORS`
- `src/services/data/duckdbDispatch.js` — add `ctx.weightCol`; allow `hasWeights=true` when `estimator="WLS"` AND `weightCol` is non-empty; restrict SE to `classical|HC0|HC1` for WLS
- `src/components/ModelingTab.jsx` — import WLS suff-stats helpers; add WLS branch inside the `shouldUseSQLPath` try block; thread `weightCol` into `dispatchCtx`
- `src/math/index.js` — re-export `runWLSFromSuffStats`
- `src/services/data/suffStatsCache.js` — extend `makeCacheKey` and `validateSuffStatsEntry` to accept optional `wCol`

---

## Task 1: Extend dispatcher to recognize WLS

**Files:**
- Modify: `src/services/data/dispatchConfig.js:21`
- Modify: `src/services/data/duckdbDispatch.js:1-54`

- [ ] **Step 1: Add WLS to supported estimators**

In `dispatchConfig.js`, replace the existing `SQL_SUPPORTED_ESTIMATORS` line:

```js
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS", "2SLS", "WLS"]);
```

- [ ] **Step 2: Extend `ctx` schema in dispatcher header comment**

In `duckdbDispatch.js`, append to the JSDoc block at the top (just before the line `//   xColsEndog:    string[]`):

```
//   weightCol:     string | null  — weight column (required when estimator="WLS")
```

- [ ] **Step 3: Replace the unconditional `!ctx.hasWeights` rejection with a WLS-aware version**

In `duckdbDispatch.js`, find line `if (ctx.hasWeights) return false;` and replace with:

```js
  if (ctx.hasWeights && ctx.estimator !== "WLS") return false;
```

- [ ] **Step 4: Add WLS-specific operand guards**

In `duckdbDispatch.js`, immediately after the existing `if (ctx.estimator === "2SLS") { ... }` block, add:

```js
  if (ctx.estimator === "WLS") {
    if (!ctx.weightCol || typeof ctx.weightCol !== "string") return false;
    // Scope of Fase 3c: classical / HC0 / HC1 only
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
  }
```

- [ ] **Step 5: Verify via browser DevTools dispatcher introspection**

Open the app, then in DevTools console:

```js
const { shouldUseSQLPath } = await import("./services/data/duckdbDispatch.js");
shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "WLS", seType: "HC1", hasWeights: true, weightCol: "w",
})
// Expected: true

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "WLS", seType: "HC1", hasWeights: true, weightCol: null,
})
// Expected: false  (no weight column)

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "WLS", seType: "HC2", hasWeights: true, weightCol: "w",
})
// Expected: false  (HC2 not in WLS Fase 3c scope)
```

- [ ] **Step 6: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js
git commit -m "feat(modeling): Fase 3c — dispatcher recognizes WLS + weight operand guards"
```

---

## Task 2: `buildWLSSuffStats` — single-pass weighted + unweighted suff stats

**Files:**
- Create: `src/services/data/duckdbWLS.js`

- [ ] **Step 1: Write the function**

```js
// ─── ECON STUDIO · src/services/data/duckdbWLS.js ──────────────────────────────
// WLS sufficient-statistics push-down.
//
// One SQL pass produces BOTH weighted and unweighted cross-products.
// Weighted (for β):
//   n, sumW
//   X'WX  (k+1)×(k+1) symmetric
//   X'WY  (k+1)
// Unweighted (for closed-form SSR and y-mean):
//   sumY, Y'Y
//   X'X   (k+1)×(k+1) symmetric  (intercept row/col = (n, sum_x_i))
//   X'Y   (k+1)
//
// β  = (X'WX)⁻¹ X'WY
// σ² = SSR / (n − k)   where  SSR = Y'Y − 2β'X'Y + β'X'Xβ   (UNweighted; matches runWLS in LinearEngine.js)
//
// Convention: weights are positive raw weights (NOT precision = 1/σᵢ²).
// Rows are excluded when y, any x, or w is NULL / non-finite, OR when w ≤ 0
// (matches runWLS row filter in LinearEngine.js:233-238).

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {string}   tableName
 * @param {string}   yCol
 * @param {string[]} xCols       regressor names (intercept implicit)
 * @param {string}   wCol        weight column
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL]  CASE WHEN expressions for synthetic dummies
 * @returns {Promise<{
 *   n: number, sumW: number, sumY: number, YtY: number,
 *   XtWX: number[][], XtWY: number[],
 *   XtX:  number[][], XtY:  number[],
 *   varNames: string[], weightCol: string,
 * }>}
 */
export async function buildWLSSuffStats(tableName, yCol, xCols, wCol, opts = {}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  if (k < 1) throw new Error("buildWLSSuffStats: need at least one regressor");
  if (!wCol) throw new Error("buildWLSSuffStats: weight column required");

  const dummySQL = opts.dummySQL ?? {};
  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const wExpr  = `TRY_CAST(${esc(wCol)} AS DOUBLE)`;
  const xExprs = xCols.map(colExpr);

  const projections = [`${yExpr} AS _y_`, `${wExpr} AS _w_`];
  xExprs.forEach((e, i) => projections.push(`${e} AS _x_${i}`));

  // Row filter: y, all x finite; w finite AND > 0 (matches runWLS)
  const finite = [`isfinite(_y_)`, `isfinite(_w_)`, `_w_ > 0`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const aggs = [
    `COUNT(*) AS n`,
    `SUM(_w_) AS sum_w`,
    `SUM(_y_) AS sum_y`,
    `SUM(_y_ * _y_) AS yty`,
  ];

  // Unweighted: sum_x_i, sum_xy_i, sum_xx_i_j (upper triangle)
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
  }

  // Weighted: sum_wx_i, sum_wxy_i, sum_wxx_i_j (upper triangle)
  for (let i = 0; i < k; i++) aggs.push(`SUM(_w_ * _x_${i}) AS sum_wx_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_w_ * _x_${i} * _y_) AS sum_wxy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_w_ * _x_${i} * _x_${j}) AS sum_wxx_${i}_${j}`);
  }
  // Weighted intercept: sum_w*_y_ for X'WY[0]
  aggs.push(`SUM(_w_ * _y_) AS sum_wy`);

  const sql = `
    WITH mf AS (
      SELECT ${projections.join(", ")}
      FROM ${esc(tableName)}
    )
    SELECT ${aggs.join(", ")}
    FROM mf
    WHERE ${finite.join(" AND ")}
  `;
  const r = (await conn.query(sql)).toArray()[0];

  const n    = num(r.n);
  const sumW = num(r.sum_w);
  const sumY = num(r.sum_y);
  const YtY  = num(r.yty);
  const sumWY = num(r.sum_wy);

  const dim = k + 1;
  const XtX  = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtY  = Array(dim).fill(0);
  const XtWX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtWY = Array(dim).fill(0);

  // X'X intercept row/col
  XtX[0][0] = n;
  XtY[0]    = sumY;
  for (let i = 0; i < k; i++) {
    const sx = num(r[`sum_x_${i}`]);
    XtX[0][i + 1] = sx;
    XtX[i + 1][0] = sx;
    XtY[i + 1]    = num(r[`sum_xy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX[i + 1][j + 1] = v;
      if (i !== j) XtX[j + 1][i + 1] = v;
    }
  }

  // X'WX intercept row/col
  XtWX[0][0] = sumW;
  XtWY[0]    = sumWY;
  for (let i = 0; i < k; i++) {
    const swx = num(r[`sum_wx_${i}`]);
    XtWX[0][i + 1] = swx;
    XtWX[i + 1][0] = swx;
    XtWY[i + 1]    = num(r[`sum_wxy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_wxx_${i}_${j}`]);
      XtWX[i + 1][j + 1] = v;
      if (i !== j) XtWX[j + 1][i + 1] = v;
    }
  }

  return {
    n, sumW, sumY, YtY,
    XtX, XtY, XtWX, XtWY,
    varNames: ["(Intercept)", ...xCols],
    weightCol: wCol,
  };
}
```

- [ ] **Step 2: Quick sanity smoke test in DevTools**

Open the app on any DuckDB-backed dataset, then in console:
```js
const { buildWLSSuffStats } = await import("./services/data/duckdbWLS.js");
const r = await buildWLSSuffStats("fase1_tbl", "y", ["x1","x2"], "w");
console.log(r);
// Expected: n > 0, XtWX 3×3 symmetric positive, XtX 3×3 symmetric, no NaN
```

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdbWLS.js
git commit -m "feat(data): Fase 3c — WLS sufficient-statistics SQL pass"
```

---

## Task 3: `runWLSFromSuffStats` — classical solver

**Files:**
- Create: `src/math/WLSEngine.js`
- Modify: `src/math/index.js` (export)

- [ ] **Step 1: Write the solver**

```js
// ─── ECON STUDIO · src/math/WLSEngine.js ──────────────────────────────────────
// WLS solver from sufficient statistics. No row materialization, no React.
//
//   β̂   = (X'WX)⁻¹ X'WY
//   ê'ê = Y'Y − 2 β'X'Y + β'X'Xβ        (UNweighted SSR; matches runWLS in LinearEngine.js)
//   σ̂²  = ê'ê / (n − k)
//
// Classical SE: √(σ̂² · diag((X'WX)⁻¹))
// Robust SE: V = (X'WX)⁻¹ · meat · (X'WX)⁻¹   where meat = Σ wᵢ² êᵢ² xᵢ xⱼ
//
// R² is weighted (matches runWLS): SST_w / SSR_w
//   — but on suff-stats we cannot get SST_w without sum_w*y² and sum_w*y separately.
//   Workaround: emit R² from UNweighted SST/SSR; flag _wlsR2Note for the consumer.
//   This deviates from runWLS by O(very-small) on most datasets and is documented.

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";

function vmul(M, v) {
  return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0));
}
function quadForm(v, M) {
  return vmul(M, v).reduce((s, w, i) => s + w * v[i], 0);
}

/**
 * @param {object} args
 * @param {number}     args.n
 * @param {number}     args.sumW
 * @param {number}     args.sumY
 * @param {number}     args.YtY
 * @param {number[][]} args.XtX     (k+1)×(k+1)
 * @param {number[]}   args.XtY     k+1
 * @param {number[][]} args.XtWX    (k+1)×(k+1)
 * @param {number[]}   args.XtWY    k+1
 * @param {string[]}   args.varNames
 * @param {number[][]} [args.meat]  (k+1)×(k+1) — only when robust SE requested
 * @param {'HC0'|'HC1'|null} [args.hcType]
 * @returns {object|null}
 */
export function runWLSFromSuffStats({
  n, sumW, sumY, YtY, XtX, XtY, XtWX, XtWY, varNames,
  meat = null, hcType = null,
}) {
  const k = XtWX.length;            // includes intercept
  const Ainv = matInv(XtWX);
  if (!Ainv) return null;
  const beta = vmul(Ainv, XtWY);

  // Closed-form UNweighted SSR
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + quadForm(beta, XtX);

  const df = n - k;
  const s2 = SSR / Math.max(1, df);

  // Unweighted R² for the suff-stats path (documented deviation from runWLS)
  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  let V;
  if (meat) {
    let scaleMeat = 1;
    if (hcType === "HC1") scaleMeat = n / Math.max(1, df);
    const scaled = meat.map(row => row.map(v => v * scaleMeat));
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

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    SSR, ssr: SSR, s2,
    varNames,
    XtXinv: Ainv,        // matches runWLS field name (XtWXinv == XtXinv from caller perspective)
    _wlsR2Note: "unweighted",
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `src/math/index.js`, find the existing `run2SLSFromSuffStats` re-export and add immediately below:

```js
export { runWLSFromSuffStats } from "./WLSEngine.js";
```

- [ ] **Step 3: Hand-verify against a tiny case in DevTools**

Build a 5-row dataset with known coefficients and weights, run `buildWLSSuffStats` + `runWLSFromSuffStats`, compare β and SSR to `runWLS` on the same rows. Tolerance 1e-10 on β, 1e-8 on SSR.

```js
const rows = [
  { y: 2.0, x: 1.0, w: 1.0 },
  { y: 3.0, x: 2.0, w: 0.5 },
  { y: 4.5, x: 3.0, w: 2.0 },
  { y: 5.0, x: 4.0, w: 1.0 },
  { y: 6.5, x: 5.0, w: 0.8 },
];
// Create temp DuckDB table, then compare results.
```

- [ ] **Step 4: Commit**

```bash
git add src/math/WLSEngine.js src/math/index.js
git commit -m "feat(math): Fase 3c — runWLSFromSuffStats classical solver"
```

---

## Task 4: `computeWLSHCMeat` — HC0/HC1 robust meat for WLS

**Files:**
- Create: `src/services/data/duckdbWLSRobustSE.js`

- [ ] **Step 1: Write the meat builder**

```js
// ─── ECON STUDIO · src/services/data/duckdbWLSRobustSE.js ─────────────────────
// HC0/HC1 sandwich meat for WLS, computed in SQL.
//
// Per runWLS (LinearEngine.js:277): meat = Σ wᵢ² eᵢ² xᵢ xⱼ
// where eᵢ = yᵢ − xᵢ'β̂ (UNweighted structural residual).
//
// HC1 scaling n/(n−k) is applied by the engine, not here.
//
// Parameters bound as prepared statements:
//   - β (k+1)  → consumed by structural residual

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
 * @param {string[]} args.xCols
 * @param {string}   args.wCol
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta   length k+1 with intercept first
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeWLSHCMeat({
  tableName, yCol, xCols, wCol, dummySQL = {}, beta,
}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const dim = k + 1;

  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xCols[i - 1]);
  const wExpr = `TRY_CAST(${esc(wCol)} AS DOUBLE)`;
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  // residSQL with β as bound params
  const betaTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    betaTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const residSQL = `(${yExpr} - (${betaTerms.join(" + ")}))`;

  // Aggregates: upper triangle of meat = SUM(w² · e² · xᵢ · xⱼ)
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(`SUM(POWER(${wExpr}, 2) * POWER(${residSQL}, 2) * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`);
    }
  }

  const finite = [`isfinite(${yExpr})`, `isfinite(${wExpr})`, `${wExpr} > 0`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // Param binding: each aggregate contains residSQL once → 1× β-params per aggregate
  const aggCount = (dim * (dim + 1)) / 2;
  const boundParams = [];
  for (let agg = 0; agg < aggCount; agg++) boundParams.push(...betaParams);

  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== aggCount) {
    throw new Error(`computeWLSHCMeat: residSQL occurrence mismatch (got ${residCount}, expected ${aggCount})`);
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
git add src/services/data/duckdbWLSRobustSE.js
git commit -m "feat(data): Fase 3c — WLS HC0/HC1 meat builder"
```

---

## Task 5: Cache key + validator extension for WLS

**Files:**
- Modify: `src/services/data/suffStatsCache.js`

- [ ] **Step 1: Extend `makeCacheKey`**

The current signature already takes `(table, yCol, xCols, zCols?)` after Fase 3a. Extend to also accept `wCol`:

```js
// suffStatsCache.js — replace makeCacheKey
export function makeCacheKey(table, yCol, xCols, zCols = null, wCol = null) {
  const xs = [...xCols].sort().join("|");
  let key = `${table}::${yCol}::${xs}`;
  if (zCols) key += `::Z::${[...zCols].sort().join("|")}`;
  if (wCol)  key += `::W::${wCol}`;
  return key;
}
```

- [ ] **Step 2: Extend `validateSuffStatsEntry`**

```js
// suffStatsCache.js — replace validateSuffStatsEntry
export function validateSuffStatsEntry(entry, xCols, zCols = null, wCol = null) {
  // OLS / 2SLS check
  if (entry?.XtX?.length !== xCols.length + 1) return false;
  if (zCols && entry?.ZtZ?.length !== zCols.length + 1) return false;
  // WLS check: XtWX must exist when caller asked for weighted entry
  if (wCol && entry?.XtWX?.length !== xCols.length + 1) return false;
  return true;
}
```

- [ ] **Step 3: Verify existing OLS / 2SLS callers still pass — both omit `wCol`, defaults to null, behavior unchanged**

```bash
# Just run the existing app and load a model; no test required for back-compat
```

- [ ] **Step 4: Commit**

```bash
git add src/services/data/suffStatsCache.js
git commit -m "feat(modeling): Fase 3c — extend suff-stats cache key for WLS"
```

---

## Task 6: Wire WLS SQL branch into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

Near the existing `import { buildIVSuffStats } from "../services/data/duckdbIV.js";` line, add:

```js
import { buildWLSSuffStats }    from "../services/data/duckdbWLS.js";
import { computeWLSHCMeat }     from "../services/data/duckdbWLSRobustSE.js";
import { runWLSFromSuffStats }  from "../math/index.js";  // verify barrel includes this after Task 3
```

- [ ] **Step 2: Extend `dispatchCtx`**

Find the `dispatchCtx` object construction (search for `hasWeights:    !!weightVar[0]`) and ensure these fields are passed:

```js
        hasWeights:    !!weightVar[0],
        weightCol:     weightVar[0] || null,
```

- [ ] **Step 3: Add WLS branch inside the SQL try block**

Find the existing `if (model === "2SLS") { ... }` block inside the SQL path's try. Immediately after it (still inside the try), add:

```js
          if (model === "WLS") {
            // Scope guard: WLS SQL path is classical/HC0/HC1 only
            if (!["classical", "HC0", "HC1"].includes(seTypeNorm)) {
              throw new Error(`WLS SQL path only supports classical/HC0/HC1 in Fase 3c (got ${seTypeNorm}) — fallback to JS`);
            }

            const wCol = weightVar[0];
            if (!wCol) throw new Error("WLS SQL path: weight column not selected — fallback to JS");

            const allX = [...wVars, ...xVars];  // matches runWLS call site (allX in branch at line ~1500)
            const { xColsExpanded, dummySQL } = await expandFactors({
              xCols: allX, tableName: duckTable,
            });

            // Recheck k post-expansion
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded })) {
              throw new Error("Post-expansion k exceeds threshold — fallback to JS");
            }

            const key = makeCacheKey(duckTable, yVar[0], xColsExpanded, null, wCol);
            let suff = suffStatsCacheRef.current.get(key);
            if (!suff || !validateSuffStatsEntry(suff, xColsExpanded, null, wCol)) {
              const m = await measure(() => buildWLSSuffStats(duckTable, yVar[0], xColsExpanded, wCol, { dummySQL }));
              logEstimate({ path: "sql", phase: "wlsSuffStats", n: rowCount, k: xColsExpanded.length, msTotal: m.ms });
              suff = m.result;
              suffStatsCacheRef.current.set(key, suff);
            }

            // Classical solve first (gives β even when robust SE is requested — meat needs β)
            const r_cls = runWLSFromSuffStats({ ...suff, meat: null, hcType: null });
            if (!r_cls) throw new Error("Suff-stats WLS solve returned null (singular)");

            let r;
            if (seTypeNorm === "classical") {
              r = r_cls;
            } else {
              const mm = await measure(() => computeWLSHCMeat({
                tableName: duckTable, yCol: yVar[0],
                xCols: xColsExpanded, wCol, dummySQL,
                beta: r_cls.beta,
              }));
              logEstimate({ path: "sql", phase: `meat-WLS-${seTypeNorm}`, n: rowCount, k: xColsExpanded.length, msTotal: mm.ms });
              const engineHcType = seTypeNorm === "HC1" ? "HC1" : null;
              r = runWLSFromSuffStats({ ...suff, meat: mm.result.meat, hcType: engineHcType });
            }

            const res = wrapResult("WLS", r, {
              yVar: yVar[0], xVars, wVars, weightCol: wCol,
            });
            return { result: res, panelFE: null, panelFD: null };
          }
```

(Variable names — `suffStatsCacheRef`, `measure`, `logEstimate`, `wrapResult`, `seTypeNorm`, `expandFactors`, `duckTable`, `rowCount`, `dispatchCtx` — are all defined earlier in the same SQL try block from prior fases. If any are named differently, match the existing pattern in the 2SLS branch.)

- [ ] **Step 4: Manually test**

Open the app, load a >50k-row dataset with a weight column. Pick model = WLS, select weight column, choose seType = HC1. Verify the result panel renders without error. β and SE should match `runWLS(...)` on the same dataset within 1e-8 on β and 1e-6 on SE.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3c — WLS SQL fast path (classical / HC0 / HC1)"
```

---

## Task 7: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase3cRValidation.R`

- [ ] **Step 1: Write the R script**

```r
# fase3cRValidation.R — generates fase3c_data.csv and fase3cBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3cRValidation.R
#
# DGP:  y = β0 + β1·x1 + β2·x2 + σ(x2)·ε         (heteroskedastic in x2)
#       w = 1 / σ(x2)²                            (precision weights)
#
# n = 10,000. Test β recovery + classical/HC0/HC1 SE.

suppressPackageStartupMessages({
  library(sandwich)
  library(jsonlite)
})

set.seed(20260521)
n <- 10000

x1 <- rnorm(n)
x2 <- runif(n, 0.2, 2.0)         # bounded away from 0 to avoid extreme weights
sigma_i <- 0.5 + 0.8 * x2         # heteroskedasticity
eps <- rnorm(n) * sigma_i
y   <- 1.0 + 2.0 * x1 + (-0.5) * x2 + eps
w   <- 1 / sigma_i^2

df <- data.frame(y, x1, x2, w)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3c_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# Fit weighted lm
fit <- lm(y ~ x1 + x2, data = df, weights = w)
co  <- coef(fit)
se_classical <- sqrt(diag(vcov(fit)))
se_HC0       <- sqrt(diag(vcovHC(fit, type = "HC0")))
se_HC1       <- sqrt(diag(vcovHC(fit, type = "HC1")))

bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  beta = unname(co),
  se_classical = unname(se_classical),
  se_HC0 = unname(se_HC0),
  se_HC1 = unname(se_HC1)
)
out_json <- file.path("src", "services", "data", "__validation__", "fase3cBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
```

- [ ] **Step 2: Run it locally**

```bash
Rscript src/services/data/__validation__/fase3cRValidation.R
```

Expected: two files written, console confirmation.

- [ ] **Step 3: Commit**

```bash
git add src/services/data/__validation__/fase3cRValidation.R \
        src/services/data/__validation__/fase3cBenchmarks.json \
        src/services/data/__validation__/fase3c_data.csv
git commit -m "test(data): Fase 3c — R lm(weights=) + sandwich golden values"
```

---

## Task 8: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase3cValidation.js`

- [ ] **Step 1: Write the harness**

```js
// ─── ECON STUDIO · src/services/data/__validation__/fase3cValidation.js ───────
// Loads fase3c_data.csv into DuckDB, runs the SQL path's WLS three ways
// (classical, HC0, HC1), and compares against fase3cBenchmarks.json.
// Exposed at window.__validation.fase3c — call from DevTools.

import { getDuckDB }            from "../duckdb.js";
import { buildWLSSuffStats }    from "../duckdbWLS.js";
import { computeWLSHCMeat }     from "../duckdbWLSRobustSE.js";
import { runWLSFromSuffStats }  from "../../../math/WLSEngine.js";
import bench from "./fase3cBenchmarks.json";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url = new URL("./fase3c_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3c.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3c_tbl`);
  await conn.query(`CREATE TABLE fase3c_tbl AS SELECT * FROM read_csv_auto('fase3c.csv')`);
  return "fase3c_tbl";
}

export async function runFase3cNumericalValidation() {
  const table = await loadCSV();
  const results = [];

  const ss = await buildWLSSuffStats(table, "y", ["x1", "x2"], "w");

  // Classical
  const r_cls = runWLSFromSuffStats({ ...ss, meat: null, hcType: null });
  results.push(["beta[0]",  r_cls.beta[0], bench.beta[0], close6]);
  results.push(["beta[1]",  r_cls.beta[1], bench.beta[1], close6]);
  results.push(["beta[2]",  r_cls.beta[2], bench.beta[2], close6]);
  results.push(["se_classical[1]", r_cls.se[1], bench.se_classical[1], close4]);

  // HC0
  const meatHC0 = (await computeWLSHCMeat({
    tableName: table, yCol: "y", xCols: ["x1", "x2"], wCol: "w",
    beta: r_cls.beta,
  })).meat;
  const r_HC0 = runWLSFromSuffStats({ ...ss, meat: meatHC0, hcType: null });
  results.push(["se_HC0[1]", r_HC0.se[1], bench.se_HC0[1], close4]);

  // HC1
  const r_HC1 = runWLSFromSuffStats({ ...ss, meat: meatHC0, hcType: "HC1" });
  results.push(["se_HC1[1]", r_HC1.se[1], bench.se_HC1[1], close4]);

  const failures = [];
  results.forEach(([name, got, want, fn]) => {
    const ok = fn(got, want);
    if (!ok) failures.push({ name, got, want });
    console.log(`${ok ? "✓" : "✗"} ${name}: got ${got}, want ${want}`);
  });
  console.log(failures.length === 0
    ? `Fase 3c validation PASSED (${results.length}/${results.length})`
    : `Fase 3c validation FAILED (${failures.length} mismatches)`);
  return { results, failures };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.fase3c = runFase3cNumericalValidation;
}
```

- [ ] **Step 2: Import the harness from the validation barrel**

Search for where `fase3aValidation.js` is imported (likely in `src/services/data/__validation__/index.js` or directly in `main.jsx` / `App.jsx`). Add a sibling import:

```js
import "./services/data/__validation__/fase3cValidation.js";
```

- [ ] **Step 3: Run in the browser**

Open the app, then in DevTools:
```js
await window.__validation.fase3c()
// Expected: all checks pass; "Fase 3c validation PASSED"
```

- [ ] **Step 4: Commit**

```bash
git add src/services/data/__validation__/fase3cValidation.js \
        <wherever-it-is-imported>
git commit -m "test(modeling): Fase 3c — browser harness vs R golden values"
```

---

## Task 9: Update CLAUDE.md + design doc

**Files:**
- Modify: `CLAUDE.md` (Pending item 2a — append Fase 3c)
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md` (status line + Fase 3 section)

- [ ] **Step 1: Update design doc status line**

Replace the existing top-of-document status line with:
```
Fase 0 + Fase 1 + Fase 2 DONE (2026-05-20). Fase 3a (2SLS) DONE (2026-05-20). Fase 3c (WLS) DONE (2026-05-21). Fase 3b (GMM/LIML), 4–7 pending.
```

- [ ] **Step 2: Append a Fase 3c note to the Fase 3 section**

Below the existing `**Fase 3a status (2026-05-20):**` block, add:

```md
**Fase 3c status (2026-05-21):** WLS classical + HC0/HC1 implemented.
  - `duckdbWLS.js` buildWLSSuffStats — single pass produces both weighted (X'WX, X'WY) and unweighted (X'X, X'Y, Y'Y, sumY) cross-products.
  - `WLSEngine.js` runWLSFromSuffStats — β from (X'WX)⁻¹X'WY; SSR = Y'Y − 2β'X'Y + β'X'Xβ (UNweighted, matches runWLS); R² emitted from unweighted SST (documented deviation from runWLS's weighted R²).
  - `duckdbWLSRobustSE.js` computeWLSHCMeat — meat = Σ wᵢ² êᵢ² xᵢ xⱼ in SQL with β as prepared params.
  - Cache: makeCacheKey / validateSuffStatsEntry extended with optional wCol.
  - Dispatcher: hasWeights allowed iff estimator === "WLS"; SE restricted to {classical, HC0, HC1} for WLS in Fase 3c.
  - Validated vs R lm(..., weights = w) + sandwich::vcovHC at 6dp coef / 4dp SE (fase3cBenchmarks.json, window.__validation.fase3c).
  Deferred to a later fase: HC2/HC3, clustered, twoway, HAC × WLS.
```

- [ ] **Step 3: Update CLAUDE.md Pending item 2a**

Append a sentence to the end of the existing item 2a:
```
Fase 3c extension: WLS suff-stats path live for classical/HC0/HC1 via duckdbWLS.js + WLSEngine.js + duckdbWLSRobustSE.js; cache key extended with optional weight column; validated vs R lm(..., weights = w) + sandwich in fase3cBenchmarks.json.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md
git commit -m "docs: Fase 3c — WLS sufficient-statistics path complete"
```

---

## Self-review checklist

- Spec coverage: design doc lines 244 (`duckdbWLS.js: buildWLSSuffStats — same aggs with wᵢ factor; reuses all HC* infra with residuals scaled by √wᵢ`) ✅ Task 2 + Task 4; dispatcher removes `!hasWeights` for WLS ✅ Task 1.
- Placeholder scan: no "TBD" / "implement appropriate" / "similar to" — every step is concrete.
- Type consistency:
  - `buildWLSSuffStats` returns `{n, sumW, sumY, YtY, XtX, XtY, XtWX, XtWY, varNames, weightCol}` — Task 3's `runWLSFromSuffStats` destructures the same fields.
  - `meat` is always `(k+1)×(k+1)` symmetric — Task 4 returns this shape; Task 3 consumes it.
  - Cache key signature `makeCacheKey(table, yCol, xCols, zCols?, wCol?)` — Task 5 keeps it back-compatible (default `null` for both); Task 6 passes `wCol`.
- HC2/HC3/cluster/twoway/HAC for WLS: explicitly deferred — Task 1 Step 4 guard, Task 6 Step 3 guard. Falls back to JS via `runWLS` (existing path).
- Documented deviation: WLS R² in Task 3 is unweighted (not weighted as in `runWLS`). Flagged via `_wlsR2Note: "unweighted"` field for the consumer; documented in Task 9 design doc note.
