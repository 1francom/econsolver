// ECON STUDIO - SpatialRegressionEngine.js
// Pure JS spatial econometrics. No React, no UI imports.
//
// Estimation choice:
//   SLX is OLS on [X, WX].
//   SAR, SEM, and SDM use concentrated maximum likelihood with a 1-D
//   golden-section search over rho/lambda. This keeps the browser-only engine
//   compact and consumes the sparse W triples produced by SpatialEngine.

import { matInv, matMul, pValue, runOLS, transpose } from "./LinearEngine.js";

const TWO_PI = 2 * Math.PI;
const RHO_MIN = -0.98;
const RHO_MAX = 0.98;

function normalizeWeightsInput(W) {
  if (Array.isArray(W)) return W;
  if (Array.isArray(W?.weights)) return W.weights;
  return [];
}

function inferN(W, fallbackN) {
  if (Number.isFinite(W?.summary?.n)) return W.summary.n;
  if (Array.isArray(W?.ids)) return W.ids.length;
  const triples = normalizeWeightsInput(W);
  const mx = triples.reduce((m, t) => Math.max(m, Number(t.i) || 0, Number(t.j) || 0), -1);
  return Math.max(fallbackN ?? 0, mx + 1);
}

function denseW(W, n) {
  const M = Array.from({ length: n }, () => Array(n).fill(0));
  for (const t of normalizeWeightsInput(W)) {
    const i = Number(t.i), j = Number(t.j), w = Number(t.w);
    if (Number.isInteger(i) && Number.isInteger(j) && i >= 0 && i < n && j >= 0 && j < n && Number.isFinite(w)) {
      M[i][j] += w;
    }
  }
  return M;
}

function matVec(A, v) {
  return A.map(row => row.reduce((s, a, j) => s + a * v[j], 0));
}

function lagMatrix(Wd, X) {
  if (!X.length) return [];
  const p = X[0].length;
  const cols = Array.from({ length: p }, (_, j) => matVec(Wd, X.map(r => r[j])));
  return X.map((_, i) => cols.map(c => c[i]));
}

function design(X, includeIntercept = true) {
  return X.map(r => includeIntercept ? [1, ...r] : [...r]);
}

function olsArray(Y, X, varNames) {
  const Xt = transpose(X);
  const XtXinv = matInv(matMul(Xt, X));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, Y.map(v => [v]))).map(r => r[0]);
  const Yhat = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const resid = Y.map((y, i) => y - Yhat[i]);
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const n = Y.length;
  const k = X[0]?.length ?? 0;
  const df = n - k;
  const s2 = SSR / Math.max(1, df);
  const meanY = Y.reduce((s, v) => s + v, 0) / Math.max(1, n);
  const SST = Y.reduce((s, v) => s + (v - meanY) ** 2, 0);
  const R2 = SST > 0 ? 1 - SSR / SST : 0;
  const adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, df);
  const se = XtXinv.map((row, i) => Math.sqrt(Math.max(0, row[i] * s2)));
  const tStats = beta.map((b, i) => b / (se[i] || NaN));
  const pVals = tStats.map(t => pValue(t, df));
  return { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat, varNames, XtXinv };
}

function logAbsDet(A) {
  const n = A.length;
  const M = A.map(r => [...r]);
  let logAbs = 0;
  let sign = 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    const pv = M[piv][col];
    if (!Number.isFinite(pv) || Math.abs(pv) < 1e-12) return { logAbs: -Infinity, sign: 0 };
    if (piv !== col) {
      [M[piv], M[col]] = [M[col], M[piv]];
      sign *= -1;
    }
    if (M[col][col] < 0) sign *= -1;
    logAbs += Math.log(Math.abs(M[col][col]));
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c < n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return { logAbs, sign };
}

function logDetIminus(Wd, rho) {
  const A = Wd.map((row, i) => row.map((w, j) => (i === j ? 1 : 0) - rho * w));
  const d = logAbsDet(A);
  return d.sign > 0 ? d.logAbs : -Infinity;
}

function goldenMax(fn, lo = RHO_MIN, hi = RHO_MAX, tol = 1e-6, maxIter = 120) {
  const gr = (Math.sqrt(5) - 1) / 2;
  let a = lo, b = hi;
  let c = b - gr * (b - a);
  let d = a + gr * (b - a);
  let fc = fn(c), fd = fn(d);
  for (let iter = 0; iter < maxIter && Math.abs(b - a) > tol; iter++) {
    if (fc < fd) {
      a = c; c = d; fc = fd;
      d = a + gr * (b - a); fd = fn(d);
    } else {
      b = d; d = c; fd = fc;
      c = b - gr * (b - a); fc = fn(c);
    }
  }
  const x = (a + b) / 2;
  return { x, value: fn(x) };
}

