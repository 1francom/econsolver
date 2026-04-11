// ─── ECON STUDIO · src/math/GMMEngine.js ─────────────────────────────────────
// Two-step efficient GMM and LIML (k-class) estimators.
// Pure JS — no React, no side effects. Depends only on LinearEngine.js.
//
// Conventions (matching CausalEngine.js):
//   xCols  — endogenous regressors
//   wCols  — exogenous controls (intercept added automatically)
//   zCols  — excluded instruments
//
// GMM two-step:
//   Step 1: 2SLS residuals ε̂
//   Step 2: Ω̂ = (1/n)Z′diag(ε̂²)Z  →  β_GMM = (X′ZΩ̂⁻¹Z′X)⁻¹X′ZΩ̂⁻¹Z′Y
//   J-stat = n·g′Ω̂⁻¹g ~ χ²(l−k) where g = Z′ε̂/n
//
// LIML (k-class):
//   κ = min eigenvalue of A⁻¹B where A=[Y,X1]′M_Z[Y,X1], B=[Y,X1]′M_W[Y,X1]
//   β_LIML = (X′X − κ·X′M_Z X)⁻¹(X′Y − κ·X′M_Z Y)

import { transpose, matMul, matInv, pValue, runOLS, fCDF } from "./LinearEngine.js";
import { normCDF } from "./NonLinearEngine.js";

const ERR_UNDERIDENTIFIED = "More endogenous regressors than instruments — model not identified.";

// Wilson-Hilferty chi-squared tail probability
function chiSqPval(chi2, df) {
  if (!isFinite(chi2) || df <= 0 || chi2 < 0) return NaN;
  if (chi2 === 0) return 1;
  const z = (Math.pow(chi2 / df, 1 / 3) - (1 - 2 / (9 * df))) /
            Math.sqrt(2 / (9 * df));
  return 1 - normCDF(z);
}

function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }

// ─── PROJECTION HELPERS ───────────────────────────────────────────────────────

// M_Z v with caller-supplied (Z′Z)⁻¹ and Z′ — avoids repeated matrix inversion
// when projecting many vectors onto the same Z.
function mzVecCached(Zarr, ZtZinv, Zt, v) {
  const Ztv     = Zt.map(row => dot(row, v));
  const ZtZiZtv = ZtZinv.map(row => dot(row, Ztv));
  const Pzv     = Zarr.map(row => dot(row, ZtZiZtv));
  return v.map((vi, i) => vi - Pzv[i]);
}

// M_Z v — computes and inverts (Z′Z) internally; use when projecting a single vector.
function mzVec(Zarr, v) {
  const Zt     = transpose(Zarr);
  const ZtZinv = matInv(matMul(Zt, Zarr));
  if (!ZtZinv) return null;
  return mzVecCached(Zarr, ZtZinv, Zt, v);
}

// ─── DATA EXTRACTION ─────────────────────────────────────────────────────────

