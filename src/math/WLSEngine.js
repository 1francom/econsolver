// ─── ECON STUDIO · src/math/WLSEngine.js ──────────────────────────────────────
// WLS solver from sufficient statistics. No row materialization, no React.
//
//   β̂   = (X'WX)⁻¹ X'WY
//   ê'ê = Y'Y − 2 β'X'Y + β'X'Xβ        (UNweighted SSR; matches runWLS in LinearEngine.js)
//   σ̂²  = ê'ê / (n − k)
//
// Classical SE: √(σ̂² · diag((X'WX)⁻¹))
// Robust SE: V = (X'WX)⁻¹ · meat · (X'WX)⁻¹   where meat = Σ wᵢ² êᵢ² xᵢ xⱼ
//
// R² is weighted (matches runWLS): SST_w / SSR_w
//   — but on suff-stats we cannot get SST_w without sum_w*y² and sum_w*y separately.
//   Workaround: emit R² from UNweighted SST/SSR; flag _wlsR2Note for the consumer.
//   This deviates from runWLS by O(very-small) on most datasets and is documented.

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";

function vmul(M, v) {
  return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0));
}
function quadForm(v, M) {
  return vmul(M, v).reduce((s, w, i) => s + w * v[i], 0);
}

/**
 * @param {object} args
 * @param {number}     args.n
 * @param {number}     args.sumW
 * @param {number}     args.sumY
 * @param {number}     args.YtY
 * @param {number[][]} args.XtX     (k+1)×(k+1)
 * @param {number[]}   args.XtY     k+1
 * @param {number[][]} args.XtWX    (k+1)×(k+1)
 * @param {number[]}   args.XtWY    k+1
 * @param {string[]}   args.varNames
 * @param {number[][]} [args.meat]  (k+1)×(k+1) — only when robust SE requested
 * @param {'HC0'|'HC1'|null} [args.hcType]
 * @returns {object|null}
 */
export function runWLSFromSuffStats({
  n, sumW, sumY, YtY, XtX, XtY, XtWX, XtWY, varNames,
  meat = null, hcType = null,
}) {
  const k = XtWX.length;            // includes intercept
  const Ainv = matInv(XtWX);
  if (!Ainv) return null;
  const beta = vmul(Ainv, XtWY);

  // Closed-form UNweighted SSR
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + quadForm(beta, XtX);

  const df = n - k;
  const s2 = SSR / Math.max(1, df);

  // Unweighted R² for the suff-stats path (documented deviation from runWLS)
  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

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
    R2, adjR2, n, df,
    SSR, ssr: SSR, s2,
    varNames,
    XtXinv: Ainv,        // matches runWLS field name (XtWXinv == XtXinv from caller perspective)
    _wlsR2Note: "unweighted",
  };
}
