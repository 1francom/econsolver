// ─── ECON STUDIO · src/math/SyntheticControlEngine.js ────────────────────────
// Abadie-Diamond-Hainmueller (2010) Synthetic Control estimator.
// Pure JS — no React, no side effects, no external imports.
//
// Overview:
//   Constructs a convex combination of donor units (W ≥ 0, ΣW = 1) that
//   minimises the pre-treatment outcome distance to the treated unit.
//   Optimisation via Frank-Wolfe projected gradient (simplex-constrained).
//
// Post-treatment gap:
//   gap_t = Y1_post[t] − Y0_post @ W
//
// Inference: in-space placebo — for each donor acting as "fake treated",
//   run SCM against remaining donors, collect RMSPE_pre and post-period gaps.
//   p-value = fraction of placebos (filtered by RMSPE_pre < 2×treated) with
//   mean |gap| ≥ treated mean |gap|.
//
// References:
//   Abadie, Diamond, Hainmueller (2010). Synthetic Control Methods for
//   Comparative Case Studies. JASA 105(490):493-505.

// ─── LINEAR ALGEBRA HELPERS ───────────────────────────────────────────────────

/** Dot product of two equal-length arrays. */
function dot(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
}

/**
 * Matrix-vector product  A @ v.
 * A is (rows × cols) stored as Float64Array[] of length rows.
 * v is Float64Array of length cols.
 * Returns Float64Array of length rows.
 */
function matvec(A, v) {
  const m = A.length;
  const out = new Float64Array(m);
  for (let i = 0; i < m; i++) out[i] = dot(A[i], v);
  return out;
}

/**
 * Transpose-matrix-vector product  A' @ v.
 * A is (m × n), v is length-m.  Returns length-n array.
 */
function matvecT(A, v) {
  const m = A.length;
  const n = A[0].length;
  const out = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const vi = v[i];
    if (vi === 0) continue;
    const row = A[i];
    for (let j = 0; j < n; j++) out[j] += row[j] * vi;
  }
  return out;
}

/** Squared Euclidean norm of a typed array. */
function normSq(v) {
  let s = 0;
  for (let i = 0; i < v.length; i++) s += v[i] * v[i];
  return s;
}

/** Clamp all entries of w to [0, 1] and renormalise to sum=1 (simplex projection shortcut). */
function projectSimplex(w) {
  let sum = 0;
  for (let j = 0; j < w.length; j++) {
    if (w[j] < 0) w[j] = 0;
    sum += w[j];
  }
  if (sum === 0) {
    // degenerate — reset to uniform
    const u = 1 / w.length;
    for (let j = 0; j < w.length; j++) w[j] = u;
  } else {
    for (let j = 0; j < w.length; j++) w[j] /= sum;
  }
}

// ─── FRANK-WOLFE OPTIMIZER ────────────────────────────────────────────────────

/**
 * Minimise  f(w) = ||r - A @ w||²  subject to  w ≥ 0, Σwj = 1
 * using Frank-Wolfe with closed-form line search.
 *
 * @param {Float64Array[]} A  — (m × J) matrix (column = donor time-series)
 * @param {Float64Array}   r  — (m,) target vector (treated unit)
 * @param {number}         maxIter
 * @param {number}         tol
 * @returns {Float64Array} w  — optimal simplex weights
 */
