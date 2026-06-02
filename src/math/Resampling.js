// ─── ECON STUDIO · src/math/Resampling.js ────────────────────────────────────
// Resampling-based inference for the sample mean and for the difference of two
// sample means. Pure JS, no React, no side effects — engine layer.
//
// Three estimators are exposed:
//
//   1. bootstrapMean(values, B, alpha)
//        Standard nonparametric bootstrap WITH REPLACEMENT (Efron 1979).
//        Draws B samples of size n with replacement, computes the mean of each,
//        reports the bootstrap SE = sd(replicates) and the percentile CI.
//        Treats `values` as an iid sample from the population.
//
//   2. subsampleMean(values, m, B, alpha)
//        Subsampling WITHOUT REPLACEMENT (Politis & Romano 1994). For each of
//        B draws, samples m < n distinct observations (no replacement) and
//        computes their mean. Reports:
//          - seSubsample  = sd of subsample means (SE at sample size m)
//          - seNScaled    = seSubsample · √(m/n)  — rescaled SE for the full
//                            n-sample mean, valid under iid (n large, m/n → 0)
//          - percentile CI from the rescaled, recentered replicates
//        Requires m < n; if m == n, only one subsample exists and there is no
//        variation, so the function returns an error.
//
//   3. permutationTwoSampleMean(valuesA, valuesB, B)
//        Combinatorial inference for H0: μ_A = μ_B. Pools all observations,
//        randomly reassigns the group labels B times, and recomputes the
//        difference of means each time. Two-sided p-value uses the standard
//        +1 correction: p = (1 + #{|Δ_b| ≥ |Δ_obs|}) / (B + 1).
//
// Numerical notes:
//   - All RNG calls go through Math.random. For reproducible runs the caller
//     should snapshot results; an explicit seed parameter is intentionally
//     omitted from this MVP (deterministic seeding requires a custom PRNG).
//   - Replicates are kept in memory for the caller (histogram, diagnostics).
//     Practical B ≤ 100_000.
//   - Non-finite values in `values` are filtered before resampling. The caller
//     receives `nUsed` to confirm how many observations actually entered the
//     analysis.

import { makeRNG, shuffle, sampleWithReplacement } from "./rng.js";
import { pnorm, qnorm } from "./calcEngine.js";

function clean(values) {
  return values.filter(v => typeof v === "number" && isFinite(v));
}

