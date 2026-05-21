# DuckDB Fase 3b — GMM + LIML Sufficient-Statistics Push-Down

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Push two-step efficient GMM and LIML into DuckDB-Wasm for n ≥ 50k via sufficient statistics — never materializing the full Arrow table in JS. Scope is **classical SE only** for both (HC variants deferred — GMM's Ω̂-based SE is already heteroskedasticity-robust by construction; LIML HC variants follow the 2SLS pattern in a later sub-fase).

**Architecture:**
- **GMM (two-step efficient):** Step 1 reuses `buildIVSuffStats` and `run2SLSFromSuffStats` (already from Fase 3a). Step 2 computes Ω̂ = (1/n)Σ êᵢ² zᵢ zⱼ in a single SQL pass with β̂₁ as bound params, then JS solves β̂₂ = (X'ZΩ̂⁻¹Z'X)⁻¹ X'ZΩ̂⁻¹Z'Y entirely on small matrices. The Hansen J-stat = n · g'Ω̂⁻¹g with g = Z'ê/n falls out of the same suff-stats.
- **LIML:** One SQL pass produces all bilinear forms needed to build the 2×2 (or m×m) generalized-eigenvalue matrices A = [Y,X]'M_Z[Y,X] and B = [Y,X]'M_W[Y,X] from sufficient statistics: `M_*` projections reduce to `Y'Y − Y'Z(Z'Z)⁻¹Z'Y` style closed forms on the small cross-product matrices. κ via 2×2 closed form or power iteration; β = (X'X − κ·X'M_Z X)⁻¹ (X'Y − κ·X'M_Z Y), all in JS on small matrices.

**Tech Stack:** DuckDB-Wasm 0.10 (jsDelivr CDN, lazy singleton), JavaScript matrix helpers from `LinearEngine.js` (`transpose`, `matMul`, `matInv`), eigenvalue helpers from existing `GMMEngine.js` (`limlKappa2x2`, `limlKappaPower`), validation against R `AER::ivreg(..., method="LIML")` and `gmm::gmm()` at 6/4-dp.

---

## File Structure

**Create:**
- `src/services/data/duckdbGMM.js` — `buildGMMSuffStats(tableName, yCol, xCols, wCols, zCols, opts)` returns the augmented `{n, sumY, YtY, XtX, XtY, ZtZ, ZtX, ZtY, varNames, instrNames}` shape (X is **all regressors** [intercept, wCols, xCols] matching `GMMEngine.js:65`; Z is **all instruments** [intercept, wCols, zCols] matching `GMMEngine.js:66`)
- `src/services/data/duckdbGMMOmega.js` — `computeGMMOmega({tableName, yCol, xCols, wCols, zCols, dummySQL, beta})` returns `{Omega, n}` where Omega = (1/n)Σ êᵢ² zᵢ zⱼ
- `src/math/GMMSuffStatsEngine.js` — `runGMMFromSuffStats({...suffStats, Omega})` returns an `EstimationResult`-shaped object with β_GMM + J-stat
- `src/services/data/duckdbLIML.js` — `buildLIMLSuffStats(tableName, yCol, xCols, wCols, zCols, opts)` returns `{n, sumY, YtY, YtX, YtZ, YtW, XtX, XtZ, XtW, ZtZ, ZtW, WtW, varNames}` (W = exogenous + intercept; X = full design)
- `src/math/LIMLSuffStatsEngine.js` — `runLIMLFromSuffStats({...suffStats})` returns an `EstimationResult`-shaped object with β_LIML + κ
- `src/services/data/__validation__/fase3bRValidation.R` — generates `fase3b_data.csv` + `fase3bBenchmarks.json` using `gmm::gmm()` and `AER::ivreg(..., method="LIML")`
- `src/services/data/__validation__/fase3bValidation.js` — `runFase3bNumericalValidation()` exposed at `window.__validation.fase3b`

**Modify:**
- `src/services/data/dispatchConfig.js:21` — add `"GMM"` and `"LIML"` to `SQL_SUPPORTED_ESTIMATORS`
- `src/services/data/duckdbDispatch.js` — generalize the `2SLS` operand guards to apply to `GMM` and `LIML` as well; restrict SE to `classical` for GMM/LIML
- `src/components/ModelingTab.jsx` — import GMM + LIML suff-stats helpers; add branches inside the `shouldUseSQLPath` try block
- `src/math/index.js` — re-export `runGMMFromSuffStats`, `runLIMLFromSuffStats`

---

## Task 1: Extend dispatcher to recognize GMM and LIML

**Files:**
- Modify: `src/services/data/dispatchConfig.js:21`
- Modify: `src/services/data/duckdbDispatch.js`

- [ ] **Step 1: Add GMM + LIML to supported estimators**

In `dispatchConfig.js`, replace `SQL_SUPPORTED_ESTIMATORS`:

```js
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS", "2SLS", "WLS", "GMM", "LIML"]);
```

(Assumes Fase 3c has already added `"WLS"`. If running Fase 3b before 3c, omit `"WLS"`.)

- [ ] **Step 2: Generalize 2SLS guards to GMM + LIML**

In `duckdbDispatch.js`, find the existing block:

```js
  if (ctx.estimator === "2SLS") {
    if (!Array.isArray(ctx.zVars) || ctx.zVars.length === 0) return false;
    ...
  }
```

Replace the opening line with:

```js
  if (["2SLS", "GMM", "LIML"].includes(ctx.estimator)) {
```

Then immediately **after** the closing `}` of that block, add a GMM/LIML-specific SE restriction:

```js
  if (["GMM", "LIML"].includes(ctx.estimator) && se !== "classical") return false;
```

(GMM 2-step efficient SE is already heteroskedasticity-robust via Ω̂; LIML HC variants deferred to a later sub-fase.)

- [ ] **Step 3: Verify via browser DevTools dispatcher introspection**

```js
const { shouldUseSQLPath } = await import("./services/data/duckdbDispatch.js");

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "GMM", seType: "classical", hasWeights: false,
  zVars: ["z1","z2"], xColsEndog: ["x1"], endogCount: 1,
})
// Expected: true

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1","x2"],
  estimator: "GMM", seType: "HC1", hasWeights: false,
  zVars: ["z1","z2"], xColsEndog: ["x1"], endogCount: 1,
})
// Expected: false  (HC1 not allowed for GMM in Fase 3b)

shouldUseSQLPath({
  tableName: "t", n: 100000, xColsExpanded: ["x1"],
  estimator: "LIML", seType: "classical", hasWeights: false,
  zVars: ["z1"], xColsEndog: ["x1"], endogCount: 1,
})
// Expected: true  (exactly identified — LIML = 2SLS in this case but path still valid)
```

- [ ] **Step 4: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/duckdbDispatch.js
git commit -m "feat(modeling): Fase 3b — dispatcher recognizes GMM and LIML"
```

---

## Task 2: `buildGMMSuffStats` — single-pass SQL aggregates

**Files:**
- Create: `src/services/data/duckdbGMM.js`

The shape mirrors `buildIVSuffStats` (Fase 3a) but with the **GMM convention** for X and Z: from `GMMEngine.js:64-66`:
```
X = [1, ...wCols, ...xCols]   (intercept + exogenous controls + endogenous)
Z = [1, ...wCols, ...zCols]   (intercept + exogenous controls + excluded instruments)
```

Caller (ModelingTab) passes flat `xCols` (endogenous) and `wCols` (exogenous controls); this helper assembles the full design + instrument matrices.

- [ ] **Step 1: Write the function**

```js
// ─── ECON STUDIO · src/services/data/duckdbGMM.js ─────────────────────────────
// GMM sufficient-statistics push-down.
//
// One SQL pass produces, with the GMMEngine convention
//     X = [1, ...wCols, ...xCols]    (full design)
//     Z = [1, ...wCols, ...zCols]    (full instruments)
//
//   n, sumY, Y'Y
//   X'X  (k+1)×(k+1)  symmetric
//   Z'Z  (l+1)×(l+1)  symmetric
//   Z'X  (l+1)×(k+1)
//   X'Y  (k+1)
//   Z'Y  (l+1)
//
// where k = wCols.length + xCols.length, l = wCols.length + zCols.length.
//
// Returned shape is consumed identically by run2SLSFromSuffStats (step 1 of GMM)
// and runGMMFromSuffStats (step 2). To match run2SLSFromSuffStats field names
// (which expects ZtZ, ZtX, XtX, ZtY, XtY, YtY, sumY, n, varNames), we keep the
// same keys but populate the "X" matrix with the full GMM-convention design.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {string}   tableName
 * @param {string}   yCol
 * @param {string[]} xCols       endogenous regressors
 * @param {string[]} wCols       exogenous controls
 * @param {string[]} zCols       excluded instruments
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL]
 * @returns {Promise<{
 *   n, sumY, YtY,
 *   XtX, ZtZ, ZtX, XtY, ZtY,
 *   varNames, instrNames,
 *   xColsAll, zColsAll,                // ordered without intercept; intercept is index 0
 * }>}
 */
