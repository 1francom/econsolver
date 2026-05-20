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
