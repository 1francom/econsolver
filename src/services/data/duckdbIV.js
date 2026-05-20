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

/** Escape an identifier for DuckDB double-quoted form. */
function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }

/** Arrow → Number, handling BigInt. */
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * Compute 2SLS sufficient statistics over a DuckDB table.
 *
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

  // ── Aggregate expressions ───────────────────────────────────────────────────
  const aggs = [`COUNT(*) AS n`, `SUM(_y_) AS sum_y`, `SUM(_y_ * _y_) AS yty`];

  // X column sums + X'Y cross-products
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
  for (let i = 0; i < k; i++) aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  // X'X upper triangle
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
  }

  // Z column sums + Z'Y cross-products
  for (let i = 0; i < q; i++) aggs.push(`SUM(_z_${i}) AS sum_z_${i}`);
  for (let i = 0; i < q; i++) aggs.push(`SUM(_z_${i} * _y_) AS sum_zy_${i}`);
  // Z'Z upper triangle
  for (let i = 0; i < q; i++) {
    for (let j = i; j < q; j++) aggs.push(`SUM(_z_${i} * _z_${j}) AS sum_zz_${i}_${j}`);
  }

  // Z'X full grid (NOT symmetric — q×k cross-products, no shortcuts)
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

  // ── Assemble matrices ───────────────────────────────────────────────────────
  const kDim = k + 1; // intercept + k regressors
  const qDim = q + 1; // intercept + q instruments
  const XtX = Array.from({ length: kDim }, () => Array(kDim).fill(0));
  const ZtZ = Array.from({ length: qDim }, () => Array(qDim).fill(0));
  const ZtX = Array.from({ length: qDim }, () => Array(kDim).fill(0));
  const XtY = Array(kDim).fill(0);
  const ZtY = Array(qDim).fill(0);

  // ── X'X — intercept row/col then upper triangle → mirror ───────────────────
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

  // ── Z'Z — intercept row/col then upper triangle → mirror ───────────────────
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

  // ── Z'X — full q×k grid; intercept row/col filled from running sums ─────────
  // Intercept row of Z (i=0): Z₀ = 1 everywhere, so Z₀'X = [n, sum_x_0, ..., sum_x_{k-1}]
  ZtX[0][0] = n;
  for (let j = 0; j < k; j++) ZtX[0][j + 1] = num(r[`sum_x_${j}`]);
  // Intercept col of X (j=0): X₀ = 1 everywhere, so Z_i'X₀ = sum_z_{i-1}
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
