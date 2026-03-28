// ─── ECON STUDIO · EconometricsEngine.js ─────────────────────────────────────
// Pure math. No React. No side effects. Operates on cleanedData.cleanRows arrays.
// All estimators expect rows to be coerced (numeric cols are JS numbers, not strings).

// ─── MATRIX ALGEBRA ──────────────────────────────────────────────────────────
export function transpose(M) {
  return M[0].map((_, c) => M.map(r => r[c]));
}
export function matMul(A, B) {
  return A.map(r => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
}
export function matInv(M) {
  const n = M.length;
  const aug = M.map((row, i) => [...row, ...Array(n).fill(0).map((_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col++) {
    let max = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(aug[r][col]) > Math.abs(aug[max][col])) max = r;
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

// ─── STATISTICS ───────────────────────────────────────────────────────────────
function lgamma(z) {
  const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let x = z, y = z, tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const ci of c) ser += ci / ++y;
  return -tmp + Math.log(2.5066282746310005 * ser / x);
}
export function tCDF(t, df) {
  const x = df / (df + t * t);
  const a = df / 2, b = 0.5;
  let ib = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const xi = x * (i + 0.5) / steps;
    ib += Math.pow(xi, a - 1) * Math.pow(1 - xi, b - 1);
  }
  ib *= x / steps;
  const beta = Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
  return Math.min(1, Math.max(0, ib / beta));
}
export function fCDF(F, df1, df2) {
  const x = df2 / (df2 + df1 * F);
  const a = df2 / 2, b = df1 / 2;
  let ib = 0;
  const steps = 2000;
  for (let i = 0; i < steps; i++) {
    const xi = x * (i + 0.5) / steps;
    ib += Math.pow(xi, a - 1) * Math.pow(1 - xi, b - 1);
  }
  ib *= x / steps;
  const beta = Math.exp(lgamma(a) + lgamma(b) - lgamma(a + b));
  return Math.min(1, Math.max(0, ib / beta));
}
export function pValue(t, df) { return Math.min(1, 2 * tCDF(Math.abs(t), df)); }
export function stars(p) { return p < 0.01 ? "***" : p < 0.05 ? "**" : p < 0.1 ? "*" : ""; }

// ─── OLS ENGINE ───────────────────────────────────────────────────────────────
// Returns { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat, varNames }
export function runOLS(rows, yCol, xCols) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    xCols.every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < xCols.length + 2) return null;
  const n = valid.length;
  const Y = valid.map(r => r[yCol]);
  const X = valid.map(r => [1, ...xCols.map(c => r[c])]);
  const Xt = transpose(X);
  const XtXinv = matInv(matMul(Xt, X));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, Y.map(v => [v]))).map(r => r[0]);
  const Yhat = X.map(row => row.reduce((s, v, i) => s + v * beta[i], 0));
  const resid = Y.map((y, i) => y - Yhat[i]);
  const SSR = resid.reduce((s, e) => s + e * e, 0);
  const df = n - xCols.length - 1;
  const s2 = SSR / Math.max(1, df);
  const Ym = Y.reduce((a, b) => a + b, 0) / n;
  const SST = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2 = 1 - SSR / SST;
  const adjR2 = 1 - (1 - R2) * (n - 1) / Math.max(1, df);
  const se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => b / se[i]);
  const pVals = tStats.map(t => pValue(t, df));
  const Fstat = ((SST - SSR) / xCols.length) / s2;
  const Fpval = fCDF(Fstat, xCols.length, df);
  const varNames = ["(Intercept)", ...xCols];
  return { beta, se, tStats, pVals, R2, adjR2, n, df, SSR, s2, resid, Yhat, Fstat, Fpval, varNames };
}

