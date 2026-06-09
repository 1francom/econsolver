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

// ─── POISSON GLM ──────────────────────────────────────────────────────────────
// Standard Poisson regression (cross-sectional, no fixed effects).
// E[Y | X] = exp(offset + X·β),   link = log.
//
// offsetCol (optional): column holding exposure / population at risk.
//   Its natural log is added to the linear predictor with a fixed coefficient
//   of 1, turning the model into a model of per-capita rates rather than counts
//   (Osgood 2000, Eq. 3).  Values must be strictly positive.
//
// Default SE: Fisher information matrix (X'WX)^{-1}, matching R glm().
// Robust / clustered SE available via seOpts.
export function runPoisson(rows, yCol, xCols, seOpts = {}, offsetCol = null) {
  const valid = rows.filter(r => {
    const y      = r[yCol];
    const offOk  = offsetCol == null ||
      (typeof r[offsetCol] === 'number' && r[offsetCol] > 0);
    return typeof y === 'number' && isFinite(y) && y >= 0 &&
      offOk &&
      xCols.every(c => typeof r[c] === 'number' && isFinite(r[c]));
  });

  const kParam = xCols.length + 1; // +1 for intercept
  if (valid.length < kParam + 1)
    return { error: `Insufficient observations: need at least ${kParam + 1}.` };

  const n      = valid.length;
  const Y      = valid.map(r => r[yCol]);
  const offset = offsetCol
    ? valid.map(r => Math.log(r[offsetCol]))
    : new Array(n).fill(0);
  const X = valid.map(r => [1, ...xCols.map(c => r[c])]);

  // Warm-start: intercept = log(ȳ) − mean(offset), others = 0
  const yBar   = Y.reduce((s, y) => s + y, 0) / n;
  const offBar = offset.reduce((s, o) => s + o, 0) / n;
  let beta     = Array(kParam).fill(0);
  beta[0]      = Math.log(Math.max(yBar, 1e-8)) - offBar;

  let converged  = false;
  let iterations = 0;

  for (let iter = 0; iter < 200; iter++) {
    const eta = X.map((xi, i) =>
      offset[i] + xi.reduce((s, v, j) => s + v * beta[j], 0)
    );
    const mu = eta.map(e => Math.max(Math.exp(e), 1e-300));
    const Z  = eta.map((e, i) => e + (Y[i] - mu[i]) / Math.max(mu[i], 1e-300));

    // X'WX and X'WZ  (Poisson IRLS weights W_i = μ_i)
    const XtWX = Array.from({ length: kParam }, () => Array(kParam).fill(0));
    const XtWZ = Array(kParam).fill(0);
    for (let i = 0; i < n; i++) {
      const wi = mu[i];
      if (!isFinite(wi) || wi <= 0) continue;
      for (let j = 0; j < kParam; j++) {
        XtWZ[j] += wi * X[i][j] * Z[i];
        for (let l = 0; l < kParam; l++) XtWX[j][l] += wi * X[i][j] * X[i][l];
      }
    }

    const XtWXinv = matInv(XtWX);
    if (!XtWXinv) return { error: 'Singular matrix — check for perfect collinearity.' };

    const betaNew = XtWXinv.map(row => row.reduce((s, v, j) => s + v * XtWZ[j], 0));
    const maxDiff = betaNew.reduce((mx, b, i) => Math.max(mx, Math.abs(b - beta[i])), 0);
    beta       = betaNew;
    iterations = iter + 1;
    if (maxDiff < 1e-8) { converged = true; break; }
  }

  // ── Final quantities ─────────────────────────────────────────────────────────
  const etaFinal = X.map((xi, i) =>
    offset[i] + xi.reduce((s, v, j) => s + v * beta[j], 0)
  );
  const muFinal = etaFinal.map(e => Math.exp(e));
  const resid   = Y.map((y, i) => y - muFinal[i]);

  // Log-likelihood: Σ(Y·η − μ − lgamma(Y+1))
  const logLik = etaFinal.reduce(
    (s, eta, i) => s + Y[i] * eta - muFinal[i] - lgamma(Y[i] + 1), 0
  );

  // Null LL: intercept + offset only.
  // MLE for intercept-only: β₀ = log(ΣY / Σexp(offset))
  const eps        = 1e-300;
  const sumY       = Y.reduce((s, y) => s + y, 0);
  const sumExpOff  = offset.reduce((s, o) => s + Math.exp(o), 0);
  const beta0Null  = Math.log(Math.max(sumY / Math.max(sumExpOff, eps), eps));
  const logLikNull = Y.reduce((s, y, i) => {
    const muNull = Math.exp(offset[i] + beta0Null);
    return s + y * Math.log(Math.max(muNull, eps)) - muNull - lgamma(y + 1);
  }, 0);

  // Vcov = (X'WX)^{-1} at MLE  (Fisher information)
  const XtWXf = Array.from({ length: kParam }, () => Array(kParam).fill(0));
  for (let i = 0; i < n; i++) {
    const wi = muFinal[i];
    if (!isFinite(wi) || wi <= 0) continue;
    for (let j = 0; j < kParam; j++)
      for (let l = 0; l < kParam; l++)
        XtWXf[j][l] += wi * X[i][j] * X[i][l];
  }
  const Vcov = matInv(XtWXf);
  if (!Vcov) return { error: 'Variance-covariance matrix singular at convergence.' };

  // SE: robust if seOpts requests it, else Fisher information
  let se;
  const robSE = computeRobustSE(seOpts, Vcov, X, resid, n, kParam, valid);
  se = robSE ?? Vcov.map((row, i) => Math.sqrt(Math.max(0, row[i])));

  const varNames   = ['(Intercept)', ...xCols];
  const zStats     = beta.map((b, i) => se[i] > 0 ? b / se[i] : NaN);
  const pVals      = zStats.map(z => isFinite(z) ? zPValue(z) : NaN);
  const df         = n - kParam;
  const McFaddenR2 = logLikNull !== 0 ? 1 - logLik / logLikNull : 0;
  const AIC        = -2 * logLik + 2 * kParam;
  const BIC        = -2 * logLik + kParam * Math.log(n);

  return {
    family: 'poisson',
    beta, se, zStats, pVals,
    varNames,
    n, k: kParam, df,
    logLik, nullLogLik: logLikNull, McFaddenR2,
    AIC, BIC,
    fitted: muFinal,
    resid,
    converged, iterations,
    hasOffset: offsetCol != null,
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

  if (valid.length < xCols.length + 2)
    return { error: `Insufficient observations: need at least ${xCols.length + 2}.` };

  // Build unit Y sums to identify all-zero-Y entities (they are uninformative
  // for PPML — Santos Silva & Tenrejo standard practice: drop them).
  const _unitYCheck = new Map();
  for (const r of valid) {
    const u = r[unitCol];
    _unitYCheck.set(u, (_unitYCheck.get(u) ?? 0) + r[yCol]);
  }
  const zeroUnits = new Set([..._unitYCheck.entries()].filter(([, s]) => s === 0).map(([u]) => u));
  const droppedZeroUnits = zeroUnits.size;

  // Keep only rows whose entity has at least one positive Y observation
  const keptRaw = valid.filter(r => !zeroUnits.has(r[unitCol]));

  // Drop singleton units (exactly 1 observation — no within variation possible).
  // After within-demeaning their X rows become all-zeros, making X̃'WX̃ singular.
  const _unitObsCnt = new Map();
  for (const r of keptRaw)
    _unitObsCnt.set(r[unitCol], (_unitObsCnt.get(r[unitCol]) ?? 0) + 1);
  const singletonUnits   = new Set(
    [..._unitObsCnt.entries()].filter(([, c]) => c === 1).map(([u]) => u)
  );
  const droppedSingletons = singletonUnits.size;
  const kept = keptRaw.filter(r => !singletonUnits.has(r[unitCol]));

  const n = kept.length;
  const k = xCols.length;
  if (n < k + 2)
    return { error: `Insufficient observations after dropping all-zero-Y entities (${droppedZeroUnits}) and singleton units (${droppedSingletons}).` };

  // Pre-flight: check each X column has within-unit variation.
  // A time-invariant regressor demeans to zero for every obs and is collinear
  // with the unit FE — estimation is impossible.
  const _unitSumMap  = new Map();   // unit → { sum[col], count }
  for (const r of kept) {
    const u = r[unitCol];
    if (!_unitSumMap.has(u)) _unitSumMap.set(u, { sums: new Array(k).fill(0), cnt: 0 });
    const entry = _unitSumMap.get(u);
    entry.cnt++;
    for (let j = 0; j < k; j++) entry.sums[j] += r[xCols[j]];
  }
  const zeroWithinCols = xCols.filter((col, j) => {
    let totalVar = 0;
    for (const r of kept) {
      const entry = _unitSumMap.get(r[unitCol]);
      const mean  = entry.sums[j] / entry.cnt;
      totalVar += (r[col] - mean) ** 2;
    }
    return totalVar < 1e-12;
  });
  if (zeroWithinCols.length > 0)
    return { error: `No within-unit variation for: ${zeroWithinCols.join(', ')}. These variables are absorbed by unit fixed effects — drop them from the model.` };

  // Build arrays
  const Y    = kept.map(r => r[yCol]);
  const X    = kept.map(r => xCols.map(c => r[c]));
  const unit = kept.map(r => r[unitCol]);

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

    // (b) mu_i = exp(η_i), clamped to [1e-300, Inf] to prevent exact zeros
    let mu = eta.map(e => Math.max(Math.exp(e), 1e-300));

    // (c) Iterative proportional scaling to update α_i
    //     α_i ← α_i + log( Σ_{j∈i} Y_j / Σ_{j∈i} mu_j )
    const unitMuSum = new Float64Array(nUnits);
    for (let i = 0; i < n; i++) unitMuSum[rowUnit[i]] += mu[i];
    for (let u = 0; u < nUnits; u++) {
      const ratio = unitYSum[u] / Math.max(unitMuSum[u], 1e-300);
      // Guard: if all Y for this unit = 0, ratio = 0 → log = -Inf. Skip update.
      if (ratio > 0) alphas[u] += Math.log(ratio);
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
      if (!isFinite(wi) || wi < 1e-12) continue;
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
  const kTotal     = k + nUnits;          // regressors + entity fixed effects
  const AIC        = -2 * logLik + 2 * kTotal;
  const BIC        = -2 * logLik + kTotal * Math.log(n);
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
    n, k, nUnits, df,
    converged, iterations,
    droppedZeroUnits,      // entities with all-zero Y dropped pre-flight
    droppedSingletons,     // singleton units dropped (no within variation)
  };
}

// ─── N-WAY POISSON FIXED EFFECTS (alternating projections) ────────────────────
// Generalizes runPoissonFE to D ≥ 1 fixed-effect dimensions (e.g. grid_id + date).
// FE are absorbed by *weighted alternating-projection demeaning* of the IRLS
// working response and design inside each Newton step (Gaure 2013 / Correia 2017
// method of alternating projections), so no FE dummies are ever materialized.
// Matches fixest::fepois(y ~ x | f1 + f2, cluster = ~f1).
//
// For D = 1 it converges to the same MLE as runPoissonFE (the Poisson FE MLE is
// unique); the two paths differ only in how the FE are absorbed.
//
//   feCols : array of FE column names (length ≥ 1)
//   seOpts : { type, clusterVar, clusterVar2, ... } threaded to computeRobustSE
//   opts   : { offsetCol, tol, maxIter, demeanTol, demeanMaxIter }
export function runPoissonFEMulti(rows, yCol, xCols, feCols, seOpts = {}, opts = {}) {
  const {
    offsetCol     = null,
    tol           = 1e-8,
    maxIter       = 200,
    demeanTol     = 1e-10,
    demeanMaxIter = 5000,
    returnVcov    = false,
  } = opts;

  const D = (feCols || []).length;
  if (D < 1) return { error: "runPoissonFEMulti requires at least one fixed-effect column." };
  const k = xCols.length;

  // ── 1. Filter valid rows ────────────────────────────────────────────────────
  let work = rows.filter(r => {
    const y = r[yCol];
    if (!(typeof y === "number" && isFinite(y) && y >= 0)) return false;
    if (feCols.some(c => r[c] == null)) return false;
    if (xCols.some(c => !(typeof r[c] === "number" && isFinite(r[c])))) return false;
    if (offsetCol != null && !(typeof r[offsetCol] === "number" && isFinite(r[offsetCol]))) return false;
    return true;
  });
  if (work.length < k + 2)
    return { error: `Insufficient observations: need at least ${k + 2}.` };

  // ── 2. Iteratively drop FE levels with all-zero Y (PPML separation — Santos
  //       Silva & Tenreyro) and singleton levels (one obs ⇒ no within variation),
  //       across all dims, until the kept set is stable. Dropping in one dim can
  //       create new singletons / all-zero levels in another, hence the loop. ──
  let droppedZeroLevels = 0;
  let droppedSingletons = 0;
  for (let pass = 0; pass < 1000; pass++) {
    let removed = false;
    for (let d = 0; d < D; d++) {
      const ySum = new Map(), cnt = new Map();
      for (const r of work) {
        const lv = r[feCols[d]];
        ySum.set(lv, (ySum.get(lv) ?? 0) + r[yCol]);
        cnt.set(lv,  (cnt.get(lv)  ?? 0) + 1);
      }
      const drop = new Set();
      let zc = 0, sc = 0;
      for (const [lv, s] of ySum) if (s === 0) { drop.add(lv); zc++; }
      for (const [lv, c] of cnt)  if (c === 1 && !drop.has(lv)) { drop.add(lv); sc++; }
      if (drop.size === 0) continue;
      const before = work.length;
      work = work.filter(r => !drop.has(r[feCols[d]]));
      if (work.length !== before) { removed = true; droppedZeroLevels += zc; droppedSingletons += sc; }
    }
    if (!removed) break;
  }

  const n = work.length;
  if (n < k + 2)
    return { error: `Insufficient observations after dropping all-zero-Y FE levels (${droppedZeroLevels}) and singleton levels (${droppedSingletons}).` };

  // ── 3. Build arrays + per-dim contiguous level indices ──────────────────────
  const Y      = work.map(r => r[yCol]);
  const X      = work.map(r => xCols.map(c => r[c]));
  const offset = offsetCol != null ? work.map(r => r[offsetCol]) : null;

  const levelIdx = [];   // levelIdx[d] = Int32Array(n) of level index for row i in dim d
  const nLevels  = [];
  for (let d = 0; d < D; d++) {
    const map = new Map();
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const lv = work[i][feCols[d]];
      let li = map.get(lv);
      if (li === undefined) { li = map.size; map.set(lv, li); }
      idx[i] = li;
    }
    levelIdx.push(idx);
    nLevels.push(map.size);
  }
  const sumLevels = nLevels.reduce((a, b) => a + b, 0);

  // ── 4. Weighted alternating-projection demean of an n×m column matrix M by all
  //       D fixed effects, using IRLS weights W. Exact single pass for D=1; MAP
  //       iteration to convergence for D≥2 (Gaure 2013 proves MAP → exact
  //       projection onto the FE column space, so FWL on the result is exact). ──
  function demeanW(M, W) {
    const m = M[0].length;
    const out = M.map(row => row.slice());
    const passOnce = () => {
      let maxMean = 0;
      for (let d = 0; d < D; d++) {
        const idx = levelIdx[d], L = nLevels[d];
        const wsum  = new Float64Array(L);
        const wxsum = Array.from({ length: L }, () => new Float64Array(m));
        for (let i = 0; i < n; i++) {
          const li = idx[i], wi = W[i], oi = out[i];
          wsum[li] += wi;
          for (let j = 0; j < m; j++) wxsum[li][j] += wi * oi[j];
        }
        for (let i = 0; i < n; i++) {
          const li = idx[i], denom = wsum[li] > 1e-300 ? wsum[li] : 1e-300, oi = out[i];
          for (let j = 0; j < m; j++) {
            const mean = wxsum[li][j] / denom;
            if (Math.abs(mean) > maxMean) maxMean = Math.abs(mean);
            oi[j] -= mean;
          }
        }
      }
      return maxMean;
    };
    if (D === 1) { passOnce(); return out; }
    for (let it = 0; it < demeanMaxIter; it++) if (passOnce() < demeanTol) break;
    return out;
  }

  // ── 5. IRLS with FE projection (FWL each Newton step) ───────────────────────
  let beta = Array(k).fill(0);
  // glm.fit start: μ ≈ Y + 0.1 ⇒ feOffset = log(Y+0.1) − offset  (with β = 0)
  const feOffset = new Float64Array(n);
  for (let i = 0; i < n; i++) feOffset[i] = Math.log(Y[i] + 0.1) - (offset ? offset[i] : 0);

  let converged = false, iterations = 0;

  for (let iter = 0; iter < maxIter; iter++) {
    // (a) η, μ
    const eta = new Float64Array(n), mu = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let xb = 0; const xi = X[i];
      for (let j = 0; j < k; j++) xb += xi[j] * beta[j];
      eta[i] = feOffset[i] + (offset ? offset[i] : 0) + xb;
      mu[i]  = Math.min(Math.max(Math.exp(eta[i]), 1e-300), 1e300);
    }
    // (b) Poisson IRLS: W = μ; working response minus the known offset:
    //     zc_i = (η_i − offset_i) + (Y_i − μ_i)/μ_i
    const W  = mu;
    const zc = new Float64Array(n);
    for (let i = 0; i < n; i++)
      zc[i] = (eta[i] - (offset ? offset[i] : 0)) + (Y[i] - mu[i]) / mu[i];

    // (c) demean [X | zc] by FE (weighted), then WLS for β (FWL)
    const stack = X.map((xi, i) => { const row = new Array(k + 1); for (let j = 0; j < k; j++) row[j] = xi[j]; row[k] = zc[i]; return row; });
    const dem = demeanW(stack, W);

    const XtWX = Array.from({ length: k }, () => new Float64Array(k));
    const XtWZ = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      const wi = W[i]; if (!(wi > 1e-300) || !isFinite(wi)) continue;
      const di = dem[i], zt = di[k];
      for (let j = 0; j < k; j++) {
        XtWZ[j] += wi * di[j] * zt;
        for (let l = 0; l < k; l++) XtWX[j][l] += wi * di[j] * di[l];
      }
    }
    const AinvIt = matInv(XtWX.map(r => Array.from(r)));
    if (!AinvIt) return { error: "Singular matrix — collinearity or no within-FE variation in a regressor." };
    const betaNew = AinvIt.map(row => row.reduce((s, v, j) => s + v * XtWZ[j], 0));

    // (d) update FE offset = P_FE(zc − Xβ) = (zc − z̃) − (X − X̃)·β
    for (let i = 0; i < n; i++) {
      const di = dem[i]; let pfeX = 0;
      for (let j = 0; j < k; j++) pfeX += (X[i][j] - di[j]) * betaNew[j];
      feOffset[i] = (zc[i] - di[k]) - pfeX;
    }

    const maxDiff = betaNew.reduce((mx, b, i) => Math.max(mx, Math.abs(b - beta[i])), 0);
    beta = betaNew; iterations = iter + 1;
    if (maxDiff < tol) { converged = true; break; }
  }

  // ── 6. Final fit ────────────────────────────────────────────────────────────
  const etaF = new Float64Array(n), muF = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let xb = 0; const xi = X[i];
    for (let j = 0; j < k; j++) xb += xi[j] * beta[j];
    etaF[i] = feOffset[i] + (offset ? offset[i] : 0) + xb;
    muF[i]  = Math.exp(etaF[i]);
  }
  const resid  = Y.map((y, i) => y - muF[i]);
  const logLik = Y.reduce((s, y, i) => s + y * etaF[i] - muF[i] - lgamma(y + 1), 0);

  // ── 7. SE — demean X at final weights μ, sandwich (or robust override) ───────
  const XtildeF = demeanW(X.map(xi => xi.slice()), muF);
  const A = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < n; i++) {
    const wi = muF[i]; if (!(wi > 0) || !isFinite(wi)) continue;
    const di = XtildeF[i];
    for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) A[j][l] += wi * di[j] * di[l];
  }
  const Ainv = matInv(A.map(r => Array.from(r)));
  if (!Ainv) return { error: "Variance-covariance matrix is singular at convergence." };

  // Sandwich helper: V = Ainv · meat · Ainv  (returns full k×k matrix)
  const sandwich = (meat) => {
    const AM = Ainv.map(rowi => { const o = new Array(k); for (let l = 0; l < k; l++) { let s = 0; for (let mm = 0; mm < k; mm++) s += rowi[mm] * meat[mm][l]; o[l] = s; } return o; });
    return AM.map(rowi => { const o = new Array(k); for (let l = 0; l < k; l++) { let s = 0; for (let mm = 0; mm < k; mm++) s += rowi[mm] * Ainv[mm][l]; o[l] = s; } return o; });
  };

  let se = null;
  let vcov = null;
  // When returnVcov is requested we build the FULL k×k covariance V for the
  // requested SE type (Sun-Abraham delta method needs the off-diagonals). The
  // diagonal sqrt(diag(V)) is byte-identical to computeRobustSE's output for the
  // same type (same meat, same Ainv "bread"). When returnVcov is absent we keep
  // the original code path exactly so existing outputs do not change.
  if (returnVcov) {
    const seType = (seOpts?.seType ?? "classical").toUpperCase();
    if (seType === "CLASSICAL") {
      // HC0 sandwich (matches the original non-robust branch below)
      const meat = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) {
        const e2 = resid[i] * resid[i], di = XtildeF[i];
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += e2 * di[j] * di[l];
      }
      vcov = sandwich(meat);
    } else if (seType === "HC0" || seType === "HC1") {
      const scale = seType === "HC1" ? n / (n - k) : 1;
      const meat = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) {
        const e2 = resid[i] * resid[i] * scale, di = XtildeF[i];
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += e2 * di[j] * di[l];
      }
      vcov = sandwich(meat);
    } else if (seType === "HC2" || seType === "HC3") {
      // leverage h_ii = x̃_i' (X̃'X̃)⁻¹ x̃_i on the UNWEIGHTED demeaned design — this
      // matches robustSE.sandwichSE so sqrt(diag(V)) is identical to the diagonal
      // computeRobustSE returns (verified to 1e-9). Build the unweighted Gram here.
      const exp = seType === "HC3" ? 2 : 1;
      const G = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) { const di = XtildeF[i]; for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) G[j][l] += di[j] * di[l]; }
      const Ginv = matInv(G.map(rw => Array.from(rw))) ?? Ainv;
      const meat = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) {
        const di = XtildeF[i];
        let h = 0;
        for (let j = 0; j < k; j++) { let aj = 0; for (let l = 0; l < k; l++) aj += Ginv[j][l] * di[l]; h += di[j] * aj; }
        h = Math.min(1 - 1e-10, Math.max(0, h));
        const w = (resid[i] * resid[i]) / Math.pow(1 - h, exp);
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += w * di[j] * di[l];
      }
      vcov = sandwich(meat);
    } else if (seType === "CLUSTERED" || seType === "TWOWAY") {
      // Cluster meat = Σ_g s_g s_g',  s_g = Σ_{i∈g} e_i x̃_i. Small-sample
      // correction G/(G-1)·(n-1)/(n-k) matches robustSE.clusteredSE.
      const clusterMeat = (labels) => {
        const groups = new Map();
        for (let i = 0; i < n; i++) { const g = labels[i]; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(i); }
        const G = groups.size;
        const meat = Array.from({ length: k }, () => new Float64Array(k));
        for (const idxs of groups.values()) {
          const sg = new Float64Array(k);
          for (const i of idxs) { const ei = resid[i], di = XtildeF[i]; for (let j = 0; j < k; j++) sg[j] += ei * di[j]; }
          for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += sg[j] * sg[l];
        }
        const sc = (G / (G - 1)) * ((n - 1) / (n - k));
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] *= sc;
        return meat;
      };
      const cv = seOpts?.clusterVar;
      const c1 = work.map(r => r[cv] ?? "__missing__");
      if (seType === "CLUSTERED") {
        vcov = sandwich(clusterMeat(c1));
      } else {
        const cv2 = seOpts?.clusterVar2;
        const c2 = work.map(r => r[cv2] ?? "__missing__");
        const ci = c1.map((a, i) => `${a}|${c2[i]}`);
        const V1 = sandwich(clusterMeat(c1));
        const V2 = sandwich(clusterMeat(c2));
        const V12 = sandwich(clusterMeat(ci));
        vcov = V1.map((row, j) => row.map((v, l) => v + V2[j][l] - V12[j][l]));
      }
    } else if (seType === "HAC") {
      // Newey-West Bartlett on time-ordered demeaned scores g_t = e_t x̃_t
      const tv = seOpts?.timeVar;
      const tIdx = work.map(r => Number(r[tv] ?? 0));
      const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => tIdx[a] - tIdx[b]);
      const es = order.map(i => resid[i]);
      const Xs = order.map(i => XtildeF[i]);
      const L = seOpts?.maxLag ?? Math.floor(4 * Math.pow(n / 100, 2 / 9));
      const meat = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) { const e2 = es[i] * es[i], di = Xs[i]; for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += e2 * di[j] * di[l]; }
      for (let lag = 1; lag <= L; lag++) {
        const wgt = 1 - lag / (L + 1);
        const Gl = Array.from({ length: k }, () => new Float64Array(k));
        for (let t = lag; t < n; t++) { const ee = es[t] * es[t - lag], dt = Xs[t], dl = Xs[t - lag]; for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) Gl[j][l] += ee * dt[j] * dl[l]; }
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += wgt * (Gl[j][l] + Gl[l][j]);
      }
      vcov = sandwich(meat);
    }
    if (vcov) se = vcov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  }

  if (se === null) {
    const robSE = computeRobustSE(seOpts, Ainv, XtildeF, resid, n, k, work);
    if (robSE) {
      se = robSE;
    } else {
      // HC0 sandwich: V = Ainv · (X̃' diag(e²) X̃) · Ainv
      const meat = Array.from({ length: k }, () => new Float64Array(k));
      for (let i = 0; i < n; i++) {
        const e2 = resid[i] * resid[i], di = XtildeF[i];
        for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += e2 * di[j] * di[l];
      }
      const V = sandwich(meat);
      se = V.map((row, i) => Math.sqrt(Math.max(0, row[i])));
    }
  }

  // ── 8. Inference + fit stats ────────────────────────────────────────────────
  const zStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = zStats.map(z => (isFinite(z) ? zPValue(z) : NaN));

  // McFadden pseudo-R² vs constant-only Poisson null (μ = ȳ)
  const ybar = Y.reduce((a, b) => a + b, 0) / n;
  const logLikNull = ybar > 0 ? Y.reduce((s, y) => s + y * Math.log(ybar) - ybar - lgamma(y + 1), 0) : 0;
  const McFaddenR2 = logLikNull !== 0 ? 1 - logLik / logLikNull : 0;

  const kTotal = k + sumLevels - (D - 1);   // regressors + identified FE params (one normalization per extra dim)
  const AIC = -2 * logLik + 2 * kTotal;
  const BIC = -2 * logLik + kTotal * Math.log(n);
  const df  = n - kTotal;

  return {
    beta, se, zStats, pVals,
    varNames: xCols,                         // no intercept — absorbed by FE
    logLik, nullLogLik: logLikNull, McFaddenR2,
    AIC, BIC,
    fitted: Array.from(muF), resid,
    n, k, df,
    nFE: D,
    feDims: feCols.map((c, d) => ({ col: c, nLevels: nLevels[d] })),
    nLevels: Object.fromEntries(feCols.map((c, d) => [c, nLevels[d]])),
    converged, iterations,
    droppedZeroLevels, droppedSingletons,
    ...(returnVcov ? { vcov } : {}),         // full k×k coef covariance (opt-in)
  };
}

