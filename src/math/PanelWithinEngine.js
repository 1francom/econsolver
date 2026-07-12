// ─── ECON STUDIO · src/math/PanelWithinEngine.js ──────────────────────────────
// Generalized N-way fixed-effect demeaning (Gaure 2013 / Correia 2017 method of
// alternating projections). Same algorithm as NonLinearEngine.js's runPoissonFEMulti
// demeanW() helper, specialized to the unweighted OLS case (W ≡ 1) and exposed as
// a standalone, reusable primitive for PanelEngine.js.
//
// For D=1 this is the classical single-pass "within" transform (subtract group
// means). For D≥2 it iterates: demean by dim 0, then dim 1, ... back to dim 0,
// until every dimension's residual group-means fall below `tol` (Gaure 2013
// proves this converges to the exact projection onto the joint FE column space,
// so a plain OLS on the residual is exact FWL — no FE dummies ever materialized).

/**
 * @param {object[]} rows - filtered rows (all feCols + all valueCols present, numeric valueCols)
 * @param {string[]} feCols - fixed-effect column names, length ≥ 1 (already includes any
 *   materialized interaction columns — see feInteraction.js)
 * @param {string[]} valueCols - numeric columns to demean (y and all x's together, so the
 *   same group means / FWL logic in a single pass)
 * @param {object} [opts]
 * @param {number} [opts.tol=1e-10] - convergence tolerance on max abs group mean
 * @param {number} [opts.maxIter=5000] - max alternating passes for D≥2
 * @returns {{ demeaned: object[], nLevels: number[], grandMeans: Record<string, number>, converged: boolean }}
 *   demeaned rows carry `__dm_<col>` for every valueCol, RE-CENTERED at the grand mean
 *   (so an OLS with intercept on the demeaned columns recovers the correct β, matching
 *   the existing PanelEngine.js convention of "subtract group mean, add back grand mean").
 *   `converged` is true if the alternating-projection loop broke below `tol` (or D===1,
 *   which is always an exact single pass); false if it exhausted `maxIter` without converging.
 */
export function demeanByFE(rows, feCols, valueCols, opts = {}) {
  const { tol = 1e-10, maxIter = 5000 } = opts;
  const D = feCols.length;
  const n = rows.length;
  if (D < 1) throw new Error("demeanByFE requires at least one fixed-effect column.");

  // Grand means — used to re-center after demeaning (preserves the OLS intercept,
  // matching PanelEngine.js's existing `d[col] = r[col] - unitMean + grandMean` convention).
  const grandMeans = {};
  valueCols.forEach(c => {
    grandMeans[c] = rows.reduce((s, r) => s + r[c], 0) / n;
  });

  // Map each FE dimension's levels to a dense integer index (0..L-1).
  const levelIdx = [];
  const nLevels = [];
  for (let d = 0; d < D; d++) {
    const map = new Map();
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const lv = rows[i][feCols[d]];
      let li = map.get(lv);
      if (li === undefined) { li = map.size; map.set(lv, li); }
      idx[i] = li;
    }
    levelIdx.push(idx);
    nLevels.push(map.size);
  }

  // Working matrix: n × m, m = valueCols.length. Start from raw values.
  const m = valueCols.length;
  const M = rows.map(r => valueCols.map(c => r[c]));

  const passOnce = () => {
    let maxMean = 0;
    for (let d = 0; d < D; d++) {
      const idx = levelIdx[d], L = nLevels[d];
      const csum = new Float64Array(L);
      const xsum = Array.from({ length: L }, () => new Float64Array(m));
      for (let i = 0; i < n; i++) {
        const li = idx[i];
        csum[li] += 1;
        const row = M[i];
        for (let j = 0; j < m; j++) xsum[li][j] += row[j];
      }
      for (let i = 0; i < n; i++) {
        const li = idx[i], cnt = csum[li];
        const row = M[i];
        for (let j = 0; j < m; j++) {
          const mean = xsum[li][j] / cnt;
          if (Math.abs(mean) > maxMean) maxMean = Math.abs(mean);
          row[j] -= mean;
        }
      }
    }
    return maxMean;
  };

  let converged = true;
  let lastMaxMean = 0;
  if (D === 1) {
    passOnce();
  } else {
    converged = false;
    for (let it = 0; it < maxIter; it++) {
      lastMaxMean = passOnce();
      if (lastMaxMean < tol) { converged = true; break; }
    }
    if (!converged) {
      console.warn(`demeanByFE: did not converge after ${maxIter} iterations (max mean ${lastMaxMean} > tol ${tol})`);
    }
  }

  const demeaned = rows.map((r, i) => {
    const d = { ...r };
    valueCols.forEach((c, j) => { d[`__dm_${c}`] = M[i][j] + grandMeans[c]; });
    return d;
  });

  return { demeaned, nLevels, grandMeans, converged };
}

/**
 * Degrees of freedom used by the FE fit: n - kReg - (sum of FE level counts
 * across dimensions, each minus 1 to avoid double-counting the intercept
 * absorbed by the first dimension) - 1 for the intercept itself.
 *
 * NOTE: this is the standard *additive* (non-collinear) FE dof count used by
 * fixest/reghdfe for FE structures with no exact nesting between dimensions.
 * If two FE dimensions are perfectly nested (e.g. "country" and "country×year"
 * both present), this OVERCOUNTS absorbed parameters and understates df. This
 * codebase does not yet implement fixest's rank-based FE dof correction — flag
 * this explicitly to Franco during Task 8's R validation: run at least one
 * fixture with two independent (non-nested) FE dims and one with a nested pair,
 * and confirm whether the simple formula below matches fixest's `nobs - fitstat`
 * degrees of freedom for both cases.
 */
export function feDegreesOfFreedom(n, kReg, nLevels) {
  const absorbed = nLevels.reduce((s, L) => s + (L - 1), 0) + 1; // +1 grand intercept
  return n - kReg - absorbed;
}