function secondDerivative(fn, x) {
  const h = 1e-4;
  const f0 = fn(x);
  const fp = fn(Math.min(RHO_MAX, x + h));
  const fm = fn(Math.max(RHO_MIN, x - h));
  return (fp - 2 * f0 + fm) / (h * h);
}

function normalCDF(x) {
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * z);
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429;
  const erf = sign * (1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z));
  return 0.5 * (1 + erf);
}

function zPval(z) {
  return 2 * (1 - normalCDF(Math.abs(z)));
}

function augmentedX(X, Wd, model) {
  if (model === "SDM" || model === "SLX") {
    const WX = lagMatrix(Wd, X);
    return X.map((r, i) => [...r, ...WX[i]]);
  }
  return X;
}

function augmentedNames(varNames, model) {
  if (model === "SDM" || model === "SLX") return [...varNames, ...varNames.map(v => `W:${v}`)];
  return varNames;
}

function concentratedSpatial({ Y, Xraw, Wd, varNames, model }) {
  const n = Y.length;
  const Wy = matVec(Wd, Y);
  const XaugRaw = augmentedX(Xraw, Wd, model);
  const Xaug = design(XaugRaw, true);
  const names = ["(Intercept)", ...augmentedNames(varNames, model)];

  const evalAt = rho => {
    const ld = logDetIminus(Wd, rho);
    if (!Number.isFinite(ld)) return null;
    const yStar = Y.map((y, i) => y - rho * Wy[i]);
    const fit = olsArray(yStar, Xaug, names);
    if (!fit || fit.SSR <= 0) return null;
    const sigma2 = fit.SSR / n;
    const logLik = ld - (n / 2) * (Math.log(TWO_PI * sigma2) + 1);
    return { rho, logLik, fit, sigma2 };
  };

  const objective = rho => evalAt(rho)?.logLik ?? -Infinity;
  const opt = goldenMax(objective);
  const best = evalAt(opt.x);
  if (!best) return { error: `${model} failed: spatial likelihood could not be evaluated.` };

  const rho = best.rho;
  const beta = best.fit.beta;
  const seBeta = best.fit.XtXinv.map((row, i) => Math.sqrt(Math.max(0, row[i] * best.sigma2)));
  const info = -secondDerivative(objective, rho);
  const seRho = info > 0 ? Math.sqrt(1 / info) : NaN;
  const yhat = Xaug.map((row, i) => row.reduce((s, v, j) => s + v * beta[j], 0) + rho * Wy[i]);
  const resid = Y.map((y, i) => y - yhat[i]);
  const meanY = Y.reduce((s, v) => s + v, 0) / n;
  const SST = Y.reduce((s, v) => s + (v - meanY) ** 2, 0);
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const k = beta.length + 1;
  const outBeta = [rho, ...beta];
  const outSe = [seRho, ...seBeta];
  return {
    model,
    spatialParam: "rho",
    rho,
    beta: outBeta,
    se: outSe,
    zStats: outBeta.map((b, i) => b / (outSe[i] || NaN)),
    pVals: outBeta.map((b, i) => zPval(b / (outSe[i] || NaN))),
    varNames: ["rho", ...names],
    R2: SST > 0 ? 1 - SSR / SST : 0,
    adjR2: 1 - (1 - (SST > 0 ? 1 - SSR / SST : 0)) * (n - 1) / Math.max(1, n - k),
    n,
    df: n - k,
    SSR,
    s2: SSR / Math.max(1, n - k),
    resid,
    Yhat: yhat,
    logLik: best.logLik,
    AIC: 2 * k - 2 * best.logLik,
    BIC: Math.log(n) * k - 2 * best.logLik,
  };
}

