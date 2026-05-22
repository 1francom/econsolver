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
 * @param {string|null} args.wCol
 * @param {Record<string,string>} [args.dummySQL]
 * @param {string} [args.weightSQL]
 * @param {number[]} args.beta   length k+1 with intercept first
 * @returns {Promise<{ meat: number[][], n: number }>}
 */
export async function computeWLSHCMeat({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta,
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
  if (!wCol && !weightSQL) {
    throw new Error("computeWLSHCMeat: wCol or weightSQL required");
  }
  const wExpr = weightSQL
    ? `(${weightSQL})`
    : `TRY_CAST(${esc(wCol)} AS DOUBLE)`;
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

function buildWLSFrame({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta,
  clusterCol = null, clusterCol2 = null, orderCol = null,
}) {
  const dim = xCols.length + 1;
  const colExpr = (name) => {
    if (Object.prototype.hasOwnProperty.call(dummySQL, name)) {
      return `CAST((${dummySQL[name]}) AS DOUBLE)`;
    }
    return `TRY_CAST(${esc(name)} AS DOUBLE)`;
  };
  const xExpr = (i) => i === 0 ? "1.0" : colExpr(xCols[i - 1]);
  if (!wCol && !weightSQL) {
    throw new Error("buildWLSFrame: wCol or weightSQL required");
  }
  const wExpr = weightSQL
    ? `(${weightSQL})`
    : `TRY_CAST(${esc(wCol)} AS DOUBLE)`;
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const projections = [`${yExpr} AS _y`, `${wExpr} AS _w`];
  for (let i = 0; i < dim; i++) projections.push(`${xExpr(i)} AS _x_${i}`);
  if (clusterCol) projections.push(`${esc(clusterCol)} AS _g1`);
  if (clusterCol2) projections.push(`${esc(clusterCol2)} AS _g2`);
  if (orderCol) projections.push(`${esc(orderCol)} AS _t`);

  const betaParams = [];
  const yhatTerms = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    betaParams.push(beta[i]);
  }

  const finite = ["isfinite(_y)", "isfinite(_w)", "_w > 0"];
  for (let i = 0; i < dim; i++) finite.push(`isfinite(_x_${i})`);

  return {
    dim,
    betaParams,
    projections,
    finiteSQL: finite.join(" AND "),
    yhatSQL: yhatTerms.join(" + "),
    tableNameEsc: esc(tableName),
  };
}

function symmetricMatrix(dim, row, prefix, scale = 1) {
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

/**
 * WLS HC2/HC3 meat. Leverage uses the weighted design:
 * h_i = w_i * x_i' (X'WX)^-1 x_i.
 */
export async function computeWLSHCMeatWithLeverage({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta, Ainv, hcType,
}) {
  const { conn } = await getDuckDB();
  const frame = buildWLSFrame({
    tableName, yCol, xCols, wCol, weightSQL, dummySQL, beta,
  });
  const p = hcType === "HC3" ? 2 : 1;
  const hParams = [];
  const hTerms = [];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      hTerms.push(`${i === j ? "?" : "(2.0 * ?)"} * _x_${i} * _x_${j}`);
      hParams.push(Ainv[i][j]);
    }
  }

  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      aggs.push(
        `SUM(POWER(_w, 2) * POWER(_e, 2) / POWER(1.0 - (_w * _h), ${p}) * _x_${i} * _x_${j}) AS m_${i}_${j}`,
      );
    }
  }

  const sql = `
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    ),
    mf AS (
      SELECT *,
             _y - (${frame.yhatSQL}) AS _e
      FROM base
      WHERE ${frame.finiteSQL}
    ),
    scored AS (
      SELECT *, (${hTerms.join(" + ")}) AS _h
      FROM mf
    )
    SELECT ${aggs.join(", ")}
    FROM scored
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams, ...hParams)).toArray()[0];
  await stmt.close();
  return { meat: symmetricMatrix(frame.dim, row, "m"), n: num(row.n) };
}

export async function computeWLSClusterMeat({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta, clusterCol,
}) {
  const { conn } = await getDuckDB();
  const frame = buildWLSFrame({
    tableName, yCol, xCols, wCol, weightSQL, dummySQL, beta, clusterCol,
  });
  const scoreAggs = [];
  const meatAggs = [];
  for (let i = 0; i < frame.dim; i++) scoreAggs.push(`SUM(_w * _e * _x_${i}) AS s_${i}`);
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      meatAggs.push(`SUM(s_${i} * s_${j}) AS m_${i}_${j}`);
    }
  }
  const sql = `
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    ),
    mf AS (
      SELECT *,
             _y - (${frame.yhatSQL}) AS _e
      FROM base
      WHERE ${frame.finiteSQL} AND _g1 IS NOT NULL
    ),
    clusters AS (
      SELECT _g1, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM mf
      GROUP BY _g1
    )
    SELECT COUNT(*) AS G, SUM(_cn) AS n, ${meatAggs.join(", ")}
    FROM clusters
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams)).toArray()[0];
  await stmt.close();
  const G = num(row.G);
  const n = num(row.n);
  if (G <= 1) throw new Error(`computeWLSClusterMeat: need at least 2 clusters (found G=${G})`);
  const scale = (G / (G - 1)) * ((n - 1) / (n - frame.dim));
  return { meat: symmetricMatrix(frame.dim, row, "m", scale), n, G };
}

