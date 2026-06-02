// ─── ECON STUDIO · src/math/SampleTests.js ───────────────────────────────────
// Pure-JS pre-model hypothesis tests on sample data (means, variances) and on
// arbitrary parameters (estimate + SE). Used by the Stat & Simulation tabs so
// users can test means/variances of loaded or simulated data before modeling.
// No React, no UI imports — math only.

import { pt, pnorm, pchisq } from "./calcEngine.js";

function finite(v) {
  return typeof v === "number" && isFinite(v);
}

function clamp01(p) {
  return Math.max(0, Math.min(1, p));
}

// Convert a CDF value F = P(stat ≤ x) into a one-/two-sided p-value.
function pFromCdf(F, alternative) {
  if (alternative === "less") return F;
  if (alternative === "greater") return 1 - F;
  return 2 * Math.min(F, 1 - F);
}

function cleanNumeric(values) {
  return (values ?? []).map(Number).filter(finite);
}

function sampleMoments(values) {
  const x = cleanNumeric(values);
  const n = x.length;
  const mean = x.reduce((a, b) => a + b, 0) / n;
  const ss = x.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  const variance = ss / (n - 1);
  return { x, n, mean, ss, variance };
}

// One-sample t-test of H0: μ = mu0.
export function oneSampleMeanTest(values, mu0 = 0, alternative = "two-sided") {
  const m = sampleMoments(values);
  if (m.n < 2) return { error: "Need at least 2 numeric observations." };
  if (!finite(Number(mu0))) return { error: "Null value must be finite." };
  const sd = Math.sqrt(m.variance);
  const se = sd / Math.sqrt(m.n);
  if (!(se > 0)) return { error: "Sample has zero variance — t-test undefined." };
  const df = m.n - 1;
  const stat = (m.mean - Number(mu0)) / se;
  const pValue = clamp01(pFromCdf(pt(stat, df), alternative));
  return {
    test: "mean",
    n: m.n,
    estimate: m.mean,
    sd,
    se,
    df,
    nullValue: Number(mu0),
    statLabel: "t",
    stat,
    alternative,
    pValue,
  };
}

// Chi-square test of H0: σ² = sigma2_0 (assumes normality).
export function varianceTest(values, sigma2_0 = 1, alternative = "two-sided") {
  const m = sampleMoments(values);
  if (m.n < 2) return { error: "Need at least 2 numeric observations." };
  const s0 = Number(sigma2_0);
  if (!(s0 > 0)) return { error: "Null variance must be positive." };
  const df = m.n - 1;
  const stat = (df * m.variance) / s0;
  const pValue = clamp01(pFromCdf(pchisq(stat, df), alternative));
  return {
    test: "variance",
    n: m.n,
    estimate: m.variance,
    sd: Math.sqrt(m.variance),
    df,
    nullValue: s0,
    statLabel: "chi2",
    stat,
    alternative,
    pValue,
  };
}

// Generic parameter test of H0: θ = nullValue from a point estimate + SE.
// Uses a t-distribution when a positive df is supplied, otherwise a z-test.
export function parameterTest(estimate, se, nullValue = 0, alternative = "two-sided", df = null) {
  const e = Number(estimate);
  const s = Number(se);
  const h0 = Number(nullValue);
  if (!finite(e) || !finite(s) || s <= 0) return { error: "Estimate and SE must be finite, with SE > 0." };
  if (!finite(h0)) return { error: "Null value must be finite." };
  const dfNum = Number(df);
  const useT = finite(dfNum) && dfNum > 0;
  const stat = (e - h0) / s;
  const F = useT ? pt(stat, dfNum) : pnorm(stat);
  const pValue = clamp01(pFromCdf(F, alternative));
  return {
    test: "parameter",
    estimate: e,
    se: s,
    df: useT ? dfNum : null,
    nullValue: h0,
    statLabel: useT ? "t" : "z",
    stat,
    alternative,
    pValue,
  };
}

