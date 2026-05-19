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

/**
 * HC2/HC3: meat scaled by leverage hᵢᵢ = xᵢ' Ainv xᵢ.
 * Denominator (1 − hᵢᵢ)^p, p=1 (HC2) or p=2 (HC3).
 *
 * Risk note: at k=100 this binds ~(k+1)² + (k+1) ≈ 10_200 params. If
 * DuckDB-Wasm hits a parameter ceiling, refactor to a CTE that computes
 * e and h_ii once.
 *
 * @param {object} args
 * @param {string} args.tableName
 * @param {string} args.yCol
 * @param {string[]} args.xColsExpanded  — post factor expansion
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta           — length k+1, intercept first
 * @param {number[][]} args.Ainv         — (k+1)×(k+1), symmetric
 * @param {'HC2'|'HC3'} args.hcType
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeHCMeatWithLeverage({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, Ainv, hcType,
}) {
  const { conn } = await getDuckDB();
  const k = xColsExpanded.length;
  const dim = k + 1;
  const p = hcType === "HC3" ? 2 : 1;

  const xExpr = (i) => {
    if (i === 0) return "1.0";
    const name = xColsExpanded[i - 1];
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  // β occurrences (yhat) and Ainv occurrences (h_ii) are bound separately
  // and replicated per occurrence count in the SQL string.
  const betaParams = [];
  const yhatTerms = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${yhatSQL}))`;

  // h_ii = Σ_j Σ_l Ainv[j][l] xⱼ x_l, symmetric → upper triangle ×2
  const ainvParams = [];
  const hTerms = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const coef = j === l ? "?" : "(2.0 * ?)";
      hTerms.push(`${coef} * ${xExpr(j)} * ${xExpr(l)}`);
      ainvParams.push(Ainv[j][l]);
    }
  }
  const hSQL     = hTerms.join(" + ");
  const denomSQL = `POWER(1.0 - (${hSQL}), ${p})`;

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) / ${denomSQL} * ${xExpr(i)} * ${xExpr(j)}) AS m_${i}_${j}`
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

  // Each aggregate contains residSQL once and hSQL once. Walk the SQL: for
  // every occurrence of residSQL in order, bind β; for every occurrence of
  // hSQL in order, bind Ainv. DuckDB resolves ? placeholders left-to-right.
  //
  // Order in each aggregate: SUM(POWER(residSQL,2) / POWER(1-(hSQL),p) * ...)
  // → residSQL placeholders come first, then hSQL placeholders.
  const residCount = sql.split(residSQL).length - 1;
  const hCount     = sql.split(hSQL).length - 1;
  const boundParams = [];
  // Bind per aggregate: each aggregate has 1 residSQL followed by 1 hSQL.
  // Total aggregates with both = number of meat entries = dim*(dim+1)/2.
  // So we interleave: for each agg, push betaParams then ainvParams.
  const aggCount = dim * (dim + 1) / 2;
  for (let i = 0; i < aggCount; i++) {
    boundParams.push(...betaParams);
    boundParams.push(...ainvParams);
  }
  // Sanity check
  const expectedTotal = aggCount * (betaParams.length + ainvParams.length);
  if (boundParams.length !== expectedTotal) {
    throw new Error(`computeHCMeatWithLeverage: param-count mismatch (got ${boundParams.length}, expected ${expectedTotal})`);
  }
  // Also sanity: residCount/hCount should both equal aggCount
  if (residCount !== aggCount || hCount !== aggCount) {
    throw new Error(`computeHCMeatWithLeverage: SQL occurrence mismatch (resid=${residCount}, h=${hCount}, expected ${aggCount})`);
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
