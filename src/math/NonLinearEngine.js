// ─── ECON STUDIO · src/math/NonLinearEngine.js ────────────────────────────────
// Binary outcome models: Logit and Probit via IRLS (Newton-Raphson MLE).
// No React. No side effects. Depends only on LinearEngine.js.
//
// Estimators:
//   runLogit(rows, yCol, xCols)  → logistic regression (canonical link)
//   runProbit(rows, yCol, xCols) → probit regression (normal link)
//
// Both return the same shape; see _runBinaryModel for field docs.

import { matInv } from "./LinearEngine.js";
import { stars } from "./LinearEngine.js";
import { computeRobustSE } from "../core/inference/robustSE.js";

// ─── DISTRIBUTIONS ───────────────────────────────────────────────────────────

// Standard normal PDF
function normPDF(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Standard normal CDF — Abramowitz & Stegun 26.2.17 (max error 7.5e-8)
export function normCDF(x) {
  if (x < -8) return 0;
  if (x >  8) return 1;
  const neg = x < 0;
  const z = Math.abs(x);
  const t = 1 / (1 + 0.2316419 * z);
  const poly = t * (0.319381530
    + t * (-0.356563782
    + t * (1.781477937
    + t * (-1.821255978
    + t * 1.330274429))));
  const p = 1 - normPDF(z) * poly;
  return neg ? 1 - p : p;
}

// Logistic CDF (numerically stable)
function logistic(x) {
  if (x >  35) return 1 - 1e-15;
  if (x < -35) return 1e-15;
  return 1 / (1 + Math.exp(-x));
}

// Two-sided p-value from z-statistic (standard normal)
function zPValue(z) {
  return Math.min(1, 2 * normCDF(-Math.abs(z)));
}

// ─── IRLS CORE ───────────────────────────────────────────────────────────────
// Iteratively Reweighted Least Squares — Newton-Raphson for GLMs.
//
// Shared by Logit and Probit; differs only in linkFns:
//   mu(eta)          → E[Y|η]  (inverse link)
//   dmu(eta)         → ∂μ/∂η  (derivative of inverse link)
//   weight(mu, eta)  → IRLS weight = (dμ/dη)² / V(μ), where V(μ) = μ(1−μ)
//
// Returns { beta, se, zStats, pVals, logLik, fitted, residuals,
//           converged, iterations, Vcov }
// or { error } on failure.
function irls(X, Y, linkFns, maxIter = 100, tol = 1e-8) {
  const n = X.length;
  const k = X[0].length;
  if (n < k + 1) return { error: "Insufficient observations." };

  const { mu, dmu, weight } = linkFns;

  // Warm-start intercept at log-odds of the sample mean
  const pBar    = Y.reduce((s, y) => s + y, 0) / n;
  const eta0    = Math.max(-10, Math.min(10, Math.log(pBar / (1 - pBar))));
  let beta      = Array(k).fill(0);
  beta[0]       = eta0;

  let converged  = false;
  let iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    // η = Xβ
    const eta   = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
    // μ = link⁻¹(η)
    const muVec = eta.map(mu);
    // IRLS weights w_i = (dμ/dη)² / V(μ)
    const W     = eta.map((e, i) => weight(muVec[i], e));
    // Working response z_i = η_i + (y_i − μ_i) / (dμ/dη)_i
    const Z     = eta.map((e, i) => {
      const d = dmu(e);
      return Math.abs(d) < 1e-15 ? e : e + (Y[i] - muVec[i]) / d;
    });

    // Build X'WX and X'WZ
    const XtWX = Array.from({ length: k }, () => Array(k).fill(0));
    const XtWZ = Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = W[i];
      if (!isFinite(wi) || wi <= 0) continue;
      for (let j = 0; j < k; j++) {
        XtWZ[j] += wi * X[i][j] * Z[i];
        for (let l = 0; l < k; l++) XtWX[j][l] += wi * X[i][j] * X[i][l];
      }
    }

    const XtWXinv = matInv(XtWX);
    if (!XtWXinv)
      return { error: "Singular matrix — check for perfect separation or perfect collinearity." };

    const betaNew = XtWXinv.map(row => row.reduce((s, v, j) => s + v * XtWZ[j], 0));
    const maxDiff = betaNew.reduce((mx, b, i) => Math.max(mx, Math.abs(b - beta[i])), 0);
    beta      = betaNew;
    iterations = iter + 1;
    if (maxDiff < tol) { converged = true; break; }
  }

  // Final Fisher information = X'WX at MLE (= asymptotic Var(β̂)⁻¹)
  const etaFinal = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
  const muFinal  = etaFinal.map(mu);
  const WFinal   = etaFinal.map((e, i) => weight(muFinal[i], e));

  const XtWX_final = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const wi = WFinal[i];
    if (!isFinite(wi) || wi <= 0) continue;
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++)
        XtWX_final[j][l] += wi * X[i][j] * X[i][l];
  }

  const Vcov = matInv(XtWX_final);
  if (!Vcov) return { error: "Variance-covariance matrix is singular at convergence." };

  const se     = Vcov.map((row, i) => Math.sqrt(Math.abs(row[i])));
  const zStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = zStats.map(z => (isFinite(z) ? zPValue(z) : NaN));

  // Log-likelihood at MLE
  const eps    = 1e-15;
  const logLik = muFinal.reduce(
    (s, p, i) => s + Y[i] * Math.log(Math.max(eps, p)) + (1 - Y[i]) * Math.log(Math.max(eps, 1 - p)),
    0
  );

  // Pearson residuals: (y − p̂) / √(p̂(1−p̂))
  const residuals = muFinal.map((p, i) => {
    const v = p * (1 - p);
    return v > 0 ? (Y[i] - p) / Math.sqrt(v) : 0;
  });

  return { beta, se, zStats, pVals, logLik, fitted: muFinal, residuals, converged, iterations, Vcov };
}

