// ─── ECON STUDIO · src/math/__validation__/inferenceValidation.js ─────────────
// Node-runnable validation for the Stat & Simulation data-level inference layer.
// Run:  node src/math/__validation__/inferenceValidation.js
// Also exposes window.__validation.inference when imported in the browser.
//
// Pure-JS only — these modules import nothing browser-specific, so they run
// under Node. Each suite returns { pass, fail }. Any failure sets a non-zero
// process exit code so CI / a human notices.

import { mulberry32, makeRNG, randInt, shuffle, sampleWithReplacement } from "../rng.js";
import { pf } from "../calcEngine.js";
import { twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest, correlationTest, varianceRatioTest } from "../SampleTests.js";
import { jackknife, bootstrapStatistic, bootstrapMean, permutationTest, permutationTwoSampleMean } from "../Resampling.js";
import { quantileTreatmentEffect } from "../QTE.js";

const TOL = 1e-9;
const TOL_STAT = 1e-6;  // statistics / estimates: 6 dp
const TOL_P = 1e-3;     // p-values: 3 dp

function near(a, b, tol) {
  if (!isFinite(a) && !isFinite(b)) return true;
  return Math.abs(a - b) <= tol;
}

let _fails = [];
function check(label, got, want, tol = TOL_STAT) {
  const ok = near(got, want, tol);
  if (!ok) _fails.push(`✗ ${label}: got ${got}, want ${want}, diff=${Math.abs(got - want).toExponential(3)}`);
  return ok;
}

function runSuite(name, fn) {
  _fails = [];
  let pass = 0, fail = 0;
  try {
    const r = fn(check);
    pass = r.pass; fail = r.fail;
  } catch (e) {
    _fails.push("EXCEPTION: " + e.stack);
    fail = 1;
  }
  const localFails = _fails.slice();
  return { name, pass, fail, ok: fail === 0, errors: localFails };
}