// Two-sample mean test of H0: μ_A − μ_B = mu0. Welch by default; pooled when
// { pooled: true }. Reuses sampleMoments / pFromCdf / pt.
export function twoSampleMeanTest(a, b, { alternative = "two-sided", pooled = false, mu0 = 0 } = {}) {
  const A = sampleMoments(a), B = sampleMoments(b);
  if (A.n < 2 || B.n < 2) return { error: "Each group needs at least 2 numeric observations." };
  const m0 = Number(mu0);
  if (!finite(m0)) return { error: "Null value must be finite." };
  const diff = A.mean - B.mean;
  let se, df;
  if (pooled) {
    const sp2 = ((A.n - 1) * A.variance + (B.n - 1) * B.variance) / (A.n + B.n - 2);
    se = Math.sqrt(sp2 * (1 / A.n + 1 / B.n));
    df = A.n + B.n - 2;
  } else {
    const vA = A.variance / A.n, vB = B.variance / B.n;
    se = Math.sqrt(vA + vB);
    df = (vA + vB) * (vA + vB) / ((vA * vA) / (A.n - 1) + (vB * vB) / (B.n - 1));
  }
  if (!(se > 0)) return { error: "Zero variance — t-test undefined." };
  const stat = (diff - m0) / se;
  const pValue = clamp01(pFromCdf(pt(stat, df), alternative));
  return {
    test: "two-mean", nA: A.n, nB: B.n, meanA: A.mean, meanB: B.mean,
    estimate: diff, se, df, nullValue: m0, statLabel: "t", stat, alternative, pValue, pooled,
  };
}

// Paired mean test of H0: μ_d = mu0 on the within-pair differences. Drops any
// pair where either side is non-finite, then delegates to oneSampleMeanTest.
export function pairedMeanTest(a, b, { alternative = "two-sided", mu0 = 0 } = {}) {
  const x = (a ?? []).map(Number), y = (b ?? []).map(Number);
  const k = Math.min(x.length, y.length);
  const diffs = [];
  for (let i = 0; i < k; i++) if (finite(x[i]) && finite(y[i])) diffs.push(x[i] - y[i]);
  if (diffs.length < 2) return { error: "Need at least 2 complete numeric pairs." };
  const r = oneSampleMeanTest(diffs, mu0, alternative);
  if (r.error) return r;
  return { ...r, test: "paired" };
}

// One-proportion z-test of H0: p = p0 (normal approximation, no continuity
// correction — matches R prop.test(..., correct = FALSE)).
export function onePropTest(successes, n, { p0 = 0.5, alternative = "two-sided" } = {}) {
  const x = Number(successes), N = Number(n), pp = Number(p0);
  if (!finite(x) || !finite(N) || N < 1 || x < 0 || x > N) return { error: "Need 0 ≤ successes ≤ n, n ≥ 1." };
  if (!(pp > 0 && pp < 1)) return { error: "p0 must be in (0, 1)." };
  const phat = x / N;
  const se = Math.sqrt(pp * (1 - pp) / N);
  const stat = (phat - pp) / se;
  const pValue = clamp01(pFromCdf(pnorm(stat), alternative));
  return { test: "one-prop", n: N, estimate: phat, phat, se, nullValue: pp, statLabel: "z", stat, alternative, pValue };
}

// Two-proportion z-test of H0: p1 = p2 with pooled-proportion SE.
export function twoPropTest(s1, n1, s2, n2, { alternative = "two-sided" } = {}) {
  const a = Number(s1), na = Number(n1), b = Number(s2), nb = Number(n2);
  if ([a, na, b, nb].some(v => !finite(v)) || na < 1 || nb < 1 || a < 0 || a > na || b < 0 || b > nb)
    return { error: "Need 0 ≤ sᵢ ≤ nᵢ, nᵢ ≥ 1." };
  const p1 = a / na, p2 = b / nb;
  const pPool = (a + b) / (na + nb);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / na + 1 / nb));
  if (!(se > 0)) return { error: "Pooled proportion gives zero SE." };
  const diff = p1 - p2;
  const stat = diff / se;
  const pValue = clamp01(pFromCdf(pnorm(stat), alternative));
  return { test: "two-prop", nA: na, nB: nb, phat1: p1, phat2: p2, estimate: diff, se, nullValue: 0, statLabel: "z", stat, alternative, pValue };
}
