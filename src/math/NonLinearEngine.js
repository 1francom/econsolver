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
export function runLogit(rows, yCol, xCols) {
  return _runBinaryModel(rows, yCol, xCols, "logit");
}

// ─── PROBIT ───────────────────────────────────────────────────────────────────
// Probit regression via MLE (normal latent-variable model).
// Coefficients are on the latent index scale (not odds-ratio scale).
export function runProbit(rows, yCol, xCols) {
  return _runBinaryModel(rows, yCol, xCols, "probit");
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
function _runBinaryModel(rows, yCol, xCols, family) {
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

  const { beta, se, zStats, pVals, logLik, fitted, residuals, converged, iterations } = result;

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
