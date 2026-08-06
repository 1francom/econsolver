// Filter predicates must survive the trip into a replication script.
//
// Before this module, all three translators read `step.op` — undefined for the
// compound trees CleanTab actually emits — and fell through to a permissive
// default, so `year >= 2015 AND region contains "nor"` exported as
// `filter(TRUE)` / `df[True]` / `keep if 1`. The script ran, returned more rows
// than the analysis, and said nothing.
import assert from "node:assert/strict";
import { predicateToR, predicateToPython, predicateToStata } from "../predicateExport.js";

const cond = (col, op, extra = {}) => ({ type: "condition", col, op, ...extra });
const tree = {
  type: "and",
  children: [cond("year", "gte", { value: 2015 }), cond("region", "contains", { value: "nor" })],
};

// ─── the regression: a compound tree must never compile to keep-everything ────
for (const [name, fn, keepAll] of [
  ["R", predicateToR, /^TRUE$/],
  ["Python", predicateToPython, /^True$/],
  ["Stata", predicateToStata, /^1$/],
]) {
  const out = fn(tree);
  assert.doesNotMatch(out, keepAll, `${name} compiled a real filter to keep-everything`);
  assert.match(out, /year/, `${name} lost the year condition`);
  assert.match(out, /region/, `${name} lost the region condition`);
}

// ─── R ────────────────────────────────────────────────────────────────────────
assert.equal(predicateToR(cond("a", "isna")),  "is.na(a)");
assert.equal(predicateToR(cond("a", "notna")), "!is.na(a)");
// eq compares as TEXT, matching evalPredicate's `sv === String(val)`.
assert.match(predicateToR(cond("a", "eq", { value: "x" })), /as\.character\(a\) == "x"/);
assert.match(predicateToR(cond("a", "gt", { value: 5 })), /a > 5/);
assert.match(predicateToR(cond("a", "between", { lo: 1, hi: 5 })), /a >= 1 & a <= 5/);
assert.match(predicateToR(cond("a", "in", { values: ["x", "y"] })), /%in% c\("x", "y"\)/);
// nin must exclude NA explicitly: in R, `NA %in% c(...)` is FALSE, so a bare
// negation would KEEP null rows, while evalPredicate drops them.
assert.match(predicateToR(cond("a", "nin", { values: ["x"] })), /!is\.na\(a\)/);
// String ops are case-insensitive, so grepl carries ignore.case.
assert.match(predicateToR(cond("a", "contains",   { value: "x" })), /grepl\(.*ignore\.case = TRUE\)/);
assert.match(predicateToR(cond("a", "startswith", { value: "x" })), /grepl\("\^x"/);
assert.match(predicateToR(cond("a", "endswith",   { value: "x" })), /grepl\("x\$"/);
// A literal search term must be regex-escaped before it reaches grepl.
assert.match(predicateToR(cond("a", "contains", { value: "a.b" })), /a\\\\\.b/);
// Quotes in a value are escaped, not left to break the script.
assert.match(predicateToR(cond("a", "eq", { value: 'he said "hi"' })), /\\"hi\\"/);
// or-nodes
assert.match(
  predicateToR({ type: "or", children: [cond("a", "isna"), cond("b", "notna")] }),
  /\(is\.na\(a\) \| !is\.na\(b\)\)/
);

// ─── Python ───────────────────────────────────────────────────────────────────
assert.match(predicateToPython(cond("a", "isna")),  /df\["a"\]\.isna\(\)/);
assert.match(predicateToPython(cond("a", "eq", { value: "x" })), /astype\("string"\) == "x"/);
// A NA-bearing mask cannot be used for boolean indexing in pandas, so equality
// masks must be filled.
assert.match(predicateToPython(cond("a", "eq", { value: "x" })), /fillna\(False\)/);
assert.match(predicateToPython(cond("a", "in", { values: ["x"] })), /\.isin\(\["x"\]\)/);
// Same NA trap as R: ~isin keeps nulls, evalPredicate drops them.
assert.match(predicateToPython(cond("a", "nin", { values: ["x"] })), /notna\(\)/);
assert.match(predicateToPython(cond("a", "contains", { value: "x" })), /case=False/);
// startswith/endswith have no `case` argument in pandas, so both sides lower.
assert.match(predicateToPython(cond("a", "startswith", { value: "X" })), /\.str\.lower\(\)\.str\.startswith\("x"/);

// ─── Stata ────────────────────────────────────────────────────────────────────
assert.match(predicateToStata(cond("a", "isna")),  /missing\(a\)/);
assert.match(predicateToStata(cond("a", "notna")), /!missing\(a\)/);
assert.match(predicateToStata(cond("a", "between", { lo: 1, hi: 5 })), /inrange\(a, 1, 5\)/);
assert.match(predicateToStata(cond("a", "contains",   { value: "x" })), /strpos\(lower\(a\), "x"\) > 0/);
assert.match(predicateToStata(cond("a", "startswith", { value: "x" })), /strpos\(lower\(a\), "x"\) == 1/);
// inlist caps at 10 string arguments, so a list becomes an or-chain instead.
assert.match(predicateToStata(cond("a", "in", { values: ["x", "y"] })), /\(a == "x" \| a == "y"\)/);
assert.match(predicateToStata(cond("a", "nin", { values: ["x"] })), /!missing\(a\)/);

// ─── fail loud, never permissive ──────────────────────────────────────────────
// The whole point: an operator with no translation must stop the export rather
// than quietly become "keep every row".
for (const [name, fn] of [["R", predicateToR], ["Python", predicateToPython], ["Stata", predicateToStata]]) {
  assert.throws(
    () => fn(cond("a", "wat", { value: 1 })),
    /unknown operator/i,
    `${name} did not throw on an unknown operator`
  );
}

console.log("predicate export OK");