export async function buildGMMSuffStats(tableName, yCol, xCols, wCols, zCols, opts = {}) {
  const { conn } = await getDuckDB();
  const xColsAll = [...wCols, ...xCols];   // exogenous first, endogenous last
  const zColsAll = [...wCols, ...zCols];
  const k = xColsAll.length;
  const l = zColsAll.length;
  if (k < 1) throw new Error("buildGMMSuffStats: need at least one regressor");
  if (l < 1) throw new Error("buildGMMSuffStats: need at least one instrument");
  if (zCols.length < xCols.length) {
    throw new Error("buildGMMSuffStats: under-identified (fewer instruments than endogenous)");
  }

  const dummySQL = opts.dummySQL ?? {};
  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xColsAll.map(colExpr);
  const zExprs = zColsAll.map(colExpr);

  const projections = [`${yExpr} AS _y_`];
  xExprs.forEach((e, i) => projections.push(`${e} AS _x_${i}`));
  zExprs.forEach((e, i) => projections.push(`${e} AS _z_${i}`));

  const finite = [`isfinite(_y_)`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);
  for (let i = 0; i < l; i++) finite.push(`isfinite(_z_${i})`);

  const aggs = [`COUNT(*) AS n`, `SUM(_y_) AS sum_y`, `SUM(_y_ * _y_) AS yty`];

  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
  }

  for (let i = 0; i < l; i++) aggs.push(`SUM(_z_${i}) AS sum_z_${i}`);
  for (let i = 0; i < l; i++) aggs.push(`SUM(_z_${i} * _y_) AS sum_zy_${i}`);
  for (let i = 0; i < l; i++) {
    for (let j = i; j < l; j++) aggs.push(`SUM(_z_${i} * _z_${j}) AS sum_zz_${i}_${j}`);
  }

  for (let i = 0; i < l; i++) {
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
  const lDim = l + 1;
  const XtX = Array.from({ length: kDim }, () => Array(kDim).fill(0));
  const ZtZ = Array.from({ length: lDim }, () => Array(lDim).fill(0));
  const ZtX = Array.from({ length: lDim }, () => Array(kDim).fill(0));
  const XtY = Array(kDim).fill(0);
  const ZtY = Array(lDim).fill(0);

  XtX[0][0] = n;  XtY[0] = sumY;
  for (let i = 0; i < k; i++) {
    const sx = num(r[`sum_x_${i}`]);
    XtX[0][i + 1] = sx;  XtX[i + 1][0] = sx;
    XtY[i + 1]    = num(r[`sum_xy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX[i + 1][j + 1] = v;
      if (i !== j) XtX[j + 1][i + 1] = v;
    }
  }

  ZtZ[0][0] = n;  ZtY[0] = sumY;
  for (let i = 0; i < l; i++) {
    const sz = num(r[`sum_z_${i}`]);
    ZtZ[0][i + 1] = sz;  ZtZ[i + 1][0] = sz;
    ZtY[i + 1]    = num(r[`sum_zy_${i}`]);
  }
  for (let i = 0; i < l; i++) {
    for (let j = i; j < l; j++) {
      const v = num(r[`sum_zz_${i}_${j}`]);
      ZtZ[i + 1][j + 1] = v;
      if (i !== j) ZtZ[j + 1][i + 1] = v;
    }
  }

  // ZtX: intercept row of Z = (1, ...) → ZtX[0][j] = X'·1 = (n, sum_x_{j-1})
  ZtX[0][0] = n;
  for (let j = 0; j < k; j++) ZtX[0][j + 1] = num(r[`sum_x_${j}`]);
  // intercept col of X = (1, ...) → ZtX[i+1][0] = sum_z_i
  for (let i = 0; i < l; i++) ZtX[i + 1][0] = num(r[`sum_z_${i}`]);
  for (let i = 0; i < l; i++) {
    for (let j = 0; j < k; j++) ZtX[i + 1][j + 1] = num(r[`sum_zx_${i}_${j}`]);
  }

  return {
    n, sumY, YtY,
    XtX, ZtZ, ZtX, XtY, ZtY,
    varNames:   ["(Intercept)", ...wCols, ...xCols],
    instrNames: ["(Intercept)", ...wCols, ...zCols],
    xColsAll, zColsAll,
  };
}
```

- [ ] **Step 2: Quick sanity smoke test in DevTools**

```js
const { buildGMMSuffStats } = await import("./services/data/duckdbGMM.js");
const r = await buildGMMSuffStats("fase3a_tbl", "y", ["x1"], ["x2"], ["z1","z2"]);
console.log(r);
// Expected: XtX 4×4 sym (intercept + x2 + x1 = 3 cols + 1 intercept), ZtZ 4×4 sym
// (intercept + x2 + z1 + z2), ZtX 4×4
```

- [ ] **Step 3: Commit**

```bash
git add src/services/data/duckdbGMM.js
git commit -m "feat(data): Fase 3b — GMM sufficient-statistics SQL pass"
```

---

## Task 3: `computeGMMOmega` — Ω̂ = (1/n)Σ êᵢ² zᵢ zⱼ in SQL

**Files:**
- Create: `src/services/data/duckdbGMMOmega.js`

This is structurally identical to `computeIVHCMeat` (Fase 3a) but with **z outer products** instead of x̂ outer products, and divided by n.

- [ ] **Step 1: Write the Omega builder**

```js
// ─── ECON STUDIO · src/services/data/duckdbGMMOmega.js ────────────────────────
// GMM step-2 weighting matrix in SQL.
//
//   Ω̂[a][b] = (1/n) Σ êᵢ² · zᵢ[a] · zᵢ[b]
//
// where êᵢ = yᵢ − xᵢ'β̂₁ uses 2SLS step-1 β.
//
// Parameters bound as prepared statements:
//   - β̂₁ (k+1) → consumed by residual

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
 * @param {string[]} args.xColsAll      [...wCols, ...xCols] in this order
 * @param {string[]} args.zColsAll      [...wCols, ...zCols] in this order
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta          β̂₁ from step-1 2SLS, length k+1
 * @returns {Promise<{ Omega: number[][], n: number }>}
 */
export async function computeGMMOmega({
  tableName, yCol, xColsAll, zColsAll, dummySQL = {}, beta,
}) {
  const { conn } = await getDuckDB();
  const k = xColsAll.length;
  const l = zColsAll.length;
  const lDim = l + 1;

  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xColsAll[i - 1]);
  const zExpr = (i) => i === 0 ? "1.0" : colExpr(zColsAll[i - 1]);
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const betaTerms = [];
  const betaParams = [];
  for (let i = 0; i < k + 1; i++) {
    betaTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const residSQL = `(${yExpr} - (${betaTerms.join(" + ")}))`;

  const aggs = ["COUNT(*) AS n"];
  for (let a = 0; a < lDim; a++) {
    for (let b = a; b < lDim; b++) {
      aggs.push(`SUM(POWER(${residSQL}, 2) * ${zExpr(a)} * ${zExpr(b)}) AS w_${a}_${b}`);
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);
  for (let i = 0; i < l; i++) finite.push(`isfinite(${zExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  const aggCount = (lDim * (lDim + 1)) / 2;
  const boundParams = [];
  for (let agg = 0; agg < aggCount; agg++) boundParams.push(...betaParams);

  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== aggCount) {
    throw new Error(`computeGMMOmega: residSQL occurrence mismatch (got ${residCount}, expected ${aggCount})`);
  }

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const n = num(r.n);
  const Omega = Array.from({ length: lDim }, () => Array(lDim).fill(0));
  for (let a = 0; a < lDim; a++) {
    for (let b = a; b < lDim; b++) {
      const v = num(r[`w_${a}_${b}`]) / n;     // (1/n) factor applied here
      Omega[a][b] = v;
      if (a !== b) Omega[b][a] = v;
    }
  }
  return { Omega, n };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbGMMOmega.js
git commit -m "feat(data): Fase 3b — GMM Ω̂ weighting matrix builder"
```

---

## Task 4: `runGMMFromSuffStats` — step-2 solver

**Files:**
- Create: `src/math/GMMSuffStatsEngine.js`
- Modify: `src/math/index.js` (export)

- [ ] **Step 1: Write the step-2 solver**

```js
// ─── ECON STUDIO · src/math/GMMSuffStatsEngine.js ─────────────────────────────
// Two-step efficient GMM solver, step 2, from sufficient statistics.
// No row materialization, no React.
//
// Inputs (from buildGMMSuffStats + computeGMMOmega + run2SLSFromSuffStats step 1):
//   XtX, ZtZ, ZtX, XtY, ZtY, YtY, sumY, n, varNames
//   Omega (l+1)×(l+1)  — step-2 weighting matrix
//
// Solve:
//   X'Z · Ω̂⁻¹ · Z'X         (k+1)×(k+1)
//   β̂₂ = inverse_of_above · X'Z · Ω̂⁻¹ · Z'Y
//   Var(β̂₂) = n · inverse_of_above        (matches GMMEngine.js:165 — AinvN = Ainv * n)
//
// J-stat = n · g'Ω̂⁻¹g  where g = Z'ê / n, ê = Y − Xβ̂₂
//   Σêᵢ²·zᵢ : derived from suff-stats? NO — need Z'ê, which is:
//     Z'ê = Z'Y − Z'X β̂₂                  ← entirely on small matrices

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";
import { normCDF } from "./NonLinearEngine.js";

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function vmul(M, v) { return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0)); }

function chiSqPval(chi2, df) {
  if (!isFinite(chi2) || df <= 0 || chi2 < 0) return NaN;
  if (chi2 === 0) return 1;
  const z = (Math.pow(chi2 / df, 1 / 3) - (1 - 2 / (9 * df))) /
            Math.sqrt(2 / (9 * df));
  return 1 - normCDF(z);
}

/**
 * @param {object} args
 * @param {number}     args.n
 * @param {number}     args.sumY
 * @param {number}     args.YtY
 * @param {number[][]} args.XtX
 * @param {number[][]} args.ZtZ
 * @param {number[][]} args.ZtX
 * @param {number[]}   args.XtY
 * @param {number[]}   args.ZtY
 * @param {number[][]} args.Omega        (l+1)×(l+1) weighting matrix
 * @param {string[]}   args.varNames
 * @param {number}     args.overidDf     l − k (Hansen J degrees of freedom)
 * @returns {object|null}
 */
export function runGMMFromSuffStats({
  n, sumY, YtY, XtX, ZtZ, ZtX, XtY, ZtY, Omega, varNames, overidDf,
}) {
  const k = XtX.length;            // (k+1)
  const OmegaInv = matInv(Omega);
  if (!OmegaInv) return null;

  // X'Z = transpose(Z'X)   (k+1)×(l+1)
  const XtZ = transpose(ZtX);
  // X'Z · Ω̂⁻¹  → (k+1)×(l+1)
  const XtZ_OI = matMul(XtZ, OmegaInv);
  // A = X'Z · Ω̂⁻¹ · Z'X   → (k+1)×(k+1)
  const A = matMul(XtZ_OI, ZtX);
  const Ainv = matInv(A);
  if (!Ainv) return null;

  // β = Ainv · (X'Z · Ω̂⁻¹ · Z'Y)
  const rhs = vmul(XtZ_OI, ZtY);
  const beta = vmul(Ainv, rhs);

  // SSR = Y'Y − 2β'X'Y + β'X'Xβ
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + beta.reduce((s, b, i) => s + b * vmul(XtX, beta)[i], 0);   // quadForm

  const df = n - k;

  // SE: Var(β̂) = n · Ainv   (matches GMMEngine.js:165)
  const se = Ainv.map((row, i) => Math.sqrt(Math.abs(row[i] * n)));
  const tStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  // J-stat: g = Z'ê / n; Z'ê = Z'Y − Z'X · β
  const ZtE = ZtY.map((v, i) => v - vmul(ZtX, beta)[i]);
  const g   = ZtE.map(v => v / n);
  const OIg = vmul(OmegaInv, g);
  const jStat = n * dot(g, OIg);
  const jPval = overidDf > 0 ? chiSqPval(jStat, overidDf) : NaN;

  // R²
  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    jStat, jPval, jDf: overidDf,
    SSR, ssr: SSR,
    varNames,
    XtXinv: Ainv,
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `src/math/index.js`, add below the existing `run2SLSFromSuffStats` re-export:

```js
export { runGMMFromSuffStats } from "./GMMSuffStatsEngine.js";
```

- [ ] **Step 3: Hand-verify against tiny case in DevTools**

Use the existing `fase3a_data.csv` (already in DuckDB after the Fase 3a smoke test). Compute β via the suff-stats GMM path and via `runGMM` on the same materialized rows. β should match within 1e-8; J-stat within 1e-6.

- [ ] **Step 4: Commit**

```bash
git add src/math/GMMSuffStatsEngine.js src/math/index.js
git commit -m "feat(math): Fase 3b — runGMMFromSuffStats two-step solver"
```

---

## Task 5: `buildLIMLSuffStats` — single-pass SQL aggregates for LIML

**Files:**
- Create: `src/services/data/duckdbLIML.js`

LIML needs more cross-product matrices than GMM because of the two projection operators M_Z and M_W. The closed-form derivations:

```
Y' M_Z Y = Y'Y − Y'Z (Z'Z)⁻¹ Z'Y
X' M_Z X = X'X − X'Z (Z'Z)⁻¹ Z'X         (X is full design)
X' M_Z Y = X'Y − X'Z (Z'Z)⁻¹ Z'Y
Y' M_W Y = Y'Y − Y'W (W'W)⁻¹ W'Y         (W = [1, exog])
X' M_W X = X'X − X'W (W'W)⁻¹ W'X
X' M_W Y = X'Y − X'W (W'W)⁻¹ W'Y
```

So in one SQL pass we need: Y'Y, Y'Z, Y'X, Y'W, Z'Z, Z'X, Z'W, X'X, X'W, W'W.

To match `runLIML` in `GMMEngine.js:206-306`:
- `X` = `[1, ...wCols, ...xCols]` (full design, intercept + exogenous + endogenous)
- `Z` = `[1, ...wCols, ...zCols]` (full instrument set)
- `W` = `[1, ...wCols]` (exogenous controls + intercept, internal name `Wn` in GMMEngine)

- [ ] **Step 1: Write the function**

```js
// ─── ECON STUDIO · src/services/data/duckdbLIML.js ────────────────────────────
// LIML sufficient-statistics push-down.
//
// One SQL pass produces all cross-products needed to assemble the (m×m)
// generalized-eigenvalue matrices A = [Y,X_endo]' M_Z [Y,X_endo] and
// B = [Y,X_endo]' M_W [Y,X_endo] from closed forms on small matrices:
//
//   v' M_Z u = v'u − v'Z (Z'Z)⁻¹ Z'u
//   v' M_W u = v'u − v'W (W'W)⁻¹ W'u
//
// Conventions match GMMEngine.runLIML:
//   X = [1, ...wCols, ...xCols]   (full design)
//   Z = [1, ...wCols, ...zCols]   (full instruments)
//   W = [1, ...wCols]             (exogenous + intercept)
//
// Returned cross-products use full matrices; m×m sub-blocks for the LIML
// eigenvalue problem are extracted in the engine.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {string}   tableName
 * @param {string}   yCol
 * @param {string[]} xCols       endogenous regressors
 * @param {string[]} wCols       exogenous controls
 * @param {string[]} zCols       excluded instruments
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL]
 * @returns {Promise<{
 *   n, sumY, YtY,
 *   XtX, ZtZ, WtW,
 *   ZtX, WtX,
 *   ZtW,                                           // (l+1)×(w+1)
 *   XtY, ZtY, WtY,
 *   varNames, instrNames, exogNames,
 *   xColsAll, zColsAll, wColsAll, endoIdx,         // endoIdx: column indices in X that are endogenous
 * }>}
 */
export async function buildLIMLSuffStats(tableName, yCol, xCols, wCols, zCols, opts = {}) {
  const { conn } = await getDuckDB();
  const xColsAll = [...wCols, ...xCols];
  const zColsAll = [...wCols, ...zCols];
  const wColsAll = [...wCols];
  const k = xColsAll.length;
  const l = zColsAll.length;
  const w = wColsAll.length;
  if (k < 1) throw new Error("buildLIMLSuffStats: need at least one regressor");
  if (l < 1) throw new Error("buildLIMLSuffStats: need at least one instrument");
  if (zCols.length < xCols.length) {
    throw new Error("buildLIMLSuffStats: under-identified (fewer instruments than endogenous)");
  }

  const dummySQL = opts.dummySQL ?? {};
  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const xExprs = xColsAll.map(colExpr);
  const zExprs = zColsAll.map(colExpr);
  const wExprs = wColsAll.map(colExpr);

  const projections = [`${yExpr} AS _y_`];
  xExprs.forEach((e, i) => projections.push(`${e} AS _x_${i}`));
  zExprs.forEach((e, i) => projections.push(`${e} AS _z_${i}`));
  // Note: wColsAll columns are also present in xColsAll[0..w-1] and zColsAll[0..w-1].
  // We re-project them under _w_i aliases to keep the W-block aggregates explicit
  // and avoid index arithmetic against xColsAll inside the meat builder.
  wExprs.forEach((e, i) => projections.push(`${e} AS _w_${i}`));

  const finite = [`isfinite(_y_)`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(_x_${i})`);
  for (let i = 0; i < l; i++) finite.push(`isfinite(_z_${i})`);

  const aggs = [`COUNT(*) AS n`, `SUM(_y_) AS sum_y`, `SUM(_y_ * _y_) AS yty`];

  // X-block (mirrors buildGMMSuffStats)
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
  }

  // Z-block
  for (let i = 0; i < l; i++) aggs.push(`SUM(_z_${i}) AS sum_z_${i}`);
  for (let i = 0; i < l; i++) aggs.push(`SUM(_z_${i} * _y_) AS sum_zy_${i}`);
  for (let i = 0; i < l; i++) {
    for (let j = i; j < l; j++) aggs.push(`SUM(_z_${i} * _z_${j}) AS sum_zz_${i}_${j}`);
  }

  // W-block
  for (let i = 0; i < w; i++) aggs.push(`SUM(_w_${i}) AS sum_w_${i}`);
  for (let i = 0; i < w; i++) aggs.push(`SUM(_w_${i} * _y_) AS sum_wy_${i}`);
  for (let i = 0; i < w; i++) {
    for (let j = i; j < w; j++) aggs.push(`SUM(_w_${i} * _w_${j}) AS sum_ww_${i}_${j}`);
  }

  // Z'X full grid
  for (let i = 0; i < l; i++) {
    for (let j = 0; j < k; j++) aggs.push(`SUM(_z_${i} * _x_${j}) AS sum_zx_${i}_${j}`);
  }
  // W'X full grid
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < k; j++) aggs.push(`SUM(_w_${i} * _x_${j}) AS sum_wx_${i}_${j}`);
  }
  // Z'W full grid
  for (let i = 0; i < l; i++) {
    for (let j = 0; j < w; j++) aggs.push(`SUM(_z_${i} * _w_${j}) AS sum_zw_${i}_${j}`);
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
  const lDim = l + 1;
  const wDim = w + 1;

  function newMat(rows, cols) { return Array.from({ length: rows }, () => Array(cols).fill(0)); }

  const XtX = newMat(kDim, kDim);
  const ZtZ = newMat(lDim, lDim);
  const WtW = newMat(wDim, wDim);
  const ZtX = newMat(lDim, kDim);
  const WtX = newMat(wDim, kDim);
  const ZtW = newMat(lDim, wDim);
  const XtY = Array(kDim).fill(0);
  const ZtY = Array(lDim).fill(0);
  const WtY = Array(wDim).fill(0);

  // X'X
  XtX[0][0] = n;  XtY[0] = sumY;
  for (let i = 0; i < k; i++) {
    const sx = num(r[`sum_x_${i}`]);
    XtX[0][i + 1] = sx;  XtX[i + 1][0] = sx;
    XtY[i + 1] = num(r[`sum_xy_${i}`]);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX[i + 1][j + 1] = v;
      if (i !== j) XtX[j + 1][i + 1] = v;
    }
  }

  // Z'Z
  ZtZ[0][0] = n;  ZtY[0] = sumY;
  for (let i = 0; i < l; i++) {
    const sz = num(r[`sum_z_${i}`]);
    ZtZ[0][i + 1] = sz;  ZtZ[i + 1][0] = sz;
    ZtY[i + 1] = num(r[`sum_zy_${i}`]);
  }
  for (let i = 0; i < l; i++) {
    for (let j = i; j < l; j++) {
      const v = num(r[`sum_zz_${i}_${j}`]);
      ZtZ[i + 1][j + 1] = v;
      if (i !== j) ZtZ[j + 1][i + 1] = v;
    }
  }

  // W'W
  WtW[0][0] = n;  WtY[0] = sumY;
  for (let i = 0; i < w; i++) {
    const sw = num(r[`sum_w_${i}`]);
    WtW[0][i + 1] = sw;  WtW[i + 1][0] = sw;
    WtY[i + 1] = num(r[`sum_wy_${i}`]);
  }
  for (let i = 0; i < w; i++) {
    for (let j = i; j < w; j++) {
      const v = num(r[`sum_ww_${i}_${j}`]);
      WtW[i + 1][j + 1] = v;
      if (i !== j) WtW[j + 1][i + 1] = v;
    }
  }

  // Z'X
  ZtX[0][0] = n;
  for (let j = 0; j < k; j++) ZtX[0][j + 1] = num(r[`sum_x_${j}`]);
  for (let i = 0; i < l; i++) ZtX[i + 1][0] = num(r[`sum_z_${i}`]);
  for (let i = 0; i < l; i++) {
    for (let j = 0; j < k; j++) ZtX[i + 1][j + 1] = num(r[`sum_zx_${i}_${j}`]);
  }

  // W'X
  WtX[0][0] = n;
  for (let j = 0; j < k; j++) WtX[0][j + 1] = num(r[`sum_x_${j}`]);
  for (let i = 0; i < w; i++) WtX[i + 1][0] = num(r[`sum_w_${i}`]);
  for (let i = 0; i < w; i++) {
    for (let j = 0; j < k; j++) WtX[i + 1][j + 1] = num(r[`sum_wx_${i}_${j}`]);
  }

  // Z'W
  ZtW[0][0] = n;
  for (let j = 0; j < w; j++) ZtW[0][j + 1] = num(r[`sum_w_${j}`]);
  for (let i = 0; i < l; i++) ZtW[i + 1][0] = num(r[`sum_z_${i}`]);
  for (let i = 0; i < l; i++) {
    for (let j = 0; j < w; j++) ZtW[i + 1][j + 1] = num(r[`sum_zw_${i}_${j}`]);
  }

  // endoIdx: positions within X (1-indexed past intercept) of the endogenous columns
  // Layout of xColsAll: [w_0, ..., w_{w-1}, x_0, ..., x_{xCols.length-1}]
  // Intercept is index 0 in X, so endogenous run from w+1 .. k inclusive.
  const endoIdx = [];
  for (let i = 0; i < xCols.length; i++) endoIdx.push(w + 1 + i);

  return {
    n, sumY, YtY,
    XtX, ZtZ, WtW,
    ZtX, WtX, ZtW,
    XtY, ZtY, WtY,
    varNames:   ["(Intercept)", ...wCols, ...xCols],
    instrNames: ["(Intercept)", ...wCols, ...zCols],
    exogNames:  ["(Intercept)", ...wCols],
    xColsAll, zColsAll, wColsAll, endoIdx,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/services/data/duckdbLIML.js
git commit -m "feat(data): Fase 3b — LIML sufficient-statistics SQL pass"
```

---

## Task 6: `runLIMLFromSuffStats` — eigenvalue solver

**Files:**
- Create: `src/math/LIMLSuffStatsEngine.js`
- Modify: `src/math/index.js` (export)

- [ ] **Step 1: Write the solver**

The κ eigenvalue helpers (`limlKappa2x2`, `limlKappaPower`) already exist in `GMMEngine.js`. We import them here.

```js
// ─── ECON STUDIO · src/math/LIMLSuffStatsEngine.js ────────────────────────────
// LIML solver from sufficient statistics. No row materialization, no React.
//
// Builds the m×m generalized-eigenvalue matrices entirely on small cross-product
// matrices via the closed forms:
//   v' M_Z u  = v'u − v'Z (Z'Z)⁻¹ Z'u
//   v' M_W u  = v'u − v'W (W'W)⁻¹ W'u
//
// Then κ = min eigenvalue of A⁻¹B (same as GMMEngine.runLIML), and
//   β = (X'X − κ·X'M_Z X)⁻¹ · (X'Y − κ·X'M_Z Y).
//
// SE: σ̂² · (X'P_Z X)⁻¹ where  X'P_Z X = X'X − X'M_Z X.

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";
import { limlKappa2x2, limlKappaPower } from "./GMMEngine.js";  // re-use existing helpers

function vmul(M, v) { return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0)); }
function dot(a, b)  { return a.reduce((s, v, i) => s + v * b[i], 0); }

