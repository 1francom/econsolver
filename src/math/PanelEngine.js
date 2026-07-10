// ─── ECON STUDIO · src/math/PanelEngine.js ────────────────────────────────────
// Panel-data estimators: Fixed Effects (within), First Differences, DiD 2×2, TWFE.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF, stars,
} from "./LinearEngine.js";
import { computeRobustSE } from "../core/inference/robustSE.js";
import { demeanByFE, feDegreesOfFreedom } from "./PanelWithinEngine.js";

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

/**
 * Filter + sort rows for panel estimation.
 * Groups by unitCol, then sorts by timeCol within each group.
 */
function prepPanel(rows, yCol, xCols, unitCol, timeCol) {
  const valid = rows
    .filter(r =>
      typeof r[yCol] === "number" && isFinite(r[yCol]) &&
      r[unitCol] != null && r[timeCol] != null &&
      xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
    )
    .sort((a, b) => {
      if (a[unitCol] < b[unitCol]) return -1;
      if (a[unitCol] > b[unitCol]) return  1;
      return a[timeCol] - b[timeCol];
    });
  const units = [...new Set(valid.map(r => r[unitCol]))];
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  return { valid, units, times };
}

// ─── FIXED EFFECTS (WITHIN), N-WAY ───────────────────────────────────────────
// feCols: array of FE column names, length ≥ 1 (e.g. ["state"] or ["state","year"]
// or ["state","year","industry"] or an interaction-materialized column name).
// Uses demeanByFE (alternating-projection within transform) so D≥2 is the exact
// two-/N-way projection, not a single-pass approximation. For D=1 (and balanced
// D=2) it is numerically identical to the classic hand-written within transform.
export function runFEMulti(rows, yCol, xCols, feCols, seOpts = {}) {
  const D = feCols.length;
  if (D < 1) return { error: "Fixed Effects estimation requires at least one FE column." };

  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    feCols.every(c => r[c] != null) &&
    xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
  );
  const nLevelsCheck = feCols.map(c => new Set(valid.map(r => r[c])).size);
  if (valid.length < xCols.length + 3 || nLevelsCheck[0] < 2)
    return { error: "Insufficient observations or units for Fixed Effects estimation." };

  const allCols = [yCol, ...xCols];
  const { demeaned, nLevels } = demeanByFE(valid, feCols, allCols);

  const dmY = `__dm_${yCol}`;
  const dmX = xCols.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmX);
  if (!res) return { error: "Within-group OLS failed — singular matrix after demeaning." };

  const df_fe = feDegreesOfFreedom(valid.length, xCols.length, nLevels);
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 after demeaning — add more observations, fewer FE dimensions, or reduce regressors." };

  const s2_fe = res.SSR / df_fe;
  const Xmat  = demeaned.map(r => [1, ...dmX.map(x => r[x])]);
  const Xt    = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const rawSE  = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  // demeaned rows retain original columns via ...r spread, so cluster col is accessible
  const robustSe = XtXinv ? computeRobustSE(seOpts, XtXinv, Xmat, res.resid, valid.length, xCols.length + 1, demeaned) : null;
  const corrSE = (robustSe ?? rawSE).map(v => (isFinite(v) ? v : NaN));
  const corrT  = res.beta.map((b, i) => (isFinite(corrSE[i]) ? b / corrSE[i] : NaN));
  const corrP  = corrT.map(t => (isFinite(t) ? pValue(t, df_fe) : NaN));

  // R² within
  const dmYvals = demeaned.map(r => r[dmY]);
  const dmYmean = dmYvals.reduce((a, b) => a + b, 0) / dmYvals.length;
  const SST_w   = dmYvals.reduce((s, v) => s + (v - dmYmean) ** 2, 0);
  const R2_within = 1 - res.SSR / SST_w;

  return {
    beta:     res.beta.slice(1),
    se:       corrSE.slice(1),
    tStats:   corrT.slice(1),
    pVals:    corrP.slice(1),
    varNames: xCols,
    R2_within,
    n:    valid.length,
    feCols,
    nLevels,          // level count per FE dimension, in feCols order
    df:   df_fe,
    SSR:  res.SSR,
    s2:   s2_fe,
    resid: res.resid,
    Yhat:  res.Yhat,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// ─── FIXED EFFECTS (WITHIN), single-way ──────────────────────────────────────
// Backward-compatible 2-arg wrapper — every existing caller keeps working.
// Old runFE demeaned by unitCol ONLY (single-way within) yet required a non-null
// timeCol via prepPanel; that valid-set requirement is preserved here so output
// is numerically identical to the pre-generalization implementation. It also
// re-computes the single-way extras the UI consumes: units count, R²-between
// (OLS on unit means), and entity intercepts α̂_i.
export function runFE(rows, yCol, xCols, unitCol, timeCol, seOpts = {}) {
  // Match old prepPanel filter: y & x numeric, unitCol non-null, timeCol non-null.
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && (timeCol == null || r[timeCol] != null) &&
    xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
  );

  const out = runFEMulti(valid, yCol, xCols, unitCol ? [unitCol] : [], seOpts);
  if (out.error) return out;

  const allCols = [yCol, ...xCols];
  const units = [...new Set(valid.map(r => r[unitCol]))];

  // Unit means (for R²-between + entity intercepts)
  const unitMeans = {};
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    allCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + r[c], 0) / sub.length;
    });
  });
  const grandY = valid.reduce((s, r) => s + r[yCol], 0) / valid.length;

  // R² between (OLS on unit means)
  const unitRows = units.map(u => {
    const row = { __by: unitMeans[u][yCol] };
    xCols.forEach(c => { row[`__bx_${c}`] = unitMeans[u][c]; });
    return row;
  });
  const bRes = runOLS(unitRows, "__by", xCols.map(c => `__bx_${c}`));

  // Entity intercepts α̂_i  (out.beta holds slope coefficients, no intercept)
  const alphas = {};
  units.forEach(u => {
    let fitted = grandY;
    xCols.forEach((c, i) => { fitted += out.beta[i] * unitMeans[u][c]; });
    alphas[u] = unitMeans[u][yCol] - (fitted - grandY);
  });

  return {
    ...out,
    units: units.length,
    R2_between: bRes?.R2 ?? null,
    alphas,
  };
}

