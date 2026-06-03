# Stat & Simulation Inference Deepening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add data-level parametric tests, a general seeded bootstrap (percentile/basic/BCa) + jackknife, and a generalized permutation test (exact + Monte Carlo) to the Stat & Simulation module, all reproducible via one shared PRNG.

**Architecture:** Pure-JS math in `src/math/` (zero React) extended in place; a new shared `src/math/rng.js` replaces three duplicated PRNGs and the unseeded `Math.random` in resampling. A Node-runnable validation harness (`__validation__/inferenceValidation.js`) gives a red/green loop on the math; UI extensions in `SampleTestPanel.jsx` / `StatWorkspace.jsx` are browser-validated per project convention. Coefficient-level inference is explicitly deferred to Spec B.

**Tech Stack:** React 19 + Vite (ESM, `"type":"module"`), Node v24 for math validation, no UI libraries (inline styles + `C` color object + `mono`). Spec: `docs/superpowers/specs/2026-06-01-stat-sim-inference-deepening-design.md`.

**Validation convention (project-specific, replaces pytest):** This repo has no test runner. The math files I touch are pure JS and import nothing browser-only, so they run under `node`. Each math task adds a *suite* to `src/math/__validation__/inferenceValidation.js`; running `node src/math/__validation__/inferenceValidation.js` is the red/green loop (it sets `process.exitCode = 1` on any failure). UI tasks are validated in the browser by Franco, matching the established workflow.

**Commit prefix convention (from git log):** `feat(statsim): …`, `fix(statsim): …`.

---

## File Structure

**New:**
- `src/math/rng.js` — shared seeded PRNG (`mulberry32`, `makeRNG`, `randInt`, `shuffle`, `sampleWithReplacement`).
- `src/math/__validation__/inferenceValidation.js` — Node-runnable + window-exposed validation harness for all new math.

**Modified:**
- `src/math/calcEngine.js` — add exported `pf` (F CDF) + barrel entry.
- `src/math/SampleTests.js` — 6 new parametric tests.
- `src/math/Resampling.js` — statistic/contrast registries, `bootstrapStatistic`, `jackknife`, `permutationTest`; existing exports become seeded wrappers; import from `rng.js`.
- `src/components/tabs/statsim/SampleTestPanel.jsx` — two-mean / paired / one-prop / two-prop / correlation / var-ratio modes.
- `src/components/tabs/statsim/StatWorkspace.jsx` — statistic/CI/seed/contrast controls; drop local PRNG; import `rng.js`; SessionLog tagging.
- `src/components/tabs/SimulateTab.jsx` — import PRNG from `rng.js` (drop local copy).

---

## Task ordering / dependencies

Tasks 1–10 are pure math with a Node red/green loop and must land in order (later tasks import earlier ones). Tasks 11–13 are UI (browser-validated) and depend on the math being present. Task 14 wires the harness to `window` and documents the R cross-check.

This plan file covers **Tasks 1–4**. Tasks 5–14 are appended in follow-up edits to keep each piece reviewable.

---

### Task 1: Shared seeded PRNG — `src/math/rng.js`

**Files:**
- Create: `src/math/rng.js`
- Create: `src/math/__validation__/inferenceValidation.js`

- [ ] **Step 1: Create the validation harness skeleton with a failing RNG suite**

Create `src/math/__validation__/inferenceValidation.js`:

```js
// ─── ECON STUDIO · src/math/__validation__/inferenceValidation.js ─────────────
// Node-runnable validation for the Stat & Simulation data-level inference layer.
// Run:  node src/math/__validation__/inferenceValidation.js
// Also exposes window.__validation.inference when imported in the browser.
//
// Pure-JS only — these modules import nothing browser-specific, so they run
// under Node. Each suite returns { pass, fail }. Any failure sets a non-zero
// process exit code so CI / a human notices.

import { mulberry32, makeRNG, randInt, shuffle, sampleWithReplacement } from "../rng.js";

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

const SUITES = [["rng", suiteRNG]];

export function runInferenceValidation() {
  const results = SUITES.map(([n, fn]) => runSuite(n, fn));
  return results;
}

// Node entrypoint
if (typeof process !== "undefined" && process.argv && import.meta.url === `file://${process.argv[1].replace(/\\/g, "/")}`) {
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
```

- [ ] **Step 2: Run the harness to verify it fails (rng.js does not exist yet)**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` for `../rng.js` (the import cannot resolve).

- [ ] **Step 3: Create `src/math/rng.js`**

```js
// ─── ECON STUDIO · src/math/rng.js ────────────────────────────────────────────
// Single source of truth for seeded pseudo-randomness across the Stat &
// Simulation module. Replaces three duplicated mulberry32 copies (SimulateTab,
// StatWorkspace) and the unseeded Math.random in Resampling.js. Pure JS.

// Seeded PRNG. Returns a function () => float in [0,1).
export function mulberry32(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Resolve a seed (null/blank/non-finite → auto-seed) and return both the RNG
// and the resolved integer seed so callers can display "seed used: N" even for
// auto-seeded runs, making them reproducible after the fact.
export function makeRNG(seed) {
  const blank = seed === null || seed === undefined || seed === "";
  const n = Number(seed);
  const resolved = (blank || !isFinite(n))
    ? ((Date.now() ^ Math.floor(Math.random() * 0x100000000)) >>> 0)
    : (n >>> 0);
  return { rand: mulberry32(resolved), seed: resolved };
}

// Integer in [0, nExclusive).
export function randInt(rand, nExclusive) {
  return Math.floor(rand() * nExclusive);
}

// Fisher-Yates. Returns a NEW shuffled array (does not mutate input).
export function shuffle(rand, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

// m draws with replacement from arr. Returns a NEW array of length m.
export function sampleWithReplacement(rand, arr, m) {
  const out = new Array(m);
  const n = arr.length;
  for (let i = 0; i < m; i++) out[i] = arr[Math.floor(rand() * n)];
  return out;
}
```

- [ ] **Step 4: Run the harness to verify it passes**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ rng: 10 pass, 0 fail`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/math/rng.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add shared seeded PRNG (rng.js) + inference validation harness"
```

---

### Task 2: F-distribution CDF — `pf` in `calcEngine.js`

