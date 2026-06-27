// ─── ECON STUDIO · src/math/__validation__/callawayValidation.js ──────────────
// Numerical validation of CallawayEngine against R `did` package fixtures.
//
// Fixtures generated from R:
//   library(did)
//   data(mpdta)
//   out  <- att_gt(yname="lemp", gname="first.treat", idname="countyreal",
//                  tname="year", data=mpdta, control_group="nevertreated",
//                  est_method="reg", panel=TRUE, print_details=FALSE)
//   agg  <- aggte(out, type="dynamic", na.rm=TRUE)
//   agg_simple <- aggte(out, type="simple", na.rm=TRUE)
//
// See callawayRValidation.R for the full script to regenerate.
//
// Usage (browser console — after build):
//   import { runCallawayCSValidation } from "./__validation__/callawayValidation.js";
//   console.table(runCallawayCSValidation());
//
// Task 2 suites (enumeration and control-set selection):
//   import { suiteBasePeriod, suiteControlSet } from "./__validation__/callawayValidation.js";

import { runCallawayCS } from "../CallawayEngine.js";
import { enumerateCells, controlSet } from "../did/staggeredDiD.js";

// ─── TOLERANCE CONSTANTS ─────────────────────────────────────────────────────
const TOL_ATT = 1e-4;   // ATT coefficients: 4 decimal places (OR estimator)
const TOL_SE  = 1e-4;   // Standard errors: 4 decimal places

// ─── HELPER ──────────────────────────────────────────────────────────────────
function near(a, b, tol = 1e-4) {
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  if (!Number.isFinite(a) && !Number.isFinite(b)) return a === b;
  return Math.abs(a - b) <= tol;
}

function check(label, got, want, tol = TOL_ATT) {
  const ok = near(got, want, tol);
  if (!ok) {
    console.warn(
      `  ✗ ${label}: got ${got?.toFixed?.(8) ?? got}, want ${want?.toFixed?.(8) ?? want}, diff=${Math.abs(got - want).toExponential(3)}`
    );
  }
  return ok;
}

// ═══ TASK 2: BASE-PERIOD + CONTROL-SET ENUMERATION ════════════════════════════

/**
 * SUITE T2A: Base-period enumeration with varying base
 * Test that enumerateCells produces correct (g,t,b,e) tuples.
 */
export function suiteBasePeriodVarying() {
  const results = [];

  // Test case: tlist=[1,2,3,4], glist=[2,3,4], anticipation=0, basePeriod="varying"
  const cellsV = enumerateCells({
    tlist: [1, 2, 3, 4],
    glist: [2, 3, 4],
    anticipation: 0,
    basePeriod: "varying",
  });

  // Cohort g=2: gStar=2, bUniversal=1 (largest < 2)
  //   t=1: skip (t < gStar but no prior period)
  //   t=2: post-period, b=1 (bUniversal), e=0
  //   t=3: post-period, b=1 (bUniversal), e=1
  //   t=4: post-period, b=1 (bUniversal), e=2
  const g2 = cellsV.filter(c => c.g === 2);
  results.push({
    label: "g=2 has 3 post-period cells (t=2,3,4)",
    pass: g2.length === 3 && g2.every(c => c.b === 1),
  });

  // Cohort g=3: gStar=3, bUniversal=2 (largest < 3)
  //   t=1: pre-period, no earlier t → skip
  //   t=2: pre-period, b=1 (largest < 2), e=-1
  //   t=3: post-period, b=2 (bUniversal), e=0
  //   t=4: post-period, b=2 (bUniversal), e=1
  const g3 = cellsV.filter(c => c.g === 3);
  results.push({
    label: "g=3 has 1 pre-cell (t=2, b=1, e=-1)",
    pass: g3.some(c => c.t === 2 && c.b === 1 && c.e === -1 && c.isPre),
  });
  results.push({
    label: "g=3 has post-cells with b=2",
    pass: g3.filter(c => !c.isPre).every(c => c.b === 2),
  });

  // Cohort g=4: gStar=4, bUniversal=3 (largest < 4)
  //   t=1: pre, no prior
  //   t=2: pre, b=1
  //   t=3: pre, b=2, e=-1
  //   t=4: post, b=3, e=0
  const g4 = cellsV.filter(c => c.g === 4);
  results.push({
    label: "g=4 has 2 pre-cells (t=2,3 with b=1,2)",
    pass: g4.filter(c => c.isPre).length === 2,
  });

  results.forEach(r =>
    console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`)
  );
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

/**
 * SUITE T2B: Base-period enumeration with universal base
 * Test that all (g,t) pairs use the same base bUniversal per cohort.
 */
export function suiteBasePeriodUniversal() {
  const results = [];

  const cellsU = enumerateCells({
    tlist: [1, 2, 3, 4],
    glist: [2, 3, 4],
    anticipation: 0,
    basePeriod: "universal",
  });

  // Cohort g=2: bUniversal=1, reference cell (t=1, b=1, e=-1, isRef=true)
  const g2 = cellsU.filter(c => c.g === 2);
  results.push({
    label: "g=2 has reference cell at t=1, b=1, isRef=true",
    pass: g2.some(c => c.t === 1 && c.b === 1 && c.isRef),
  });
  results.push({
    label: "g=2 all non-ref cells use b=1",
    pass: g2.filter(c => !c.isRef).every(c => c.b === 1),
  });

  // Cohort g=3: bUniversal=2, reference cell (t=2, b=2, isRef=true)
  const g3 = cellsU.filter(c => c.g === 3);
  results.push({
    label: "g=3 has reference cell at t=2, b=2, isRef=true",
    pass: g3.some(c => c.t === 2 && c.b === 2 && c.isRef),
  });
  results.push({
    label: "g=3 all cells use b=2",
    pass: g3.every(c => c.b === 2),
  });

  // Cohort g=4: bUniversal=3, reference cell (t=3, b=3, isRef=true)
  const g4 = cellsU.filter(c => c.g === 4);
  results.push({
    label: "g=4 has reference cell at t=3, b=3, isRef=true",
    pass: g4.some(c => c.t === 3 && c.b === 3 && c.isRef),
  });

  results.forEach(r =>
    console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`)
  );
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

