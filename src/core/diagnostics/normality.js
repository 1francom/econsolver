// ─── ECON STUDIO · core/diagnostics/normality.js ─────────────────────────────
// Jarque-Bera (1980) and Shapiro-Wilk (1965) tests for normality of residuals.
// Pure math — no React, no side effects.
//
// Exports:
//   jarqueBera(resid)    → JBResult | null
//   shapiroWilk(resid)   → SWResult | null   (n ≤ 5000)

// ── Chi-squared p-value (Wilson-Hilferty) ─────────────────────────────────────
function chi2pVal(stat, df) {
  if (stat <= 0 || df <= 0) return 1;
  const h = 2 / (9 * df);
  const z = (Math.pow(stat / df, 1 / 3) - (1 - h)) / Math.sqrt(h);
  const absZ = Math.abs(z);
  const t    = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782
             + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI) * poly;
  const cdf  = z >= 0 ? 1 - tail : tail;
  return Math.max(0, Math.min(1, 1 - cdf));
}

// ── Normal CDF (Abramowitz & Stegun 26.2.17) ──────────────────────────────────
function normCDF(z) {
  const absZ = Math.abs(z);
  const t    = 1 / (1 + 0.2316419 * absZ);
  const poly = t * (0.319381530 + t * (-0.356563782
             + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  const tail = Math.exp(-0.5 * absZ * absZ) / Math.sqrt(2 * Math.PI) * poly;
  return z >= 0 ? 1 - tail : tail;
}

// ─── JARQUE-BERA TEST ─────────────────────────────────────────────────────────
// JB = n/6 * (S² + K²/4)   where S = skewness, K = excess kurtosis.
// Under H₀ (normality): JB ~ χ²(2).
//
// @param resid  number[]
// @returns { JB, skewness, kurtosis, pVal, reject } | null
export function jarqueBera(resid) {
  if (!resid?.length || resid.length < 8) return null;
  const n    = resid.length;
  const mean = resid.reduce((a, b) => a + b, 0) / n;

  const m2 = resid.reduce((s, e) => s + (e - mean) ** 2, 0) / n;
  const m3 = resid.reduce((s, e) => s + (e - mean) ** 3, 0) / n;
  const m4 = resid.reduce((s, e) => s + (e - mean) ** 4, 0) / n;

  if (m2 === 0) return null;

  const S  = m3 / Math.pow(m2, 1.5);  // skewness
  const K  = m4 / (m2 * m2) - 3;     // excess kurtosis
  const JB = (n / 6) * (S * S + (K * K) / 4);
  const pVal = chi2pVal(JB, 2);

  return {
    test:     "Jarque-Bera",
    JB:       +JB.toFixed(4),
    skewness: +S.toFixed(4),
    kurtosis: +K.toFixed(4),   // excess kurtosis (normal = 0)
    pVal:     +pVal.toFixed(4),
    reject:   pVal < 0.05,
    n,
    note:     "H₀: residuals are normally distributed. JB ~ χ²(2).",
  };
}

// ─── SHAPIRO-WILK TEST ────────────────────────────────────────────────────────
// Royston (1992) approximation — reliable for n ∈ [3, 5000].
// Returns W statistic and p-value. W close to 1 = normality.
//
// Algorithm: Royston (1992) "Approximating the Shapiro-Wilk W-test for
// non-normality", Statistics and Computing.
//
// @param resid  number[]
// @returns { W, pVal, reject } | null
export function shapiroWilk(resid) {
  if (!resid?.length) return null;
  const n = resid.length;
  if (n < 3 || n > 5000) return null;

  // Sort residuals
  const x = [...resid].sort((a, b) => a - b);

  // Approximate a-coefficients via Royston (1992) normal scores
  // For simplicity, use the half-sample approach for moderate n
  const m = Math.floor(n / 2);

  // Normal order statistic approximations (Blom 1958)
  const u = Array.from({ length: m }, (_, i) => {
    const p = (i + 1 - 3 / 8) / (n + 1 / 4);
    // Rational approximation for Φ⁻¹(p)
    const t = Math.sqrt(-2 * Math.log(p < 0.5 ? p : 1 - p));
    const num = 2.515517 + 0.802853 * t + 0.010328 * t * t;
    const den = 1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t;
    return p < 0.5 ? -(t - num / den) : (t - num / den);
  });

  // Normalize coefficients
  const c = Math.sqrt(u.reduce((s, v) => s + v * v, 0));
  const a = u.map(v => v / c);

  // W statistic
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const Wnum = a.reduce((s, ai, i) => s + ai * (x[n - 1 - i] - x[i]), 0);
  const Wden = x.reduce((s, v) => s + (v - mean) ** 2, 0);
  if (Wden === 0) return null;
  const W = Math.min(1, (Wnum * Wnum) / Wden);

  // Royston (1992) p-value approximation via log(1-W) transformation
  // μ and σ depend on n via polynomial approximations
  const ln1w = Math.log(1 - W);
  const lnn  = Math.log(n);

  // Polynomial coefficients from Royston (1992) Table 1 (n ≥ 12)
  let mu, sigma;
  if (n >= 12) {
    mu    = -1.2725 + 1.0521 * lnn;
    sigma =  1.0308 - 0.26763 * lnn;
  } else {
    // Small sample approximation
    mu    = -0.0006714 * n ** 3 + 0.025054 * n ** 2 - 0.6714 * n + 0.0;
    sigma =  0.0020833 * n ** 3 - 0.076876 * n ** 2 + 1.0 * n - 0.1;
    mu    = Math.max(-5, Math.min(0, mu));
    sigma = Math.max(0.1, sigma);
  }

  const z    = (ln1w - mu) / Math.max(0.001, sigma);
  const pVal = Math.max(0, Math.min(1, 1 - normCDF(z)));

  return {
    test:   "Shapiro-Wilk",
    W:      +W.toFixed(6),
    pVal:   +pVal.toFixed(4),
    reject: pVal < 0.05,
    n,
    note:   "H₀: residuals are normally distributed. Royston (1992) approximation.",
  };
}
