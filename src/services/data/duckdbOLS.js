// ─── ECON STUDIO · src/services/data/duckdbOLS.js ─────────────────────────────
// DuckDB sufficient-statistics path for OLS.
//
// Codex §3 — "Better flow":
//   DuckDB table
//     -> SQL computes X'X, X'Y, Y'Y, n
//     -> JavaScript receives small (k+1)x(k+1) matrices
//     -> JS computes β = inv(X'X) X'Y, σ², SE, t, p, F, R²
//
// X'X is (k+1)×(k+1) where k = xCols.length. The intercept column of ones is
// implicit — SUM(1) = n, SUM(x_i) is the cross-product against the intercept.
//
// NA / non-numeric handling matches runOLS: rows are excluded if y or any x is
// NULL, NaN, or infinite. Implemented via TRY_CAST + isfinite() filter.

import { getDuckDB } from "./duckdb.js";

/** Escape an identifier for DuckDB double-quoted form. */
function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }

/** Arrow → Number, handling BigInt. */
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * Compute OLS sufficient statistics over a DuckDB table.
 *
 * @param {string}   tableName  DuckDB table name (from cleanedData._duckdb.tableName)
 * @param {string}   yCol       outcome column name
 * @param {string[]} xCols      regressor column names (intercept handled implicitly)
 * @param {object}   [opts]
 * @param {Record<string,string>} [opts.dummySQL]  — CASE WHEN expressions keyed
 *   by synthetic dummy name (from expandFactors). When xCols contains a name
 *   that appears in this map, the SQL expression is used instead of casting
 *   a literal column name.
 * @returns {Promise<{ n, XtX, XtY, YtY, sumY, varNames }>}
 *   n         — number of valid rows (after NA / non-finite filter)
 *   XtX       — (k+1)×(k+1) symmetric matrix, row/col 0 corresponds to intercept
 *   XtY       — length k+1 vector
 *   YtY       — Σ y²
 *   sumY      — Σ y  (needed for SST = YtY − sumY² / n)
 *   varNames  — ["(Intercept)", ...xCols]
 *
 * One round-trip to DuckDB; no row materialization in JS.
 */
export async function buildOLSSuffStats(tableName, yCol, xCols, opts = {}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  if (k < 1) throw new Error("buildOLSSuffStats: need at least one regressor");

  // ── Model frame CTE ─────────────────────────────────────────────────────────
  // Cast every column to DOUBLE once (TRY_CAST → NULL on failure), then filter
  // rows where any value is NULL / NaN / infinite. isfinite(NULL) is NULL
  // which evaluates as false in WHERE, so NULLs are also dropped.
  const yExpr  = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const dummySQL = opts.dummySQL ?? {};
  const xExprs = xCols.map(c => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, c)) {
      return `CAST((${dummySQL[c]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(c)} AS DOUBLE)`;
  });

  const projections = [`${yExpr} AS _y_`];
  xExprs.forEach((e, i) => projections.push(`${e} AS _x_${i}`));

  const finiteFilters = [`isfinite(_y_)`];
  for (let i = 0; i < k; i++) finiteFilters.push(`isfinite(_x_${i})`);

  // ── Aggregate expressions ───────────────────────────────────────────────────
  // Symmetric — only upper triangle of cross-products is requested; the JS
  // side mirrors to the lower triangle.
  const aggs = [
    `COUNT(*) AS n`,
    `SUM(_y_) AS sum_y`,
    `SUM(_y_ * _y_) AS yty`,
  ];
  for (let i = 0; i < k; i++) {
    aggs.push(`SUM(_x_${i}) AS sum_x_${i}`);
    aggs.push(`SUM(_x_${i} * _y_) AS sum_xy_${i}`);
  }
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      aggs.push(`SUM(_x_${i} * _x_${j}) AS sum_xx_${i}_${j}`);
    }
  }

  const sql = `
    WITH mf AS (
      SELECT ${projections.join(", ")}
      FROM ${esc(tableName)}
    )
    SELECT ${aggs.join(", ")}
    FROM mf
    WHERE ${finiteFilters.join(" AND ")}
  `;

  const result = await conn.query(sql);
  const r = result.toArray()[0];

  const n    = num(r.n);
  const sumY = num(r.sum_y);
  const YtY  = num(r.yty);

  // ── Assemble matrices ───────────────────────────────────────────────────────
  const dim = k + 1; // intercept + k regressors
  const XtX = Array.from({ length: dim }, () => Array(dim).fill(0));
  const XtY = Array(dim).fill(0);

  // Intercept row/col 0:
  XtX[0][0] = n;
  XtY[0]    = sumY;
  for (let i = 0; i < k; i++) {
    const sumXi = num(r[`sum_x_${i}`]);
    XtX[0][i + 1] = sumXi;
    XtX[i + 1][0] = sumXi;
    XtY[i + 1]    = num(r[`sum_xy_${i}`]);
  }
  // Pure cross-products (upper triangle → mirrored)
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      const v = num(r[`sum_xx_${i}_${j}`]);
      XtX[i + 1][j + 1] = v;
      if (i !== j) XtX[j + 1][i + 1] = v;
    }
  }

  return {
    n, XtX, XtY, YtY, sumY,
    varNames: ["(Intercept)", ...xCols],
  };
}