function concentratedSEM({ Y, Xraw, Wd, varNames }) {
  const n = Y.length;
  const X = design(Xraw, true);
  const names = ["(Intercept)", ...varNames];
  const Wy = matVec(Wd, Y);
  const WXcols = lagMatrix(Wd, X);

  const evalAt = lambda => {
    const ld = logDetIminus(Wd, lambda);
    if (!Number.isFinite(ld)) return null;
    const yStar = Y.map((y, i) => y - lambda * Wy[i]);
    const xStar = X.map((row, i) => row.map((v, j) => v - lambda * WXcols[i][j]));
    const fit = olsArray(yStar, xStar, names);
    if (!fit || fit.SSR <= 0) return null;
    const sigma2 = fit.SSR / n;
    const logLik = ld - (n / 2) * (Math.log(TWO_PI * sigma2) + 1);
    return { lambda, logLik, fit, sigma2 };
  };

  const objective = lambda => evalAt(lambda)?.logLik ?? -Infinity;
  const opt = goldenMax(objective);
  const best = evalAt(opt.x);
  if (!best) return { error: "SEM failed: spatial likelihood could not be evaluated." };

  const lambda = best.lambda;
  const beta = best.fit.beta;
  const seBeta = best.fit.XtXinv.map((row, i) => Math.sqrt(Math.max(0, row[i] * best.sigma2)));
  const info = -secondDerivative(objective, lambda);
  const seLambda = info > 0 ? Math.sqrt(1 / info) : NaN;
  const yhat = X.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = Y.map((y, i) => y - yhat[i]);
  const meanY = Y.reduce((s, v) => s + v, 0) / n;
  const SST = Y.reduce((s, v) => s + (v - meanY) ** 2, 0);
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const k = beta.length + 1;
  const outBeta = [lambda, ...beta];
  const outSe = [seLambda, ...seBeta];
  return {
    model: "SEM",
    spatialParam: "lambda",
    lambda,
    beta: outBeta,
    se: outSe,
    zStats: outBeta.map((b, i) => b / (outSe[i] || NaN)),
    pVals: outBeta.map((b, i) => zPval(b / (outSe[i] || NaN))),
    varNames: ["lambda", ...names],
    R2: SST > 0 ? 1 - SSR / SST : 0,
    adjR2: 1 - (1 - (SST > 0 ? 1 - SSR / SST : 0)) * (n - 1) / Math.max(1, n - k),
    n,
    df: n - k,
    SSR,
    s2: SSR / Math.max(1, n - k),
    resid,
    Yhat: yhat,
    logLik: best.logLik,
    AIC: 2 * k - 2 * best.logLik,
    BIC: Math.log(n) * k - 2 * best.logLik,
  };
}

function validateInput({ y, X, varNames, W }) {
  if (!Array.isArray(y) || !Array.isArray(X) || y.length !== X.length) {
    return "Spatial regression requires y and X arrays with matching row counts.";
  }
  if (!y.length) return "Spatial regression requires at least one valid observation.";
  if (!X.every(r => Array.isArray(r) && r.length === (varNames?.length ?? 0))) {
    return "Spatial regression X rows must match varNames.";
  }
  const nW = inferN(W, y.length);
  if (nW !== y.length) return `Spatial weights size (${nW}) must match model rows (${y.length}).`;
  if (!normalizeWeightsInput(W).length) return "Spatial regression requires at least one spatial weight link.";
  return null;
}

export function runSpatialRegression({
  y,
  X,
  varNames = [],
  W,
  model = "SAR",
  seType = "classical",
} = {}) {
  const cleanModel = String(model ?? "SAR").toUpperCase();
  const err = validateInput({ y, X, varNames, W });
  if (err) return { error: err };
  const n = y.length;
  const Y = y.map(Number);
  const Xraw = X.map(r => r.map(Number));
  if (!Y.every(Number.isFinite) || !Xraw.every(r => r.every(Number.isFinite))) {
    return { error: "Spatial regression inputs must be finite numeric values." };
  }
  const Wd = denseW(W, n);
  const warnings = [];
  if (seType && seType !== "classical" && cleanModel !== "SLX") {
    warnings.push(`${cleanModel} currently reports ML classical standard errors; requested seType '${seType}' was recorded but not applied.`);
  }

  if (cleanModel === "SLX") {
    const WX = lagMatrix(Wd, Xraw);
    const slxRows = Y.map((yy, i) => {
      const row = { __y: yy };
      varNames.forEach((name, j) => { row[name] = Xraw[i][j]; row[`W:${name}`] = WX[i][j]; });
      return row;
    });
    const slxVars = [...varNames, ...varNames.map(v => `W:${v}`)];
    const res = runOLS(slxRows, "__y", slxVars, { seType });
    return res ? { ...res, model: "SLX", spatialParam: null, weightsSummary: W?.summary ?? null, warnings } : { error: "SLX failed: singular design matrix or insufficient data." };
  }

  let res;
  if (cleanModel === "SEM") {
    res = concentratedSEM({ Y, Xraw, Wd, varNames });
  } else if (cleanModel === "SAR" || cleanModel === "SDM") {
    res = concentratedSpatial({ Y, Xraw, Wd, varNames, model: cleanModel });
  } else {
    return { error: `Unsupported spatial regression model: ${model}` };
  }
  if (res?.error) return res;
  return { ...res, weightsSummary: W?.summary ?? null, warnings };
}

export function runSpatialRegressionFromRows(rows, yCol, xCols, W, options = {}) {
  const valid = rows
    .map((r, originalIndex) => ({ r, originalIndex }))
    .filter(({ r }) =>
      typeof r[yCol] === "number" && Number.isFinite(r[yCol]) &&
      xCols.every(c => typeof r[c] === "number" && Number.isFinite(r[c]))
    );
  if (valid.length !== rows.length) {
    return { error: "Spatial regression requires complete Y/X rows because W row order must match the estimation sample." };
  }
  return runSpatialRegression({
    y: valid.map(({ r }) => r[yCol]),
    X: valid.map(({ r }) => xCols.map(c => r[c])),
    varNames: xCols,
    W,
    model: options.model ?? "SAR",
    seType: options.seType ?? "classical",
  });
}
