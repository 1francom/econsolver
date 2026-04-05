// ─── ECON STUDIO · core/diagnostics/multicollinearity.js ─────────────────────
// VIF (Variance Inflation Factor) and condition number for multicollinearity.
// Pure math — no React, no side effects.
//
// Exports:
//   computeVIF(rows, xCols)           → VIFResult[] | null
//   conditionNumber(X)                → CondResult | null
//
// VIF: runs OLS of each Xⱼ on all other Xᵢ (i≠j), VIFⱼ = 1/(1−R²ⱼ).
//   VIF < 5 = acceptable, 5–10 = moderate, > 10 = severe.
//
// Condition number: ratio of largest to smallest singular value of X.
//   κ < 10 = acceptable, 10–30 = moderate, > 30 = severe.

import { transpose, matMul, matInv } from "../math/LinearEngine.js";

// ── Internal OLS R² ───────────────────────────────────────────────────────────
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

// ─── VIF ─────────────────────────────────────────────────────────────────────
// @param rows   object[]   — data rows
// @param xCols  string[]   — regressor column names (excluding intercept)
// @returns VIFResult[] — { col, vif, severity }
export function computeVIF(rows, xCols) {
  if (!rows?.length || !xCols?.length) return null;
  if (xCols.length < 2) {
    return xCols.map(col => ({ col, vif: 1, severity: "none", note: "Only one regressor — VIF not applicable." }));
  }

  const valid = rows.filter(r =>
    xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < xCols.length + 2) return null;

  return xCols.map((col, i) => {
    const others = xCols.filter((_, j) => j !== i);
    const Y = valid.map(r => r[col]);
    const X = valid.map(r => [1, ...others.map(c => r[c])]);
    const R2 = olsR2(Y, X);
    if (R2 === null || R2 >= 1 - 1e-10)
      return { col, vif: Infinity, severity: "perfect", note: "Perfect collinearity detected." };

    const vif = 1 / (1 - R2);
    const severity = vif > 10 ? "severe"
                   : vif > 5  ? "moderate"
                   :             "none";
    return { col, vif: +vif.toFixed(3), severity };
  });
}

// ─── CONDITION NUMBER ─────────────────────────────────────────────────────────
// Uses power iteration to approximate the largest and smallest singular values
// of the column-standardized design matrix (excl. intercept).
// κ = σ_max / σ_min.
//
// @param X  number[][] — design matrix (with intercept in col 0)
// @returns { kappa, severity } | null
export function conditionNumber(X) {
  if (!X?.length || X[0].length < 2) return null;

  // Column-standardize (excl. intercept) for scale-invariant condition number
  const n    = X.length;
  const cols = X[0].length;
  const Xs   = X.map(row => [...row]);  // copy

  for (let j = 1; j < cols; j++) {
    const col  = X.map(r => r[j]);
    const mean = col.reduce((a, b) => a + b, 0) / n;
    const std  = Math.sqrt(col.reduce((s, v) => s + (v - mean) ** 2, 0) / n) || 1;
    for (let i = 0; i < n; i++) Xs[i][j] = (X[i][j] - mean) / std;
  }

  // Compute XᵀX
  const Xt  = transpose(Xs);
  const XtX = matMul(Xt, Xs);
  const m   = XtX.length;

  // Power iteration for largest eigenvalue of XᵀX
  function powerIter(M, iters = 200) {
    let v = Array(m).fill(1).map(() => Math.random());
    for (let it = 0; it < iters; it++) {
      const Mv   = M.map(row => row.reduce((s, val, j) => s + val * v[j], 0));
      const norm = Math.sqrt(Mv.reduce((s, val) => s + val * val, 0)) || 1;
      v = Mv.map(val => val / norm);
    }
    const Mv   = M.map(row => row.reduce((s, val, j) => s + val * v[j], 0));
    return Math.sqrt(Math.abs(Mv.reduce((s, val, i) => s + val * v[i], 0)));
  }

  // Largest singular value
  const sigmaMax = powerIter(XtX);
  if (sigmaMax === 0) return null;

  // Smallest singular value via inverse power iteration on (XᵀX - λ_max·I)⁻¹
  // Approximate: shift matrix and invert
  const eps    = sigmaMax * 1e-6;
  const shifted = XtX.map((row, i) => row.map((v, j) => v - (i === j ? sigmaMax - eps : 0)));
  const inv    = matInv(shifted);
  const sigmaMin = inv ? 1 / powerIter(inv.map(row => row.map(v => Math.abs(v)))) : eps;

  const kappa    = sigmaMax / Math.max(sigmaMin, 1e-12);
  const severity = kappa > 30 ? "severe"
                 : kappa > 10 ? "moderate"
                 :               "none";

  return {
    kappa:    +kappa.toFixed(2),
    severity,
    sigmaMax: +sigmaMax.toFixed(4),
    sigmaMin: +sigmaMin.toFixed(4),
    note:     "Condition number of column-standardized X. κ > 30 indicates severe multicollinearity.",
  };
}
