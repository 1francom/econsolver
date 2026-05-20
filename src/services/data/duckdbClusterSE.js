// ─── ECON STUDIO · src/services/data/duckdbClusterSE.js ──────────────────────
// One-way and two-way (Cameron-Gelbach-Miller) clustered meat-matrix
// computation pushed into DuckDB.
//
// β is bound as prepared-statement parameters. Each cluster level contributes
// a score vector s_g = Σ_{i∈g} ê_i x_i computed in a single grouped CTE; the
// outer SELECT aggregates the outer-product s_g s_g' across clusters.
//
// Small-sample corrections are applied INSIDE this module so the engine sees
// pre-scaled meat. Callers pass `hcType: null` to runOLSFromSuffStats.

import { getDuckDB } from "./duckdb.js";

function esc(c) { return `"${String(c).replace(/"/g, '""')}"`; }
function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

// Reused mf-CTE builder — same shape as duckdbDiagnostics.buildCTE but exported
// privately here to keep cluster module standalone.
function buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL = {}, beta }) {
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
  const yExpr = `TRY_CAST(${esc(yCol)} AS DOUBLE)`;

  const baseProjections = [`${yExpr} AS _y`];
  for (let i = 0; i < dim; i++) baseProjections.push(`${xExpr(i)} AS _x_${i}`);

  const yhatTerms = [];
  const params   = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * _x_${i}`);
    params.push(beta[i]);
  }
  const yhatSQL = yhatTerms.join(" + ");

  const finite = [`isfinite(_y)`];
  for (let i = 0; i < dim; i++) finite.push(`isfinite(_x_${i})`);

  return { dim, params, yhatSQL, finiteSQL: finite.join(" AND "), baseProjections, tableNameEsc: esc(tableName) };
}

/**
 * Cheap roundtrip: COUNT(DISTINCT cluster) — used by the dispatcher to detect
 * cluster degeneration (G > n/2 → fallback to JS path with classical HC1).
 *
 * @param {string} tableName
 * @param {string} clusterCol
 * @returns {Promise<{G:number, n:number}>}
 */
export async function countClusters(tableName, clusterCol) {
  const { conn } = await getDuckDB();
  const sql = `
    SELECT
      COUNT(DISTINCT ${esc(clusterCol)}) AS G,
      COUNT(*)                            AS n
    FROM ${esc(tableName)}
    WHERE ${esc(clusterCol)} IS NOT NULL
  `;
  const r = (await conn.query(sql)).toArray()[0];
  return { G: num(r.G), n: num(r.n) };
}

/**
 * @param {object} args
 * @param {string}                    args.tableName
 * @param {string}                    args.yCol
 * @param {string[]}                  args.xColsExpanded
 * @param {Record<string,string>}     [args.dummySQL]
 * @param {number[]}                  args.beta            — length k+1, intercept first
 * @param {string}                    args.clusterCol
 * @returns {Promise<{meat:number[][], n:number, G:number}>}
 */
export async function computeClusterMeat({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, clusterCol,
}) {
  const { conn } = await getDuckDB();
  const { dim, params, yhatSQL, finiteSQL, baseProjections, tableNameEsc }
    = buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL, beta });

  // Per-cluster score sums  s_g_j = SUM(_e * _x_j)
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(_e * _x_${j}) AS s_${j}`);
  }

  // Outer-product upper-tri aggregates: SUM(s_j * s_l) across clusters
  const meatAggs = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      meatAggs.push(`SUM(s_${j} * s_${l}) AS m_${j}_${l}`);
    }
  }

  const sql = `
    WITH base AS (
      SELECT ${baseProjections.join(", ")}, ${esc(clusterCol)} AS _g
      FROM ${tableNameEsc}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finiteSQL} AND _g IS NOT NULL
    ),
    clusters AS (
      SELECT _g, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM mf
      GROUP BY _g
    )
    SELECT
      COUNT(*)        AS G,
      SUM(_cn)        AS n,
      ${meatAggs.join(", ")}
    FROM clusters
  `;

  // yhatSQL appears exactly twice in the mf CTE (once for _yhat, once for _e).
  // Use sql.split(yhatSQL) to count occurrences — matches the Fase 1 pattern
  // in duckdbRobustSE.computeHCMeat. If a future refactor changes the mf CTE,
  // this guard throws with an actionable message.
  const yhatOccurrences = sql.split(yhatSQL).length - 1;
  if (yhatOccurrences !== 2) {
    throw new Error(
      `computeClusterMeat: yhatSQL occurrence count mismatch ` +
      `(found ${yhatOccurrences}, expected 2). ` +
      `If you refactored the mf CTE, update this guard.`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < yhatOccurrences; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const G = num(r.G);
  const n = num(r.n);
  const numParams = dim;
  if (G <= 1) {
    throw new Error(
      `computeClusterMeat: need at least 2 clusters for clustered SE (found G=${G}). ` +
      `Use HC1 instead.`,
    );
  }
  const scale = (G / (G - 1)) * ((n - 1) / (n - numParams));

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = num(r[`m_${j}_${l}`]) * scale;
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n, G };
}

