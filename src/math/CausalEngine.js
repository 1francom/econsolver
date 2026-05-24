// ─── ECON STUDIO · src/math/CausalEngine.js ───────────────────────────────────
// Causal inference estimators: 2SLS/IV, Sharp RDD, Fuzzy RDD.
// No React. No side effects. Depends only on LinearEngine.js.

import {
  transpose, matMul, matInv,
  runOLS, pValue, fCDF, fInv,
} from "./LinearEngine.js";
import { computeRobustSE } from "../core/inference/robustSE.js";

const arrMin = a => a.reduce((m, v) => v < m ? v : m, a[0]);
const arrMax = a => a.reduce((m, v) => v > m ? v : m, a[0]);

// ─── Anderson-Rubin CI (weak-instrument robust) ──────────────────────────────
// Single-endogenous-regressor closed-form AR confidence interval.
//
// AR test inverts the joint significance of instruments in
//   (y - β₀·x_endog) ~ exog + instruments
// The acceptance region is a quadratic in β₀: A·β² + B·β + C ≤ 0, where
//   a(β) = ε(β)' P_z̃ ε(β),    b(β) = ε(β)' M_z̃ ε(β)
//   F(β) = (a(β)/q) / (b(β)/(n-k_W-q))
//   accept iff F(β) ≤ F_crit  ⇔  a(β) - c·b(β) ≤ 0,  c = F_crit · q / (n-k_W-q)
//
// All inner products are computed after residualizing y, x_endog, and Z against
// W = [intercept, ...exog] (FWL). Returns:
//   { lo, hi, type: "bounded" | "unbounded" | "empty" | "all", F_crit }
// "unbounded" means CI = (-∞, lo] ∪ [hi, ∞); "all" means full real line.
function andersonRubinCI(valid, yCol, endogCol, exogCols, instrCols, alpha = 0.05) {
  const n = valid.length;
  const q = instrCols.length;
  const kW = 1 + exogCols.length;          // dim(W) with intercept
  const dfDen = n - kW - q;
  if (q < 1 || dfDen <= 0) return null;

  // FWL: residualize a column against W = [1, ...exogCols].
  const W = valid.map(r => [1, ...exogCols.map(c => r[c])]);
  const WtWinv = matInv(matMul(transpose(W), W));
  if (!WtWinv) return null;
  const resid = (vec) => {
    const Wtv = matMul(transpose(W), vec.map(v => [v])).map(r => r[0]);
    const coef = WtWinv.map(row => row.reduce((s, v, j) => s + v * Wtv[j], 0));
    return vec.map((v, i) => v - W[i].reduce((s, w, j) => s + w * coef[j], 0));
  };

  const y_t = resid(valid.map(r => r[yCol]));
  const x_t = resid(valid.map(r => r[endogCol]));
  const Z_t = instrCols.map(c => resid(valid.map(r => r[c])));

  // Project ỹ and x̃ onto residualized instrument space Z̃: P_Z̃ = Z̃(Z̃'Z̃)⁻¹Z̃'.
  const Zmat = Z_t[0].map((_, i) => Z_t.map(col => col[i])); // n × q
  const ZtZinv = matInv(matMul(transpose(Zmat), Zmat));
  if (!ZtZinv) return null;
  const proj = (v) => {
    const Ztv = matMul(transpose(Zmat), v.map(s => [s])).map(r => r[0]);
    const coef = ZtZinv.map(row => row.reduce((s, w, j) => s + w * Ztv[j], 0));
    return v.map((_, i) => Zmat[i].reduce((s, w, j) => s + w * coef[j], 0));
  };
  const yp = proj(y_t);
  const xp = proj(x_t);

  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  const Pyy = dot(yp, yp), Pxx = dot(xp, xp), Pxy = dot(yp, xp);
  const Syy = dot(y_t, y_t), Sxx = dot(x_t, x_t), Sxy = dot(y_t, x_t);
  const Myy = Syy - Pyy, Mxx = Sxx - Pxx, Mxy = Sxy - Pxy;

  const F_crit = fInv(1 - alpha, q, dfDen);
  const c = F_crit * q / dfDen;
  const A = Pxx - c * Mxx;
  const B = -2 * (Pxy - c * Mxy);
  const C = Pyy - c * Myy;
  const D = B * B - 4 * A * C;

  const TOL = 1e-12;
  // A > 0 → upward parabola, accept region is interior (bounded CI)
  // A < 0 → downward parabola, accept region is exterior (unbounded CI)
  if (Math.abs(A) < TOL) {
    // Linear: B·β + C ≤ 0 → half-line. Rare; report as unbounded with NaN cap.
    if (Math.abs(B) < TOL) return { type: C <= 0 ? "all" : "empty", lo: NaN, hi: NaN, F_crit };
    const root = -C / B;
    return B > 0
      ? { type: "unbounded", lo: NaN, hi: root, F_crit }
      : { type: "unbounded", lo: root, hi: NaN, F_crit };
  }
  if (D < 0) {
    return A > 0
      ? { type: "empty", lo: NaN, hi: NaN, F_crit }
      : { type: "all",   lo: NaN, hi: NaN, F_crit };
  }
  const r1 = (-B - Math.sqrt(D)) / (2 * A);
  const r2 = (-B + Math.sqrt(D)) / (2 * A);
  const lo = Math.min(r1, r2), hi = Math.max(r1, r2);
  return A > 0
    ? { type: "bounded",   lo, hi, F_crit }
    : { type: "unbounded", lo, hi, F_crit };
}