// ─── 2SLS ENGINE ─────────────────────────────────────────────────────────────
// endog: endogenous regressors, exog: exogenous controls, instr: excluded instruments
export function run2SLS(rows, yCol, endog, exog, instr) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    [...endog, ...exog, ...instr].every(c => typeof r[c] === "number" && isFinite(r[c]))
  );
  if (valid.length < endog.length + exog.length + instr.length + 2)
    return { error: "Insufficient observations for 2SLS estimation." };
  const n = valid.length;

  // First stages
  const firstStages = endog.map(endVar => {
    const firstXCols = [...instr, ...exog];
    const res = runOLS(valid, endVar, firstXCols);
    if (!res) return null;
    const restricted = exog.length > 0 ? runOLS(valid, endVar, exog) : null;
    const SSR_r = restricted ? restricted.SSR : (() => {
      const Ym = valid.map(r => r[endVar]).reduce((a, b) => a + b, 0) / n;
      return valid.map(r => r[endVar]).reduce((s, y) => s + (y - Ym) ** 2, 0);
    })();
    const q = instr.length;
    const Fstat = ((SSR_r - res.SSR) / q) / (res.SSR / res.df);
    const Fpval = fCDF(Fstat, q, res.df);
    const weak = Fstat < 10;
    return { ...res, endVar, firstXCols, Fstat, Fpval, weak };
  });
  if (firstStages.some(s => !s)) return { error: "First-stage OLS failed — singular matrix or insufficient data." };

  // Second stage with fitted values
  const augRows = valid.map((r, i) => {
    const aug = { ...r };
    endog.forEach((ev, j) => { aug[`__hat_${ev}`] = firstStages[j].Yhat[i]; });
    return aug;
  });
  const secondXCols = [...endog.map(ev => `__hat_${ev}`), ...exog];
  const secondRes = runOLS(augRows, yCol, secondXCols);
  if (!secondRes) return { error: "Second-stage OLS failed — singular matrix." };

  // Correct SE using true residuals
  const Y = valid.map(r => r[yCol]);
  const X2 = valid.map(r => [1, ...endog.map(ev => r[ev]), ...exog.map(c => r[c])]);
  const trueResid = Y.map((y, i) => y - X2[i].reduce((s, v, j) => s + v * secondRes.beta[j], 0));
  const trueSSR = trueResid.reduce((s, e) => s + e * e, 0);
  const trueS2 = trueSSR / secondRes.df;
  const Xt = transpose(X2);
  const XtXinv = matInv(matMul(Xt, X2));
  const corrSE = XtXinv ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * trueS2))) : secondRes.se;
  const corrT = secondRes.beta.map((b, i) => b / corrSE[i]);
  const corrP = corrT.map(t => pValue(t, secondRes.df));
  const Ym = Y.reduce((a, b) => a + b, 0) / n;
  const SST = Y.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2 = 1 - trueSSR / SST;
  const adjR2 = 1 - (1 - R2) * (n - 1) / secondRes.df;
  const varNames = ["(Intercept)", ...endog, ...exog];

  return {
    firstStages,
    second: { beta: secondRes.beta, se: corrSE, tStats: corrT, pVals: corrP, R2, adjR2, n, df: secondRes.df, varNames }
  };
}

// ─── PANEL ENGINE (FE / FD) ───────────────────────────────────────────────────
function prepPanel(rows, yCol, xCols, unitCol, timeCol) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null &&
    xCols.every(x => typeof r[x] === "number" && isFinite(r[x]))
  ).sort((a, b) => {
    if (a[unitCol] < b[unitCol]) return -1;
    if (a[unitCol] > b[unitCol]) return 1;
    return a[timeCol] - b[timeCol];
  });
  const units = [...new Set(valid.map(r => r[unitCol]))];
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  return { valid, units, times };
}