function mean(arr) {
  if (!arr.length) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

function sd(arr) {
  if (arr.length < 2) return NaN;
  const m = mean(arr);
  let s = 0;
  for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return Math.sqrt(s / (arr.length - 1));
}

// Linear-interpolated empirical quantile.
function quantile(sorted, p) {
  if (!sorted.length) return NaN;
  if (p <= 0) return sorted[0];
  if (p >= 1) return sorted[sorted.length - 1];
  const idx = p * (sorted.length - 1);
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (idx - lo) * (sorted[hi] - sorted[lo]);
}

// ─── STATISTIC REGISTRY (single-sample, operate on number[]) ──────────────────
function median(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function variance(arr) {
  const m = mean(arr);
  let s = 0; for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s += d * d; }
  return s / (arr.length - 1);
}
function trimmedMean10(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  const k = Math.floor(arr.length * 0.1);
  const t = s.slice(k, s.length - k);
  return mean(t.length ? t : s);
}
function iqr(arr) {
  const s = arr.slice().sort((a, b) => a - b);
  return quantile(s, 0.75) - quantile(s, 0.25);
}

const STATISTICS = { mean, median, sd, variance, trimmedMean10, iqr };

// Leave-one-out jackknife of an arbitrary statistic.
export function jackknife(values, statName = "mean") {
  const v = clean(values);
  const n = v.length;
  if (n < 2) return { error: "Need at least 2 finite observations." };
  const stat = STATISTICS[statName];
  if (!stat) return { error: `Unknown statistic '${statName}'.` };
  const estimate = stat(v);
  const loo = new Array(n);
  for (let i = 0; i < n; i++) loo[i] = stat(v.slice(0, i).concat(v.slice(i + 1)));
  const jm = mean(loo);
  const bias = (n - 1) * (jm - estimate);
  let s = 0; for (let i = 0; i < n; i++) { const d = loo[i] - jm; s += d * d; }
  const se = Math.sqrt((n - 1) / n * s);
  return { estimate, jackEstimate: jm, bias, se, values: loo };
}

// General nonparametric bootstrap of an arbitrary statistic, with a seeded RNG.
// ciType ∈ { "percentile", "basic", "bca" }. BCa falls back to percentile when
// the bias-correction z0 or acceleration a is non-finite.
export function bootstrapStatistic(values, statName = "mean", { B = 2000, alpha = 0.05, ciType = "percentile", seed = null } = {}) {
  const v = clean(values);
  const n = v.length;
  if (n < 2) return { error: "Need at least 2 finite observations." };
  if (!(B >= 50)) return { error: "B must be ≥ 50." };
  const stat = STATISTICS[statName];
  if (!stat) return { error: `Unknown statistic '${statName}'.` };

  const { rand, seed: usedSeed } = makeRNG(seed);
  const thetaHat = stat(v);
  const reps = new Array(B);
  for (let b = 0; b < B; b++) reps[b] = stat(sampleWithReplacement(rand, v, n));
  const bootSE = sd(reps);
  const bias = mean(reps) - thetaHat;
  const sorted = reps.slice().sort((a, b) => a - b);

  let ciLow, ciHigh;
  if (ciType === "basic") {
    ciLow = 2 * thetaHat - quantile(sorted, 1 - alpha / 2);
    ciHigh = 2 * thetaHat - quantile(sorted, alpha / 2);
  } else if (ciType === "bca") {
    let less = 0; for (let i = 0; i < B; i++) if (reps[i] < thetaHat) less++;
    const z0 = qnorm(less / B);
    const jk = jackknife(v, statName);
    const jm = mean(jk.values);
    let num = 0, den = 0;
    for (let i = 0; i < jk.values.length; i++) { const d = jm - jk.values[i]; num += d * d * d; den += d * d; }
    const a = num / (6 * Math.pow(den, 1.5));
    if (!isFinite(z0) || !isFinite(a)) {
      ciLow = quantile(sorted, alpha / 2); ciHigh = quantile(sorted, 1 - alpha / 2);
    } else {
      const zl = qnorm(alpha / 2), zu = qnorm(1 - alpha / 2);
      const a1 = pnorm(z0 + (z0 + zl) / (1 - a * (z0 + zl)));
      const a2 = pnorm(z0 + (z0 + zu) / (1 - a * (z0 + zu)));
      ciLow = quantile(sorted, a1); ciHigh = quantile(sorted, a2);
    }
  } else { // percentile
    ciLow = quantile(sorted, alpha / 2); ciHigh = quantile(sorted, 1 - alpha / 2);
  }

  return { stat: statName, estimate: thetaHat, B, alpha, ciType, ciLow, ciHigh, bootSE, bias, seed: usedSeed, replicates: reps };
}

// Fisher-Yates partial shuffle: returns first m elements of a shuffled copy
// without paying O(n) when m ≪ n is unusual here; we shuffle the whole array.
function shuffleInPlace(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// ─── 1. Bootstrap mean (with replacement) ─────────────────────────────────────
// Backward-compatible mean bootstrap (percentile CI). Routed through the seeded
// engine; accepts an optional seed for reproducibility.
export function bootstrapMean(values, B = 2000, alpha = 0.05, seed = null) {
  const r = bootstrapStatistic(values, "mean", { B, alpha, ciType: "percentile", seed });
  if (r.error) return r;
  return { method: "bootstrap", meanHat: r.estimate, seBoot: r.bootSE, ciLo: r.ciLow, ciHi: r.ciHigh, alpha, B, nUsed: clean(values).length, seed: r.seed, replicates: r.replicates };
}

// ─── 2. Subsample mean (without replacement) ──────────────────────────────────
export function subsampleMean(values, m, B = 2000, alpha = 0.05) {
  const v = clean(values);
  const n = v.length;
  if (n < 3) return { error: "Need at least 3 finite observations." };
  if (!(m >= 2 && m < n)) return { error: `Subsample size m must satisfy 2 ≤ m < n (n = ${n}).` };

  const meanHat = mean(v);
  const scratch = v.slice();
  const replicates = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    // Partial Fisher-Yates: pick m distinct values from scratch.
    let s = 0;
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(Math.random() * (n - i));
      const t = scratch[i]; scratch[i] = scratch[j]; scratch[j] = t;
      s += scratch[i];
    }
    replicates[b] = s / m;
  }
  const arr = Array.from(replicates);
  const seSubsample = sd(arr);
  // Politis–Romano scaling: SE of n-sample mean ≈ SE_subsample · √(m/n).
  const seNScaled = seSubsample * Math.sqrt(m / n);

  // Percentile CI on the rescaled, recentered replicates (subsampling CI):
  //   x̄_n ± √(m/n) · (Q_p(replicates) − meanHat)
  const sorted = arr.slice().sort((a, b) => a - b);
  const qLo = quantile(sorted, alpha / 2);
  const qHi = quantile(sorted, 1 - alpha / 2);
  const scale = Math.sqrt(m / n);
  const ciLo = meanHat - scale * (qHi - meanHat);
  const ciHi = meanHat - scale * (qLo - meanHat);

  return { method: "subsample", meanHat, m, seSubsample, seNScaled, ciLo, ciHi, alpha, B, nUsed: n, replicates: arr };
}

// ─── 3. Permutation test (two-sample mean difference) ─────────────────────────
export function permutationTwoSampleMean(valuesA, valuesB, B = 2000) {
  const a = clean(valuesA);
  const b = clean(valuesB);
  if (a.length < 2 || b.length < 2) return { error: "Each group needs at least 2 finite observations." };
  if (!(B >= 50)) return { error: "B must be ≥ 50." };

  const nA = a.length, nB = b.length;
  const meanA = mean(a), meanB = mean(b);
  const diffObserved = meanA - meanB;

  const pooled = a.concat(b);
  const replicates = new Float64Array(B);
  let countAtLeast = 0;
  const absObs = Math.abs(diffObserved);

  for (let bi = 0; bi < B; bi++) {
    shuffleInPlace(pooled);
    let sA = 0;
    for (let i = 0; i < nA; i++) sA += pooled[i];
    let sB = 0;
    for (let i = nA; i < nA + nB; i++) sB += pooled[i];
    const d = sA / nA - sB / nB;
    replicates[bi] = d;
    if (Math.abs(d) >= absObs) countAtLeast++;
  }
  const pTwoSided = (1 + countAtLeast) / (B + 1);

  return {
    method: "permutation",
    meanA, meanB, diffObserved,
    nA, nB, B,
    pTwoSided,
    replicates: Array.from(replicates),
  };
}