/**
 * Two-way Cameron-Gelbach-Miller clustered meat. One SQL pass with three
 * grouped CTEs (c1, c2, c1×c2). Returns combined meat ready for sandwich:
 *   meat = scale_1 · M_1 + scale_2 · M_2 − scale_12 · M_12
 *
 * @param {object} args  (same as computeClusterMeat plus clusterCol2)
 * @returns {Promise<{meat:number[][], n:number, G1:number, G2:number, G12:number}>}
 */
export async function computeTwowayClusterMeat({
  tableName, yCol, xColsExpanded, dummySQL = {}, beta, clusterCol, clusterCol2,
}) {
  const { conn } = await getDuckDB();
  const { dim, params, yhatSQL, finiteSQL, baseProjections, tableNameEsc }
    = buildMfCTE({ tableName, yCol, xColsExpanded, dummySQL, beta });

  // Score-sum aggs (reused across three GROUP BY scopes)
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) scoreAggs.push(`SUM(_e * _x_${j}) AS s_${j}`);

  // Build outer-product agg list reused three times with different table aliases
  const meatAggsFor = (alias) => {
    const out = [];
    for (let j = 0; j < dim; j++) {
      for (let l = j; l < dim; l++) {
        out.push(`SUM(${alias}.s_${j} * ${alias}.s_${l})`);
      }
    }
    return out;
  };

  // For each scope (c1, c2, c12) we want G, and the (k+1)(k+2)/2 m_j_l sums.
  // Emit them as scalar subqueries to keep all three sub-meats in one row.
  const labelTriples = ["1", "2", "12"];
  const selectExprs = [];
  for (const lab of labelTriples) {
    selectExprs.push(`(SELECT COUNT(*) FROM c${lab}) AS G${lab}`);
    let idx = 0;
    for (let j = 0; j < dim; j++) {
      for (let l = j; l < dim; l++) {
        selectExprs.push(`(SELECT SUM(s_${j} * s_${l}) FROM c${lab}) AS m${lab}_${j}_${l}`);
        idx++;
      }
    }
  }
  // n once
  selectExprs.push(`(SELECT COUNT(*) FROM mf) AS n`);

  const sql = `
    WITH base AS (
      SELECT ${baseProjections.join(", ")},
             ${esc(clusterCol)}  AS _g1,
             ${esc(clusterCol2)} AS _g2
      FROM ${tableNameEsc}
    ),
    mf AS (
      SELECT *,
             (${yhatSQL}) AS _yhat,
             _y - (${yhatSQL}) AS _e
      FROM base
      WHERE ${finiteSQL} AND _g1 IS NOT NULL AND _g2 IS NOT NULL
    ),
    c1  AS (SELECT _g1               AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1),
    c2  AS (SELECT _g2               AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g2),
    c12 AS (SELECT (_g1 || '|' || _g2) AS _g, ${scoreAggs.join(", ")} FROM mf GROUP BY _g1, _g2)
    SELECT ${selectExprs.join(",\n           ")}
  `;

  // yhatSQL still appears twice in mf — bind params twice. Sub-meat CTEs
  // reference mf but DuckDB inlines the CTE once; param count remains 2× beta.
  // yhatSQL appears exactly twice in the mf CTE (once for _yhat, once for _e).
  // Use sql.split(yhatSQL) to count occurrences — matches the Fase 1 pattern
  // in duckdbRobustSE.computeHCMeat and computeClusterMeat above. If a future
  // refactor changes the mf CTE, this guard throws with an actionable message.
  const yhatOccurrences = sql.split(yhatSQL).length - 1;
  if (yhatOccurrences !== 2) {
    throw new Error(
      `computeTwowayClusterMeat: yhatSQL occurrence count mismatch ` +
      `(found ${yhatOccurrences}, expected 2). ` +
      `If you refactored the mf CTE, update this guard.`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < yhatOccurrences; i++) boundParams.push(...params);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const n   = num(r.n);
  const G1  = num(r.G1);
  const G2  = num(r.G2);
  const G12 = num(r.G12);
  const numParams = dim;

  const s1  = (G1  > 1) ? (G1  / (G1  - 1)) * ((n - 1) / (n - numParams)) : 1;
  const s2  = (G2  > 1) ? (G2  / (G2  - 1)) * ((n - 1) / (n - numParams)) : 1;
  const s12 = (G12 > 1) ? (G12 / (G12 - 1)) * ((n - 1) / (n - numParams)) : 1;

  const meat = Array.from({ length: dim }, () => Array(dim).fill(0));
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      const v = s1  * num(r[`m1_${j}_${l}`])
              + s2  * num(r[`m2_${j}_${l}`])
              - s12 * num(r[`m12_${j}_${l}`]);
      meat[j][l] = v;
      if (j !== l) meat[l][j] = v;
    }
  }
  return { meat, n, G1, G2, G12 };
}
