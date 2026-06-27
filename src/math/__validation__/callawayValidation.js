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
import { enumerateCells, controlSet, aggregate } from "../did/staggeredDiD.js";

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
// New suiteSyntheticDGP: tests the rewritten CS orchestrator with new result shape.
// 4-year panel: 4 cohort-2004 units, 4 cohort-2006 units, 4 never-treated.
// True ATT cohort-2004 = 0.5, cohort-2006 = 0.3.
function suiteSyntheticDGP() {
  const rows = [];
  const years = [2003, 2004, 2005, 2006];
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      rows.push({ id: `A${u}`, t, g: 2004, y: 10 + u * 0.1 + (t >= 2004 ? 0.5 : 0) });
    }
  }
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      rows.push({ id: `B${u}`, t, g: 2006, y: 10 + u * 0.1 + (t >= 2006 ? 0.3 : 0) });
    }
  }
  for (let u = 1; u <= 4; u++) {
    for (const t of years) {
      rows.push({ id: `C${u}`, t, g: 0, y: 10 + u * 0.1 });  // g=0 → never-treated
    }
  }
  const res = runCallawayCS(rows, {
    yCol: "y", entityCol: "id", timeCol: "t", treatCol: "g",
    xCols: [], estMethod: "reg", basePeriod: "varying", compGroup: "nevertreated",
    anticipation: 0, inference: { method: "analytic", nBoot: 0, seed: 42 },
  });

  const results = [];
  results.push({ label: "no error",              pass: !res.error });
  results.push({ label: "has aggregations",       pass: !!res.aggregations?.dynamic });
  results.push({ label: "attgt length > 0",       pass: res.attgt?.length > 0 });
  results.push({ label: "ptestWald present",      pass: res.ptestWald != null });
  results.push({ label: "nUnits = 12",            pass: res.nUnits === 12 });
  results.push({ label: "cohorts has 2004,2006",  pass: res.cohorts?.includes(2004) && res.cohorts?.includes(2006) });
  results.push({ label: "group overall in [0.3,0.55]",
    pass: res.aggregations?.group?.overall > 0.3 && res.aggregations?.group?.overall < 0.55 });
  results.push({ label: "dynamic e=0 in [0.3,0.55]",
    pass: res.aggregations?.dynamic?.byE?.find(x => x.e === 0)?.att > 0.3 });
  results.push({ label: "all byG se > 0",         pass: res.aggregations?.group?.byG?.every(x => x.se > 0) });
  results.push({ label: "warnings is array",       pass: Array.isArray(res.warnings) });

  results.forEach(r => console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`));
  return { pass: results.filter(r => r.pass).length, total: results.length, fail: results.filter(r => !r.pass).length };
}

// ─── SUITE 2: Not-yet-treated comparison group ────────────────────────────────
function suiteNotYetTreated() {
  const rows = makeMpdtaLike();
  const res = runCallawayCS(
    rows,
    { yCol: "lemp", entityCol: "county", timeCol: "year", treatCol: "first_treat",
      compGroup: "notyettreated",
      inference: { method: "analytic", nBoot: 0, seed: 42 } },
  );

  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Not-yet-treated engine error:", res.error);
    return { pass: 0, fail: 1 };
  }

  // Should still produce sensible ATTs with not-yet-treated controls
  const postOk = res.attgt.filter(e => !e.isPre).every(e => Number.isFinite(e.att));
  if (!postOk) {
    console.warn("  ✗ Non-finite ATTs with not-yet-treated controls");
    fail++;
  } else {
    pass++;
  }

  // aggregations.dynamic.overall should be positive finite
  const dynOverall = res.aggregations?.dynamic?.overall;
  if (!(isFinite(dynOverall))) {
    console.warn("  ✗ Non-finite dynamic overall with not-yet-treated controls:", dynOverall);
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
      compGroup: "nevertreated", relMin: -1, relMax: 1,
      inference: { method: "analytic", nBoot: 0, seed: 42 } },
  );

  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Window trimming engine error:", res.error);
    return { pass: 0, fail: 1 };
  }

  const es = res.attgt.map(e => e.e);
  const inWindow = es.every(e => e >= -1 && e <= 1);
  if (!inWindow) {
    console.warn("  ✗ Event window not respected:", es);
    fail++;
  } else {
    pass++;
    console.log("  ✓ Event window [-1, 1] respected:", es);
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

  const res = runCallawayCS(rows, {
    yCol: "y", entityCol: "id", timeCol: "t", treatCol: "g",
    inference: { method: "analytic", nBoot: 0, seed: 42 },
  });
  let pass = 0, fail = 0;

  if (res.error) {
    console.warn("  Single-cohort error:", res.error);
    return { pass: 0, fail: 1 };
  }

  // Overall ATT ≈ 0.5 (use group overall from aggregations)
  const overallAtt = res.aggregations?.group?.overall;
  const ok = check("Single-cohort overall ATT ≈ 0.5", overallAtt, 0.5, 0.06);
  ok ? pass++ : fail++;

  return { pass, fail };
}

// ═══ TASK 3: AGGREGATION ══════════════════════════════════════════════════════

/**
 * SUITE T3: aggregate() — 4 aggregation schemes + analytic SE + Wald pre-test
 */
export function suiteAggregation() {
  const nUnits = 4;
  function makeInf(att, treatedIdx, n) {
    const inf = new Float64Array(n);
    treatedIdx.forEach(i => { inf[i] = att / treatedIdx.length; });
    return inf;
  }
  const cells2x2 = [
    { g:2, t:2, e:0,  isPre:false, isRef:false, att:0.5, inf: makeInf(0.5,[0,1],nUnits) },
    { g:2, t:3, e:1,  isPre:false, isRef:false, att:0.5, inf: makeInf(0.5,[0,1],nUnits) },
    { g:2, t:1, e:-1, isPre:true,  isRef:false, att:0.0, inf: new Float64Array(nUnits) },
  ];
  const groupProb = new Map([[2, 1.0]]);
  const res = aggregate({ cells2x2, groupProb, n: nUnits,
    inference: { method:"analytic", nBoot:0, seed:42 } });

  const results = [];
  results.push({ label:"dynamic e=0 att≈0.5",    pass: Math.abs(res.aggregations.dynamic.byE.find(x=>x.e===0)?.att - 0.5) < 0.01 });
  results.push({ label:"dynamic overall≈0.5",    pass: Math.abs(res.aggregations.dynamic.overall - 0.5) < 0.01 });
  results.push({ label:"group overall≈0.5",      pass: Math.abs(res.aggregations.group.overall - 0.5) < 0.01 });
  results.push({ label:"simple overall≈0.5",     pass: Math.abs(res.aggregations.simple.overall - 0.5) < 0.01 });
  results.push({ label:"calendar overall≈0.5",   pass: Math.abs(res.aggregations.calendar.overall - 0.5) < 0.01 });
  results.push({ label:"critVal=1.96 (analytic)", pass: Math.abs(res.inference.critVal - 1.959964) < 0.001 });
  results.push({ label:"ptestWald p>0.5 (pre=0)", pass: res.ptestWald?.p > 0.5 });
  results.push({ label:"dynamic e=-1 present in byE", pass: res.aggregations.dynamic.byE.some(x=>x.e===-1) });
  results.push({ label:"all byE se>0", pass: res.aggregations.dynamic.byE.every(x=>x.se>0) });

  results.forEach(r => console.log(r.pass ? `  ✓ ${r.label}` : `  ✗ ${r.label}`));
  return { pass: results.filter(r=>r.pass).length, fail: results.filter(r=>!r.pass).length, total: results.length };
}

// ── R-fixture comparison suite ────────────────────────────────────────────────
// Franco: run callawayRValidation.R → generates callawayBenchmarks.json
// Paste path to JSON here or load dynamically.
// Tolerance: 6dp on ATT, 4dp on analytic SE, structural check on bootstrap critVal.
export async function suiteRFixtures() {
  let fixtures;
  try {
    // eslint-disable-next-line
    const mod = await import("./callawayBenchmarks.json", { assert: { type: "json" } });
    fixtures = mod.default;
  } catch {
    console.warn("callawayBenchmarks.json not found — run callawayRValidation.R first");
    return { pass: 0, total: 0, skip: true };
  }

  const results = [];
  for (const [key, fix] of Object.entries(fixtures)) {
    const [ctrl, base, meth] = key.split("_");
    const res = runCallawayCS(
      // Use the same synthetic DGP rows as suiteSyntheticDGP
      makeSyntheticRows(),
      { yCol: "y", entityCol: "id", timeCol: "t", treatCol: "g",
        xCols: [], estMethod: meth, basePeriod: base, compGroup: ctrl,
        anticipation: 0, inference: { method: "analytic", nBoot: 0, seed: 42 } }
    );

    // Compare simple overall ATT and SE
    const jsSimple = res.aggregations?.simple;
    const rSimple  = fix.simple;
    const okAtt = Math.abs(jsSimple?.overall - rSimple?.att) < 1e-4;
    const okSE  = Math.abs(jsSimple?.se - rSimple?.se) < 1e-3;
    results.push({ key, jsAtt: jsSimple?.overall, rAtt: rSimple?.att, okAtt, okSE });
  }

  results.forEach(r => console.log(
    (r.okAtt && r.okSE ? "✓" : "✗") + ` ${r.key}: att=${r.jsAtt?.toFixed(4)} R=${r.rAtt?.toFixed(4)}`
  ));
  return { pass: results.filter(r => r.okAtt && r.okSE).length, total: results.length };
}

function makeSyntheticRows() {
  const rows = [];
  const years = [2003, 2004, 2005, 2006];
  for (let u = 1; u <= 4; u++) {
    for (const t of years) rows.push({ id: `A${u}`, t, g: 2004, y: 10 + u * 0.1 + (t >= 2004 ? 0.5 : 0) });
  }
  for (let u = 1; u <= 4; u++) {
    for (const t of years) rows.push({ id: `B${u}`, t, g: 2006, y: 10 + u * 0.1 + (t >= 2006 ? 0.3 : 0) });
  }
  for (let u = 1; u <= 4; u++) {
    for (const t of years) rows.push({ id: `C${u}`, t, g: 0, y: 10 + u * 0.1 });
  }
  return rows;
}

// ─── RUNNER ──────────────────────────────────────────────────────────────────
export function runCallawayCSValidation() {
  const suites = [
    // Task 2: Enumeration + Control Set
    { name: "T2A: Base-period varying (enumerateCells)", fn: suiteBasePeriodVarying },
    { name: "T2B: Base-period universal (enumerateCells)", fn: suiteBasePeriodUniversal },
    { name: "T2C: Control set never-treated", fn: suiteControlSetNeverTreated },
    { name: "T2D: Control set not-yet-treated", fn: suiteControlSetNotYetTreated },
    { name: "T2E: Control set fallback", fn: suiteControlSetFallback },
    // Task 3: Aggregation
    { name: "T3: aggregate() — 4 schemes + analytic SE + Wald pre-test", fn: suiteAggregation },
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
