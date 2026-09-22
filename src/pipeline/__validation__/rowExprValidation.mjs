// ─── ECON STUDIO · rowExprValidation.mjs ─────────────────────────────────────
// Pins R's missing-value convention for row expressions (pipeline/rowExpr.js,
// Franco 2026-09-22) and its emission (services/export/rowExprExport.js).
// The end-to-end proof — the same steps RUN in R, Stata and Python and
// compared cell by cell — is tools/validation/checkNAExpr.mjs; this file is
// the node-only guard.
//   node src/pipeline/__validation__/rowExprValidation.mjs

import assert from "node:assert/strict";
import { runPipeline } from "../runner.js";
import { makeRowFn, parseRowExpr } from "../rowExpr.js";
import { mutateStep, filterExprStep, caseWhenStep, rowExprSt } from "../../services/export/rowExprExport.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

const rows = [{ x: null, y: 1 }, { x: 0, y: null }, { x: 5, y: 0 }];
const col = (expr) => runPipeline(rows, ["x", "y"], [{ type: "mutate", nn: "v", expr }], {}).rows.map(r => r.v);

check("T1 a comparison with a missing value is missing (was TRUE for >=, <, !=)", () => {
  assert.deepEqual(col("x != 0"), [null, false, true]);
  assert.deepEqual(col("x >= 0"), [null, true, true]);
  assert.deepEqual(col("x < 1"),  [null, true, false]);
});

check("T2 & and | are three-valued (Kleene)", () => {
  // x NA & y==1 → NA; x 0 → FALSE whatever y is; TRUE | NA → TRUE.
  assert.deepEqual(col("x > 0 & y == 1"), [null, false, false]);
  assert.deepEqual(col("x > 0 | y == 1"), [true, null, true]);
  assert.deepEqual(col("x > 0 && y == 1"), [null, false, false]);
});

check("T3 arithmetic propagates NA; ^ is a power, % floors", () => {
  assert.deepEqual(col("x + 1"), [null, 1, 6]);
  assert.deepEqual(col("x ^ 2"), [null, 0, 25]);           // was bitwise XOR: 5 ^ 2 = 7
  assert.deepEqual(runPipeline([{ a: -7 }], ["a"], [{ type: "mutate", nn: "m", expr: "a % 3" }], {}).rows[0].m, 2);
});

check("T4 !, ifelse and the ternary give NA on an NA condition", () => {
  assert.deepEqual(col("!(x > 0)"), [null, true, false]);
  assert.deepEqual(col("ifelse(x > 0, 1, 0)"), [null, 0, 1]);
  assert.deepEqual(col("x > 0 ? 1 : 0"), [null, 0, 1]);
});

check("T5 %in% is never NA; R precedence: !x == 0 is !(x == 0)", () => {
  assert.deepEqual(col("x %in% c(0, 5)"), [false, true, true]);
  assert.deepEqual(col("x %in% c(1, NA)"), [true, false, false]);
  assert.deepEqual(col("!x == 0"), [null, false, true]);
  assert.deepEqual(col("x %in% 1:5"), [false, false, true]);
});

check("T6 filter drops NA; if_else gives NA; case_when skips an NA condition", () => {
  assert.equal(runPipeline(rows, ["x", "y"], [{ type: "filter", expr: "x >= 0" }], {}).rows.length, 2);
  const ife = runPipeline(rows, ["x", "y"], [{ type: "if_else", nn: "f", cond: "x > 1", trueVal: "1", falseVal: "0" }], {});
  assert.deepEqual(ife.rows.map(r => r.f), [null, 0, 1]);
  const cw = runPipeline(rows, ["x", "y"], [{ type: "case_when", nn: "c", cases: [{ cond: "x > 1", val: "a" }], defaultVal: "z" }], {});
  assert.deepEqual(cw.rows.map(r => r.c), ["z", "z", "a"]);
});

check("T7 grouped any() skips an NA row argument (PS5's treat)", () => {
  // municipality 47: trarrprop missing in 2015 → the argument is NA, not TRUE.
  const d = [{ m: 47, t: null, yr: 2015 }, { m: 47, t: 0, yr: 2010 }, { m: 1, t: 2, yr: 2015 }];
  const out = runPipeline(d, ["m", "t", "yr"], [{ type: "grouped_mutate", by: ["m"], fn: "expr", expr: "any(t != 0 & yr == 2015)", filter: [], newCol: "treat" }], {});
  assert.deepEqual(out.rows.map(r => r.treat), [0, 0, 1]);
});

check("T8 an unparseable expression still runs on the old evaluation", () => {
  const f = makeRowFn("[1, 2].map(v => v * x)[1]", ["x"]);
  assert.equal(f.naAware, false);
  assert.equal(f(3), 6);
  assert.equal(makeRowFn("x + 1", ["x"]).naAware, true);
});

check("T9 exports: R native, Python nullable dtypes, Stata (value, missing) pairs", () => {
  assert.match(mutateStep("r", { nn: "v", expr: "x != 0 & y > 1" }), /mutate\(v = \(\(x != 0\) & \(y > 1\)\)\)/);
  assert.match(mutateStep("python", { nn: "v", expr: "x != 0" }), /df\["x"\]\.convert_dtypes\(\) != 0/);
  const st = rowExprSt("x > 0 & y == 1");
  // FALSE & NA is FALSE: missing only when neither side is a definite FALSE.
  assert.match(st.m, /missing\(x\) \| missing\(y\)/);
  assert.match(st.m, /!missing\(x\) & !\(\(x > 0\)\)/);
  assert.match(filterExprStep("stata", "x > 0"), /^keep if \(!missing\(x\) & \(\(x > 0\)\)\)$/);
});

check("T10 Stata case_when is one nested cond(): the FIRST true condition wins", () => {
  const st = caseWhenStep("stata", { nn: "c", cases: [{ cond: "x > 1", val: "a" }, { cond: "x > 0", val: "b" }], defaultVal: "z" });
  assert.match(st, /cond\(\(!missing\(x\) & \(\(x > 1\)\)\), "a", cond\(\(!missing\(x\) & \(\(x > 0\)\)\), "b", "z"\)\)/);
});

check("T11 parser: literals, NA words, is.na(), member calls", () => {
  assert.equal(parseRowExpr("NA").t, "null");
  assert.equal(parseRowExpr("is.na(x)").fn, "isna");
  assert.equal(parseRowExpr("g.toLowerCase()").t, "mcall");
  assert.equal(parseRowExpr("1e-3").v, 0.001);
  assert.throws(() => parseRowExpr("x = 1"));
});

console.log(`\nrowExpr: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
