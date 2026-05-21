// ─── ECON STUDIO · src/math/PanelSuffStatsEngine.js ────────────────────────────
// Panel-data estimators from DuckDB sufficient statistics.
//
// Pure JS — no DuckDB import, no React.
//
// Mirrors PanelEngine.runFE / runFD numerical conventions so the SQL fast path
// and the JS path produce identical β / SE for the same data:
//   FE: within-demean + grand-mean recenter; β solved via (X'X)⁻¹X'Y on the
//       transformed cross-products. Classical σ² uses df_fe = n - G - k_reg.
//       HC1 scaling uses n / (n - k_reg - 1) to match PanelEngine.runFE
//       (which passes k_reg+1 to computeRobustSE, not the FE-adjusted dof).
//   FD: standard OLS on first differences. df = n_diff - k_reg - 1.

import { matInv, pValue, fCDF } from "./LinearEngine.js";

function solve(XtX, XtY) {
  const XtXinv = matInv(XtX);
  if (!XtXinv) return null;
  const beta = XtXinv.map(row => row.reduce((s, v, j) => s + v * XtY[j], 0));
  return { XtXinv, beta };
}

function sandwich(XtXinv, meat, scale) {
  const k = XtXinv.length;
  const tmp = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++) tmp[i][j] += XtXinv[i][l] * meat[l][j];
  const V = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < k; i++)
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++) V[i][j] += tmp[i][l] * XtXinv[l][j];
  return V.map((row, i) => Math.sqrt(Math.max(0, row[i] * scale)));
}

/**
 * Fixed Effects (within) from within-transform sufficient statistics.
 *
 * @param {object} args
 * @param {number}      args.n         observations contributing to the within fit
 * @param {number}      args.n_units   G (number of distinct entities)
 * @param {number[][]}  args.XtX       (k+1)×(k+1) cross-products of ỹ, x̃ (intercept included)
 * @param {number[]}    args.XtY       (k+1) vector
 * @param {number}      args.YtY       Σ ỹ²
 * @param {number}      args.sumY      Σ ỹ
 * @param {string[]}    args.varNames  ["(Intercept)", ...xCols]
 * @param {number[][]|null} [args.meat]   precomputed Σ êᵢ² x̃ᵢx̃ⱼ (from SQL); null = classical SE
 * @param {string|null} [args.hcType]  "HC0" | "HC1" | null
 */
export function runFEFromSuffStats({
  n, n_units, XtX, XtY, YtY, sumY, varNames,
  meat = null, hcType = null,
}) {
  if (typeof hcType === "string") hcType = hcType.toUpperCase();
  const k    = XtX.length;          // intercept + k_reg
  const kReg = k - 1;
  if (!Number.isFinite(n) || n < k + n_units) return null;
  if (!Number.isFinite(n_units) || n_units < 2) return null;

  const solved = solve(XtX, XtY);
  if (!solved) return null;
  const { XtXinv, beta } = solved;

  // SSR via algebraic identity on transformed values
  const SSR = YtY - beta.reduce((s, b, i) => s + b * XtY[i], 0);
  const df_fe = n - n_units - kReg;
  if (df_fe <= 0) return null;
  const s2 = SSR / df_fe;

  // SST_within of recentered ỹ
  const SST = YtY - (sumY * sumY) / n;
  const R2_within = SST > 0 ? 1 - SSR / SST : 0;

  let se;
  if (meat !== null) {
    // To mirror PanelEngine.runFE: HC1 scaling uses n / (n - kReg - 1),
    // NOT the FE-adjusted dof. Classical σ² still uses df_fe above.
    const dfRobust = Math.max(1, n - kReg - 1);
    const scale = hcType === "HC1" ? n / dfRobust : 1;
    se = sandwich(XtXinv, meat, scale);
  } else {
    se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  }

  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df_fe));

  const Fstat = kReg > 0 ? ((SST - SSR) / kReg) / s2 : 0;
  const Fpval = kReg > 0 ? fCDF(Fstat, kReg, df_fe)  : 1;

  // Strip intercept on the way out — matches PanelEngine.runFE return shape.
  return {
    beta:     beta.slice(1),
    se:       se.slice(1),
    tStats:   tStats.slice(1),
    pVals:    pVals.slice(1),
    varNames: varNames.slice(1),
    R2_within,
    R2_between: null,    // not computable from suff stats alone
    n,
    units: n_units,
    df:   df_fe,
    SSR,
    s2,
    resid: null,
    Yhat:  null,
    alphas: null,        // entity FEs would need a 2nd SQL pass; skip in fast path
    Fstat, Fpval,
    XtXinv,
    _betaFull: beta,     // intercept + slope; needed by the meat-pass SQL builder
    _seFull:   se,       // intercept + slope SE (validation harness convenience)
    _suffStats: true,
    _hcType: hcType,
  };
}

