// ─── ECON STUDIO · src/math/QTE.js ────────────────────────────────────────────
// Unconditional Quantile Treatment Effects. Pure JS, no React, no side effects.
//
// Given a numeric outcome and a binary treatment indicator, estimate over a τ grid
//
//     QTE_τ = F₁⁻¹(τ) − F₀⁻¹(τ)
//
// the difference of group sample quantiles. Under random assignment this is the
// identified QTE (LMU "Applied Causal Analysis", part2 "Method 1") and is
// numerically identical to the quantile regression of Y on D (Method 2). It needs
// no regression engine — it is a two-sample distributional comparison over
// number[] columns, the Stat & Simulation contract.
//
// Reuses the single shared seeded PRNG (rng.js) and the type-7 empirical quantile
// from Resampling.js — no duplicated quantile logic.

import { makeRNG, sampleWithReplacement } from "./rng.js";
import { quantile } from "./Resampling.js";
import { pnorm, qnorm } from "./calcEngine.js";

function mean(arr) {
  if (!arr.length) return NaN;
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return s / arr.length;
}

// Per-group sorted quantile vector over the τ grid.
function quantilesAt(sorted, taus) {
  return taus.map(t => quantile(sorted, t));
}

// Empirical CDF step coordinates: sorted unique x with cumulative proportion ≤ x.
function ecdf(sorted) {
  const x = [], F = [];
  const n = sorted.length;
  let i = 0;
  while (i < n) {
    let j = i;
    while (j + 1 < n && sorted[j + 1] === sorted[i]) j++;
    x.push(sorted[i]);
    F.push((j + 1) / n);
    i = j + 1;
  }
  return { x, F };
}

export function quantileTreatmentEffect(outcome, treatment, {
  taus = [0.1, 0.25, 0.5, 0.75, 0.9],
  treatedLevel = null,
  transform = "none",
  ci = "percentile",
  B = 2000,
  alpha = 0.05,
  seed = null,
} = {}) {
  if (!Array.isArray(outcome) || !Array.isArray(treatment) || outcome.length !== treatment.length) {
    return { error: "Outcome and treatment must be equal-length arrays." };
  }

  // Row-wise pairing; drop rows where either side is non-finite/undefined.
  const pairs = [];
  let droppedLog = 0;
  for (let i = 0; i < outcome.length; i++) {
    let y = outcome[i];
    const d = treatment[i];
    if (typeof y !== "number" || !isFinite(y)) continue;
    if (d === null || d === undefined || (typeof d === "number" && !isFinite(d))) continue;
    if (transform === "log") {
      if (y <= 0) { droppedLog++; continue; }
      y = Math.log(y);
    }
    pairs.push({ y, d });
  }
  if (pairs.length < 4) return { error: "Need at least 4 complete observations." };

  // Distinct treatment levels.
  const levelSet = [];
  for (const p of pairs) if (!levelSet.some(l => l === p.d)) levelSet.push(p.d);
  if (levelSet.length !== 2) {
    return { error: `Treatment must be binary; found ${levelSet.length} level${levelSet.length === 1 ? "" : "s"}.` };
  }

  // Default treated = larger level (handles tg=2 vs 0 and 1 vs 0 like the slides).
  const numeric = levelSet.every(l => typeof l === "number");
  let treated = treatedLevel;
  if (treated === null || treated === undefined || !levelSet.some(l => l === treated)) {
    treated = numeric ? Math.max(...levelSet) : levelSet[levelSet.length - 1];
  }
  const control = levelSet.find(l => l !== treated);

  const y0 = pairs.filter(p => p.d === control).map(p => p.y);
  const y1 = pairs.filter(p => p.d === treated).map(p => p.y);
  if (y0.length < 2 || y1.length < 2) return { error: "Each group needs at least 2 observations." };

  const s0 = y0.slice().sort((a, b) => a - b);
  const s1 = y1.slice().sort((a, b) => a - b);

  const q0 = quantilesAt(s0, taus);
  const q1 = quantilesAt(s1, taus);
  const qte = taus.map((_, j) => q1[j] - q0[j]);

  const mean0 = mean(y0), mean1 = mean(y1);
  const ate = mean1 - mean0;

  const result = {
    taus: taus.slice(),
    qte, q0, q1,
    ate, mean0, mean1,
    n0: y0.length, n1: y1.length,
    treatedLevel: treated, controlLevel: control, transform,
    droppedLog: transform === "log" ? droppedLog : 0,
    ci: null,
    ecdf0: ecdf(s0), ecdf1: ecdf(s1),
    seed: null,
  };

  // ── Bootstrap band (resample within each group) ──────────────────────────────
  if (ci && ci !== "none") {
    if (!(B >= 50)) return { error: "B must be ≥ 50." };
    const { rand, seed: usedSeed } = makeRNG(seed);
    result.seed = usedSeed;

    const T = taus.length;
    // reps[j] = bootstrap replicate vector for τ_j.
    const reps = Array.from({ length: T }, () => new Array(B));
    for (let b = 0; b < B; b++) {
      const b0 = sampleWithReplacement(rand, y0, y0.length).sort((a, c) => a - c);
      const b1 = sampleWithReplacement(rand, y1, y1.length).sort((a, c) => a - c);
      for (let j = 0; j < T; j++) reps[j][b] = quantile(b1, taus[j]) - quantile(b0, taus[j]);
    }

    const low = new Array(T), high = new Array(T);
    for (let j = 0; j < T; j++) {
      const sorted = reps[j].slice().sort((a, c) => a - c);
      const theta = qte[j];
      if (ci === "basic") {
        low[j] = 2 * theta - quantile(sorted, 1 - alpha / 2);
        high[j] = 2 * theta - quantile(sorted, alpha / 2);
      } else if (ci === "bca") {
        let less = 0; for (let b = 0; b < B; b++) if (reps[j][b] < theta) less++;
        const z0 = qnorm(less / B);
        // Acceleration via jackknife over the pooled within-group LOO of QTE_τ.
        const loo = [];
        for (let i = 0; i < s0.length; i++) {
          const cut = s0.slice(0, i).concat(s0.slice(i + 1));
          loo.push(quantile(s1, taus[j]) - quantile(cut, taus[j]));
        }
        for (let i = 0; i < s1.length; i++) {
          const cut = s1.slice(0, i).concat(s1.slice(i + 1));
          loo.push(quantile(cut, taus[j]) - quantile(s0, taus[j]));
        }
        const lm = mean(loo);
        let num = 0, den = 0;
        for (let i = 0; i < loo.length; i++) { const dd = lm - loo[i]; num += dd * dd * dd; den += dd * dd; }
        const a = num / (6 * Math.pow(den, 1.5));
        if (!isFinite(z0) || !isFinite(a)) {
          low[j] = quantile(sorted, alpha / 2); high[j] = quantile(sorted, 1 - alpha / 2);
        } else {
          const zl = qnorm(alpha / 2), zu = qnorm(1 - alpha / 2);
          const a1 = pnorm(z0 + (z0 + zl) / (1 - a * (z0 + zl)));
          const a2 = pnorm(z0 + (z0 + zu) / (1 - a * (z0 + zu)));
          low[j] = quantile(sorted, a1); high[j] = quantile(sorted, a2);
        }
      } else { // percentile
        low[j] = quantile(sorted, alpha / 2);
        high[j] = quantile(sorted, 1 - alpha / 2);
      }
    }
    result.ci = { type: ci, low, high, alpha, B };
  }

  return result;
}