// Build m×m matrix [v_0, v_1, ..., v_{m-1}]' P [v_0, v_1, ..., v_{m-1}]
// for projection P = M_Z (i.e. subtract Z(Z'Z)⁻¹Z' from identity).
// Inputs are the cross-products of v_a with Z (and with each other).
// All vectors are columns of a virtual matrix V; only the bilinear forms
// V'Z, V'V exist as sufficient-statistics matrices.
function mProjForms(VtV, VtZ, ZtZinv) {
  // Returns (m×m) [v_a · M v_b] = VtV[a][b] − (V'Z)[a] · (Z'Z)⁻¹ · (Z'V)[b]
  const m = VtV.length;
  const VtZi = matMul(VtZ, ZtZinv);            // (m × (l+1))
  const ZtV  = transpose(VtZ);                  // ((l+1) × m)
  const sub  = matMul(VtZi, ZtV);              // (m × m)
  return VtV.map((row, i) => row.map((v, j) => v - sub[i][j]));
}

/**
 * @param {object} args  — output of buildLIMLSuffStats plus optionally `meat`/`hcType` (deferred)
 * @returns {object|null}
 */
export function runLIMLFromSuffStats({
  n, sumY, YtY,
  XtX, ZtZ, WtW,
  ZtX, WtX, ZtW,
  XtY, ZtY, WtY,
  varNames, endoIdx,
}) {
  const k = XtX.length;
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return null;
  const WtWinv = matInv(WtW);
  if (!WtWinv) return null;

  // ── Build the m×m vector set V = [Y, X_endo] ────────────────────────────────
  // The bilinear forms V'V, V'Z, V'W are extracted from the suff-stats matrices.
  // Index 0 = Y; indices 1..m-1 = X[endoIdx[j-1]] for j=1..m-1.
  const endo = endoIdx;
  const m = 1 + endo.length;

  // V'V
  const VtV = Array.from({ length: m }, () => Array(m).fill(0));
  // V[0]·V[0] = Y'Y
  VtV[0][0] = YtY;
  // V[0]·V[j] = X_endo[j-1]' Y = XtY[endo[j-1]]
  for (let j = 1; j < m; j++) {
    VtV[0][j] = XtY[endo[j - 1]];
    VtV[j][0] = XtY[endo[j - 1]];
  }
  // V[i]·V[j] = X_endo[i-1]' X_endo[j-1] = XtX[endo[i-1]][endo[j-1]]
  for (let i = 1; i < m; i++) {
    for (let j = 1; j < m; j++) {
      VtV[i][j] = XtX[endo[i - 1]][endo[j - 1]];
    }
  }

  // V'Z (m × l+1):  V[0]·Z = Z'Y' = ZtY' as row; V[i]·Z = X_endo' Z
  const lDim = ZtZ.length;
  const VtZ = Array.from({ length: m }, () => Array(lDim).fill(0));
  for (let p = 0; p < lDim; p++) {
    VtZ[0][p] = ZtY[p];   // by symmetry Y'Z = (Z'Y)
    for (let j = 1; j < m; j++) {
      VtZ[j][p] = ZtX[p][endo[j - 1]];  // X_endo[j-1] · Z[p] = (Z'X)[p][endo[j-1]]
    }
  }

  // V'W (m × w+1)
  const wDim = WtW.length;
  const VtW = Array.from({ length: m }, () => Array(wDim).fill(0));
  for (let p = 0; p < wDim; p++) {
    VtW[0][p] = WtY[p];
    for (let j = 1; j < m; j++) {
      VtW[j][p] = WtX[p][endo[j - 1]];
    }
  }

  // A = V' M_Z V = V'V − (V'Z)(Z'Z)⁻¹(Z'V)
  const A = mProjForms(VtV, VtZ, ZtZinv);
  // B = V' M_W V = V'V − (V'W)(W'W)⁻¹(W'V)
  const B = mProjForms(VtV, VtW, WtWinv);

  // κ = min eigenvalue of A⁻¹B
  const kappa = m === 2 ? limlKappa2x2(A, B) : limlKappaPower(A, B, m);
  if (!isFinite(kappa)) return null;

  // β_LIML = (X'X − κ·X'M_Z X)⁻¹ (X'Y − κ·X'M_Z Y)
  // X'M_Z X = XtX − (X'Z)(Z'Z)⁻¹(Z'X)
  const XtZ = transpose(ZtX);
  const XtZ_ZtZi = matMul(XtZ, ZtZinv);
  const XtMzX = XtX.map((row, i) => row.map((v, j) => v - dot(XtZ_ZtZi[i], ZtX.map(r => r[j]))));
  // X'M_Z Y = XtY − (X'Z)(Z'Z)⁻¹ Z'Y
  const XtMzY = XtY.map((v, i) => v - dot(XtZ_ZtZi[i], ZtY));

  const lhsMat = XtX.map((row, i) => row.map((v, j) => v - kappa * XtMzX[i][j]));
  const lhsInv = matInv(lhsMat);
  if (!lhsInv) return null;
  const rhsVec = XtY.map((v, i) => v - kappa * XtMzY[i]);
  const beta   = vmul(lhsInv, rhsVec);

  // Classical SE: σ̂² · (X'P_Z X)⁻¹ where X'P_Z X = X'X − X'M_Z X
  const XtPzX  = XtX.map((row, i) => row.map((v, j) => v - XtMzX[i][j]));
  const XtPzXi = matInv(XtPzX);
  if (!XtPzXi) return null;

  // SSR = Y'Y − 2β'X'Y + β'X'Xβ
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + beta.reduce((s, b, i) => s + b * vmul(XtX, beta)[i], 0);
  const df = n - k;
  const s2 = SSR / Math.max(1, df);

  const se = XtPzXi.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    kappa, SSR, ssr: SSR, s2,
    varNames,
    XtXinv: XtPzXi,
  };
}
```

- [ ] **Step 2: Export from the barrel**

In `src/math/index.js`, add:

```js
export { runLIMLFromSuffStats } from "./LIMLSuffStatsEngine.js";
```

- [ ] **Step 3: Hand-verify against a tiny case in DevTools**

Use the existing `fase3a_data.csv`. Compute β via the suff-stats LIML path and via `runLIML` on the same materialized rows. β and κ should match within 1e-8.

- [ ] **Step 4: Commit**

```bash
git add src/math/LIMLSuffStatsEngine.js src/math/index.js
git commit -m "feat(math): Fase 3b — runLIMLFromSuffStats eigenvalue solver"
```

---

## Task 7: Wire GMM + LIML SQL branches into ModelingTab

**Files:**
- Modify: `src/components/ModelingTab.jsx`

- [ ] **Step 1: Add imports**

Near the existing `import { buildIVSuffStats } from "../services/data/duckdbIV.js";` line, add:

```js
import { buildGMMSuffStats }    from "../services/data/duckdbGMM.js";
import { computeGMMOmega }      from "../services/data/duckdbGMMOmega.js";
import { buildLIMLSuffStats }   from "../services/data/duckdbLIML.js";
import { runGMMFromSuffStats }  from "../math/index.js";
import { runLIMLFromSuffStats } from "../math/index.js";
```

- [ ] **Step 2: Add GMM branch inside the SQL try block**

After the existing 2SLS branch (and after the WLS branch, if Fase 3c shipped), add:

```js
          if (model === "GMM") {
            if (seTypeNorm !== "classical") {
              throw new Error(`GMM SQL path only supports classical SE in Fase 3b (got ${seTypeNorm}) — fallback to JS`);
            }
            const { xColsExpanded: wExp, dummySQL: wDummy } = await expandFactors({ xCols: wVars, tableName: duckTable });
            const { xColsExpanded: xExp, dummySQL: xDummy } = await expandFactors({ xCols: xVars, tableName: duckTable });
            const { xColsExpanded: zExp, dummySQL: zDummy } = await expandFactors({ xCols: zVars, tableName: duckTable });
            const dummySQL = { ...wDummy, ...xDummy, ...zDummy };

            // Recheck dimensions post-expansion
            const totalK = wExp.length + xExp.length + zExp.length;
            if (totalK > 100) {                                    // K_THRESHOLD
              throw new Error("Post-expansion (w+x+z) exceeds threshold — fallback to JS");
            }

            const ss = await measure(() => buildGMMSuffStats(duckTable, yVar[0], xExp, wExp, zExp, { dummySQL }));
            logEstimate({ path: "sql", phase: "gmmSuffStats", n: rowCount, k: ss.result.xColsAll.length, msTotal: ss.ms });

            // Step 1: 2SLS β̂₁ using same suff stats (uses ZtZ, ZtX, XtX, ZtY, XtY)
            const step1 = run2SLSFromSuffStats({ ...ss.result, meat: null, hcType: null });
            if (!step1) throw new Error("GMM step-1 (2SLS) returned null (singular)");

            // Step 2: Ω̂
            const om = await measure(() => computeGMMOmega({
              tableName: duckTable, yCol: yVar[0],
              xColsAll: ss.result.xColsAll, zColsAll: ss.result.zColsAll, dummySQL,
              beta: step1.beta,
            }));
            logEstimate({ path: "sql", phase: "gmmOmega", n: rowCount, k: ss.result.xColsAll.length, msTotal: om.ms });

            const overidDf = zVars.length - xVars.length;
            const step2 = runGMMFromSuffStats({ ...ss.result, Omega: om.result.Omega, overidDf });
            if (!step2) throw new Error("GMM step-2 returned null (singular Ω̂)");

            const res = wrapResult("GMM", step2, { yVar: yVar[0], xVars, wVars, zVars });
            return { result: res, panelFE: null, panelFD: null };
          }

          if (model === "LIML") {
            if (seTypeNorm !== "classical") {
              throw new Error(`LIML SQL path only supports classical SE in Fase 3b (got ${seTypeNorm}) — fallback to JS`);
            }
            const { xColsExpanded: wExp, dummySQL: wDummy } = await expandFactors({ xCols: wVars, tableName: duckTable });
            const { xColsExpanded: xExp, dummySQL: xDummy } = await expandFactors({ xCols: xVars, tableName: duckTable });
            const { xColsExpanded: zExp, dummySQL: zDummy } = await expandFactors({ xCols: zVars, tableName: duckTable });
            const dummySQL = { ...wDummy, ...xDummy, ...zDummy };

            if (wExp.length + xExp.length + zExp.length > 100) {
              throw new Error("Post-expansion (w+x+z) exceeds threshold — fallback to JS");
            }

            const ss = await measure(() => buildLIMLSuffStats(duckTable, yVar[0], xExp, wExp, zExp, { dummySQL }));
            logEstimate({ path: "sql", phase: "limlSuffStats", n: rowCount, k: ss.result.xColsAll.length, msTotal: ss.ms });

            const r = runLIMLFromSuffStats({ ...ss.result });
            if (!r) throw new Error("LIML solve returned null (singular Z'Z, W'W, or eigenvalue failure)");

            const res = wrapResult("LIML", r, { yVar: yVar[0], xVars, wVars, zVars });
            return { result: res, panelFE: null, panelFD: null };
          }
