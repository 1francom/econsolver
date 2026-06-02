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

const SUITES = [["rng", suiteRNG], ["pf", suitePf], ["two-mean", suiteTwoMean], ["paired", suitePaired], ["prop", suiteProp], ["corr", suiteCorr], ["var-ratio", suiteVarRatio]];

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