function frankWolfe(A, r, maxIter, tol) {
  const J = A[0].length; // number of donors

  // Initialise: uniform weights
  const w = new Float64Array(J);
  const init = 1 / J;
  for (let j = 0; j < J; j++) w[j] = init;

  for (let iter = 0; iter < maxIter; iter++) {
    // Residual: res = r - A @ w
    const Aw  = matvec(A, w);
    const res = new Float64Array(r.length);
    for (let i = 0; i < r.length; i++) res[i] = r[i] - Aw[i];

    // Gradient: g = -2 * A' @ res  (of the objective w.r.t. w)
    const g = matvecT(A, res);          // A' @ res  (length J)
    // Frank-Wolfe: gradient of objective = -2 * A' @ res, so we seek j* = argmin_j grad_j
    //   grad_obj_j = -2 * (A' @ res)_j  → argmin is argmax of (A' @ res)_j
    let jStar = 0;
    let best  = g[0];
    for (let j = 1; j < J; j++) {
      if (g[j] > best) { best = g[j]; jStar = j; }
    }

    // Direction: d = e_{j*} - w
    const d = new Float64Array(J);
    for (let j = 0; j < J; j++) d[j] = -w[j];
    d[jStar] += 1;

    // Closed-form line search: γ* = argmin_γ ||res - γ*(A@d)||²  clamped to [0,1]
    // = (res · Ad) / ||Ad||²  clamped to [0,1]
    const Ad     = matvec(A, d);
    const AdSq   = normSq(Ad);

    let gamma;
    if (AdSq < 1e-14) {
      break; // direction has no effect — converged
    } else {
      gamma = dot(res, Ad) / AdSq;
      if (gamma < 0) gamma = 0;
      if (gamma > 1) gamma = 1;
    }

    // Check convergence: Frank-Wolfe gap = g · (w - e_{j*}) / 2  (≥ 0)
    // Equivalent: |γ| * ||d||₂ < tol
    const stepSize = gamma * Math.sqrt(normSq(d));
    if (stepSize < tol) break;

    // Update w
    for (let j = 0; j < J; j++) w[j] += gamma * d[j];

    // Project to simplex (safety — FW should stay in simplex, but floating point)
    projectSimplex(w);
  }

  return w;
}

// ─── DATA HELPERS ─────────────────────────────────────────────────────────────

/**
 * Build pre/post matrices for a single treated unit vs. a donor pool.
 *
 * @param {Object[]}   rows
 * @param {string}     yCol
 * @param {string}     unitCol
 * @param {string}     timeCol
 * @param {string}     treatedUnit
 * @param {number}     treatTime
 * @param {string[]}   donorIds
 * @param {string[]}   predictorCols
 * @returns {{ Y1_pre, Y1_post, Y0_pre, Y0_post, preTimes, postTimes, donors }}
 */
