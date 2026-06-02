// ─── ECON STUDIO · src/math/__validation__/dgpValidation.js ───────────────────
// Node-runnable structural validation for the Simulate-tab DGP builder draws.
// Run:  node src/math/__validation__/dgpValidation.js
// Also exposes window.__validation.dgp when imported in the browser.
//
// drawSamples is the SINGLE shared source imported by BOTH the main thread
// (SimulateTab.jsx) and the expression worker (workers/exprEval.worker.js), so
// preview and generated output cannot drift. These checks are structural (no R
// 6dp numeric harness needed): Categorical proportions converge to `probs` for a
// fixed seed, and GroupID/CycleID reproduce the exact rep(...) integer patterns.

import { mulberry32 } from "../rng.js";
import { drawSamples, parseLevels, coerceLevel } from "../dgpDraw.js";

const TOL = 1e-9;
const TOL_PROP = 0.02;   // categorical proportions: ±2pp at n=50k for a fixed seed

function near(a, b, tol) {
  if (!isFinite(a) && !isFinite(b)) return true;
  return Math.abs(a - b) <= tol;
}

let _fails = [];
function check(label, got, want, tol = TOL) {
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

// parseLevels / coerceLevel: parsing of the comma-list params.
function suiteParse(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  // Blank probs → uniform normalized weights.
  const u = parseLevels({ levels: "A,B,C,D" });
  T(check("parse.uniform.k", u.levels.length, 4, TOL));
  T(check("parse.uniform.prob", u.probs[0], 0.25, 1e-12));
  T(check("parse.uniform.sum", u.probs.reduce((a, b) => a + b, 0), 1, 1e-12));
  // Explicit weights are normalized to sum 1.
  const w = parseLevels({ levels: "A,B,C", probs: "1,1,2" });
  T(check("parse.weighted.p0", w.probs[0], 0.25, 1e-12));
  T(check("parse.weighted.p2", w.probs[2], 0.50, 1e-12));
  // Mismatched prob count → fall back to uniform.
  const m = parseLevels({ levels: "A,B,C", probs: "1,1" });
  T(check("parse.mismatch.uniform", m.probs[0], 1 / 3, 1e-12));
  // Whitespace + empty tokens trimmed/dropped.
  const s = parseLevels({ levels: " A , B , " });
  T(check("parse.trim.k", s.levels.length, 2, TOL));
  T(check("parse.trim.first", s.levels[0] === "A" ? 1 : 0, 1, TOL));
  // coerceLevel: numeric-looking → Number, else String.
  T(check("coerce.int", coerceLevel("2"), 2, TOL));
  T(check("coerce.float", coerceLevel("1.5"), 1.5, TOL));
  T(check("coerce.neg", coerceLevel("-3"), -3, TOL));
  T(check("coerce.sci", coerceLevel("1e2"), 100, TOL));
  T(check("coerce.string", coerceLevel("Control") === "Control" ? 1 : 0, 1, TOL));
  return { pass, fail };
}

// Categorical: seeded proportions converge to probs; labels vs codes.
function suiteCategorical(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const n = 50000;
  const params = { levels: "A,B,C", probs: "0.2,0.3,0.5" };

  // Labels by default (string output → drives the string-preservation use case).
  const rng = mulberry32(12345);
  const draws = drawSamples(rng, n, "Categorical", params);
  T(check("cat.length", draws.length, n, TOL));
  const cA = draws.filter(v => v === "A").length / n;
  const cB = draws.filter(v => v === "B").length / n;
  const cC = draws.filter(v => v === "C").length / n;
  T(check("cat.propA", cA, 0.2, TOL_PROP));
  T(check("cat.propB", cB, 0.3, TOL_PROP));
  T(check("cat.propC", cC, 0.5, TOL_PROP));
  T(check("cat.partition", cA + cB + cC, 1, 1e-9)); // every draw landed in a level

  // asCode → integer index 0..k-1, same proportions per code.
  const rng2 = mulberry32(12345);
  const codes = drawSamples(rng2, n, "Categorical", { ...params, asCode: true });
  T(check("cat.code.values", codes.every(v => v === 0 || v === 1 || v === 2) ? 1 : 0, 1, TOL));
  T(check("cat.code.prop2", codes.filter(v => v === 2).length / n, 0.5, TOL_PROP));

  // Numeric labels coerce to Number (sample(c(0,1)) behaves as numeric factor).
  const rng3 = mulberry32(7);
  const num = drawSamples(rng3, 1000, "Categorical", { levels: "0,1" });
  T(check("cat.numeric.coerced", num.every(v => typeof v === "number") ? 1 : 0, 1, TOL));

  // Empty levels → all null.
  const rng4 = mulberry32(1);
  const empty = drawSamples(rng4, 10, "Categorical", { levels: "" });
  T(check("cat.empty.null", empty.every(v => v === null) ? 1 : 0, 1, TOL));

  // Determinism: same seed → identical draw sequence.
  const dA = drawSamples(mulberry32(99), 200, "Categorical", params);
  const dB = drawSamples(mulberry32(99), 200, "Categorical", params);
  T(check("cat.deterministic", dA.every((v, i) => v === dB[i]) ? 1 : 0, 1, TOL));
  return { pass, fail };
}

// GroupID: rep(1:G, each = ceil(n/G)) entity-id pattern.
function suiteGroupID(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const cases = [
    { n: 12, G: 3 },  // 4 each → 1,1,1,1,2,2,2,2,3,3,3,3
    { n: 10, G: 4 },  // ceil(10/4)=3 → 1,1,1,2,2,2,3,3,3,4
    { n: 7,  G: 7 },  // 1 each → 1..7
    { n: 5,  G: 1 },  // all 1
  ];
  for (const { n, G } of cases) {
    const got = drawSamples(mulberry32(1), n, "GroupID", { groups: G });
    const blockSize = Math.max(1, Math.ceil(n / G));
    const want = Array.from({ length: n }, (_, i) => Math.floor(i / blockSize) + 1);
    const match = got.length === want.length && got.every((v, i) => v === want[i]);
    T(check(`group.n${n}.G${G}`, match ? 1 : 0, 1, TOL));
  }
  // First block all 1; last value never exceeds G.
  const g = drawSamples(mulberry32(1), 12, "GroupID", { groups: 3 });
  T(check("group.first", g[0], 1, TOL));
  T(check("group.maxLEG", Math.max(...g) <= 3 ? 1 : 0, 1, TOL));
  return { pass, fail };
}

// CycleID: rep(1:T, length.out = n) time-id-within-entity pattern.
function suiteCycleID(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const cases = [
    { n: 12, P: 3 },  // 1,2,3,1,2,3,...
    { n: 10, P: 4 },  // 1,2,3,4,1,2,3,4,1,2
    { n: 5,  P: 1 },  // all 1
    { n: 6,  P: 6 },  // 1..6
  ];
  for (const { n, P } of cases) {
    const got = drawSamples(mulberry32(1), n, "CycleID", { period: P });
    const want = Array.from({ length: n }, (_, i) => (i % P) + 1);
    const match = got.length === want.length && got.every((v, i) => v === want[i]);
    T(check(`cycle.n${n}.P${P}`, match ? 1 : 0, 1, TOL));
  }
  return { pass, fail };
}

// Panel skeleton: GroupID × CycleID lay down a balanced G×T panel.
function suitePanelSkeleton(check) {
  let pass = 0, fail = 0;
  const T = (ok) => { ok ? pass++ : fail++; };
  const G = 4, Tp = 5, n = G * Tp; // 20-row balanced panel
  const entity = drawSamples(mulberry32(1), n, "GroupID", { groups: G });
  const time   = drawSamples(mulberry32(1), n, "CycleID", { period: Tp });
  // Each (entity,time) pair appears exactly once → balanced panel.
  const seen = new Set();
  let dup = false;
  for (let i = 0; i < n; i++) {
    const key = `${entity[i]}|${time[i]}`;
    if (seen.has(key)) dup = true;
    seen.add(key);
  }
  T(check("panel.unique.pairs", dup ? 0 : 1, 1, TOL));
  T(check("panel.cell.count", seen.size, G * Tp, TOL));
  T(check("panel.entities", new Set(entity).size, G, TOL));
  T(check("panel.periods", new Set(time).size, Tp, TOL));
  return { pass, fail };
}

const SUITES = [
  ["parse", suiteParse],
  ["categorical", suiteCategorical],
  ["groupID", suiteGroupID],
  ["cycleID", suiteCycleID],
  ["panel-skeleton", suitePanelSkeleton],
];

export function runDgpValidation() {
  return SUITES.map(([n, fn]) => runSuite(n, fn));
}

// Node entrypoint
if (typeof process !== "undefined" && process.argv && process.argv[1] && new URL(import.meta.url).pathname.replace(/^\//, "") === process.argv[1].replace(/\\/g, "/")) {
  const results = runDgpValidation();
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
  window.__validation.dgp = runDgpValidation;
}