// ─── LOGIT ────────────────────────────────────────────────────────────────────
// Binary logistic regression via MLE.
// Y must be coded 0/1 (integer or float).
export function runLogit(rows, yCol, xCols, seOpts = {}) {
  return _runBinaryModel(rows, yCol, xCols, "logit", seOpts);
}

// ─── PROBIT ───────────────────────────────────────────────────────────────────
// Probit regression via MLE (normal latent-variable model).
// Coefficients are on the latent index scale (not odds-ratio scale).
export function runProbit(rows, yCol, xCols, seOpts = {}) {
  return _runBinaryModel(rows, yCol, xCols, "probit", seOpts);
}

// ─── SHARED RUNNER ───────────────────────────────────────────────────────────
//
// Return shape:
//   family          — "logit" | "probit"
//   beta            — MLE coefficient vector [k]
//   se              — asymptotic standard errors [k]
//   zStats          — z-statistics [k]
//   pVals           — two-sided p-values [k]
//   varNames        — ["(Intercept)", ...xCols]
//   n, k, df        — obs, params, n−k
//   logLik          — log-likelihood at MLE
//   logLikNull      — log-likelihood of intercept-only model
//   mcFaddenR2      — 1 − l(β̂)/l₀  (McFadden pseudo-R²)
//   AIC, BIC
//   fitted          — P̂(Y=1|X) for each observation
//   residuals       — Pearson residuals
//   marginalEffects — MEM: dP/dx_j evaluated at covariate means [xCols.length]
//   oddsRatios      — exp(β) with 95 % CI (logit only, null for probit)
//   converged, iterations
function _runBinaryModel(rows, yCol, xCols, family, seOpts = {}) {
  // Validate rows: Y ∈ {0, 1}, all X numeric
  const valid = rows.filter(r => {
    const y = r[yCol];
    return (y === 0 || y === 1) &&
      xCols.every(c => typeof r[c] === "number" && isFinite(r[c]));
  });

  if (valid.length < xCols.length + 2)
    return { error: `Insufficient observations: need at least ${xCols.length + 2}.` };

  const n    = valid.length;
  const Y    = valid.map(r => r[yCol]);
  const X    = valid.map(r => [1, ...xCols.map(c => r[c])]);
  const nOnes = Y.reduce((s, y) => s + y, 0);

  if (nOnes === 0 || nOnes === n)
    return { error: "Outcome has no variation — all observations are 0 or all are 1." };

  // Define link functions for the chosen family
  let linkFns;
  if (family === "logit") {
    linkFns = {
      mu:     eta => logistic(eta),
      dmu:    eta => { const p = logistic(eta); return p * (1 - p); },
      weight: (muVal)     => Math.max(1e-15, muVal * (1 - muVal)),
    };
  } else {
    // Probit: μ = Φ(η), dμ/dη = φ(η), w = φ²/[Φ(1−Φ)]
    linkFns = {
      mu:     eta => normCDF(eta),
      dmu:    eta => normPDF(eta),
      weight: (muVal, eta) => {
        const phi = normPDF(eta);
        const v   = muVal * (1 - muVal);
        return v > 1e-15 ? (phi * phi) / v : 0;
      },
    };
  }

  const result = irls(X, Y, linkFns);
  if (result.error) return result;

  let { beta, se, zStats, pVals, logLik, fitted, residuals, converged, iterations, Vcov } = result;

  // ── Robust SE override ────────────────────────────────────────────────────
  // Raw response residuals: y − μ̂ (used as "e" in the sandwich estimator)
  const rawResid = fitted.map((p, i) => Y[i] - p);
  const robSE = computeRobustSE(seOpts, Vcov, X, rawResid, n, beta.length, valid);
  if (robSE) {
    se     = robSE;
    zStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
    pVals  = zStats.map(z => (isFinite(z) ? zPValue(z) : NaN));
  }

  // ── Fit statistics ────────────────────────────────────────────────────────
  const pBar       = nOnes / n;
  const eps        = 1e-15;
  const logLikNull = n * (
    pBar       * Math.log(Math.max(eps, pBar)) +
    (1 - pBar) * Math.log(Math.max(eps, 1 - pBar))
  );
  const k          = beta.length;
  const df         = n - k;
  const mcFaddenR2 = logLikNull !== 0 ? 1 - logLik / logLikNull : 0;
  const AIC        = -2 * logLik + 2 * k;
  const BIC        = -2 * logLik + k * Math.log(n);
  const varNames   = ["(Intercept)", ...xCols];

  // ── Marginal Effects at the Mean (MEM) ────────────────────────────────────
  // dP/dx_j = density(x̄'β) × β_j
  //   Logit:  density = σ(η̄)(1−σ(η̄))
  //   Probit: density = φ(η̄)
  const xMeans    = xCols.map(c => valid.reduce((s, r) => s + r[c], 0) / n);
  const etaMean   = beta[0] + xMeans.reduce((s, xm, j) => s + xm * beta[j + 1], 0);
  const densityMEM = family === "logit"
    ? logistic(etaMean) * (1 - logistic(etaMean))
    : normPDF(etaMean);

  const marginalEffects = xCols.map((c, j) => ({
    variable: c,
    dy_dx:    densityMEM * beta[j + 1],
  }));

  // ── Odds ratios (logit only) ──────────────────────────────────────────────
  const oddsRatios = family === "logit"
    ? beta.map((b, i) => ({
        variable: varNames[i],
        or:    Math.exp(b),
        ciLo:  Math.exp(b - 1.96 * se[i]),
        ciHi:  Math.exp(b + 1.96 * se[i]),
      }))
    : null;

  return {
    family,
    beta, se, zStats, pVals,
    varNames,
    n, k, df,
    logLik, logLikNull, mcFaddenR2, AIC, BIC,
    fitted, residuals,
    marginalEffects,
    oddsRatios,
    converged, iterations,
  };
}

