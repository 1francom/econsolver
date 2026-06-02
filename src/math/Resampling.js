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
//   - All RNG calls go through the shared seeded PRNG (rng.js / makeRNG). Pass
//     an explicit `seed` for reproducible runs; omit it (null) to auto-seed,
//     in which case the resolved seed is echoed back in the result.
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

// ─── 1. Bootstrap mean (with replacement) ─────────────────────────────────────
// Backward-compatible mean bootstrap (percentile CI). Routed through the seeded
// engine; accepts an optional seed for reproducibility.
export function bootstrapMean(values, B = 2000, alpha = 0.05, seed = null) {
  const r = bootstrapStatistic(values, "mean", { B, alpha, ciType: "percentile", seed });
  if (r.error) return r;
  return { method: "bootstrap", meanHat: r.estimate, seBoot: r.bootSE, ciLo: r.ciLow, ciHi: r.ciHigh, alpha, B, nUsed: clean(values).length, seed: r.seed, replicates: r.replicates };
}

// ─── 2. Subsample mean (without replacement) ──────────────────────────────────
export function subsampleMean(values, m, B = 2000, alpha = 0.05, seed = null) {
  const v = clean(values);
  const n = v.length;
  if (n < 3) return { error: "Need at least 3 finite observations." };
  if (!(m >= 2 && m < n)) return { error: `Subsample size m must satisfy 2 ≤ m < n (n = ${n}).` };
  const { rand } = makeRNG(seed);

  const meanHat = mean(v);
  const scratch = v.slice();
  const replicates = new Float64Array(B);
  for (let b = 0; b < B; b++) {
    // Partial Fisher-Yates: pick m distinct values from scratch.
    let s = 0;
    for (let i = 0; i < m; i++) {
      const j = i + Math.floor(rand() * (n - i));
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

// ─── 3. Permutation test (generalized two-group contrast) ─────────────────────
// ─── CONTRAST REGISTRY (two-group, operate on (a[], b[])) ─────────────────────
const CONTRASTS = {
  diffMeans:   (a, b) => mean(a) - mean(b),
  diffMedians: (a, b) => median(a) - median(b),
  diffSd:      (a, b) => sd(a) - sd(b),
  meanRatio:   (a, b) => mean(a) / mean(b),
};

// C(total, choose) with early bail to Infinity above ~1e12 (avoids overflow).
function combinations(total, choose) {
  if (choose < 0 || choose > total) return 0;
  choose = Math.min(choose, total - choose);
  let c = 1;
  for (let i = 0; i < choose; i++) {
    c = c * (total - i) / (i + 1);
    if (c > 1e12) return Infinity;
  }
  return Math.round(c);
}

// Generalized permutation/randomization test of H0: the two groups are
// exchangeable, for an arbitrary contrast. Exact enumeration when
// exact===true OR (exact===null AND C(nA+nB, nA) ≤ 50000); otherwise seeded
// Monte Carlo. p-value: exact uses the unbiased count over all permutations;
// Monte Carlo keeps the +1 finite-sample correction.
export function permutationTest(a, b, statName = "diffMeans", { B = 2000, exact = null, seed = null, alternative = "two-sided" } = {}) {
  const A = clean(a), Bv = clean(b);
  if (A.length < 2 || Bv.length < 2) return { error: "Each group needs at least 2 finite observations." };
  const contrast = CONTRASTS[statName];
  if (!contrast) return { error: `Unknown contrast '${statName}'.` };
  const nA = A.length, nB = Bv.length, N = nA + nB;
  const pooled = A.concat(Bv);
  const observed = contrast(A, Bv);
  const total = combinations(N, nA);
  const doExact = exact === true || (exact === null && total !== Infinity && total <= 50000);

  const cmp = (d) => {
    if (alternative === "greater") return d >= observed - 1e-12;
    if (alternative === "less") return d <= observed + 1e-12;
    return Math.abs(d) >= Math.abs(observed) - 1e-12;
  };

  const replicates = [];
  let extreme = 0;

  if (doExact) {
    const idx = Array.from({ length: nA }, (_, i) => i);
    const used = new Array(N);
    let nPerm = 0;
    while (true) {
      used.fill(false);
      for (let i = 0; i < nA; i++) used[idx[i]] = true;
      const gA = [], gB = [];
      for (let i = 0; i < N; i++) (used[i] ? gA : gB).push(pooled[i]);
      const d = contrast(gA, gB);
      replicates.push(d); nPerm++;
      if (cmp(d)) extreme++;
      let p = nA - 1;
      while (p >= 0 && idx[p] === N - nA + p) p--;
      if (p < 0) break;
      idx[p]++;
      for (let k = p + 1; k < nA; k++) idx[k] = idx[k - 1] + 1;
    }
    return { stat: statName, contrast: statName, observed, pValue: extreme / nPerm, exact: true, nPerm, seed: null, replicates, alternative };
  }

  if (!(B >= 50)) return { error: "B must be ≥ 50." };
  const { rand, seed: usedSeed } = makeRNG(seed);
  for (let bi = 0; bi < B; bi++) {
    const sh = shuffle(rand, pooled);
    const d = contrast(sh.slice(0, nA), sh.slice(nA));
    replicates.push(d);
    if (cmp(d)) extreme++;
  }
  return { stat: statName, contrast: statName, observed, pValue: (1 + extreme) / (B + 1), exact: false, nPerm: B, seed: usedSeed, replicates, alternative };
}

// Backward-compatible two-sample mean-difference permutation (Monte Carlo).
export function permutationTwoSampleMean(valuesA, valuesB, B = 2000) {
  const r = permutationTest(valuesA, valuesB, "diffMeans", { B, exact: false });
  if (r.error) return r;
  const a = clean(valuesA), b = clean(valuesB);
  return { method: "permutation", meanA: mean(a), meanB: mean(b), diffObserved: r.observed, nA: a.length, nB: b.length, B, pTwoSided: r.pValue, replicates: r.replicates };
}