// ─── SUN & ABRAHAM (2021) INTERACTION-WEIGHTED EVENT STUDY ───────────────────
// Self-contained chi-squared upper-tail p-value (regularized incomplete gamma Q).
// Used only by runSunAbraham's joint Wald tests — avoids importing calcEngine and
// keeps this engine import-free of other engines (matInv/lgamma already local).
// --- NEGATIVE BINOMIAL NB2 FIXED EFFECTS (alternating projections) -----------
// Same absorbed-FE IRLS structure as runPoissonFEMulti, with NB2 weights
// W_i = mu_i / (1 + alpha * mu_i). Alpha is updated by MOM then refined by a
// one-dimensional Newton step on log(alpha), holding beta/FE fixed.
export function runNegBinFE(rows, yCol, xCols, feCols, seOpts = {}, offsetCol = null, opts = {}) {
  const {
    tol           = 1e-8,
    maxIter       = 200,
    demeanTol     = 1e-10,
    demeanMaxIter = 5000,
    alphaTol      = 1e-7,
    alphaMaxIter  = 25,
  } = opts;

  const D = (feCols || []).length;
  if (D < 1) return { error: "runNegBinFE requires at least one fixed-effect column." };
  const k = xCols.length;

  let work = rows.filter(r => {
    const y = r[yCol];
    if (!(typeof y === "number" && isFinite(y) && y >= 0)) return false;
    if (feCols.some(c => r[c] == null)) return false;
    if (xCols.some(c => !(typeof r[c] === "number" && isFinite(r[c])))) return false;
    if (offsetCol != null && !(typeof r[offsetCol] === "number" && isFinite(r[offsetCol]))) return false;
    return true;
  });
  if (work.length < k + 2)
    return { error: `Insufficient observations: need at least ${k + 2}.` };

  let droppedZeroLevels = 0;
  let droppedSingletons = 0;
  for (let pass = 0; pass < 1000; pass++) {
    let removed = false;
    for (let d = 0; d < D; d++) {
      const ySum = new Map(), cnt = new Map();
      for (const r of work) {
        const lv = r[feCols[d]];
        ySum.set(lv, (ySum.get(lv) ?? 0) + r[yCol]);
        cnt.set(lv,  (cnt.get(lv)  ?? 0) + 1);
      }
      const drop = new Set();
      let zc = 0, sc = 0;
      for (const [lv, s] of ySum) if (s === 0) { drop.add(lv); zc++; }
      for (const [lv, c] of cnt)  if (c === 1 && !drop.has(lv)) { drop.add(lv); sc++; }
      if (drop.size === 0) continue;
      const before = work.length;
      work = work.filter(r => !drop.has(r[feCols[d]]));
      if (work.length !== before) {
        removed = true;
        droppedZeroLevels += zc;
        droppedSingletons += sc;
      }
    }
    if (!removed) break;
  }

  const n = work.length;
  if (n < k + 2)
    return { error: `Insufficient observations after dropping all-zero-Y FE levels (${droppedZeroLevels}) and singleton levels (${droppedSingletons}).` };

  const Y      = work.map(r => r[yCol]);
  const X      = work.map(r => xCols.map(c => r[c]));
  const offset = offsetCol != null ? work.map(r => r[offsetCol]) : null;

  const levelIdx = [];
  const nLevels  = [];
  for (let d = 0; d < D; d++) {
    const map = new Map();
    const idx = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const lv = work[i][feCols[d]];
      let li = map.get(lv);
      if (li === undefined) { li = map.size; map.set(lv, li); }
      idx[i] = li;
    }
    levelIdx.push(idx);
    nLevels.push(map.size);
  }
  const sumLevels = nLevels.reduce((a, b) => a + b, 0);

  function demeanW(M, W) {
    const m = M[0].length;
    const out = M.map(row => row.slice());
    const passOnce = () => {
      let maxMean = 0;
      for (let d = 0; d < D; d++) {
        const idx = levelIdx[d], L = nLevels[d];
        const wsum  = new Float64Array(L);
        const wxsum = Array.from({ length: L }, () => new Float64Array(m));
        for (let i = 0; i < n; i++) {
          const li = idx[i], wi = W[i], oi = out[i];
          wsum[li] += wi;
          for (let j = 0; j < m; j++) wxsum[li][j] += wi * oi[j];
        }
        for (let i = 0; i < n; i++) {
          const li = idx[i], denom = wsum[li] > 1e-300 ? wsum[li] : 1e-300, oi = out[i];
          for (let j = 0; j < m; j++) {
            const mean = wxsum[li][j] / denom;
            if (Math.abs(mean) > maxMean) maxMean = Math.abs(mean);
            oi[j] -= mean;
          }
        }
      }
      return maxMean;
    };
    if (D === 1) { passOnce(); return out; }
    for (let it = 0; it < demeanMaxIter; it++) if (passOnce() < demeanTol) break;
    return out;
  }

  const nbLogLik = (muVec, alphaVal) => {
    const a = Math.min(Math.max(alphaVal, 1e-10), 1e6);
    const invA = 1 / a;
    let ll = 0;
    for (let i = 0; i < n; i++) {
      const y = Y[i];
      const mu = Math.min(Math.max(muVec[i], 1e-300), 1e300);
      ll += y * Math.log(mu)
        - (y + invA) * Math.log1p(a * mu)
        + lgamma(y + invA) - lgamma(invA) - lgamma(y + 1);
    }
    return ll;
  };

  const momAlpha = (muVec) => {
    let pearson = 0, sumMu = 0;
    for (let i = 0; i < n; i++) {
      const mu = Math.max(muVec[i], 1e-300);
      const e = Y[i] - mu;
      pearson += (e * e) / mu;
      sumMu += mu;
    }
    return Math.min(1e6, Math.max(1e-8, (pearson - n) / Math.max(sumMu, 1e-300)));
  };

  const refineAlpha = (muVec, startAlpha) => {
    let theta = Math.log(Math.min(Math.max(startAlpha, 1e-8), 1e6));
    const h = 1e-4;
    for (let it = 0; it < alphaMaxIter; it++) {
      const f0 = nbLogLik(muVec, Math.exp(theta));
      const fp = nbLogLik(muVec, Math.exp(theta + h));
      const fm = nbLogLik(muVec, Math.exp(theta - h));
      const score = (fp - fm) / (2 * h);
      const hess = (fp - 2 * f0 + fm) / (h * h);
      if (!isFinite(score) || !isFinite(hess) || hess >= -1e-12) break;
      const step = Math.max(-1, Math.min(1, score / (-hess)));
      theta += step;
      theta = Math.max(Math.log(1e-8), Math.min(Math.log(1e6), theta));
      if (Math.abs(step) < alphaTol) break;
    }
    const alpha = Math.exp(theta);
    const f0 = nbLogLik(muVec, alpha);
    const fp = nbLogLik(muVec, Math.exp(theta + h));
    const fm = nbLogLik(muVec, Math.exp(theta - h));
    const hessTheta = (fp - 2 * f0 + fm) / (h * h);
    const seTheta = hessTheta < 0 ? Math.sqrt(-1 / hessTheta) : NaN;
    return {
      alpha,
      seAlpha: isFinite(seTheta) ? alpha * seTheta : NaN,
      alphaCI: isFinite(seTheta)
        ? [Math.exp(theta - 1.96 * seTheta), Math.exp(theta + 1.96 * seTheta)]
        : [NaN, NaN],
    };
  };

  let beta = Array(k).fill(0);
  let alpha = 0.1;
  const feOffset = new Float64Array(n);
  for (let i = 0; i < n; i++) feOffset[i] = Math.log(Y[i] + 0.1) - (offset ? offset[i] : 0);

  let converged = false, iterations = 0;
  for (let iter = 0; iter < maxIter; iter++) {
    const eta = new Float64Array(n), mu = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      let xb = 0; const xi = X[i];
      for (let j = 0; j < k; j++) xb += xi[j] * beta[j];
      eta[i] = feOffset[i] + (offset ? offset[i] : 0) + xb;
      mu[i]  = Math.min(Math.max(Math.exp(eta[i]), 1e-300), 1e300);
    }

    const alphaFit = refineAlpha(mu, momAlpha(mu));
    if (isFinite(alphaFit.alpha)) alpha = alphaFit.alpha;

    const W  = new Float64Array(n);
    const zc = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const mui = Math.max(mu[i], 1e-300);
      const denom = 1 + alpha * mui;
      W[i] = Math.max(1e-300, mui / denom);
      zc[i] = (eta[i] - (offset ? offset[i] : 0)) + (Y[i] - mui) * denom / mui;
    }

    const stack = X.map((xi, i) => {
      const row = new Array(k + 1);
      for (let j = 0; j < k; j++) row[j] = xi[j];
      row[k] = zc[i];
      return row;
    });
    const dem = demeanW(stack, W);

    const XtWX = Array.from({ length: k }, () => new Float64Array(k));
    const XtWZ = new Float64Array(k);
    for (let i = 0; i < n; i++) {
      const wi = W[i]; if (!(wi > 1e-300) || !isFinite(wi)) continue;
      const di = dem[i], zt = di[k];
      for (let j = 0; j < k; j++) {
        XtWZ[j] += wi * di[j] * zt;
        for (let l = 0; l < k; l++) XtWX[j][l] += wi * di[j] * di[l];
      }
    }
    const AinvIt = matInv(XtWX.map(r => Array.from(r)));
    if (!AinvIt) return { error: "Singular matrix - collinearity or no within-FE variation in a regressor." };
    const betaNew = AinvIt.map(row => row.reduce((s, v, j) => s + v * XtWZ[j], 0));

    for (let i = 0; i < n; i++) {
      const di = dem[i]; let pfeX = 0;
      for (let j = 0; j < k; j++) pfeX += (X[i][j] - di[j]) * betaNew[j];
      feOffset[i] = (zc[i] - di[k]) - pfeX;
    }

    const maxDiff = betaNew.reduce((mx, b, i) => Math.max(mx, Math.abs(b - beta[i])), 0);
    beta = betaNew; iterations = iter + 1;
    if (maxDiff < tol) { converged = true; break; }
  }

  const etaF = new Float64Array(n), muF = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let xb = 0; const xi = X[i];
    for (let j = 0; j < k; j++) xb += xi[j] * beta[j];
    etaF[i] = feOffset[i] + (offset ? offset[i] : 0) + xb;
    muF[i]  = Math.min(Math.max(Math.exp(etaF[i]), 1e-300), 1e300);
  }
  const alphaFinal = refineAlpha(muF, momAlpha(muF));
  if (isFinite(alphaFinal.alpha)) alpha = alphaFinal.alpha;
  const resid = Y.map((y, i) => y - muF[i]);
  const logLik = nbLogLik(muF, alpha);

  const Wf = new Float64Array(n);
  for (let i = 0; i < n; i++) Wf[i] = Math.max(1e-300, muF[i] / (1 + alpha * muF[i]));
  const XtildeF = demeanW(X.map(xi => xi.slice()), Wf);
  const A = Array.from({ length: k }, () => new Float64Array(k));
  for (let i = 0; i < n; i++) {
    const wi = Wf[i]; if (!(wi > 0) || !isFinite(wi)) continue;
    const di = XtildeF[i];
    for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) A[j][l] += wi * di[j] * di[l];
  }
  const Ainv = matInv(A.map(r => Array.from(r)));
  if (!Ainv) return { error: "Variance-covariance matrix is singular at convergence." };

  const robSE = computeRobustSE(seOpts, Ainv, XtildeF, resid, n, k, work);
  let se = robSE;
  let vcov = null;
  if (!se) {
    const sandwich = (meat) => {
      const AM = Ainv.map(rowi => {
        const o = new Array(k);
        for (let l = 0; l < k; l++) { let s = 0; for (let mm = 0; mm < k; mm++) s += rowi[mm] * meat[mm][l]; o[l] = s; }
        return o;
      });
      return AM.map(rowi => {
        const o = new Array(k);
        for (let l = 0; l < k; l++) { let s = 0; for (let mm = 0; mm < k; mm++) s += rowi[mm] * Ainv[mm][l]; o[l] = s; }
        return o;
      });
    };
    const meat = Array.from({ length: k }, () => new Float64Array(k));
    for (let i = 0; i < n; i++) {
      const e2 = resid[i] * resid[i], di = XtildeF[i];
      for (let j = 0; j < k; j++) for (let l = 0; l < k; l++) meat[j][l] += e2 * di[j] * di[l];
    }
    vcov = sandwich(meat);
    se = vcov.map((row, i) => Math.sqrt(Math.max(0, row[i])));
  }

  const zStats = beta.map((b, i) => (se[i] > 0 ? b / se[i] : NaN));
  const pVals  = zStats.map(z => (isFinite(z) ? zPValue(z) : NaN));

  const ybar = Y.reduce((a, b) => a + b, 0) / n;
  const muNull = new Float64Array(n);
  for (let i = 0; i < n; i++) muNull[i] = Math.max(ybar, 1e-300);
  const logLikNull = nbLogLik(muNull, alpha);
  const McFaddenR2 = logLikNull !== 0 ? 1 - logLik / logLikNull : 0;

  const kTotal = k + sumLevels - (D - 1) + 1;
  const AIC = -2 * logLik + 2 * kTotal;
  const BIC = -2 * logLik + kTotal * Math.log(n);
  const df  = n - kTotal;

  const meanY = ybar;
  const sampleVar = n > 1 ? Y.reduce((s, y) => s + (y - meanY) * (y - meanY), 0) / (n - 1) : NaN;
  const m4 = Y.reduce((s, y) => s + Math.pow(y - meanY, 4), 0) / n;
  const seVar = Math.sqrt(Math.max(0, (m4 - sampleVar * sampleVar) / n));
  const odZ = seVar > 0 ? (sampleVar - meanY) / seVar : NaN;
  const overdispersionTest = { stat: odZ, pValue: isFinite(odZ) ? zPValue(odZ) : NaN };

  return {
    beta, se, zStats, pVals,
    varNames: xCols,
    logLik, nullLogLik: logLikNull, McFaddenR2,
    AIC, BIC,
    fitted: Array.from(muF), resid,
    n, k, df,
    nFE: D,
    feDims: feCols.map((c, d) => ({ col: c, nLevels: nLevels[d] })),
    nLevels: Object.fromEntries(feCols.map((c, d) => [c, nLevels[d]])),
    converged, iterations,
    droppedZeroLevels, droppedSingletons,
    alpha,
    alphaCI: alphaFinal.alphaCI,
    alphaSE: alphaFinal.seAlpha,
    overdispersionTest,
    ...(vcov ? { vcov } : {}),
  };
}

