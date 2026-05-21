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

function buildIVFrame({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta,
  clusterCol = null, clusterCol2 = null, orderCol = null,
}) {
  const kDim = xCols.length + 1;
  const qDim = zCols.length + 1;
  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };
  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xCols[i - 1]);
  const zExpr = (i) => i === 0 ? "1.0" : colExpr(zCols[i - 1]);
  const projections = [`TRY_CAST(${esc(yCol)} AS DOUBLE) AS _y`];
  for (let i = 0; i < kDim; i++) projections.push(`${xExpr(i)} AS _x_${i}`);
  for (let i = 0; i < qDim; i++) projections.push(`${zExpr(i)} AS _z_${i}`);
  if (clusterCol) projections.push(`${esc(clusterCol)} AS _g1`);
  if (clusterCol2) projections.push(`${esc(clusterCol2)} AS _g2`);
  if (orderCol) projections.push(`${esc(orderCol)} AS _t`);

  const betaParams = [];
  const yhatTerms = [];
  for (let i = 0; i < kDim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    betaParams.push(beta[i]);
  }

  const firstStageParams = [];
  const xhatProjections = [];
  for (let i = 0; i < kDim; i++) {
    if (!firstStageBeta.has(i)) {
      xhatProjections.push(`_x_${i} AS _xh_${i}`);
      continue;
    }
    const alpha = firstStageBeta.get(i);
    if (alpha.length !== qDim) {
      throw new Error(`buildIVFrame: firstStageBeta[${i}] length ${alpha.length} != q+1 (${qDim})`);
    }
    const terms = [];
    for (let j = 0; j < qDim; j++) {
      terms.push(`? * _z_${j}`);
      firstStageParams.push(alpha[j]);
    }
    xhatProjections.push(`(${terms.join(" + ")}) AS _xh_${i}`);
  }

  const finite = ["isfinite(_y)"];
  for (let i = 0; i < kDim; i++) finite.push(`isfinite(_x_${i})`);
  for (let i = 0; i < qDim; i++) finite.push(`isfinite(_z_${i})`);

  return {
    dim: kDim,
    betaParams,
    firstStageParams,
    projections,
    xhatProjections,
    finiteSQL: finite.join(" AND "),
    yhatSQL: yhatTerms.join(" + "),
    tableNameEsc: esc(tableName),
  };
}

function symmetricFrameMatrix(dim, row, prefix, scale = 1) {
  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let i = 0; i < dim; i++) {
    for (let j = i; j < dim; j++) {
      const value = num(row[`${prefix}_${i}_${j}`]) * scale;
      meat[i][j] = value;
      if (i !== j) meat[j][i] = value;
    }
  }
  return meat;
}

function ivFrameCTE(frame, mfFilter = "") {
  return `
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    ),
    mf AS (
      SELECT *,
             _y - (${frame.yhatSQL}) AS _e,
             ${frame.xhatProjections.join(", ")}
      FROM base
      WHERE ${frame.finiteSQL}${mfFilter}
    )
  `;
}

export async function computeIVHCMeatWithLeverage({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta, Ainv, hcType,
}) {
  const { conn } = await getDuckDB();
  const frame = buildIVFrame({
    tableName, yCol, xCols, zCols, dummySQL, beta, firstStageBeta,
  });
  const p = hcType === "HC3" ? 2 : 1;
  const hParams = [];
  const hTerms = [];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      hTerms.push(`${i === j ? "?" : "(2.0 * ?)"} * _xh_${i} * _xh_${j}`);
      hParams.push(Ainv[i][j]);
    }
  }
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      aggs.push(
        `SUM(POWER(_e, 2) / POWER(1.0 - _h, ${p}) * _xh_${i} * _xh_${j}) AS m_${i}_${j}`,
      );
    }
  }
  const sql = `
    ${ivFrameCTE(frame)},
    scored AS (
      SELECT *, (${hTerms.join(" + ")}) AS _h
      FROM mf
    )
    SELECT ${aggs.join(", ")}
    FROM scored
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(
    ...frame.betaParams,
    ...frame.firstStageParams,
    ...hParams,
  )).toArray()[0];
  await stmt.close();
  return { meat: symmetricFrameMatrix(frame.dim, row, "m"), n: num(row.n) };
}

export async function computeIVClusterMeat({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta, clusterCol,
}) {
  const { conn } = await getDuckDB();
  const frame = buildIVFrame({
    tableName, yCol, xCols, zCols, dummySQL, beta, firstStageBeta, clusterCol,
  });
  const scoreAggs = [];
  const meatAggs = [];
  for (let i = 0; i < frame.dim; i++) scoreAggs.push(`SUM(_e * _xh_${i}) AS s_${i}`);
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) meatAggs.push(`SUM(s_${i} * s_${j}) AS m_${i}_${j}`);
  }
  const sql = `
    ${ivFrameCTE(frame, " AND _g1 IS NOT NULL")},
    clusters AS (
      SELECT _g1, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM mf
      GROUP BY _g1
    )
    SELECT COUNT(*) AS G, SUM(_cn) AS n, ${meatAggs.join(", ")}
    FROM clusters
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams, ...frame.firstStageParams)).toArray()[0];
  await stmt.close();
  const G = num(row.G);
  const n = num(row.n);
  if (G <= 1) throw new Error(`computeIVClusterMeat: need at least 2 clusters (found G=${G})`);
  const scale = (G / (G - 1)) * ((n - 1) / (n - frame.dim));
  return { meat: symmetricFrameMatrix(frame.dim, row, "m", scale), n, G };
}

