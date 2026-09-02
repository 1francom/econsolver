// ─── ECON STUDIO · src/math/SampleTests.js ───────────────────────────────────
// Pure-JS pre-model hypothesis tests on sample data (means, variances) and on
// arbitrary parameters (estimate + SE). Used by the Stat & Simulation tabs so
// users can test means/variances of loaded or simulated data before modeling.
// No React, no UI imports — math only.

import { pt, pnorm, pchisq, pchisqUpper, pf } from "./calcEngine.js";
import { computeACF, applySeriesTransform } from "./timeSeries.js";
import { jarqueBera } from "../core/diagnostics/normality.js";

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

// Drop missing BEFORE coercing. `Number(null)` and `Number("")` are both 0, and
// 0 is finite, so the old `.map(Number).filter(finite)` kept every missing value
// as a zero observation: it inflated n and pulled the mean toward zero. On
// [10, 12, 14, null, null] that reported n = 5, mean 7.2, p = 0.075 where R's
// t.test reports n = 3, mean 12, p = 0.009 — the same data, opposite conclusion.
// R drops NA; so does this now.
function cleanNumeric(values) {
  return (values ?? [])
    .filter(v => v !== null && v !== undefined && v !== "")
    .map(Number)
    .filter(finite);
}

// ─── LONG-FORMAT INPUT FOR THE TWO-SAMPLE TESTS ───────────────────────────────
// Every two-sample test below takes two arrays, i.e. WIDE input — R's
// `t.test(y1, y2)`. Econometric data is almost always LONG: one outcome column
// and one group column, which is R's `t.test(y ~ treat)`. Without these two
// helpers the only way to contrast two groups was to pivot the table first,
// which is why "compute an ATE as a difference in means" read as impossible.

/**
 * Distinct levels of a grouping column, in first-seen order, as RAW values.
 * Null and undefined are not levels; the empty string is one. Raw values are
 * returned (not stringified) so a caller can sort them numerically.
 */
export function groupLevels(rows, groupCol) {
  const seen = new Set();
  const out = [];
  for (const r of rows ?? []) {
    const g = r?.[groupCol];
    if (g === null || g === undefined) continue;
    const k = String(g);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(g);
  }
  return out;
}

/**
 * Split one column into the two arrays a two-sample test expects, by two levels
 * of a grouping column. `levelA` is the FIRST sample, so the order of the two
 * levels is the direction of the contrast.
 *
 * Levels are matched as TEXT, matching the canonical condition language where
 * `eq` is a string comparison — so the numeric 1 and the string "1" are one
 * level, which is what a user picking from a dropdown means.
 *
 * Values pass through RAW. The tests clean their own inputs via cleanNumeric,
 * and filtering here as well would make the long and wide paths disagree the
 * moment either cleaner changed.
 */
/**
 * Success counts per group for a two-proportion test, from a BINARY outcome
 * column split by two levels of a grouping column — the binary-outcome ATE.
 * Without this, twoPropTest could only be fed four counts typed by hand.
 *
 * Refuses a non-binary column rather than guessing. Treating "5" as a success
 * would report a "proportion" of a continuous variable, which means nothing;
 * booleans and 0/1 are accepted, everything else is an error the caller shows.
 */
export function countsByGroup(rows, valueCol, groupCol, levelA, levelB) {
  const { a, b } = splitByGroup(rows, valueCol, groupCol, levelA, levelB);
  let bad = null;
  const tally = (arr) => {
    let s = 0, n = 0;
    for (const v of arr) {
      if (v === null || v === undefined || v === "") continue;  // missing, as elsewhere
      const x = typeof v === "boolean" ? (v ? 1 : 0) : Number(v);
      if (!finite(x)) continue;
      if (x !== 0 && x !== 1) { bad ??= v; continue; }
      n += 1;
      if (x === 1) s += 1;
    }
    return { s, n };
  };
  const A = tally(a), B = tally(b);
  if (bad !== null) {
    return { error: `"${valueCol}" is not binary — found ${JSON.stringify(bad)}. A proportion needs 0/1 or true/false.` };
  }
  return { s1: A.s, n1: A.n, s2: B.s, n2: B.n };
}

