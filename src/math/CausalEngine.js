// ─── ECON STUDIO · src/math/CausalEngine.js ───────────────────────────────────
// Causal inference estimators: 2SLS/IV and Sharp RDD.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF,
} from "./LinearEngine.js";

// ─── 2SLS / IV ───────────────────────────────────────────────────────────────
// endog: endogenous regressors  |  exog: exogenous controls  |  instr: excluded instruments
export function run2SLS(rows, yCol, endog, exog, instr) {
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

  const corrSE = XtXinv.map((row, i) => {
    const v = row[i] * trueS2;
    return isFinite(v) && v >= 0 ? Math.sqrt(v) : NaN;
  });
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

// ─── SHARP RDD ───────────────────────────────────────────────────────────────
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
