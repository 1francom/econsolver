// ─── ECON STUDIO · coefGroupsValidation.mjs ──────────────────────────────────
// Pins the factor-level grouping used by the forest plot and the significance
// callout. Run it:  node src/components/modeling/__validation__/coefGroupsValidation.mjs
//
// The load-bearing case is T5: a model with NO factor variables must behave
// exactly as it did before grouping existed. The grouping is opt-in on
// spec.factorVars, so an estimator that never populates it cannot regress.

import assert from "node:assert/strict";
import {
  buildCoefGroups, visibleCoefNames, hiddenCoefNames, FACTOR_COLLAPSE_MIN,
} from "../coefGroups.js";

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

// The real case this was built for: 2SLS on 93 municipality dummies, where the
// two estimated terms were buried among the levels.
const muni  = Array.from({ length: 93 }, (_, i) => `municipality_${i + 2}`);
const names = ["treat_x_post", ...muni, "post"];

check("T1 a many-level factor collapses into one group", () => {
  const { groups } = buildCoefGroups(names, ["municipality"]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].base, "municipality");
  assert.equal(groups[0].levels.length, 93);
});

check("T1b only the real regressors are visible by default", () => {
  const { levelOf } = buildCoefGroups(names, ["municipality"]);
  assert.deepEqual(visibleCoefNames(names, levelOf, new Set()), ["treat_x_post", "post"]);
  assert.equal(hiddenCoefNames(names, levelOf, new Set()).length, 93);
});

check("T1c expanding the group shows every level", () => {
  const { levelOf } = buildCoefGroups(names, ["municipality"]);
  const exp = new Set(["municipality"]);
  assert.equal(visibleCoefNames(names, levelOf, exp).length, names.length);
  assert.equal(hiddenCoefNames(names, levelOf, exp).length, 0);
});

check(`T2 a factor below the ${FACTOR_COLLAPSE_MIN}-level threshold is left alone`, () => {
  const small = ["x", "region_north", "region_south", "region_east"];
  const { groups, levelOf } = buildCoefGroups(small, ["region"]);
  assert.equal(groups.length, 0);
  assert.deepEqual(visibleCoefNames(small, levelOf, new Set()), small);
});

check("T3 interaction terms are never grouped, even on a grouped factor", () => {
  const ix = [...muni, ...muni.map(m => `${m}:post`), "x"];
  const { groups, levelOf } = buildCoefGroups(ix, ["municipality"]);
  assert.equal(groups[0].levels.length, 93, "plain levels group");
  assert.equal([...levelOf.keys()].filter(k => k.includes(":")).length, 0,
    "an interaction is a term the user wrote, not a level the app generated");
});

check("T4 the unexpanded base name is not one of its own levels", () => {
  const { levelOf } = buildCoefGroups(["municipality", "municipality_2", "x"], ["municipality"]);
  assert.equal(levelOf.has("municipality"), false);
});

check("T5 REGRESSION: no factorVars means no change at all", () => {
  const { groups, levelOf } = buildCoefGroups(names, []);
  assert.equal(groups.length, 0);
  assert.deepEqual(visibleCoefNames(names, levelOf, new Set()), names);
  assert.equal(hiddenCoefNames(names, levelOf, new Set()).length, 0);
});

check("T6 a factorVar that was never expanded contributes no group", () => {
  const { groups } = buildCoefGroups(["x", "y"], ["municipality"]);
  assert.equal(groups.length, 0);
});

check("T7 two grouped factors stay independent", () => {
  const yrs   = Array.from({ length: 10 }, (_, i) => `year_${2000 + i}`);
  const both  = ["x", ...muni, ...yrs];
  const { groups, levelOf } = buildCoefGroups(both, ["municipality", "year"]);
  assert.equal(groups.length, 2);
  assert.deepEqual(visibleCoefNames(both, levelOf, new Set(["year"])), ["x", ...yrs]);
});

console.log(`\ncoefGroups: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