// ─── FIRST DIFFERENCES ───────────────────────────────────────────────────────
// First-differencing is intrinsically a two-column operation: one panel-unit
// dimension to group by and one time dimension to order & difference within.
// It is NOT a group-mean demeaning operation, so it does not use demeanByFE.
// `feCols` is accepted for signature parity with the other *Multi estimators:
// feCols[0] = unit, feCols[1] = time. Any further FE dimensions are not
// meaningful for first differencing and are ignored.
export function runFDMulti(rows, yCol, xCols, feCols, seOpts = {}) {
  const unitCol = feCols[0];
  const timeCol = feCols[1];
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2) return null;

  const diffRows = [];
  units.forEach(u => {
    const sub = valid
      .filter(r => r[unitCol] === u)
      .sort((a, b) => a[timeCol] - b[timeCol]);
    for (let i = 1; i < sub.length; i++) {
      const d = { __unit: u };
      const ok = [yCol, ...xCols].every(
        c => typeof sub[i][c] === "number" && typeof sub[i - 1][c] === "number"
      );
      if (!ok) continue;
      [yCol, ...xCols].forEach(c => {
        d[`__fd_${c}`] = sub[i][c] - sub[i - 1][c];
      });
      // Carry cluster/time columns for robust SE
      if (seOpts?.clusterVar)  d[seOpts.clusterVar]  = sub[i][seOpts.clusterVar];
      if (seOpts?.clusterVar2) d[seOpts.clusterVar2] = sub[i][seOpts.clusterVar2];
      if (seOpts?.timeVar)     d[seOpts.timeVar]     = sub[i][seOpts.timeVar];
      diffRows.push(d);
    }
  });

  if (diffRows.length < xCols.length + 2) return null;
  const fdY = `__fd_${yCol}`;
  const fdX = xCols.map(c => `__fd_${c}`);
  const res = runOLS(diffRows, fdY, fdX, seOpts);
  if (!res) return null;

  // FD absorbs no explicit FE dummies (differencing removes the unit FE): the
  // only absorbed parameter is the intercept, so feDegreesOfFreedom(n, k, [])
  // === n − k − 1 === runOLS's own df. Value is unchanged from the original.
  const df = feDegreesOfFreedom(diffRows.length, xCols.length, []);

  return {
    beta:     res.beta.slice(1),
    se:       res.se.slice(1),
    tStats:   res.tStats.slice(1),
    pVals:    res.pVals.slice(1),
    varNames: xCols,
    R2:    res.R2,
    adjR2: res.adjR2,
    n:    diffRows.length,
    units: units.length,
    df,
    SSR:  res.SSR,
    resid: res.resid,
    Yhat:  res.Yhat,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// Backward-compatible wrapper — every existing caller keeps working.
export function runFD(rows, yCol, xCols, unitCol, timeCol, seOpts = {}) {
  return runFDMulti(rows, yCol, xCols, [unitCol, timeCol].filter(Boolean), seOpts);
}

// ─── DiD 2×2 ─────────────────────────────────────────────────────────────────
export function run2x2DiD(rows, yCol, postCol, treatCol, controls = [], seOpts = {}) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    (r[postCol]  === 0 || r[postCol]  === 1) &&
    (r[treatCol] === 0 || r[treatCol] === 1)
  );
  if (valid.length < 8) return null;

  const aug   = valid.map(r => ({ ...r, __did_inter: r[postCol] * r[treatCol] }));
  const xCols = [postCol, treatCol, "__did_inter", ...controls];
  const res   = runOLS(aug, yCol, xCols, seOpts);
  if (!res) return null;

  const varNames = ["(Intercept)", "Post", "Treated", "Post × Treated (ATT)", ...controls];
  const attIdx   = 3;
  const att    = res.beta[attIdx];
  const attSE  = res.se[attIdx];
  const attT   = res.tStats[attIdx];
  const attP   = res.pVals[attIdx];

  // Raw group means for the parallel-trends visual
  const means  = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  const counts = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  valid.forEach(r => {
    const key = `${r[treatCol] ? "trt" : "ctrl"}_${r[postCol] ? "post" : "pre"}`;
    means[key] += r[yCol];
    counts[key]++;
  });
  Object.keys(means).forEach(k => {
    means[k] = counts[k] > 0 ? means[k] / counts[k] : null;
  });

  return { ...res, varNames, att, attSE, attT, attP, means, n: valid.length };
}

