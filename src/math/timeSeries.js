// ─── ECON STUDIO · src/math/timeSeries.js ────────────────────────────────────
// Time-series statistics: ACF, PACF, ADF unit root test.
// Pure JS — no React, no side effects.
//
// Exports:
//   computeACF(y, maxLag?)       → number[]  (lag 0 = 1.0)
//   computePACF(acf, maxLag?)    → number[]  (lag 0 = 1.0)
//   adfTest(y, maxLags?)         → AdfResult[]
//
// ADF uses MacKinnon (1994) response-surface critical values, constant-only model.

import { runOLS } from "./LinearEngine.js";

// ─── ACF ─────────────────────────────────────────────────────────────────────
// ρ_k = [ Σ_{t=k}^{n-1} (y_t − ȳ)(y_{t-k} − ȳ) ] / [ Σ_t (y_t − ȳ)² ]
// Denominator uses n (not n-k), matching R's stats::acf default.
export function computeACF(y, maxLag = 20) {
  const n = y.length;
  maxLag = Math.min(maxLag, n - 2);
  if (maxLag < 1) return [1];

  const mean = y.reduce((s, v) => s + v, 0) / n;
  const c0   = y.reduce((s, v) => s + (v - mean) ** 2, 0);
  if (c0 < 1e-15) return Array(maxLag + 1).fill(0).map((_, i) => i === 0 ? 1 : 0);

  const acf = [1.0];
  for (let k = 1; k <= maxLag; k++) {
    let ck = 0;
    for (let t = k; t < n; t++) ck += (y[t] - mean) * (y[t - k] - mean);
    acf.push(ck / c0);
  }
  return acf;
}

// ─── PACF (Durbin-Levinson recursion) ────────────────────────────────────────
// φ_{kk} = (ρ_k − Σ_{j=1}^{k-1} φ_{k-1,j} ρ_{k-j}) / (1 − Σ_{j=1}^{k-1} φ_{k-1,j} ρ_j)
export function computePACF(acf, maxLag) {
  maxLag = maxLag ?? acf.length - 1;
  maxLag = Math.min(maxLag, acf.length - 1);
  const pacf = [1.0];
  if (maxLag < 1) return pacf;

  pacf.push(acf[1]);          // lag 1: PACF = ACF
  const phi = [[acf[1]]];     // phi[order-1][j-1] for j = 1..order

  for (let k = 2; k <= maxLag; k++) {
    const prev = phi[k - 2];  // φ_{k-1, j}
    let num = acf[k];
    let den = 1.0;
    for (let j = 1; j < k; j++) {
      num -= prev[j - 1] * acf[k - j];
      den -= prev[j - 1] * acf[j];
    }
    const pkk = Math.abs(den) < 1e-12 ? 0 : num / den;
    pacf.push(pkk);

    const curr = [];
    for (let j = 1; j < k; j++) curr.push(prev[j - 1] - pkk * prev[k - j - 1]);
    curr.push(pkk);
    phi.push(curr);
  }
  return pacf;
}

// ─── ADF TEST ────────────────────────────────────────────────────────────────
// MacKinnon (1994) response-surface: CV_p(T) = ψ_∞ + ψ_1/T + ψ_2/T²
// Constant-only model (no trend). Tabulated from Table 1, col "c".
const MACKINNON = [
  { p: 0.010, psi: [-3.4336, -5.999, -29.25] },
  { p: 0.025, psi: [-3.1099, -4.906, -14.08] },
  { p: 0.050, psi: [-2.8621, -4.018,  -6.40] },
  { p: 0.100, psi: [-2.5671, -3.001,   0.00] },
  { p: 0.200, psi: [-2.1816, -2.000,   0.00] },  // extrapolated
];

function cv(entry, T) {
  const [a, b, c] = entry.psi;
  return a + b / T + c / (T * T);
}

function adfPValue(stat, T) {
  const cvs = MACKINNON.map(m => ({ p: m.p, cv: cv(m, T) }));
  if (stat <= cvs[0].cv)                 return 0.01;
  if (stat >= cvs[cvs.length - 1].cv)   return 0.95;  // clearly non-stationary
  for (let i = 0; i < cvs.length - 1; i++) {
    if (stat >= cvs[i].cv && stat <= cvs[i + 1].cv) {
      const frac  = (stat - cvs[i].cv) / (cvs[i + 1].cv - cvs[i].cv);
      const logP  = Math.log(cvs[i].p) + frac * (Math.log(cvs[i + 1].p) - Math.log(cvs[i].p));
      return Math.exp(logP);
    }
  }
  return 0.5;
}

// Returns { lag, stat, pVal, cv5pct, stationary }[]
export function adfTest(y, maxLags = 2) {
  const n = y.length;
  const results = [];

  for (let p = 0; p <= maxLags; p++) {
    // Δy_t = α + β·y_{t-1} + Σ_{j=1}^p γ_j·Δy_{t-j} + ε_t
    // t runs from p+1 to n-1 (0-based), giving n-p-1 observations
    const rows = [];
    for (let t = p + 1; t < n; t++) {
      const row = { dy: y[t] - y[t - 1], y_lag: y[t - 1] };
      for (let j = 1; j <= p; j++) row[`dy_lag${j}`] = y[t - j] - y[t - j - 1];
      rows.push(row);
    }
    const xCols = ["y_lag", ...Array.from({ length: p }, (_, i) => `dy_lag${i + 1}`)];
    const res   = runOLS(rows, "dy", xCols);

    if (!res) {
      results.push({ lag: p, stat: NaN, pVal: NaN, cv5pct: NaN, stationary: false });
      continue;
    }

    // y_lag is first xCol → index 1 in varNames (after intercept)
    const stat   = res.tStats[1];
    const T      = rows.length;
    const cv5    = cv(MACKINNON[2], T);   // 5% critical value
    const pVal   = adfPValue(stat, T);
    results.push({ lag: p, stat, pVal, cv5pct: cv5, stationary: stat < cv5 });
  }
  return results;
}