**Files:**
- Modify: `src/math/calcEngine.js` (add `pf` near `pchisq` ~line 438; add to barrel ~line 489)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suitePf`)

- [ ] **Step 1: Add a failing `pf` suite to the harness**

In `inferenceValidation.js`, change the import line at the top:

```js
import { mulberry32, makeRNG, randInt, shuffle, sampleWithReplacement } from "../rng.js";
import { pf } from "../calcEngine.js";
```

Add this suite function above the `const SUITES` line:

```js
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
```

Change the SUITES registry line to:

```js
const SUITES = [["rng", suiteRNG], ["pf", suitePf]];
```

- [ ] **Step 2: Run the harness to verify the new suite fails**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `pf is not a function` / `does not provide an export named 'pf'` (exit code 1).

- [ ] **Step 3: Add `pf` to `calcEngine.js`**

Read `src/math/calcEngine.js` around line 438 to confirm `pchisq` and the internal `_incompleteBeta` (line ~332) are present. Immediately AFTER the `export function pchisq(...) { ... }` block, add:

```js
// F-distribution CDF via the regularized incomplete beta:
//   F(x; d1, d2) = I_{ (d1·x)/(d1·x + d2) }( d1/2, d2/2 )
export function pf(x, df1, df2) {
  if (!(x > 0) || !(df1 > 0) || !(df2 > 0)) return 0;
  const y = (df1 * x) / (df1 * x + df2);
  return _incompleteBeta(y, df1 / 2, df2 / 2);
}
```

Then add `pf` to the barrel object near line 489 (the object that currently lists `dbinom, pbinom, dpois, ppois`). Find the line listing the distribution CDFs in the exported `calc` object and add `pf` alongside `pchisq` (e.g. `pchisq, pf,`).

- [ ] **Step 4: Run the harness to verify it passes**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ pf: 5 pass, 0 fail`, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/math/calcEngine.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add F-distribution CDF (pf) for variance-ratio test"
```

---

### Task 3: Two-sample mean test (Welch + pooled) — `SampleTests.js`

**Files:**
- Modify: `src/math/SampleTests.js` (add `twoSampleMeanTest`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteTwoMean`)

- [ ] **Step 1: Add a failing two-sample-mean suite**

In `inferenceValidation.js`, add to the existing `calcEngine`/imports block a new import of the function under test:

```js
import { twoSampleMeanTest } from "../SampleTests.js";
```

Add this suite:

```js
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
```

Register it: `const SUITES = [["rng", suiteRNG], ["pf", suitePf], ["two-mean", suiteTwoMean]];`

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `twoSampleMeanTest is not a function`.

- [ ] **Step 3: Implement `twoSampleMeanTest` in `SampleTests.js`**

Confirm the existing import line is `import { pt, pnorm, pchisq } from "./calcEngine.js";`. At the end of `SampleTests.js`, append:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ two-mean: 7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/math/SampleTests.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add two-sample mean test (Welch + pooled t)"
```

---

### Task 4: Paired mean test — `SampleTests.js`

**Files:**
- Modify: `src/math/SampleTests.js` (add `pairedMeanTest`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suitePaired`)

- [ ] **Step 1: Add a failing paired suite**

Extend the SampleTests import in the harness:

```js
import { twoSampleMeanTest, pairedMeanTest } from "../SampleTests.js";
```

Add:

```js
function suitePaired(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // diffs = [-1, 0, 2], mean = 1/3, sd = sqrt(((-1-1/3)^2+(0-1/3)^2+(2-1/3)^2)/2)
  //       = sqrt((1.7778+0.1111+2.7778)/2) = sqrt(2.3333) = 1.5275252
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
```

Register: append `["paired", suitePaired]` to `SUITES`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `pairedMeanTest is not a function`.

- [ ] **Step 3: Implement `pairedMeanTest`**

Append to `SampleTests.js`:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ paired: 6 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/math/SampleTests.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add paired mean test"
```

---

### Task 5: One- and two-proportion z-tests — `SampleTests.js`

**Files:**
- Modify: `src/math/SampleTests.js` (add `onePropTest`, `twoPropTest`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteProp`)

- [ ] **Step 1: Add a failing proportion suite**

Extend the SampleTests import in the harness:

```js
import { twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest } from "../SampleTests.js";
```

Add:

```js
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
```

Register: append `["prop", suiteProp]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `onePropTest is not a function`.

- [ ] **Step 3: Implement both functions**

`onePropTest` / `twoPropTest` need `pnorm`, already imported in `SampleTests.js`. Append:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ prop: 7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/math/SampleTests.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add one- and two-proportion z-tests"
```

---

### Task 6: Correlation test (Pearson + Spearman) — `SampleTests.js`

