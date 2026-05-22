// ─── ECON STUDIO · src/math/LIMLSuffStatsEngine.js ────────────────────────────
// LIML solver from sufficient statistics. No row materialization, no React.
//
// Builds the m×m generalized-eigenvalue matrices entirely on small cross-product
// matrices via the closed forms:
//   v' M_Z u  = v'u − v'Z (Z'Z)⁻¹ Z'u
//   v' M_W u  = v'u − v'W (W'W)⁻¹ W'u
//
// Then κ = min eigenvalue of A⁻¹B (same as GMMEngine.runLIML), and
//   β = (X'X − κ·X'M_Z X)⁻¹ · (X'Y − κ·X'M_Z Y).
//
// SE: σ̂² · (X'P_Z X)⁻¹ where  X'P_Z X = X'X − X'M_Z X.

import { transpose, matMul, matInv, pValue } from "./LinearEngine.js";
import { limlKappa2x2, limlKappaPower } from "./GMMEngine.js";  // re-use existing helpers

function vmul(M, v) { return M.map(row => row.reduce((s, w, j) => s + w * v[j], 0)); }
function dot(a, b)  { return a.reduce((s, v, i) => s + v * b[i], 0); }

// Build m×m matrix [v_0, v_1, ..., v_{m-1}]' P [v_0, v_1, ..., v_{m-1}]
// for projection P = M_Z (i.e. subtract Z(Z'Z)⁻¹Z' from identity).
// Inputs are the cross-products of v_a with Z (and with each other).
// All vectors are columns of a virtual matrix V; only the bilinear forms
// V'Z, V'V exist as sufficient-statistics matrices.
function mProjForms(VtV, VtZ, ZtZinv) {
  // Returns (m×m) [v_a · M v_b] = VtV[a][b] − (V'Z)[a] · (Z'Z)⁻¹ · (Z'V)[b]
  const VtZi = matMul(VtZ, ZtZinv);            // (m × (l+1))
  const ZtV  = transpose(VtZ);                  // ((l+1) × m)
  const sub  = matMul(VtZi, ZtV);              // (m × m)
  return VtV.map((row, i) => row.map((v, j) => v - sub[i][j]));
}

/**
 * @param {object} args  — output of buildLIMLSuffStats plus optionally `meat`/`hcType`
 * @returns {object|null}
 */
