// ─── ECON STUDIO · src/math/CausalEngine.js ───────────────────────────────────
// Causal inference estimators: 2SLS/IV, Sharp RDD, Fuzzy RDD.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF,
} from "./LinearEngine.js";
import { computeRobustSE } from "../core/inference/robustSE.js";

// ─── 2SLS / IV ───────────────────────────────────────────────────────────────
// endog: endogenous regressors  |  exog: exogenous controls  |  instr: excluded instruments
export function run2SLS(rows, yCol, endog, exog, instr, seOpts = {}) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    [...endog, ...exog, ...instr].every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < endog.length + exog.length + instr.length + 2)
    return { error: "Insufficient observations for 2SLS estimation." };

  const n = valid.length;

  // ── First stages ────────────────────────────────────────────────────────────
  const firstStages = endog.map(endVar => {
    const firstXCols = [...instr, ...exog];
    const res = runOLS(valid, endVar, firstXCols);
    if (!res) return null;

    // F-stat for instrument relevance (restricted: only exog controls)
    const restricted = exog.length > 0 ? runOLS(valid, endVar, exog) : null;
    const SSR_r = restricted
      ? restricted.SSR
      : (() => {
          const Ym = valid.map(r => r[endVar]).reduce((a, b) => a + b, 0) / n;
          return valid.map(r => r[endVar]).reduce((s, y) => s + (y - Ym) ** 2, 0);
        })();

    const q     = instr.length;
    const Fstat = ((SSR_r - res.SSR) / q) / (res.SSR / res.df);
    const Fpval = fCDF(Fstat, q, res.df);
    const weak  = Fstat < 10;                     // Stock-Yogo threshold
    return { ...res, endVar, firstXCols, Fstat, Fpval, weak };
  });

  if (firstStages.some(s => !s))
    return { error: "First-stage OLS failed — singular matrix or insufficient data." };

  // ── Second stage (augmented X̂) ───────────────────────────────────────────
  const augRows = valid.map((r, i) => {
    const aug = { ...r };
    endog.forEach((ev, j) => { aug[`__hat_${ev}`] = firstStages[j].Yhat[i]; });
    return aug;
  });
  const secondXCols = [...endog.map(ev => `__hat_${ev}`), ...exog];
  const secondRes   = runOLS(augRows, yCol, secondXCols);
  if (!secondRes)
    return { error: "Second-stage OLS failed — singular matrix." };

  // ── Corrected SE: use original X (not X̂) with IV coefficients ────────────
  // This follows the textbook IV SE formula: σ̂² = (y − Xβ_IV)′(y − Xβ_IV) / (n − k)
  const k  = 1 + endog.length + exog.length;   // intercept + regressors
  const df = n - k;
  if (df <= 0)
    return { error: "Degrees of freedom ≤ 0 — add more observations or reduce regressors." };

  const Y  = valid.map(r => r[yCol]);
  const X2 = valid.map(r => [1, ...endog.map(ev => r[ev]), ...exog.map(c => r[c])]);

  const trueResid = Y.map((y, i) =>
    y - X2[i].reduce((s, v, j) => s + v * (secondRes.beta[j] ?? 0), 0)
  );
  const trueSSR  = trueResid.reduce((s, e) => s + e * e, 0);
  const trueS2   = trueSSR / df;

  const Xt     = transpose(X2);
  const XtXinv = matInv(matMul(Xt, X2));
  if (!XtXinv)
    return { error: "Matrix is singular (check for perfect collinearity or weak instruments)." };

  const classicalSE = XtXinv.map((row, i) => {
    const v = row[i] * trueS2;
    return isFinite(v) && v >= 0 ? Math.sqrt(v) : NaN;
  });
  const robustSe = computeRobustSE(seOpts, XtXinv, X2, trueResid, n, k, valid);
  const corrSE   = robustSe ?? classicalSE;
  const corrT = secondRes.beta.map((b, i) => {
    const s = corrSE[i];
    return isFinite(b) && isFinite(s) && s > 0 ? b / s : NaN;
  });
  const corrP = corrT.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  const Ym  = Y.reduce((a, b) => a + b, 0) / n;
  const SST = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2    = SST > 0 ? 1 - trueSSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // varNames aligned with X2 column order (intercept first)
  const varNames = ["(Intercept)", ...endog, ...exog];
  const beta     = secondRes.beta.slice(0, k);
  const Yhat2SLS = X2.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));

  return {
    firstStages,
    second: {
      beta, se: corrSE, tStats: corrT, pVals: corrP,
      R2, adjR2, n, df, varNames,
      resid: trueResid,
      Yhat:  Yhat2SLS,
    },
  };
}