// ─── EVENT STUDY ─────────────────────────────────────────────────────────────
/**
 * Estimates dynamic treatment effects (event study / staggered DiD).
 *
 * Model: Y_{it} = α_i + α_t + Σ_{k≠-1} β_k · D_{it}^k + ε_{it}
 *
 * @param {object[]} rows        - data rows
 * @param {string}   yCol        - outcome variable name
 * @param {string}   unitCol     - entity identifier column
 * @param {string}   timeCol     - calendar time column (numeric)
 * @param {string}   treatTimeCol - column containing treatment time per unit; null/NaN = never treated
 * @param {number}   windowPre   - number of pre-periods (e.g. 3 → k = -3,-2,-1)
 * @param {number}   windowPost  - number of post-periods (e.g. 4 → k = 0,1,2,3)
 * @param {string[]} controls    - additional control columns
 * @param {string[]} feCols      - fixed-effect columns to absorb (default [unitCol, timeCol]).
 *   timeCol is always required for the event-time construction regardless of the FE set;
 *   pass extra dims here (e.g. [unitCol, timeCol, "industry"]) to absorb additional N-way FE.
 * @param {object}   seOpts      - SE options passed to computeRobustSE
 */
export function runEventStudyMulti(
  rows,
  yCol,
  unitCol,
  timeCol,
  treatTimeCol,
  windowPre,
  windowPost,
  controls = [],
  feCols = null,
  seOpts = {}
) {
  const fe = (feCols && feCols.length) ? feCols : [unitCol, timeCol];
  // ── 1. Filter valid rows ──────────────────────────────────────────────────
  const valid = rows.filter(r =>
    typeof r[yCol]     === "number" && isFinite(r[yCol]) &&
    typeof r[timeCol]  === "number" && isFinite(r[timeCol]) &&
    r[unitCol] != null &&
    controls.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < 10) return { error: "Insufficient observations for Event Study." };

  const units = [...new Set(valid.map(r => r[unitCol]))].sort();
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  if (units.length < 2 || times.length < 2)
    return { error: "Need at least 2 units and 2 time periods for Event Study." };

  // ── 2. Compute relative time k per row ───────────────────────────────────
  // Large sentinel value for never-treated (outside any window)
  const NEVER = Infinity;
  const augmented = valid.map(r => {
    const tt = r[treatTimeCol];
    const isNeverTreated = (tt == null || !isFinite(tt));
    const k = isNeverTreated ? NEVER : r[timeCol] - tt;
    return { ...r, __k: k };
  });

  // ── 3. Build event-time dummy names ──────────────────────────────────────
  // Window: k in [-windowPre, windowPost], reference = -1 (omitted)
  // Periods strictly < -windowPre → binned into endpoint dummy "__ev_pre_bin"
  // Periods strictly > windowPost → binned into endpoint dummy "__ev_post_bin"
  const kValues = [];
  for (let k = -windowPre; k <= windowPost; k++) {
    if (k === -1) continue; // reference period — omit
    kValues.push(k);
  }

  const dummyName = k => `__ev_k${k >= 0 ? "_p" : "_m"}${Math.abs(k)}`;
  const PRE_BIN  = "__ev_pre_bin";
  const POST_BIN = "__ev_post_bin";

  // ── 4. Attach indicator columns ───────────────────────────────────────────
  const withDummies = augmented.map(r => {
    const d = { ...r };
    // All event-time dummies default to 0
    kValues.forEach(k => { d[dummyName(k)] = 0; });
    d[PRE_BIN]  = 0;
    d[POST_BIN] = 0;

    const k = r.__k;
    if (k === NEVER || k === -1) return d; // never-treated or reference period

    if (k < -windowPre) {
      d[PRE_BIN] = 1;
    } else if (k > windowPost) {
      d[POST_BIN] = 1;
    } else {
      // k is in the window and not -1
      d[dummyName(k)] = 1;
    }
    return d;
  });

  // ── 5. N-way demean for the FE set (default unit + time) ───────────────────
  // Columns that need demeaning: yCol + all event dummies + bin dummies + controls.
  // demeanByFE does the exact alternating-projection within transform; for the
  // default 2-way balanced case it reduces to the classic single-pass double demean.
  const eventDummyCols = kValues.map(dummyName);
  const binCols        = [PRE_BIN, POST_BIN];
  const varCols        = [yCol, ...eventDummyCols, ...binCols, ...controls];

  // Coerce any missing varCol values to 0 (matches the original `?? 0` semantics)
  // so demeanByFE never sees a null. Dummies default to 0; y/controls are pre-filtered.
  const cleanRows = withDummies.map(r => {
    const o = { ...r };
    varCols.forEach(c => { o[c] = r[c] ?? 0; });
    return o;
  });
  const { demeaned, nLevels, grandMeans } = demeanByFE(cleanRows, fe, varCols);
  // Recenter D≥2 columns to mean zero to match the original double-demean's
  // intercept convention (see runTWFEDiDMulti for the rationale). Slopes unaffected.
  demeaned.forEach(r => { varCols.forEach(c => { r[`__dm_${c}`] -= grandMeans[c]; }); });

  // ── 6. OLS on demeaned data ───────────────────────────────────────────────
  const regressors = [...eventDummyCols, ...binCols, ...controls];
  const dmY = `__dm_${yCol}`;
  const dmRegressors = regressors.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmRegressors);
  if (!res) return { error: "Event Study OLS failed — singular matrix after demeaning." };

  // ── 7. Correct SE for FE df ───────────────────────────────────────────────
  // Preserve the original Event Study df convention: absorbed FE params counted as
  // (Σ levels − (D − 1)) — i.e. Lu + Lt − 1 for the default 2-way case — PLUS a
  // separately-counted intercept (the trailing "− 1"). This differs by 1 from the
  // generic feDegreesOfFreedom() (which folds the intercept into the FE count); the
  // original formula is retained deliberately to keep results numerically identical.
  const k_total  = regressors.length + 1; // include intercept
  const absorbedFE = nLevels.reduce((s, L) => s + L, 0) - (nLevels.length - 1);
  const df_fe    = valid.length - absorbedFE - regressors.length - 1;
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 — reduce window or add more observations." };
  const s2_fe    = res.SSR / df_fe;

  const Xmat    = demeaned.map(r => [1, ...dmRegressors.map(c => r[c])]);
  const Xt      = transpose(Xmat);
  const XtXinv  = matInv(matMul(Xt, Xmat));
  const classicalSE = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  const robustSe = XtXinv
    ? computeRobustSE(seOpts, XtXinv, Xmat, res.resid, valid.length, k_total, demeaned)
    : null;
  const corrSE  = robustSe ?? classicalSE;
  const corrT   = res.beta.map((b, i) => (isFinite(corrSE[i]) && corrSE[i] > 0 ? b / corrSE[i] : NaN));
  const corrP   = corrT.map(t => (isFinite(t) ? pValue(t, df_fe) : NaN));

  // ── 8. Extract event coefficients β_k ─────────────────────────────────────
  // res.beta[0] is intercept; res.beta[i+1] corresponds to regressors[i]
  const eventCoeffs = kValues.map((k, i) => {
    const idx = i + 1; // offset for intercept
    return {
      k,
      beta: res.beta[idx],
      se:   corrSE[idx],
      t:    corrT[idx],
      p:    corrP[idx],
    };
  });

  // Insert reference period (k = -1) as zero by convention for plotting
  eventCoeffs.push({ k: -1, beta: 0, se: 0, t: null, p: null, isRef: true });
  eventCoeffs.sort((a, b) => a.k - b.k);

  // ── 9. Joint pre-trend F-test (k < -1) ───────────────────────────────────
  // Simple Wald test: sum of squared t-stats / count (approx chi²/df)
  const preCoeffs = eventCoeffs.filter(e => e.k < -1 && !e.isRef);
  let preTestStat = null, preTestPval = null;
  if (preCoeffs.length > 0 && XtXinv) {
    // Indices into beta vector (1-indexed) for pre-period dummies
    const preIdxs = kValues
      .map((k, i) => ({ k, i: i + 1 }))
      .filter(({ k }) => k < -1)
      .map(({ i }) => i);

    // F = (R β)' (R (X'X)^{-1} R')^{-1} (R β) / q  where R selects pre coefficients
    const q  = preIdxs.length;
    const Rb = preIdxs.map(i => res.beta[i]);
    // sub-matrix of XtXinv for pre-period rows/cols
    const subV = preIdxs.map(ri =>
      preIdxs.map(ci => XtXinv[ri][ci] * s2_fe)
    );
    const subVinv = matInv(subV);
    if (subVinv) {
      // Wald = Rb' subVinv Rb / q
      const temp = subVinv.map(row => row.reduce((s, v, j) => s + v * Rb[j], 0));
      const wald = temp.reduce((s, v, i) => s + v * Rb[i], 0) / q;
      preTestStat = wald;
      preTestPval = 1 - fCDF(wald, q, df_fe);
    }
  }

  // ── 10. Assemble output ───────────────────────────────────────────────────
  const varNames = ["(Intercept)", ...regressors];
  const R2_denom = (() => {
    const yVals  = demeaned.map(r => r[dmY]);
    const yMean  = yVals.reduce((a, b) => a + b, 0) / yVals.length;
    return yVals.reduce((s, v) => s + (v - yMean) ** 2, 0);
  })();
  const R2 = R2_denom > 0 ? 1 - res.SSR / R2_denom : null;

  return {
    // Full regression output (intercept + all regressors)
    beta:     res.beta,
    se:       corrSE,
    tStats:   corrT,
    pVals:    corrP,
    varNames,
    // Event-study specific
    eventCoeffs,          // [{ k, beta, se, t, p, isRef? }]
    preTestStat,
    preTestPval,
    // Fit statistics
    R2,
    adjR2: R2 != null ? 1 - (1 - R2) * (valid.length - 1) / Math.max(1, df_fe) : null,
    n:     valid.length,
    df:    df_fe,
    SSR:   res.SSR,
    units: units.length,
    times: times.length,
    timesArr:  times,
    windowPre,
    windowPost,
  };
}