export function runLIMLFromSuffStats({
  n, sumY, YtY,
  XtX, ZtZ, WtW,
  ZtX, WtX,
  XtY, ZtY, WtY,
  varNames, endoIdx,
  meat = null, hcType = null,
}) {
  const k = XtX.length;
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return null;
  const WtWinv = matInv(WtW);
  if (!WtWinv) return null;

  // ── Build the m×m vector set V = [Y, X_endo] ────────────────────────────────
  // The bilinear forms V'V, V'Z, V'W are extracted from the suff-stats matrices.
  // Index 0 = Y; indices 1..m-1 = X[endoIdx[j-1]] for j=1..m-1.
  const endo = endoIdx;
  const m = 1 + endo.length;

  // V'V
  const VtV = Array.from({ length: m }, () => Array(m).fill(0));
  // V[0]·V[0] = Y'Y
  VtV[0][0] = YtY;
  // V[0]·V[j] = X_endo[j-1]' Y = XtY[endo[j-1]]
  for (let j = 1; j < m; j++) {
    VtV[0][j] = XtY[endo[j - 1]];
    VtV[j][0] = XtY[endo[j - 1]];
  }
  // V[i]·V[j] = X_endo[i-1]' X_endo[j-1] = XtX[endo[i-1]][endo[j-1]]
  for (let i = 1; i < m; i++) {
    for (let j = 1; j < m; j++) {
      VtV[i][j] = XtX[endo[i - 1]][endo[j - 1]];
    }
  }

  // V'Z (m × l+1):  V[0]·Z = Z'Y' = ZtY' as row; V[i]·Z = X_endo' Z
  const lDim = ZtZ.length;
  const VtZ = Array.from({ length: m }, () => Array(lDim).fill(0));
  for (let p = 0; p < lDim; p++) {
    VtZ[0][p] = ZtY[p];   // by symmetry Y'Z = (Z'Y)
    for (let j = 1; j < m; j++) {
      VtZ[j][p] = ZtX[p][endo[j - 1]];  // X_endo[j-1] · Z[p] = (Z'X)[p][endo[j-1]]
    }
  }

  // V'W (m × w+1)
  const wDim = WtW.length;
  const VtW = Array.from({ length: m }, () => Array(wDim).fill(0));
  for (let p = 0; p < wDim; p++) {
    VtW[0][p] = WtY[p];
    for (let j = 1; j < m; j++) {
      VtW[j][p] = WtX[p][endo[j - 1]];
    }
  }

  // A = V' M_Z V = V'V − (V'Z)(Z'Z)⁻¹(Z'V)
  const A = mProjForms(VtV, VtZ, ZtZinv);
  // B = V' M_W V = V'V − (V'W)(W'W)⁻¹(W'V)
  const B = mProjForms(VtV, VtW, WtWinv);

  // κ = min eigenvalue of A⁻¹B
  const kappa = m === 2 ? limlKappa2x2(A, B) : limlKappaPower(A, B, m);
  if (!isFinite(kappa)) return null;

  // β_LIML = (X'X − κ·X'M_Z X)⁻¹ (X'Y − κ·X'M_Z Y)
  // X'M_Z X = XtX − (X'Z)(Z'Z)⁻¹(Z'X)
  const XtZ = transpose(ZtX);
  const XtZ_ZtZi = matMul(XtZ, ZtZinv);
  const XtMzX = XtX.map((row, i) => row.map((v, j) => v - dot(XtZ_ZtZi[i], ZtX.map(r => r[j]))));
  // X'M_Z Y = XtY − (X'Z)(Z'Z)⁻¹ Z'Y
  const XtMzY = XtY.map((v, i) => v - dot(XtZ_ZtZi[i], ZtY));

  const lhsMat = XtX.map((row, i) => row.map((v, j) => v - kappa * XtMzX[i][j]));
  const lhsInv = matInv(lhsMat);
  if (!lhsInv) return null;
  const rhsVec = XtY.map((v, i) => v - kappa * XtMzY[i]);
  const beta   = vmul(lhsInv, rhsVec);

  // Classical SE: σ̂² · (X'P_Z X)⁻¹ where X'P_Z X = X'X − X'M_Z X
  const XtPzX  = XtX.map((row, i) => row.map((v, j) => v - XtMzX[i][j]));
  const XtPzXi = matInv(XtPzX);
  if (!XtPzXi) return null;

  // SSR = Y'Y − 2β'X'Y + β'X'Xβ
  const SSR = YtY
    - 2 * beta.reduce((s, b, i) => s + b * XtY[i], 0)
    + beta.reduce((s, b, i) => s + b * vmul(XtX, beta)[i], 0);
  const df = n - k;
  const s2 = SSR / Math.max(1, df);

  let V;
  if (meat) {
    const scaleMeat = hcType === "HC1" ? n / Math.max(1, df) : 1;
    const scaled = meat.map(row => row.map(v => v * scaleMeat));
    V = matMul(matMul(XtPzXi, scaled), XtPzXi);
  } else {
    V = XtPzXi.map(row => row.map(v => v * s2));
  }
  const se = V.map((row, i) => {
    const d = row[i];
    return isFinite(d) && d >= 0 ? Math.sqrt(d) : NaN;
  });
  const tStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = tStats.map(t => (isFinite(t) ? pValue(t, df) : NaN));

  const Ym  = sumY / n;
  const SST = YtY - n * Ym * Ym;
  const R2  = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return {
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    kappa, SSR, ssr: SSR, s2,
    varNames,
    XtXinv: XtPzXi,
  };
}
