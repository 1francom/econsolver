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

// ─── MATH UTILITIES ───────────────────────────────────────────────────────────

function normalCDF(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 +
               t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? p : 1 - p;
}

// Wilson-Hilferty approximation for chi-squared tail probability
function chiSqPval(chi2, df) {
  if (!isFinite(chi2) || df <= 0 || chi2 < 0) return NaN;
  if (chi2 === 0) return 1;
  const z = (Math.pow(chi2 / df, 1 / 3) - (1 - 2 / (9 * df))) /
            Math.sqrt(2 / (9 * df));
  return 1 - normalCDF(z);
}

// Dot product of two 1-D arrays
function dot(a, b) { return a.reduce((s, v, i) => s + v * b[i], 0); }

// ─── PROJECTION HELPERS ───────────────────────────────────────────────────────

// M_Z v = v − Z(Z′Z)⁻¹Z′v  (annihilate Z on a 1-D vector v)
function mzVec(Zarr, v) {
  const Zt      = transpose(Zarr);
  const ZtZinv  = matInv(matMul(Zt, Zarr));
  if (!ZtZinv) return null;
  const Ztv     = Zt.map(row => dot(row, v));              // l-array: Z′v
  const ZtZiZtv = ZtZinv.map(row => dot(row, Ztv));       // l-array: (Z′Z)⁻¹Z′v
  const Pzv     = Zarr.map(row => dot(row, ZtZiZtv));     // n-array: P_Z v
  return v.map((vi, i) => vi - Pzv[i]);
}

// ─── DATA EXTRACTION ─────────────────────────────────────────────────────────

