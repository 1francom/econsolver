// ─── ECON STUDIO · src/services/data/duckdbRobustSE.js ────────────────────────
// HC0/HC1/HC2/HC3 sandwich meat-matrix computation pushed into DuckDB.
//
// β is passed as prepared-statement parameters — never string interpolated.
// The residual êᵢ = yᵢ − Xᵢ β is inlined as a SUM of products. HC0 returns
// the raw meat matrix; HC1 = HC0 × n/(n-k) is applied by the caller (in
// runOLSFromSuffStats).
//
// HC2/HC3 (computeHCMeatWithLeverage, see below) inject Ainv to compute
// leverage hᵢᵢ = xᵢ' Ainv xᵢ, then divide by (1 − hᵢᵢ)^p.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string} args.tableName
 * @param {string} args.yCol
 * @param {string[]} args.xColsExpanded  — post factor expansion
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta           — length k+1, intercept first
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeHCMeat({ tableName, yCol, xColsExpanded, dummySQL = {}, beta }) {
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
  const yhatSQL  = yhatTerms.join(" + ");
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${yhatSQL}))`;

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`
      );
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // residSQL appears once inside each POWER() in the SELECT list. Each
  // occurrence consumes one full β param vector. Count occurrences in the
  // final SQL string and replicate params accordingly.
  const literalCount = sql.split(residSQL).length - 1;
  const boundParams = [];
  for (let i = 0; i < literalCount; i++) boundParams.push(...params);

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