// Backward-compatible wrapper — default FE set is unit + time (the original behaviour).
export function runEventStudy(
  rows, yCol, unitCol, timeCol, treatTimeCol, windowPre, windowPost, controls = [], seOpts = {}
) {
  return runEventStudyMulti(
    rows, yCol, unitCol, timeCol, treatTimeCol, windowPre, windowPost, controls,
    [unitCol, timeCol], seOpts
  );
}

// ─── LSDV (Least Squares Dummy Variables) ────────────────────────────────────
/**
 * Estimates Fixed Effects by explicitly including unit dummy variables in OLS.
 * Numerically identical to within-FE but also returns entity intercepts directly.
 *
 * @param {object[]} rows    - data rows
 * @param {string}   yCol    - outcome variable name
 * @param {string[]} xCols   - regressor names (excl. unit/time dummies)
 * @param {string}   unitCol - entity identifier column
 * @param {string}   timeCol - time period column
 * @param {object}   opts    - { timeFE: bool (default false) }
 * @param {object}   seOpts  - SE options passed to runOLS / computeRobustSE
 */
// N-way LSDV: one dummy block per FE dimension (first level of each dim dropped as
// reference). LSDV is the explicit-dummy method by definition, so it does NOT use
// demeanByFE. Entity intercepts α̂ are reconstructed from the FIRST FE dimension.
// For D=1 and D=2 this is numerically identical to the original unit/timeFE LSDV.
export function runLSDVMulti(rows, yCol, xCols, feCols, seOpts = {}) {
  const D = feCols.length;
  if (D < 1) return { error: "LSDV requires at least one FE column." };

  // Sort a dimension's levels: numeric asc when every level is a finite number,
  // else String asc. (For integer panels this reproduces the original ordering.)
  const sortLevels = (lv) => {
    const allNum = lv.every(v => typeof v === "number" && isFinite(v));
    return allNum
      ? [...lv].sort((a, b) => a - b)
      : [...lv].sort((a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0));
  };

  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    feCols.every(c => r[c] != null) &&
    xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );

  const feLevels = feCols.map(c => sortLevels([...new Set(valid.map(r => r[c]))]));
  const nLevels  = feLevels.map(lv => lv.length);

  // Guard matches the original heuristic: n ≥ k_reg + Σ(levels) + 2.
  if (valid.length < xCols.length + nLevels.reduce((s, L) => s + L, 0) + 2)
    return { error: "Insufficient observations for LSDV estimation." };
  if (nLevels[0] < 2)
    return { error: "LSDV requires at least 2 units." };

  // ── Build augmented rows with dummy columns (reference = first level per dim) ──
  const augRows = valid.map(r => {
    const o = { ...r };
    feCols.forEach((c, d) => {
      feLevels[d].slice(1).forEach(lv => {
        o[`__fe${d}_${lv}`] = r[c] === lv ? 1 : 0;
      });
    });
    return o;
  });

  const allDummyCols = feCols.flatMap((c, d) => feLevels[d].slice(1).map(lv => `__fe${d}_${lv}`));
  const allXCols = [...xCols, ...allDummyCols];
  const res = runOLS(augRows, yCol, allXCols, seOpts);
  if (!res) return { error: "LSDV OLS failed — singular matrix (possible perfect multicollinearity)." };

  // df = n − [1 intercept + k_reg + Σ(L_d − 1)] — feDegreesOfFreedom reproduces this exactly.
  const df = feDegreesOfFreedom(valid.length, xCols.length, nLevels);
  if (df <= 0)
    return { error: "Degrees of freedom ≤ 0 — reduce regressors or add more observations." };
  const s2 = res.SSR / df;

  // Readable varNames: generic `${col}:${level}` per dummy.
  const dummyLabels = feCols.flatMap((c, d) => feLevels[d].slice(1).map(lv => `${c}:${lv}`));
  const readableNames = ["(Intercept)", ...xCols, ...dummyLabels];

  // Entity intercepts α̂ from the FIRST FE dimension (its dummies lead the block).
  //   beta[0] = intercept = α for the reference level; other levels add their dummy.
  const alphas = {};
  alphas[feLevels[0][0]] = res.beta[0];
  feLevels[0].slice(1).forEach((lv, i) => {
    const dummyIdx = 1 + xCols.length + i; // dim-0 dummies come first among the dummy block
    alphas[lv] = res.beta[0] + res.beta[dummyIdx];
  });

  return {
    beta:     res.beta,
    se:       res.se,
    tStats:   res.tStats,
    pVals:    res.pVals,
    varNames: readableNames,
    R2:    res.R2,
    adjR2: 1 - (1 - res.R2) * (valid.length - 1) / Math.max(1, df),
    n:     valid.length,
    df,
    SSR:   res.SSR,
    s2,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
    resid: res.resid,
    Yhat:  res.Yhat,
    alphas,
    feCols,
    feLevels,    // sorted levels per FE dim (reference = feLevels[d][0])
    nLevels,
  };
}

