// ─── ECON STUDIO · src/services/data/duckdbIVRobustSE.js ──────────────────────
// HC0/HC1 sandwich meat for 2SLS, computed in SQL.
//
// For 2SLS the meat matrix is:
//   M = Σ êᵢ²  x̂ᵢ x̂ᵢ'
// where êᵢ are STRUCTURAL residuals (yᵢ − xᵢ'β̂_2SLS) using ACTUAL x,
// and x̂ᵢ is the first-stage fitted regressor row for endogenous components
// (exogenous components are themselves).
//
// HC1 scaling n/(n−k) is applied by the engine, not here.
//
// Parameters bound as prepared statements:
//   - β (k+1)         → consumed by structural residual
//   - α_j (q+1) for each endogenous j → consumed by first-stage x̂_j
//
// SQL:
//   resid  = y − Σ β_l · x_l_actual
//   xhat_j = Σ α_jl · z_l        (for endogenous j)
//   xhat_j = x_j                  (for exogenous j or intercept)
//   meat[i][j] = SUM(resid² · xhat_i · xhat_j)

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
 * @param {string[]} args.xCols             — full design (endog + exog), intercept implicit
 * @param {string[]} args.zCols             — instruments (exog + excluded), intercept implicit
 * @param {Record<string,string>} [args.dummySQL]
 * @param {number[]} args.beta              — 2SLS β, length k+1 with intercept first
 * @param {Map<number,number[]>} args.firstStageBeta
 *   — keyed by X-column index (0 = intercept, 1..k = x_cols),
 *     value = first-stage α for that endogenous regressor (length q+1).
 *     Exogenous indices (and the intercept) are NOT in this map; SQL treats
 *     x̂ = x directly for those.
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeIVHCMeat({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta,
}) {
  const { conn } = await getDuckDB();
  const k = xCols.length;
  const q = zCols.length;
  const kDim = k + 1;
  const qDim = q + 1;

  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };

  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xCols[i - 1]);
  const zExpr = (i) => i === 0 ? "1.0" : colExpr(zCols[i - 1]);

  // residSQL — same pattern as duckdbRobustSE.js
  const betaTerms = [];
  const betaParams = [];
  for (let i = 0; i < kDim; i++) {
    betaTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yExpr    = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;
  const residSQL = `(${yExpr} - (${betaTerms.join(" + ")}))`;

  // xhatExpr(i): if i is endogenous, build Σ α_il · z_l; else xExpr(i).
  // ainvParamsByEndog stores α-params per endogenous X-column index so the
  // binding loop can look them up without re-running firstStageBeta.
  const ainvParamsByEndog = new Map();  // keyed by X-column index
  const xhatExpr = (i) => {
    if (!firstStageBeta.has(i)) return xExpr(i);
    const alpha = firstStageBeta.get(i);
    if (alpha.length !== qDim) {
      throw new Error(
        `computeIVHCMeat: firstStageBeta[${i}] length ${alpha.length} ≠ q+1 (${qDim})`
      );
    }
    const terms = [];
    const params = [];
    for (let l = 0; l < qDim; l++) {
      terms.push(`? * ${zExpr(l)}`);
      params.push(alpha[l]);
    }
    ainvParamsByEndog.set(i, params);
    return `(${terms.join(" + ")})`;
  };

  // Aggregates: upper triangle of meat.
  // Build SQL first (populates ainvParamsByEndog as a side-effect via xhatExpr).
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
      aggs.push(
        `SUM(POWER(${residSQL}, 2) * ${xhatExpr(i)} * ${xhatExpr(j)}) AS m_${i}_${j}`
      );
    }
  }

  const finite = [`isfinite(${yExpr})`];
  for (let i = 0; i < k; i++) finite.push(`isfinite(${xExpr(i + 1)})`);
  for (let i = 0; i < q; i++) finite.push(`isfinite(${zExpr(i + 1)})`);

  const sql = `
    SELECT ${aggs.join(", ")}
    FROM ${esc(tableName)}
    WHERE ${finite.join(" AND ")}
  `;

  // Param binding: DuckDB resolves ? left-to-right. For each upper-triangle
  // aggregate SUM(POWER(resid,2) * xhat_i * xhat_j) the textual order is:
  //   1. β-params for resid (kDim params)
  //   2. α-params for xhat_i IF i is endogenous (qDim params)
  //   3. α-params for xhat_j IF j is endogenous (qDim params)
  // When i = j and endogenous, α IS pushed twice — correct, SQL has two occurrences.
  const aggCount = (kDim * (kDim + 1)) / 2;
  const boundParams = [];
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
      boundParams.push(...betaParams);
      if (ainvParamsByEndog.has(i)) boundParams.push(...ainvParamsByEndog.get(i));
      if (ainvParamsByEndog.has(j)) boundParams.push(...ainvParamsByEndog.get(j));
    }
  }

  // Sanity guard: residSQL must appear once per upper-triangle aggregate.
  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== aggCount) {
    throw new Error(
      `computeIVHCMeat: residSQL occurrence mismatch (got ${residCount}, expected ${aggCount}). ` +
      `If you refactored the SQL (e.g. added WHERE or extra agg), update this guard.`
    );
  }

  const stmt = await conn.prepare(sql);
  const result = await stmt.query(...boundParams);
  await stmt.close();
  const r = result.toArray()[0];

  const meat = Array.from({ length: kDim }, () => Array(kDim).fill(0));
  for (let i = 0; i < kDim; i++) {
    for (let j = i; j < kDim; j++) {
      const v = num(r[`m_${i}_${j}`]);
      meat[i][j] = v;
      if (i !== j) meat[j][i] = v;
    }
  }
  return { meat, n: num(r.n) };
}
