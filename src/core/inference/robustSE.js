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
//   "clustered"  — one-way clustered (Cameron & Miller 2015) — this is CR1
//   "CR2"        — bias-reduced linearization (Bell & McCaffrey 2002)
//   "CR3"        — cluster jackknife approximation
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

// Compute leverage values h_ii via QR decomposition (Gram-Schmidt).
// h_ii = ||Q[i,:]||² where X = Q R.
// More numerically stable than x_i′(X′X)⁻¹x_i (avoids squaring condition number).
function leverages(X) {
  const n = X.length, k = X[0].length;
  // Build orthonormal columns via modified Gram-Schmidt
  const Q = Array.from({ length: k });
  for (let j = 0; j < k; j++) {
    let v = X.map(row => row[j]);
    for (let p = 0; p < j; p++) {
      const dot = Q[p].reduce((s, qi, i) => s + qi * v[i], 0);
      v = v.map((vi, i) => vi - dot * Q[p][i]);
    }
    const norm = Math.sqrt(v.reduce((s, vi) => s + vi * vi, 0));
    Q[j] = norm > 1e-10 ? v.map(vi => vi / norm) : new Array(n).fill(0);
  }
  // h_ii = Σ_j Q[j][i]²
  return Array.from({ length: n }, (_, i) =>
    Math.min(1 - 1e-10, Math.max(0, Q.reduce((s, q) => s + q[i] * q[i], 0)))
  );
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
    const h = leverages(X);
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

// ─── BIAS-REDUCED CLUSTER SE (CR2 / CR3) ─────────────────────────────────────
// Cholesky of a symmetric positive-definite matrix: M = L Lᵀ. null if not PD.
function cholesky(M) {
  const n = M.length;
  const L = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = M[i][j];
      for (let l = 0; l < j; l++) s -= L[i][l] * L[j][l];
      if (i === j) {
        if (s <= 1e-14) return null;      // not positive definite
        L[i][j] = Math.sqrt(s);
      } else {
        L[i][j] = s / L[j][j];
      }
    }
  }
  return L;
}

