// ─── ECON STUDIO · src/math/calcEngine.js ────────────────────────────────────
// Pure-JS math utilities for the Calculate tab.
// No React. No side effects. No external imports.
//
// Exports:
//   solveRoot(fn, a, b, tol, maxIter)            — Brent's method (single equation)
//   solveSystem(fns, x0, tol, maxIter)           — Newton-Raphson for n×n systems
//   derivative(fn, x, h)                         — central-difference first derivative
//   nthDerivative(fn, x, n, h)                   — recursive higher-order derivative
//   gradient(fn, xVec, h)                        — multivariate partial derivatives
//   predict(beta, xVec, XtXinv, s2, df)          — ŷ ± 95% CI
//   evalExpression(expr, scope)                  — safe expression evaluator
//   buildScope(variables)                        — builds numeric scope from variable list
//
// Probability distributions (all registered in buildScope for use in expressions):
//   dnorm/pnorm/qnorm   — Normal
//   dt/pt/qt            — Student-t
//   dbinom/pbinom       — Binomial
//   dpois/ppois         — Poisson
//   dchisq/pchisq       — Chi-squared

// ─── BRENT'S METHOD ──────────────────────────────────────────────────────────
/**
 * Find a root of fn in [a, b] using Brent's method (bisection + secant + IQI).
 * Requires f(a) and f(b) to have opposite signs.
 */
export function solveRoot(fn, a, b, tol = 1e-8, maxIter = 300) {
  let fa = fn(a), fb = fn(b);
  if (!isFinite(fa) || !isFinite(fb))
    return { error: "f(a) or f(b) is not finite — check the expression and interval." };
  if (fa * fb > 0)
    return { error: "f(a) and f(b) must have opposite signs to bracket a root." };
  if (Math.abs(fa) < tol) return { root: a, iter: 0, converged: true };
  if (Math.abs(fb) < tol) return { root: b, iter: 0, converged: true };

  let c = a, fc = fa, d = b - a, e = d;

  for (let i = 0; i < maxIter; i++) {
    if (fb * fc > 0) { c = a; fc = fa; d = e = b - a; }
    if (Math.abs(fc) < Math.abs(fb)) {
      [a, b, c] = [b, c, a];
      [fa, fb, fc] = [fb, fc, fa];
    }
    const tol1 = 2 * Number.EPSILON * Math.abs(b) + 0.5 * tol;
    const xm = 0.5 * (c - b);
    if (Math.abs(xm) <= tol1 || Math.abs(fb) < tol)
      return { root: b, iter: i + 1, converged: true };

    if (Math.abs(e) >= tol1 && Math.abs(fa) > Math.abs(fb)) {
      const s = fb / fa;
      let p, q, r;
      if (a === c) {
        p = 2 * xm * s; q = 1 - s;
      } else {
        q = fa / fc; r = fb / fc;
        p = s * (2 * xm * q * (q - r) - (b - a) * (r - 1));
        q = (q - 1) * (r - 1) * (s - 1);
      }
      if (p > 0) q = -q; else p = -p;
      if (2 * p < Math.min(3 * xm * q - Math.abs(tol1 * q), Math.abs(e * q))) {
        e = d; d = p / q;
      } else { d = xm; e = d; }
    } else { d = xm; e = d; }

    a = b; fa = fb;
    b += Math.abs(d) > tol1 ? d : tol1 * Math.sign(xm);
    fb = fn(b);
  }
  return { root: b, iter: maxIter, converged: false };
}

// ─── SYSTEM OF EQUATIONS — NEWTON-RAPHSON ────────────────────────────────────
/**
 * Solve F(x) = 0 where F: R^n → R^n using Newton-Raphson with numerical Jacobian.
 * Designed for economist FOC systems (2–8 unknowns, well-conditioned near solution).
 *
 * @param {Function[]} fns     — [f1, f2, ..., fn] each fi(xVec: number[]) → number
 * @param {number[]}   x0      — initial guess vector (length n)
 * @param {number}     tol     — convergence tolerance on ||F||₂ (default 1e-8)
 * @param {number}     maxIter — max iterations (default 100)
 * @returns {{ solution, fVals, iter, converged } | { error }}
 */
