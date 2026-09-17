// ─── ECON STUDIO · stataJoinFeValidation.mjs ─────────────────────────────────
// Pins two export bugs found by running the emitted scripts against StataNow
// 19.5, R 4.4.1 (dplyr/fixest), Python (linearmodels) and Litux's own engines
// on 2026-09-12. Run it:
//   node src/services/export/__validation__/stataJoinFeValidation.mjs
//
// BUG 1 — `suffixes()` does not exist in Stata.
//   merge m:1 k using "r.dta", suffixes("" "_y")  ->  option suffixes() not
//   allowed, r(198). Every join / lookup / bind_cols died there. And on
//   cardinality, `merge 1:m` errors r(459) once the master key repeats, while
//   joinby returns dplyr's and Litux's counts in all three regimes
//   (200 / 200 / 60 for master-repeats / using-repeats / both-repeat).
//   The emitted join now runs and reproduces dplyr exactly: 200 rows,
//   columns k yr v meta v_y, with v = 1 (master) and v_y = 999 (using).
//
// BUG 2 — `xtreg, fe` absorbs ONE dimension, but the threshold was `<= 2`.
//   A two-dimension FE model exported a one-way model that RAN CLEANLY and
//   returned a different coefficient. On a 20x10 panel with a second dimension
//   varying within the entity, Litux, fixest and reghdfe all give
//   x = 2.598920041772 while the emitted do-file gave 2.842960069813 — exactly
//   `feols(y ~ x + z | a)`, which proves the second dimension was dropped. The
//   Python branch had the same defect (entity_effects alone, indexed on
//   entityCol/timeCol) and the same wrong number. Fixing the threshold then
//   exposed a THIRD bug in the newly-reachable LSDV branch: reghdfe's savefe
//   spelling is absorb(NEWVAR=fevar), and it emitted absorb(a=fe_a) — r(110)
//   "variable a already defined".

import assert from "node:assert/strict";
import { generateStataScript } from "../stataScript.js";
import { generatePythonScript } from "../pythonScript.js";
import { toStata } from "../../../pipeline/stepTranslators.js";
import { UNMATCHED_BY_HOW } from "../stataJoin.js";

let pass = 0;
const check = (name, fn) => {
  try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; }
};

const DS = { R: { name: "right", filename: "right.csv" } };
const joinStep = (how = "left") =>
  ({ type: "join", rightId: "R", leftKey: "k", rightKey: "k", how, suffix: "_y" });

// ── BUG 1: joins ─────────────────────────────────────────────────────────────
// Stata comments start with `*`. The emitted blocks legitimately MENTION
// suffixes() to explain why they cannot use it, so only code lines are checked.
const codeLines = out => out.split("\n").filter(l => !/^\s*\*/.test(l)).join("\n");

check("T1 no emitted Stata carries suffixes() — the option does not exist", () => {
  for (const step of [joinStep(),
                      { type: "lookup", rightId: "R", leftKey: "k", rightKey: "k", suffix: "_r" },
                      { type: "bind_cols", rightId: "R", suffix: "_r" }]) {
    const out = codeLines(toStata(step, "df", DS));
    assert.doesNotMatch(out, /suffixes\(/, `${step.type} still emits suffixes()`);
  }
});

check("T2 join uses joinby, not merge 1:m", () => {
  const out = toStata(joinStep(), "df", DS);
  assert.match(out, /joinby k using/);
  assert.doesNotMatch(out, /merge 1:m/, "merge 1:m errors r(459) on a repeated master key");
});

check("T3 join types map onto joinby's unmatched()", () => {
  assert.deepEqual(UNMATCHED_BY_HOW,
    { left: "master", inner: "none", right: "using", full: "both" });
  assert.match(toStata(joinStep("left"),  "df", DS), /unmatched\(master\)/);
  assert.match(toStata(joinStep("inner"), "df", DS), /unmatched\(none\)/);
});

check("T4 homonyms are renamed at runtime, reproducing the suffix", () => {
  const out = toStata(joinStep(), "df", DS);
  // Without suffixes(), joinby keeps only the master's copy of a shared column.
  assert.match(out, /unab _mastervars : _all/);
  assert.match(out, /foreach _v of local _mastervars/);
  assert.match(out, /rename `_v' `_v'_y/);
  // The varlist must be captured BEFORE preserve — macros survive it, data does not.
  assert.ok(out.indexOf("unab _mastervars") < out.indexOf("preserve"),
    "unab must precede preserve or the master's names are already gone");
});

check("T5 the join key itself is never suffixed", () => {
  const out = toStata(joinStep(), "df", DS);
  assert.match(out, /if "`_v'" != "k"/);
});

check("T6 lookup keeps merge m:1 — that step is m:1 by contract", () => {
  const out = toStata({ type: "lookup", rightId: "R", leftKey: "k", rightKey: "k", suffix: "_r" }, "df", DS);
  assert.match(out, /merge m:1 k using/);
});

// ── BUG 2: FE dimension thresholds ───────────────────────────────────────────
const mk = (type, feCols) => ({
  filename: "p.csv",
  model: { type, yVar: "y", xVars: ["x", "z"], allX: ["x", "z"],
           entityCol: "a", timeCol: "t", feCols, seType: "classical" },
});

check("T7 REGRESSION: one FE dimension still emits xtreg, fe", () => {
  const s = generateStataScript(mk("FE", ["a"]));
  // The panel id goes through a runtime numeric check (group() for a string
  // id, which xtset rejects with r(109)); a numeric id is used as is.
  assert.match(s, /^if _rc == 0 local _pid a$/m);
  assert.match(s, /^xtset `_pid' t$/m);
  assert.match(s, /^xtreg y x z, fe$/m);
  assert.doesNotMatch(s, /reghdfe/);
});

check("T8 two FE dimensions must absorb BOTH, via reghdfe", () => {
  const s = generateStataScript(mk("FE", ["a", "b"]));
  assert.match(s, /^reghdfe y x z, absorb\(a b\)/m);
  assert.doesNotMatch(s, /^xtreg /m, "xtreg absorbs only the xtset panel id");
});

check("T9 LSDV savefe spelling is absorb(NEWVAR=fevar), not the reverse", () => {
  const s = generateStataScript(mk("LSDV", ["a", "b"]));
  assert.match(s, /absorb\(fe_a=a fe_b=b\)/, "absorb(a=fe_a) is r(110)");
  assert.doesNotMatch(s, /absorb\(a=fe_a/);
});

check("T10 REGRESSION: one-dimension LSDV keeps xtreg + areg", () => {
  const s = generateStataScript(mk("LSDV", ["a"]));
  assert.match(s, /^xtreg y x z, fe$/m);
  assert.match(s, /^areg y x z, absorb\(`_pid'\)/m);
});

check("T11 Python FE indexes the FE columns and turns time_effects on", () => {
  const s = generatePythonScript(mk("FE", ["a", "b"]));
  assert.match(s, /df_panel = df\.set_index\(\["a", "b"\]\)/);
  assert.match(s, /entity_effects=True, time_effects=True/);
});

check("T12 REGRESSION: one-dimension Python FE keeps entity_effects alone", () => {
  const s = generatePythonScript(mk("FE", ["a"]));
  assert.match(s, /df_panel = df\.set_index\(\["a", "t"\]\)/);
  assert.match(s, /entity_effects=True\)/);
  assert.doesNotMatch(s, /time_effects=True/,
    "absorbing a dimension the model never declared is the mirror-image bug");
});

console.log(`\nstataJoinFe: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