// ─── POISSON FIXED EFFECTS (PPML) ────────────────────────────────────────────
// Poisson Pseudo-Maximum-Likelihood with entity fixed effects.
// Used for count data and gravity models. Absorbs entity FE via iterative
// proportional scaling (Guimaraes-Portugal algorithm) inside the IRLS loop.
//
// E[Y | X, α_i] = exp(α_i + X·β)   — consistent even if data is not Poisson.
// Y must be non-negative (not necessarily integer).
//
// Signature:
//   runPoissonFE(rows, yCol, xCols, unitCol, seOpts={}) → result object

// Local lgamma implementation (Lanczos approximation — mirrors LinearEngine.js)
function lgamma(z) {
  const c = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}

export function runPoissonFE(rows, yCol, xCols, unitCol, seOpts = {}) {
  // ── 1. Filter valid rows ────────────────────────────────────────────────────
  const valid = rows.filter(r => {
    const y = r[yCol];
    return typeof y === "number" && isFinite(y) && y >= 0 &&
      r[unitCol] != null &&
      xCols.every(c => typeof r[c] === "number" && isFinite(r[c]));
  });

  const n = valid.length;
  const k = xCols.length;
  if (n < k + 2)
    return { error: `Insufficient observations: need at least ${k + 2}.` };

  // Build arrays
  const Y    = valid.map(r => r[yCol]);
  const X    = valid.map(r => xCols.map(c => r[c]));
  const unit = valid.map(r => r[unitCol]);

  // Unique units
  const unitIds  = [...new Set(unit)];
  const nUnits   = unitIds.length;
  const unitIdx  = new Map(unitIds.map((id, i) => [id, i]));
  // Map each row to its unit index
  const rowUnit  = unit.map(u => unitIdx.get(u));

  if (n - nUnits < k)
    return { error: "Insufficient within-unit variation for estimation." };

  // ── 2. Initialise β = 0, α_i = 0 ──────────────────────────────────────────
  let beta   = Array(k).fill(0);
  let alphas = new Float64Array(nUnits); // log-scale FE per unit

  let converged  = false;
  let iterations = 0;
  const maxIter  = 200;
  const tol      = 1e-8;

  // Precompute per-unit Y sums (numerator of IPS step — constant)
  const unitYSum = new Float64Array(nUnits);
  for (let i = 0; i < n; i++) unitYSum[rowUnit[i]] += Y[i];

  // ── 3. IRLS loop ────────────────────────────────────────────────────────────
  for (let iter = 0; iter < maxIter; iter++) {
    // (a) linear predictor η_i = α_{unit_i} + X_i·β
    const eta = X.map((xi, i) => alphas[rowUnit[i]] + xi.reduce((s, v, j) => s + v * beta[j], 0));

    // (b) mu_i = exp(η_i)
    let mu = eta.map(e => Math.exp(e));

    // (c) Iterative proportional scaling to update α_i
    //     α_i ← α_i + log( Σ_{j∈i} Y_j / Σ_{j∈i} mu_j )
    const unitMuSum = new Float64Array(nUnits);
    for (let i = 0; i < n; i++) unitMuSum[rowUnit[i]] += mu[i];
    for (let u = 0; u < nUnits; u++) {
      const ratio = unitYSum[u] / Math.max(unitMuSum[u], 1e-300);
      alphas[u] += Math.log(ratio);
    }

    // (d) Recompute mu with updated alphas
    for (let i = 0; i < n; i++)
      mu[i] = Math.exp(alphas[rowUnit[i]] + X[i].reduce((s, v, j) => s + v * beta[j], 0));

    // (e) IRLS weights W_i = mu_i; working response z_i = η_i + (Y_i − mu_i)/mu_i
    //     = log(mu_i) + (Y_i - mu_i)/mu_i  (since η_i = log(mu_i) at this point)
    const W = mu.slice(); // W_i = mu_i for Poisson
    const Z = mu.map((m, i) => {
      const etaI = alphas[rowUnit[i]] + X[i].reduce((s, v, j) => s + v * beta[j], 0);
      return etaI + (Y[i] - m) / Math.max(m, 1e-300);
    });

    // (f) Weighted entity-demean X and z
    //     X̄_i = (Σ_{j∈i} W_j X_j) / (Σ_{j∈i} W_j),  z̄_i similar
    const unitWSum  = new Float64Array(nUnits);
    const unitWZSum = new Float64Array(nUnits);
    const unitWXSum = Array.from({ length: nUnits }, () => new Float64Array(k));

    for (let i = 0; i < n; i++) {
      const u  = rowUnit[i];
      const wi = W[i];
      unitWSum[u]  += wi;
      unitWZSum[u] += wi * Z[i];
      for (let j = 0; j < k; j++) unitWXSum[u][j] += wi * X[i][j];
    }

    // z̃_i = z_i − z̄_{unit_i},  X̃_ij = X_ij − X̄_{unit_i,j}
    const Ztilde = Z.map((z, i) => {
      const u = rowUnit[i];
      return z - (unitWZSum[u] / Math.max(unitWSum[u], 1e-300));
    });
    const Xtilde = X.map((xi, i) => {
      const u = rowUnit[i];
      return xi.map((v, j) => v - unitWXSum[u][j] / Math.max(unitWSum[u], 1e-300));
    });

    // (g) WLS: β_new = (X̃'WX̃)⁻¹ X̃'Wz̃
    const XtWX = Array.from({ length: k }, () => Array(k).fill(0));
    const XtWZ = Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = W[i];
      if (!isFinite(wi) || wi <= 0) continue;
      for (let j = 0; j < k; j++) {
        XtWZ[j] += wi * Xtilde[i][j] * Ztilde[i];
        for (let l = 0; l < k; l++) XtWX[j][l] += wi * Xtilde[i][j] * Xtilde[i][l];
      }
    }

    const XtWXinv = matInv(XtWX);
    if (!XtWXinv)
      return { error: "Singular matrix — check for collinearity or units with no within variation." };

    const betaNew  = XtWXinv.map(row => row.reduce((s, v, j) => s + v * XtWZ[j], 0));

    // (h) Convergence check
    const maxDiff  = betaNew.reduce((mx, b, i) => Math.max(mx, Math.abs(b - beta[i])), 0);
    beta      = betaNew;
    iterations = iter + 1;
    if (maxDiff < tol) { converged = true; break; }
  }

  // ── 4. Final quantities ─────────────────────────────────────────────────────
  const etaFinal = X.map((xi, i) =>
    alphas[rowUnit[i]] + xi.reduce((s, v, j) => s + v * beta[j], 0)
  );
  const muFinal  = etaFinal.map(e => Math.exp(e));
  const resid    = Y.map((y, i) => y - muFinal[i]);

  // Log-likelihood: Σ(Y·η − mu − lgamma(Y+1))
  const logLik = etaFinal.reduce(
    (s, eta, i) => s + Y[i] * eta - muFinal[i] - lgamma(Y[i] + 1),
    0
  );

  // Null log-likelihood: unit-level Poisson with FE only (μ_i = ȳ_{unit_i})
  // → LL_null = Σ_i [Y_i · log(ȳ_{unit_i}) − ȳ_{unit_i} − lgamma(Y_i+1)]
  const unitNObs = new Float64Array(nUnits);
  for (let i = 0; i < n; i++) unitNObs[rowUnit[i]]++;
  const unitYBar = unitYSum.map((s, u) => s / Math.max(unitNObs[u], 1));
  const logLikNull = Y.reduce(
    (s, y, i) => {
      const ybar = unitYBar[rowUnit[i]];
      return s + (ybar > 0 ? y * Math.log(Math.max(ybar, 1e-300)) : 0) - ybar - lgamma(y + 1);
    },
    0
  );

  // ── 5. Standard errors — HC0 sandwich by default ────────────────────────────
  // Recompute demeaned X for the sandwich (using final W = muFinal)
  const unitWSum2  = new Float64Array(nUnits);
  const unitWXSum2 = Array.from({ length: nUnits }, () => new Float64Array(k));
  for (let i = 0; i < n; i++) {
    const u  = rowUnit[i];
    const wi = muFinal[i];
    unitWSum2[u]  += wi;
    for (let j = 0; j < k; j++) unitWXSum2[u][j] += wi * X[i][j];
  }
  const XtildeFinal = X.map((xi, i) => {
    const u = rowUnit[i];
    return xi.map((v, j) => v - unitWXSum2[u][j] / Math.max(unitWSum2[u], 1e-300));
  });

  const XtWXf = Array.from({ length: k }, () => Array(k).fill(0));
  for (let i = 0; i < n; i++) {
    const wi = muFinal[i];
    if (!isFinite(wi) || wi <= 0) continue;
    for (let j = 0; j < k; j++)
      for (let l = 0; l < k; l++)
        XtWXf[j][l] += wi * XtildeFinal[i][j] * XtildeFinal[i][l];
  }
  const XtWXfinv = matInv(XtWXf);
  if (!XtWXfinv) return { error: "Variance-covariance matrix is singular at convergence." };

  // Try robust SE override first
  let se = null;
  const robSE = computeRobustSE(seOpts, XtWXfinv, XtildeFinal, resid, n, k, valid);
  if (robSE) {
    se = robSE;
  } else {
    // HC0 sandwich: V = (X̃'WX̃)⁻¹ (X̃' diag(e²) X̃) (X̃'WX̃)⁻¹
    const meat = Array.from({ length: k }, () => Array(k).fill(0));
    for (let i = 0; i < n; i++) {
      const ei2 = resid[i] * resid[i];
      for (let j = 0; j < k; j++)
        for (let l = 0; l < k; l++)
          meat[j][l] += ei2 * XtildeFinal[i][j] * XtildeFinal[i][l];
    }
    // V = Ainv · meat · Ainv
    const Vcov = XtWXfinv.map(rowi =>
      XtWXfinv.map((_colDummy, l) => {
        // (Ainv · meat)[i][l] = Σ_m Ainv[i][m] * meat[m][l]
        let Amid = 0;
        for (let m = 0; m < k; m++) Amid += rowi[m] * meat[m][l];
        return Amid;
      })
    );
    // Now V = Vcov · Ainv  row-by-row dot
    const Vfull = Vcov.map(rowi =>
      XtWXfinv.map((_unused, l) => {
        let s = 0;
        for (let m = 0; m < k; m++) s += rowi[m] * XtWXfinv[m][l];
        return s;
      })
    );
    se = Vfull.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  }

  // ── 6. Inference ─────────────────────────────────────────────────────────────
  const zStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = zStats.map(z => (isFinite(z) ? zPValue(z) : NaN));

  // ── 7. Fit statistics ─────────────────────────────────────────────────────────
  const McFaddenR2 = logLikNull !== 0 ? 1 - logLik / logLikNull : 0;
  const AIC        = -2 * logLik + 2 * k;
  const BIC        = -2 * logLik + k * Math.log(n);
  const df         = n - k - nUnits;

  // ── 8. Return ─────────────────────────────────────────────────────────────────
  const alphasObj = Object.fromEntries(unitIds.map((id, u) => [id, alphas[u]]));

  return {
    beta, se, zStats, pVals,
    varNames: xCols,       // no intercept — absorbed by FE
    logLik, nullLogLik: logLikNull, McFaddenR2,
    AIC, BIC,
    alphas: alphasObj,
    fitted: muFinal,
    resid,
    n, k, df,
    converged, iterations,
  };
}