// ─── RDD INTERNALS ───────────────────────────────────────────────────────────

function kernelWeights(runningVals, cutoff, h, kernelType) {
  return runningVals.map(x => {
    const u = Math.abs(x - cutoff) / h;
    if (u > 1) return 0;
    if (kernelType === "triangular")    return 1 - u;
    if (kernelType === "epanechnikov") return 0.75 * (1 - u * u);
    return 1; // uniform
  });
}

function runWLS(xData, yData, weights) {
  const sqW = weights.map(w => Math.sqrt(w));
  const wX  = xData.map((row, i) => row.map(v => v * sqW[i]));
  const wY  = yData.map((v, i) => v * sqW[i]);
  const Xt  = transpose(wX);
  const XtXinv = matInv(matMul(Xt, wX));
  if (!XtXinv) return null;

  const beta  = matMul(XtXinv, matMul(Xt, wY.map(v => [v]))).map(r => r[0]);
  const yhat  = xData.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = yData.map((y, i) => y - yhat[i]);
  const n = yData.length, k = beta.length;
  const df  = n - k;
  // σ² uses UNWEIGHTED residuals: kernel weights determine β̂ efficiency,
  // not the error variance. Using weighted SSR deflates σ² by mean(W) < 1
  // (≈0.5 for triangular kernel), causing SE underestimation by ~√mean(W).
  const SSR_uw = resid.reduce((s, e) => s + e * e, 0);
  const s2     = SSR_uw / Math.max(1, df);
  const Ym  = yData.reduce((a, b) => a + b, 0) / n;
  const SST = yData.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2  = 1 - SSR_uw / SST;
  const se  = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => b / se[i]);
  const pVals  = tStats.map(t => pValue(t, df));
  return { beta, se, tStats, pVals, R2, n, df, SSR: SSR_uw, resid, yhat };
}

// ─── IK BANDWIDTH SELECTOR ───────────────────────────────────────────────────
export function ikBandwidth(runningVals, yVals, cutoff) {
  const n     = runningVals.length;
  const left  = runningVals.map((x, i) => ({ x, y: yVals[i] })).filter(d => d.x <  cutoff);
  const right = runningVals.map((x, i) => ({ x, y: yVals[i] })).filter(d => d.x >= cutoff);

  if (left.length < 5 || right.length < 5)
    return (Math.max(...runningVals) - Math.min(...runningVals)) / 4;

  const pilot = (Math.max(...runningVals) - Math.min(...runningVals)) / 4;

  const localVariance = (pts, c) => {
    const near = pts.filter(d => Math.abs(d.x - c) < pilot);
    if (near.length < 3) return { s2: 1, curv: 0.001 };
    const X = near.map(d => [1, d.x - c, (d.x - c) ** 2]);
    const Xt = transpose(X);
    const XtXinv = matInv(matMul(Xt, X));
    if (!XtXinv) return { s2: 1, curv: 0.001 };
    const beta  = matMul(XtXinv, matMul(Xt, near.map(d => [d.y]))).map(r => r[0]);
    const resid = near.map(d => d.y - (beta[0] + beta[1] * (d.x - c) + beta[2] * (d.x - c) ** 2));
    const s2    = resid.reduce((s, e) => s + e * e, 0) / Math.max(1, near.length - 3);
    return { s2, curv: Math.abs(beta[2]) || 0.001 };
  };

  const vL = localVariance(left,  cutoff);
  const vR = localVariance(right, cutoff);
  const s2   = (vL.s2   + vR.s2)   / 2;
  const curv = (vL.curv + vR.curv) / 2;
  const h    = 3.4375 * Math.pow(s2 / (curv ** 2 * n), 0.2);
  const range = Math.max(...runningVals) - Math.min(...runningVals);
  return Math.min(Math.max(h, range * 0.05), range * 0.8);
}