function extractData(rows, yCol, xCols, wCols, zCols) {
  const allCols = [yCol, ...xCols, ...wCols, ...zCols];
  const valid = rows.filter(r =>
    allCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (!valid.length) return null;
  return {
    Y:   valid.map(r => r[yCol]),
    X:   valid.map(r => [1, ...wCols.map(c => r[c]), ...xCols.map(c => r[c])]),
    Z:   valid.map(r => [1, ...wCols.map(c => r[c]), ...zCols.map(c => r[c])]),
    Wn:  valid.map(r => [1, ...wCols.map(c => r[c])]),
    n:   valid.length,
    valid,
  };
}

// ─── FIRST STAGES (shared by GMM and LIML) ───────────────────────────────────
function buildFirstStages(valid, xCols, wCols, zCols) {
  const n = valid.length;
  const instrCols = [...zCols, ...wCols];
  return xCols.map(endVar => {
    const res = runOLS(valid, endVar, instrCols);
    if (!res) return null;
    const restricted = wCols.length > 0 ? runOLS(valid, endVar, wCols) : null;
    const SSR_r = restricted
      ? restricted.SSR
      : (() => {
          const Ym = valid.reduce((s, r) => s + r[endVar], 0) / n;
          return valid.reduce((s, r) => s + (r[endVar] - Ym) ** 2, 0);
        })();
    const q     = zCols.length;
    const Fstat = ((SSR_r - res.SSR) / q) / (res.SSR / res.df);
    const Fpval = fCDF(Fstat, q, res.df);
    return { ...res, endVar, Fstat, Fpval, weak: Fstat < 10 };
  });
}

// ─── TWO-STEP EFFICIENT GMM ───────────────────────────────────────────────────
export function runGMM(rows, yCol, xCols, wCols, zCols) {
  const overidDf = zCols.length - xCols.length;
  if (overidDf < 0) return { error: ERR_UNDERIDENTIFIED };

  const d = extractData(rows, yCol, xCols, wCols, zCols);
  if (!d) return { error: "No complete observations after filtering." };
  const { Y, X, Z, n, valid } = d;

  const k = X[0].length;
  const l = Z[0].length;
  if (n < l + 2) return { error: "Insufficient observations for GMM estimation." };

  const Xt = transpose(X);
  const Zt = transpose(Z);

  const XtZ = matMul(Xt, Z);
  const ZtX = matMul(Zt, X);
  const ZtY = Zt.map(row => dot(row, Y));

  const ZtZ    = matMul(Zt, Z);
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return { error: "Instrument matrix Z′Z is singular. Check for collinearity among instruments." };

  // ── Step 1: 2SLS β̂ ────────────────────────────────────────────────────────
  const PzX    = matMul(Z, matMul(ZtZinv, ZtX));
  const PzXt   = transpose(PzX);
  const XtPzX  = matMul(PzXt, X);
  const XtPzXi = matInv(XtPzX);
  if (!XtPzXi) return { error: "2SLS first-step matrix singular — check instrument relevance." };

  const ZtZiZtY = ZtZinv.map(row => dot(row, ZtY));
  const PzY     = Z.map(row => dot(row, ZtZiZtY));
  const XtPzY   = PzXt.map(row => dot(row, PzY));
  const beta1   = XtPzXi.map(row => dot(row, XtPzY));
  const resid1  = Y.map((y, i) => y - dot(X[i], beta1));

  // ── Step 2: Ω̂ = (1/n)Z′diag(ε̂²)Z ──────────────────────────────────────────
  const Omega = Array.from({ length: l }, (_, a) =>
    Array.from({ length: l }, (_, b) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += resid1[i] ** 2 * Z[i][a] * Z[i][b];
      return s / n;
    })
  );
  const OmegaInv = matInv(Omega);
  if (!OmegaInv) return { error: "GMM weighting matrix Ω̂ is singular. Increase variation in instruments." };

  // ── β_GMM = (X′ZΩ̂⁻¹Z′X)⁻¹X′ZΩ̂⁻¹Z′Y ────────────────────────────────────────
  const XtZ_OI = matMul(XtZ, OmegaInv);
  const A      = matMul(XtZ_OI, ZtX);
  const Ainv   = matInv(A);
  if (!Ainv) return { error: "GMM matrix (X′ZΩ̂⁻¹Z′X) is singular." };

  const bVec = XtZ_OI.map(row => dot(row, ZtY));
  const beta  = Ainv.map(row => dot(row, bVec));

  // SE = sqrt(diag(n · Ainv))
  // Derivation: A = X′Z·Ω̂⁻¹·Z′X is O(n²). The asymptotic variance of √n·β̂
  // is (D′Ω̂⁻¹D)⁻¹ where D = (1/n)X′Z, so Var(β̂) = n·A⁻¹.
  const df     = n - k;
  const se     = Ainv.map((row, i) => Math.sqrt(Math.abs(row[i] * n)));
  const tStats = beta.map((b, i) => se[i] > 0 ? b / se[i] : NaN);
  const pVals  = tStats.map(t => isFinite(t) ? pValue(t, df) : NaN);

  const resid = Y.map((y, i) => y - dot(X[i], beta));
  const Yhat  = Y.map((y, i) => y - resid[i]);
  const Ym    = Y.reduce((a, b) => a + b, 0) / n;
  const SST   = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const SSR   = resid.reduce((s, e) => s + e * e, 0);
  const R2    = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // ── J-stat (Hansen overidentification test): g = Z′ε̂/n, J = n·g′Ω̂⁻¹g ────────
  const g     = Zt.map(row => dot(row, resid) / n);
  const OIg   = OmegaInv.map(row => dot(row, g));
  const jStat = n * dot(g, OIg);
  const jPval = overidDf > 0 ? chiSqPval(jStat, overidDf) : NaN;

  return {
    varNames: ["(Intercept)", ...wCols, ...xCols],
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    jStat, jPval, jDf: overidDf,
    resid, Yhat,
    firstStages: buildFirstStages(valid, xCols, wCols, zCols),
  };
}

