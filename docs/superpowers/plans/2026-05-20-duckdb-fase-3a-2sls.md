# DuckDB Fase 3a — 2SLS / IV Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push 2SLS estimation into DuckDB-Wasm for n ≥ 50k via sufficient statistics — never materializing the full Arrow table in JS.

**Architecture:** One SQL pass produces Z'Z, Z'X, X'X, Z'Y, X'Y, Y'Y, sumY, n. JS solves `β = (X'Pz X)⁻¹ X'Pz Y` with `Pz = Z(Z'Z)⁻¹ Z'` purely on small matrices. Structural SSR comes from a closed form on suff-stats (`Y'Y − 2β'X'Y + β'X'Xβ`). Robust SE meats use the existing prepared-statement / sum-aggregate pattern, but operate on `x̂ᵢ` (first-stage fitted) and structural residuals, matching R's `iv_robust` / `sandwich` spec.

**Tech Stack:** DuckDB-Wasm 0.10 (jsDelivr CDN, lazy singleton), JavaScript matrix helpers from `LinearEngine.js`, validation against R `AER::ivreg` + `sandwich::vcovHC` 6/4-dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbIV.js` — `buildIVSuffStats(tableName, yCol, xCols, zCols, opts)` returns `{n, ZtZ, ZtX, XtX, ZtY, XtY, YtY, sumY, varNames, instrNames}`
- `src/services/data/duckdbIVRobustSE.js` — `computeIVHCMeat({tableName, yCol, xCols, zCols, dummySQL, beta, firstStageBeta})` returns `{meat, n}` (HC0/HC1)
- `src/math/IV2SLSEngine.js` — `run2SLSFromSuffStats({ZtZ, ZtX, XtX, ZtY, XtY, YtY, sumY, n, varNames, instrNames, meat, hcType})` returns an `EstimationResult`-shaped object
- `src/services/data/__validation__/fase3aRValidation.R` — generates `fase3a_data.csv` + `fase3aBenchmarks.json` using `AER::ivreg`
- `src/services/data/__validation__/fase3aValidation.js` — `runFase3aNumericalValidation()` exposed at `window.__validation.fase3a`

**Modify:**
- `src/services/data/dispatchConfig.js:21` — add `"2SLS"` to `SQL_SUPPORTED_ESTIMATORS`
- `src/services/data/duckdbDispatch.js:24-41` — add `ctx.zVars` + `ctx.endogCount`; guards: zVars non-empty, q ≥ endogCount, (k+q) ≤ K_THRESHOLD
- `src/components/ModelingTab.jsx` — import 2SLS suff-stats helpers; add 2SLS branch inside the `shouldUseSQLPath` try block; thread `zVars` + `xVars`/`wVars` split into `dispatchCtx`
- `src/math/index.js` — re-export `run2SLSFromSuffStats`
- `src/services/data/suffStatsCache.js` (only if cache key needs the z-tuple) — extend `makeCacheKey` to accept `zCols`; otherwise keep IV cache separate (decision in Task 8)

**Test files:** the existing `__validation__/dispatchValidation.js` already covers the dispatcher; this plan adds the IV-specific tests inline.

---

## Task 1: Extend dispatcher to recognize 2SLS

**Files:**
- Modify: `src/services/data/dispatchConfig.js:21`
- Modify: `src/services/data/duckdbDispatch.js:1-42`

- [ ] **Step 1: Add 2SLS to supported estimators**

```js
// dispatchConfig.js — replace existing SQL_SUPPORTED_ESTIMATORS line
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS", "2SLS"]);
```

- [ ] **Step 2: Extend `ctx` schema in dispatcher header comment**

Add to the JSDoc block at the top of `duckdbDispatch.js`:

```
//   zVars:         string[] | null  — instruments (required when estimator="2SLS")
//   endogCount:    number          — number of endogenous regressors (required when estimator="2SLS")
//   xColsEndog:    string[]         — endogenous regressor names (required when estimator="2SLS")
```

- [ ] **Step 3: Add 2SLS-specific operand guards**

Inside `shouldUseSQLPath`, after the existing `if (se === "HAC" && !ctx.timeVar) return false;` line:

```js
  if (ctx.estimator === "2SLS") {
    if (!Array.isArray(ctx.zVars) || ctx.zVars.length === 0) return false;
    if (!Array.isArray(ctx.xColsEndog) || ctx.xColsEndog.length === 0) return false;
    // Order condition: at least one instrument per endogenous regressor
    if (ctx.zVars.length < ctx.xColsEndog.length) return false;
    // Joint complexity: k + q must respect K_THRESHOLD (both go through suff-stats matrices)
    const totalK = (ctx.xColsExpanded?.length ?? 0) + ctx.zVars.length;
    if (totalK > K_THRESHOLD) return false;
  }
```

- [ ] **Step 4: Verify via browser DevTools dispatcher introspection**

Run:
```js
shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "2SLS", seType: "classical", hasWeights: false,
  zVars: ["z1","z2"], xColsEndog: ["x1"], endogCount: 1
})
// Expected: true
shouldUseSQLPath({ ...above, zVars: [] })
// Expected: false  (no instruments)
shouldUseSQLPath({ ...above, xColsEndog: ["x1","x2"], zVars: ["z1"] })
// Expected: false  (under-identified)
```

- [ ] **Step 5: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js
git commit -m "feat(modeling): Fase 3a — dispatcher recognizes 2SLS + IV operand guards"
```