// ─── McCRARY DENSITY TEST ─────────────────────────────────────────────────────
// McCrary (2008) test for manipulation of the running variable in RDD.
// H₀: no discontinuity in the density of the running variable at the cutoff.
// Rejection (p < 0.05) suggests potential manipulation — observations may have
// selectively sorted across the cutoff.
//
// Algorithm (McCrary 2008, JOE):
//   1. Bin the running variable into fine equal-width bins
//   2. Compute bin frequencies (raw density estimate)
//   3. Fit a local linear regression to each side of the density using
//      a triangular kernel, evaluated at the cutoff
//   4. θ = log(f̂_R / f̂_L) — log ratio of density at c⁺ vs c⁻
//   5. SE(θ) via delta method from the WLS variance
//   6. z = θ / SE(θ), p = 2Φ(−|z|)
//
// Returns null if insufficient data (<20 obs or <5 on either side).
//
// Props:
//   rows       — dataset rows
//   runCol     — running variable column name
//   cutoff     — RDD cutoff value
//   h          — bandwidth for local linear fit (default: IK-style rule)
//   bins       — number of bins for histogram (default: auto, Freedman-Diaconis)
export function runMcCrary(rows, runCol, cutoff, h = null, bins = null) {
  // ── 1. Extract valid running variable values ─────────────────────────────
  const vals = rows
    .map(r => r[runCol])
    .filter(v => typeof v === "number" && isFinite(v));

  if (vals.length < 20) return null;

  const n    = vals.length;
  const xMin = Math.min(...vals);
  const xMax = Math.max(...vals);
  const range = xMax - xMin;
  if (range <= 0) return null;

  // Verify cutoff is interior
  if (cutoff <= xMin || cutoff >= xMax) return null;

  // ── 2. Bin width — Freedman-Diaconis rule ────────────────────────────────
  const sorted = [...vals].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(n * 0.25)];
  const q3 = sorted[Math.floor(n * 0.75)];
  const iqr = q3 - q1;

  const autoBins = iqr > 0
    ? Math.ceil(range / (2 * iqr * Math.pow(n, -1 / 3)))
    : Math.ceil(Math.sqrt(n));
  const nBins = bins ?? Math.min(Math.max(autoBins, 10), 100);
  const bw    = range / nBins;

  // ── 3. Build histogram — bin centers and normalized frequencies ──────────
  // Bins are aligned so the cutoff falls exactly on a bin boundary.
  // We shift the grid: find the bin that would contain the cutoff and align.
  const cutoffBin = Math.floor((cutoff - xMin) / bw);
  const gridStart = cutoff - cutoffBin * bw;

  const binCounts = new Array(nBins + 2).fill(0);
  vals.forEach(v => {
    const bi = Math.floor((v - gridStart) / bw);
    if (bi >= 0 && bi < binCounts.length) binCounts[bi]++;
  });

  // Convert to density: frequency / (n * bw)
  const binData = [];
  for (let i = 0; i < binCounts.length; i++) {
    const xCenter = gridStart + (i + 0.5) * bw;
    if (xCenter < xMin - bw || xCenter > xMax + bw) continue;
    const density = binCounts[i] / (n * bw);
    binData.push({ x: xCenter, density, side: xCenter < cutoff ? "left" : "right" });
  }

  const leftBins  = binData.filter(b => b.side === "left"  && b.x >= xMin);
  const rightBins = binData.filter(b => b.side === "right" && b.x <= xMax);

  if (leftBins.length < 3 || rightBins.length < 3) return null;

  // ── 4. Bandwidth for local linear fit ────────────────────────────────────
  // Default: Silverman's rule-of-thumb on the running variable
  const mean = vals.reduce((s, v) => s + v, 0) / n;
  const std  = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n);
  const hAuto = 1.06 * Math.min(std, iqr / 1.34) * Math.pow(n, -0.2);
  const hFit  = h ?? Math.max(hAuto, range * 0.1);

  // ── 5. Local linear WLS on density bins — evaluated at cutoff ────────────
  // Left side: fit density ~ (x - cutoff) with triangular kernel, eval at cutoff
  function localLinearDensity(bins, evalPt) {
    const weights = bins.map(b => {
      const u = Math.abs(b.x - evalPt) / hFit;
      return u <= 1 ? 1 - u : 0; // triangular kernel
    });

    const active = bins.map((b, i) => ({ ...b, w: weights[i] })).filter(b => b.w > 0);
    if (active.length < 3) return null;

    // WLS: density = a + b*(x - evalPt), weighted
    const xc = active.map(b => b.x - evalPt);
    const y  = active.map(b => b.density);
    const w  = active.map(b => b.w);

    const sw   = w.reduce((s, v) => s + v, 0);
    const swx  = w.reduce((s, v, i) => s + v * xc[i], 0);
    const swy  = w.reduce((s, v, i) => s + v * y[i], 0);
    const swxx = w.reduce((s, v, i) => s + v * xc[i] ** 2, 0);
    const swxy = w.reduce((s, v, i) => s + v * xc[i] * y[i], 0);

    const det = sw * swxx - swx * swx;
    if (Math.abs(det) < 1e-15) return null;

    const a = (swxx * swy - swx * swxy) / det; // intercept = f̂(evalPt)
    const b_slope = (sw * swxy - swx * swy) / det;

    // Variance of â via WLS formula: Var(â) = σ²_w * (XᵀWX)⁻¹[0,0]
    const yhat = active.map((_, i) => a + b_slope * xc[i]);
    const resid = y.map((yi, i) => yi - yhat[i]);
    // Use weighted residuals for σ²
    const sigmaW2 = active.reduce((s, b, i) => s + b.w * resid[i] ** 2, 0) /
      Math.max(1, active.length - 2);
    const varA = sigmaW2 * swxx / det;

    return { fhat: a, varFhat: varA, nActive: active.length };
  }

  const leftFit  = localLinearDensity(leftBins,  cutoff);
  const rightFit = localLinearDensity(rightBins, cutoff);

  if (!leftFit || !rightFit) return null;
  if (leftFit.fhat <= 0 || rightFit.fhat <= 0) return null;

  // ── 6. θ = log(f̂_R / f̂_L), SE via delta method ─────────────────────────
  // Var(log f̂) ≈ Var(f̂) / f̂²  (delta method)
  const theta   = Math.log(rightFit.fhat / leftFit.fhat);
  const varTheta = rightFit.varFhat / rightFit.fhat ** 2
                 + leftFit.varFhat  / leftFit.fhat  ** 2;
  const seTheta  = Math.sqrt(Math.max(0, varTheta));

  if (!isFinite(theta) || seTheta <= 0) return null;

  const zStat = theta / seTheta;
  // Two-sided p-value: 2 * Φ(-|z|) via normal approximation
  const pVal  = 2 * Math.exp(-0.5 * zStat ** 2) / Math.sqrt(2 * Math.PI) *
    // integrate tail: use complementary error function approximation
    (() => {
      // Abramowitz & Stegun 26.2.17 approximation of Φ(-|z|)
      const absZ = Math.abs(zStat);
      const t = 1 / (1 + 0.2316419 * absZ);
      const poly = t * (0.319381530
        + t * (-0.356563782
        + t * (1.781477937
        + t * (-1.821255978
        + t * 1.330274429))));
      const phi = Math.exp(-0.5 * absZ ** 2) / Math.sqrt(2 * Math.PI);
      return phi * poly * Math.sqrt(2 * Math.PI); // returns Φ(-|z|) * √(2π) / φ(z)
    })();

  // Simpler and more reliable: use normal CDF approximation directly
  const absZ = Math.abs(zStat);
  const t    = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const pNormal = 2 * Math.exp(-0.5 * absZ ** 2) / Math.sqrt(2 * Math.PI) * poly;
  const pFinal  = Math.min(1, Math.max(0, pNormal));

  // ── 7. Fit lines for plotting ─────────────────────────────────────────────
  // Local linear fit evaluated at each bin center for the density plot
  function fitLine(bins, evalPt) {
    return bins.map(b => {
      const u = Math.abs(b.x - evalPt) / hFit;
      const w = u <= 1 ? 1 - u : 0;
      return { x: b.x, w };
    }).filter(b => b.w > 0).map(b => {
      // reuse the local linear coefficients — approximate via the fit at evalPt
      // (for plotting we just use the bin densities smoothed by LOWESS-style local fit)
      return b;
    });
  }

  // For plot fit lines: evaluate local linear at each bin center
  function evalLocalLinear(bins, evalPt) {
    const h2 = hFit * 1.5; // slightly wider for smooth curve
    return bins.map(b => {
      const res = localLinearDensity(
        bins.filter(bb => Math.abs(bb.x - b.x) <= h2),
        b.x
      );
      return { x: b.x, yhat: res ? Math.max(0, res.fhat) : b.density };
    });
  }

  const leftFitLine  = evalLocalLinear(leftBins,  cutoff);
  const rightFitLine = evalLocalLinear(rightBins, cutoff);

  return {
    bins: binData,
    leftBins,
    rightBins,
    leftFit:  leftFitLine,
    rightFit: rightFitLine,
    fhatLeft:  leftFit.fhat,
    fhatRight: rightFit.fhat,
    theta,
    thetaSE:  seTheta,
    zStat,
    pVal:     pFinal,
    manipulation: pFinal < 0.05,
    h:   hFit,
    bw,
    nBins,
    cutoff,
    n,
  };
}
export function runSharpRDD(rows, yCol, runCol, cutoff, h, kernelType = "triangular", controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol]   === "number" && typeof r[runCol] === "number" &&
    isFinite(r[yCol]) && isFinite(r[runCol]) &&
    Math.abs(r[runCol] - cutoff) <= h
  );
  if (valid.length < 6) return null;

  const xc = valid.map(r => r[runCol] - cutoff);
  const D  = valid.map(r => r[runCol] >= cutoff ? 1 : 0);
  const Y  = valid.map(r => r[yCol]);
  const W  = kernelWeights(valid.map(r => r[runCol]), cutoff, h, kernelType);
  const X  = valid.map((r, i) => [1, D[i], xc[i], D[i] * xc[i], ...controls.map(c => r[c])]);

  const res = runWLS(X, Y, W);
  if (!res) return null;

  const varNames  = ["(Intercept)", "D (treatment)", "running − c", "D × (running − c)", ...controls];
  const leftFit   = valid
    .map((r, i) => ({ x: r[runCol], yhat: res.beta[0] + res.beta[2] * xc[i] }))
    .filter((_, i) => D[i] === 0);
  const rightFit  = valid
    .map((r, i) => ({ x: r[runCol], yhat: res.beta[0] + res.beta[1] + (res.beta[2] + res.beta[3]) * xc[i] }))
    .filter((_, i) => D[i] === 1);

  return {
    ...res,
    varNames,
    cutoff, h, kernelType,
    valid, xc, D, Y, W,
    leftFit, rightFit,
    late:   res.beta[1],
    lateSE: res.se[1],
    lateP:  res.pVals[1],
  };
}

