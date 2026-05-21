// ─── ECON STUDIO · src/services/data/duckdbWithinHC23.js ──────────────────────
// HC2 / HC3 sandwich meat for within-transformed panel designs.
// Leverage h_ii = x̃_i' Ainv x̃_i computed inline in SQL with both β and Ainv
// bound as prepared params.
//   HC2: meat[j][l] = Σ (ê² / (1-h))    * x̃_j * x̃_l
//   HC3: meat[j][l] = Σ (ê² / (1-h)²)   * x̃_j * x̃_l
//
// Guard: dispatcher refuses when (k+1)² > 1000 to stay within DuckDB
// prepared-statement param budget.

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}     args.withinCTEPrefix
 * @param {number}     args.k                regressor count (excl. intercept)
 * @param {number[]}   args.beta             length k+1, intercept first
 * @param {number[][]} args.Ainv             (k+1)×(k+1), XtXinv from PanelSuffStatsEngine
 * @param {"HC2"|"HC3"} args.hcType
 * @returns {Promise<{meat:number[][], n:number}>}
 */
export async function computeWithinHCMeatWithLeverage({
  withinCTEPrefix, k, beta, Ainv, hcType,
}) {
  if (!["HC2", "HC3"].includes(hcType)) {
    throw new Error(`computeWithinHCMeatWithLeverage: bad hcType "${hcType}"`);
  }
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  // Build ŷ and ê
  const yhatTerms = [];
  const params = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    params.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // h_ii = Σ_{a,b} Ainv[a][b] * x̃_a * x̃_b
  const hTerms = [];
  for (let a = 0; a < dim; a++) {
    for (let b = 0; b < dim; b++) {
      hTerms.push(`? * ${xExpr(a)} * ${xExpr(b)}`);
      params.push(Ainv[a][b]);
    }
  }
  const hSQL = hTerms.join(" + ");
  const pPow = hcType === "HC2" ? 1 : 2;
  const denom = pPow === 1
    ? `(1.0 - (${hSQL}))`
    : `POWER(1.0 - (${hSQL}), 2)`;

  const aggs = ["COUNT(*) AS n"];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) / ${denom} * ${xExpr(j)} * ${xExpr(l)}) AS m_${j}_${l}`
      );
    }
  }

  const sql = `${withinCTEPrefix}
    SELECT ${aggs.join(", ")} FROM wf`;

  // Upper-triangle aggregate count = dim*(dim+1)/2
  const aggCount = dim * (dim + 1) / 2;
  const residCount = sql.split(residSQL).length - 1;
  const hCount     = sql.split(hSQL).length - 1;
  if (residCount !== aggCount || hCount !== aggCount) {
    throw new Error(
      `computeWithinHCMeatWithLeverage: occurrence mismatch ` +
      `(resid=${residCount}, h=${hCount}, expected ${aggCount}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < aggCount; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`m_${j}_${l}`]);
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n: num(r.n) };
}