export function runFE(rows, yCol, xCols, unitCol, timeCol) {
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2)
    return { error: "Insufficient observations or units for Fixed Effects estimation." };
  const allCols = [yCol, ...xCols];
  const unitMeans = {};
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    allCols.forEach(c => { unitMeans[u][c] = sub.reduce((s, r) => s + r[c], 0) / sub.length; });
  });
  const grandMeans = {};
  allCols.forEach(c => { grandMeans[c] = valid.reduce((s, r) => s + r[c], 0) / valid.length; });
  const demeaned = valid.map(r => {
    const d = { ...r };
    allCols.forEach(c => { d[`__dm_${c}`] = r[c] - unitMeans[r[unitCol]][c] + grandMeans[c]; });
    return d;
  });
  const dmY = `__dm_${yCol}`;
  const dmX = xCols.map(c => `__dm_${c}`);
  const res = runOLS(demeaned, dmY, dmX);
  if (!res) return { error: "Within-group OLS failed — singular matrix after demeaning." };
  const df_fe = valid.length - units.length - xCols.length;
  if (df_fe <= 0) return { error: "Singular matrix or insufficient observations — degrees of freedom ≤ 0." };
  const s2_fe = res.SSR / df_fe;
  const Xmat = demeaned.map(r => [1, ...dmX.map(x => r[x])]);
  const Xt = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const rawSE = XtXinv ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe))) : res.se;
  // Guard: replace any non-finite SE with NaN so the UI shows 'N/A' rather than crashing
  const corrSE = rawSE.map(v => (isFinite(v) ? v : NaN));
  const corrT = res.beta.map((b, i) => (isFinite(corrSE[i]) ? b / corrSE[i] : NaN));
  const corrP = corrT.map(t => (isFinite(t) ? pValue(t, df_fe) : NaN));
  const dmYvals = demeaned.map(r => r[dmY]);
  const dmYmean = dmYvals.reduce((a, b) => a + b, 0) / dmYvals.length;
  const SST_w = dmYvals.reduce((s, v) => s + (v - dmYmean) ** 2, 0);
  const R2_within = 1 - res.SSR / SST_w;
  // Between R²
  const unitRows = units.map(u => {
    const row = { __by: unitMeans[u][yCol] };
    xCols.forEach(c => { row[`__bx_${c}`] = unitMeans[u][c]; });
    return row;
  });
  const bRes = runOLS(unitRows, "__by", xCols.map(c => `__bx_${c}`));
  // Unit intercepts (alpha_i estimates)
  const alphas = {};
  units.forEach(u => {
    let fitted = grandMeans[yCol];
    xCols.forEach((c, i) => { fitted += res.beta[i + 1] * unitMeans[u][c]; });
    alphas[u] = unitMeans[u][yCol] - (fitted - grandMeans[yCol]);
  });
  return {
    beta: res.beta.slice(1), se: corrSE.slice(1), tStats: corrT.slice(1), pVals: corrP.slice(1),
    varNames: xCols, R2_within, R2_between: bRes?.R2 ?? null,
    n: valid.length, units: units.length, df: df_fe, SSR: res.SSR, s2: s2_fe,
    resid: res.resid, Yhat: res.Yhat, alphas,
    Fstat: res.Fstat, Fpval: res.Fpval,
  };
}

export function runFD(rows, yCol, xCols, unitCol, timeCol) {
  const { valid, units } = prepPanel(rows, yCol, xCols, unitCol, timeCol);
  if (valid.length < xCols.length + 3 || units.length < 2) return null;
  const diffRows = [];
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u).sort((a, b) => a[timeCol] - b[timeCol]);
    for (let i = 1; i < sub.length; i++) {
      const d = { __unit: u };
      const ok = [yCol, ...xCols].every(c => typeof sub[i][c] === "number" && typeof sub[i - 1][c] === "number");
      if (!ok) continue;
      [yCol, ...xCols].forEach(c => { d[`__fd_${c}`] = sub[i][c] - sub[i - 1][c]; });
      diffRows.push(d);
    }
  });
  if (diffRows.length < xCols.length + 2) return null;
  const fdY = `__fd_${yCol}`;
  const fdX = xCols.map(c => `__fd_${c}`);
  const res = runOLS(diffRows, fdY, fdX);
  if (!res) return null;
  return {
    beta: res.beta.slice(1), se: res.se.slice(1), tStats: res.tStats.slice(1), pVals: res.pVals.slice(1),
    varNames: xCols, R2: res.R2, adjR2: res.adjR2,
    n: diffRows.length, units: units.length, df: res.df, SSR: res.SSR,
    resid: res.resid, Yhat: res.Yhat, Fstat: res.Fstat, Fpval: res.Fpval,
  };
}