export async function computeWLSTwowayClusterMeat({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta,
  clusterCol, clusterCol2,
}) {
  const { conn } = await getDuckDB();
  const frame = buildWLSFrame({
    tableName, yCol, xCols, wCol, weightSQL, dummySQL, beta, clusterCol, clusterCol2,
  });
  const scoreAggs = [];
  for (let i = 0; i < frame.dim; i++) scoreAggs.push(`SUM(_w * _e * _x_${i}) AS s_${i}`);
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
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    ),
    mf AS (
      SELECT *,
             _y - (${frame.yhatSQL}) AS _e
      FROM base
      WHERE ${frame.finiteSQL} AND _g1 IS NOT NULL AND _g2 IS NOT NULL
    ),
    c1 AS (SELECT _g1 AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1),
    c2 AS (SELECT _g2 AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g2),
    c12 AS (SELECT (_g1 || '|' || _g2) AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1, _g2)
    SELECT ${selectExprs.join(",\n           ")}
  `;
  const stmt = await conn.prepare(sql);
  const row = (await stmt.query(...frame.betaParams)).toArray()[0];
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

export async function computeWLSHACMeat({
  tableName, yCol, xCols, wCol, weightSQL = null, dummySQL = {}, beta,
  orderCol, maxLag,
}) {
  const { conn } = await getDuckDB();
  const frame = buildWLSFrame({
    tableName, yCol, xCols, wCol, weightSQL, dummySQL, beta, orderCol,
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
  for (let i = 0; i < frame.dim; i++) scoreCols.push(`_w * _e * _x_${i} AS _s_${i}`);
  const lagCols = [];
  for (let lag = 1; lag <= L; lag++) {
    for (let i = 0; i < frame.dim; i++) {
      lagCols.push(`LAG(_s_${i}, ${lag}) OVER (ORDER BY _t) AS _s_${i}_${lag}`);
    }
  }
  const aggs = ["COUNT(*) AS n"];
  for (let i = 0; i < frame.dim; i++) {
    for (let j = i; j < frame.dim; j++) {
      aggs.push(`SUM(_s_${i} * _s_${j}) AS g0_${i}_${j}`);
    }
  }
  for (let lag = 1; lag <= L; lag++) {
    for (let i = 0; i < frame.dim; i++) {
      for (let j = 0; j < frame.dim; j++) {
        aggs.push(`SUM(_s_${i} * _s_${j}_${lag}) AS g${lag}_${i}_${j}`);
      }
    }
  }
  const sql = `
    WITH base AS (
      SELECT ${frame.projections.join(", ")}
      FROM ${frame.tableNameEsc}
    ),
    mf AS (
      SELECT *,
             _y - (${frame.yhatSQL}) AS _e
      FROM base
      WHERE ${frame.finiteSQL}
    ),
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
  const row = (await stmt.query(...frame.betaParams)).toArray()[0];
  await stmt.close();

  const meat = symmetricMatrix(frame.dim, row, "g0");
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
