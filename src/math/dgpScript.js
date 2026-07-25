// ─── ECON STUDIO · src/math/dgpScript.js ─────────────────────────────────────
// R / Python / Stata expressions for the distributions that `dgpDraw.js` draws.
//
// Single source shared by the Simulate tab's script preview and the
// `vector_assign` translators in `pipeline/stepTranslators.js`, so a
// distribution cannot be supported in one surface and silently lose its
// replication form in the other.
//
// IMPORTANT — drawn values will NOT match the app's output. Litux draws from a
// seeded mulberry32 stream; R, NumPy and Stata use their own generators. The
// DISTRIBUTION matches, the realised numbers do not. Every caller is expected
// to emit RNG_NOTE alongside the generated line.
//
// The `n` argument is the target length as written in the host language —
// "n" inside a Simulate script, "nrow(df)" / "len(df)" inside a pipeline
// script. Stata is row-wise and takes no length.
//
// Coverage: Normal, Uniform, Bernoulli, Poisson, Exponential, t, Chi-squared,
// Categorical, GroupID, CycleID. Stata Categorical is the one case that cannot
// be a single expression (it needs a scratch uniform column), so
// `distExprStata` returns null for it and the caller emits the multi-line form.

import { parseLevels } from "./dgpDraw.js";

// The distributions `drawSamples` can actually draw, in menu order. Simulate
// extends this list with its own non-drawing variable kinds (Constant,
// Sequence, Expression, ForLoop, WhileLoop); anything listed HERE must be
// emittable by all three script emitters below.
export const DRAW_DISTS = [
  "Normal", "Uniform", "Bernoulli", "Poisson", "Exponential",
  "t", "Chi-squared", "Categorical", "GroupID", "CycleID",
];

export const DRAW_DIST_DEFAULTS = {
  Normal:        { mean: 0, sd: 1 },
  Uniform:       { min: 0, max: 1 },
  Bernoulli:     { p: 0.5 },
  Poisson:       { lambda: 2 },
  Exponential:   { lambda: 1 },
  t:             { df: 5 },
  "Chi-squared": { df: 3 },
  Categorical:   { levels: "Control,Treatment", probs: "", asCode: false },
  GroupID:       { groups: "10" },
  CycleID:       { period: "5" },
};

// Editable fields per distribution: [key, label, placeholder, type].
// Data only — each surface renders its own inputs from this.
export const DRAW_DIST_FIELDS = {
  Normal:        [["mean", "Mean", "0", "number"], ["sd", "SD", "1", "number"]],
  Uniform:       [["min", "Min", "0", "number"], ["max", "Max", "1", "number"]],
  Bernoulli:     [["p", "P(1)", "0.5", "number"]],
  Poisson:       [["lambda", "Lambda", "2", "number"]],
  Exponential:   [["lambda", "Rate", "1", "number"]],
  t:             [["df", "df", "5", "number"]],
  "Chi-squared": [["df", "df", "3", "number"]],
  Categorical:   [["levels", "Levels (comma-separated)", "Control,Treatment", "text"],
                  ["probs", "Probabilities (optional)", "0.5,0.5", "text"]],
  GroupID:       [["groups", "Groups", "10", "number"]],
  CycleID:       [["period", "Period", "5", "number"]],
};

export const RNG_NOTE =
  "Litux uses a seeded mulberry32 RNG; drawn values differ but the distribution matches";

const num = (v, d) => { const x = Number(v); return Number.isFinite(x) ? x : d; };
const int = (v, d) => Math.max(1, Math.floor(num(v, d)));

// Categorical levels plus the two presentation flags the emitters need:
// `allNum` (levels are all numeric, so no quoting) and `asCode` (emit 0..k-1
// integer codes instead of the labels themselves).
export function catInfo(params = {}) {
  const { levels, probs } = parseLevels(params);
  const allNum = levels.length > 0 &&
    levels.every(s => /^-?\d*\.?\d+(?:e-?\d+)?$/i.test(s));
  const asCode = params.asCode === true || params.asCode === "true";
  return { levels, probs, allNum, asCode, k: levels.length };
}

