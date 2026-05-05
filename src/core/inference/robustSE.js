// ─── ECON STUDIO · src/core/inference/robustSE.js ────────────────────────────
// Robust and clustered standard error sandwich estimators.
// Pure JS. No React. No side effects. No external imports.
//
// SE types supported:
//   "classical"  — OLS σ²(X′X)⁻¹  (default, backward compatible)
//   "HC0"        — White (1980) sandwich, no df correction
//   "HC1"        — HC0 × n/(n−k)   (Stata default "robust")
//   "HC2"        — leverage-corrected: e_i²/(1−h_ii)
//   "HC3"        — squared leverage: e_i²/(1−h_ii)²
//   "clustered"  — one-way clustered (Cameron & Miller 2015)
//   "twoway"     — two-way clustered (Cameron, Gelbach & Miller 2011)
//   "HAC"        — Newey-West HAC with Bartlett kernel

// ─── INTERNAL HELPERS ────────────────────────────────────────────────────────

// Matrix multiply: A (m×k) × B (k×p) → (m×p)
function mm(A, B) {
  const m = A.length, k = B.length, p = B[0].length;
  const C = Array.from({ length: m }, () => Array(p).fill(0));
  for (let i = 0; i < m; i++)
    for (let j = 0; j < p; j++)
      for (let l = 0; l < k; l++) C[i][j] += A[i][l] * B[l][j];
  return C;
}

// Transpose of (m×k) → (k×m)
function tr(M) {
  return M[0].map((_, c) => M.map(r => r[c]));
}

// Matrix inversion (Gauss-Jordan)
function inv(M) {
  const n = M.length;
  const aug = M.map((row, i) => [
    ...row,
    ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0)),
  ]);
  for (let col = 0; col < n; col++) {
    let max = col;
    for (let r = col + 1; r < n; r++)
      if (Math.abs(aug[r][col]) > Math.abs(aug[max][col])) max = r;
    [aug[col], aug[max]] = [aug[max], aug[col]];
    const piv = aug[col][col];
    if (Math.abs(piv) < 1e-12) return null;
    aug[col] = aug[col].map(v => v / piv);
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = aug[r][col];
      aug[r] = aug[r].map((v, c) => v - f * aug[col][c]);
    }
  }
  return aug.map(row => row.slice(n));
}

// Extract square-root of diagonal of V = Q × B × Q′
function sandwichDiagSqrt(Q, B) {
  // V = Q B Q' → diag(V)_i = Σ_j Σ_l Q[i][j] B[j][l] Q[i][l]
  const k = Q.length;
  return Q.map(qi => {
    let v = 0;
    for (let j = 0; j < B.length; j++)
      for (let l = 0; l < B.length; l++) v += qi[j] * B[j][l] * qi[l];
    return v >= 0 ? Math.sqrt(v) : NaN;
  });
}

// Build "meat" B = Σ_i e_i² xᵢxᵢ′, optionally with per-obs leverage scaling
function meatHC(X, e, scaleFn) {
  const n = X.length, k = X[0].length;
  const B = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const w = scaleFn ? scaleFn(i) : e[i] * e[i];
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++) B[j][l] += w * X[i][j] * X[i][l];
  }
  return B;
}

// Compute leverage values h_ii = x_i′(X′X)⁻¹x_i
function leverages(XtXinv, X) {
  return X.map(xi => {
    let h = 0;
    for (let j = 0; j < XtXinv.length; j++)
      for (let l = 0; l < XtXinv.length; l++)
        h += xi[j] * XtXinv[j][l] * xi[l];
    return Math.min(1 - 1e-10, Math.max(0, h)); // clamp to [0, 1)
  });
}

// ─── HC SANDWICH (HC0, HC1, HC2, HC3) ────────────────────────────────────────
/**
 * sandwichSE — heteroskedasticity-robust standard errors.
 *
 * @param {number[][]} XtXinv  — (X′X)⁻¹, shape k×k
 * @param {number[][]} X       — design matrix, shape n×k
 * @param {number[]}   e       — residuals, length n
 * @param {number}     n       — number of observations
 * @param {number}     k       — number of parameters (including intercept)
 * @param {string}     variant — "HC0"|"HC1"|"HC2"|"HC3"
 * @returns {number[]} se — standard error array, length k
 */