// ─── FUZZY RDD ────────────────────────────────────────────────────────────────
// Fuzzy RDD: treatment take-up is imperfect at the cutoff.
// Uses the cutoff indicator as an IV for actual treatment D in a 2SLS sense,
// estimated locally via WLS with kernel weights.
//
// First stage:  D_i  ~ [1, (x-c), above, (x-c)·above]  — WLS with kernel weights
// Second stage: Y_i  ~ [D̂_i, (x-c), above, (x-c)·above] — WLS, same weights
// LATE = coefficient on D̂_i in the second stage.
//
// The local Wald ratio: τ = jump_Y / jump_D at the cutoff.
// SE: propagated from the IV sandwich (2SLS-in-a-window).
//
// Parameters:
//   rows    — data rows
//   yCol    — outcome column name
//   dCol    — treatment column name (binary or fractional, the fuzzy take-up)
//   runCol  — running variable column name
//   cutoff  — threshold value
//   opts    — { bandwidth, kernel, seOpts }
//             bandwidth = null → IK bandwidth selector
//             kernel    = "triangular" (default)
export function runFuzzyRDD(rows, yCol, dCol, runCol, cutoff, opts = {}) {
  const { bandwidth = null, kernel = "triangular", seOpts = {} } = opts;

  // ── 1. Filter valid rows ────────────────────────────────────────────────────
  const valid = rows.filter(r =>
    typeof r[yCol]   === "number" && isFinite(r[yCol])   &&
    typeof r[dCol]   === "number" && isFinite(r[dCol])   &&
    typeof r[runCol] === "number" && isFinite(r[runCol])
  );

  if (valid.length < 10)
    return { error: "Insufficient observations for Fuzzy RDD (need ≥ 10 valid rows)." };

  const runVals = valid.map(r => r[runCol]);
  const yVals   = valid.map(r => r[yCol]);

  // ── 2. Determine bandwidth ──────────────────────────────────────────────────
  // If user supplies one, use it directly.
  // Otherwise apply IK bandwidth to Y ~ running (same logic as Sharp RDD UI).
  const h = bandwidth != null
    ? Number(bandwidth)
    : ikBandwidth(runVals, yVals, cutoff);

  if (!isFinite(h) || h <= 0)
    return { error: "Bandwidth selection failed — check that the running variable has sufficient spread." };

  // ── 3. Filter to bandwidth window and compute kernel weights ─────────────────
  const inWindow = valid.filter(r => Math.abs(r[runCol] - cutoff) <= h);

  if (inWindow.length < 8)
    return { error: `Too few observations within bandwidth (h=${h.toFixed(4)}). Widen bandwidth or use more data.` };

  const xc     = inWindow.map(r => r[runCol] - cutoff);
  const above  = inWindow.map(r => r[runCol] >= cutoff ? 1 : 0);
  const D      = inWindow.map(r => r[dCol]);
  const Y      = inWindow.map(r => r[yCol]);
  const W      = kernelWeights(inWindow.map(r => r[runCol]), cutoff, h, kernel);

  const n = inWindow.length;

  // Design matrix for first stage: [1, (x-c), above, (x-c)·above]
  // Column order: intercept=0, xc=1, above=2, xcXabove=3
  const Xfs = inWindow.map((_, i) => [1, xc[i], above[i], xc[i] * above[i]]);

  // ── 4. First stage: D ~ Xfs with kernel weights ─────────────────────────────
  const firstStage = runWLS(Xfs, D, W);
  if (!firstStage)
    return { error: "First-stage WLS failed — singular matrix. Check for perfect collinearity." };

  const Dhat = firstStage.yhat; // fitted values D̂_i

  // ── 5. First-stage diagnostics ───────────────────────────────────────────────
  // F-stat: test H₀ that the above (cutoff) indicator coefficient = 0
  // restricted model: D ~ [1, xc, xc·above] (drop the 'above' indicator)
  // This tests instrument relevance — the key check for Fuzzy RDD.
  const XfsRestricted = inWindow.map((_, i) => [1, xc[i], xc[i] * above[i]]);
  const firstRestricted = runWLS(XfsRestricted, D, W);
  const qFS = 1; // one exclusion restriction (the 'above' indicator)
  const dfFS = firstStage.df;
  const fstatFS = firstRestricted && dfFS > 0
    ? ((firstRestricted.SSR - firstStage.SSR) / qFS) / (firstStage.SSR / dfFS)
    : NaN;
  const weakInstrument = isFinite(fstatFS) ? fstatFS < 10 : true; // Stock-Yogo threshold

  // First-stage jump in D at cutoff: coefficient on 'above' (column index 2)
  const firstStageJumpD = firstStage.beta[2];

  // ── 6. Second stage: Y ~ [D̂, xc, above, xc·above] with kernel weights ──────
  // Replace actual D with D̂ from the first stage
  const Xss = inWindow.map((_, i) => [Dhat[i], xc[i], above[i], xc[i] * above[i]]);

  const secondStage = runWLS(Xss, Y, W);
  if (!secondStage)
    return { error: "Second-stage WLS failed — singular matrix." };

  // ── 7. LATE (Local Average Treatment Effect) ─────────────────────────────────
  // The LATE is the coefficient on D̂ in the second stage (column index 0).
  // This is the IV/2SLS estimate of the causal effect at the cutoff.
  const late   = secondStage.beta[0];
  const lateT  = secondStage.tStats[0];
  const lateP  = secondStage.pVals[0];

  // Corrected IV SE: use unweighted residuals from Y - X_original * beta_2SLS
  // where X_original uses actual D (not D̂), following standard IV SE correction.
  const k    = 4;   // [D, xc, above, xc·above]
  const dfIV = n - k;
  if (dfIV <= 0)
    return { error: "Degrees of freedom ≤ 0 in second stage." };

  // Residuals using original D (not D̂): e_i = Y_i - [D_i, xc_i, above_i, xc_i·above_i] · β_2SLS
  const XorigSS  = inWindow.map((_, i) => [D[i], xc[i], above[i], xc[i] * above[i]]);
  const residIV  = Y.map((y, i) =>
    y - XorigSS[i].reduce((s, v, j) => s + v * secondStage.beta[j], 0)
  );
  const SSR_IV  = residIV.reduce((s, e) => s + e * e, 0);
  const s2IV    = SSR_IV / dfIV;

  // Classical IV variance: s² · (X'X)⁻¹ using the original-D design matrix
  const XtOrig    = transpose(XorigSS);
  const XtXinvIV  = matInv(matMul(XtOrig, XorigSS));

  let lateSE = secondStage.se[0]; // fallback to WLS SE
  if (XtXinvIV) {
    const varLATE = XtXinvIV[0][0] * s2IV;
    if (isFinite(varLATE) && varLATE >= 0) {
      lateSE = Math.sqrt(varLATE);
    }
  }

  // Recompute t and p with corrected SE
  const lateTCorr = isFinite(lateSE) && lateSE > 0 ? late / lateSE : lateT;
  const latePCorr = isFinite(lateTCorr) ? pValue(lateTCorr, dfIV) : lateP;

  // ── 8. Local Wald ratio for reference ────────────────────────────────────────
  // Also compute reduced-form Sharp RDD (jump in Y at cutoff ignoring D),
  // and report the Wald ratio: τ_fuzzy = jump_Y / jump_D
  const reducedForm = runSharpRDD(valid, yCol, runCol, cutoff, h, kernel);

  const jumpY = reducedForm ? reducedForm.late : NaN;
  const waldRatio = isFinite(firstStageJumpD) && Math.abs(firstStageJumpD) > 1e-10
    ? jumpY / firstStageJumpD
    : NaN;

  // ── 9. Plot data: left/right fit lines using second stage ───────────────────
  // Under the Fuzzy RDD model, the local fit at a point is:
  //   Ê[Y|x<c]  = β₀ + β₁·D̂_left(x)  + β₂·xc + β₃·0           + β₄·0
  //   Ê[Y|x≥c]  = β₀ + β₁·D̂_right(x) + β₂·xc + β₃·1           + β₄·xc
  // For plotting, we use the second-stage fitted values directly.
  const Yhat2SLS = XorigSS.map((row, i) =>
    row.reduce((s, v, j) => s + v * secondStage.beta[j], 0)
  );

  const leftFit  = inWindow
    .map((r, i) => ({ x: r[runCol], yhat: Yhat2SLS[i] }))
    .filter((_, i) => above[i] === 0);
  const rightFit = inWindow
    .map((r, i) => ({ x: r[runCol], yhat: Yhat2SLS[i] }))
    .filter((_, i) => above[i] === 1);

  // ── 10. Return result ────────────────────────────────────────────────────────
  const varNames = ["D (treatment, IV)", "running − c", "above cutoff", "D × (running − c)"];

  return {
    // Core LATE
    late,
    lateSE,
    lateT:  lateTCorr,
    lateP:  latePCorr,

    // First-stage diagnostics
    firstStageFstat:  fstatFS,
    firstStageJumpD,
    firstStageR2:     firstStage.R2,
    weak:             weakInstrument,

    // Wald ratio cross-check
    waldRatio,
    reducedForm,   // runSharpRDD result (jump in Y at cutoff)

    // Second-stage detail
    beta:    secondStage.beta,
    se:      [lateSE, ...secondStage.se.slice(1)],
    tStats:  [lateTCorr, ...secondStage.tStats.slice(1)],
    pVals:   [latePCorr, ...secondStage.pVals.slice(1)],
    R2:      secondStage.R2,
    varNames,

    // Sample info
    n,
    df:    dfIV,
    bandwidth: h,
    kernel,
    cutoff,

    // Plot data
    leftFit,
    rightFit,
    Yhat: Yhat2SLS,

    // Raw arrays for downstream use
    valid: inWindow,
    xc,
    D,
    Y,
    W,
    Dhat,
    firstStage,
    secondStage,
  };
}
