// ─── ECON STUDIO · src/services/data/duckdbResiduals.js ───────────────────────
// On-demand residual sampling for the SQL OLS path. Returns a fixed-size
// random sample (default 5000 rows) of {resid, yhat, x_*}. Consumers call
// this via the _residualsThunk attached to EstimationResult; the SQL path
// never materializes the full dataset for residual-dependent diagnostics
// unless the user opens those panels.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`;
}
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.tableName
 * @param {string} args.yCol
 * @param {string[]} args.xColsExpanded
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta            — length k+1, intercept first
 * @param {number} [args.sampleSize]      — default 5000
 * @returns {Promise<{ resid: number[], yhat: number[], xSample: number[][], _isSample: true, _nSample: number }>}
 */
export async function sampleResiduals({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, sampleSize = 5000,
}) {
  const { conn } = await getDuckDB();
  const k = xColsExpanded.length;
  const dim = k + 1;

  const xExpr = (i) => {
    if (i === 0) return "1.0";
    const name = xColsExpanded[i - 1];
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL = yhatTerms.join(" + ");
  const yExpr   = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const projections = [
    `${yExpr} - (${yhatSQL}) AS _resid`,
    `${yhatSQL} AS _yhat`,
  ];
  for (let i = 0; i < k; i++) {
    projections.push(`${xExpr(i + 1)} AS _x_${i}`);
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${projections.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
    USING SAMPLE ${sampleSize} ROWS
  `;

  // yhatSQL appears once in _resid and once in _yhat — replicate β per occurrence.
  const literalCount = sql.split(yhatSQL).length - 1;
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const arr = result.toArray();

  const resid = arr.map(r => num(r._resid));
  const yhat  = arr.map(r => num(r._yhat));
  const xSample = arr.map(r => {
    const row = [1];
    for (let i = 0; i < k; i++) row.push(num(r[`_x_${i}`]));
    return row;
  });

  return { resid, yhat, xSample, _isSample: true, _nSample: arr.length };
}