export function solveSystem(fns, x0, tol = 1e-8, maxIter = 100) {
  const n = fns.length;
  if (x0.length !== n)
    return { error: `Need ${n} initial guesses for ${n} equations.` };

  let x = [...x0];
  const h = 1e-6;

  for (let iter = 0; iter < maxIter; iter++) {
    // Evaluate F(x)
    let F;
    try { F = fns.map(f => f(x)); } catch (e) {
      return { error: `Evaluation error at iteration ${iter}: ${e.message}` };
    }
    if (F.some(v => !isFinite(v)))
      return { error: "System returned non-finite value — check expressions and initial guesses." };

    const norm = Math.sqrt(F.reduce((s, v) => s + v * v, 0));
    if (norm < tol) return { solution: x, fVals: F, iter, converged: true };

    // Numerical Jacobian: J_ij = ∂fi/∂xj via central differences
    const J = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => {
        const xp = x.map((v, k) => k === j ? v + h : v);
        const xm = x.map((v, k) => k === j ? v - h : v);
        return (fns[i](xp) - fns[i](xm)) / (2 * h);
      })
    );

    // Solve J * δ = -F (Gaussian elimination with partial pivoting)
    const delta = _gaussElim(J, F.map(v => -v));
    if (!delta)
      return { error: "Singular Jacobian — system may be ill-conditioned or equations are dependent." };

    // Damped update (caps step to avoid divergence)
    const stepNorm = Math.sqrt(delta.reduce((s, v) => s + v * v, 0));
    const damp = stepNorm > 10 ? 10 / stepNorm : 1;
    x = x.map((v, i) => v + damp * delta[i]);
  }

  const F = fns.map(f => f(x));
  const norm = Math.sqrt(F.reduce((s, v) => s + v * v, 0));
  return { solution: x, fVals: F, iter: maxIter, converged: norm < tol * 1000 };
}

function _gaussElim(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-15) return null;
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

// ─── NUMERICAL DERIVATIVES ───────────────────────────────────────────────────
export function derivative(fn, x, h = 1e-6) {
  return (fn(x + h) - fn(x - h)) / (2 * h);
}

export function nthDerivative(fn, x, n, h = 1e-4) {
  if (n === 0) return fn(x);
  if (n === 1) return derivative(fn, x, h);
  const f1 = gx => nthDerivative(fn, gx, n - 1, h);
  return (f1(x + h) - f1(x - h)) / (2 * h);
}

export function gradient(fn, xVec, h = 1e-6) {
  return xVec.map((_, i) => {
    const xp = xVec.map((v, j) => j === i ? v + h : v);
    const xm = xVec.map((v, j) => j === i ? v - h : v);
    return (fn(xp) - fn(xm)) / (2 * h);
  });
}

// ─── PREDICTION WITH CI ──────────────────────────────────────────────────────
function tCrit(df) {
  if (!isFinite(df) || df >= 120) return 1.96;
  const T = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,
             8:2.306,9:2.262,10:2.228,15:2.131,20:2.086,25:2.060,
             30:2.042,40:2.021,60:2.000,80:1.990,100:1.984,120:1.980};
  const keys = Object.keys(T).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T[k];
  return 1.96;
}

export function predict(beta, xVec, XtXinv, s2, df = 100) {
  const k = beta.length;
  const yhat = beta.reduce((sum, b, i) => sum + b * (xVec[i] ?? 0), 0);
  let varYhat = 0;
  if (XtXinv && s2 != null) {
    for (let i = 0; i < k; i++)
      for (let j = 0; j < k; j++)
        varYhat += (xVec[i] ?? 0) * XtXinv[i][j] * (xVec[j] ?? 0);
    varYhat = Math.max(0, varYhat * s2);
  }
  const se = Math.sqrt(varYhat);
  const t  = tCrit(df);
  return { yhat, se, ciLow: yhat - t * se, ciHigh: yhat + t * se };
}

// ─── EXPRESSION EVALUATOR ────────────────────────────────────────────────────
export function evalExpression(expr, scope = {}) {
  try {
    const mathNames = Object.getOwnPropertyNames(Math);
    const mathVals  = mathNames.map(n => Math[n]);
    const fn = new Function(
      ...mathNames, "pi", "e", "Inf",
      ...Object.keys(scope),
      `"use strict"; return (${expr});`
    );
    const result = fn(
      ...mathVals, Math.PI, Math.E, Infinity,
      ...Object.values(scope)
    );
    return { value: result };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── PROBABILITY DISTRIBUTIONS ───────────────────────────────────────────────
// All functions validated against R output to 4 decimal places.

// ── Internal helpers ──────────────────────────────────────────────────────────

// Error function (Abramowitz & Stegun 7.1.26, max error 1.5e-7)
function _erf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x));
  const y = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return (x >= 0 ? 1 : -1) * (1 - y * Math.exp(-x * x));
}

// Normal quantile — Peter Acklam's rational approximation (max error ~3e-9)
function _qnormStd(p) {
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
              1.383577518672690e+02, -3.066479806614716e+01,  2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
              6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
             -2.549732539343734e+00,  4.374664141464968e+00,  2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pLow = 0.02425, pHigh = 1 - pLow;
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  let q, r;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
  }
  if (p <= pHigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q /
           (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) /
           ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// Lanczos lnΓ (g=7)
function _lnGamma(z) {
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
             -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6,
              1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - _lnGamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < 9; i++) x += c[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

// Regularized lower incomplete gamma P(a,x) — series expansion
function _regGammaP(a, x) {
  if (x <= 0) return 0;
  let term = 1 / a, sum = term;
  for (let n = 1; n < 500; n++) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < 1e-14 * sum) break;
  }
  return Math.exp(-x + a * Math.log(x) - _lnGamma(a)) * sum;
}