// ─── EXPORT HELPERS ──────────────────────────────────────────────────────────

// LaTeX table — coefficient block + fit stats footer
export function buildBinaryLatex(yVar, results) {
  const { family, beta, se, zStats, pVals, varNames, n, df,
          logLik, mcFaddenR2, AIC, BIC } = results;
  const model = family === "logit" ? "Logit" : "Probit";
  const fmtP  = p => (p == null ? "N/A" : p < 0.001 ? "<0.001" : p.toFixed(4));

  const rows = varNames.map((v, i) => {
    const b  = beta?.[i],  s  = se?.[i];
    const z  = zStats?.[i], p = pVals?.[i];
    const bF = b != null && isFinite(b) ? b.toFixed(4) : "N/A";
    const sF = s != null && isFinite(s) ? s.toFixed(4) : "N/A";
    const zF = z != null && isFinite(z) ? z.toFixed(3) : "N/A";
    const pF = fmtP(p);
    const st = p != null ? stars(p) : "";
    return `  ${v.replace(/_/g, "\\_")} & ${bF}${st} & ${sF} & ${zF} & ${pF} \\\\`;
  }).join("\n");

  return `\\begin{table}[htbp]
\\centering
\\caption{${model} Results: \\texttt{${yVar}}}
\\begin{tabular}{lrrrr}
\\hline\\hline
Variable & Estimate & Std. Error & z-value & Pr($>|z|$) \\\\
\\hline
${rows}
\\hline
\\multicolumn{5}{l}{McFadden $R^2 = ${mcFaddenR2?.toFixed(4) ?? "N/A"}$, Log-lik $= ${logLik?.toFixed(3) ?? "N/A"}$, $n = ${n ?? "N/A"}$} \\\\
\\multicolumn{5}{l}{AIC $= ${AIC?.toFixed(2) ?? "N/A"}$, BIC $= ${BIC?.toFixed(2) ?? "N/A"}$} \\\\
\\multicolumn{5}{l}{Significance: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\
\\hline
\\end{tabular}
\\end{table}`;
}

