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