**Files:**
- Modify: `src/math/SampleTests.js` (add `ranks` helper + `correlationTest`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteCorr`)

- [ ] **Step 1: Add a failing correlation suite**

Extend the import:

```js
import { twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest, correlationTest } from "../SampleTests.js";
```

Add:

```js
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
  // a=[1,2,3,4], b=[1,4,9,16] (ranks identical) → r_s = 1.
  const s = correlationTest([1, 2, 3, 4], [1, 4, 9, 16], { method: "spearman" });
  T(check("corr.spearman.r", s.estimate, 1, TOL_STAT));
  T(check("corr.spearman.method", s.method === "spearman" ? 1 : 0, 1, TOL));
  // Too few pairs → error.
  T(check("corr.error", correlationTest([1, 2], [1, 2], {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}
```

Register: append `["corr", suiteCorr]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `correlationTest is not a function`.

- [ ] **Step 3: Implement `ranks` + `correlationTest`**

Append to `SampleTests.js`:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ corr: 6 pass, 0 fail`.

Note: for a perfect rank correlation (r=1) `stat` is `Infinity` and `pt(Infinity, df)=1` → `pValue=0`; the suite asserts `r` and `method`, not the degenerate p, so this is fine.

- [ ] **Step 5: Commit**

```bash
git add src/math/SampleTests.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add Pearson/Spearman correlation test"
```

---

### Task 7: Variance-ratio F-test — `SampleTests.js`

**Files:**
- Modify: `src/math/SampleTests.js` (import `pf`, add `varianceRatioTest`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteVarRatio`)

- [ ] **Step 1: Add a failing variance-ratio suite**

Extend the import:

```js
import { twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest, correlationTest, varianceRatioTest } from "../SampleTests.js";
```

Add:

```js
function suiteVarRatio(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Equal variances (both 2.5) → F = 1, df = (4,4), two-sided p = 1.
  const r = varianceRatioTest([1, 2, 3, 4, 5], [2, 3, 4, 5, 6], {});
  T(check("var-ratio.F", r.stat, 1, TOL_STAT));
  T(check("var-ratio.df1", r.df1, 4, TOL));
  T(check("var-ratio.df2", r.df2, 4, TOL));
  T(check("var-ratio.p", r.pValue, 1, TOL_P));
  // a var = 10, b var = 2.5 → F = 4.
  // a=[0,5,10,15,20] var=62.5; b var=2.5 → F=25. Use simpler: a=[1,3,5,7,9] var=10.
  const r2 = varianceRatioTest([1, 3, 5, 7, 9], [2, 3, 4, 5, 6], {});
  T(check("var-ratio.F2", r2.stat, 4, TOL_STAT));
  // Zero-variance group → error.
  T(check("var-ratio.error", varianceRatioTest([2, 2, 2], [1, 2, 3], {}).error ? 1 : 0, 1, TOL));
  return { pass, fail };
}
```

Register: append `["var-ratio", suiteVarRatio]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `varianceRatioTest is not a function`.

- [ ] **Step 3: Implement `varianceRatioTest`**

Change the `SampleTests.js` calcEngine import to include `pf`:

```js
import { pt, pnorm, pchisq, pf } from "./calcEngine.js";
```

Append:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ var-ratio: 6 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/math/SampleTests.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add variance-ratio F-test"
```

---

### Task 8: Statistic registry + `jackknife` — `Resampling.js`

**Files:**
- Modify: `src/math/Resampling.js` (add imports, statistic helpers, `STATISTICS`, `jackknife`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteJackknife`)

Jackknife lands before `bootstrapStatistic` because the BCa CI path (Task 9) calls it.

- [ ] **Step 1: Add a failing jackknife suite**

Add the import to the harness:

```js
import { jackknife } from "../Resampling.js";
```

Add:

```js
function suiteJackknife(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Jackknife of the mean is exactly unbiased: jackEstimate == estimate, bias 0.
  const v = [2, 4, 4, 4, 5, 5, 7, 9]; // mean = 5
  const r = jackknife(v, "mean");
  T(check("jack.estimate", r.estimate, 5, TOL_STAT));
  T(check("jack.jackEstimate", r.jackEstimate, 5, TOL_STAT));
  T(check("jack.bias", r.bias, 0, TOL_STAT));
  // SE of the mean via jackknife equals the usual SE = sd/sqrt(n).
  // sample sd = 2 (known for this classic dataset), n=8 → se = 2/sqrt(8)=0.7071068.
  T(check("jack.se", r.se, 0.7071068, 1e-6));
  T(check("jack.loo.length", r.values.length, 8, TOL));
  T(check("jack.error", jackknife([1], "mean").error ? 1 : 0, 1, TOL));
  return { pass, fail };
}
```

Register: append `["jackknife", suiteJackknife]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `jackknife is not a function`.

- [ ] **Step 3: Add imports + statistic registry + `jackknife` to `Resampling.js`**

At the TOP of `Resampling.js` (the file currently starts with a comment block then `function clean`), add an import line above the first `function clean`:

```js
import { makeRNG, shuffle, sampleWithReplacement } from "./rng.js";
import { pnorm, qnorm } from "./calcEngine.js";
```

The file already defines `mean`, `sd`, and `quantile`. After the existing `quantile` helper (line ~68), add the rest of the statistic registry and the jackknife:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ jackknife: 7 pass, 0 fail`.

- [ ] **Step 5: Commit**

```bash
git add src/math/Resampling.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add statistic registry + jackknife to Resampling"
```

---

### Task 9: General bootstrap — `bootstrapStatistic` + refactor `bootstrapMean`

**Files:**
- Modify: `src/math/Resampling.js` (add `bootstrapStatistic`; make `bootstrapMean` a wrapper)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suiteBootstrap`)

- [ ] **Step 1: Add a failing bootstrap suite**

Extend the Resampling import:

```js
import { jackknife, bootstrapStatistic, bootstrapMean } from "../Resampling.js";
```

Add:

```js
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
```

Register: append `["bootstrap", suiteBootstrap]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `bootstrapStatistic is not a function`.

- [ ] **Step 3: Add `bootstrapStatistic` and rewrite `bootstrapMean`**

Append `bootstrapStatistic` to `Resampling.js` (after `jackknife`):

```js
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
```

Now REPLACE the existing `bootstrapMean` (lines ~80–101) with a thin wrapper. Delete the current `export function bootstrapMean(...) { ... }` block and add:

```js
// Backward-compatible mean bootstrap (percentile CI). Routed through the seeded
// engine; accepts an optional seed for reproducibility.
export function bootstrapMean(values, B = 2000, alpha = 0.05, seed = null) {
  const r = bootstrapStatistic(values, "mean", { B, alpha, ciType: "percentile", seed });
  if (r.error) return r;
  return { method: "bootstrap", meanHat: r.estimate, seBoot: r.bootSE, ciLo: r.ciLow, ciHi: r.ciHigh, alpha, B, nUsed: clean(values).length, seed: r.seed, replicates: r.replicates };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ bootstrap: 11 pass, 0 fail`. (All earlier suites still green — `bootstrapMean`'s public shape is unchanged.)

- [ ] **Step 5: Commit**

```bash
git add src/math/Resampling.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): add general seeded bootstrap (percentile/basic/BCa); bootstrapMean now a wrapper"
```

---

### Task 10: Generalized permutation test + `subsampleMean`/`permutationTwoSampleMean` refactor

**Files:**
- Modify: `src/math/Resampling.js` (add `CONTRASTS`, `combinations`, `permutationTest`; reseed `subsampleMean`; make `permutationTwoSampleMean` a wrapper; remove now-unused `shuffleInPlace`)
- Modify: `src/math/__validation__/inferenceValidation.js` (add `suitePermutation`)

- [ ] **Step 1: Add a failing permutation suite**

Extend the Resampling import:

```js
import { jackknife, bootstrapStatistic, bootstrapMean, permutationTest, permutationTwoSampleMean } from "../Resampling.js";
```

Add:

```js
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
```

Register: append `["permutation", suitePermutation]`.

- [ ] **Step 2: Run to verify failure**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: FAIL — `permutationTest is not a function`.

- [ ] **Step 3: Implement `permutationTest`, refactor wrappers**

Append to `Resampling.js` the contrast registry, combination counter, and the test:

```js
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
```

Now REPLACE the existing `permutationTwoSampleMean` (lines ~141–175) with a wrapper:

```js
// Backward-compatible two-sample mean-difference permutation (Monte Carlo).
export function permutationTwoSampleMean(valuesA, valuesB, B = 2000) {
  const r = permutationTest(valuesA, valuesB, "diffMeans", { B, exact: false });
  if (r.error) return r;
  const a = clean(valuesA), b = clean(valuesB);
  return { method: "permutation", meanA: mean(a), meanB: mean(b), diffObserved: r.observed, nA: a.length, nB: b.length, B, pTwoSided: r.pValue, replicates: r.replicates };
}
```

Update `subsampleMean` to use the seeded RNG instead of `Math.random`. Change its signature to accept an optional seed and replace the two `Math.random()` calls. Specifically, change the line `export function subsampleMean(values, m, B = 2000, alpha = 0.05) {` to:

```js
export function subsampleMean(values, m, B = 2000, alpha = 0.05, seed = null) {
```

Immediately after the `if (!(m >= 2 && m < n)) return ...;` guard, add:

```js
  const { rand } = makeRNG(seed);
```

Then change the inner index draw `const j = i + Math.floor(Math.random() * (n - i));` to:

```js
      const j = i + Math.floor(rand() * (n - i));
```

Finally, DELETE the now-unused `shuffleInPlace` helper (lines ~70–78) — `permutationTest` uses `shuffle` from `rng.js` instead. Verify with a grep that nothing else references `shuffleInPlace`.

- [ ] **Step 4: Run to verify pass**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: PASS — `✓ permutation: 9 pass, 0 fail`, all suites green.

- [ ] **Step 5: Commit**

```bash
git add src/math/Resampling.js src/math/__validation__/inferenceValidation.js
git commit -m "feat(statsim): generalized permutation test (exact + seeded MC); seed subsampleMean; drop shuffleInPlace"
```

---

### Task 11: New modes in `SampleTestPanel.jsx`

**Files:**
- Modify: `src/components/tabs/statsim/SampleTestPanel.jsx`

UI task — validated in the browser (no Node loop). All edits are surgical (no full rewrite), per project convention. The panel is mounted by both `StatWorkspace` (Stat tab) and `SimulateTab` (Simulate tab), so both tabs gain the new modes automatically.

- [ ] **Step 1: Extend the math import (line 14)**

Replace:

```js
import { oneSampleMeanTest, varianceTest, parameterTest } from "../../../math/SampleTests.js";
```

with:

```js
import {
  oneSampleMeanTest, varianceTest, parameterTest,
  twoSampleMeanTest, pairedMeanTest, onePropTest, twoPropTest, correlationTest, varianceRatioTest,
} from "../../../math/SampleTests.js";
```

- [ ] **Step 2: Extend the label/glyph maps (lines 22–23)**

Replace:

```js
const STAT_GLYPH = { t: "t", z: "z", chi2: "χ²" };
const H0_LABEL = { mean: "H₀: μ =", variance: "H₀: σ² =", parameter: "H₀: θ =" };
```

with:

```js
const STAT_GLYPH = { t: "t", z: "z", chi2: "χ²", F: "F" };
const H0_LABEL = {
  mean: "H₀: μ =", variance: "H₀: σ² =", parameter: "H₀: θ =",
  "two-mean": "H₀: μₐ − μ_b =", paired: "H₀: μ_d =",
  "one-prop": "H₀: p =", "two-prop": "H₀: p₁ − p₂ =",
  correlation: "H₀: ρ =", "var-ratio": "H₀: σ²ₐ/σ²_b =",
};
```

- [ ] **Step 3: Add state for the new modes (after line 34, the `df` state)**

After `const [df, setDf] = useState("");` add:

```js
  const [colNameB, setColB] = useState("");   // second variable (two-col modes)
  const [pooled, setPooled] = useState(false); // two-mean: pooled vs Welch
  const [corrMethod, setCorrMethod] = useState("pearson");
  // proportion-count inputs
  const [succ, setSucc] = useState("");
  const [nObs, setNObs] = useState("");
  const [s1, setS1] = useState(""); const [n1, setN1] = useState("");
  const [s2, setS2] = useState(""); const [n2, setN2] = useState("");
```

- [ ] **Step 4: Add a derived second column (after line 39, `selCol`)**

After `const selCol = columns.find(c => c.name === effectiveCol) ?? null;` add:

```js
  const TWO_COL = mode === "two-mean" || mode === "paired" || mode === "correlation" || mode === "var-ratio";
  const effectiveColB = columns.some(c => c.name === colNameB) ? colNameB : (columns[1]?.name ?? columns[0]?.name ?? "");
  const selColB = columns.find(c => c.name === effectiveColB) ?? null;
```

- [ ] **Step 5: Extend the result `useMemo` (lines 48–56)**

Replace the body of the `result = useMemo(() => { ... }, [...])` with:

```js
  const result = useMemo(() => {
    if (mode === "parameter") {
      if (estimate === "" || se === "") return null;
      return parameterTest(estimate, se, h0, alt, df === "" ? null : df);
    }
    if (mode === "one-prop") {
      if (succ === "" || nObs === "") return null;
      return onePropTest(Number(succ), Number(nObs), { p0: Number(h0), alternative: alt });
    }
    if (mode === "two-prop") {
      if (s1 === "" || n1 === "" || s2 === "" || n2 === "") return null;
      return twoPropTest(Number(s1), Number(n1), Number(s2), Number(n2), { alternative: alt });
    }
    if (TWO_COL) {
      if (!selCol || !selColB) return null;
      if (mode === "two-mean") return twoSampleMeanTest(selCol.values, selColB.values, { alternative: alt, pooled, mu0: h0 });
      if (mode === "paired")   return pairedMeanTest(selCol.values, selColB.values, { alternative: alt, mu0: h0 });
      if (mode === "correlation") return correlationTest(selCol.values, selColB.values, { method: corrMethod, alternative: alt });
      if (mode === "var-ratio")   return varianceRatioTest(selCol.values, selColB.values, { alternative: alt });
    }
    if (!selCol) return null;
    if (mode === "mean") return oneSampleMeanTest(selCol.values, h0, alt);
    return varianceTest(selCol.values, h0, alt);
  }, [mode, selCol, selColB, h0, alt, estimate, se, df, pooled, corrMethod, succ, nObs, s1, n1, s2, n2, TWO_COL]);
```

- [ ] **Step 6: Add the new mode buttons (after line 85, the existing three buttons)**

Inside the `<div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>` that holds the mode buttons, after `{modeBtn("parameter", "Parameter (estimate + SE)")}` add:

```jsx
            {modeBtn("two-mean", "Two-sample (t)")}
            {modeBtn("paired", "Paired (t)")}
            {modeBtn("correlation", "Correlation")}
            {modeBtn("var-ratio", "Variance ratio (F)")}
            {modeBtn("one-prop", "One proportion (z)")}
            {modeBtn("two-prop", "Two proportions (z)")}
```

- [ ] **Step 7: Add the second-column selector + mode-specific controls**

Immediately AFTER the existing single-column block (the `{mode !== "parameter" && ( ... )}` block that ends at line 97), add:

```jsx
          {/* Second variable for two-column modes */}
          {TWO_COL && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>variable B</span>
              <select value={effectiveColB} onChange={e => setColB(e.target.value)} style={{ ...field, maxWidth: 240 }} disabled={!columns.length}>
                {!columns.length && <option value="">— no numeric column —</option>}
                {columns.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
              </select>
              {mode === "two-mean" && (
                <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                  <input type="checkbox" checked={pooled} onChange={e => setPooled(e.target.checked)} /> pooled (equal var)
                </label>
              )}
              {mode === "correlation" && (
                <select value={corrMethod} onChange={e => setCorrMethod(e.target.value)} style={field}>
                  <option value="pearson">Pearson</option>
                  <option value="spearman">Spearman</option>
                </select>
              )}
            </div>
          )}

          {/* One-proportion counts */}
          {mode === "one-prop" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                successes <input type="number" step="1" value={succ} onChange={e => setSucc(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                n <input type="number" step="1" value={nObs} onChange={e => setNObs(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
            </div>
          )}

          {/* Two-proportion counts */}
          {mode === "two-prop" && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                s₁ <input type="number" step="1" value={s1} onChange={e => setS1(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                n₁ <input type="number" step="1" value={n1} onChange={e => setN1(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                s₂ <input type="number" step="1" value={s2} onChange={e => setS2(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                n₂ <input type="number" step="1" value={n2} onChange={e => setN2(e.target.value)} style={{ ...field, width: 70 }} />
              </label>
            </div>
          )}
```

- [ ] **Step 8: Hide the null-value row where it doesn't apply, and extend the result card**

The "Null value + alternative" block (lines 118–128) shows the `H0_LABEL[mode]` input. For `correlation`, `two-prop`, and `var-ratio` the null is fixed (0 / 0 / 1), so render only the alternative selector for those. Wrap the H₀ `<label>` (lines 119–122) so it renders only when `mode` is not one of those three:

```jsx
            {mode !== "correlation" && mode !== "two-prop" && mode !== "var-ratio" && (
              <label style={{ display: "flex", alignItems: "center", gap: 5, fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                {H0_LABEL[mode]}
                <input type="number" step="any" value={h0} onChange={e => setH0(e.target.value)} style={{ ...field, width: 90 }} />
              </label>
            )}
```

Then, inside the result card (the `{result && !result.error && ( ... )}` block, lines 134–159), after the existing `result.test === "parameter"` line add render branches for the new shapes:

```jsx
              {result.test === "two-mean" && (
                <div><span style={{ color: C.textMuted }}>x̄ₐ−x̄_b = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  x̄ₐ = </span>{fmt(result.meanA, 4)}
                  <span style={{ color: C.textMuted }}>  ·  x̄_b = </span>{fmt(result.meanB, 4)}
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  {result.pooled ? "pooled" : "Welch"}</span></div>
              )}
              {result.test === "paired" && (
                <div><span style={{ color: C.textMuted }}>d̄ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "one-prop" && (
                <div><span style={{ color: C.textMuted }}>p̂ = </span><span style={{ color: C.teal }}>{fmt(result.phat, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  SE = </span>{fmt(result.se, 4)}
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "two-prop" && (
                <div><span style={{ color: C.textMuted }}>p̂₁−p̂₂ = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  p̂₁ = </span>{fmt(result.phat1, 4)}
                  <span style={{ color: C.textMuted }}>  ·  p̂₂ = </span>{fmt(result.phat2, 4)}</div>
              )}
              {result.test === "correlation" && (
                <div><span style={{ color: C.textMuted }}>{result.method} r = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  n = </span>{result.n}</div>
              )}
              {result.test === "var-ratio" && (
                <div><span style={{ color: C.textMuted }}>s²ₐ/s²_b = </span><span style={{ color: C.teal }}>{fmt(result.estimate, 4)}</span>
                  <span style={{ color: C.textMuted }}>  ·  df = (</span>{result.df1}<span style={{ color: C.textMuted }}>, </span>{result.df2}<span style={{ color: C.textMuted }}>)</span></div>
              )}
```

The existing stat/df/p line (lines 151–157) already keys off `result.statLabel` / `result.df` and renders `STAT_GLYPH[result.statLabel]` — with the `F` glyph added in Step 2 it handles the F-test row unchanged. For `var-ratio` the result has `df1/df2` not `df`, so the generic `result.df != null` branch is skipped and the df is shown in the var-ratio block above — correct.

- [ ] **Step 9: Browser validation**

Run `npm run dev`. In the Stat tab (load any numeric dataset) and the Simulate tab (after simulating), open the Hypothesis-test panel and confirm:
- Two-sample / paired / correlation / variance-ratio modes show a "variable B" selector.
- Two-sample shows the pooled checkbox; correlation shows Pearson/Spearman.
- One-/two-proportion modes show count inputs and no variable selector.
- Each mode renders a result card with the correct statistic glyph (t / z / F) and a p-value.
- Cross-check one case against the Node harness numbers (e.g. two-sample pooled of `[1,2,3,4,5]` vs `[2,3,4,5,6]` → t = −1, df = 8).

- [ ] **Step 10: Commit**

```bash
git add src/components/tabs/statsim/SampleTestPanel.jsx
git commit -m "feat(statsim): two-sample/paired/prop/correlation/var-ratio modes in SampleTestPanel"
```

---

### Task 12: StatWorkspace resampling UI — statistic/CI/seed/contrast + SessionLog + PRNG dedup

**Files:**
- Modify: `src/components/tabs/statsim/StatWorkspace.jsx`

UI task — browser-validated. The resampling section is at lines ~995–1120; the local PRNG is at lines 427–441; the resampling imports at line 23.

- [ ] **Step 1: Swap to the shared PRNG (dedup mulberry32)**

Add an import near the existing imports (after line 24, the `useTheme` import):

```js
import { mulberry32 } from "../../../math/rng.js";
```

Delete the local `mulberry32` definition (lines 427–436 — the `function mulberry32(seed) { ... }` block). Keep the local `makeRNG` (lines 437–441) unchanged: it already calls `mulberry32`, now resolved from the shared module, so the random-variate generators (`genNormal`, etc.) keep working with the same call sites.

- [ ] **Step 2: Extend the resampling imports (line 23) and add SessionLog**

Replace:

```js
import { bootstrapMean, subsampleMean, permutationTwoSampleMean } from "../../../math/Resampling.js";
```

with:

```js
import { bootstrapMean, subsampleMean, permutationTwoSampleMean, bootstrapStatistic, permutationTest } from "../../../math/Resampling.js";
import { useSessionLog } from "../../../services/session/sessionLog.jsx";
```

- [ ] **Step 3: Wire SessionLog and add resampling control state**

Inside the component function (near the other `useState`/`useTheme` hooks at the top of the default export), add:

```js
  const { appendLog } = useSessionLog();
```

Find the existing resampling state declarations (search `setRsMode` / `setRsB` / `setRsResult`) and, alongside them, add:

```js
  const [rsStat, setRsStat] = useState("mean");        // bootstrap statistic
  const [rsCiType, setRsCiType] = useState("percentile");
  const [rsSeed, setRsSeed] = useState("");
  const [rsContrast, setRsContrast] = useState("diffMeans");
  const [rsAlt, setRsAlt] = useState("two-sided");
```

- [ ] **Step 4: Rewrite `runRS` to use the seeded engines + log to SessionLog**

Replace the `runRS` function (lines 995–1026) with:

```js
          function runRS() {
            if (!rsCol) return;
            setRsBusy(true); setRsResult(null);
            setTimeout(() => {
              try {
                let res;
                const seedArg = rsSeed === "" ? null : Number(rsSeed);
                if (rsMode === "boot") {
                  res = bootstrapStatistic(colVals(rsCol), rsStat, { B: rsB, alpha: 0.05, ciType: rsCiType, seed: seedArg });
                } else if (rsMode === "subsample") {
                  res = subsampleMean(colVals(rsCol), mEffective, rsB, 0.05, seedArg);
                } else {
                  if (!rsGroupCol || !rsLevelA || !rsLevelB || rsLevelA === rsLevelB) {
                    res = { error: "Pick two distinct levels of the group column." };
                  } else {
                    const a = [], b = [];
                    for (const r of rows) {
                      const v = Number(r[rsCol]); if (!isFinite(v)) continue;
                      const g = String(r[rsGroupCol]);
                      if (g === rsLevelA) a.push(v);
                      else if (g === rsLevelB) b.push(v);
                    }
                    res = permutationTest(a, b, rsContrast, { B: rsB, exact: null, seed: seedArg, alternative: rsAlt });
                  }
                }
                setRsResult(res);
                if (res && !res.error) {
                  appendLog?.({
                    module: "stat",
                    op: rsMode === "boot" ? `bootstrap(${rsStat}, ${rsCiType})`
                      : rsMode === "subsample" ? "subsample(mean)"
                      : `permutation(${rsContrast})`,
                    detail: rsMode === "boot"
                      ? `${rsCol}: est=${res.estimate?.toFixed?.(4)}, CI=[${res.ciLow?.toFixed?.(4)}, ${res.ciHigh?.toFixed?.(4)}], seed=${res.seed}`
                      : rsMode === "perm"
                      ? `${rsCol} by ${rsGroupCol} (${rsLevelA} vs ${rsLevelB}): obs=${res.observed?.toFixed?.(4)}, p=${res.pValue?.toFixed?.(4)}, ${res.exact ? "exact" : "MC seed=" + res.seed}`
                      : `${rsCol}: mean=${res.meanHat?.toFixed?.(4)}`,
                  });
                }
              } catch (e) {
                setRsResult({ error: e.message });
              } finally {
                setRsBusy(false);
              }
            }, 0);
          }
```

> If `appendLog`'s payload shape differs from `{ module, op, detail }`, match the shape used elsewhere — grep `appendLog(` in `SimulateTab.jsx` (it is already a SessionLog consumer) and mirror that exact object shape.

- [ ] **Step 5: Add bootstrap controls (statistic + CI type) + shared seed input**

In the controls row, after the `replicates B` input (lines 1073–1076), add the seed input (applies to all modes):

```jsx
                <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, marginLeft: 8 }}>seed</span>
                <input type="number" step="1" value={rsSeed} placeholder="auto"
                  onChange={e => setRsSeed(e.target.value)} style={{ ...fieldStyle(C), width: 80 }} />
```

Inside the `{rsMode === "boot" && (...)}`-style region: there is currently no boot-specific control block, so add one right after the variable `<select>` (after line 1041), guarded by `rsMode === "boot"`:

```jsx
                {rsMode === "boot" && (
                  <>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>statistic</span>
                    <select value={rsStat} onChange={e => { setRsStat(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C), maxWidth: 140 }}>
                      <option value="mean">mean</option>
                      <option value="median">median</option>
                      <option value="sd">sd</option>
                      <option value="variance">variance</option>
                      <option value="trimmedMean10">trimmed mean 10%</option>
                      <option value="iqr">IQR</option>
                    </select>
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>CI</span>
                    <select value={rsCiType} onChange={e => { setRsCiType(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C), maxWidth: 130 }}>
                      <option value="percentile">percentile</option>
                      <option value="basic">basic</option>
                      <option value="bca">BCa</option>
                    </select>
                  </>
                )}
```

- [ ] **Step 6: Add permutation contrast + alternative controls**

Inside the existing `{rsMode === "perm" && (...)}` block (lines 1043–1061), after the level-B `<select>` (line 1059), before the closing `</>`, add:

```jsx
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>contrast</span>
                    <select value={rsContrast} onChange={e => { setRsContrast(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C), maxWidth: 150 }}>
                      <option value="diffMeans">diff of means</option>
                      <option value="diffMedians">diff of medians</option>
                      <option value="diffSd">diff of sd</option>
                      <option value="meanRatio">ratio of means</option>
                    </select>
                    <select value={rsAlt} onChange={e => { setRsAlt(e.target.value); setRsResult(null); }} style={{ ...fieldStyle(C) }}>
                      <option value="two-sided">two-sided</option>
                      <option value="greater">greater</option>
                      <option value="less">less</option>
                    </select>
```

- [ ] **Step 7: Update the bootstrap and permutation result cards**

The bootstrap result now comes from `bootstrapStatistic` (fields `estimate`, `bootSE`, `ciLow`, `ciHigh`, `stat`, `ciType`, `seed`), not the old `bootstrapMean` shape — but the card at lines 1090–1097 checks `rsResult.method === "bootstrap"`. Change that card to key off the new shape. Replace lines 1090–1097 with:

```jsx
              {rsResult && !rsResult.error && rsResult.ciType && (
                <ResultBox color={C.teal}>
                  <div>{rsResult.stat}    = <span style={{ color: C.teal }}>{fmt(rsResult.estimate, 4)}</span> &nbsp;&nbsp; B = {rsResult.B} &nbsp;&nbsp; seed = {rsResult.seed}</div>
                  <div>SE_boot   = {fmt(rsResult.bootSE, 4)} &nbsp;&nbsp; bias = {fmt(rsResult.bias, 4)}</div>
                  <div>95% CI    = [{fmt(rsResult.ciLow, 4)}, {fmt(rsResult.ciHigh, 4)}] &nbsp;({rsResult.ciType})</div>
                  <ReplicateHistogram replicates={rsResult.replicates} marker={rsResult.estimate} ciLo={rsResult.ciLow} ciHi={rsResult.ciHigh} />
                </ResultBox>
              )}
```

The permutation result now comes from `permutationTest` (fields `observed`, `pValue`, `exact`, `nPerm`, `seed`), not `permutationTwoSampleMean`. Replace the permutation card (lines 1109–1117) with:

```jsx
              {rsResult && !rsResult.error && rsResult.contrast && (
                <ResultBox color={C.gold}>
                  <div>contrast  = {rsResult.contrast} &nbsp;&nbsp; ({rsLevelA} vs {rsLevelB})</div>
                  <div>observed  = <span style={{ color: C.gold }}>{fmt(rsResult.observed, 4)}</span></div>
                  <div>p ({rsResult.alternative}) = <span style={{ color: rsResult.pValue < 0.05 ? C.gold : C.textDim }}>{fmt(rsResult.pValue, 4)}</span> &nbsp; {rsResult.exact ? `exact (${rsResult.nPerm} perms)` : `MC B=${rsResult.nPerm}, seed=${rsResult.seed}`}</div>
                  <ReplicateHistogram replicates={rsResult.replicates} marker={rsResult.observed} color={C.gold} />
                </ResultBox>
              )}
```

The subsample card (lines 1099–1107) is unchanged — `subsampleMean` keeps its shape.

- [ ] **Step 8: Browser validation**

`npm run dev`, Stat tab, Resampling section:
- Bootstrap: pick a numeric column, choose statistic = median, CI = BCa, set seed = 42, Run. Re-run with the same seed → identical CI. Histogram + CI lines render. Change CI to basic/percentile and confirm bounds change.
- Permutation: pick a group column + two levels, contrast = diff of means, Run. For small groups the card shows "exact (N perms)"; for large groups it shows "MC … seed=N" and re-running with the same seed reproduces p.
- Confirm each run adds a `stat`-module entry to the Session log.

- [ ] **Step 9: Commit**

```bash
git add src/components/tabs/statsim/StatWorkspace.jsx
git commit -m "feat(statsim): general bootstrap + generalized permutation UI in StatWorkspace; seed + SessionLog; shared PRNG"
```

---

### Task 13: SimulateTab — adopt the shared PRNG

**Files:**
- Modify: `src/components/tabs/SimulateTab.jsx`

UI task — browser-validated. SimulateTab has its own `mulberry32` at line 31.

- [ ] **Step 1: Import the shared PRNG**

Add near the existing imports (after line 9, the `useSessionLog` import):

```js
import { mulberry32 } from "../../math/rng.js";
```

- [ ] **Step 2: Delete the local `mulberry32`**

Remove the local `function mulberry32(seed) { ... }` block at lines 31–~40. Any local `makeRNG`/`drawSamples` that call `mulberry32` now resolve it from the shared module (identical algorithm). Do NOT change call sites.

- [ ] **Step 3: Browser validation**

`npm run dev`, Simulate tab. Re-run a simulation with a fixed seed and confirm the generated data and Monte Carlo summaries are unchanged from before this task (the shared `mulberry32` is byte-identical to the deleted local copy, so results must match). The embedded SampleTestPanel (now with the Task 11 modes) still works on simulated columns.

- [ ] **Step 4: Commit**

```bash
git add src/components/tabs/SimulateTab.jsx
git commit -m "refactor(statsim): SimulateTab uses shared rng.js (drops duplicated mulberry32)"
```

---

### Task 14: Window exposure + R cross-check fixtures + plan/spec status

**Files:**
- Modify: `src/math/__validation__/inferenceValidation.js` (R cross-check suite, gated)
- Create: `src/math/__validation__/inferenceRValidation.R` (R script that prints the reference values)
- Modify: `ClaudePlan.md` (flip spec status to DONE)

The Node harness already exposes `window.__validation.inference` (Task 1). This task adds the R fixtures so Franco can confirm against R in the browser/console, matching the project's 6dp-coef / 4dp-SE convention.

- [ ] **Step 1: Write the R reference script**

Create `src/math/__validation__/inferenceRValidation.R`:

```r
# Reference values for src/math/__validation__/inferenceValidation.js
# Run in R; paste the printed numbers into suiteRCrossCheck's EXPECTED object.
a <- c(1,2,3,4,5); b <- c(2,3,4,5,6)
print(t.test(a, b, var.equal=TRUE))   # pooled two-sample t
print(t.test(a, b))                   # Welch
print(t.test(c(1,2,4), c(2,2,2), paired=TRUE))
print(prop.test(60, 100, p=0.5, correct=FALSE))
print(prop.test(c(50,50), c(100,100), correct=FALSE))
print(cor.test(c(1,2,3), c(1,3,2), method="pearson"))
print(cor.test(c(1,2,3,4), c(1,4,9,16), method="spearman"))
print(var.test(c(1,3,5,7,9), c(2,3,4,5,6)))
# Bootstrap (method check, seed-dependent — use library(boot)):
library(boot)
set.seed(1); v <- c(2,4,4,4,5,5,7,9)
bs <- boot(v, function(d,i) mean(d[i]), R=2000)
print(boot.ci(bs, type=c("perc","basic","bca")))
```

- [ ] **Step 2: Add a gated R cross-check suite to the harness**

In `inferenceValidation.js`, add a suite that compares p-values/statistics against R-derived constants (filled from Step 1's output). Use the loosened p-value tolerance (`TOL_P = 1e-3`) for distribution-tail values; bootstrap CI cells use a 1e-2 band because R's RNG ≠ mulberry32 (same rationale as the DuckDB HAC/HC2/HC3 cells in CLAUDE.md).

```js
function suiteRCrossCheck(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // EXPECTED ← printed by inferenceRValidation.R (paste exact values).
  const E = {
    pooledP: 0.3408,    // t.test(a,b,var.equal=TRUE)$p.value
    welchP: 0.3408,     // t.test(a,b)$p.value
    onePropP: 0.04550026, // prop.test(60,100,p=.5,correct=F)$p.value
    varRatioP: 0.1782,  // var.test(c(1,3,5,7,9), c(2,3,4,5,6))$p.value
  };
  const ab = { a: [1,2,3,4,5], b: [2,3,4,5,6] };
  T(check("R.pooled.p", twoSampleMeanTest(ab.a, ab.b, { pooled: true }).pValue, E.pooledP, TOL_P));
  T(check("R.welch.p", twoSampleMeanTest(ab.a, ab.b, {}).pValue, E.welchP, TOL_P));
  T(check("R.oneProp.p", onePropTest(60, 100, { p0: 0.5 }).pValue, E.onePropP, TOL_P));
  T(check("R.varRatio.p", varianceRatioTest([1,3,5,7,9], [2,3,4,5,6], {}).pValue, E.varRatioP, TOL_P));
  return { pass, fail };
}
```

Register: append `["R-crosscheck", suiteRCrossCheck]`.

> The `E` constants above are placeholders for the engineer to confirm by RUNNING `inferenceRValidation.R` and pasting R's printed `p.value`s — this is the same documented workflow as the existing `engineValidation.js` (whose header states "Expected values were computed in R"). If a pasted value disagrees beyond `TOL_P`, that is a real bug to investigate, not a tolerance to widen.

- [ ] **Step 3: Run the full harness**

Run: `node src/math/__validation__/inferenceValidation.js`
Expected: all suites green, exit code 0. If the R cross-check fails, recompute the JS-side p-value by hand for one cell to determine whether the bug is in the engine or a mis-pasted R value.

- [ ] **Step 4: Flip the spec status to DONE in `ClaudePlan.md`**

In the Spec & Plan Index, change the row added for this work:

```
| 2026-06-01 | `specs/2026-06-01-stat-sim-inference-deepening-design.md` | OPEN | Spec A (data-level only): …
```

to `DONE` once Tasks 1–14 have all landed and Franco has browser-validated Tasks 11–13.

- [ ] **Step 5: Commit**

```bash
git add src/math/__validation__/inferenceValidation.js src/math/__validation__/inferenceRValidation.R ClaudePlan.md
git commit -m "test(statsim): R cross-check fixtures for data-level inference; mark Spec A done"
```

---

## Self-Review

**Spec coverage** (spec §→task):
- §1 parametric tests → Tasks 3–7 (math) + Task 11 (UI) + `pf` in Task 2. ✓ All six functions covered.
- §2 general bootstrap + reproducibility → Task 8 (jackknife + registry), Task 9 (bootstrapStatistic perc/basic/BCa, seeded), Task 1 (shared RNG). ✓
- §3 generalized permutation → Task 10 (exact + MC, contrasts, threshold). ✓
- §4 standalone scripts + SessionLog → SessionLog logging in Task 12 Step 4. ⚠ **Gap:** the spec's R/Python/Stata *snippet generators* (§4.1) are not yet a task. **Resolution:** snippet generation reuses the existing `generateCalcScript` pattern and is lower-value than the inference itself; it is deferred to a follow-up and noted here so it is not silently dropped — the SessionLog half of §4 (the reproducibility-critical part) IS implemented. Add a future task "statsim inference snippet generators" if Franco wants the per-op scripts.
- §5 R validation → Task 14. ✓

**Placeholder scan:** The only intentional fill-in is the R-derived `E` constants in Task 14 (documented project workflow, with explicit run instructions). No "TBD"/"implement later" in code steps. The §4.1 snippet generators are explicitly called out as deferred above rather than left as a silent gap.

**Type consistency:** `bootstrapStatistic` returns `{ estimate, ciLow, ciHigh, bootSE, bias, seed, replicates, ciType, stat, B, alpha }` — StatWorkspace Task 12 Step 7 reads exactly these. `permutationTest` returns `{ observed, pValue, exact, nPerm, seed, replicates, contrast, alternative }` — Task 12 Step 7 reads exactly these. `twoSampleMeanTest`/`pairedMeanTest`/`onePropTest`/`twoPropTest`/`correlationTest`/`varianceRatioTest` result fields used in SampleTestPanel Task 11 Step 8 match the `return` objects in Tasks 3–7. `makeRNG` returns `{ rand, seed }` — used consistently in Resampling (Tasks 9–10) and the harness (Task 1). ✓

**Known intentional API change:** `bootstrapMean`/`permutationTwoSampleMean` keep their old public shapes (wrappers), so the StatWorkspace cards that previously read them are deliberately rewritten in Task 12 Step 7 to read the new `bootstrapStatistic`/`permutationTest` shapes (the section now calls the new functions directly). No other consumers of these two functions exist (verified: only StatWorkspace imports them).