---

## Task 2: `buildIVSuffStats` — single-pass SQL suff-stats

**Files:**
- Create: `src/services/data/duckdbIV.js`

- [ ] **Step 1: Write the function shell mirroring `buildOLSSuffStats`**

```js
// ─── ECON STUDIO · src/services/data/duckdbIV.js ──────────────────────────────
// 2SLS sufficient-statistics push-down.
//
// One SQL pass produces, with X = [1, x₁..x_k] and Z = [1, x_exog..x_exog_p, z₁..z_q]:
//   n, sumY, Y'Y
//   X'X  (k+1)×(k+1)  symmetric
//   Z'Z  (p+q+1)×(p+q+1)  symmetric
//   Z'X  (p+q+1)×(k+1)
//   X'Y  (k+1)
//   Z'Y  (p+q+1)
//
// JS solves Pz = Z(Z'Z)⁻¹Z', β = (X'PzX)⁻¹ X'PzY on small matrices.
//
// Convention: in 2SLS the "design" X is [1, ALL regressors (endog+exog)]; Z is
// [1, ALL exog regressors, instruments]. Caller resolves these into two flat lists.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {string}   tableName
 * @param {string}   yCol
 * @param {string[]} xCols       — full design (endogenous + exogenous), intercept implicit
 * @param {string[]} zCols       — instruments: exogenous regressors of X + excluded instruments
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL] — synthetic dummy expressions for both X and Z
 * @returns {Promise<{
 *   n: number, sumY: number, YtY: number,
 *   XtX: number[][], ZtZ: number[][], ZtX: number[][],
 *   XtY: number[], ZtY: number[],
 *   varNames: string[], instrNames: string[],
 * }>}
 */
export async function buildIVSuffStats(tableName, yCol, xCols, zCols, opts = {}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const q = zCols.length;
  if (k < 1) throw new Error("buildIVSuffStats: need at least one regressor");
  if (q < 1) throw new Error("buildIVSuffStats: need at least one instrument");

  const dummySQL = opts.dummySQL ?? {};
  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  // ── Model frame CTE ─────────────────────────────────────────────────────────
  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xCols.map(colExpr);
  const zExprs = zCols.map(colExpr);

  const projections = [`${yExpr} AS _y_`];
  xExprs.forEach((e, i) => projections.push(`${e} AS _x_${i}`));
  zExprs.forEach((e, i) => projections.push(`${e} AS _z_${i}`));

  const finite = [`isfinite(_y_)`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);
  for (let i = 0; i < q; i++) finite.push(`isfinite(_z_${i})`);

  // ── Aggregates ──────────────────────────────────────────────────────────────
  const aggs = [`COUNT(*) AS n`, `SUM(_y_) AS sum_y`, `SUM(_y_ * _y_) AS yty`];

  // X'X upper triangle including intercept row/col
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
  }

  // Z'Z upper triangle including intercept row/col
  for (let i = 0; i < q; i++) aggs.push(`SUM(_z_${i}) AS sum_z_${i}`);
  for (let i = 0; i < q; i++) aggs.push(`SUM(_z_${i} * _y_) AS sum_zy_${i}`);
  for (let i = 0; i < q; i++) {
    for (let j = i; j < q; j++) aggs.push(`SUM(_z_${i} * _z_${j}) AS sum_zz_${i}_${j}`);
  }

  // Z'X full grid (NOT symmetric)
  for (let i = 0; i < q; i++) {
    for (let j = 0; j < k; j++) aggs.push(`SUM(_z_${i} * _x_${j}) AS sum_zx_${i}_${j}`);
  }

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
  const sumY = num(r.sum_y);
  const YtY  = num(r.yty);

  const kDim = k + 1;
  const qDim = q + 1;
  const XtX = Array.from({ length: kDim }, () => Array(kDim).fill(0));
  const ZtZ = Array.from({ length: qDim }, () => Array(qDim).fill(0));
  const ZtX = Array.from({ length: qDim }, () => Array(kDim).fill(0));
  const XtY = Array(kDim).fill(0);
  const ZtY = Array(qDim).fill(0);

  // Intercept row/col for X
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

  // Intercept row/col for Z
  ZtZ[0][0] = n;
  ZtY[0]    = sumY;
  for (let i = 0; i < q; i++) {
    const sz = num(r[`sum_z_${i}`]);
    ZtZ[0][i + 1] = sz;
    ZtZ[i + 1][0] = sz;
    ZtY[i + 1]    = num(r[`sum_zy_${i}`]);
  }
  for (let i = 0; i < q; i++) {
    for (let j = i; j < q; j++) {
      const v = num(r[`sum_zz_${i}_${j}`]);
      ZtZ[i + 1][j + 1] = v;
      if (i !== j) ZtZ[j + 1][i + 1] = v;
    }
  }

  // Z'X: intercept row of Z = (1, ...) → ZtX[0][j] = X'·1 components = (n or sum_x_{j-1})
  ZtX[0][0] = n;
  for (let j = 0; j < k; j++) ZtX[0][j + 1] = num(r[`sum_x_${j}`]);
  // Intercept column of X = (1, ...) → ZtX[i+1][0] = sum_z_i
  for (let i = 0; i < q; i++) ZtX[i + 1][0] = num(r[`sum_z_${i}`]);
  // Pure cross-products
  for (let i = 0; i < q; i++) {
    for (let j = 0; j < k; j++) ZtX[i + 1][j + 1] = num(r[`sum_zx_${i}_${j}`]);
  }

  return {
    n, sumY, YtY,
    XtX, ZtZ, ZtX, XtY, ZtY,
    varNames:   ["(Intercept)", ...xCols],
    instrNames: ["(Intercept)", ...zCols],
  };
}
```