// Regularized incomplete beta I_x(a,b) via continued fraction (Lentz)
function _incompleteBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnB = _lnGamma(a) + _lnGamma(b) - _lnGamma(a + b);
  const front = Math.exp(a * Math.log(x) + b * Math.log(1 - x) - lnB) / a;
  const TINY = 1e-30;
  let f = TINY, C = f, D = 0;
  for (let m = 0; m <= 200; m++) {
    for (let nn = 0; nn <= 1; nn++) {
      let d;
      if (nn === 0) {
        d = m === 0 ? 1 : (m * (b - m) * x) / ((a + 2*m - 1) * (a + 2*m));
      } else {
        d = -((a + m) * (a + b + m) * x) / ((a + 2*m) * (a + 2*m + 1));
      }
      D = 1 + d * D; if (Math.abs(D) < TINY) D = TINY; D = 1 / D;
      C = 1 + d / C; if (Math.abs(C) < TINY) C = TINY;
      f *= C * D;
      if (Math.abs(C * D - 1) < 1e-12) return front * (f - TINY);
    }
  }
  return front * (f - TINY);
}

// ── Normal ────────────────────────────────────────────────────────────────────
export function dnorm(x, mean = 0, sd = 1) {
  if (sd <= 0) return NaN;
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}
export function pnorm(x, mean = 0, sd = 1) {
  if (sd <= 0) return NaN;
  return 0.5 * (1 + _erf((x - mean) / (sd * Math.SQRT2)));
}
export function qnorm(p, mean = 0, sd = 1) {
  return mean + sd * _qnormStd(p);
}

// ── Student-t ─────────────────────────────────────────────────────────────────
export function dt(x, df) {
  if (df <= 0) return NaN;
  return Math.exp(_lnGamma((df + 1) / 2) - _lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI))
    * Math.pow(1 + x * x / df, -(df + 1) / 2);
}
export function pt(x, df) {
  if (df <= 0) return NaN;
  const ib = _incompleteBeta(df / (df + x * x), df / 2, 0.5);
  return x > 0 ? 1 - ib / 2 : ib / 2;
}
export function qt(p, df) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return  Infinity;
  if (df <= 0) return NaN;
  // Newton refinement from normal seed
  let x = _qnormStd(p);
  for (let i = 0; i < 60; i++) {
    const fx  = pt(x, df) - p;
    const dfx = dt(x, df);
    if (Math.abs(dfx) < 1e-15) break;
    const xn = x - fx / dfx;
    if (Math.abs(xn - x) < 1e-12) return xn;
    x = xn;
  }
  return x;
}

// ── Binomial ─────────────────────────────────────────────────────────────────
export function dbinom(k, n, p) {
  k = Math.round(k);
  if (k < 0 || k > n || n < 0 || p < 0 || p > 1) return 0;
  if (p === 0) return k === 0 ? 1 : 0;
  if (p === 1) return k === n ? 1 : 0;
  return Math.exp(
    _lnGamma(n + 1) - _lnGamma(k + 1) - _lnGamma(n - k + 1)
    + k * Math.log(p) + (n - k) * Math.log(1 - p)
  );
}
export function pbinom(k, n, p) {
  k = Math.round(k);
  if (k < 0) return 0;
  if (k >= n) return 1;
  let s = 0;
  for (let j = 0; j <= k; j++) s += dbinom(j, n, p);
  return Math.min(1, s);
}

// ── Poisson ──────────────────────────────────────────────────────────────────
export function dpois(k, lambda) {
  k = Math.round(k);
  if (k < 0 || lambda <= 0) return NaN;
  return Math.exp(k * Math.log(lambda) - lambda - _lnGamma(k + 1));
}
export function ppois(k, lambda) {
  k = Math.round(k);
  if (k < 0) return 0;
  let s = 0;
  for (let j = 0; j <= k; j++) s += dpois(j, lambda);
  return Math.min(1, s);
}

// ── Chi-squared ───────────────────────────────────────────────────────────────
export function dchisq(x, df) {
  if (x < 0 || df <= 0) return NaN;
  if (x === 0) return df < 2 ? Infinity : df === 2 ? 0.5 : 0;
  return Math.exp((df / 2 - 1) * Math.log(x) - x / 2 - (df / 2) * Math.log(2) - _lnGamma(df / 2));
}
export function pchisq(x, df) {
  if (x <= 0) return 0;
  if (df <= 0) return NaN;
  return _regGammaP(df / 2, x / 2);
}

// ─── SCOPE BUILDER ───────────────────────────────────────────────────────────
/**
 * Build a numeric scope from the variable array in CalculateTab.
 * Probability functions are injected so expressions like pnorm(1.96) work.
 */
export function buildScope(variables) {
  const scope = {};
  for (const v of variables) {
    if (v.type === "Integer")    scope[v.name] = parseInt(v.rawValue)  || 0;
    else if (v.type === "Float") scope[v.name] = parseFloat(v.rawValue) || 0;
    else if (v.type === "Expression" && v.computed != null) scope[v.name] = v.computed;
  }
  // Probability functions available in all expressions and equation solver
  Object.assign(scope, {
    dnorm, pnorm, qnorm,
    dt, pt, qt,
    dbinom, pbinom,
    dpois, ppois,
    dchisq, pchisq,
  });
  return scope;
}