export async function computeIVTwowayClusterMeat({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta,
  clusterCol, clusterCol2,
}) {
  const { conn } = await getDuckDB();
  const frame = buildIVFrame({
    tableName, yCol, xCols, zCols, dummySQL, beta, firstStageBeta, clusterCol, clusterCol2,
  });
  const scoreAggs = [];
  for (let i = 0; i < frame.dim; i++) scoreAggs.push(`SUM(_e * _xh_${i}) AS s_${i}`);
  const selectExprs = ["(SELECT COUNT(*) FROM mf) AS n"];
  for (const label of ["1", "2", "12"]) {
    selectExprs.push(`(SELECT COUNT(*) FROM c${label}) AS G${label}`);
    for (let i = 0; i < frame.dim; i++) {
      for (let j = i; j < frame.dim; j++) {
        selectExprs.push(`(SELECT SUM(s_${i} * s_${j}) FROM c${label}) AS m${label}_${i}_${j}`);
      }
    }
  }
  const sql = `
    ${ivFrameCTE(frame, " AND _g1 IS NOT NULL AND _g2 IS NOT NULL")},
    c1 AS (SELECT _g1 AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1),
    c2 AS (SELECT _g2 AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g2),
    c12 AS (SELECT (_g1 || '|' || _g2) AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1, _g2)
    SELECT ${selectExprs.join(",\n           ")}
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams, ...frame.firstStageParams)).toArray()[0];
  await stmt.close();
  const n = num(row.n);
  const G1 = num(row.G1);
  const G2 = num(row.G2);
  const G12 = num(row.G12);
  const scale = (G) => G > 1 ? (G / (G - 1)) * ((n - 1) / (n - frame.dim)) : 1;
  const meat = Array.from({ length: frame.dim }, () => Array(frame.dim).fill(0));
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      const value = scale(G1) * num(row[`m1_${i}_${j}`])
        + scale(G2) * num(row[`m2_${i}_${j}`])
        - scale(G12) * num(row[`m12_${i}_${j}`]);
      meat[i][j] = value;
      if (i !== j) meat[j][i] = value;
    }
  }
  return { meat, n, G1, G2, G12 };
}

export async function computeIVHACMeat({
  tableName, yCol, xCols, zCols, dummySQL = {}, beta, firstStageBeta,
  orderCol, maxLag,
}) {
  const { conn } = await getDuckDB();
  const frame = buildIVFrame({
    tableName, yCol, xCols, zCols, dummySQL, beta, firstStageBeta, orderCol,
  });
  const countSQL = `
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    )
    SELECT COUNT(*) AS n
    FROM base
    WHERE ${frame.finiteSQL}
  `;
  const nFull = num((await conn.query(countSQL)).toArray()[0].n);
  const L = maxLag != null
    ? Math.max(1, Math.floor(maxLag))
    : Math.max(1, Math.floor(4 * Math.pow(nFull / 100, 2 / 9)));
  const scoreCols = [];
  for (let i = 0; i < frame.dim; i++) scoreCols.push(`_e * _xh_${i} AS _s_${i}`);
  const lagCols = [];
  for (let lag = 1; lag <= L; lag++) {
    for (let i = 0; i < frame.dim; i++) {
      lagCols.push(`LAG(_s_${i}, ${lag}) OVER (ORDER BY _t) AS _s_${i}_${lag}`);
    }
  }
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) aggs.push(`SUM(_s_${i} * _s_${j}) AS g0_${i}_${j}`);
  }
  for (let lag = 1; lag <= L; lag++) {
    for (let i = 0; i < frame.dim; i++) {
      for (let j = 0; j < frame.dim; j++) {
        aggs.push(`SUM(_s_${i} * _s_${j}_${lag}) AS g${lag}_${i}_${j}`);
      }
    }
  }
  const sql = `
    ${ivFrameCTE(frame)},
    scores AS (
      SELECT *, ${scoreCols.join(", ")}
      FROM mf
    ),
    lagged AS (
      SELECT *, ${lagCols.join(", ")}
      FROM scores
    )
    SELECT ${aggs.join(", ")}
    FROM lagged
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams, ...frame.firstStageParams)).toArray()[0];
  await stmt.close();

  const meat = symmetricFrameMatrix(frame.dim, row, "g0");
  for (let lag = 1; lag <= L; lag++) {
    const weight = 1 - lag / (L + 1);
    for (let i = 0; i < frame.dim; i++) {
      for (let j = 0; j < frame.dim; j++) {
        meat[i][j] += weight * (
          num(row[`g${lag}_${i}_${j}`]) + num(row[`g${lag}_${j}_${i}`])
        );
      }
    }
  }
  return { meat, n: num(row.n), L };
}
