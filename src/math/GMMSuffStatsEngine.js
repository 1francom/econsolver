// ─── ECON STUDIO · src/math/GMMSuffStatsEngine.js ─────────────────────────────
// Two-step efficient GMM solver, step 2, from sufficient statistics.
// No row materialization, no React.
//
// Inputs (from buildGMMSuffStats + computeGMMOmega + run2SLSFromSuffStats step 1):
//   XtX, ZtZ, ZtX, XtY, ZtY, YtY, sumY, n, varNames
//   Omega (l+1)×(l+1)  — step-2 weighting matrix
//
// Solve:
//   X'Z · Ω̂⁻¹ · Z'X         (k+1)×(k+1)
//   β̂₂ = inverse_of_above · X'Z · Ω̂⁻¹ · Z'Y
//   Var(β̂₂) = n · inverse_of_above        (matches GMMEngine.js:165 — AinvN = Ainv * n)
//
// J-stat = n · g'Ω̂⁻¹g  where g = Z'ê / n, ê = Y − Xβ̂₂
//   Σêᵢ²·zᵢ : derived from suff-stats? NO — need Z'ê, which is:
//     Z'ê = Z'Y − Z'X β̂₂                  ← entirely on small matrices

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";
import { normCDF } from "./NonLinearEngine.js";

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }
function vmul(M, v) { return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0)); }

function chiSqPval(chi2, df) {
  if (!isFinite(chi2) || df <= 0 || chi2 < 0) return NaN;
  if (chi2 === 0) return 1;
  const z = (Math.pow(chi2 / df, 1 / 3) - (1 - 2 / (9 * df))) /
            Math.sqrt(2 / (9 * df));
  return 1 - normCDF(z);
}

/**
 * @param {object} args
 * @param {number}     args.n
 * @param {number}     args.sumY
 * @param {number}     args.YtY
 * @param {number[][]} args.XtX
 * @param {number[][]} args.ZtZ
 * @param {number[][]} args.ZtX
 * @param {number[]}   args.XtY
 * @param {number[]}   args.ZtY
 * @param {number[][]} args.Omega        (l+1)×(l+1) weighting matrix
 * @param {string[]}   args.varNames
 * @param {number}     args.overidDf     l − k (Hansen J degrees of freedom)
 * @returns {object|null}
 */
export function runGMMFromSuffStats({
  n, sumY, YtY, XtX, ZtZ, ZtX, XtY, ZtY, Omega, varNames, overidDf,
}) {
  const k = XtX.length;            // (k+1)
  const OmegaInv = matInv(Omega);
  if (!OmegaInv) return null;

  // X'Z = transpose(Z'X)   (k+1)×(l+1)
  const XtZ = transpose(ZtX);
  // X'Z · Ω̂⁻¹  → (k+1)×(l+1)
  const XtZ_OI = matMul(XtZ, OmegaInv);
  // A = X'Z · Ω̂⁻¹ · Z'X   → (k+1)×(k+1)
  const A = matMul(XtZ_OI, ZtX);
  const Ainv = matInv(A);
  if (!Ainv) return null;

  // β = Ainv · (X'Z · Ω̂⁻¹ · Z'Y)
  const rhs = vmul(XtZ_OI, ZtY);
  const beta = vmul(Ainv, rhs);

  // SSR = Y'Y − 2β'X'Y + β'X'Xβ
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + beta.reduce((s, b, i) => s + b * vmul(XtX, beta)[i], 0);   // quadForm

  const df = n - k;

  // SE: Var(β̂) = n · Ainv   (matches GMMEngine.js:165)
  const se = Ainv.map((row, i) => Math.sqrt(Math.abs(row[i] * n)));
  const tStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  // J-stat: g = Z'ê / n; Z'ê = Z'Y − Z'X · β
  const ZtE = ZtY.map((v, i) => v - vmul(ZtX, beta)[i]);
  const g   = ZtE.map(v => v / n);
  const OIg = vmul(OmegaInv, g);
  const jStat = n * dot(g, OIg);
  const jPval = overidDf > 0 ? chiSqPval(jStat, overidDf) : NaN;

  // R²
  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    jStat, jPval, jDf: overidDf,
    SSR, ssr: SSR,
    varNames,
    XtXinv: Ainv,
  };
}