// Backward-compatible wrapper — unit FE (+ optional time FE via opts.timeFE).
// Preserves the original valid-set (timeCol required non-null even when timeFE is off)
// and the legacy output shape (units/times/timeFE/refUnit/refTime + "unit:"/"time:" labels).
export function runLSDV(rows, yCol, xCols, unitCol, timeCol, opts = {}, seOpts = {}) {
  const timeFE = opts.timeFE ?? false;
  // Original LSDV dropped rows with a null timeCol regardless of timeFE.
  const src = timeCol != null ? rows.filter(r => r[timeCol] != null) : rows;
  const feCols = timeFE ? [unitCol, timeCol] : [unitCol];

  const out = runLSDVMulti(src, yCol, xCols, feCols, seOpts);
  if (out.error) return out;

  const units = out.feLevels[0];
  const times = timeFE
    ? out.feLevels[1]
    : [...new Set(
        src.filter(r =>
          typeof r[yCol] === "number" && isFinite(r[yCol]) &&
          r[unitCol] != null &&
          xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
        ).map(r => r[timeCol])
      )].sort((a, b) => a - b);
  const refUnit = units[0];
  const refTime = timeFE ? out.feLevels[1][0] : null;

  // Legacy varNames used literal "unit:"/"time:" prefixes rather than column names.
  const varNames = [
    "(Intercept)",
    ...xCols,
    ...units.slice(1).map(u => `unit:${u}`),
    ...(timeFE ? times.slice(1).map(t => `time:${t}`) : []),
  ];

  return { ...out, varNames, units, times, timeFE, refUnit, refTime };
}

