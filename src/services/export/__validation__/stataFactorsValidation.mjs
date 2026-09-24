// ─── ECON STUDIO · stataFactorsValidation.mjs ────────────────────────────────
// Pins the string-factor `encode` emission. Run it:
//   node src/services/export/__validation__/stataFactorsValidation.mjs
//
// Backed by a real StataNow 19.5 run on 2026-09-12 (fixture_str.csv, levels
// south/north/east in deliberately non-alphabetical data order):
//
//   reg y x i.region            -> r(109) type mismatch, do-file dies
//   encode region, gen(region_n)
//   reg y x i.region_n          -> x 1.876057  north 1.328509  south -.6531979
//                                  _cons -.0364527
//   reg y x ib3.region_n        -> x 1.876057  east   .6531979 north  1.981706
//                                  _cons -.6896506
//
// Litux's own engine on the same fixture returns 1.876057254741 /
// 1.328508588282 / -0.653197878259 / -0.036452683844, and R's lm() and patsy's
// C() agree to the same digits. T5 is the regression guard: a NUMERIC factor
// must emit exactly what it emitted before this existed — no encode line.

import assert from "node:assert/strict";
import {
  factorLevelsFromMap, needsEncode, encodedName, encodedRefCode, stataEncodeLines,
} from "../stataFactors.js";
import { generateStataScript } from "../stataScript.js";

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

// What applyFactors puts on the result for factor(region) with the default ref.
const strMap = {
  region_north: { factor: "region", level: "north", ref: "east" },
  region_south: { factor: "region", level: "south", ref: "east" },
};
// …and for a numeric factor with levels 9/10/11 fully coded (ref === null).
const numMap = {
  f1_9:  { factor: "f1", level: 9,  ref: null },
  f1_10: { factor: "f1", level: 10, ref: null },
  f1_11: { factor: "f1", level: 11, ref: null },
};

check("T1 levels are recovered from the dummy map, reference included", () => {
  assert.deepEqual(factorLevelsFromMap(strMap), { region: ["east", "north", "south"] });
});

check("T2 numeric levels sort numerically, not lexicographically", () => {
  // The 9/10/11 trap: a lexicographic sort would give 10, 11, 9 and move the base.
  assert.deepEqual(factorLevelsFromMap(numMap), { f1: [9, 10, 11] });
});

check("T3 needsEncode splits string/fractional from integer levels", () => {
  assert.equal(needsEncode(["east", "north"]), true);
  assert.equal(needsEncode([9.5, 10.5]), true, "r(452): no noninteger factor values");
  assert.equal(needsEncode([9, 10, 11]), false);
  assert.equal(needsEncode([]), false);
});

check("T4 a string factor gets an encode line naming the encoded column", () => {
  const out = stataEncodeLines(["region"], { region: ["east", "north", "south"] }).join("\n");
  assert.match(out, /encode region, generate\(region_n\)/);
  assert.match(out, /capture drop region_n/, "re-running the do-file must not error");
  assert.equal(encodedName("region"), "region_n");
});

check("T5 REGRESSION: a numeric factor emits no encode line at all", () => {
  assert.deepEqual(stataEncodeLines(["f1"], { f1: [9, 10, 11] }), []);
});

check("T6 a custom string reference becomes encode's 1-based code", () => {
  const lv = ["east", "north", "south"];
  assert.equal(encodedRefCode("south", lv), 3);   // Stata ran ib3. and based on south
  assert.equal(encodedRefCode("east",  lv), 1);
  assert.equal(encodedRefCode("nope",  lv), null, "unknown level must not guess a code");
  assert.equal(encodedRefCode(null,    lv), null);
});

// ── End-to-end through the real exporter ────────────────────────────────────
const mkScript = (factorRefs, factorMap, xVars) => generateStataScript({
  filename: "d.csv",
  model: {
    type: "OLS", yVar: "y", xVars, allX: xVars,
    factorVars: Object.keys(factorLevelsFromMap(factorMap)),
    factorRefs, factorMap, xVarsRaw: xVars, seType: "classical",
  },
});

check("T7 END-TO-END string factor: encode emitted, term points at region_n", () => {
  const s = mkScript({}, strMap, ["x", "region"]);
  assert.match(s, /encode region, generate\(region_n\)/);
  assert.match(s, /^reg y x i\.region_n$/m, "the term must not be a bare i.region (r(109))");
  assert.doesNotMatch(s, /^reg .*\bi\.region\b(?!_n)/m);
});

check("T8 END-TO-END custom string ref: ib3.region_n plus the code mapping", () => {
  const s = mkScript({ region: "south" }, strMap, ["x", "region"]);
  assert.match(s, /^reg y x ib3\.region_n$/m);
  assert.match(s, /Reference categories after encode: region_n code 3 = "south"/);
  assert.match(s, /label list/, "the code->label mapping is invisible otherwise");
  assert.doesNotMatch(s, /needs a NUMERIC reference value/,
    "a string ref IS expressible now — the old NOTE must not fire");
});

check("T9 END-TO-END numeric factor is untouched by all of this", () => {
  const s = mkScript({}, numMap, ["x", "f1"]);
  assert.doesNotMatch(s, /encode/);
  assert.match(s, /^reg y x i\.f1$/m);
});

check("T10 levels unknown (model pinned before factorMap) still warns honestly", () => {
  const s = mkScript({ region: "south" }, null, ["x", "region"]);
  assert.doesNotMatch(s, /encode/, "no levels means no encode can be written");
  assert.doesNotMatch(s, /ib3\./, "and no code may be invented");
});

console.log(`\nstataFactors: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