```

- [ ] **Step 3: Manually test**

Open the app, load `fase3a_data.csv` into DuckDB, choose model = GMM, then LIML. Verify β matches `runGMM` and `runLIML` respectively on the same data within 1e-8.

- [ ] **Step 4: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "feat(modeling): Fase 3b — GMM + LIML SQL fast paths (classical SE)"
```

---

## Task 8: R validation script

**Files:**
- Create: `src/services/data/__validation__/fase3bRValidation.R`

- [ ] **Step 1: Write the R script**

```r
# fase3bRValidation.R — generates fase3b_data.csv and fase3bBenchmarks.json
# Run from project root:  Rscript src/services/data/__validation__/fase3bRValidation.R
#
# Reuse the Fase 3a DGP (1 endogenous regressor, 2 instruments, 1 exogenous control)
# so GMM/LIML output can be cross-checked against AER::ivreg (LIML) and gmm::gmm().
#
# DGP:  y = β0 + β1·x1 + β2·x2 + u
#       x1 = π0 + π1·z1 + π2·z2 + v        (endogenous: corr(u,v) = 0.5)
#       z1, z2, x2 exogenous
#
# n = 10,000.

suppressPackageStartupMessages({
  library(AER)
  library(gmm)
  library(jsonlite)
})

set.seed(20260521)
n <- 10000

z1 <- rnorm(n)
z2 <- rnorm(n)
x2 <- rnorm(n)
e  <- matrix(rnorm(2 * n), n, 2) %*% chol(matrix(c(1, 0.5, 0.5, 1), 2, 2))
v  <- e[, 1]
u  <- e[, 2]
x1 <- 0.5 + 0.8 * z1 + 0.6 * z2 + v
y  <- 1.0 + 2.0 * x1 + (-0.5) * x2 + u

df <- data.frame(y, x1, x2, z1, z2)
out_csv <- file.path("src", "services", "data", "__validation__", "fase3b_data.csv")
write.csv(df, out_csv, row.names = FALSE)

# ── LIML ────────────────────────────────────────────────────────────────────
# AER::ivreg(..., method = "LIML") returns kappa internally via summary()
fit_liml <- ivreg(y ~ x1 + x2 | z1 + z2 + x2, data = df, method = "LIML")
co_liml  <- coef(fit_liml)
se_liml  <- sqrt(diag(vcov(fit_liml)))

# κ from the LIML fit (stored in fit$kappa)
kappa_liml <- fit_liml$kappa
if (is.null(kappa_liml)) kappa_liml <- summary(fit_liml)$kappa
if (is.null(kappa_liml)) kappa_liml <- NA_real_

# ── GMM (two-step efficient) ────────────────────────────────────────────────
# Moment conditions: g(β, data) = Z * (y − Xβ) where X = [1, x2, x1], Z = [1, x2, z1, z2]
gmm_fit <- gmm(y ~ x1 + x2, ~ z1 + z2 + x2, data = df, type = "twoStep")
co_gmm  <- coef(gmm_fit)
se_gmm  <- sqrt(diag(vcov(gmm_fit)))
j_gmm   <- specTest(gmm_fit)$test[1, 1]
j_pval  <- specTest(gmm_fit)$test[1, 2]
j_df    <- specTest(gmm_fit)$test[1, 3]

# AER::ivreg coef order: (Intercept), x1, x2
# gmm::gmm coef order:    (Intercept), x1, x2     — verify with names()
bench <- list(
  n = n,
  varNames = c("(Intercept)", "x1", "x2"),
  liml_beta  = unname(co_liml),
  liml_se    = unname(se_liml),
  liml_kappa = kappa_liml,
  gmm_beta   = unname(co_gmm),
  gmm_se     = unname(se_gmm),
  gmm_jStat  = j_gmm,
  gmm_jPval  = j_pval,
  gmm_jDf    = j_df
)
out_json <- file.path("src", "services", "data", "__validation__", "fase3bBenchmarks.json")
write_json(bench, out_json, auto_unbox = TRUE, digits = 10)

cat("Wrote", out_csv, "and", out_json, "\n")
```