// ─── 2SLS / IV ───────────────────────────────────────────────────────────────
// endog: endogenous regressors  |  exog: exogenous controls  |  instr: excluded instruments
export function run2SLS(rows, yCol, endog, exog, instr, seOpts = {}) {
  // Guard: outcome cannot also appear as an endogenous regressor.
  // If it does, the "first stage" becomes Y ~ Z (reduced form), not X ~ Z.
  const yInEndog = endog.filter(e => e === yCol);
  if (yInEndog.length > 0)
    return { error: `"${yCol}" is selected as both the outcome (Y) and an endogenous regressor (X). Remove it from X — the first stage would otherwise be the reduced form.` };

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

  // ── Corrected SE (iv_robust spec) ───────────────────────────────────────────
  // Bread + meat: X̂ (second-stage design matrix with first-stage Yhat for endogenous).
  // Residuals: y − X_actual·β̂  (structural residuals, not second-stage residuals).
  // σ̂² = (y − Xβ_IV)′(y − Xβ_IV) / (n − k)
  const k  = 1 + endog.length + exog.length;   // intercept + regressors
  const df = n - k;
  if (df <= 0)
    return { error: "Degrees of freedom ≤ 0 — add more observations or reduce regressors." };

  const Y  = valid.map(r => r[yCol]);
  // X_actual: actual endogenous regressors — used only for structural residuals
  const X2 = valid.map(r => [1, ...endog.map(ev => r[ev]), ...exog.map(c => r[c])]);

  const trueResid = Y.map((y, i) =>
    y - X2[i].reduce((s, v, j) => s + v * (secondRes.beta[j] ?? 0), 0)
  );
  const trueSSR  = trueResid.reduce((s, e) => s + e * e, 0);
  const trueS2   = trueSSR / df;

  // X̂: second-stage design matrix (first-stage Yhat for endogenous + actual exogenous).
  // Used for bread (X̂′X̂)⁻¹ and for leverage-based HC2/HC3 meat, per iv_robust spec.
  const Xhat      = valid.map((r, i) => [1, ...endog.map((_, j) => firstStages[j].Yhat[i]), ...exog.map(c => r[c])]);
  const XtXinvHat = matInv(matMul(transpose(Xhat), Xhat));
  if (!XtXinvHat)
    return { error: "Matrix is singular (check for perfect collinearity or weak instruments)." };

  const classicalSE = XtXinvHat.map((row, i) => {
    const v = row[i] * trueS2;
    return isFinite(v) && v >= 0 ? Math.sqrt(v) : NaN;
  });
  const robustSe = computeRobustSE(seOpts, XtXinvHat, Xhat, trueResid, n, k, valid);
  const corrSE   = robustSe ?? classicalSE;
  const corrT = secondRes.beta.map((b, i) => {
    const s = corrSE[i];
    return isFinite(b) && isFinite(s) && s > 0 ? b / s : NaN;
  });
  const corrP = corrT.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  const Ym  = Y.reduce((a, b) => a + b, 0) / n;
  const SST = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  // R² uses projected (second-stage) residuals — matches fixest::feols / AER::ivreg
  const projSSR = secondRes.SSR;
  const R2    = SST > 0 ? 1 - projSSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // varNames aligned with X2 column order (intercept first)
  const varNames = ["(Intercept)", ...endog, ...exog];
  const beta     = secondRes.beta.slice(0, k);
  const Yhat2SLS = X2.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));

  // Anderson-Rubin CI — only for the single-endogenous-regressor case.
  // Weak-instrument robust: valid even when the first-stage F is small.
  const arCI = endog.length === 1
    ? andersonRubinCI(valid, yCol, endog[0], exog, instr, 0.05)
    : null;

  return {
    firstStages,
    second: {
      beta, se: corrSE, tStats: corrT, pVals: corrP,
      R2, adjR2, n, df, varNames,
      resid: trueResid,
      Yhat:  Yhat2SLS,
      arCI, // null for multi-endog; else { type, lo, hi, F_crit }
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

function runWLS(xData, yData, weights, seOpts = {}) {
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
  // Classical SE as default; computeRobustSE overrides when seType != "classical"
  // For WLS, pass weight-scaled X and residuals so the HC meat matches R's sandwich:
  // meat = Σ w_i² e_i² x_i x_i' = Σ (√w_i e_i)² (√w_i x_i)(√w_i x_i)'
  const wResid = resid.map((e, i) => e * sqW[i]);
  let se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const robustSe = computeRobustSE(seOpts, XtXinv, wX, wResid, n, k, null);
  if (robustSe) se = robustSe;
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
    return (arrMax(runningVals) - arrMin(runningVals)) / 4;

  const pilot = (arrMax(runningVals) - arrMin(runningVals)) / 4;

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
  const range = arrMax(runningVals) - arrMin(runningVals);
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
  const xMin = arrMin(vals);
  const xMax = arrMax(vals);
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
  const hFit  = h ?? Math.max(hAuto, range * 0.15);

  // ── 5. Local linear WLS on density bins — evaluated at cutoff ────────────
  // Left side: fit density ~ (x - cutoff) with triangular kernel, eval at cutoff
  function localLinearDensity(bins, evalPt) {
    const weights = bins.map(b => {
      const u = Math.abs(b.x - evalPt) / hFit;
      return u <= 1 ? 1 - u : 0; // triangular kernel
    });

    const active = bins.map((b, i) => ({ ...b, w: weights[i] })).filter(b => b.w > 0);
    if (active.length < 2) return null; // local linear needs ≥ 2 points (intercept + slope)

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
  // Clamp to small positive value — local linear can return slightly negative
  // density at the cutoff when data is sparse; clamping avoids killing the plot.
  const fhatL = Math.max(leftFit.fhat,  1e-10);
  const fhatR = Math.max(rightFit.fhat, 1e-10);

  // ── 6. θ = log(f̂_R / f̂_L), SE via delta method ─────────────────────────
  // Var(log f̂) ≈ Var(f̂) / f̂²  (delta method)
  const theta   = Math.log(fhatR / fhatL);
  const varTheta = rightFit.varFhat / fhatR ** 2
                 + leftFit.varFhat  / fhatL ** 2;
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
    fhatLeft:  fhatL,
    fhatRight: fhatR,
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
export function runSharpRDD(rows, yCol, runCol, cutoff, h, kernelType = "triangular", controls = [], seOpts = {}, polyOrder = 1) {
  const p = Math.max(1, Math.round(polyOrder));   // clamp to integer ≥ 1
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

  // Drop any control that duplicates a column already in the RDD design matrix:
  // running variable → already in as (running − c); treatment col → already in as D.
  // Leaving them in causes exact multicollinearity and produces all-NaN results.
  const safeControls = controls.filter(c => {
    if (c === runCol || c === yCol) return false;
    const vals = valid.map(r => r[c]);
    const isBinaryLikeD = vals.every((v, i) => v === D[i] || v === 1 - D[i]);
    if (isBinaryLikeD) return false;
    return true;
  });

  // Local polynomial design: [1, D, xc^1, ..., xc^p, D·xc^1, ..., D·xc^p, ...controls]
  // LATE = β[1] (coefficient on D) — the jump at xc=0 for any polynomial order.
  const X = valid.map((r, i) => {
    const row = [1, D[i]];
    for (let k = 1; k <= p; k++) row.push(xc[i] ** k);          // xc^1..xc^p
    for (let k = 1; k <= p; k++) row.push(D[i] * (xc[i] ** k)); // D·xc^1..D·xc^p
    safeControls.forEach(c => row.push(r[c]));
    return row;
  });

  const res = runWLS(X, Y, W, seOpts);
  if (!res) return null;

  // Variable names matching column order above
  const polyNames  = Array.from({ length: p }, (_, k) => k === 0 ? "running − c" : `(running − c)^${k + 1}`);
  const interNames = Array.from({ length: p }, (_, k) => k === 0 ? "D × (running − c)" : `D × (running − c)^${k + 1}`);
  const varNames   = ["(Intercept)", "D (treatment)", ...polyNames, ...interNames, ...safeControls];

  // Fitted values per side using polynomial terms:
  // Left  (D=0): Ŷ = β[0] + Σ_{k=1}^{p} β[1+k] · xc^k
  // Right (D=1): Ŷ = β[0] + β[1] + Σ_{k=1}^{p} (β[1+k] + β[1+p+k]) · xc^k
  const leftFit = valid
    .map((r, i) => {
      let yhat = res.beta[0];
      for (let k = 1; k <= p; k++) yhat += res.beta[1 + k] * (xc[i] ** k);
      return { x: r[runCol], yhat };
    })
    .filter((_, i) => D[i] === 0);

  const rightFit = valid
    .map((r, i) => {
      let yhat = res.beta[0] + res.beta[1];
      for (let k = 1; k <= p; k++) yhat += (res.beta[1 + k] + res.beta[1 + p + k]) * (xc[i] ** k);
      return { x: r[runCol], yhat };
    })
    .filter((_, i) => D[i] === 1);

  return {
    ...res,
    varNames,
    cutoff, h, kernelType,
    valid, xc, D, Y, W,
    leftFit, rightFit,
    late:     res.beta[1],
    lateSE:   res.se[1],
    lateP:    res.pVals[1],
    polyOrder: p,
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
  const { bandwidth = null, kernel = "triangular", seOpts = {}, polyOrder = 1 } = opts;
  const p = Math.max(1, Math.round(polyOrder));

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

  // ── First stage design matrix: [1, Z, xc^1..xc^p, Z·xc^1..Z·xc^p] ─────────
  // Z = above is the excluded instrument.
  const buildFuzzyRow = (z_i, xci) => {
    const row = [1, z_i];
    for (let k = 1; k <= p; k++) row.push(xci ** k);           // xc^1..xc^p
    for (let k = 1; k <= p; k++) row.push(z_i * (xci ** k));   // Z·xc^1..Z·xc^p
    return row;
  };
  const Xfs = inWindow.map((_, i) => buildFuzzyRow(above[i], xc[i]));

  // ── 4. First stage: D ~ Xfs with kernel weights ─────────────────────────────
  // β̂_fs = (X_fs' W X_fs)⁻¹ X_fs' W D
  const firstStage = runWLS(Xfs, D, W, seOpts);
  if (!firstStage)
    return { error: "First-stage WLS failed — singular matrix. Check for perfect collinearity." };

  const Dhat = firstStage.yhat; // D̂_i = fitted values of treatment from first stage

  // ── 5. First-stage diagnostics ───────────────────────────────────────────────
  // Restricted model drops Z (col index 1): D ~ [1, xc^1..xc^p, Z·xc^1..Z·xc^p]
  const XfsRestricted = inWindow.map((_, i) => {
    const row = [1];
    for (let k = 1; k <= p; k++) row.push(xc[i] ** k);
    for (let k = 1; k <= p; k++) row.push(above[i] * (xc[i] ** k));
    return row;
  });
  const firstRestricted = runWLS(XfsRestricted, D, W);
  const qFS  = 1; // one exclusion restriction (Z = above indicator)
  const dfFS = firstStage.df;
  const fstatFS = firstRestricted && dfFS > 0
    ? ((firstRestricted.SSR - firstStage.SSR) / qFS) / (firstStage.SSR / dfFS)
    : NaN;
  const weakInstrument = isFinite(fstatFS) ? fstatFS < 10 : true;

  // First-stage jump in D at cutoff: coefficient on Z (column index 1)
  // This is α̂₁ = E[D | x≥c] − E[D | x<c] at the cutoff (first-stage discontinuity)
  const firstStageJumpD = firstStage.beta[1];

  // ── 6. Second stage: Y ~ [1, D̂, xc^1..xc^p, Z·xc^1..Z·xc^p] ───────────────
  // Z is the EXCLUDED instrument. LATE = β₁ (coefficient on D̂) for any p.
  const Xss = inWindow.map((_, i) => buildFuzzyRow(above[i], xc[i]).map((v, j) =>
    j === 1 ? Dhat[i] : v   // replace Z with D̂ at index 1
  ));

  const secondStage = runWLS(Xss, Y, W);
  if (!secondStage)
    return { error: "Second-stage WLS failed — singular matrix." };

  // ── 7. LATE (Local Average Treatment Effect) ─────────────────────────────────
  // β̂₁ = LATE: causal effect of treatment at the cutoff (compliers only).
  // Column index 1 (after intercept at 0).
  const late  = secondStage.beta[1];
  const lateT = secondStage.tStats[1];
  const lateP = secondStage.pVals[1];

  // ── 8. Corrected IV standard errors ─────────────────────────────────────────
  // Var(β̂_2SLS) = σ̂² · (X̂'WX̂)⁻¹
  //
  //   σ̂² = Σᵢ eᵢ² / (n−k)   — UNWEIGHTED structural residuals
  //         eᵢ = Yᵢ − X_orig_i · β̂_2SLS   (X_orig uses actual D, not D̂)
  //
  //   (X̂'WX̂)⁻¹  — kernel-weighted bread using instrumented regressors D̂
  //
  // Using weighted SSR would deflate σ̂² by mean(W) ≈ 0.5 for triangular kernel,
  // causing ~√2 underestimation of SE (same issue as Sharp RDD).
  const k    = 2 * (p + 1);   // [intercept, D/Z, xc^1..xc^p, (D/Z)·xc^1..(D/Z)·xc^p]
  const dfIV = n - k;
  if (dfIV <= 0)
    return { error: "Degrees of freedom ≤ 0 in second stage." };

  // Structural design matrix: X_orig uses actual D (not D̂) at index 1
  const XorigSS = inWindow.map((_, i) => buildFuzzyRow(above[i], xc[i]).map((v, j) =>
    j === 1 ? D[i] : v
  ));
  const residIV = Y.map((y, i) =>
    y - XorigSS[i].reduce((s, v, j) => s + v * secondStage.beta[j], 0)
  );
  // σ̂² from UNWEIGHTED SSR of structural residuals
  const SSR_IV = residIV.reduce((s, e) => s + e * e, 0);
  const s2IV   = SSR_IV / dfIV;

  // (X̂'WX̂)⁻¹: kernel-weighted instrumented design matrix
  // wXss = √W · X̂  →  (wXss' wXss) = X̂'WX̂
  const sqW_iv   = W.map(w => Math.sqrt(w));
  const wXss     = Xss.map((row, i) => row.map(v => v * sqW_iv[i]));
  const XtXinvIV = matInv(matMul(transpose(wXss), wXss));

  // Classical SE: σ̂² · diag(X̂'WX̂)⁻¹
  const classicalSE = XtXinvIV
    ? XtXinvIV.map((row, i) => {
        const v = row[i] * s2IV;
        return isFinite(v) && v >= 0 ? Math.sqrt(v) : secondStage.se[i];
      })
    : secondStage.se;

  // Robust SE (HC1/HC3/clustered): 2SLS sandwich with kernel-weighted X̂ and structural e
  // wResidIV = √W · e — scales meat consistently with the kernel-weighted bread
  const wResidIV = residIV.map((e, i) => e * sqW_iv[i]);
  const robustSE  = computeRobustSE(seOpts, XtXinvIV, wXss, wResidIV, n, k, null);
  const corrSE    = robustSE ?? classicalSE;

  // ── 8. Local Wald ratio + delta-method SE ────────────────────────────────────
  // Reduced-form Sharp RDD: jump in Y at cutoff (ignoring D).
  // SE uses the same seOpts so delta-method propagation matches R's fuzzy_wald.
  const reducedForm = runSharpRDD(valid, yCol, runCol, cutoff, h, kernel, [], seOpts, p);

  const jumpY = reducedForm ? reducedForm.late : NaN;
  const waldRatio = isFinite(firstStageJumpD) && Math.abs(firstStageJumpD) > 1e-10
    ? jumpY / firstStageJumpD
    : NaN;

  // Delta-method SE for LATE — matches R's fuzzy_wald reference.
  // Var(LATE) ≈ Var(γ̂) / α̂² + γ̂² · Var(α̂) / α̂⁴
  // where γ̂ = jump in Y (reduced form), α̂ = jump in D (first stage).
  // firstStage.se[1] already uses seOpts (HC1 or classical from the WLS call above).
  const se_rf = reducedForm ? reducedForm.lateSE : NaN;
  const se_fs = firstStage.se[1];
  const varDelta = (se_rf ** 2) / (firstStageJumpD ** 2)
    + (jumpY ** 2) * (se_fs ** 2) / (firstStageJumpD ** 4);
  const deltaLateSE = Math.sqrt(Math.max(0, varDelta));

  const lateSE    = Number.isFinite(deltaLateSE) ? deltaLateSE : corrSE[1];
  const lateTCorr = isFinite(lateSE) && lateSE > 0 ? late / lateSE : lateT;
  const latePCorr = isFinite(lateTCorr) ? pValue(lateTCorr, dfIV) : lateP;

  // ── 9. Plot data: smooth fit lines using first-stage + second-stage coefficients
  // Using D̂ from first stage at each grid point gives a clean regression curve,
  // avoiding the noisy band caused by actual D[i] varying within each side.
  //   Left  (above=0): D̂(x) = α₀ + α₂·xc;            Ŷ = β₀ + β₁·D̂ + β₂·xc
  //   Right (above=1): D̂(x) = α₀ + α₁ + (α₂+α₃)·xc;  Ŷ = β₀ + β₁·D̂ + (β₂+β₃)·xc
  const Yhat2SLS = XorigSS.map((row, i) =>
    row.reduce((s, v, j) => s + v * secondStage.beta[j], 0)
  );

  // ── 9. Plot lines: evaluate polynomial fit at a grid of xc values ────────────
  // Column layout: [intercept, Z/D̂, xc^1..xc^p, (Z/D̂)·xc^1..(Z/D̂)·xc^p]
  // helper: sum polynomial terms for a row at given xc, starting from col index 2
  const polySum = (betas, xcv) => {
    let s = 0;
    for (let k = 1; k <= p; k++) s += betas[1 + k] * (xcv ** k);
    return s;
  };
  const interSum = (betas, xcv) => {
    let s = 0;
    for (let k = 1; k <= p; k++) s += betas[1 + p + k] * (xcv ** k);
    return s;
  };

  const nGrid = 60;
  const fsB = firstStage.beta;
  const ssB = secondStage.beta;

  const leftFit = Array.from({ length: nGrid + 1 }, (_, i) => {
    const x   = cutoff - h + i * (h / nGrid);
    const xcv = x - cutoff;
    const dhat = fsB[0] + polySum(fsB, xcv);                         // Z=0
    const yhat = ssB[0] + ssB[1] * dhat + polySum(ssB, xcv);        // Z=0
    return { x, yhat };
  });

  const rightFit = Array.from({ length: nGrid + 1 }, (_, i) => {
    const x   = cutoff + i * (h / nGrid);
    const xcv = x - cutoff;
    const dhat = fsB[0] + fsB[1] + polySum(fsB, xcv) + interSum(fsB, xcv);  // Z=1
    const yhat = ssB[0] + ssB[1] * dhat + polySum(ssB, xcv) + interSum(ssB, xcv); // Z=1
    return { x, yhat };
  });

  // ── 10. Return result ────────────────────────────────────────────────────────
  const polyLbls = Array.from({ length: p }, (_, k) => k === 0 ? "running − c" : `(running − c)^${k + 1}`);
  const interLbls = Array.from({ length: p }, (_, k) => k === 0 ? "Z × (running − c)" : `Z × (running − c)^${k + 1}`);
  const varNames = ["(Intercept)", "D (LATE)", ...polyLbls, ...interLbls];
  const fsPolyLbls  = Array.from({ length: p }, (_, k) => k === 0 ? "running − c" : `(running − c)^${k + 1}`);
  const fsInterLbls = Array.from({ length: p }, (_, k) => k === 0 ? "Z × (running − c)" : `Z × (running − c)^${k + 1}`);
  const firstStageVarNames = ["(Intercept)", "Z (instrument)", ...fsPolyLbls, ...fsInterLbls];

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

    // Second-stage detail (corrected SE replaces WLS SE from second stage).
    // Splice lateSE/T/P into index 1; keep corrSE for all other positions.
    beta:    secondStage.beta,
    se:      corrSE.map((s, j) => j === 1 ? lateSE  : s),
    tStats:  secondStage.tStats.map((t, j) => j === 1 ? lateTCorr : t),
    pVals:   secondStage.pVals.map((pv, j)  => j === 1 ? latePCorr : pv),
    R2:      secondStage.R2,
    varNames,

    // Sample info
    n,
    df:    dfIV,
    bandwidth: h,
    h,           // alias for RDDPlot
    kernel,
    kernelType: kernel,  // alias for RDDPlot
    cutoff,
    polyOrder: p,

    // Plot data
    leftFit,
    rightFit,
    Yhat: Yhat2SLS,

    // Raw arrays for downstream use
    valid: inWindow,
    xc,
    above,   // Z indicator (1 = above cutoff) — used by RDDPlot for left/right coloring
    D,
    Y,
    W,
    Dhat,
    firstStage,
    firstStageVarNames,
    secondStage,
  };
}