function extractData(rows, yCol, xCols, wCols, zCols) {
  const allCols = [yCol, ...xCols, ...wCols, ...zCols];
  const valid = rows.filter(r =>
    allCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (!valid.length) return null;
  const n = valid.length;
  // X = [1, wCols, xCols]   (all regressors)
  // Z = [1, wCols, zCols]   (full instrument set)
  // W = [1, wCols]           (exogenous regressors only)
  return {
    Y:  valid.map(r => r[yCol]),
    X:  valid.map(r => [1, ...wCols.map(c => r[c]), ...xCols.map(c => r[c])]),
    Z:  valid.map(r => [1, ...wCols.map(c => r[c]), ...zCols.map(c => r[c])]),
    Wn: valid.map(r => [1, ...wCols.map(c => r[c])]),
    n,
    valid,
  };
}

// ─── FIRST STAGES (shared with GMM and LIML) ─────────────────────────────────
function buildFirstStages(valid, xCols, wCols, zCols, n) {
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
  if (overidDf < 0)
    return { error: "More endogenous regressors than instruments — model not identified." };

  const d = extractData(rows, yCol, xCols, wCols, zCols);
  if (!d) return { error: "No complete observations after filtering." };
  const { Y, X, Z, n, valid } = d;

  const k = X[0].length;    // number of parameters (1 + |wCols| + |xCols|)
  const l = Z[0].length;    // instrument set size  (1 + |wCols| + |zCols|)
  if (n < l + 2) return { error: "Insufficient observations for GMM estimation." };

  const Xt = transpose(X);   // k×n
  const Zt = transpose(Z);   // l×n

  // X′Z (k×l), Z′X (l×k), Z′Y (l)
  const XtZ = matMul(Xt, Z);
  const ZtX = matMul(Zt, X);
  const ZtY = Zt.map(row => dot(row, Y));

  // (Z′Z)⁻¹
  const ZtZ    = matMul(Zt, Z);
  const ZtZinv = matInv(ZtZ);
  if (!ZtZinv) return { error: "Instrument matrix Z′Z is singular. Check for collinearity among instruments." };

  // ── Step 1: 2SLS β̂ ────────────────────────────────────────────────────────
  // P_Z X = Z(Z′Z)⁻¹Z′X   (n×k)
  const PzX    = matMul(Z, matMul(ZtZinv, ZtX));
  const PzXt   = transpose(PzX);
  const XtPzX  = matMul(PzXt, X);           // k×k
  const XtPzXi = matInv(XtPzX);
  if (!XtPzXi) return { error: "2SLS first-step matrix singular — check instrument relevance." };

  // P_Z Y
  const ZtZiZtY = ZtZinv.map(row => dot(row, ZtY));
  const PzY = Z.map(row => dot(row, ZtZiZtY));
  const XtPzY = PzXt.map(row => dot(row, PzY));
  const beta1 = XtPzXi.map(row => dot(row, XtPzY));

  const resid1 = Y.map((y, i) => y - dot(X[i], beta1));

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

  // ── β_GMM = (X′Z Ω̂⁻¹ Z′X)⁻¹ X′Z Ω̂⁻¹ Z′Y ──────────────────────────────────
  const XtZ_OI = matMul(XtZ, OmegaInv);                   // k×l
  const A      = matMul(XtZ_OI, ZtX);                     // k×k
  const Ainv   = matInv(A);
  if (!Ainv) return { error: "GMM matrix (X′ZΩ̂⁻¹Z′X) is singular." };

  const bVec = XtZ_OI.map(row => dot(row, ZtY));          // k
  const beta  = Ainv.map(row => dot(row, bVec));          // k

  // ── SE = sqrt(diag(Ainv / n)) ────────────────────────────────────────────────
  const df     = n - k;
  const se     = Ainv.map((row, i) => Math.sqrt(Math.abs(row[i] / n)));
  const tStats = beta.map((b, i) => se[i] > 0 ? b / se[i] : NaN);
  const pVals  = tStats.map(t => isFinite(t) ? pValue(t, df) : NaN);

  // ── Fit ──────────────────────────────────────────────────────────────────────
  const resid  = Y.map((y, i) => y - dot(X[i], beta));
  const Yhat   = Y.map((y, i) => y - resid[i]);
  const Ym     = Y.reduce((a, b) => a + b, 0) / n;
  const SST    = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const SSR    = resid.reduce((s, e) => s + e * e, 0);
  const R2     = SST > 0 ? 1 - SSR / SST : NaN;
  const adjR2  = isFinite(R2) ? 1 - (1 - R2) * (n - 1) / df : NaN;

  // ── J-stat (Hansen overidentification test) ──────────────────────────────────
  // g = Z′ε̂/n  (l-vector of moment conditions)
  const g     = Zt.map(row => dot(row, resid) / n);
  const OIg   = OmegaInv.map(row => dot(row, g));
  const jStat = n * dot(g, OIg);
  const jDf   = overidDf;
  const jPval = jDf > 0 ? chiSqPval(jStat, jDf) : NaN;

  // ── First stages ──────────────────────────────────────────────────────────────
  const firstStages = buildFirstStages(valid, xCols, wCols, zCols, n);
  const varNames = ["(Intercept)", ...wCols, ...xCols];

  return {
    varNames, beta, se, tStats, pVals,
    R2, adjR2, n, df,
    jStat, jPval, jDf,
    resid, Yhat,
    firstStages,
  };
}

// ─── LIML (LIMITED INFORMATION MAXIMUM LIKELIHOOD) ───────────────────────────
//
// κ = minimum eigenvalue of A⁻¹B where:
//   A = [Y,X₁]′ M_Z [Y,X₁]   (M_Z annihilates full instrument set Z=[W,Z₁])
//   B = [Y,X₁]′ M_W [Y,X₁]   (M_W annihilates exogenous regressors W only)
//
// Since M_W ≥ M_Z (M_Z projects out more), B ≥ A, so κ ≥ 1.
// κ = 1 for exactly-identified (same as 2SLS).
//
// β_LIML = (X′X − κ·X′M_Z X)⁻¹(X′Y − κ·X′M_Z Y)
//
// SE: σ̂² = ε′ε/(n−k);  Var(β) = σ̂²(X′P_Z X)⁻¹
//
export function runLIML(rows, yCol, xCols, wCols, zCols) {
  const overidDf = zCols.length - xCols.length;
  if (overidDf < 0)
    return { error: "More endogenous regressors than instruments — model not identified." };

  const d = extractData(rows, yCol, xCols, wCols, zCols);
  if (!d) return { error: "No complete observations after filtering." };
  const { Y, X, Z, Wn, n, valid } = d;

  const k = X[0].length;
  const l = Z[0].length;
  if (n < l + 2) return { error: "Insufficient observations for LIML estimation." };

  const Xt = transpose(X);
  const Zt = transpose(Z);

  // ── Compute M_Z and M_W residuals for [Y, xCols columns] ────────────────────
  // We need M_Z y, M_W y, and for each endogenous x1: M_Z x1, M_W x1
  // For the (k1+1)×(k1+1) matrices A and B (k1 = xCols.length)

  const m = xCols.length + 1;    // size of generalized eigenvalue problem
  // vecs[0] = Y, vecs[1..k1] = xCols
  const vecs = [Y, ...xCols.map(c => valid.map(r => r[c]))];

  // Compute M_Z and M_W applied to each vector
  const mzVecs = vecs.map(v => mzVec(Z, v));
  const mwVecs = vecs.map(v => mzVec(Wn, v));   // M_W = annihilate W (exog only)

  if (mzVecs.some(v => !v) || mwVecs.some(v => !v))
    return { error: "Singular matrix while computing LIML projections." };

  // ── Build m×m matrices A and B ───────────────────────────────────────────────
  // A[i][j] = mzVecs[i] · mzVecs[j]
  // B[i][j] = mwVecs[i] · mwVecs[j]
  const A = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => dot(mzVecs[i], mzVecs[j]))
  );
  const B = Array.from({ length: m }, (_, i) =>
    Array.from({ length: m }, (_, j) => dot(mwVecs[i], mwVecs[j]))
  );

  // ── κ = min eigenvalue of A⁻¹B ──────────────────────────────────────────────
  // Equivalent to max eigenvalue of B⁻¹A, inverted.
  const kappa = m === 2
    ? limlKappa2x2(A, B)
    : limlKappaPower(A, B, m);

  if (!isFinite(kappa)) return { error: "LIML eigenvalue computation failed — check instrument validity." };

  // ── β_LIML = (X′X − κ·X′M_Z X)⁻¹(X′Y − κ·X′M_Z Y) ─────────────────────────
  // MzX[j] = M_Z applied to j-th column of X (n-vector)
  // MzX[j] = M_Z (j-th column of X); (M_Z X_j)′Y = X_j′ M_Z Y by symmetry of M_Z
  const MzX  = Array.from({ length: k }, (_, j) => mzVec(Z, X.map(row => row[j])));

  const XtX    = matMul(Xt, X);
  // (X′M_Z X)[j][l] = (M_Z X_j)′ X_l = dot(MzX[j], X_col_l)
  const XtMzXc = Array.from({ length: k }, (_, j) =>
    Array.from({ length: k }, (_, l2) => dot(MzX[j], X.map(r => r[l2])))
  );

  const lhsMat = XtX.map((row, i) => row.map((v, j) => v - kappa * XtMzXc[i][j]));
  const lhsInv = matInv(lhsMat);
  if (!lhsInv) return { error: "LIML matrix (X′X − κX′M_Z X) is singular." };

  // X′Y − κ X′M_Z Y
  const XtY    = Xt.map(row => dot(row, Y));
  const XtMzY  = MzX.map(mzxj => dot(mzxj, Y));
  const rhsVec = XtY.map((v, j) => v - kappa * XtMzY[j]);
  const beta   = lhsInv.map(row => dot(row, rhsVec));

  // ── SE: σ̂²(X′P_Z X)⁻¹ ─────────────────────────────────────────────────────
  const ZtY  = Zt.map(row => dot(row, Y));
  const ZtX  = matMul(Zt, X);
  const ZtZinv = matInv(matMul(Zt, Z));
  if (!ZtZinv) return { error: "Z′Z singular in LIML SE computation." };

  const ZtZiZtX = matMul(ZtZinv, ZtX);
  const PzX     = matMul(Z, ZtZiZtX);           // n×k
  const PzXt    = transpose(PzX);
  const XtPzX   = matMul(PzXt, X);              // k×k
  const XtPzXi  = matInv(XtPzX);
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

  // ── First stages ──────────────────────────────────────────────────────────────
  const firstStages = buildFirstStages(valid, xCols, wCols, zCols, n);
  const varNames = ["(Intercept)", ...wCols, ...xCols];

  return {
    varNames, beta, se, tStats, pVals,
    R2, adjR2, n, df,
    kappa,
    resid, Yhat,
    firstStages,
  };
}