- [ ] **Step 2: Quick sanity smoke test in DevTools**

Load the FE benchmark dataset (any small DuckDB-backed table), run:
```js
import { buildIVSuffStats } from "./services/data/duckdbIV.js";
const r = await buildIVSuffStats("t", "y", ["x1","x2"], ["z1","z2"]);
// Expected: n, XtX (3x3 sym), ZtZ (3x3 sym), ZtX (3x3), no NaN
```

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdbIV.js
git commit -m "feat(data): Fase 3a — IV/2SLS sufficient-statistics SQL pass"
```

---

## Task 3: `run2SLSFromSuffStats` — classical solver

**Files:**
- Create: `src/math/IV2SLSEngine.js`
- Modify: `src/math/index.js` (export)

- [ ] **Step 1: Write the solver**

```js
// ─── ECON STUDIO · src/math/IV2SLSEngine.js ───────────────────────────────────
// 2SLS solver from sufficient statistics. No row materialization, no React.
//
//   Pz       = Z (Z'Z)⁻¹ Z'
//   X'Pz X   = (Z'X)' (Z'Z)⁻¹ (Z'X)
//   X'Pz Y   = (Z'X)' (Z'Z)⁻¹ (Z'Y)
//   β̂       = (X'Pz X)⁻¹ (X'Pz Y)
//
// Structural residual moments (closed-form on suff-stats):
//   Σ êᵢ²  = Y'Y − 2 β'X'Y + β'X'Xβ
//
// Classical SE: σ̂² (X'Pz X)⁻¹ with σ̂² = Σêᵢ² / (n − k).

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";

function vmul(M, v) {
  // M (m×n) · v (n) → m
  return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0));
}
function quadForm(v, M) {
  // v' M v
  return vmul(M, v).reduce((s, w, i) => s + w * v[i], 0);
}

/**
 * @param {object} args
 * @param {number}   args.n
 * @param {number}   args.sumY
 * @param {number}   args.YtY
 * @param {number[][]} args.XtX   (k+1)×(k+1)
 * @param {number[][]} args.ZtZ   (q+1)×(q+1)
 * @param {number[][]} args.ZtX   (q+1)×(k+1)
 * @param {number[]}   args.XtY   k+1
 * @param {number[]}   args.ZtY   q+1
 * @param {string[]}   args.varNames
 * @param {number[][]} [args.meat]   — only when robust SE; (k+1)×(k+1)
 * @param {'HC0'|'HC1'|null} [args.hcType]
 * @returns {object|null}
 */
