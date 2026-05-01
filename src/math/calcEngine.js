// ─── ECON STUDIO · src/math/calcEngine.js ────────────────────────────────────
// Pure-JS math utilities for the Calculate tab.
// No React. No side effects. No external imports.
//
// Exports:
//   solveRoot(fn, a, b, tol, maxIter)  — Brent's method (bracketed root)
//   derivative(fn, x, h)               — central-difference first derivative
//   nthDerivative(fn, x, n, h)         — recursive higher-order derivative
//   gradient(fn, xVec, h)              — multivariate partial derivatives
//   predict(beta, xVec, XtXinv, s2, df) — ŷ ± 95% CI

// ─── BRENT'S METHOD ──────────────────────────────────────────────────────────
/**
 * Find a root of fn in [a, b] using Brent's method (bisection + secant + IQI).
 * Requires f(a) and f(b) to have opposite signs.
 *
 * @returns {{ root: number, iter: number, converged: boolean } | { error: string }}
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
        p = 2 * xm * s;
        q = 1 - s;
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

// ─── NUMERICAL DERIVATIVES ───────────────────────────────────────────────────

/**
 * First derivative via central difference: f'(x) ≈ (f(x+h) - f(x-h)) / 2h
 */
export function derivative(fn, x, h = 1e-6) {
  return (fn(x + h) - fn(x - h)) / (2 * h);
}

/**
 * nth derivative via recursive central differences.
 */
export function nthDerivative(fn, x, n, h = 1e-4) {
  if (n === 0) return fn(x);
  if (n === 1) return derivative(fn, x, h);
  const f1 = gx => nthDerivative(fn, gx, n - 1, h);
  return (f1(x + h) - f1(x - h)) / (2 * h);
}

/**
 * Multivariate gradient: returns [∂f/∂x₁, ∂f/∂x₂, …] at xVec.
 * fn accepts an array of values.
 */
export function gradient(fn, xVec, h = 1e-6) {
  return xVec.map((_, i) => {
    const xp = xVec.map((v, j) => j === i ? v + h : v);
    const xm = xVec.map((v, j) => j === i ? v - h : v);
    return (fn(xp) - fn(xm)) / (2 * h);
  });
}

// ─── PREDICTION WITH CI ──────────────────────────────────────────────────────

/** t critical value at α = 0.025 (two-tailed 95% CI). */
function tCrit(df) {
  if (!isFinite(df) || df >= 120) return 1.96;
  const T = {1:12.706,2:4.303,3:3.182,4:2.776,5:2.571,6:2.447,7:2.365,
             8:2.306,9:2.262,10:2.228,15:2.131,20:2.086,25:2.060,
             30:2.042,40:2.021,60:2.000,80:1.990,100:1.984,120:1.980};
  const keys = Object.keys(T).map(Number).sort((a, b) => a - b);
  for (const k of keys) if (df <= k) return T[k];
  return 1.96;
}

/**
 * Predict ŷ and 95% CI given model parameters.
 *
 * @param {number[]}   beta    — coefficient vector (length k), intercept first
 * @param {number[]}   xVec    — input vector (length k), first element = 1 for intercept
 * @param {number[][]} XtXinv  — (X'X)^{-1} or (X'WX)^{-1}, shape k×k (can be null)
 * @param {number}     s2      — σ² = SSR / df (can be null)
 * @param {number}     df      — residual degrees of freedom
 * @returns {{ yhat, se, ciLow, ciHigh }}
 */
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
/**
 * Evaluate a user-written math expression string with named variables in scope.
 * Injects all Math.* methods as top-level names (sqrt, log, exp, abs, etc.)
 * and physical constants (pi, e, Inf).
 *
 * @param {string} expr    — JS-compatible expression, e.g. "2*alpha + sqrt(beta)"
 * @param {Object} scope   — { varName: value, … }
 * @returns {{ value: number|string } | { error: string }}
 */
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

/**
 * Build a numeric scope from the variable array in CalculateTab.
 * Only Integer, Float, and evaluated Expression vars are included.
 */
export function buildScope(variables) {
  const scope = {};
  for (const v of variables) {
    if (v.type === "Integer") scope[v.name] = parseInt(v.rawValue) || 0;
    else if (v.type === "Float")   scope[v.name] = parseFloat(v.rawValue) || 0;
    else if (v.type === "Expression" && v.computed != null) scope[v.name] = v.computed;
  }
  return scope;
}
