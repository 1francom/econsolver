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