/**
 * Two-Way Fixed Effects from double-demean sufficient statistics.
 *
 * df = n - G_units - G_times + 1 - k_reg  (the +1 corrects for the grand mean
 * being double-counted when both unit and time dummies are included).
 * Matches PanelEngine.runTWFEDiD df convention.
 */
export function runTWFEFromSuffStats({
  n, n_units, n_times, XtX, XtY, YtY, sumY, varNames,
  meat = null, hcType = null,
}) {
  if (typeof hcType === "string") hcType = hcType.toUpperCase();
  const k    = XtX.length;
  const kReg = k - 1;
  if (!Number.isFinite(n) || !Number.isFinite(n_units) || !Number.isFinite(n_times)) return null;
  if (n_units < 2 || n_times < 2) return null;

  const solved = solve(XtX, XtY);
  if (!solved) return null;
  const { XtXinv, beta } = solved;

  const SSR = YtY - beta.reduce((s, b, i) => s + b * XtY[i], 0);
  const df_fe = n - n_units - n_times + 1 - kReg;
  if (df_fe <= 0) return null;
  const s2 = SSR / df_fe;

  const SST = YtY - (sumY * sumY) / n;
  const R2_within = SST > 0 ? 1 - SSR / SST : 0;

  let se;
  if (meat !== null) {
    // HC1 scaling matches PanelEngine.runTWFEDiD (n / (n - kReg - 1))
    const dfRobust = Math.max(1, n - kReg - 1);
    const scale = hcType === "HC1" ? n / dfRobust : 1;
    se = sandwich(XtXinv, meat, scale);
  } else {
    se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  }

  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df_fe));

  const Fstat = kReg > 0 ? ((SST - SSR) / kReg) / s2 : 0;
  const Fpval = kReg > 0 ? fCDF(Fstat, kReg, df_fe)  : 1;

  return {
    beta:     beta.slice(1),
    se:       se.slice(1),
    tStats:   tStats.slice(1),
    pVals:    pVals.slice(1),
    varNames: varNames.slice(1),
    R2_within,
    R2_between: null,
    n,
    units: n_units,
    times: n_times,
    df:   df_fe,
    SSR,
    s2,
    resid: null,
    Yhat:  null,
    alphas: null,
    timeFE: null,
    Fstat, Fpval,
    XtXinv,
    _betaFull: beta,
    _seFull:   se,
    _suffStats: true,
    _hcType: hcType,
  };
}

/**
 * First Differences from differenced sufficient statistics.
 *
 * @param {object} args  — same shape as runFEFromSuffStats minus units gating.
 *                          n is the number of valid differences (n_diff).
 */
export function runFDFromSuffStats({
  n, n_units, XtX, XtY, YtY, sumY, varNames,
  meat = null, hcType = null,
}) {
  if (typeof hcType === "string") hcType = hcType.toUpperCase();
  const k    = XtX.length;
  const kReg = k - 1;
  if (!Number.isFinite(n) || n < k + 1) return null;

  const solved = solve(XtX, XtY);
  if (!solved) return null;
  const { XtXinv, beta } = solved;

  const SSR = YtY - beta.reduce((s, b, i) => s + b * XtY[i], 0);
  const df  = n - k;            // standard OLS df on diffs
  if (df <= 0) return null;
  const s2  = SSR / df;

  const SST = YtY - (sumY * sumY) / n;
  const R2  = SST > 0 ? 1 - SSR / SST : 0;
  const adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, df);

  let se;
  if (meat !== null) {
    const scale = hcType === "HC1" ? n / Math.max(1, df) : 1;
    se = sandwich(XtXinv, meat, scale);
  } else {
    se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  }

  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df));

  const Fstat = kReg > 0 ? ((SST - SSR) / kReg) / s2 : 0;
  const Fpval = kReg > 0 ? fCDF(Fstat, kReg, df)    : 1;

  return {
    beta:     beta.slice(1),
    se:       se.slice(1),
    tStats:   tStats.slice(1),
    pVals:    pVals.slice(1),
    varNames: varNames.slice(1),
    R2, adjR2,
    n,
    units: n_units,
    df,
    SSR,
    s2,
    resid: null,
    Yhat:  null,
    Fstat, Fpval,
    XtXinv,
    _betaFull: beta,     // intercept + slope; needed by the meat-pass SQL builder
    _seFull:   se,       // intercept + slope SE (validation harness convenience)
    _suffStats: true,
    _hcType: hcType,
  };
}