// Cyclic Jacobi eigendecomposition of a symmetric matrix.
// Returns { values: number[], vectors: number[][] } with vectors[i][j] = i-th
// component of eigenvector j. Only used on k×k matrices (k = #regressors), so
// the O(k³) cost per sweep is irrelevant.
function jacobiEigen(Min, maxSweeps = 100) {
  const n = Min.length;
  const A = Min.map(r => r.slice());
  let V = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] * A[i][j];
    if (off < 1e-24) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-18) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let i = 0; i < n; i++) {
          const aip = A[i][p], aiq = A[i][q];
          A[i][p] = c * aip - s * aiq;
          A[i][q] = s * aip + c * aiq;
        }
        for (let i = 0; i < n; i++) {
          const api = A[p][i], aqi = A[q][i];
          A[p][i] = c * api - s * aqi;
          A[q][i] = s * api + c * aqi;
        }
        for (let i = 0; i < n; i++) {
          const vip = V[i][p], viq = V[i][q];
          V[i][p] = c * vip - s * viq;
          V[i][q] = s * vip + c * viq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

/**
 * clusterBiasReducedSE — CR2 (Bell & McCaffrey 2002) and CR3 (cluster jackknife).
 *
 * Both replace the raw cluster residual e_g with an adjusted ẽ_g = A_g e_g:
 *   CR2: A_g = (I − H_gg)^(−1/2)      CR3: A_g = (I − H_gg)^(−1)
 * where H_gg = X_g (X′X)⁻¹ X_gᵀ is the cluster's leverage block.
 *
 * IMPLEMENTATION NOTE — why this is not the textbook formula.
 * Done literally, A_g needs the eigendecomposition of an n_g × n_g matrix:
 * O(n_g³) per cluster, which is hopeless in a browser for anything but toy
 * clusters. But H_gg has rank ≤ k, so write (X′X)⁻¹ = L Lᵀ and Z_g = X_g L,
 * giving H_gg = Z_g Z_gᵀ. The nonzero eigenvalues of H_gg are exactly those of
 * the k × k matrix S_g = Z_gᵀ Z_g, and with S_g = Q Λ Qᵀ and P = Z_g Q Λ^(−1/2):
 *
 *     A_g = I + P · diag( f(λ_j) − 1 ) · Pᵀ ,   f(λ) = (1−λ)^(−1/2) or (1−λ)^(−1)
 *
 * so ẽ_g = e_g + P [ (f(λ)−1) ⊙ (Pᵀ e_g) ] costs O(n_g k² + k³). Same numbers,
 * tractable cost. This is the reduction clubSandwich uses.
 *
 * DEGENERATE CLUSTERS: λ_j → 1 means the cluster is perfectly fit by the design
 * (typically n_g ≤ k), so (1−λ)^(−1/2) diverges and the adjustment is undefined.
 * Rather than emit Infinity, we degrade that whole estimate to CR1 — the nearest
 * meaningful alternative — since returning a silently broken SE is worse.
 *
 * @param {number[][]} XtXinv
 * @param {number[][]} X
 * @param {number[]}   e
 * @param {Array}      clusters — cluster label per observation, length n
 * @param {number}     n
 * @param {number}     k
 * @param {"CR2"|"CR3"} type
 * @returns {number[]|null} se, or null when the adjustment is not computable
 */
export function clusterBiasReducedSE(XtXinv, X, e, clusters, n, k, type = "CR2") {
  const p = X[0].length;
  const L = cholesky(XtXinv);
  if (!L) return null;                       // (X′X)⁻¹ not PD → caller degrades

  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const g = clusters[i];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  }
  const G = groups.size;
  if (G < 2) return null;

  const B = Array.from({ length: p }, () => Array(p).fill(0));

  for (const idxs of groups.values()) {
    const ng = idxs.length;

    // Z_g = X_g L   (ng × p)
    const Z = idxs.map(i => {
      const z = Array(p).fill(0);
      for (let a = 0; a < p; a++)
        for (let b = a; b < p; b++) z[a] += X[i][b] * L[b][a];
      return z;
    });

    // S_g = Z_gᵀ Z_g  (p × p) — the small eigenproblem
    const S = Array.from({ length: p }, () => Array(p).fill(0));
    for (let r = 0; r < ng; r++)
      for (let a = 0; a < p; a++)
        for (let b = 0; b < p; b++) S[a][b] += Z[r][a] * Z[r][b];

    const { values, vectors } = jacobiEigen(S);

    // P = Z Q Λ^(−1/2), keeping only directions with λ > 0
    const keep = [];
    for (let j = 0; j < p; j++) if (values[j] > 1e-12) keep.push(j);

    // f(λ) − 1 per kept direction; bail out if the cluster is fully leveraged
    const coef = [];
    for (const j of keep) {
      const lam = Math.min(Math.max(values[j], 0), 1);
      if (1 - lam < 1e-10) return null;      // degenerate → caller falls back to CR1
      coef.push(type === "CR3"
        ? 1 / (1 - lam) - 1
        : 1 / Math.sqrt(1 - lam) - 1);
    }

    // P columns and Pᵀe in one pass
    const eg = idxs.map(i => e[i]);
    const Pte = Array(keep.length).fill(0);
    const P = Array.from({ length: ng }, () => Array(keep.length).fill(0));
    keep.forEach((j, c) => {
      const inv = 1 / Math.sqrt(values[j]);
      for (let r = 0; r < ng; r++) {
        let v = 0;
        for (let a = 0; a < p; a++) v += Z[r][a] * vectors[a][j];
        P[r][c] = v * inv;
        Pte[c] += P[r][c] * eg[r];
      }
    });

    // ẽ_g = e_g + P (coef ⊙ Pᵀe)
    const et = eg.slice();
    for (let r = 0; r < ng; r++)
      for (let c = 0; c < keep.length; c++) et[r] += P[r][c] * coef[c] * Pte[c];

    // score s_g = X_gᵀ ẽ_g, accumulate s_g s_gᵀ
    const sg = Array(p).fill(0);
    idxs.forEach((i, r) => { for (let j = 0; j < p; j++) sg[j] += et[r] * X[i][j]; });
    for (let a = 0; a < p; a++)
      for (let b = 0; b < p; b++) B[a][b] += sg[a] * sg[b];
  }

  // NEITHER type carries an extra multiplier: the whole correction lives in A_g.
  // CR3 is often written with a (G−1)/G jackknife factor, and this code had it
  // until the clubSandwich comparison showed R/ours = 1/sqrt((G−1)/G) exactly
  // across G = 8, 13, 20. clubSandwich (the reference implementation, and what
  // estimatr defers to) applies no such factor, so neither do we.
  void G;
  return sandwichDiagSqrt(XtXinv, B);
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

  if (seType === "CR2" || seType === "CR3") {
    if (!clusterVar || !rows) return sandwichSE(XtXinv, X, e, n, k, "HC1");
    const clusters = rows.map(r => r[clusterVar] ?? "__missing__");
    const se = clusterBiasReducedSE(XtXinv, X, e, clusters, n, k, seType);
    // Degenerate cluster (fully leveraged) or non-PD bread: fall back to CR1
    // rather than HC1 — same family, so the number stays interpretable.
    return se ?? clusteredSE(XtXinv, X, e, clusters, n, k);
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
