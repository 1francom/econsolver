// ─── ECON STUDIO · src/services/data/duckdbWithinHAC.js ───────────────────────
// Driscoll-Kraay HAC meat-matrix for within-transformed panel data.
//
// DK aggregates cross-sectional scores per time period first:
//     S_t = Σ_i ê_{it} x̃_{it}   (vector, length k+1)
// Then applies Newey-West Bartlett kernel over the time-aggregated series:
//     meat = Γ₀ + Σ_{l=1..L} w_l (Γ_l + Γ_l')    w_l = 1 - l/(L+1)
//     Γ_l  = Σ_t S_t S_{t-l}'
//
// Auto-bandwidth: L = floor(4 · (T/100)^(2/9)) clipped to [1, T-1].
// withinCTEPrefix must project _t_h into wf (always present when timeCol given).

import { getDuckDB } from "./duckdb.js";

function num(v) {
  if (v === null || v === undefined) return NaN;
  return typeof v === "bigint" ? Number(v) : Number(v);
}

/**
 * @param {object} args
 * @param {string}   args.withinCTEPrefix  must project _t_h into wf
 * @param {number}   args.k
 * @param {number[]} args.beta
 * @param {number|null} [args.lag]         null → auto-bandwidth
 * @returns {Promise<{meat:number[][], n:number, T:number, lag:number}>}
 */
export async function computeWithinDriscollKraayMeat({
  withinCTEPrefix, k, beta, lag = null,
}) {
  const { conn } = await getDuckDB();
  const dim = k + 1;
  const xExpr = (i) => (i === 0 ? "1.0" : `_x_${i - 1}`);

  const yhatTerms = [];
  const betaParams = [];
  for (let i = 0; i < dim; i++) {
    yhatTerms.push(`? * ${xExpr(i)}`);
    betaParams.push(beta[i]);
  }
  const yhatSQL  = yhatTerms.join(" + ");
  const residSQL = `(_y_ - (${yhatSQL}))`;

  // Aggregate scores per time period
  const scoreAggs = [];
  for (let j = 0; j < dim; j++) {
    scoreAggs.push(`SUM(${residSQL} * ${xExpr(j)}) AS S_${j}`);
  }

  const sql = `${withinCTEPrefix},
    score_by_t AS (
      SELECT _t_h, COUNT(*) AS n_t, ${scoreAggs.join(", ")}
      FROM wf
      GROUP BY _t_h
      ORDER BY _t_h
    )
    SELECT _t_h, n_t, ${Array.from({ length: dim }, (_, j) => `S_${j}`).join(", ")}
    FROM score_by_t
    ORDER BY _t_h
  `;

  // residSQL appears once per scoreAgg (dim times)
  const residCount = sql.split(residSQL).length - 1;
  if (residCount !== dim) {
    throw new Error(
      `computeWithinDriscollKraayMeat: residSQL occurrence mismatch ` +
      `(found ${residCount}, expected ${dim}).`,
    );
  }
  const boundParams = [];
  for (let i = 0; i < residCount; i++) boundParams.push(...betaParams);

  const stmt = await conn.prepare(sql);
  const rows = (await stmt.query(...boundParams)).toArray();
  await stmt.close();

  const T = rows.length;
  if (T < 2) {
    throw new Error(`computeWithinDriscollKraayMeat: need T ≥ 2 (found T=${T}).`);
  }

  // S: T × dim score matrix
  const S = rows.map(r => {
    const v = new Array(dim);
    for (let j = 0; j < dim; j++) v[j] = num(r[`S_${j}`]);
    return v;
  });
  const n = rows.reduce((s, r) => s + num(r.n_t), 0);

  const L = lag != null
    ? Math.max(1, Math.min(T - 1, lag))
    : Math.max(1, Math.min(T - 1, Math.floor(4 * Math.pow(T / 100, 2 / 9))));

  // Γ_l = Σ_{t=l}^{T-1} S[t] S[t-l]'
  const gamma = (l) => {
    const G = Array.from({ length: dim }, () => Array(dim).fill(0));
    for (let t = l; t < T; t++) {
      const a = S[t];
      const b = S[t - l];
      for (let i = 0; i < dim; i++) {
        for (let j = 0; j < dim; j++) {
          G[i][j] += a[i] * b[j];
        }
      }
    }
    return G;
  };

  // Newey-West meat: Γ₀ + Σ w_l (Γ_l + Γ_l')
  const meat = gamma(0);
  for (let l = 1; l <= L; l++) {
    const w = 1 - l / (L + 1);
    const Gl = gamma(l);
    for (let i = 0; i < dim; i++) {
      for (let j = 0; j < dim; j++) {
        meat[i][j] += w * (Gl[i][j] + Gl[j][i]);
      }
    }
  }

  return { meat, n, T, lag: L };
}
