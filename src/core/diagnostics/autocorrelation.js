// ─── ECON STUDIO · core/diagnostics/autocorrelation.js ───────────────────────
// Durbin-Watson (1950) and Breusch-Godfrey (1978) tests for serial correlation.
// Pure math — no React, no side effects.
//
// Exports:
//   durbinWatson(resid)              → DWResult | null
//   breuschGodfrey(resid, X, p?)     → BGResult | null

import { transpose, matMul, matInv } from "../../math/LinearEngine.js";

// ── Chi-squared p-value (Wilson-Hilferty approximation) ──────────────────────
function chi2pVal(stat, df) {
  if (stat <= 0 || df <= 0) return 1;
  const h = 2 / (9 * df);
  const z = (Math.pow(stat / df, 1 / 3) - (1 - h)) / Math.sqrt(h);
  const absZ = Math.abs(z);
  const t    = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782
             + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI) * poly;
  const cdf  = z >= 0 ? 1 - tail : tail;
  return Math.max(0, Math.min(1, 1 - cdf));
}

// ── Internal OLS residuals on extended design matrix ─────────────────────────
function olsResid(Y, X) {
  const Xt     = transpose(X);
  const XtXinv = matInv(matMul(Xt, X));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, Y.map(v => [v]))).map(r => r[0]);
  return Y.map((y, i) => y - X[i].reduce((s, v, j) => s + v * beta[j], 0));
}

// ─── DURBIN-WATSON TEST ───────────────────────────────────────────────────────
// DW = Σ(eₜ - eₜ₋₁)² / Σeₜ²
// Ranges [0, 4]: 2 = no autocorrelation, <2 = positive, >2 = negative.
// Critical values are dataset-specific; we report the statistic + a heuristic
// interpretation based on conventional dL/dU bounds (n large approximation).
//
// @param resid  number[]
// @returns { stat, interpretation, positive, negative } | null
export function durbinWatson(resid) {
  if (!resid?.length || resid.length < 3) return null;
  const n = resid.length;

  const num = resid.slice(1).reduce((s, e, i) => s + (e - resid[i]) ** 2, 0);
  const den = resid.reduce((s, e) => s + e * e, 0);
  if (den === 0) return null;

  const stat = num / den;

  // Heuristic interpretation (Savin & White 1977 bounds for moderate n)
  // For large n: dL ≈ 1.65, dU ≈ 1.85 (1 regressor); use 2 ± 0.5 as rough guide
  let interpretation, positive, negative, inconclusive;
  if (stat < 1.5) {
    interpretation = "Positive autocorrelation likely (DW < 1.5)";
    positive = true; negative = false; inconclusive = false;
  } else if (stat > 2.5) {
    interpretation = "Negative autocorrelation likely (DW > 2.5)";
    positive = false; negative = true; inconclusive = false;
  } else if (stat >= 1.5 && stat <= 1.8) {
    interpretation = "Possible positive autocorrelation — consult DW tables";
    positive = false; negative = false; inconclusive = true;
  } else if (stat >= 2.2 && stat <= 2.5) {
    interpretation = "Possible negative autocorrelation — consult DW tables";
    positive = false; negative = false; inconclusive = true;
  } else {
    interpretation = "No evidence of autocorrelation (DW ≈ 2)";
    positive = false; negative = false; inconclusive = false;
  }

  return {
    test: "Durbin-Watson",
    stat: +stat.toFixed(4),
    interpretation,
    positive,
    negative,
    inconclusive,
    note: "Critical values depend on n and k — consult DW tables for exact inference.",
  };
}

// ─── BREUSCH-GODFREY TEST ─────────────────────────────────────────────────────
// LM test for serial correlation up to lag p.
// More general than DW: handles lagged regressors, higher-order autocorrelation.
// H₀: no serial correlation up to order p.
// LM = n * R² from regression of ê on X and (ê_{t-1}, ..., ê_{t-p}).
// Under H₀: LM ~ χ²(p).
//
// @param resid  number[]   — OLS residuals
// @param X      number[][] — original design matrix (with intercept)
// @param p      number     — number of lags to test (default 1)
// @returns { LM, df, pVal, reject } | null
export function breuschGodfrey(resid, X, p = 1) {
  if (!resid?.length || !X?.length || resid.length !== X.length) return null;
  const n = resid.length;
  if (n < p + X[0].length + 2) return null;

  // Build lagged residuals (pad with 0 for first p observations)
  const laggedResid = [];
  for (let lag = 1; lag <= p; lag++) {
    laggedResid.push(resid.map((_, i) => i >= lag ? resid[i - lag] : 0));
  }

  // Auxiliary design matrix: [X | ê_{t-1} | ... | ê_{t-p}]
  const Xaux = X.map((row, i) => [...row, ...laggedResid.map(lr => lr[i])]);

  const auxResid = olsResid(resid, Xaux);
  if (!auxResid) return null;

  // R² of the auxiliary regression
  const rMean = resid.reduce((a, b) => a + b, 0) / n;
  const SST   = resid.reduce((s, e) => s + (e - rMean) ** 2, 0);
  const SSR   = auxResid.reduce((s, e) => s + e * e, 0);
  const R2    = SST > 0 ? 1 - SSR / SST : 0;

  const LM   = n * R2;
  const pVal = chi2pVal(LM, p);

  return {
    test:   "Breusch-Godfrey",
    LM:     +LM.toFixed(4),
    df:     p,
    pVal:   +pVal.toFixed(4),
    reject: pVal < 0.05,
    lags:   p,
    note:   `H₀: no serial correlation up to lag ${p}. LM ~ χ²(${p}).`,
  };
}