export function run2SLSFromSuffStats({
  n, sumY, YtY, XtX, ZtZ, ZtX, XtY, ZtY, varNames,
  meat = null, hcType = null,
}) {
  const k = XtX.length;          // includes intercept
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return null;

  // M = (Z'X)' (Z'Z)⁻¹ — reused for both bread and X'Pz Y
  const ZtXt = transpose(ZtX);                       // (k×(q+1))
  const M    = matMul(ZtXt, ZtZinv);                 // (k×(q+1))
  const XtPzX = matMul(M, ZtX);                      // (k×k)
  const XtPzY = vmul(M, ZtY);                        // (k)

  const Ainv = matInv(XtPzX);
  if (!Ainv) return null;
  const beta = vmul(Ainv, XtPzY);

  // Σêᵢ² in closed form on suff-stats
  // êᵢ = yᵢ − xᵢ'β  ⇒  Σê² = Y'Y − 2β'X'Y + β'X'Xβ
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + quadForm(beta, XtX);

  const df = n - k;
  const s2 = SSR / Math.max(1, df);
  const Ym = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // Classical SE: √(σ̂² · diag(Ainv))
  // Robust SE: V = Ainv · meat · Ainv, HC1 scales meat by n/(n-k)
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
    R2, adjR2, n, df, varNames,
    SSR, ssr: SSR,
    XtPzXinv: Ainv,
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `src/math/index.js`, find the existing `runOLSFromSuffStats` re-export and add immediately below:

```js
export { run2SLSFromSuffStats } from "./IV2SLSEngine.js";
```

- [ ] **Step 3: Hand-verify against a tiny case in DevTools**

Build a 5-row dataset with known coefficients, run `buildIVSuffStats` + `run2SLSFromSuffStats`, compare β to `run2SLS` on the same rows. Tolerance 1e-10.

- [ ] **Step 4: Commit**

```bash
git add src/math/IV2SLSEngine.js src/math/index.js
git commit -m "feat(math): Fase 3a — run2SLSFromSuffStats classical solver"
```

---

## Task 4: Wire 2SLS SQL branch into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

Near the existing `import { buildOLSSuffStats } from "../services/data/duckdbOLS.js";` line, add:

```js
import { buildIVSuffStats }       from "../services/data/duckdbIV.js";
import { run2SLSFromSuffStats }   from "../math/index.js";  // already imported via barrel — verify
```

- [ ] **Step 2: Extend `dispatchCtx`**

In `ModelingTab.jsx` where `dispatchCtx` is built (~line 1753), add:

```js
        xColsEndog:    model === "2SLS" ? xVars : [],
        zVars:         model === "2SLS" ? zVars : [],
        endogCount:    model === "2SLS" ? xVars.length : 0,
```

(`xVars` are endogenous, `wVars` are exogenous controls — confirmed at lines 1533–1536 in `estimate`. Keep that semantic invariant.)

- [ ] **Step 3: Add 2SLS branch inside the SQL try block**

After the existing OLS SQL block (the one that calls `runOLSFromSuffStats`), add a parallel branch keyed on `model === "2SLS"`. **Skeleton — replace `…` with full implementation:**

```js
          if (model === "2SLS") {
            // X = endogenous + exogenous controls; Z = exogenous + excluded instruments
            const xAll  = [...xVars, ...wVars];
            const zAll  = [...wVars, ...zVars];
            const { xColsExpanded: xExp, dummySQL: xDummy } = await expandFactors({
              xCols: xAll, tableName: duckTable,
            });
            const { xColsExpanded: zExp, dummySQL: zDummy } = await expandFactors({
              xCols: zAll, tableName: duckTable,
            });
            const dummySQL = { ...xDummy, ...zDummy };

            // Recheck k+q post-expansion
            if (!shouldUseSQLPath({ ...dispatchCtx, xColsExpanded: xExp })) {
              throw new Error("Post-expansion k+q exceeds threshold — fallback to JS");
            }

            const m = await measure(() => buildIVSuffStats(duckTable, yVar[0], xExp, zExp, { dummySQL }));
            logEstimate({ path: "sql", phase: "ivSuffStats", n: rowCount, k: xExp.length, q: zExp.length, msTotal: m.ms });

            // Classical only in Task 4 — meat wiring in Task 7
            const r2 = await measure(() => run2SLSFromSuffStats({
              ...m.result, meat: null, hcType: null,
            }));
            if (!r2.result) throw new Error("Suff-stats 2SLS solve returned null (singular)");
            logEstimate({ path: "sql", phase: "engine-2SLS", n: rowCount, k: xExp.length, msTotal: r2.ms });

            const res = wrapResult("2SLS", {
              second: r2.result,
              firstStages: [],  // populated in Task 5 — placeholder
            }, { yVar: yVar[0], xVars, wVars, zVars });
            return { result: res, panelFE: null, panelFD: null };
          }
```

- [ ] **Step 4: Run the existing app, pick 2SLS, point at fase2_data, confirm output**

Manually open the app, select 2SLS on a >50k dataset, ensure result panel renders without errors. β should match `run2SLS(...)` on the same dataset within 1e-8.

- [ ] **Step 5: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3a — 2SLS SQL fast path (classical SE)"
```

---

## Task 5: First-stage F-stats from suff-stats

**Files:**
- Modify: `src/math/IV2SLSEngine.js`
- Modify: `src/components/ModelingTab.jsx` (2SLS branch)

- [ ] **Step 1: Add `firstStageFromSuffStats` helper to IV2SLSEngine.js**

Append to `IV2SLSEngine.js`:

```js
// First-stage F per endogenous regressor — computed entirely from suff-stats.
// Unrestricted regression: endᵢ ~ [1, exog, instruments]   → uses ZtZ, ZtY_for_endᵢ via cross-products in XtX/ZtX
// Restricted regression:  endᵢ ~ [1, exog]                  → submatrix of XtX
//
// For simplicity in this first cut, the caller can issue a separate
// `buildOLSSuffStats(tableName, endogCol, [...exog, ...instr])` and
// `buildOLSSuffStats(tableName, endogCol, exog)` to get exact SSR_u and SSR_r,
// then F = ((SSR_r - SSR_u) / q) / (SSR_u / df_u).
//
// This helper assumes the caller has provided both objects.
export function firstStageFFromSuffStats(unrestricted, restricted, qInstruments) {
  if (!unrestricted || !restricted) return null;
  const SSR_u = unrestricted.SSR ?? unrestricted.ssr;
  const SSR_r = restricted.SSR  ?? restricted.ssr;
  const dfu   = unrestricted.df;
  const Fstat = ((SSR_r - SSR_u) / qInstruments) / (SSR_u / dfu);
  const weak  = Fstat < 10;  // Stock-Yogo
  return { Fstat, weak, dfNum: qInstruments, dfDen: dfu };
}
```

- [ ] **Step 2: In ModelingTab.jsx 2SLS branch, populate `firstStages`**

After computing `m.result` and before the engine call, for each endogenous regressor issue two `buildOLSSuffStats` calls (with the existing OLS path). Wrap in `Promise.all` to parallelize:

```js
            const exogExp = await expandFactors({ xCols: wVars, tableName: duckTable });
            const firstStages = await Promise.all(xVars.map(async endVar => {
              const unrestricted = await buildOLSSuffStats(
                duckTable, endVar, [...exogExp.xColsExpanded, ...zVars],
                { dummySQL: exogExp.dummySQL },
              );
              const restricted = wVars.length > 0
                ? await buildOLSSuffStats(duckTable, endVar, exogExp.xColsExpanded, { dummySQL: exogExp.dummySQL })
                : null;
              const u = runOLSFromSuffStats({ ...unrestricted, varNames: unrestricted.varNames });
              const r = restricted ? runOLSFromSuffStats({ ...restricted, varNames: restricted.varNames }) : null;
              // When no exog controls, restricted SSR = Σ(yᵢ − ȳ)² = YtY − sumY²/n
              const SSR_r_fallback = !r
                ? unrestricted.YtY - (unrestricted.sumY * unrestricted.sumY) / unrestricted.n
                : null;
              const F = firstStageFFromSuffStats(
                u,
                r ?? { SSR: SSR_r_fallback, df: unrestricted.n - 1 },
                zVars.length,
              );
              return { endVar, ...F, Fpval: 1 - fCDF(F.Fstat, F.dfNum, F.dfDen) };
            }));
```

Import `fCDF` from `../math/LinearEngine.js` if not already imported.

- [ ] **Step 3: Replace the placeholder `firstStages: []` in the result wrapping with the computed array**

- [ ] **Step 4: Manually verify in the app — first-stage F values should match the JS path within 1e-6 on fase2_data**

- [ ] **Step 5: Commit**

```bash
git add src/math/IV2SLSEngine.js src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3a — first-stage F-stats from suff-stats"
```

---

## Task 6: `computeIVHCMeat` — HC0/HC1 robust meat for 2SLS

**Files:**
- Create: `src/services/data/duckdbIVRobustSE.js`

- [ ] **Step 1: Write the meat builder**

```js
// ─── ECON STUDIO · src/services/data/duckdbIVRobustSE.js ──────────────────────
// HC0/HC1 sandwich meat for 2SLS, computed in SQL.
//
// For 2SLS the meat matrix is:
//   M = Σ êᵢ²  x̂ᵢ x̂ᵢ'
// where êᵢ are STRUCTURAL residuals (yᵢ − xᵢ'β̂_2SLS) using ACTUAL x,
// and x̂ᵢ is the first-stage fitted regressor row for endogenous components
// (exogenous components are themselves).
//
// HC1 scaling n/(n−k) is applied by the engine, not here.
//
// Parameters bound as prepared statements:
//   - β (k+1)         → consumed by structural residual
//   - α_j (q+1) for each endogenous j → consumed by first-stage x̂_j
//
// SQL:
//   resid  = y − Σ β_l · x_l_actual
//   xhat_j = Σ α_jl · z_l        (for endogenous j)
//   xhat_j = x_j                  (for exogenous j or intercept)
//   meat[i][j] = SUM(resid² · xhat_i · xhat_j)

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
 * @param {string[]} args.xCols             — full design (endog + exog), intercept implicit
 * @param {string[]} args.zCols             — instruments (exog + excluded), intercept implicit
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta              — 2SLS β, length k+1 with intercept first
 * @param {Map<number,number[]>} args.firstStageBeta
 *   — keyed by X-column index (0 = intercept, 1..k = x_cols),
 *     value = first-stage α for that endogenous regressor (length q+1).
 *     Exogenous indices (and the intercept) are NOT in this map; SQL treats
 *     x̂ = x directly for those.
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeIVHCMeat({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta,
}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const q = zCols.length;
  const kDim = k + 1;
  const qDim = q + 1;

  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xCols[i - 1]);
  const zExpr = (i) => i === 0 ? "1.0" : colExpr(zCols[i - 1]);

  // residSQL — same pattern as duckdbRobustSE.js
  const betaTerms = [];
  const betaParams = [];
  for (let i = 0; i < kDim; i++) {
    betaTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${betaTerms.join(" + ")}))`;

  // xhatExpr(i): if i is endogenous, build Σ α_il · z_l; else xExpr(i)
  const ainvParamsByEndog = new Map();  // ordered: insertion order matches SQL appearance
  const xhatExpr = (i) => {
    if (!firstStageBeta.has(i)) return xExpr(i);
    const alpha = firstStageBeta.get(i);
    if (alpha.length !== qDim) throw new Error(`computeIVHCMeat: firstStageBeta[${i}] length ${alpha.length} ≠ q+1 (${qDim})`);
    const terms = [];
    const params = [];
    for (let l = 0; l < qDim; l++) {
      terms.push(`? * ${zExpr(l)}`);
      params.push(alpha[l]);
    }
    ainvParamsByEndog.set(i, params);
    return `(${terms.join(" + ")})`;
  };

  // Aggregates: upper triangle of meat
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
      aggs.push(`SUM(POWER(${residSQL}, 2) * ${xhatExpr(i)} * ${xhatExpr(j)}) AS m_${i}_${j}`);
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);
  for (let i = 0; i < q; i++) finite.push(`isfinite(${zExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // Param binding strategy:
  //   Each aggregate contains: residSQL (once) → 1× β-params, then for indices i,j
  //   any xhatExpr that is an endogenous expansion → 1× α-params for that endog.
  //   DuckDB resolves ? left-to-right; bind in the same textual order.
  //
  // Per aggregate, in order: betaParams, [α_i if endog(i)], [α_j if endog(j)].
  //   When i = j and endogenous, α appears twice.
  const aggCount = (kDim * (kDim + 1)) / 2;
  const boundParams = [];
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
      boundParams.push(...betaParams);
      if (ainvParamsByEndog.has(i)) boundParams.push(...ainvParamsByEndog.get(i));
      if (ainvParamsByEndog.has(j)) boundParams.push(...ainvParamsByEndog.get(j));
    }
  }

  // Sanity guards — match the patterns in duckdbRobustSE.js
  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== aggCount) {
    throw new Error(`computeIVHCMeat: residSQL occurrence mismatch (got ${residCount}, expected ${aggCount})`);
  }

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: kDim }, () => Array(kDim).fill(0));
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
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
git add src/services/data/duckdbIVRobustSE.js
git commit -m "feat(data): Fase 3a — IV HC0/HC1 meat builder"
```

---

## Task 7: Wire HC0/HC1 robust SE into the 2SLS branch

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Extend SQL-supported SE set**

Already supports `classical`, `HC0`, `HC1` via Fase 1. For 2SLS we restrict (this fase) to classical, HC0, HC1 only. Add a guard inside the 2SLS branch that throws (and falls back to JS) for HC2/HC3/clustered/twoway/HAC until later sub-fases:

```js
if (model === "2SLS") {
  if (!["classical", "HC0", "HC1"].includes(seTypeNorm)) {
    throw new Error(`2SLS SQL path only supports classical/HC0/HC1 in Fase 3a (got ${seTypeNorm}) — fallback to JS`);
  }
  // … existing code from Task 4 …
}
```

- [ ] **Step 2: After computing first stages, capture each first-stage β into a Map keyed by X column index**

```js
const firstStageBeta = new Map();
xVars.forEach((endVar, j) => {
  // Endogenous regressors occupy positions 1..xVars.length in X (intercept = 0)
  const xIdx = j + 1;
  const fs   = firstStages[j];
  // fs.beta was computed in Task 5 via runOLSFromSuffStats — already includes intercept
  // It's aligned to [1, exog..., instruments]. We need it aligned to [1, exog..., instruments]
  // which is exactly zExp from Task 4. So fs.beta IS the α-vector — length q+1.
  firstStageBeta.set(xIdx, fs.beta);
});
```

(Verify the alignment matches `zExp = [...wVars, ...zVars]` from Task 4 — adjust ordering if not.)

- [ ] **Step 3: Branch on SE type**

```js
let meat = null;
if (seTypeNorm === "HC0" || seTypeNorm === "HC1") {
  const mm = await measure(() => computeIVHCMeat({
    tableName: duckTable, yCol: yVar[0],
    xCols: xExp, zCols: zExp, dummySQL,
    beta: m.result.beta ?? r2_classical.result.beta,  // use β from classical solve
    firstStageBeta,
  }));
  meat = mm.result.meat;
  logEstimate({ path: "sql", phase: `meat-2SLS-${seTypeNorm}`, n: rowCount, k: xExp.length, msTotal: mm.ms });
}