// ─── LIML (LIMITED INFORMATION MAXIMUM LIKELIHOOD) ───────────────────────────
//
// κ = minimum eigenvalue of A⁻¹B where:
//   A = [Y,X₁]′ M_Z [Y,X₁]   (M_Z annihilates full instrument set Z=[W,Z₁])
//   B = [Y,X₁]′ M_W [Y,X₁]   (M_W annihilates exogenous regressors W only)
//
// Since M_W ≥ M_Z, B ≥ A so κ ≥ 1. κ = 1 for exactly-identified (= 2SLS).
//
// β_LIML = (X′X − κ·X′M_Z X)⁻¹(X′Y − κ·X′M_Z Y)
// SE: σ̂² = ε′ε/(n−k);  Var(β) = σ̂²(X′P_Z X)⁻¹
//
export function runLIML(rows, yCol, xCols, wCols, zCols) {
  const overidDf = zCols.length - xCols.length;
  if (overidDf < 0) return { error: ERR_UNDERIDENTIFIED };

  const d = extractData(rows, yCol, xCols, wCols, zCols);
  if (!d) return { error: "No complete observations after filtering." };
  const { Y, X, Z, Wn, n, valid } = d;

  const k = X[0].length;
  const l = Z[0].length;
  if (n < l + 2) return { error: "Insufficient observations for LIML estimation." };

  const Xt = transpose(X);
  const Zt = transpose(Z);

  // Pre-compute (Z′Z)⁻¹ and (W′W)⁻¹ once — reused for every mzVecCached call.
  const ZtZinv = matInv(matMul(Zt, Z));
  if (!ZtZinv) return { error: "Instrument matrix Z′Z is singular." };
  const Wt      = transpose(Wn);
  const WtWinv  = matInv(matMul(Wt, Wn));
  if (!WtWinv) return { error: "Exogenous matrix W′W is singular." };

  // ── Build m×m matrices A and B for the generalized eigenvalue problem ─────────
  const m    = xCols.length + 1;
  const vecs = [Y, ...xCols.map(c => valid.map(r => r[c]))];

  const mzVecs = vecs.map(v => mzVecCached(Z, ZtZinv, Zt, v));
  const mwVecs = vecs.map(v => mzVecCached(Wn, WtWinv, Wt, v));
  if (mzVecs.some(v => !v) || mwVecs.some(v => !v))
    return { error: "Singular matrix while computing LIML projections." };

  // A[i][j] = (M_Z vecs[i])·(M_Z vecs[j]),  B[i][j] = (M_W vecs[i])·(M_W vecs[j])
  const A = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => dot(mzVecs[i], mzVecs[j]))
  );
  const B = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => dot(mwVecs[i], mwVecs[j]))
  );

  const kappa = m === 2 ? limlKappa2x2(A, B) : limlKappaPower(A, B, m);
  if (!isFinite(kappa)) return { error: "LIML eigenvalue computation failed — check instrument validity." };

  // ── β_LIML = (X′X − κ·X′M_Z X)⁻¹(X′Y − κ·X′M_Z Y) ─────────────────────────
  // Pre-extract X columns to avoid k² repeated X.map(r => r[j]) allocations.
  const Xcols = Array.from({ length: k }, (_, j) => X.map(r => r[j]));
  const MzX   = Xcols.map(col => mzVecCached(Z, ZtZinv, Zt, col));

  const XtX    = matMul(Xt, X);
  const XtMzX  = Array.from({ length: k }, (_, j) =>
    Array.from({ length: k }, (_, l2) => dot(MzX[j], Xcols[l2]))
  );
  const lhsMat = XtX.map((row, i) => row.map((v, j) => v - kappa * XtMzX[i][j]));
  const lhsInv = matInv(lhsMat);
  if (!lhsInv) return { error: "LIML matrix (X′X − κX′M_Z X) is singular." };

  // (M_Z X_j)′Y = X_j′ M_Z Y by symmetry of M_Z
  const XtY   = Xt.map(row => dot(row, Y));
  const XtMzY = MzX.map(mzxj => dot(mzxj, Y));
  const beta  = lhsInv.map(row => dot(row, XtY.map((v, j) => v - kappa * XtMzY[j])));

  // ── SE: σ̂²(X′P_Z X)⁻¹ — reuse ZtZinv already computed above ──────────────────
  const ZtX     = matMul(Zt, X);
  const PzX     = matMul(Z, matMul(ZtZinv, ZtX));
  const XtPzXi  = matInv(matMul(transpose(PzX), X));
  if (!XtPzXi) return { error: "X′P_Z X singular — weak or missing instruments." };

  const df    = n - k;
  const resid = Y.map((y, i) => y - dot(X[i], beta));
  const SSR   = resid.reduce((s, e) => s + e * e, 0);
  const s2    = SSR / Math.max(1, df);
  const se    = XtPzXi.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => se[i] > 0 ? b / se[i] : NaN);
  const pVals  = tStats.map(t => isFinite(t) ? pValue(t, df) : NaN);

  const Yhat  = Y.map((y, i) => y - resid[i]);
  const Ym    = Y.reduce((a, b) => a + b, 0) / n;
  const SST   = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2    = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2 = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  return {
    varNames: ["(Intercept)", ...wCols, ...xCols],
    beta, se, tStats, pVals,
    R2, adjR2, n, df,
    kappa,
    resid, Yhat,
    firstStages: buildFirstStages(valid, xCols, wCols, zCols),
  };
}

