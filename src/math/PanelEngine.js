// ─── ECON STUDIO · src/math/PanelEngine.js ────────────────────────────────────
// Panel-data estimators: Fixed Effects (within), First Differences, DiD 2×2, TWFE.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF, stars,
} from "./LinearEngine.js";
import { computeRobustSE } from "../core/inference/robustSE.js";

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

// ─── FIXED EFFECTS (WITHIN) ──────────────────────────────────────────────────
export function runFE(rows, yCol, xCols, unitCol, timeCol, seOpts = {}) {
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2)
    return { error: "Insufficient observations or units for Fixed Effects estimation." };

  const allCols = [yCol, ...xCols];

  // Unit means (for within-transformation)
  const unitMeans = {};
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    allCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + r[c], 0) / sub.length;
    });
  });

  // Grand means (re-centre after demeaning to preserve intercept in OLS)
  const grandMeans = {};
  allCols.forEach(c => {
    grandMeans[c] = valid.reduce((s, r) => s + r[c], 0) / valid.length;
  });

  // Within-demean
  const demeaned = valid.map(r => {
    const d = { ...r };
    allCols.forEach(c => {
      d[`__dm_${c}`] = r[c] - unitMeans[r[unitCol]][c] + grandMeans[c];
    });
    return d;
  });

  const dmY = `__dm_${yCol}`;
  const dmX = xCols.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmX);
  if (!res) return { error: "Within-group OLS failed — singular matrix after demeaning." };

  const df_fe = valid.length - units.length - xCols.length;
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 after demeaning — add more observations or reduce regressors." };

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

  // R² between (OLS on unit means)
  const unitRows = units.map(u => {
    const row = { __by: unitMeans[u][yCol] };
    xCols.forEach(c => { row[`__bx_${c}`] = unitMeans[u][c]; });
    return row;
  });
  const bRes = runOLS(unitRows, "__by", xCols.map(c => `__bx_${c}`));

  // Entity intercepts α̂_i
  const alphas = {};
  units.forEach(u => {
    let fitted = grandMeans[yCol];
    xCols.forEach((c, i) => { fitted += res.beta[i + 1] * unitMeans[u][c]; });
    alphas[u] = unitMeans[u][yCol] - (fitted - grandMeans[yCol]);
  });

  return {
    beta:     res.beta.slice(1),
    se:       corrSE.slice(1),
    tStats:   corrT.slice(1),
    pVals:    corrP.slice(1),
    varNames: xCols,
    R2_within,
    R2_between: bRes?.R2 ?? null,
    n:    valid.length,
    units: units.length,
    df:   df_fe,
    SSR:  res.SSR,
    s2:   s2_fe,
    resid: res.resid,
    Yhat:  res.Yhat,
    alphas,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
}

// ─── FIRST DIFFERENCES ───────────────────────────────────────────────────────
export function runFD(rows, yCol, xCols, unitCol, timeCol, seOpts = {}) {
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
    df:   res.df,
    SSR:  res.SSR,
    resid: res.resid,
    Yhat:  res.Yhat,
    Fstat: res.Fstat,
    Fpval: res.Fpval,
  };
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
 * @param {object}   seOpts      - SE options passed to computeRobustSE
 */