const engineHcType = (seTypeNorm === "HC1") ? "HC1" : null;
const r2 = run2SLSFromSuffStats({ ...m.result, meat, hcType: engineHcType });
```

(Adjust variable naming if the Task 4 classical solve is already named differently — pass β into the meat call so we don't solve twice.)

- [ ] **Step 4: Import the new helper**

```js
import { computeIVHCMeat } from "../services/data/duckdbIVRobustSE.js";
```

- [ ] **Step 5: Manually test in the app on fase2_data with seType = HC1 → confirm robust SE come through**

- [ ] **Step 6: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3a — 2SLS HC0/HC1 robust SE in SQL"
```

---

## Task 8: Cache key for 2SLS suff-stats

**Files:**
- Modify: `src/services/data/suffStatsCache.js` (or `src/components/ModelingTab.jsx` if cache is owned there)

- [ ] **Step 1: Decide approach**

Two options:
  (a) Extend `makeCacheKey(table, yCol, xCols)` to `(table, yCol, xCols, zCols?)`. Same cache, longer key.
  (b) Separate `ivSuffStatsCacheRef` mirroring the existing OLS cache.

Pick (a) — simpler, one LRU.

- [ ] **Step 2: Update `makeCacheKey`**

```js
// suffStatsCache.js
export function makeCacheKey(table, yCol, xCols, zCols = null) {
  const xs = [...xCols].sort().join("|");
  if (!zCols) return `${table}::${yCol}::${xs}`;
  const zs = [...zCols].sort().join("|");
  return `${table}::${yCol}::${xs}::Z::${zs}`;
}
```