// ─── LIML EIGENVALUE SOLVERS ─────────────────────────────────────────────────

// Exact min eigenvalue of A⁻¹B for 2×2 symmetric matrices
// Solves det(B − κA) = 0 → det(A)κ² − c₁κ + det(B) = 0
function limlKappa2x2(A, B) {
  const [A00, A01, A11] = [A[0][0], A[0][1], A[1][1]];
  const [B00, B01, B11] = [B[0][0], B[0][1], B[1][1]];
  const detA = A00 * A11 - A01 * A01;
  const detB = B00 * B11 - B01 * B01;
  const c1   = A00 * B11 + B00 * A11 - 2 * A01 * B01;
  const disc = c1 * c1 - 4 * detA * detB;
  if (disc < 0) return NaN;
  const sq   = Math.sqrt(disc);
  const k1   = (c1 - sq) / (2 * detA);
  const k2   = (c1 + sq) / (2 * detA);
  return Math.min(k1, k2);
}

// Power iteration for min eigenvalue of A⁻¹B (general m×m)
// Uses inverse power: iterate on M = B⁻¹A (max eigenvalue of M = 1/min of A⁻¹B)
function limlKappaPower(A, B, m, maxIter = 120) {
  const Binv = matInv(B);
  if (!Binv) return NaN;
  const M = matMul(Binv, A);  // B⁻¹A; max eigenvalue = 1/κ_min

  let v = Array.from({ length: m }, (_, i) => i === 0 ? 1 : 0.1);
  let lambda = 1;

  for (let iter = 0; iter < maxIter; iter++) {
    const Mv   = M.map(row => dot(row, v));
    const norm = Math.sqrt(Mv.reduce((s, x) => s + x * x, 0));
    if (norm < 1e-14) break;
    v = Mv.map(x => x / norm);
    const Mv2 = M.map(row => dot(row, v));
    lambda = dot(v, Mv2);    // Rayleigh quotient: v′(B⁻¹A)v
  }
  return Math.abs(lambda) > 1e-10 ? 1 / lambda : NaN;
}
