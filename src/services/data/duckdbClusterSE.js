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