- [ ] **Step 2: Run it locally**

```bash
Rscript src/services/data/__validation__/fase3bRValidation.R
```

Expected output: two files written, console confirmation. If `gmm` or `AER` packages are missing, install with `install.packages(c("gmm", "AER"))`.

- [ ] **Step 3: Commit**

```bash
git add src/services/data/__validation__/fase3bRValidation.R \
        src/services/data/__validation__/fase3bBenchmarks.json \
        src/services/data/__validation__/fase3b_data.csv
git commit -m "test(data): Fase 3b — R gmm::gmm + AER::ivreg(LIML) golden values"
```

---

## Task 9: Browser validation harness

**Files:**
- Create: `src/services/data/__validation__/fase3bValidation.js`

- [ ] **Step 1: Write the harness**

```js
// ─── ECON STUDIO · src/services/data/__validation__/fase3bValidation.js ───────
// Loads fase3b_data.csv into DuckDB, runs the SQL path's GMM and LIML, and
// compares against fase3bBenchmarks.json.
// Exposed at window.__validation.fase3b — call from DevTools.

import { getDuckDB }            from "../duckdb.js";
import { buildGMMSuffStats }    from "../duckdbGMM.js";
import { computeGMMOmega }      from "../duckdbGMMOmega.js";
import { buildLIMLSuffStats }   from "../duckdbLIML.js";
import { runGMMFromSuffStats }  from "../../../math/GMMSuffStatsEngine.js";
import { runLIMLFromSuffStats } from "../../../math/LIMLSuffStatsEngine.js";
import { run2SLSFromSuffStats } from "../../../math/IV2SLSEngine.js";
import bench from "./fase3bBenchmarks.json";

const close = (a, b, tol) => Math.abs(a - b) <= tol;
const close6 = (a, b) => close(a, b, 1e-6);
const close4 = (a, b) => close(a, b, 1e-4);

async function loadCSV() {
  const { db, conn } = await getDuckDB();
  const url = new URL("./fase3b_data.csv", import.meta.url).href;
  const resp = await fetch(url);
  const text = await resp.text();
  await db.registerFileText("fase3b.csv", text);
  await conn.query(`DROP TABLE IF EXISTS fase3b_tbl`);
  await conn.query(`CREATE TABLE fase3b_tbl AS SELECT * FROM read_csv_auto('fase3b.csv')`);
  return "fase3b_tbl";
}

export async function runFase3bNumericalValidation() {
  const table = await loadCSV();
  const results = [];

  // ── LIML ─────────────────────────────────────────────────────────────────
  const ssL = await buildLIMLSuffStats(table, "y", ["x1"], ["x2"], ["z1", "z2"], {});
  const rL  = runLIMLFromSuffStats(ssL);

  // varNames order from LIML SS = ["(Intercept)", "x2", "x1"]
  // Bench order = ["(Intercept)", "x1", "x2"] — remap explicitly.
  const ssLOrderLookup = { "(Intercept)": 0, "x2": 1, "x1": 2 };
  for (const [name, benchIdx] of [["(Intercept)", 0], ["x1", 1], ["x2", 2]]) {
    const ssIdx = ssLOrderLookup[name];
    results.push([`liml_beta[${name}]`, rL.beta[ssIdx], bench.liml_beta[benchIdx], close6]);
    results.push([`liml_se[${name}]`,   rL.se[ssIdx],   bench.liml_se[benchIdx],   close4]);
  }
  results.push(["liml_kappa", rL.kappa, bench.liml_kappa, close6]);

  // ── GMM (2-step) ─────────────────────────────────────────────────────────
  const ssG  = await buildGMMSuffStats(table, "y", ["x1"], ["x2"], ["z1", "z2"], {});
  const step1 = run2SLSFromSuffStats({ ...ssG, meat: null, hcType: null });
  const omega = (await computeGMMOmega({
    tableName: table, yCol: "y",
    xColsAll: ssG.xColsAll, zColsAll: ssG.zColsAll,
    beta: step1.beta,
  })).Omega;
  const rG = runGMMFromSuffStats({ ...ssG, Omega: omega, overidDf: 1 });

  for (const [name, benchIdx] of [["(Intercept)", 0], ["x1", 1], ["x2", 2]]) {
    const ssIdx = ssLOrderLookup[name];
    results.push([`gmm_beta[${name}]`, rG.beta[ssIdx], bench.gmm_beta[benchIdx], close6]);
    results.push([`gmm_se[${name}]`,   rG.se[ssIdx],   bench.gmm_se[benchIdx],   close4]);
  }
  results.push(["gmm_jStat", rG.jStat, bench.gmm_jStat, close4]);

  const failures = [];
  results.forEach(([name, got, want, fn]) => {
    const ok = fn(got, want);
    if (!ok) failures.push({ name, got, want });
    console.log(`${ok ? "✓" : "✗"} ${name}: got ${got}, want ${want}`);
  });
  console.log(failures.length === 0
    ? `Fase 3b validation PASSED (${results.length}/${results.length})`
    : `Fase 3b validation FAILED (${failures.length} mismatches)`);
  return { results, failures };
}

if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.fase3b = runFase3bNumericalValidation;
}
```