// ─── LIML EIGENVALUE SOLVERS ─────────────────────────────────────────────────

// Exact min eigenvalue of A⁻¹B for 2×2 symmetric matrices.
// Solves det(B − κA) = 0  →  det(A)κ² − c₁κ + det(B) = 0
function limlKappa2x2(A, B) {
  const [A00, A01, A11] = [A[0][0], A[0][1], A[1][1]];
  const [B00, B01, B11] = [B[0][0], B[0][1], B[1][1]];
  const detA = A00 * A11 - A01 * A01;
  const detB = B00 * B11 - B01 * B01;
  const c1   = A00 * B11 + B00 * A11 - 2 * A01 * B01;
  const disc = c1 * c1 - 4 * detA * detB;
  if (disc < 0) return NaN;
  const sq = Math.sqrt(disc);
  return Math.min((c1 - sq) / (2 * detA), (c1 + sq) / (2 * detA));
}

// Power iteration for min eigenvalue of A⁻¹B (general m×m).
// Iterates on M = B⁻¹A; max eigenvalue of M = 1/κ_min.
function limlKappaPower(A, B, m, maxIter = 120) {
  const Binv = matInv(B);
  if (!Binv) return NaN;
  const M = matMul(Binv, A);

  let v = Array.from({ length: m }, (_, i) => i === 0 ? 1 : 0.1);
  let lambda = 1;

  for (let iter = 0; iter < maxIter; iter++) {
    const Mv   = M.map(row => dot(row, v));
    const norm = Math.sqrt(Mv.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-14) break;
    v      = Mv.map(x => x / norm);
    // Rayleigh quotient on already-normalized v avoids recomputing Mv
    lambda = dot(v, M.map(row => dot(row, v)));
  }
  return Math.abs(lambda) > 1e-10 ? 1 / lambda : NaN;
}