function buildMatrices(rows, yCol, unitCol, timeCol, treatedUnit, treatTime, donorIds, predictorCols) {
  // Group rows by unit
  const byUnit = new Map();
  for (const row of rows) {
    const u = row[unitCol];
    if (!byUnit.has(u)) byUnit.set(u, []);
    byUnit.get(u).push(row);
  }

  // Sort each unit's rows by time
  for (const [, arr] of byUnit) {
    arr.sort((a, b) => a[timeCol] - b[timeCol]);
  }

  // Collect all time periods present in the treated unit
  const treatedRows = byUnit.get(treatedUnit) ?? [];
  const allTimes = treatedRows.map(r => r[timeCol]);
  const preTimes  = allTimes.filter(t => t < treatTime);
  const postTimes = allTimes.filter(t => t >= treatTime);

  if (preTimes.length === 0) throw new Error("No pre-treatment periods found for treated unit.");
  if (postTimes.length === 0) throw new Error("No post-treatment periods found for treated unit.");

  // Helper: lookup value for unit u at time t, returns NaN if missing
  function val(unit, t) {
    const uRows = byUnit.get(unit) ?? [];
    const row   = uRows.find(r => r[timeCol] === t);
    return row ? (typeof row[yCol] === "number" ? row[yCol] : NaN) : NaN;
  }

  // Helper: mean of a predictor over pre-period for a unit
  function predMean(unit, col) {
    const uRows = byUnit.get(unit) ?? [];
    const vals  = uRows
      .filter(r => r[timeCol] < treatTime && typeof r[col] === "number" && isFinite(r[col]))
      .map(r => r[col]);
    return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : NaN;
  }

  // Build Y1_pre and Y1_post
  const Y1_pre  = new Float64Array(preTimes.map(t => val(treatedUnit, t)));
  const Y1_post = new Float64Array(postTimes.map(t => val(treatedUnit, t)));

  // Validate — skip donors with any missing pre-period outcome
  const validDonors = donorIds.filter(d => {
    for (const t of preTimes) {
      const v = val(d, t);
      if (!isFinite(v)) return false;
    }
    return true;
  });

  if (validDonors.length === 0) throw new Error("No valid donors with complete pre-treatment data.");

  // Y0_pre: (prePeriods [+ predictors] × donors)
  // Stack outcome rows first, then one row per predictor (means)
  const nPre      = preTimes.length;
  const nPred     = predictorCols.length;
  const totalRows = nPre + nPred;
  const J         = validDonors.length;

  const Y0_pre  = Array.from({ length: totalRows }, () => new Float64Array(J));
  const Y0_post = Array.from({ length: postTimes.length }, () => new Float64Array(J));

  for (let j = 0; j < J; j++) {
    const d = validDonors[j];
    // outcome rows
    for (let t = 0; t < nPre; t++) {
      Y0_pre[t][j] = val(d, preTimes[t]);
    }
    // predictor rows (means)
    for (let p = 0; p < nPred; p++) {
      Y0_pre[nPre + p][j] = predMean(d, predictorCols[p]);
    }
    // post-treatment outcomes
    for (let t = 0; t < postTimes.length; t++) {
      const v = val(d, postTimes[t]);
      Y0_post[t][j] = isFinite(v) ? v : 0; // fill post-period gaps with 0 for donors
    }
  }

  // Extend Y1_pre with predictor means if applicable
  let Y1_preExt = Y1_pre;
  if (nPred > 0) {
    Y1_preExt = new Float64Array(totalRows);
    for (let i = 0; i < nPre; i++) Y1_preExt[i] = Y1_pre[i];
    for (let p = 0; p < nPred; p++) {
      Y1_preExt[nPre + p] = predMean(treatedUnit, predictorCols[p]);
    }
  }

  return { Y1_pre: Y1_preExt, Y1_post, Y0_pre, Y0_post, preTimes, postTimes, donors: validDonors };
}

// ─── RMSPE ───────────────────────────────────────────────────────────────────

/**
 * Root mean squared prediction error of the synthetic fit.
 * Operates only on the first nOutcomeRows rows (pure Y, ignoring predictor rows).
 */
function computeRMSPE(Y1, Y0, w, nRows) {
  let sse = 0;
  for (let i = 0; i < nRows; i++) {
    const synth = dot(Y0[i], w);
    const diff  = Y1[i] - synth;
    sse += diff * diff;
  }
  return Math.sqrt(sse / nRows);
}

// ─── MAIN ESTIMATOR ───────────────────────────────────────────────────────────

/**
 * runSyntheticControl — Abadie-Diamond-Hainmueller Synthetic Control.
 *
 * @param {Object[]} rows         — panel data rows
 * @param {string}   yCol         — outcome variable name
 * @param {string}   unitCol      — entity identifier column
 * @param {string}   timeCol      — time period column (numeric)
 * @param {string}   treatedUnit  — value of unitCol for the treated unit
 * @param {number}   treatTime    — time when treatment begins (inclusive)
 * @param {Object}   [opts]
 * @param {string[]} [opts.predictorCols=[]]  — extra predictor columns to match on
 * @param {number}   [opts.maxIter=1000]      — Frank-Wolfe iterations
 * @param {number}   [opts.tol=1e-8]          — convergence tolerance
 * @returns {SyntheticControlResult}
 */