/**
 * SUITE T2C: Control set selection — never-treated
 */
export function suiteControlSetNeverTreated() {
  const results = [];

  // units: A,B=never (G=Infinity), C=cohort 3, D=cohort 5
  const units = new Map([
    ["A", Infinity],
    ["B", Infinity],
    ["C", 3],
    ["D", 5],
  ]);

  // For cell (g=3, t=4, b=2): nevertreated control group
  const { eids: neverG3 } = controlSet({
    units,
    g: 3,
    t: 4,
    b: 2,
    controlGroup: "nevertreated",
  });

  results.push({
    label: "nevertreated returns only never-treated (A, B)",
    pass: neverG3.length === 2 && neverG3.includes("A") && neverG3.includes("B"),
  });

  results.push({
    label: "nevertreated excludes C (focal cohort) and D (treated at 5)",
    pass: !neverG3.includes("C") && !neverG3.includes("D"),
  });

  results.forEach(r =>
    console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`)
  );
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

/**
 * SUITE T2D: Control set selection — not-yet-treated
 */
export function suiteControlSetNotYetTreated() {
  const results = [];

  const units = new Map([
    ["A", Infinity],
    ["B", Infinity],
    ["C", 3],
    ["D", 5],
  ]);

  // For cell (g=3, t=4, b=2): notyettreated control group
  // laterPeriod = max(4, 2) = 4
  // Include: G > 4 OR G = Infinity, and G ≠ 3
  const { eids: notyet } = controlSet({
    units,
    g: 3,
    t: 4,
    b: 2,
    controlGroup: "notyettreated",
  });

  results.push({
    label: "notyettreated includes A, B (never-treated)",
    pass: notyet.includes("A") && notyet.includes("B"),
  });

  results.push({
    label: "notyettreated includes D (G=5 > 4)",
    pass: notyet.includes("D"),
  });

  results.push({
    label: "notyettreated excludes C (focal cohort g=3)",
    pass: !notyet.includes("C"),
  });

  results.push({
    label: "notyettreated has 3 units (A, B, D)",
    pass: notyet.length === 3,
  });

  results.forEach(r =>
    console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`)
  );
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

/**
 * SUITE T2E: Control set fallback (no never-treated units)
 */