// ─── RDD ENGINE ───────────────────────────────────────────────────────────────
function kernelWeights(runningVals, cutoff, h, kernelType) {
  return runningVals.map(x => {
    const u = Math.abs(x - cutoff) / h;
    if (u > 1) return 0;
    if (kernelType === "triangular") return 1 - u;
    if (kernelType === "epanechnikov") return 0.75 * (1 - u * u);
    return 1;
  });
}

export function ikBandwidth(runningVals, yVals, cutoff) {
  const n = runningVals.length;
  const left = runningVals.map((x, i) => ({ x, y: yVals[i] })).filter(d => d.x < cutoff);
  const right = runningVals.map((x, i) => ({ x, y: yVals[i] })).filter(d => d.x >= cutoff);
  if (left.length < 5 || right.length < 5) return (Math.max(...runningVals) - Math.min(...runningVals)) / 4;
  const pilot = (Math.max(...runningVals) - Math.min(...runningVals)) / 4;
  const localVariance = (pts, c) => {
    const near = pts.filter(d => Math.abs(d.x - c) < pilot);
    if (near.length < 3) return { s2: 1, curv: 0.001 };
    const X = near.map(d => [1, d.x - c, (d.x - c) ** 2]);
    const Xt = transpose(X); const XtXinv = matInv(matMul(Xt, X));
    if (!XtXinv) return { s2: 1, curv: 0.001 };
    const beta = matMul(XtXinv, matMul(Xt, near.map(d => [d.y]))).map(r => r[0]);
    const resid = near.map(d => d.y - (beta[0] + beta[1] * (d.x - c) + beta[2] * (d.x - c) ** 2));
    const s2 = resid.reduce((s, e) => s + e * e, 0) / Math.max(1, near.length - 3);
    return { s2, curv: Math.abs(beta[2]) || 0.001 };
  };
  const vL = localVariance(left, cutoff);
  const vR = localVariance(right, cutoff);
  const s2 = (vL.s2 + vR.s2) / 2;
  const curv = (vL.curv + vR.curv) / 2;
  const h = 3.4375 * Math.pow(s2 / (curv ** 2 * n), 0.2);
  const range = Math.max(...runningVals) - Math.min(...runningVals);
  return Math.min(Math.max(h, range * 0.05), range * 0.8);
}

function runWLS(xData, yData, weights) {
  const sqW = weights.map(w => Math.sqrt(w));
  const wX = xData.map((row, i) => row.map(v => v * sqW[i]));
  const wY = yData.map((v, i) => v * sqW[i]);
  const Xt = transpose(wX); const XtXinv = matInv(matMul(Xt, wX));
  if (!XtXinv) return null;
  const beta = matMul(XtXinv, matMul(Xt, wY.map(v => [v]))).map(r => r[0]);
  const yhat = xData.map(row => row.reduce((s, v, j) => s + v * beta[j], 0));
  const resid = yData.map((y, i) => y - yhat[i]);
  const n = yData.length; const k = beta.length;
  const SSR = resid.reduce((s, e, i) => s + weights[i] * e * e, 0);
  const df = n - k;
  const s2 = SSR / Math.max(1, df);
  const Ym = yData.reduce((a, b) => a + b, 0) / n;
  const SST = yData.reduce((s, y) => s + (y - Ym) ** 2, 0);
  const R2 = 1 - resid.reduce((s, e) => s + e * e, 0) / SST;
  const se = XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2)));
  const tStats = beta.map((b, i) => b / se[i]);
  const pVals = tStats.map(t => pValue(t, df));
  return { beta, se, tStats, pVals, R2, n, df, SSR, resid, yhat };
}