export function sandwichSE(XtXinv, X, e, n, k, variant = "HC1") {
  let B;

  if (variant === "HC0" || variant === "HC1") {
    B = meatHC(X, e, i => e[i] * e[i]);
    if (variant === "HC1") {
      const scale = n / (n - k);
      B = B.map(row => row.map(v => v * scale));
    }
  } else {
    // HC2 or HC3: need leverages
    const h = leverages(XtXinv, X);
    const exp = variant === "HC3" ? 2 : 1;
    B = meatHC(X, e, i => (e[i] * e[i]) / Math.pow(1 - h[i], exp));
  }

  return sandwichDiagSqrt(XtXinv, B);
}

// ─── ONE-WAY CLUSTERED SE ────────────────────────────────────────────────────
/**
 * clusteredSE — one-way cluster-robust standard errors.
 *
 * @param {number[][]} XtXinv  — (X′X)⁻¹, shape k×k
 * @param {number[][]} X       — design matrix, shape n×k
 * @param {number[]}   e       — residuals, length n
 * @param {Array}      clusters — cluster labels, length n (any comparable type)
 * @param {number}     n
 * @param {number}     k
 * @returns {number[]} se
 */
export function clusteredSE(XtXinv, X, e, clusters, n, k) {
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const g = clusters[i];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }

  const G = groups.size;
  const p = X[0].length;
  const B = Array.from({ length: p }, () => Array(p).fill(0));

  for (const idxs of groups.values()) {
    // score sum for this cluster: s_g = Σ_{i∈g} e_i x_i  (length k)
    const sg = Array(p).fill(0);
    for (const i of idxs)
      for (let j = 0; j < p; j++) sg[j] += e[i] * X[i][j];
    // outer product: sg sg′
    for (let j = 0; j < p; j++)
      for (let l = 0; l < p; l++) B[j][l] += sg[j] * sg[l];
  }

  // Small-sample correction: G/(G-1) × (n-1)/(n-k)
  const scale = (G / (G - 1)) * ((n - 1) / (n - k));
  const Bsc = B.map(row => row.map(v => v * scale));

  return sandwichDiagSqrt(XtXinv, Bsc);
}

// ─── TWO-WAY CLUSTERED SE ────────────────────────────────────────────────────
/**
 * twowayClusteredSE — Cameron-Gelbach-Miller two-way clustered SE.
 * V = V_1 + V_2 − V_12  where V_12 = clustered by interaction label.
 *
 * @param {number[][]} XtXinv
 * @param {number[][]} X
 * @param {number[]}   e
 * @param {Array}      clusters1 — first clustering dimension, length n
 * @param {Array}      clusters2 — second clustering dimension, length n
 * @param {number}     n
 * @param {number}     k
 * @returns {number[]} se
 */
export function twowayClusteredSE(XtXinv, X, e, clusters1, clusters2, n, k) {
  const interact = clusters1.map((c1, i) => `${c1}|${clusters2[i]}`);

  const se1  = clusteredSE(XtXinv, X, e, clusters1, n, k);
  const se2  = clusteredSE(XtXinv, X, e, clusters2, n, k);
  const se12 = clusteredSE(XtXinv, X, e, interact,  n, k);

  // V = V1 + V2 - V12 → SE = sqrt(max(0, se1²+se2²-se12²))
  return se1.map((s1, i) => {
    const v = s1 * s1 + se2[i] * se2[i] - se12[i] * se12[i];
    return v >= 0 ? Math.sqrt(v) : 0;
  });
}

// ─── NEWEY-WEST HAC ──────────────────────────────────────────────────────────
/**
 * neweyWestSE — HAC standard errors with Bartlett kernel (Newey & West 1987).
 *
 * @param {number[][]} XtXinv  — (X′X)⁻¹, shape k×k
 * @param {number[][]} X       — design matrix, shape n×k (MUST be sorted by tIndex)
 * @param {number[]}   e       — residuals, length n
 * @param {number[]}   tIndex  — integer time indices, length n (used for ordering)
 * @param {number}     maxLag  — bandwidth (default: floor(4*(n/100)^(2/9)))
 * @param {number}     n
 * @param {number}     k
 * @returns {number[]} se
 */
