// ─── ECON STUDIO · groupedMutateExportValidation.mjs ─────────────────────────
// Pins the emission fixes the real-data harness forced (tools/validation,
// LM6 + PS5, 2026-09-18). Each check names the defect it guards:
//   grouped_mutate — R dropped the row filter, Python evaluated over the whole
//     frame and called an undefined `mean`, Stata emitted `egen = mean(<by>)`;
//   if_else — a branch naming a COLUMN was exported as a string literal;
//   predicates — Stata compared a numeric column to "1" (r(109)), and let
//     missing through `x > 5`.
// The end-to-end proof (scripts actually run, tables compared cell by cell)
// is tools/validation/checkPipelines.mjs; this file is the node-only guard.
//   node src/services/export/__validation__/groupedMutateExportValidation.mjs
import assert from "node:assert/strict";
import { groupedMutateR, groupedMutatePython, groupedMutateStata, safeGroupedMutate, planGroupedMutate } from "../groupedMutateExport.js";
import { ifElseR, ifElsePython, ifElseStata } from "../ifElseStep.js";
import { predicateToR, predicateToPython, predicateToStata } from "../../../pipeline/predicateExport.js";

let pass = 0;
const check = (name, fn) => { try { fn(); pass++; console.log(`  ok   ${name}`); }
  catch (e) { console.error(`  FAIL ${name}\n       ${e.message}`); process.exitCode = 1; } };

// LM6's second step: mean over the rows passing a filter, written to every row.
const lm6 = { type: "grouped_mutate", by: ["year"], fn: "expr", expr: "mean(log_mw_diff)",
  filter: [{ col: "log_mw_diff", op: ">", val: "0" }], newCol: "avg" };
// PS5's treatment flag: an aggregate over a ROW expression.
const ps5 = { type: "grouped_mutate", by: ["municipality"], fn: "expr",
  expr: "any(trarrprop != 0 && year == 2015)", filter: [], newCol: "treat" };

check("T1 the row filter reaches every language", () => {
  assert.match(groupedMutateR(lm6), /\.k <- rep_len\(\(log_mw_diff > 0\), dplyr::n\(\)\); \.k\[is\.na\(\.k\)\] <- FALSE/);
  assert.match(groupedMutatePython(lm6), /_k = pd\.Series\(\(\(df\["log_mw_diff"\] > 0\)\), index=df\.index\)\.fillna\(False\)/);
  assert.match(groupedMutateStata(lm6), /gen byte _lx_k = \(\(!missing\(log_mw_diff\) & log_mw_diff > 0\)\)/);
});

check("T2 Python reduces per group, never over the whole frame", () => {
  const py = groupedMutatePython(lm6);
  assert.doesNotMatch(py, /lambda/);
  assert.doesNotMatch(py, /[^.]\bmean\(/);
  assert.match(py, /\.groupby\(_keys, dropna=False\)\.transform\("mean"\)/);
});

check("T3 Stata aggregates the argument, not a by-column", () => {
  const st = groupedMutateStata(lm6);
  assert.doesNotMatch(st, /egen \w+ = mean\(year\)/);
  assert.match(st, /egen double _lx_a0 = mean\(cond\(_lx_k, _lx_t0, \.\)\)/);
  assert.match(st, /sort _lx_o/);   // bysort re-sorts; original order restored
});

check("T4 a row expression is parenthesised for pandas precedence", () => {
  // `a != 0 & b == 1` in pandas groups as `a != (0 & b) == 1`.
  assert.match(groupedMutatePython(ps5), /\(\(df\["trarrprop"\] != 0\) & \(df\["year"\] == 2015\)\)/);
  assert.match(groupedMutateStata(ps5), /max\(_lx_k & !missing\(_lx_t0\) & _lx_t0 != 0\)/);
});

check("T5 single-digit numbers tokenize", () => {
  assert.equal(planGroupedMutate(ps5).aggs.length, 1);
});

check("T6 non-expression modes carry their conditions; Stata never emits egen any()", () => {
  const anyStep = { type: "grouped_mutate", by: ["g"], fn: "any", newCol: "f",
    condition: [{ col: "x", op: "gt", val: "5" }] };
  assert.doesNotMatch(groupedMutateStata(anyStep), /egen \S+ = any\(/);
  assert.match(groupedMutateR(anyStep), /x > 5/);
});

check("T7 untranslatable input becomes a comment, not a wrong script", () => {
  const bad = { ...ps5, expr: "any(x => x)" };
  assert.match(safeGroupedMutate("r", bad), /^# grouped_mutate .*cannot be translated/);
  assert.match(safeGroupedMutate("stata", bad), /^\* grouped_mutate .*cannot be translated/);
});

const ife = { type: "if_else", nn: "logdist_post", cond: "year == 2015", trueVal: "logdist", falseVal: "0" };

check("T8 an if_else branch naming a column is resolved at run time", () => {
  assert.match(ifElseR(ife), /\(if \("logdist" %in% names\(df\)\) df\[\["logdist"\]\] else "logdist"\)/);
  assert.match(ifElsePython(ife), /\(df\["logdist"\] if "logdist" in df\.columns else "logdist"\)/);
  const st = ifElseStata(ife);
  assert.match(st, /capture confirm variable logdist/);
  assert.match(st, /gen logdist_post = cond\(year == 2015, `_lx_tv', 0, 0\)/);
});

check("T9 numeric literals stay numbers, missing condition takes the FALSE branch", () => {
  const post = { type: "if_else", nn: "post", cond: "year == 2014", trueVal: "0", falseVal: "1" };
  assert.match(ifElseR(post), /ifelse\(!is\.na\(\.c\) & \.c, 0, 1\)/);
  assert.match(ifElseStata(post), /cond\(year == 2014, 0, 1, 1\)/);
});

check("T10 numeric-looking eq/neq compare numerically on a numeric column", () => {
  const neq = { type: "condition", col: "municipality", op: "neq", value: "1" };
  assert.equal(predicateToStata(neq), "(!missing(municipality) & municipality != 1)");
  assert.match(predicateToR(neq), /if \(is\.numeric\(municipality\)\) municipality != 1 else/);
  assert.match(predicateToPython(neq), /if pd\.api\.types\.is_numeric_dtype\(df\["municipality"\]\) else/);
  // A genuine text value keeps the text comparison.
  assert.equal(predicateToStata({ type: "condition", col: "s", op: "eq", value: "abc" }), `s == "abc"`);
});

check("T11 Stata `x > 5` drops missing, like evalPredicate", () => {
  assert.equal(predicateToStata({ type: "condition", col: "x", op: "gt", value: "5" }), "(!missing(x) & x > 5)");
});

console.log(`\ngroupedMutateExport: ${pass} checks passed${process.exitCode ? " (with failures)" : ""}`);