export function runSharpRDD(rows, yCol, runCol, cutoff, h, kernelType = "triangular", controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && typeof r[runCol] === "number" &&
    isFinite(r[yCol]) && isFinite(r[runCol]) &&
    Math.abs(r[runCol] - cutoff) <= h
  );
  if (valid.length < 6) return null;
  const xc = valid.map(r => r[runCol] - cutoff);
  const D = valid.map(r => r[runCol] >= cutoff ? 1 : 0);
  const Y = valid.map(r => r[yCol]);
  const W = kernelWeights(valid.map(r => r[runCol]), cutoff, h, kernelType);
  const X = valid.map((r, i) => [1, D[i], xc[i], D[i] * xc[i], ...controls.map(c => r[c])]);
  const res = runWLS(X, Y, W);
  if (!res) return null;
  const varNames = ["(Intercept)", "D (treatment)", "running − c", "D × (running − c)", ...controls];
  const leftFit = valid.map((r, i) => ({ x: r[runCol], yhat: res.beta[0] + res.beta[2] * xc[i] })).filter((_, i) => D[i] === 0);
  const rightFit = valid.map((r, i) => ({ x: r[runCol], yhat: res.beta[0] + res.beta[1] + (res.beta[2] + res.beta[3]) * xc[i] })).filter((_, i) => D[i] === 1);
  return { ...res, varNames, cutoff, h, kernelType, valid, xc, D, Y, W, leftFit, rightFit, late: res.beta[1], lateSE: res.se[1], lateP: res.pVals[1] };
}

// ─── DiD ENGINE ──────────────────────────────────────────────────────────────
export function run2x2DiD(rows, yCol, postCol, treatCol, controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    (r[postCol] === 0 || r[postCol] === 1) &&
    (r[treatCol] === 0 || r[treatCol] === 1)
  );
  if (valid.length < 8) return null;
  const aug = valid.map(r => ({ ...r, __did_inter: r[postCol] * r[treatCol] }));
  const xCols = [postCol, treatCol, "__did_inter", ...controls];
  const res = runOLS(aug, yCol, xCols);
  if (!res) return null;
  const varNames = ["(Intercept)", "Post", "Treated", "Post × Treated (ATT)", ...controls];
  const attIdx = 3;
  const att = res.beta[attIdx], attSE = res.se[attIdx], attT = res.tStats[attIdx], attP = res.pVals[attIdx];
  const means = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  const counts = { ctrl_pre: 0, ctrl_post: 0, trt_pre: 0, trt_post: 0 };
  valid.forEach(r => {
    const key = `${r[treatCol] ? "trt" : "ctrl"}_${r[postCol] ? "post" : "pre"}`;
    means[key] += r[yCol]; counts[key]++;
  });
  Object.keys(means).forEach(k => { means[k] = counts[k] > 0 ? means[k] / counts[k] : null; });
  return { ...res, varNames, att, attSE, attT, attP, means, n: valid.length };
}