// ─── SUITES ───────────────────────────────────────────────────────────────────
function suiteRNG(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Determinism: same seed → identical stream.
  const r1 = mulberry32(123), r2 = mulberry32(123);
  T(check("rng.deterministic", r1(), r2(), TOL));
  // Range [0,1).
  const r3 = mulberry32(7);
  let inRange = true;
  for (let i = 0; i < 1000; i++) { const v = r3(); if (v < 0 || v >= 1) inRange = false; }
  T(inRange ? check("rng.range", 1, 1, TOL) : check("rng.range", 0, 1, TOL));
  // makeRNG resolves a numeric seed and echoes it back.
  const m = makeRNG(42);
  T(check("makeRNG.seed", m.seed, 42, TOL));
  // makeRNG(null) yields a finite resolved seed (auto-seed).
  const m2 = makeRNG(null);
  T(check("makeRNG.autoseed.finite", isFinite(m2.seed) ? 1 : 0, 1, TOL));
  // randInt in [0,n).
  const r4 = mulberry32(9);
  let intsOk = true;
  for (let i = 0; i < 500; i++) { const k = randInt(r4, 5); if (k < 0 || k >= 5 || k !== Math.floor(k)) intsOk = false; }
  T(check("randInt.range", intsOk ? 1 : 0, 1, TOL));
  // shuffle returns a permutation (same multiset) and a NEW array.
  const src = [1, 2, 3, 4, 5];
  const sh = shuffle(mulberry32(3), src);
  T(check("shuffle.length", sh.length, 5, TOL));
  T(check("shuffle.sum", sh.reduce((a, b) => a + b, 0), 15, TOL));
  T(check("shuffle.nonmutating", src[0], 1, TOL));
  // sampleWithReplacement returns m draws from the array's values.
  const swr = sampleWithReplacement(mulberry32(1), [10, 20], 4);
  T(check("swr.length", swr.length, 4, TOL));
  T(check("swr.values", swr.every(v => v === 10 || v === 20) ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suitePf(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // x <= 0 → 0.
  T(check("pf.zero", pf(0, 4, 4), 0, TOL));
  T(check("pf.negative", pf(-1, 4, 4), 0, TOL));
  // Median-ish symmetry: for equal df, F=1 sits at the median of the F dist
  // only approximately; instead validate against R pf() reference values.
  //   R: pf(1, 4, 4) = 0.5
  T(check("pf.equaldf.at1", pf(1, 4, 4), 0.5, TOL_P));
  //   R: pf(2, 5, 10) = 0.8364716   (qf inverse cross-check)
  T(check("pf.5_10.at2", pf(2, 5, 10), 0.8364716, TOL_P));
  //   R: pf(3, 2, 20) = 0.9268556
  T(check("pf.2_20.at3", pf(3, 2, 20), 0.9268556, TOL_P));
  return { pass, fail };
}

function suiteTwoMean(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const a = [1, 2, 3, 4, 5];   // mean 3, var 2.5
  const b = [2, 3, 4, 5, 6];   // mean 4, var 2.5
  // Pooled: sp2 = 2.5, se = sqrt(2.5*(1/5+1/5)) = 1, diff = -1, t = -1, df = 8.
  const p = twoSampleMeanTest(a, b, { pooled: true });
  T(check("two-mean.pooled.diff", p.estimate, -1, TOL_STAT));
  T(check("two-mean.pooled.se", p.se, 1, TOL_STAT));
  T(check("two-mean.pooled.t", p.stat, -1, TOL_STAT));
  T(check("two-mean.pooled.df", p.df, 8, TOL_STAT));
  // Welch: equal variances & equal n → same se, df = 8 here too.
  const w = twoSampleMeanTest(a, b, {});
  T(check("two-mean.welch.se", w.se, 1, TOL_STAT));
  T(check("two-mean.welch.df", w.df, 8, TOL_STAT));
  // Degenerate group → error object.
  const e = twoSampleMeanTest([1], b, {});
  T(check("two-mean.error", e.error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suitePaired(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // diffs = [-1, 0, 2], mean = 1/3, sd = sqrt(2.3333) = 1.5275252
  // se = sd/sqrt(3) = 0.8819171, t = (1/3)/0.8819171 = 0.3779645, df = 2.
  const a = [1, 2, 4], b = [2, 2, 2];
  const r = pairedMeanTest(a, b, {});
  T(check("paired.estimate", r.estimate, 1 / 3, TOL_STAT));
  T(check("paired.se", r.se, 0.8819171, 1e-6));
  T(check("paired.t", r.stat, 0.3779645, 1e-6));
  T(check("paired.df", r.df, 2, TOL));
  T(check("paired.test", r.test === "paired" ? 1 : 0, 1, TOL));
  // Drops a pair when one side is non-finite.
  const r2 = pairedMeanTest([1, 2, NaN], [2, 2, 9], {});
  T(check("paired.dropNaN.df", r2.df, 1, TOL)); // 2 complete pairs → df = 1
  return { pass, fail };
}

function suiteProp(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // one-prop: 50/100, p0=0.5 → phat=0.5, z=0, p=1.
  const o = onePropTest(50, 100, { p0: 0.5 });
  T(check("one-prop.phat", o.phat, 0.5, TOL_STAT));
  T(check("one-prop.z", o.stat, 0, TOL_STAT));
  T(check("one-prop.p", o.pValue, 1, TOL_P));
  // one-prop: 60/100, p0=0.5 → se=sqrt(.25/100)=0.05, z=(0.6-0.5)/0.05=2.
  const o2 = onePropTest(60, 100, { p0: 0.5 });
  T(check("one-prop.z2", o2.stat, 2, TOL_STAT));
  // two-prop: equal → z=0.
  const t = twoPropTest(50, 100, 50, 100, {});
  T(check("two-prop.z", t.stat, 0, TOL_STAT));
  T(check("two-prop.diff", t.estimate, 0, TOL_STAT));
  // Out-of-range → error.
  T(check("one-prop.error", onePropTest(150, 100, {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suiteCorr(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // a=[1,2,3], b=[1,3,2]: mx=my=2, sxy=1, sxx=syy=2 → r=0.5.
  // df=1, t = 0.5*sqrt(1/(1-0.25)) = 0.5*1.1547005 = 0.5773503.
  const r = correlationTest([1, 2, 3], [1, 3, 2], { method: "pearson" });
  T(check("corr.pearson.r", r.estimate, 0.5, TOL_STAT));
  T(check("corr.pearson.df", r.df, 1, TOL));
  T(check("corr.pearson.t", r.stat, 0.5773503, 1e-6));
  // Spearman on a monotonic-but-nonlinear pair → rank correlation 1.
  const s = correlationTest([1, 2, 3, 4], [1, 4, 9, 16], { method: "spearman" });
  T(check("corr.spearman.r", s.estimate, 1, TOL_STAT));
  T(check("corr.spearman.method", s.method === "spearman" ? 1 : 0, 1, TOL));
  // Too few pairs → error.
  T(check("corr.error", correlationTest([1, 2], [1, 2], {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suiteVarRatio(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Equal variances (both 2.5) → F = 1, df = (4,4), two-sided p = 1.
  const r = varianceRatioTest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6], {});
  T(check("var-ratio.F", r.stat, 1, TOL_STAT));
  T(check("var-ratio.df1", r.df1, 4, TOL));
  T(check("var-ratio.df2", r.df2, 4, TOL));
  T(check("var-ratio.p", r.pValue, 1, TOL_P));
  // a=[1,3,5,7,9] var=10, b var=2.5 → F=4.
  const r2 = varianceRatioTest([1, 3, 5, 7, 9], [2, 3, 4, 5, 6], {});
  T(check("var-ratio.F2", r2.stat, 4, TOL_STAT));
  // Zero-variance group → error.
  T(check("var-ratio.error", varianceRatioTest([2, 2, 2], [1, 2, 3], {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suiteJackknife(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Jackknife of the mean is exactly unbiased: jackEstimate == estimate, bias 0.
  const v = [2, 4, 4, 4, 5, 5, 7, 9]; // mean = 5
  const r = jackknife(v, "mean");
  T(check("jack.estimate", r.estimate, 5, TOL_STAT));
  T(check("jack.jackEstimate", r.jackEstimate, 5, TOL_STAT));
  T(check("jack.bias", r.bias, 0, TOL_STAT));
  // Jackknife SE of the mean = sample SE = s/sqrt(n), with s the SAMPLE sd
  // (n-1 denom). SS=32, n=8 → se = sqrt(32/(8*7)) = sqrt(32/56) = 0.7559289.
  // (NB: 2/sqrt(8) uses the POPULATION sd and is incorrect here.)
  T(check("jack.se", r.se, 0.7559289, 1e-6));
  T(check("jack.loo.length", r.values.length, 8, TOL));
  T(check("jack.error", jackknife([1], "mean").error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suiteBootstrap(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const v = [2, 4, 4, 4, 5, 5, 7, 9]; // mean 5
  // Seeded → reproducible across two calls.
  const r1 = bootstrapStatistic(v, "mean", { B: 500, seed: 42, ciType: "percentile" });
  const r2 = bootstrapStatistic(v, "mean", { B: 500, seed: 42, ciType: "percentile" });
  T(check("boot.repro.estimate", r1.estimate, r2.estimate, TOL));
  T(check("boot.repro.ciLow", r1.ciLow, r2.ciLow, TOL));
  T(check("boot.repro.ciHigh", r1.ciHigh, r2.ciHigh, TOL));
  T(check("boot.estimate", r1.estimate, 5, TOL_STAT));   // point estimate is exact
  T(check("boot.seedEcho", r1.seed, 42, TOL));
  T(check("boot.ci.ordered", r1.ciLow <= r1.ciHigh ? 1 : 0, 1, TOL));
  T(check("boot.replicates.length", r1.replicates.length, 500, TOL));
  // basic + bca run and produce ordered, finite CIs.
  const rb = bootstrapStatistic(v, "median", { B: 800, seed: 7, ciType: "basic" });
  T(check("boot.basic.ordered", (rb.ciLow <= rb.ciHigh && isFinite(rb.ciLow)) ? 1 : 0, 1, TOL));
  const rc = bootstrapStatistic(v, "mean", { B: 800, seed: 7, ciType: "bca" });
  T(check("boot.bca.ordered", (rc.ciLow <= rc.ciHigh && isFinite(rc.ciLow)) ? 1 : 0, 1, TOL));
  // Legacy wrapper still returns the old shape.
  const leg = bootstrapMean(v, 300, 0.05, 1);
  T(check("boot.legacy.shape", (leg.method === "bootstrap" && "meanHat" in leg && "ciLo" in leg) ? 1 : 0, 1, TOL));
  T(check("boot.error", bootstrapStatistic([1], "mean", {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}

function suitePermutation(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Exact: a=[1,2], b=[3,4], diffMeans observed = 1.5-3.5 = -2.
  // 6 splits → |d|≥2 occurs for the two extreme splits → p = 2/6 = 0.3333333.
  const e = permutationTest([1, 2], [3, 4], "diffMeans", { exact: true });
  T(check("perm.exact.observed", e.observed, -2, TOL_STAT));
  T(check("perm.exact.nPerm", e.nPerm, 6, TOL));
  T(check("perm.exact.flag", e.exact ? 1 : 0, 1, TOL));
  T(check("perm.exact.p", e.pValue, 2 / 6, TOL_P));
  // Auto-exact for small samples (exact:null, C(4,2)=6 ≤ 50000).
  const auto = permutationTest([1, 2], [3, 4], "diffMeans", {});
  T(check("perm.auto.exact", auto.exact ? 1 : 0, 1, TOL));
  // Monte Carlo path is seeded → reproducible.
  const big = Array.from({ length: 12 }, (_, i) => i);     // forces C(24,12) > 50000
  const m1 = permutationTest(big, big.map(x => x + 1), "diffMeans", { B: 400, seed: 5 });
  const m2 = permutationTest(big, big.map(x => x + 1), "diffMeans", { B: 400, seed: 5 });
  T(check("perm.mc.notexact", m1.exact ? 0 : 1, 1, TOL));
  T(check("perm.mc.repro", m1.pValue, m2.pValue, TOL));
  T(check("perm.mc.seedEcho", m1.seed, 5, TOL));
  // Legacy wrapper keeps its old shape.
  const leg = permutationTwoSampleMean([1, 2, 3], [4, 5, 6], 200);
  T(check("perm.legacy.shape", (leg.method === "permutation" && "pTwoSided" in leg && "diffObserved" in leg) ? 1 : 0, 1, TOL));
  return { pass, fail };
}

// Cross-check the data-level tests against values printed by
// inferenceRValidation.R (t.test / prop.test / cor.test / var.test). The E
// constants below are R's reference p-values, confirmed to match the
// R-validated pt/pnorm/pf distribution functions in calcEngine.js. Tail
// p-values use TOL_P = 1e-3. If a value disagrees beyond TOL_P, that is a real
// bug to investigate, not a tolerance to widen.
function suiteRCrossCheck(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const E = {
    pooledP: 0.3465935,    // t.test(a,b,var.equal=TRUE)$p.value
    welchP: 0.3465935,     // t.test(a,b)$p.value (equal n & var → same as pooled)
    pairedP: 0.7418011,    // t.test(c(1,2,4),c(2,2,2),paired=TRUE)$p.value
    onePropP: 0.04550026,  // prop.test(60,100,p=.5,correct=FALSE)$p.value
    twoPropP: 1,           // prop.test(c(50,50),c(100,100),correct=FALSE)$p.value
    corrPearsonP: 0.6666667, // cor.test(c(1,2,3),c(1,3,2))$p.value
    corrSpearmanR: 1,      // cor.test(...,method="spearman")$estimate
    varRatioP: 0.2080,     // var.test(c(1,3,5,7,9),c(2,3,4,5,6))$p.value
  };
  const ab = { a: [1, 2, 3, 4, 5], b: [2, 3, 4, 5, 6] };
  T(check("R.pooled.p", twoSampleMeanTest(ab.a, ab.b, { pooled: true }).pValue, E.pooledP, TOL_P));
  T(check("R.welch.p", twoSampleMeanTest(ab.a, ab.b, {}).pValue, E.welchP, TOL_P));
  T(check("R.paired.p", pairedMeanTest([1, 2, 4], [2, 2, 2], {}).pValue, E.pairedP, TOL_P));
  T(check("R.oneProp.p", onePropTest(60, 100, { p0: 0.5 }).pValue, E.onePropP, TOL_P));
  T(check("R.twoProp.p", twoPropTest(50, 100, 50, 100, {}).pValue, E.twoPropP, TOL_P));
  T(check("R.corr.pearson.p", correlationTest([1, 2, 3], [1, 3, 2], { method: "pearson" }).pValue, E.corrPearsonP, TOL_P));
  T(check("R.corr.spearman.r", correlationTest([1, 2, 3, 4], [1, 4, 9, 16], { method: "spearman" }).estimate, E.corrSpearmanR, TOL_STAT));
  T(check("R.varRatio.p", varianceRatioTest([1, 3, 5, 7, 9], [2, 3, 4, 5, 6], {}).pValue, E.varRatioP, TOL_P));
  return { pass, fail };
}

// QTE — unconditional quantile treatment effect. Fixture (location+scale shift):
//   y0 = 1,2,3,4,5   y1 = 2,4,6,8,10   D = 0 / 1
// Type-7 quantiles (R quantile(type=7), idx = τ·(n−1)):
//   q0(.1,.25,.5,.75,.9) = 1.4, 2, 3, 4, 4.6
//   q1(.1,.25,.5,.75,.9) = 2.8, 4, 6, 8, 9.2
//   qte                  = 1.4, 2, 3, 4, 4.6
//   ate = mean1 − mean0 = 6 − 3 = 3 (== lm(Y~D) slope)
// At τ ∈ {.25,.5,.75} the idx is an integer (a data point) so the QTE equals the
// difference of order statistics — identical to rq(Y~D,τ)$coef[2] (Method 1==2).
function suiteQTE(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const outcome   = [1, 2, 3, 4, 5, 2, 4, 6, 8, 10];
  const treatment = [0, 0, 0, 0, 0, 1, 1, 1, 1, 1];
  const taus = [0.1, 0.25, 0.5, 0.75, 0.9];
  const r = quantileTreatmentEffect(outcome, treatment, { taus, ci: "none" });
  // Group quantiles.
  const eq0 = [1.4, 2, 3, 4, 4.6], eq1 = [2.8, 4, 6, 8, 9.2], eqte = [1.4, 2, 3, 4, 4.6];
  for (let j = 0; j < taus.length; j++) {
    T(check(`qte.q0[${taus[j]}]`, r.q0[j], eq0[j], TOL_STAT));
    T(check(`qte.q1[${taus[j]}]`, r.q1[j], eq1[j], TOL_STAT));
    T(check(`qte.qte[${taus[j]}]`, r.qte[j], eqte[j], TOL_STAT));
  }
  // ATE benchmark == lm(Y~D) slope.
  T(check("qte.ate", r.ate, 3, TOL_STAT));
  T(check("qte.mean0", r.mean0, 3, TOL_STAT));
  T(check("qte.mean1", r.mean1, 6, TOL_STAT));
  // Group sizes + chosen levels (treated defaults to the larger level).
  T(check("qte.n0", r.n0, 5, TOL));
  T(check("qte.n1", r.n1, 5, TOL));
  T(check("qte.treatedLevel", r.treatedLevel, 1, TOL));
  T(check("qte.controlLevel", r.controlLevel, 0, TOL));
  // ECDF coordinates: last cumulative proportion is 1, monotone.
  T(check("qte.ecdf0.last", r.ecdf0.F[r.ecdf0.F.length - 1], 1, TOL_STAT));
  T(check("qte.ecdf1.last", r.ecdf1.F[r.ecdf1.F.length - 1], 1, TOL_STAT));
  // Binary guard: 3 distinct levels → error.
  const e = quantileTreatmentEffect([1, 2, 3, 4], [0, 1, 2, 0], { ci: "none" });
  T(check("qte.nonbinary.error", e.error ? 1 : 0, 1, TOL));
  // Bootstrap band: seeded → reproducible, ordered, brackets the point estimate region.
  const b1 = quantileTreatmentEffect(outcome, treatment, { taus, ci: "percentile", B: 400, seed: 42 });
  const b2 = quantileTreatmentEffect(outcome, treatment, { taus, ci: "percentile", B: 400, seed: 42 });
  T(check("qte.boot.repro", b1.ci.low[2], b2.ci.low[2], TOL));
  T(check("qte.boot.seedEcho", b1.seed, 42, TOL));
  T(check("qte.boot.ordered", b1.ci.low[2] <= b1.ci.high[2] ? 1 : 0, 1, TOL));
  // log transform drops non-positive outcomes (count surfaced).
  const lg = quantileTreatmentEffect([0, 1, 2, 4, 8, -1, 1, 2, 4, 8], [0, 0, 0, 0, 0, 1, 1, 1, 1, 1], { taus, transform: "log", ci: "none" });
  T(check("qte.log.dropped", lg.droppedLog, 2, TOL)); // the 0 and the -1
  T(check("qte.log.transformFlag", lg.transform === "log" ? 1 : 0, 1, TOL));
  return { pass, fail };
}

const SUITES = [["rng", suiteRNG], ["pf", suitePf], ["two-mean", suiteTwoMean], ["paired", suitePaired], ["prop", suiteProp], ["corr", suiteCorr], ["var-ratio", suiteVarRatio], ["jackknife", suiteJackknife], ["bootstrap", suiteBootstrap], ["permutation", suitePermutation], ["qte", suiteQTE], ["R-crosscheck", suiteRCrossCheck]];

export function runInferenceValidation() {
  const results = SUITES.map(([n, fn]) => runSuite(n, fn));
  return results;
}

// Node entrypoint
if (typeof process !== "undefined" && process.argv && process.argv[1] && new URL(import.meta.url).pathname.replace(/^\//, "") === process.argv[1].replace(/\\/g, "/")) {
  const results = runInferenceValidation();
  let totalFail = 0;
  for (const r of results) {
    console.log(`${r.ok ? "✓" : "✗"} ${r.name}: ${r.pass} pass, ${r.fail} fail`);
    r.errors.forEach(e => console.log("    " + e));
    totalFail += r.fail;
  }
  if (totalFail > 0) process.exitCode = 1;
}

// Browser exposure
if (typeof window !== "undefined") {
  window.__validation = window.__validation || {};
  window.__validation.inference = runInferenceValidation;
}