// CSV export — coefficients block + fit stats
export function buildBinaryCSV(yVar, results) {
  const { family, beta, se, zStats, pVals, varNames, n,
          logLik, logLikNull, mcFaddenR2, AIC, BIC,
          marginalEffects } = results;
  const header = "variable,estimate,std_error,z_value,p_value,sig,me_at_mean";
  const meMap  = Object.fromEntries(
    (marginalEffects ?? []).map(m => [m.variable, m.dy_dx])
  );
  const rows = varNames.map((v, i) => {
    const b  = beta?.[i],  s  = se?.[i];
    const z  = zStats?.[i], p = pVals?.[i];
    return [
      v,
      b != null ? b.toFixed(6) : "NA",
      s != null ? s.toFixed(6) : "NA",
      z != null ? z.toFixed(6) : "NA",
      p != null ? p.toFixed(6) : "NA",
      p != null ? stars(p)     : "",
      meMap[v] != null ? meMap[v].toFixed(6) : "NA",
    ].join(",");
  });

  return [
    `# ${family.toUpperCase()} · Dependent variable: ${yVar}`,
    header, ...rows, "",
    "# Fit statistics",
    `log_likelihood,${logLik?.toFixed(6) ?? "NA"}`,
    `log_likelihood_null,${logLikNull?.toFixed(6) ?? "NA"}`,
    `mcfadden_r2,${mcFaddenR2?.toFixed(6) ?? "NA"}`,
    `AIC,${AIC?.toFixed(4) ?? "NA"}`,
    `BIC,${BIC?.toFixed(4) ?? "NA"}`,
    `n,${n ?? "NA"}`,
  ].join("\n");
}