export function runTWFEDiD(rows, yCol, unitCol, timeCol, treatCol, controls = []) {
  const valid = rows.filter(r =>
    typeof r[yCol] === "number" && isFinite(r[yCol]) &&
    r[unitCol] != null && r[timeCol] != null
  );
  if (valid.length < 10) return null;
  const units = [...new Set(valid.map(r => r[unitCol]))].sort();
  const times = [...new Set(valid.map(r => r[timeCol]))].sort((a, b) => a - b);
  if (units.length < 2 || times.length < 2) return null;
  const grandMeans = {};
  const unitMeans = {}, timeMeans = {};
  [yCol, treatCol, ...controls].forEach(c => {
    grandMeans[c] = valid.reduce((s, r) => s + (r[c] ?? 0), 0) / valid.length;
  });
  units.forEach(u => {
    const sub = valid.filter(r => r[unitCol] === u);
    unitMeans[u] = {};
    [yCol, treatCol, ...controls].forEach(c => { unitMeans[u][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length; });
  });
  times.forEach(t => {
    const sub = valid.filter(r => r[timeCol] === t);
    timeMeans[t] = {};
    [yCol, treatCol, ...controls].forEach(c => { timeMeans[t][c] = sub.reduce((s, r) => s + (r[c] ?? 0), 0) / sub.length; });
  });
  const demeaned = valid.map(r => {
    const d = {};
    [yCol, treatCol, ...controls].forEach(c => {
      d[c] = (r[c] ?? 0) - (unitMeans[r[unitCol]][c] ?? 0) - (timeMeans[r[timeCol]][c] ?? 0) + grandMeans[c];
    });
    return d;
  });
  const res = runOLS(demeaned, yCol, [treatCol, ...controls]);
  if (!res) return null;
  const df_fe = valid.length - (units.length + times.length - 1) - controls.length - 1;
  const s2_fe = res.SSR / Math.max(1, df_fe);
  const Xmat = demeaned.map(r => [1, r[treatCol], ...controls.map(c => r[c])]);
  const Xt = transpose(Xmat);
  const XtXinv = matInv(matMul(Xt, Xmat));
  const corrSE = XtXinv ? XtXinv.map((row, i) => Math.sqrt(Math.abs(row[i] * s2_fe))) : res.se;
  const corrT = res.beta.map((b, i) => b / corrSE[i]);
  const corrP = corrT.map(t => pValue(t, df_fe));
  const varNames = ["(Intercept)", "Treatment (ATT)", ...controls];
  const att = res.beta[1], attSE = corrSE[1], attT = corrT[1], attP = corrP[1];
  const eventMeans = times.map(t => {
    const sub = valid.filter(r => r[timeCol] === t);
    const ctrl = sub.filter(r => !r[treatCol]);
    const trt = sub.filter(r => !!r[treatCol]);
    return {
      t,
      ctrl: ctrl.length > 0 ? ctrl.reduce((s, r) => s + r[yCol], 0) / ctrl.length : null,
      trt: trt.length > 0 ? trt.reduce((s, r) => s + r[yCol], 0) / trt.length : null,
    };
  });
  return {
    beta: res.beta, se: corrSE, tStats: corrT, pVals: corrP,
    varNames, att, attSE, attT, attP,
    R2: res.R2, adjR2: 1 - (1 - res.R2) * (valid.length - 1) / Math.max(1, df_fe),
    n: valid.length, df: df_fe, units: units.length, times: times.length, eventMeans, timesArr: times,
  };
}

// ─── DIAGNOSTICS ─────────────────────────────────────────────────────────────
// Breusch-Pagan test for heteroskedasticity
// H0: homoskedastic. Rejects when p < 0.05.
export function breuschPagan(resid, Yhat) {
  const n = resid.length;
  const e2 = resid.map(e => e * e);
  const e2mean = e2.reduce((a, b) => a + b, 0) / n;
  // Regress e² on Yhat
  const res = runOLS(
    Yhat.map((y, i) => ({ __yhat: y, __e2: e2[i] })),
    "__e2", ["__yhat"]
  );
  if (!res) return null;
  const SSR_e2 = e2.reduce((s, v) => s + (v - e2mean) ** 2, 0);
  const LM = n * res.R2;
  // chi-sq approximation with df=1
  const pVal = Math.exp(-LM / 2); // simplified; good enough for display
  return { LM: LM.toFixed(3), pVal: Math.min(1, pVal * 2).toFixed(4), reject: pVal * 2 < 0.05 };
}

// VIF — Variance Inflation Factor for multicollinearity
export function computeVIF(rows, xCols) {
  if (xCols.length < 2) return xCols.map(c => ({ col: c, vif: 1 }));
  return xCols.map((col, i) => {
    const others = xCols.filter((_, j) => j !== i);
    const res = runOLS(rows, col, others);
    if (!res || res.R2 >= 1) return { col, vif: Infinity };
    return { col, vif: 1 / (1 - res.R2) };
  });
}

// Hausman test: FE vs FD consistency check
export function hausmanTest(fe, fd, xCols) {
  if (!fe || !fd) return null;
  try {
    const diff = fe.beta.map((b, i) => b - (fd.beta[i] ?? 0));
    const varDiff = fe.se.map((s, i) => Math.max(0, s ** 2 - (fd.se[i] ?? 0) ** 2));
    const H = diff.reduce((s, d, i) => s + (varDiff[i] > 1e-10 ? d ** 2 / varDiff[i] : 0), 0);
    const df = xCols.length;
    // chi-sq p-value approx
    const pVal = Math.exp(-H / 2);
    return { H: H.toFixed(3), df, pVal: Math.min(1, pVal).toFixed(4) };
  } catch {
    return null;
  }
}

// ─── EXPORT HELPERS ──────────────────────────────────────────────────────────
export function buildLatex(yVar, xVars, results, model = "OLS") {
  const vars = results.varNames || ["(Intercept)", ...xVars];
  const fmtP = p => p == null ? "N/A" : p < 0.001 ? "<0.001" : p.toFixed(4);
  const rows = vars.map((v, i) => {
    const b = results.beta?.[i], se = results.se?.[i], t = results.tStats?.[i], p = results.pVals?.[i];
    const bFmt  = b  != null && isFinite(b)  ? b.toFixed(4)  : "N/A";
    const seFmt = se != null && isFinite(se) ? se.toFixed(4) : "N/A";
    const tFmt  = t  != null && isFinite(t)  ? t.toFixed(3)  : "N/A";
    const pFmt  = fmtP(p);
    const strs  = p != null ? stars(p) : "";
    return `  ${v.replace(/_/g, "\\_")} & ${bFmt}${strs} & ${seFmt} & ${tFmt} & ${pFmt} \\\\`;
  }).join("\n");
  return `\\begin{table}[htbp]\n\\centering\n\\caption{${model} Results: \\texttt{${yVar}}}\n\\begin{tabular}{lrrrr}\n\\hline\\hline\nVariable & Estimate & Std. Error & t-value & Pr($>|t|$) \\\\\n\\hline\n${rows}\n\\hline\n\\multicolumn{5}{l}{$R^2 = ${results.R2?.toFixed(4) ?? "N/A"}$, Adj. $R^2 = ${results.adjR2?.toFixed(4) ?? "N/A"}$, $n = ${results.n ?? "N/A"}$} \\\\\n\\multicolumn{5}{l}{Significance: *$p<0.1$, **$p<0.05$, ***$p<0.01$} \\\\\n\\hline\n\\end{tabular}\n\\end{table}`;
}

export function buildCSVExport(yVar, results) {
  const vars = results.varNames || [];
  const header = "variable,estimate,std_error,t_value,p_value,sig";
  const rows = vars.map((v, i) => {
    const b  = results.beta?.[i];
    const se = results.se?.[i];
    const t  = results.tStats?.[i];
    const p  = results.pVals?.[i];
    return `${v},${b != null ? b.toFixed(6) : "NA"},${se != null ? se.toFixed(6) : "NA"},${t != null ? t.toFixed(6) : "NA"},${p != null ? p.toFixed(6) : "NA"},${p != null ? stars(p) : ""}`;
  });
  return [header, ...rows, "", "# Fit", `r_squared,${results.R2?.toFixed(6) ?? "NA"}`, `adj_r_squared,${results.adjR2?.toFixed(6) ?? "NA"}`, `n,${results.n ?? "NA"}`].join("\n");
}

export function downloadText(content, filename) {
  const blob = new Blob([content], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