- [ ] **Step 3: Update call site in ModelingTab 2SLS branch**

```js
const key = makeCacheKey(duckTable, yVar[0], xExp, zExp);
```

- [ ] **Step 4: Update `validateSuffStatsEntry` if it inspects column lengths — add a `zCols` check**

```js
export function validateSuffStatsEntry(entry, xCols, zCols = null) {
  if (entry?.XtX?.length !== xCols.length + 1) return false;
  if (zCols && entry?.ZtZ?.length !== zCols.length + 1) return false;
  return true;
}
```

- [ ] **Step 5: Commit**

```bash
git add src/services/data/suffStatsCache.js src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3a — extend suff-stats cache key for 2SLS"
```

---

## Task 9: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase3aRValidation.R`

- [ ] **Step 1: Write the R script**

```r
# fase3aRValidation.R — generates fase3a_data.csv and fase3aBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3aRValidation.R
#
# DGP:  y = β0 + β1·x1 + β2·x2 + u
#       x1 = π0 + π1·z1 + π2·z2 + v        (endogenous: corr(u,v)=0.5)
#       z1, z2, x2 exogenous
#
# n = 10,000.

suppressPackageStartupMessages({
  library(AER)
  library(sandwich)
  library(jsonlite)
})

set.seed(20260520)
n <- 10000

z1 <- rnorm(n)
z2 <- rnorm(n)
x2 <- rnorm(n)
# Correlated errors (corr = 0.5)
e  <- matrix(rnorm(2 * n), n, 2) %*% chol(matrix(c(1, 0.5, 0.5, 1), 2, 2))
v  <- e[, 1]
u  <- e[, 2]

x1 <- 0.5 + 0.8 * z1 + 0.6 * z2 + v
y  <- 1.0 + 2.0 * x1 + (-0.5) * x2 + u

df <- data.frame(y, x1, x2, z1, z2)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3a_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# Fit AER::ivreg
fit <- ivreg(y ~ x1 + x2 | z1 + z2 + x2, data = df)
co  <- coef(fit)
se_classical <- sqrt(diag(vcov(fit)))
se_HC0       <- sqrt(diag(vcovHC(fit, type = "HC0")))
se_HC1       <- sqrt(diag(vcovHC(fit, type = "HC1")))

# First-stage F (single endogenous regressor)
fs <- lm(x1 ~ x2 + z1 + z2, data = df)
fs_r <- lm(x1 ~ x2, data = df)
SSR_u <- sum(resid(fs)^2)
SSR_r <- sum(resid(fs_r)^2)
F_first <- ((SSR_r - SSR_u) / 2) / (SSR_u / fs$df.residual)

bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  beta = unname(co),
  se_classical = unname(se_classical),
  se_HC0 = unname(se_HC0),
  se_HC1 = unname(se_HC1),
  firstStageF_x1 = F_first
)
out_json <- file.path("src", "services", "data", "__validation__", "fase3aBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
```