export function runSyntheticControl(rows, yCol, unitCol, timeCol, treatedUnit, treatTime, opts = {}) {
  const predictorCols = opts.predictorCols ?? [];
  const maxIter       = opts.maxIter       ?? 1000;
  const tol           = opts.tol           ?? 1e-8;

  // ── 1. Identify donor pool ────────────────────────────────────────────────
  const allUnits = [...new Set(rows.map(r => r[unitCol]))];
  const donorIds = allUnits.filter(u => u !== treatedUnit);

  if (donorIds.length === 0) throw new Error("No donor units found in the dataset.");

  // ── 2. Build matrices ─────────────────────────────────────────────────────
  const { Y1_pre, Y1_post, Y0_pre, Y0_post, preTimes, postTimes, donors } =
    buildMatrices(rows, yCol, unitCol, timeCol, treatedUnit, treatTime, donorIds, predictorCols);

  const nOutcomeRows = preTimes.length; // rows that are pure Y (not predictors)

  // ── 3. Optimise weights (Frank-Wolfe) ─────────────────────────────────────
  const W = frankWolfe(Y0_pre, Y1_pre, maxIter, tol);

  // ── 4. Compute pre-fit ────────────────────────────────────────────────────
  const rmspe_pre = computeRMSPE(Y1_pre, Y0_pre, W, nOutcomeRows);

  const preFit = preTimes.map((t, i) => ({
    t,
    actual:    Y1_pre[i],
    synthetic: dot(Y0_pre[i], W),
  }));

  // ── 5. Compute post-treatment gap ─────────────────────────────────────────
  let sse_post = 0;
  const postGap = postTimes.map((t, i) => {
    const actual    = Y1_post[i];
    const synthetic = dot(Y0_post[i], W);
    const gap       = actual - synthetic;
    sse_post += gap * gap;
    return { t, actual, synthetic, gap };
  });
  const rmspe_post = Math.sqrt(sse_post / postTimes.length);
  const treatedAvgAbsGap = postGap.reduce((s, d) => s + Math.abs(d.gap), 0) / postGap.length;

  // ── 6. In-space placebo inference ─────────────────────────────────────────
  const placebos = [];
  for (const fakeUnit of donors) {
    try {
      const remainingDonors = donors.filter(d => d !== fakeUnit);
      if (remainingDonors.length === 0) continue;

      const pb = buildMatrices(
        rows, yCol, unitCol, timeCol,
        fakeUnit, treatTime,
        remainingDonors, predictorCols,
      );

      const pbW        = frankWolfe(pb.Y0_pre, pb.Y1_pre, maxIter, tol);
      const pbRmspe    = computeRMSPE(pb.Y1_pre, pb.Y0_pre, pbW, pb.preTimes.length);
      const pbPostGap  = pb.postTimes.map((t, i) => ({
        t,
        gap: pb.Y1_post[i] - dot(pb.Y0_post[i], pbW),
      }));

      placebos.push({ unit: fakeUnit, gaps: pbPostGap, rmspe_pre: pbRmspe });
    } catch {
      // Silently skip placebos that fail (e.g. insufficient pre-period data)
    }
  }

  // ── 7. p-value (Abadie filter: RMSPE_pre < 2 × treated RMSPE_pre) ────────
  const filtered = placebos.filter(pb => pb.rmspe_pre < 2 * rmspe_pre);
  let exceedCount = 0;
  for (const pb of filtered) {
    const avgAbs = pb.gaps.reduce((s, d) => s + Math.abs(d.gap), 0) / (pb.gaps.length || 1);
    if (avgAbs >= treatedAvgAbsGap) exceedCount++;
  }
  const pValue = filtered.length > 0 ? exceedCount / filtered.length : NaN;

  // ── 8. Build weights map ──────────────────────────────────────────────────
  const weights = {};
  for (let j = 0; j < donors.length; j++) {
    weights[donors[j]] = W[j];
  }

  return {
    weights,
    preFit,
    postGap,
    rmspe_pre,
    rmspe_post,
    placebos,
    pValue,
    donors,
    treatedUnit,
    treatTime,
  };
}