export function splitByGroup(rows, valueCol, groupCol, levelA, levelB) {
  const A = String(levelA), B = String(levelB);
  const a = [], b = [];
  for (const r of rows ?? []) {
    const g = r?.[groupCol];
    if (g === null || g === undefined) continue;
    const gs = String(g);
    if (gs === A) a.push(r[valueCol]);
    if (gs === B) b.push(r[valueCol]);
  }
  return { a, b };
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

// Average (fractional) ranks, 1-based, ties shared.
function ranks(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(arr.length);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

// Correlation test of H0: ρ = 0 via the t-approximation
// t = r·√((n−2)/(1−r²)), df = n−2. method "pearson" | "spearman" (rank corr).
export function correlationTest(a, b, { method = "pearson", alternative = "two-sided" } = {}) {
  const x0 = (a ?? []).map(Number), y0 = (b ?? []).map(Number);
  const k = Math.min(x0.length, y0.length);
  let X = [], Y = [];
  for (let i = 0; i < k; i++) if (finite(x0[i]) && finite(y0[i])) { X.push(x0[i]); Y.push(y0[i]); }
  if (X.length < 3) return { error: "Need at least 3 complete numeric pairs." };
  if (method === "spearman") { X = ranks(X); Y = ranks(Y); }
  const n = X.length;
  const mx = X.reduce((s, v) => s + v, 0) / n, my = Y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = X[i] - mx, dy = Y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  if (!(sxx > 0 && syy > 0)) return { error: "Zero variance — correlation undefined." };
  const r = sxy / Math.sqrt(sxx * syy);
  const df = n - 2;
  const stat = r * Math.sqrt(df / (1 - r * r));
  const pValue = clamp01(pFromCdf(pt(stat, df), alternative));
  return { test: "correlation", method, n, estimate: r, df, nullValue: 0, statLabel: "t", stat, alternative, pValue };
}

// Variance-ratio F-test of H0: σ²_A / σ²_B = 1 (assumes normality).
// Statistic s²_A / s²_B ~ F(n_A−1, n_B−1).
export function varianceRatioTest(a, b, { alternative = "two-sided" } = {}) {
  const A = sampleMoments(a), B = sampleMoments(b);
  if (A.n < 2 || B.n < 2) return { error: "Each group needs at least 2 numeric observations." };
  if (!(A.variance > 0 && B.variance > 0)) return { error: "Both groups need positive variance." };
  const df1 = A.n - 1, df2 = B.n - 1;
  const stat = A.variance / B.variance;
  const pValue = clamp01(pFromCdf(pf(stat, df1, df2), alternative));
  return { test: "var-ratio", nA: A.n, nB: B.n, estimate: stat, df1, df2, nullValue: 1, statLabel: "F", stat, alternative, pValue };
}

// ─── LJUNG-BOX / BOX-PIERCE PORTMANTEAU TEST ──────────────────────────────────
// H0: the series is serially uncorrelated up to lag h (R's Box.test).
//   Ljung-Box:  Q = n(n+2) Σ_{k=1..h} ρ̂²_k / (n−k)
//   Box-Pierce: Q = n Σ_{k=1..h} ρ̂²_k
// Under H0, Q ~ χ²(h − fitdf); fitdf is the number of ARMA parameters already
// fitted (R's `fitdf`), 0 for a raw series. The test is one-sided by
// construction — a large Q means dependence — so it takes no `alternative`.
//
// ρ̂_k comes from computeACF, the same estimator the Explore ACF plot draws, so
// the picture and the p-value can never disagree about the autocorrelations.
export function ljungBoxTest(values, { lags = 10, type = "Ljung", fitdf = 0, transform = "raw" } = {}) {
  const raw = cleanNumeric(values);
  const nDropped = (values?.length ?? 0) - raw.length;
  const x = applySeriesTransform(raw, transform);
  const n = x.length;
  const h = Math.trunc(Number(lags));
  const fit = Math.max(0, Math.trunc(Number(fitdf) || 0));

  if (n < 5) return { error: "Need at least 5 numeric observations." };
  if (!(h >= 1)) return { error: "Number of lags must be at least 1." };
  if (h >= n) return { error: `Lags (${h}) must be below the number of observations (${n}).` };
  const df = h - fit;
  if (df < 1) return { error: `df = lags − fitdf must be at least 1 (got ${h} − ${fit}).` };

  // computeACF answers a zero-variance series with all-zero autocorrelations,
  // which would come back here as Q = 0, p = 1 — "no serial dependence" stated
  // confidently about a series that has no correlations to speak of at all.
  // Mirror its own threshold and refuse instead. It is an absolute cutoff on
  // Σ(x−x̄)², so a genuinely micro-scaled series is refused rather than
  // silently answered from zeros.
  const mean = x.reduce((s, v) => s + v, 0) / n;
  const c0 = x.reduce((s, v) => s + (v - mean) ** 2, 0);
  if (!(c0 > 1e-15)) return { error: "Series has (near-)zero variance — autocorrelations undefined." };

  const acf = computeACF(x, h);
  if (acf.length <= h) return { error: "Too few observations for the requested lags." };

  const boxPierce = String(type).toLowerCase().startsWith("box");
  let stat = 0;
  for (let k = 1; k <= h; k++) {
    const r2 = acf[k] * acf[k];
    stat += boxPierce ? r2 : r2 / (n - k);
  }
  stat *= boxPierce ? n : n * (n + 2);

  return {
    test: "ljung-box",
    method: boxPierce ? "Box-Pierce" : "Ljung-Box",
    n,
    nDropped,
    lags: h,
    fitdf: fit,
    transform,
    acf: acf.slice(1),
    estimate: acf[1],          // ρ̂₁ — the headline autocorrelation
    df,
    nullValue: 0,
    statLabel: "chi2",
    stat,
    // Right-tailed by construction, so this is NOT routed through pFromCdf.
    alternative: "greater",
    // Right tail directly: on financial returns Q lands where 1 - pchisq()
    // has already rounded to exactly 0, and "p = 0" is not the finding.
    pValue: clamp01(pchisqUpper(stat, df)),
  };
}

// ─── JARQUE-BERA NORMALITY TEST ON A SAMPLE ───────────────────────────────────
// Same statistic the Model tab's diagnostics report for OLS residuals, applied
// to any numeric column — which is what a QRM workflow needs, since the returns
// are tested for normality long before any regression exists.
//
// The statistic comes from core/diagnostics/normality.js so there is exactly one
// implementation of it in the app; only the p-value is recomputed here, with the
// exact χ² CDF instead of the display-rounded value that function returns.
export function normalityTest(values, { transform = "raw" } = {}) {
  const raw = cleanNumeric(values);
  const nDropped = (values?.length ?? 0) - raw.length;
  const x = applySeriesTransform(raw, transform);
  if (x.length < 8) return { error: "Need at least 8 numeric observations for Jarque-Bera." };

  const jb = jarqueBera(x);
  if (!jb) return { error: "Sample has zero variance — Jarque-Bera undefined." };

  return {
    test: "normality",
    method: "Jarque-Bera",
    n: jb.n,
    nDropped,
    transform,
    skewness: jb.skewness,
    kurtosis: jb.kurtosis,     // EXCESS kurtosis: normal = 0
    estimate: jb.skewness,
    df: 2,
    nullValue: 0,
    statLabel: "chi2",
    stat: jb.JB,
    alternative: "greater",
    pValue: clamp01(pchisqUpper(jb.JB, 2)),
  };
}