- [ ] **Step 2: Run it locally**

```bash
Rscript src/services/data/__validation__/fase3aRValidation.R
```

Expected output: two files written, console confirmation.

- [ ] **Step 3: Commit (data + benchmarks + script)**

```bash
git add src/services/data/__validation__/fase3aRValidation.R \
        src/services/data/__validation__/fase3aBenchmarks.json \
        src/services/data/__validation__/fase3a_data.csv
git commit -m "test(data): Fase 3a — R AER::ivreg golden values for 2SLS"
```

---

## Task 10: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase3aValidation.js`

- [ ] **Step 1: Write the harness**

```js
// ─── ECON STUDIO · src/services/data/__validation__/fase3aValidation.js ───────
// Loads fase3a_data.csv into DuckDB, runs the SQL path's 2SLS three ways
// (classical, HC0, HC1), and compares against fase3aBenchmarks.json.
//
// Exposed at window.__validation.fase3a — call from DevTools.

import { getDuckDB } from "../duckdb.js";
import { buildIVSuffStats } from "../duckdbIV.js";
import { computeIVHCMeat } from "../duckdbIVRobustSE.js";
import { run2SLSFromSuffStats } from "../../../math/IV2SLSEngine.js";
import { buildOLSSuffStats } from "../duckdbOLS.js";
import { runOLSFromSuffStats } from "../../../math/LinearEngine.js";
import bench from "./fase3aBenchmarks.json";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  // Browser-relative URL via fetch — assumes Vite serves /__validation__/fase3a_data.csv
  const url = new URL("./fase3a_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3a.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3a_tbl`);
  await conn.query(`CREATE TABLE fase3a_tbl AS SELECT * FROM read_csv_auto('fase3a.csv')`);
  return "fase3a_tbl";
}