export function neweyWestSE(XtXinv, X, e, tIndex, maxLag, n, k) {
  const L = maxLag ?? Math.floor(4 * Math.pow(n / 100, 2 / 9));

  // Sort by time index
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => tIndex[a] - tIndex[b]);
  const Xs = order.map(i => X[i]);
  const es = order.map(i => e[i]);

  const p = X[0].length;

  // Γ_0 = Σ_t e_t² x_t x_t′
  const G0 = meatHC(Xs, es, i => es[i] * es[i]);

  // B = Γ_0 + Σ_{l=1}^{L} w_l (Γ_l + Γ_l′)
  const B = G0.map(row => [...row]);

  for (let lag = 1; lag <= L; lag++) {
    const w = 1 - lag / (L + 1); // Bartlett weight
    // Γ_lag[j][l] = Σ_{t=lag}^{n-1} e_t e_{t-lag} X_t[j] X_{t-lag}[l]
    const Gl = Array.from({ length: p }, () => Array(p).fill(0));
    for (let t = lag; t < n; t++)
      for (let j = 0; j < p; j++)
        for (let l = 0; l < p; l++)
          Gl[j][l] += es[t] * es[t - lag] * Xs[t][j] * Xs[t - lag][l];
    // Add w * (Γ_l + Γ_l′) — Γ_l′[j][l] = Γ_l[l][j]
    for (let j = 0; j < p; j++)
      for (let l = 0; l < p; l++)
        B[j][l] += w * (Gl[j][l] + Gl[l][j]);
  }

  return sandwichDiagSqrt(XtXinv, B);
}

// ─── DISPATCH ────────────────────────────────────────────────────────────────
/**
 * computeRobustSE — unified entry point.
 *
 * @param {Object}     seOpts     — { seType, clusterVar, clusterVar2, timeVar, maxLag }
 * @param {number[][]} XtXinv    — (X′X)⁻¹ (or (X′WX)⁻¹ for WLS)
 * @param {number[][]} X         — design matrix, n×k
 * @param {number[]}   e         — residuals
 * @param {number}     n
 * @param {number}     k
 * @param {Object[]}   rows      — original data rows (for extracting cluster/time columns)
 * @returns {number[]|null} se array, or null if classical (caller uses its own se)
 */
export function computeRobustSE(seOpts, XtXinv, X, e, n, k, rows) {
  const { clusterVar, clusterVar2, timeVar, maxLag } = seOpts ?? {};
  const seType = (seOpts?.seType ?? "classical").toUpperCase();

  if (seType === "CLASSICAL") return null;

  if (seType === "HC0" || seType === "HC1" || seType === "HC2" || seType === "HC3") {
    return sandwichSE(XtXinv, X, e, n, k, seType);
  }

  if (seType === "CLUSTERED") {
    if (!clusterVar || !rows) return sandwichSE(XtXinv, X, e, n, k, "HC1");
    const clusters = rows.map(r => r[clusterVar] ?? "__missing__");
    return clusteredSE(XtXinv, X, e, clusters, n, k);
  }

  if (seType === "TWOWAY") {
    if (!clusterVar || !clusterVar2 || !rows) return sandwichSE(XtXinv, X, e, n, k, "HC1");
    const c1 = rows.map(r => r[clusterVar]  ?? "__missing__");
    const c2 = rows.map(r => r[clusterVar2] ?? "__missing__");
    return twowayClusteredSE(XtXinv, X, e, c1, c2, n, k);
  }

  if (seType === "HAC") {
    if (!timeVar || !rows) return sandwichSE(XtXinv, X, e, n, k, "HC1");
    const tIdx = rows.map(r => Number(r[timeVar] ?? 0));
    return neweyWestSE(XtXinv, X, e, tIdx, maxLag, n, k);
  }

  return null; // unknown type → caller keeps classical
}