function _gammaincQ(s, x) {
  if (x <= 0) return 1;
  if (x < s + 1) {
    // lower series P(s,x) → Q = 1 − P
    let term = 1 / s, sum = term;
    for (let nIt = 1; nIt < 1000; nIt++) {
      term *= x / (s + nIt);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
    }
    const P = sum * Math.exp(-x + s * Math.log(x) - lgamma(s));
    return 1 - P;
  }
  // Lentz continued fraction for Q(s,x)
  const tiny = 1e-300;
  let b = x + 1 - s, c = 1 / tiny, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - s);
    b += 2;
    d = an * d + b; if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c; if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x + s * Math.log(x) - lgamma(s));
}
function chiSqUpperTail(stat, df) {
  if (!(stat > 0) || !(df > 0)) return NaN;
  return _gammaincQ(df / 2, stat / 2);
}

/**
 * runSunAbraham — Sun & Abraham (2021) interaction-weighted event study over a
 * Poisson/PPML backbone (matches fixest `fepois(y ~ sunab(cohort, period) + X)`).
 *
 * Reference: Sun, L. & Abraham, S. (2021). "Estimating Dynamic Treatment Effects
 * in Event Studies with Heterogeneous Treatment Effects." Journal of Econometrics
 * 225(2), 175–199.
 *
 * Builds saturated cohort×relative-period interaction dummies, estimates them with
 * runPoissonFEMulti (absorbing feCols), then interaction-weight-aggregates the
 * cohort-specific coefficients into one ATT per relative period with delta-method
 * SE from the full coefficient covariance V. Adds joint pre/post Wald tests.
 *
 * @param {object[]} rows
 * @param {string}   yCol      count outcome (≥0)
 * @param {string[]} xCols     extra scalar controls passed through to regressors
 * @param {object}   cfg       { cohortCol, periodCol, feCols=[], refPeriod=-1,
 *                               controlMode="auto", controlCohorts=[] }
 * @param {object}   seOpts    SE config (threaded to runPoissonFEMulti; thesis
 *                             uses { seType:"clustered", clusterVar:unitCol })
 * @param {object}   opts      passed to runPoissonFEMulti (tol/maxIter/offsetCol…)
 * @returns {object}  see "Return object" below
 */