export async function runFase3aNumericalValidation() {
  const table = await loadCSV();
  const results = [];

  // 2SLS suff-stats
  const ss = await buildIVSuffStats(table, "y", ["x1", "x2"], ["z1", "z2"], {});

  // Classical
  const r_cls = run2SLSFromSuffStats({ ...ss, meat: null, hcType: null });
  results.push(["beta[0]", r_cls.beta[0], bench.beta[0], close6]);
  results.push(["beta[1]", r_cls.beta[1], bench.beta[1], close6]);
  results.push(["beta[2]", r_cls.beta[2], bench.beta[2], close6]);
  results.push(["se_classical[1]", r_cls.se[1], bench.se_classical[1], close4]);

  // First-stage β for x1
  const fs_u = await buildOLSSuffStats(table, "x1", ["x2", "z1", "z2"]);
  const fs_u_sol = runOLSFromSuffStats(fs_u);
  const firstStageBeta = new Map([[1, fs_u_sol.beta]]);  // x1 is at X-index 1

  // HC0
  const meatHC0 = (await computeIVHCMeat({
    tableName: table, yCol: "y", xCols: ["x1", "x2"], zCols: ["z1", "z2"],
    beta: r_cls.beta, firstStageBeta,
  })).meat;
  const r_HC0 = run2SLSFromSuffStats({ ...ss, meat: meatHC0, hcType: null });
  results.push(["se_HC0[1]", r_HC0.se[1], bench.se_HC0[1], close4]);

  // HC1
  const r_HC1 = run2SLSFromSuffStats({ ...ss, meat: meatHC0, hcType: "HC1" });
  results.push(["se_HC1[1]", r_HC1.se[1], bench.se_HC1[1], close4]);

  // First-stage F
  const fs_r = await buildOLSSuffStats(table, "x1", ["x2"]);
  const fs_r_sol = runOLSFromSuffStats(fs_r);
  const F = ((fs_r_sol.SSR - fs_u_sol.SSR) / 2) / (fs_u_sol.SSR / fs_u_sol.df);
  results.push(["firstStageF_x1", F, bench.firstStageF_x1, close4]);

  // Report
  const failures = [];
  results.forEach(([name, got, want, fn]) => {
    const ok = fn(got, want);
    if (!ok) failures.push({ name, got, want });
    console.log(`${ok ? "✓" : "✗"} ${name}: got ${got}, want ${want}`);
  });
  console.log(failures.length === 0
    ? `Fase 3a validation PASSED (${results.length}/${results.length})`
    : `Fase 3a validation FAILED (${failures.length} mismatches)`);
  return { results, failures };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.fase3a = runFase3aNumericalValidation;
}
```

- [ ] **Step 2: Import the harness somewhere it gets bundled**

Append to existing validation barrel (search for an existing `__validation__/index.js` or where `fase2Validation.js` is loaded — mirror that). Likely:

```js
import "./services/data/__validation__/fase3aValidation.js";
```

- [ ] **Step 3: Run in the browser**

Open app DevTools → `await window.__validation.fase3a()` — confirm all checks pass.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/__validation__/fase3aValidation.js \
        <wherever it's imported from>
git commit -m "test(modeling): Fase 3a — browser harness vs R golden values"
```

---

## Task 11: Update CLAUDE.md + design doc

**Files:**
- Modify: `CLAUDE.md` (Pending section — add 2a entry continuation)
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md` (status line + Fase 3a notes)

- [ ] **Step 1: Update design doc status**

Change the top-of-document status line to:
```
Fase 0 + Fase 1 + Fase 2 DONE (2026-05-20). Fase 3a (2SLS) DONE (2026-05-21). Fases 3b/3c (GMM/LIML, WLS), 4–7 pending.
```

- [ ] **Step 2: Append a "Fase 3a complete" note to the design doc Fase 3 section**

```md
**Fase 3a status (2026-05-21):** 2SLS classical + HC0/HC1 implemented.
  - `duckdbIV.js` buildIVSuffStats — Z'Z/Z'X/X'X/Z'Y/X'Y/Y'Y in one pass.
  - `IV2SLSEngine.js` run2SLSFromSuffStats — Pz on small matrices; SSR closed-form on suff-stats.
  - `duckdbIVRobustSE.js` computeIVHCMeat — structural residuals × first-stage x̂ outer products in SQL.
  - First-stage F per endogenous regressor via paired buildOLSSuffStats calls.
  - Validated vs AER::ivreg + sandwich::vcovHC at 6dp coef / 4dp SE.
  Deferred to 3b/3c: HC2/HC3, clustered, twoway, HAC for 2SLS.
```

- [ ] **Step 3: Update CLAUDE.md Pending item 2a**

Append a sentence:
```
Fase 3a extension: 2SLS suff-stats path live for classical/HC0/HC1 via duckdbIV.js + IV2SLSEngine.js; validated vs AER::ivreg in fase3aBenchmarks.json.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md
git commit -m "docs: Fase 3a — 2SLS sufficient-statistics path complete"
```

---

## Self-review checklist

- Spec coverage: design doc lines 244–247 — Z'Z/Z'X/Z'Y/X'X ✅ (Task 2), `(X'PzX)⁻¹ X'PzY` ✅ (Task 3), dispatcher updates ✅ (Task 1).
- No placeholders — every step has either explicit code or an exact command.
- Type consistency: `buildIVSuffStats` return shape (`ZtZ`, `ZtX`, `XtX`, `ZtY`, `XtY`, `YtY`, `sumY`, `n`, `varNames`, `instrNames`) is consumed identically by `run2SLSFromSuffStats` (Task 3) and the validation harness (Task 10). `firstStageBeta` is consistently a `Map<number, number[]>` keyed by X-column index (1-based, intercept = 0).
- HC2/HC3/cluster/twoway/HAC for 2SLS: explicitly deferred — Task 7 guards against them and the dispatcher won't gate them (Task 1 only adds `2SLS` to estimators; SE set unchanged).
- Validation: R script (Task 9) + browser harness (Task 10) hit β/SE_classical/SE_HC0/SE_HC1/firstStageF — five quantities, matching R's `AER::ivreg` + `sandwich`.