- [ ] **Step 2: Import the harness from the validation barrel**

Find where `fase3aValidation.js` is imported (likely in `App.jsx` or a `__validation__/index.js` barrel). Add a sibling import:

```js
import "./services/data/__validation__/fase3bValidation.js";
```

- [ ] **Step 3: Run in the browser**

```js
await window.__validation.fase3b()
// Expected: all checks pass; "Fase 3b validation PASSED"
```

If LIML κ is off, double-check the eigenvalue solver path (`m === 2` → `limlKappa2x2`, else power iteration) and that `endoIdx` correctly identifies the endogenous columns within `xColsAll`.

- [ ] **Step 4: Commit**

```bash
git add src/services/data/__validation__/fase3bValidation.js \
        <wherever-it-is-imported>
git commit -m "test(modeling): Fase 3b — browser harness vs R GMM + LIML golden values"
```

---

## Task 10: Update CLAUDE.md + design doc

**Files:**
- Modify: `CLAUDE.md` (Pending item 2a — append Fase 3b)
- Modify: `docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md` (status line + Fase 3 section)

- [ ] **Step 1: Update design doc status line**

Replace the existing top-of-document status line with:
```
Fase 0 + Fase 1 + Fase 2 DONE (2026-05-20). Fase 3 (3a 2SLS + 3b GMM/LIML + 3c WLS) DONE (2026-05-21). Fases 4–7 pending.
```

