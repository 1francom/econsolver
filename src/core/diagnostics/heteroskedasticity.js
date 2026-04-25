// ─── ECON STUDIO · core/diagnostics/heteroskedasticity.js ────────────────────
// Breusch-Pagan (1979) and White (1980) tests for heteroskedasticity.
// Pure math — no React, no side effects.
//
// Both tests regress squared residuals on regressors and use the LM statistic.
// H₀: homoskedasticity (constant error variance).
//
// Exports:
//   breuschPagan(resid, X)   → BPResult | null
//   whiteTest(resid, X)      → WhiteResult | null
//
// X is the design matrix as array of row-arrays (including intercept column).

import { transpose, matMul, matInv } from "../../math/LinearEngine.js";

// ── Internal: OLS on squared residuals ───────────────────────────────────────
function olsR2(Y, X) {
  const Xt     = transpose(X);
  const XtXinv = matInv(matMul(Xt, X));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, Y.map(v => [v]))).map(r => r[0]);
  const Yhat = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const Ym   = Y.reduce((a, b) => a + b, 0) / Y.length;
  const SST  = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const SSR  = Yhat.reduce((s, yh, i) => s + (Y[i] - yh) ** 2, 0);
  return SST > 0 ? 1 - SSR / SST : 0;
}

// ── Chi-squared CDF approximation (Wilson-Hilferty) ──────────────────────────
// Returns P(χ²_df ≤ x). Used to compute p-values for LM tests.
function chi2CDF(x, df) {
  if (x <= 0) return 0;
  // Normal approximation via Wilson-Hilferty (1931)
  const h = 2 / (9 * df);
  const z = (Math.pow(x / df, 1 / 3) - (1 - h)) / Math.sqrt(h);
  // Standard normal CDF (Abramowitz & Stegun 26.2.17)
  const sign = z >= 0 ? 1 : -1;
  const absZ = Math.abs(z);
  const t    = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782
             + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI) * poly;
  return sign >= 0 ? 1 - tail : tail;
}

function chi2pVal(stat, df) {
  return Math.max(0, Math.min(1, 1 - chi2CDF(stat, df)));
}

// ─── BREUSCH-PAGAN TEST ───────────────────────────────────────────────────────
// LM = n * R² from regression of ê² on X (Koenker 1981 robust version).
// df = k (number of regressors excluding intercept).
//
// @param resid  number[]   — OLS residuals
// @param X      number[][] — design matrix (rows × cols, first col = 1 for intercept)
// @returns { LM, df, pVal, reject } | null
export function breuschPagan(resid, X) {
  if (!resid?.length || !X?.length || resid.length !== X.length) return null;
  const n  = resid.length;
  const e2 = resid.map(e => e * e);

  // Koenker (1981) robust: scale by e²/mean(e²) to make LM robust to non-normality
  const e2mean = e2.reduce((a, b) => a + b, 0) / n;
  if (e2mean === 0) return null;
  const e2scaled = e2.map(v => v / e2mean);

  const R2 = olsR2(e2scaled, X);
  if (R2 === null) return null;

  const k   = X[0].length - 1;  // regressors excluding intercept
  const LM  = n * R2;
  const pVal = chi2pVal(LM, k);

  return {
    test:   "Breusch-Pagan",
    LM:     +LM.toFixed(4),
    df:     k,
    pVal:   +pVal.toFixed(4),
    reject: pVal < 0.05,
    note:   "H₀: homoskedasticity. Koenker (1981) robust version.",
  };
}

// ─── WHITE TEST ───────────────────────────────────────────────────────────────
// Augments X with squares and cross-products of regressors (excl. intercept),
// then runs the same LM test. Detects arbitrary forms of heteroskedasticity.
// df = number of auxiliary regressors (squares + cross-products).
//
// @param resid  number[]
// @param X      number[][] — original design matrix (with intercept)
// @returns { LM, df, pVal, reject } | null
export function whiteTest(resid, X) {
  if (!resid?.length || !X?.length || resid.length !== X.length) return null;
  const n    = resid.length;
  const cols = X[0].length;
  // Extract regressors (skip intercept at col 0)
  const regs = Array.from({ length: cols - 1 }, (_, j) => X.map(row => row[j + 1]));

  if (regs.length === 0) return null;

  // Build auxiliary regressors: original + squares + cross-products
  const auxCols = [...regs]; // originals
  for (let i = 0; i < regs.length; i++) {
    auxCols.push(regs[i].map(v => v * v)); // squares
    for (let j = i + 1; j < regs.length; j++) {
      auxCols.push(regs[i].map((v, k) => v * regs[j][k])); // cross-products
    }
  }

  // Remove near-constant columns (variance ≈ 0) to avoid singularity
  const activeAux = auxCols.filter(col => {
    const mean = col.reduce((a, b) => a + b, 0) / n;
    const variance = col.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    return variance > 1e-10;
  });

  if (activeAux.length === 0) return null;

  // Design matrix: intercept + auxiliary regressors
  const Xaux = X.map((_, i) => [1, ...activeAux.map(col => col[i])]);

  const e2   = resid.map(e => e * e);
  const R2   = olsR2(e2, Xaux);
  if (R2 === null) return null;

  const df   = activeAux.length;
  const LM   = n * R2;
  const pVal = chi2pVal(LM, df);

  return {
    test:   "White",
    LM:     +LM.toFixed(4),
    df,
    pVal:   +pVal.toFixed(4),
    reject: pVal < 0.05,
    note:   "H₀: homoskedasticity. Detects arbitrary forms including nonlinear patterns.",
  };
}
