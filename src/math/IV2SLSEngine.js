// ─── ECON STUDIO · src/math/IV2SLSEngine.js ───────────────────────────────────
// 2SLS solver from sufficient statistics. No row materialization, no React.
//
//   Pz       = Z (Z'Z)⁻¹ Z'
//   X'Pz X   = (Z'X)' (Z'Z)⁻¹ (Z'X)
//   X'Pz Y   = (Z'X)' (Z'Z)⁻¹ (Z'Y)
//   β̂       = (X'Pz X)⁻¹ (X'Pz Y)
//
// Structural residual moments (closed-form on suff-stats):
//   Σ êᵢ²  = Y'Y − 2 β'X'Y + β'X'Xβ
//
// Classical SE: σ̂² (X'Pz X)⁻¹ with σ̂² = Σêᵢ² / (n − k).

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";

function vmul(M, v) {
  // M (m×n) · v (n) → m
  return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0));
}
function quadForm(v, M) {
  // v' M v
  return vmul(M, v).reduce((s, w, i) => s + w * v[i], 0);
}

/**
 * @param {object} args
 * @param {number}   args.n
 * @param {number}   args.sumY
 * @param {number}   args.YtY
 * @param {number[][]} args.XtX   (k+1)×(k+1)
 * @param {number[][]} args.ZtZ   (q+1)×(q+1)
 * @param {number[][]} args.ZtX   (q+1)×(k+1)
 * @param {number[]}   args.XtY   k+1
 * @param {number[]}   args.ZtY   q+1
 * @param {string[]}   args.varNames
 * @param {number[][]} [args.meat]   — only when robust SE; (k+1)×(k+1)
 * @param {'HC0'|'HC1'|null} [args.hcType]
 * @returns {object|null}
 */
export function run2SLSFromSuffStats({
  n, sumY, YtY, XtX, ZtZ, ZtX, XtY, ZtY, varNames,
  meat = null, hcType = null,
}) {
  const k = XtX.length;          // includes intercept
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return null;

  // M = (Z'X)' (Z'Z)⁻¹ — reused for both bread and X'Pz Y
  const ZtXt = transpose(ZtX);                       // (k×(q+1))
  const M    = matMul(ZtXt, ZtZinv);                 // (k×(q+1))
  const XtPzX = matMul(M, ZtX);                      // (k×k)
  const XtPzY = vmul(M, ZtY);                        // (k)

  const Ainv = matInv(XtPzX);
  if (!Ainv) return null;
  const beta = vmul(Ainv, XtPzY);

  // Structural Σêᵢ² in closed form: êᵢ = yᵢ − xᵢ'β  ⇒  Σê² = Y'Y − 2β'X'Y + β'X'Xβ
  // Used for σ̂² (degrees-of-freedom correction uses structural residuals per iv_robust spec).
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + quadForm(beta, XtX);

  const df = n - k;
  const s2 = SSR / Math.max(1, df);
  const Ym = sumY / n;
  const SST = YtY - n * Ym * Ym;

  // R² uses projected (second-stage) residuals — matches fixest::feols / AER::ivreg.
  // SSR_proj = Y'Y − 2β'(X'PzY) + β'(X'PzX)β  where X̂ = Pz X
  const SSR_proj = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtPzY[i], 0)
    + quadForm(beta, XtPzX);
  const R2  = SST > 0 ? 1 - SSR_proj / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // Classical SE: √(σ̂² · diag(Ainv))
  // Robust SE: V = Ainv · meat · Ainv, HC1 scales meat by n/(n-k)
  let V;
  if (meat) {
    let scaleMeat = 1;
    if (hcType === "HC1") scaleMeat = n / Math.max(1, df);
    const scaled = meat.map(row => row.map(v => v * scaleMeat));
    V = matMul(matMul(Ainv, scaled), Ainv);
  } else {
    V = Ainv.map(row => row.map(v => v * s2));
  }
  const se = V.map((row, i) => {
    const d = row[i];
    return isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
  });
  const tStats = beta.map((b, i) => (isFinite(b) && se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df, varNames,
    SSR, ssr: SSR,
    XtPzXinv: Ainv,
  };
}

// First-stage F per endogenous regressor — computed entirely from suff-stats.
// Unrestricted regression: endᵢ ~ [1, exog, instruments]
// Restricted regression:  endᵢ ~ [1, exog] (or intercept-only if no exog)
// Caller computes SSR_u and SSR_r via runOLSFromSuffStats and passes them in.
//
//   F = ((SSR_r − SSR_u) / q) / (SSR_u / dfu)
//
// Stock-Yogo rule of thumb: F < 10 → "weak instruments".
export function firstStageFFromSuffStats(unrestricted, restricted, qInstruments) {
  if (!unrestricted || !restricted) return null;
  const SSR_u = unrestricted.SSR ?? unrestricted.ssr;
  const SSR_r = restricted.SSR  ?? restricted.ssr;
  const dfu   = unrestricted.df;
  if (!isFinite(SSR_u) || !isFinite(SSR_r) || !isFinite(dfu) || dfu <= 0) return null;
  const Fstat = ((SSR_r - SSR_u) / qInstruments) / (SSR_u / dfu);
  const weak  = Fstat < 10;  // Stock-Yogo
  return { Fstat, weak, dfNum: qInstruments, dfDen: dfu };
}