(If Fase 3c hasn't shipped yet when this plan runs, replace with the appropriate Fase 3 partial status.)

- [ ] **Step 2: Append a Fase 3b note to the Fase 3 section**

Below the existing Fase 3a / Fase 3c status blocks, add:

```md
**Fase 3b status (2026-05-21):** GMM (two-step efficient) + LIML implemented, classical SE only.
  - `duckdbGMM.js` buildGMMSuffStats — single SQL pass producing X'X, Z'Z, Z'X, X'Y, Z'Y, Y'Y over the full GMM design (X = [1, wCols, xCols]; Z = [1, wCols, zCols]).
  - `duckdbGMMOmega.js` computeGMMOmega — (1/n)·Σ êᵢ² zᵢ zⱼ in SQL with β̂₁ as prepared params.
  - `GMMSuffStatsEngine.js` runGMMFromSuffStats — step-2 solve β = (X'Z Ω̂⁻¹ Z'X)⁻¹ X'Z Ω̂⁻¹ Z'Y; SE = √(n·diag(Ainv)) (matches GMMEngine); Hansen J = n·g'Ω̂⁻¹g with g = (Z'Y − Z'X β)/n on small matrices.
  - `duckdbLIML.js` buildLIMLSuffStats — extends GMM aggregates with W-block (W'W, W'X, W'Y, Z'W) needed for M_W projections.
  - `LIMLSuffStatsEngine.js` runLIMLFromSuffStats — assembles A = [Y, X_endo]' M_Z [Y, X_endo] and B = [Y, X_endo]' M_W [Y, X_endo] via closed forms `v'Mu = v'u − v'P(P'P)⁻¹P'u` on small matrices; reuses existing limlKappa2x2 / limlKappaPower from GMMEngine.js for κ.
  - Dispatcher: GMM/LIML routed when zVars, xVars present, order condition holds, and (k+l) ≤ K_THRESHOLD; SE restricted to "classical" only.
  - Validated vs `gmm::gmm()` and `AER::ivreg(..., method="LIML")` at 6dp coef / 4dp SE (`fase3bBenchmarks.json`, `window.__validation.fase3b`).
  Deferred to a later sub-fase: HC0/HC1 + clustered/HAC for LIML (parallel to 2SLS); GMM HC overrides (GMM's classical SE is already heteroskedasticity-robust via Ω̂, so this is genuinely deferred).
```

- [ ] **Step 3: Update CLAUDE.md Pending item 2a**

Append to item 2a:
```
Fase 3b extension: GMM (two-step efficient) and LIML suff-stats paths live for classical SE via duckdbGMM.js + duckdbGMMOmega.js + GMMSuffStatsEngine.js (GMM) and duckdbLIML.js + LIMLSuffStatsEngine.js (LIML); validated vs gmm::gmm and AER::ivreg(LIML) in fase3bBenchmarks.json.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md
git commit -m "docs: Fase 3b — GMM + LIML sufficient-statistics paths complete"
```

---

## Self-review checklist

- Spec coverage: design doc lines 245–246 — `duckdbIV` foundation reused ✅ (Task 2 imports same field names); `duckdbGMM` with weighting matrix W ✅ (Task 2 + Task 3 + Task 4); LIML eigen-problem on small matrices ✅ (Task 5 + Task 6).
- Placeholder scan: no "TBD" / "implement appropriate" / "similar to" — every step is concrete with full code or commands.
- Type consistency:
  - `buildGMMSuffStats` returns `{n, sumY, YtY, XtX, ZtZ, ZtX, XtY, ZtY, varNames, instrNames, xColsAll, zColsAll}` — `runGMMFromSuffStats` (Task 4) and the 2SLS step-1 (`run2SLSFromSuffStats`) both consume the first 8 fields; `computeGMMOmega` (Task 3) consumes `xColsAll`/`zColsAll`.
  - `buildLIMLSuffStats` returns the superset shape with W-block fields; `runLIMLFromSuffStats` (Task 6) consumes everything via destructuring.
  - `Omega` is always `(l+1)×(l+1)` symmetric — Task 3 returns this; Task 4 consumes it.
  - `endoIdx` is consistently a `number[]` of 1-based column positions within X — populated in Task 5, consumed in Task 6.
  - SE convention: classical only in Fase 3b. Engine outputs `se` field matching `EstimationResult` shape regardless.
- HC0/HC1/cluster/HAC for GMM/LIML: explicitly deferred — Task 1 Step 2 restricts SE to classical; Task 7 branch guards.
- LIML 2×2 vs power-iteration κ: reuses existing helpers from `GMMEngine.js:312-343` (Task 6 imports `limlKappa2x2` and `limlKappaPower`); no duplication of eigenvalue code.
- Validation: Fase 3b benchmarks (Task 8) cover β + SE for both GMM and LIML, plus κ_LIML and J_GMM — five quantities checked against R's `gmm` and `AER` packages.