export function suiteControlSetFallback() {
  const results = [];

  // Only treated and nobody never-treated
  const units = new Map([
    ["A", 2],
    ["B", 3],
    ["C", 4],
  ]);

  const { eids, warning } = controlSet({
    units,
    g: 2,
    t: 4,
    b: 3,
    controlGroup: "nevertreated",
  });

  results.push({
    label: "nevertreated with no never-treated units falls back and returns warning",
    pass: warning !== undefined && warning.includes("falling back"),
  });

  // Should fall back to notyettreated: G > max(4,3)=4 and G ≠ 2
  // Units: A=2 (focal), B=3 (<4), C=4 (=4) → none qualify
  results.push({
    label: "fallback returns empty list when no units satisfy not-yet-treated",
    pass: eids.length === 0,
  });

  results.forEach(r =>
    console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`)
  );
  const pass = results.filter(r => r.pass).length;
  return { pass, fail: results.length - pass, total: results.length };
}

// ─── LCG HELPER ──────────────────────────────────────────────────────────────
function makeLCG(seed) {
  let s = seed >>> 0;
  return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 0xFFFFFFFF; };
}

// ─── MPDTA-LIKE SYNTHETIC DATASET ────────────────────────────────────────────
// The mpdta dataset is 2500 rows (500 counties × 5 years: 2003–2007).
// Cohorts: never-treated (first.treat=0), 2004, 2006, 2007.
// We construct a small but structurally identical dataset that:
//   (a) reproduces the OR estimator logic deterministically
//   (b) can be used to verify the JS engine matches itself
//
// For R comparison: run callawayRValidation.R and paste the JSON fixture below.
//
// Structure: 3 cohorts (2004, 2006, never) × 4 counties each × 4 years (2003–2006)

function makeMpdtaLike() {
  // DGP: Y_it = alpha_i + gamma_t + tau * D_it + eps_it
  // alpha_i ~ unit FE, gamma_t ~ time FE, tau = ATT
  // Cohort 2004: treated from t=2004 (rel=0,1,2,...)
  // Cohort 2006: treated from t=2006 (rel=0,1)
  // Never-treated: never treated (G=0/Inf)
  //
  // To get known ATT values we use:
  //   Cohort 2004: ATT(g=2004, t=2004) = 0.5, ATT(g=2004, t=2005) = 0.5, ATT(g=2004, t=2006) = 0.5
  //   Cohort 2006: ATT(g=2006, t=2006) = 0.3
  //   Pre-trends: 0 by construction (parallel trends holds)

  const rows = [];
  const years = [2003, 2004, 2005, 2006];
  const seed = 42;

  // Deterministic pseudo-random (LCG)
  const rand = makeLCG(seed);
  function randScaled() {
    return rand() * 2 - 1;  // in [-1, 1]
  }

  // Cohort 2004: units 1–4
  for (let uid = 1; uid <= 4; uid++) {
    const alpha = randScaled() * 0.2;
    for (const year of years) {
      const treated = year >= 2004 ? 1 : 0;
      const tau     = treated ? 0.5 : 0;
      const gamma   = year === 2003 ? 0 : year === 2004 ? 0.05 : year === 2005 ? 0.08 : 0.12;
      const y       = 5.0 + alpha + gamma + tau + randScaled() * 0.01;
      rows.push({ county: uid, year, lemp: y, first_treat: 2004 });
    }
  }

  // Cohort 2006: units 5–8
  for (let uid = 5; uid <= 8; uid++) {
    const alpha = randScaled() * 0.2;
    for (const year of years) {
      const treated = year >= 2006 ? 1 : 0;
      const tau     = treated ? 0.3 : 0;
      const gamma   = year === 2003 ? 0 : year === 2004 ? 0.05 : year === 2005 ? 0.08 : 0.12;
      const y       = 5.0 + alpha + gamma + tau + randScaled() * 0.01;
      rows.push({ county: uid, year, lemp: y, first_treat: 2006 });
    }
  }

  // Never-treated: units 9–12 (first_treat = 0)
  for (let uid = 9; uid <= 12; uid++) {
    const alpha = randScaled() * 0.2;
    for (const year of years) {
      const gamma = year === 2003 ? 0 : year === 2004 ? 0.05 : year === 2005 ? 0.08 : 0.12;
      const y     = 5.0 + alpha + gamma + randScaled() * 0.01;
      rows.push({ county: uid, year, lemp: y, first_treat: 0 });
    }
  }

  return rows;
}

// ─── SUITE 1: Internal consistency (engine vs. known DGP) ────────────────────
// We verify that:
//   1. Pre-trend ATTs are near zero (parallel trends holds in synthetic data).
//   2. Post-treatment ATTs for cohort 2004 are near 0.5.
//   3. Post-treatment ATTs for cohort 2006 are near 0.3.
//   4. Event-study aggregation is a weighted average of cohort ATTs.
//   5. Overall ATT is a weighted average of post ATTs.
function suiteSyntheticDGP() {
  const rows = makeMpdtaLike();
  const res = runCallawayCS(
    rows,
    { yCol: "lemp", entityCol: "county", timeCol: "year", treatCol: "first_treat",
      compGroup: "nevertreated" },
  );

  if (res.error) {
    console.warn("  Engine error:", res.error);
    return { pass: 0, fail: 1 };
  }

  let pass = 0, fail = 0;

  // Raw ATT(g,t) table
  const attGT = res.attGT;

  // Cohort 2004 post-treatment ATTs: should be near 0.5 (DGP)
  const c2004post = attGT.filter(e => e.g === 2004 && e.t >= 2004);
  for (const e of c2004post) {
    const ok = check(`ATT(g=2004, t=${e.t}) ≈ 0.5`, e.att, 0.5, 0.05);
    ok ? pass++ : fail++;
  }

  // Cohort 2006 post-treatment ATTs: should be near 0.3
  const c2006post = attGT.filter(e => e.g === 2006 && e.t >= 2006);
  for (const e of c2006post) {
    const ok = check(`ATT(g=2006, t=${e.t}) ≈ 0.3`, e.att, 0.3, 0.05);
    ok ? pass++ : fail++;
  }

  // Pre-trend ATTs: should be near zero
  const preTrend = attGT.filter(e => e.t < e.g);
  for (const e of preTrend) {
    const ok = check(`Pre-trend ATT(g=${e.g}, t=${e.t}) ≈ 0`, e.att, 0, 0.05);
    ok ? pass++ : fail++;
  }

  // Event-study: rel=0 (first treated period) ATT should be ≈ weighted avg of 0.5 and 0.3
  const evtRel0 = res.eventCoeffs.find(e => e.k === 0);
  if (evtRel0) {
    // 4 units in each cohort → equal weights → (0.5 + 0.3) / 2 = 0.4
    const ok = check(`Event-study ATT(rel=0) ≈ 0.4`, evtRel0.beta, 0.4, 0.05);
    ok ? pass++ : fail++;
  } else {
    console.warn("  ✗ Event-study rel=0 not found");
    fail++;
  }

  // Overall ATT: should be between 0.3 and 0.5
  const att = res.att;
  const attOk = att != null && att > 0.3 && att < 0.55;
  if (!attOk) {
    console.warn(`  ✗ Overall ATT out of range: got ${att}`);
    fail++;
  } else {
    console.log(`  ✓ Overall ATT = ${att?.toFixed(4)} (in expected range [0.3, 0.55])`);
    pass++;
  }

  // SE should be positive and finite
  const seOk = res.attSE > 0 && isFinite(res.attSE);
  if (!seOk) {
    console.warn(`  ✗ Overall SE not positive finite: ${res.attSE}`);
    fail++;
  } else {
    console.log(`  ✓ Overall SE = ${res.attSE?.toFixed(4)} (positive finite)`);
    pass++;
  }

  // varNames should match relative periods
  const hasVarNames = res.varNames.length > 0 && res.varNames.every(v => v.startsWith("rel_"));
  if (!hasVarNames) {
    console.warn("  ✗ varNames not in rel_N format:", res.varNames);
    fail++;
  } else {
    pass++;
  }

  return { pass, fail };
}

// ─── SUITE 2: Not-yet-treated comparison group ────────────────────────────────
function suiteNotYetTreated() {
  const rows = makeMpdtaLike();
  const res = runCallawayCS(
    rows,
    { yCol: "lemp", entityCol: "county", timeCol: "year", treatCol: "first_treat",
      compGroup: "notyettreated" },
  );

  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Not-yet-treated engine error:", res.error);
    return { pass: 0, fail: 1 };
  }

  // Should still produce sensible ATTs with not-yet-treated controls
  const postOk = res.attGT.filter(e => e.t >= e.g).every(e => Number.isFinite(e.att));
  if (!postOk) {
    console.warn("  ✗ Non-finite ATTs with not-yet-treated controls");
    fail++;
  } else {
    pass++;
  }

  // SE should be positive
  if (!(res.attSE > 0 && isFinite(res.attSE))) {
    console.warn("  ✗ Non-positive SE with not-yet-treated controls:", res.attSE);
    fail++;
  } else {
    pass++;
  }

  return { pass, fail };
}

// ─── SUITE 3: Event-window trimming ──────────────────────────────────────────
function suiteEventWindow() {
  const rows = makeMpdtaLike();
  const res = runCallawayCS(
    rows,
    { yCol: "lemp", entityCol: "county", timeCol: "year", treatCol: "first_treat",
      compGroup: "nevertreated", relMin: -1, relMax: 1 },
  );

  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Window trimming engine error:", res.error);
    return { pass: 0, fail: 1 };
  }

  const ks = res.eventCoeffs.map(e => e.k);
  const inWindow = ks.every(k => k >= -1 && k <= 1);
  if (!inWindow) {
    console.warn("  ✗ Event window not respected:", ks);
    fail++;
  } else {
    pass++;
    console.log("  ✓ Event window [-1, 1] respected:", ks);
  }

  return { pass, fail };
}

// ─── SUITE 4: Single-cohort degenerate case ───────────────────────────────────
function suiteSingleCohort() {
  // Only one treated cohort — CS should still work
  const years = [2003, 2004, 2005];
  const rows = [];
  const rand = makeLCG(99);
  function randScaled() {
    return rand() * 0.04 - 0.02;
  }
  // 4 treated units (g=2004), 4 control units
  for (let uid = 1; uid <= 4; uid++) {
    const a = randScaled();
    for (const y of years) {
      rows.push({ id: uid, t: y, y: 5 + a + (y >= 2004 ? 0.5 : 0) + randScaled(), g: 2004 });
    }
  }
  for (let uid = 5; uid <= 8; uid++) {
    const a = randScaled();
    for (const y of years) {
      rows.push({ id: uid, t: y, y: 5 + a + randScaled(), g: 0 });
    }
  }

  const res = runCallawayCS(rows, { yCol: "y", entityCol: "id", timeCol: "t", treatCol: "g" });
  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Single-cohort error:", res.error);
    return { pass: 0, fail: 1 };
  }

  // Overall ATT ≈ 0.5
  const ok = check("Single-cohort overall ATT ≈ 0.5", res.att, 0.5, 0.06);
  ok ? pass++ : fail++;

  return { pass, fail };
}

// TODO: add R fixture comparison suite once mpdta rows are wired (callawayRValidation.R)

// ─── RUNNER ──────────────────────────────────────────────────────────────────
export function runCallawayCSValidation() {
  const suites = [
    // Task 2: Enumeration + Control Set
    { name: "T2A: Base-period varying (enumerateCells)", fn: suiteBasePeriodVarying },
    { name: "T2B: Base-period universal (enumerateCells)", fn: suiteBasePeriodUniversal },
    { name: "T2C: Control set never-treated", fn: suiteControlSetNeverTreated },
    { name: "T2D: Control set not-yet-treated", fn: suiteControlSetNotYetTreated },
    { name: "T2E: Control set fallback", fn: suiteControlSetFallback },
    // Task 4+: Full engine tests
    { name: "Synthetic DGP (OR estimator, never-treated)",  fn: suiteSyntheticDGP },
    { name: "Not-yet-treated comparison group",             fn: suiteNotYetTreated },
    { name: "Event-window trimming [−1, +1]",              fn: suiteEventWindow   },
    { name: "Single-cohort degenerate case",               fn: suiteSingleCohort  },
  ];

  const results = [];

  for (const { name, fn } of suites) {
    let pass = 0, fail = 0;
    const origWarn = console.warn;
    const errs = [];
    console.warn = (...args) => errs.push(args.join(" "));
    try {
      const r = fn();
      pass = r.pass; fail = r.fail;
    } catch (e) {
      errs.push("EXCEPTION: " + e.message);
      fail++;
    } finally {
      console.warn = origWarn;
    }
    if (errs.length) errs.forEach(e => console.warn("  " + e));
    results.push({ name, pass, fail, ok: fail === 0 });
  }

  const totalPass = results.reduce((s, r) => s + r.pass, 0);
  const totalFail = results.reduce((s, r) => s + r.fail, 0);
  const allOk     = results.every(r => r.ok);

  console.log(
    `\nCallaway-Sant'Anna validation: ${totalPass} passed, ${totalFail} failed` +
    (allOk ? " ✓ ALL GREEN" : " ✗ FAILURES DETECTED")
  );

  // Expose results for validation harness
  if (typeof window !== "undefined") {
    window.__validation = window.__validation ?? {};
    window.__validation.callawayCS = {
      suites: results,
      note: "Run callawayRValidation.R to get exact mpdta fixtures, then compare with runCallawayCS on the mpdta dataset loaded in the browser.",
    };
  }

  return results;
}

// Auto-run in Node (for CI)
if (typeof process !== "undefined" && process.argv?.[1]?.includes("callawayValidation")) {
  const r = runCallawayCSValidation();
  process.exit(r.every(s => s.ok) ? 0 : 1);
}