export function distExprR(dist, params = {}, n = "n") {
  const p = params;
  switch (dist) {
    case "Normal":       return `rnorm(${n}, mean=${num(p.mean, 0)}, sd=${num(p.sd, 1)})`;
    case "Uniform":      return `runif(${n}, min=${num(p.min, 0)}, max=${num(p.max, 1)})`;
    case "Bernoulli":    return `rbinom(${n}, 1, prob=${num(p.p, 0.5)})`;
    case "Poisson":      return `rpois(${n}, lambda=${num(p.lambda, 1)})`;
    case "Exponential":  return `rexp(${n}, rate=${num(p.lambda, 1)})`;
    case "t":            return `rt(${n}, df=${num(p.df, 5)})`;
    case "Chi-squared":  return `rchisq(${n}, df=${num(p.df, 3)})`;
    case "Categorical": {
      const { levels, probs, allNum, asCode, k } = catInfo(p);
      if (!k) return null;
      const vec = asCode ? `0:${Math.max(0, k - 1)}`
        : allNum ? `c(${levels.join(", ")})`
        : `c(${levels.map(s => `"${s}"`).join(", ")})`;
      return `sample(${vec}, ${n}, replace=TRUE, prob=c(${probs.map(x => x.toFixed(4)).join(", ")}))`;
    }
    case "GroupID": {
      const G = int(p.groups, 1);
      return `rep(1:${G}, each=ceiling(${n}/${G}))[1:${n}]`;
    }
    case "CycleID":      return `rep(1:${int(p.period, 1)}, length.out=${n})`;
    default:             return null;
  }
}

export function distExprPy(dist, params = {}, n = "n", rng = "rng") {
  const p = params;
  switch (dist) {
    case "Normal":       return `${rng}.normal(${num(p.mean, 0)}, ${num(p.sd, 1)}, ${n})`;
    case "Uniform":      return `${rng}.uniform(${num(p.min, 0)}, ${num(p.max, 1)}, ${n})`;
    case "Bernoulli":    return `${rng}.binomial(1, ${num(p.p, 0.5)}, ${n})`;
    case "Poisson":      return `${rng}.poisson(${num(p.lambda, 1)}, ${n})`;
    case "Exponential":  return `${rng}.exponential(1/${num(p.lambda, 1)}, ${n})`;
    case "t":            return `${rng}.standard_t(${num(p.df, 5)}, ${n})`;
    case "Chi-squared":  return `${rng}.chisquare(${num(p.df, 3)}, ${n})`;
    case "Categorical": {
      const { levels, probs, allNum, asCode, k } = catInfo(p);
      if (!k) return null;
      const vec = asCode ? `list(range(${k}))`
        : allNum ? `[${levels.join(", ")}]`
        : `[${levels.map(s => JSON.stringify(s)).join(", ")}]`;
      return `${rng}.choice(${vec}, size=${n}, p=[${probs.map(x => x.toFixed(4)).join(", ")}])`;
    }
    case "GroupID": {
      const G = int(p.groups, 1);
      return `np.repeat(np.arange(1, ${G} + 1), int(np.ceil(${n} / ${G})))[:${n}]`;
    }
    case "CycleID": {
      const T = int(p.period, 1);
      return `np.tile(np.arange(1, ${T} + 1), int(np.ceil(${n} / ${T})))[:${n}]`;
    }
    default:             return null;
  }
}

// Stata is row-wise, so these are per-observation expressions. Categorical is
// the exception — it needs a scratch uniform column, so it returns null and the
// caller emits `stataCategoricalLines` instead.
export function distExprStata(dist, params = {}) {
  const p = params;
  switch (dist) {
    case "Normal":       return `rnormal(${num(p.mean, 0)}, ${num(p.sd, 1)})`;
    case "Uniform":      return `runiform(${num(p.min, 0)}, ${num(p.max, 1)})`;
    case "Bernoulli":    return `rbinomial(1, ${num(p.p, 0.5)})`;
    case "Poisson":      return `rpoisson(${num(p.lambda, 1)})`;
    case "Exponential":  return `rexponential(1/${num(p.lambda, 1)})`;
    case "t":            return `rt(${num(p.df, 5)})`;
    case "Chi-squared":  return `rchi2(${num(p.df, 3)})`;
    case "GroupID":      return `ceil(_n / ceil(_N / ${int(p.groups, 1)}))`;
    case "CycleID":      return `mod(_n - 1, ${int(p.period, 1)}) + 1`;
    case "Categorical":  return null; // multi-line — see stataCategoricalLines
    default:             return null;
  }
}

// Weighted categorical draw in Stata: one scratch uniform column plus a nested
// cond() ladder over the cumulative probabilities. Emits integer codes 0..k-1,
// which is what Stata can represent without value labels.
export function stataCategoricalLines(outVar, params = {}) {
  const { levels, probs, k } = catInfo(params);
  if (!k) return null;
  let cum = 0;
  const thr = probs.map(x => (cum += x, cum));
  let expr = `${Math.max(0, k - 1)}`;
  for (let j = k - 2; j >= 0; j--) expr = `cond(_u_${outVar} < ${thr[j].toFixed(4)}, ${j}, ${expr})`;
  return [
    `* Categorical: ${outVar} ∈ {${levels.join(", ")}} (integer codes 0..${Math.max(0, k - 1)})`,
    `generate double _u_${outVar} = runiform()`,
    `generate ${outVar} = ${expr}`,
    `drop _u_${outVar}`,
  ];
}
