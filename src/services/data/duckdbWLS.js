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
 * @param {string|null} wCol     weight column; nullable when opts.weightSQL is set
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL]  CASE WHEN expressions for synthetic dummies
 * @param {string} [opts.weightSQL] raw SQL weight expression, e.g. RDD kernel
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
  if (!wCol && !opts.weightSQL) {
    throw new Error("buildWLSSuffStats: weight column or weightSQL required");
  }

  const dummySQL = opts.dummySQL ?? {};
  const colExpr = (c) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  };

  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const wExpr  = opts.weightSQL
    ? `(${opts.weightSQL})`
    : `TRY_CAST(${esc(wCol)} AS DOUBLE)`;
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
    weightCol: wCol ?? null,
  };
}