export function runEventStudy(
  rows,
  yCol,
  unitCol,
  timeCol,
  treatTimeCol,
  windowPre,
  windowPost,
  controls = [],
  seOpts = {}
) {
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

  // ── 5. Double-demean for unit + time FE ───────────────────────────────────
  // Columns that need demeaning: yCol + all event dummies + bin dummies + controls
  const eventDummyCols = kValues.map(dummyName);
  const binCols        = [PRE_BIN, POST_BIN];
  const varCols        = [yCol, ...eventDummyCols, ...binCols, ...controls];

  const grandMeans = {}, unitMeans = {}, timeMeans = {};

  varCols.forEach(c => {
    grandMeans[c] = withDummies.reduce((s, r) => s + (r[c] ?? 0), 0) / withDummies.length;
  });
  units.forEach(u => {
    const sub = withDummies.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    varCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });
  times.forEach(t => {
    const sub = withDummies.filter(r => r[timeCol] === t);
    timeMeans[t] = {};
    varCols.forEach(c => {
      timeMeans[t][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });

  const demeaned = withDummies.map(r => {
    const d = { [unitCol]: r[unitCol], [timeCol]: r[timeCol] };
    if (seOpts?.clusterVar)  d[seOpts.clusterVar]  = r[seOpts.clusterVar];
    if (seOpts?.clusterVar2) d[seOpts.clusterVar2] = r[seOpts.clusterVar2];
    if (seOpts?.timeVar)     d[seOpts.timeVar]     = r[seOpts.timeVar];
    varCols.forEach(c => {
      d[c] = (r[c] ?? 0)
        - (unitMeans[r[unitCol]][c] ?? 0)
        - (timeMeans[r[timeCol]][c] ?? 0)
        + grandMeans[c];
    });
    return d;
  });

  // ── 6. OLS on demeaned data ───────────────────────────────────────────────
  const regressors = [...eventDummyCols, ...binCols, ...controls];
  const res = runOLS(demeaned, yCol, regressors);
  if (!res) return { error: "Event Study OLS failed — singular matrix after demeaning." };

  // ── 7. Correct SE for FE df ───────────────────────────────────────────────
  const k_total  = regressors.length + 1; // include intercept
  const df_fe    = valid.length - (units.length + times.length - 1) - regressors.length - 1;
  if (df_fe <= 0)
    return { error: "Degrees of freedom ≤ 0 — reduce window or add more observations." };
  const s2_fe    = res.SSR / df_fe;

  const Xmat    = demeaned.map(r => [1, ...regressors.map(c => r[c])]);
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
    const yVals  = demeaned.map(r => r[yCol]);
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
export function runLSDV(rows, yCol, xCols, unitCol, timeCol, opts = {}, seOpts = {}) {
  const timeFE = opts.timeFE ?? false;

  // ── 1. Filter valid rows ──────────────────────────────────────────────────
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null &&
    xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );

  const units = [...new Set(valid.map(r => r[unitCol]))].sort((a, b) =>
    String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0
  );
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);

  if (valid.length < xCols.length + units.length + (timeFE ? times.length : 0) + 2)
    return { error: "Insufficient observations for LSDV estimation." };
  if (units.length < 2)
    return { error: "LSDV requires at least 2 units." };

  // ── 2. Reference categories ───────────────────────────────────────────────
  const refUnit = units[0];
  const refTime = timeFE ? times[0] : null;

  // ── 3. Build augmented rows with dummy columns ────────────────────────────
  const unitDummyCols = units.slice(1).map(u => `__unit_${u}`);
  const timeDummyCols = timeFE ? times.slice(1).map(t => `__time_${t}`) : [];

  const augRows = valid.map(r => {
    const d = { ...r };
    // Unit dummies (reference = first unit, omitted)
    units.slice(1).forEach(u => {
      d[`__unit_${u}`] = r[unitCol] === u ? 1 : 0;
    });
    // Time dummies (reference = first time period, omitted)
    if (timeFE) {
      times.slice(1).forEach(t => {
        d[`__time_${t}`] = r[timeCol] === t ? 1 : 0;
      });
    }
    return d;
  });

  // ── 4. Run OLS on augmented data ──────────────────────────────────────────
  const allXCols = [...xCols, ...unitDummyCols, ...timeDummyCols];
  const res = runOLS(augRows, yCol, allXCols, seOpts);
  if (!res) return { error: "LSDV OLS failed — singular matrix (possible perfect multicollinearity)." };

  // ── 5. Correct df ─────────────────────────────────────────────────────────
  // k = 1 (intercept) + xCols.length + (units-1) + (if timeFE, times-1)
  const k = 1 + xCols.length + (units.length - 1) + (timeFE ? times.length - 1 : 0);
  const df = valid.length - k;
  if (df <= 0)
    return { error: "Degrees of freedom ≤ 0 — reduce regressors or add more observations." };

  // Recompute s2 with corrected df (runOLS uses n - k_internal which may differ if
  // allXCols includes dummies already counted — in practice they are identical here,
  // but be explicit for clarity)
  const s2 = res.SSR / df;

  // ── 6. Build readable varNames ────────────────────────────────────────────
  // res.varNames from runOLS = ["(Intercept)", ...allXCols]
  const readableNames = [
    "(Intercept)",
    ...xCols,
    ...units.slice(1).map(u => `unit:${u}`),
    ...(timeFE ? times.slice(1).map(t => `time:${t}`) : []),
  ];

  // ── 7. Extract entity intercepts α̂_i ─────────────────────────────────────
  // beta[0] = intercept = α for reference unit
  // For unit u at position i among non-reference units:
  //   α_u = beta[0] + beta[xCols.length + 1 + i]
  const alphas = {};
  alphas[refUnit] = res.beta[0];
  units.slice(1).forEach((u, i) => {
    const dummyIdx = 1 + xCols.length + i; // 1-based index into beta (after intercept)
    alphas[u] = res.beta[0] + res.beta[dummyIdx];
  });

  // ── 8. Assemble output ────────────────────────────────────────────────────
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
    units,
    times,
    timeFE,
    refUnit,
    refTime,
  };
}

// ─── TWFE DiD (Two-Way Fixed Effects) ────────────────────────────────────────
export function runTWFEDiD(rows, yCol, unitCol, timeCol, treatCol, controls = [], seOpts = {}) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null
  );
  if (valid.length < 10) return null;

  const units = [...new Set(valid.map(r => r[unitCol]))].sort();
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  if (units.length < 2 || times.length < 2) return null;

  // Compute grand, unit, and time means for double-demeaning
  const varCols = [yCol, treatCol, ...controls];
  const grandMeans = {}, unitMeans = {}, timeMeans = {};

  varCols.forEach(c => {
    grandMeans[c] = valid.reduce((s, r) => s + (r[c] ?? 0), 0) / valid.length;
  });
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    varCols.forEach(c => {
      unitMeans[u][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });
  times.forEach(t => {
    const sub = valid.filter(r => r[timeCol] === t);
    timeMeans[t] = {};
    varCols.forEach(c => {
      timeMeans[t][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length;
    });
  });

  const demeaned = valid.map(r => {
    const d = { [unitCol]: r[unitCol], [timeCol]: r[timeCol] };
    if (seOpts?.clusterVar)  d[seOpts.clusterVar]  = r[seOpts.clusterVar];
    if (seOpts?.clusterVar2) d[seOpts.clusterVar2] = r[seOpts.clusterVar2];
    if (seOpts?.timeVar)     d[seOpts.timeVar]     = r[seOpts.timeVar];
    varCols.forEach(c => {
      d[c] = (r[c] ?? 0)
        - (unitMeans[r[unitCol]][c] ?? 0)
        - (timeMeans[r[timeCol]][c] ?? 0)
        + grandMeans[c];
    });
    return d;
  });

  const res = runOLS(demeaned, yCol, [treatCol, ...controls]);
  if (!res) return null;

  // Correct df: remove unit + time FE from denominator
  const df_fe = valid.length - (units.length + times.length - 1) - controls.length - 1;
  const s2_fe = res.SSR / Math.max(1, df_fe);

  const Xmat  = demeaned.map(r => [1, r[treatCol], ...controls.map(c => r[c])]);
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
