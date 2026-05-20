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
 *   xColsAll, zColsAll,
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