// ─── TWFE DiD (Two-Way / N-Way Fixed Effects) ────────────────────────────────
// `feCols` is the fixed-effect set to absorb (default [unitCol, timeCol]). unitCol
// and timeCol remain explicit because they drive the parallel-trends visual
// (ever-treated grouping + per-period means) regardless of the FE set. Demeaning
// uses demeanByFE (exact N-way projection); for the default 2-way balanced case it
// reduces to the classic single-pass double demean.
export function runTWFEDiDMulti(rows, yCol, unitCol, timeCol, treatCol, controls = [], feCols = null, seOpts = {}) {
  const fe = (feCols && feCols.length) ? feCols : [unitCol, timeCol];
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null
  );
  if (valid.length < 10) return null;

  const units = [...new Set(valid.map(r => r[unitCol]))].sort();
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  if (units.length < 2 || times.length < 2) return null;

  // N-way demean of [y, treat, ...controls] (matches original `?? 0` coercion).
  const varCols = [yCol, treatCol, ...controls];
  const cleanRows = valid.map(r => {
    const o = { ...r };
    varCols.forEach(c => { o[c] = r[c] ?? 0; });
    return o;
  });
  const { demeaned, nLevels, grandMeans } = demeanByFE(cleanRows, fe, varCols);
  // demeanByFE re-centers to the grand mean (matching the D=1 within convention).
  // The original double-demean recentered D≥2 columns to mean zero; subtract the
  // grand mean back out so the intercept row is numerically identical to the
  // original TWFE. (Slopes/ATT are location-invariant and unaffected either way.)
  demeaned.forEach(r => { varCols.forEach(c => { r[`__dm_${c}`] -= grandMeans[c]; }); });

  const dmY = `__dm_${yCol}`;
  const dmTreat = `__dm_${treatCol}`;
  const dmControls = controls.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, [dmTreat, ...dmControls]);
  if (!res) return null;

  // df: remove absorbed FE. feDegreesOfFreedom(n, kReg=1+controls, nLevels) reduces
  // to the original n − (Lu+Lt−1) − controls − 1 for the default two-way case.
  const df_fe = feDegreesOfFreedom(valid.length, 1 + controls.length, nLevels);
  const s2_fe = res.SSR / Math.max(1, df_fe);

  const Xmat  = demeaned.map(r => [1, r[dmTreat], ...dmControls.map(c => r[c])]);
  const Xt    = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const classicalSE = XtXinv
    ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe)))
    : res.se;
  const twfeK    = 1 + controls.length + 1; // intercept + treatCol + controls
  const robustSe = XtXinv
    ? computeRobustSE(seOpts, XtXinv, Xmat, res.resid, valid.length, twfeK, demeaned)
    : null;
  const corrSE = robustSe ?? classicalSE;
  const corrT  = res.beta.map((b, i) => b / corrSE[i]);
  const corrP  = corrT.map(t => pValue(t, df_fe));

  const varNames = ["(Intercept)", "Treatment (ATT)", ...controls];
  const att    = res.beta[1];
  const attSE  = corrSE[1];
  const attT   = corrT[1];
  const attP   = corrP[1];

  // Identify ever-treated units (treatCol === 1 in any period)
  const everTreated = new Set(
    valid.filter(r => !!r[treatCol]).map(r => r[unitCol])
  );

  // Per-period means for event-study visual
  // ctrl = units never treated | trt = units ever treated (shown in all periods)
  const eventMeans = times.map(t => {
    const sub  = valid.filter(r => r[timeCol] === t);
    const ctrl = sub.filter(r => !everTreated.has(r[unitCol]));
    const trt  = sub.filter(r =>  everTreated.has(r[unitCol]));
    return {
      t,
      ctrl: ctrl.length > 0 ? ctrl.reduce((s, r) => s + r[yCol], 0) / ctrl.length : null,
      trt:  trt.length  > 0 ? trt.reduce((s, r)  => s + r[yCol], 0) / trt.length  : null,
    };
  });

  return {
    beta: res.beta, se: corrSE, tStats: corrT, pVals: corrP,
    varNames, att, attSE, attT, attP,
    R2: res.R2,
    adjR2: 1 - (1 - res.R2) * (valid.length - 1) / Math.max(1, df_fe),
    n: valid.length, df: df_fe,
    units: units.length, times: times.length,
    eventMeans, timesArr: times,
  };
}

// Backward-compatible wrapper — default FE set is unit + time (the original behaviour).
export function runTWFEDiD(rows, yCol, unitCol, timeCol, treatCol, controls = [], seOpts = {}) {
  return runTWFEDiDMulti(rows, yCol, unitCol, timeCol, treatCol, controls, [unitCol, timeCol], seOpts);
}
