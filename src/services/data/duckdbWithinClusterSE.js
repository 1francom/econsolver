// ─── ECON STUDIO · src/services/data/duckdbWithinClusterSE.js ─────────────────
// One-way clustered meat-matrix for within-transformed panel designs.
// Reuses withinCTEPrefix from buildWithinSuffStats. The cluster column is
// carried into wf as _g (always = unitCol per Option A in duckdbWithin.js).
// The score is s_g = Σ_{t in g} ê_{it} x̃_{it} where x̃ is already within-
// transformed in wf. Stata-equivalent small-sample correction applied here.

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}   args.withinCTEPrefix  must project _g into wf
 * @param {number}   args.k                regressor count (excl. intercept)
 * @param {number[]} args.beta             length k+1, intercept first
 * @returns {Promise<{meat:number[][], n:number, G:number}>}
 */
export async function computeWithinClusterMeat({ withinCTEPrefix, k, beta }) {
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  // ê = _y_ - Σ β_i x̃_i
  const yhatTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // Per-cluster score sums: s_g_j = Σ_{t in g} ê_{it} x̃_{it,j}
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(${residSQL} * ${xExpr(j)}) AS s_${j}`);
  }

  // Outer-product of cluster scores (upper triangle)
  const meatAggs = [];
  for (let j = 0; j < dim; j++) {
    for (let l = j; l < dim; l++) {
      meatAggs.push(`SUM(s_${j} * s_${l}) AS m_${j}_${l}`);
    }
  }

  const sql = `${withinCTEPrefix},
    clusters AS (
      SELECT _g, COUNT(*) AS _cn, ${scoreAggs.join(", ")}
      FROM wf
      GROUP BY _g
    )
    SELECT
      COUNT(*)  AS G,
      SUM(_cn)  AS n,
      ${meatAggs.join(", ")}
    FROM clusters
  `;

  // residSQL appears once per scoreAgg (dim times); each has dim β params
  const residCount = (sql.split(residSQL).length - 1);
  if (residCount !== dim) {
    throw new Error(
      `computeWithinClusterMeat: residSQL occurrence mismatch ` +
      `(found ${residCount}, expected ${dim}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < residCount; i++) boundParams.push(...betaParams);

  const stmt = await conn.prepare(sql);
  const r = (await stmt.query(...boundParams)).toArray()[0];
  await stmt.close();

  const G = num(r.G);
  const n = num(r.n);
  if (G <= 1) {
    throw new Error(
      `computeWithinClusterMeat: need G > 1 (found G=${G}). Use HC1 instead.`,
    );
  }
  // Stata small-sample correction: G/(G-1) * (n-1)/(n-k_reg-1)
  // dim = k_reg + 1 (includes intercept)
  const scale = (G / (G - 1)) * ((n - 1) / (n - dim));

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