export function runSunAbraham(rows, yCol, xCols, cfg = {}, seOpts = {}, opts = {}) {
  const {
    cohortCol,
    periodCol,
    feCols = [],
    refPeriod = -1,
    controlMode = "auto",
    controlCohorts = [],
  } = cfg;

  if (!cohortCol || !periodCol)
    return { error: "runSunAbraham requires cohortCol and periodCol." };

  const refSet = new Set((Array.isArray(refPeriod) ? refPeriod : [refPeriod]).map(Number));
  const xCtrl = Array.isArray(xCols) ? xCols : [];

  // ── 1. Filter to rows with finite y≥0, valid cohort & period ────────────────
  const base = rows.filter(r => {
    const y = r[yCol];
    if (!(typeof y === "number" && isFinite(y) && y >= 0)) return false;
    const p = Number(r[periodCol]);
    if (!isFinite(p)) return false;
    if (xCtrl.some(c => !(typeof r[c] === "number" && isFinite(r[c])))) return false;
    if (feCols.some(c => r[c] == null)) return false;
    return true;
  });
  if (base.length < 4) return { error: "Insufficient valid observations for Sun-Abraham." };

  // Observed calendar-period range (for the "auto" out-of-range control rule).
  let pMin = Infinity, pMax = -Infinity;
  for (const r of base) { const p = Number(r[periodCol]); if (p < pMin) pMin = p; if (p > pMax) pMax = p; }

  // ── 2. Classify cohorts: control vs treated ─────────────────────────────────
  // cohort value may be missing/NA/sentinel ⇒ never-treated control.
  const cohortVals = new Set();
  for (const r of base) { const c = r[cohortCol]; if (c != null && isFinite(Number(c))) cohortVals.add(Number(c)); }

  const explicitCtrl = new Set(controlCohorts.map(Number));
  const isControlRow = (r) => {
    const cRaw = r[cohortCol];
    const cIsMissing = cRaw == null || !isFinite(Number(cRaw));
    const c = Number(cRaw);
    if (controlMode === "explicit") return cIsMissing || explicitCtrl.has(c);
    if (controlMode === "never")    return cIsMissing;
    // "auto": never-treated (missing/sentinel) OR cohort outside observed period range
    return cIsMissing || c < pMin || c > pMax;
  };

  // ── 3. Relative period RP = period − cohort (treated rows only); detect the
  //       "always-treated" cohorts (cohorts observed only at RP ≥ 0) and drop. ──
  const treatedRowsByCohort = new Map();   // cohort → [{row, rp}]
  for (const r of base) {
    if (isControlRow(r)) continue;
    const c = Number(r[cohortCol]);
    const rp = Number(r[periodCol]) - c;
    if (!treatedRowsByCohort.has(c)) treatedRowsByCohort.set(c, []);
    treatedRowsByCohort.get(c).push({ row: r, rp });
  }

  const droppedAlwaysTreatedCohorts = [];
  for (const [c, recs] of treatedRowsByCohort) {
    const minRP = Math.min(...recs.map(x => x.rp));
    if (minRP >= 0) droppedAlwaysTreatedCohorts.push(c);   // never observed pre-treatment
  }
  for (const c of droppedAlwaysTreatedCohorts) treatedRowsByCohort.delete(c);

  const treatedCohorts = [...treatedRowsByCohort.keys()].sort((a, b) => a - b);
  if (treatedCohorts.length === 0)
    return { error: "No treated (non-control, non-always-treated) cohorts remain." };

  // ── 4. Build saturated interaction dummies __sa_{e}_{l} and the working sample.
  //       Control-cohort rows are KEPT (they identify the baseline) but get no
  //       dummies. Always-treated rows have been removed. n_{e,l} = count of
  //       (treated) obs with cohort e at relative period l. ─────────────────────
  const nEL = new Map();                    // `${e}__${l}` → count
  const cellKey = (e, l) => `${e}__${l}`;
  const relPeriodsByCohort = new Map();     // e → Set(l) present (l ≠ ref)
  for (const [e, recs] of treatedRowsByCohort) {
    const set = new Set();
    for (const { rp } of recs) {
      if (refSet.has(rp)) continue;         // reference RP(s): no dummy
      set.add(rp);
      const kk = cellKey(e, rp);
      nEL.set(kk, (nEL.get(kk) ?? 0) + 1);
    }
    relPeriodsByCohort.set(e, set);
  }

  // Stable ordered list of (e,l) interaction columns.
  const interactions = [];                  // [{ name, e, l }]
  for (const e of treatedCohorts) {
    const ls = [...relPeriodsByCohort.get(e)].sort((a, b) => a - b);
    for (const l of ls) interactions.push({ name: `__sa_${e}_${l}`, e, l });
  }
  if (interactions.length === 0)
    return { error: "No interaction terms after removing reference relative period(s)." };

  // Build augmented rows: control rows + treated rows, each with dummy columns.
  // Map each base row to its (cohort, rp) once so we can set the right dummy.
  const work = base
    .filter(r => {
      if (isControlRow(r)) return true;
      const c = Number(r[cohortCol]);
      return treatedRowsByCohort.has(c);     // exclude always-treated rows
    })
    .map(r => {
      const aug = { ...r };
      for (const it of interactions) aug[it.name] = 0;
      if (!isControlRow(r)) {
        const c = Number(r[cohortCol]);
        const l = Number(r[periodCol]) - c;
        if (!refSet.has(l)) {
          const nm = `__sa_${c}_${l}`;
          if (nm in aug) aug[nm] = 1;        // only set if that (e,l) column exists
        }
      }
      return aug;
    });

  // ── 5. Estimate saturated PPML with FE absorbed; pull β + full vcov V ────────
  const interactionCols = interactions.map(it => it.name);
  const regressors = [...interactionCols, ...xCtrl];
  const fit = runPoissonFEMulti(work, yCol, regressors, feCols, seOpts, { ...opts, returnVcov: true });
  if (fit.error) return { error: `Sun-Abraham PPML fit failed: ${fit.error}` };

  const beta = fit.beta;
  const V = fit.vcov;
  const varNames = fit.varNames;            // === regressors order
  // index of each interaction coefficient in beta/varNames
  const idxOf = new Map(varNames.map((nm, i) => [nm, i]));

  // ── 6. Interaction-weight aggregation to ATT per relative period l ───────────
  //   ATT_l = Σ_{e∈C_l} ω_{e,l} · δ_{e,l},  ω_{e,l} = n_{e,l} / Σ_{e'} n_{e',l}
  //   (sample-share weights, treated as fixed — matches aggregate.fixest).
  //   Var(ATT_l) = w_l' V w_l with w_l zero except ω_{e,l} at δ_{e,l}'s index.
  const allRP = [...new Set(interactions.map(it => it.l))].sort((a, b) => a - b);
  const eventCoeffs = [];
  for (const l of allRP) {
    const cohortsAtL = interactions.filter(it => it.l === l);
    let denom = 0;
    for (const it of cohortsAtL) denom += (nEL.get(cellKey(it.e, it.l)) ?? 0);
    if (denom <= 0) continue;

    const w = new Float64Array(beta.length);
    let att = 0;
    for (const it of cohortsAtL) {
      const wel = (nEL.get(cellKey(it.e, it.l)) ?? 0) / denom;
      const bi = idxOf.get(it.name);
      if (bi == null) continue;
      w[bi] = wel;
      att += wel * beta[bi];
    }
    // Var = w' V w
    let varAtt = 0;
    for (let a = 0; a < w.length; a++) {
      if (w[a] === 0) continue;
      let row = 0;
      for (let b = 0; b < w.length; b++) if (w[b] !== 0) row += V[a][b] * w[b];
      varAtt += w[a] * row;
    }
    const se = Math.sqrt(Math.max(0, varAtt));
    const z = se > 0 ? att / se : NaN;
    const p = isFinite(z) ? zPValue(z) : NaN;
    eventCoeffs.push({ k: l, beta: att, se, z, p, irr: Math.exp(att) - 1 });
  }

  // ── 7. Insert reference relative period(s) as ATT=0 for plotting ─────────────
  for (const rp of refSet) {
    eventCoeffs.push({ k: rp, beta: 0, se: 0, z: null, p: null, irr: 0, isRef: true });
  }
  eventCoeffs.sort((a, b) => a.k - b.k);

  // ── 8. Joint pre/post Wald on the saturated interaction coefficients ─────────
  //   W = (Rβ)' (R V R')⁻¹ (Rβ) ~ χ²_q,  R selects the relevant δ_{e,l}.
  const jointWald = (selIdx) => {
    const q = selIdx.length;
    if (q === 0) return { stat: null, df: 0, pval: null };
    const Rb = selIdx.map(i => beta[i]);
    const sub = selIdx.map(ri => selIdx.map(ci => V[ri][ci]));
    const subInv = matInv(sub);
    if (!subInv) return { stat: null, df: q, pval: null };
    const tmp = subInv.map(row => row.reduce((s, v, j) => s + v * Rb[j], 0));
    const stat = tmp.reduce((s, v, i) => s + v * Rb[i], 0);
    return { stat, df: q, pval: chiSqUpperTail(stat, q) };
  };
  const refMax = Math.max(...refSet);       // pre = l < smallest non-ref convention: use l < refPeriod default (-1)
  const preIdx = interactions.filter(it => it.l < (refSet.has(-1) ? -1 : refMax)).map(it => idxOf.get(it.name)).filter(i => i != null);
  const postIdx = interactions.filter(it => it.l >= 0).map(it => idxOf.get(it.name)).filter(i => i != null);
  const pre = jointWald(preIdx);
  const post = jointWald(postIdx);

  // ── 9. Assemble output ───────────────────────────────────────────────────────
  return {
    // Saturated underlying fit
    beta, se: fit.se, varNames, vcov: V,
    zStats: fit.zStats, pVals: fit.pVals,
    // Sun-Abraham aggregated ATT path (mirrors runEventStudy.eventCoeffs naming)
    eventCoeffs,
    // Joint Wald tests (mirror thesis wald(m, pre) / wald(m, post))
    preTestStat: pre.stat, preTestDf: pre.df, preTestPval: pre.pval,
    postTestStat: post.stat, postTestDf: post.df, postTestPval: post.pval,
    // Fit stats + diagnostics
    logLik: fit.logLik, McFaddenR2: fit.McFaddenR2, AIC: fit.AIC, BIC: fit.BIC,
    n: fit.n, k: fit.k, df: fit.df,
    nCohorts: treatedCohorts.length,
    treatedCohorts,
    controlCohorts: (() => {
      const s = new Set();
      for (const r of base) if (isControlRow(r)) { const c = r[cohortCol]; s.add(c == null || !isFinite(Number(c)) ? "__never__" : Number(c)); }
      return [...s];
    })(),
    droppedAlwaysTreated: droppedAlwaysTreatedCohorts,
    nFE: fit.nFE, feDims: fit.feDims,
    refPeriod: [...refSet],
    converged: fit.converged, iterations: fit.iterations,
    droppedZeroLevels: fit.droppedZeroLevels, droppedSingletons: fit.droppedSingletons,
  };
}

// ─── EXPORT HELPERS ──────────────────────────────────────────────────────────

// LaTeX table — coefficient block + fit stats footer
export function buildBinaryLatex(yVar, results) {
  const { family, beta, se, zStats, pVals, varNames, n, df,
          logLik, mcFaddenR2, AIC, BIC } = results;
  const model = family === "logit" ? "Logit" : "Probit";
  const fmtP  = p => (p == null ? "N/A" : p < 0.001 ? "$<$0.001" : p.toFixed(4));

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
