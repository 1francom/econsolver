// ─── ECON STUDIO · src/services/data/duckdbWithinRobustSE.js ───────────────────
// HC0 / HC1 sandwich meat-matrix for within-transformed panel data.
//
// Reuses the withinCTEPrefix produced by buildWithinSuffStats so the same
// within transformation (FE demean+recenter, or FD lag) is computed exactly
// once for both the X'X and the meat aggregations. β is bound as
// prepared-statement params; HC1 scaling is applied by the caller (in
// runFE/FDFromSuffStats) — this function returns the raw HC0 meat.

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.withinCTEPrefix  full "WITH base AS (…), …, wf AS (…)" string
 * @param {number} args.k                number of regressors (excl. intercept)
 * @param {number[]} args.beta           length k+1, intercept first; in the
 *                                       within-transformed coordinate system
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeWithinHCMeat({ withinCTEPrefix, k, beta }) {
  const { conn } = await getDuckDB();
  const dim = k + 1;

  // Inside `wf`, columns are _y_, _x_0, _x_1, …, _x_{k-1}. The intercept
  // (column index 0 in β) corresponds to the constant 1.0.
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  const yhatTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`
      );
    }
  }

  const sql = `${withinCTEPrefix}
    SELECT ${aggs.join(", ")} FROM wf`;

  // One residSQL inlining per aggregate; β param vector replicated per agg.
  const literalCount = sql.split(residSQL).length - 1;
  const aggCount = dim * (dim + 1) / 2;
  if (literalCount !== aggCount) {
    throw new Error(
      `computeWithinHCMeat: residSQL occurrence count mismatch ` +
      `(found ${literalCount}, expected ${aggCount}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...betaParams);

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
