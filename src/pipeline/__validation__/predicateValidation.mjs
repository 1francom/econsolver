import assert from "node:assert/strict";
import { OPERATORS, normalizeOp, evalPredicate, menuLabel, opInfix } from "../predicate.js";

// Every operator carries the fields the UI layers need.
for (const op of OPERATORS) {
  assert.ok(op.id,    `operator missing id: ${JSON.stringify(op)}`);
  assert.ok(op.label, `operator ${op.id} missing label`);
  assert.ok(["none", "one", "two", "list"].includes(op.arity), `operator ${op.id} bad arity`);
  assert.ok(Array.isArray(op.types) && op.types.length, `operator ${op.id} missing types`);
}

// Ids are unique — a duplicate would make the dropdowns ambiguous.
assert.equal(new Set(OPERATORS.map(o => o.id)).size, OPERATORS.length);

// Canonical ids normalise to themselves.
for (const op of OPERATORS) assert.equal(normalizeOp(op.id), op.id);

// set_where's spellings (runner.js buildPredicate).
assert.equal(normalizeOp("equals"),      "eq");
assert.equal(normalizeOp("not_equals"),  "neq");
assert.equal(normalizeOp("starts"),      "startswith");
assert.equal(normalizeOp("ends"),        "endswith");
// empty/notempty map to isblank/notblank, NOT isna/notna: the legacy set_where
// implementation treated null and "" as the same thing, and remapping them onto
// strict-null would silently stop a saved "fill the blanks" step from touching
// empty-string cells.
assert.equal(normalizeOp("empty"),       "isblank");
assert.equal(normalizeOp("notempty"),    "notblank");

// duckdbRunner's condToSQL spellings.
assert.equal(normalizeOp("=="),           "eq");
assert.equal(normalizeOp("!="),           "neq");
assert.equal(normalizeOp(">="),           "gte");
assert.equal(normalizeOp("<="),           "lte");
assert.equal(normalizeOp("starts_with"),  "startswith");
assert.equal(normalizeOp("ends_with"),    "endswith");
assert.equal(normalizeOp("is_null"),      "isna");
assert.equal(normalizeOp("is_not_null"),  "notna");
assert.equal(normalizeOp("not_contains"), "ncontains");

// Explore's symbol set.
assert.equal(normalizeOp("="), "eq");
assert.equal(normalizeOp("≠"), "neq");

// An unknown spelling is returned unchanged so callers can decide to throw —
// normalizeOp must never invent an operator.
assert.equal(normalizeOp("wat"), "wat");
assert.equal(normalizeOp(undefined), undefined);

// grouped_mutate's private matcher (runner.js) used two aliases nothing else did.
assert.equal(normalizeOp("<>"), "neq");
assert.equal(normalizeOp("="),  "eq");

// ─── menu labels and language infix ───────────────────────────────────────────
// Menus show the symbol next to the prose so the dropdown teaches the typed form.
assert.equal(menuLabel("eq"),  "== equals");
assert.equal(menuLabel("gte"), ">= at least");
// Operators with no symbol show prose alone.
assert.equal(menuLabel("isna"),     "is null");
assert.equal(menuLabel("contains"), "contains");
// Legacy spellings resolve first.
assert.equal(menuLabel("equals"), "== equals");

// Exporters emit an infix form; the six comparison operators are defined for all
// three languages.
for (const op of ["eq", "neq", "gt", "gte", "lt", "lte"]) {
  for (const lang of ["r", "py", "stata"]) {
    assert.ok(opInfix(op, lang), `${op} missing infix for ${lang}`);
  }
}
assert.equal(opInfix("eq", "r"),      "==");
assert.equal(opInfix("neq", "stata"), "!=");
assert.equal(opInfix("equals", "py"), "==");  // legacy spelling

// An operator with NO infix form must throw rather than be emitted verbatim.
// `region contains "north"` is not valid R, and shipping it would surface as a
// broken replication script rather than as a failing test.
assert.throws(() => opInfix("contains", "r"), /no infix form/i);
assert.throws(() => opInfix("in", "stata"),   /no infix form/i);

console.log("predicate operators OK");

// ─── evaluator semantics ──────────────────────────────────────────────────────
const cond = (col, op, extra = {}) => ({ type: "condition", col, op, ...extra });
const row  = { n: 10, s: "Buenos Aires", z: null };

// Null handling: only notna/isna see nulls; every other op rejects them.
assert.equal(evalPredicate(cond("z", "notna"), row), false);
assert.equal(evalPredicate(cond("z", "isna"),  row), true);
assert.equal(evalPredicate(cond("z", "eq", { value: "" }), row), false);

// eq compares as TEXT — this is why the SQL compiler must cast.
assert.equal(evalPredicate(cond("n", "eq", { value: "10" }),   row), true);
assert.equal(evalPredicate(cond("n", "eq", { value: "10.0" }), row), false);

assert.equal(evalPredicate(cond("n", "gt",  { value: "5" }),  row), true);
assert.equal(evalPredicate(cond("n", "gte", { value: "10" }), row), true);
assert.equal(evalPredicate(cond("n", "lt",  { value: "5" }),  row), false);
assert.equal(evalPredicate(cond("n", "between", { lo: 5,  hi: 15 }), row), true);
assert.equal(evalPredicate(cond("n", "between", { lo: 11, hi: 15 }), row), false);

assert.equal(evalPredicate(cond("s", "in",  { values: ["Buenos Aires", "Córdoba"] }), row), true);
assert.equal(evalPredicate(cond("s", "nin", { values: ["Córdoba"] }), row), true);

// String ops are case-INSENSITIVE — the SQL compiler must use ILIKE to match.
assert.equal(evalPredicate(cond("s", "contains",   { value: "buenos" }),  row), true);
assert.equal(evalPredicate(cond("s", "ncontains",  { value: "buenos" }),  row), false);
assert.equal(evalPredicate(cond("s", "startswith", { value: "BUE" }),     row), true);
assert.equal(evalPredicate(cond("s", "endswith",   { value: "AIRES" }),   row), true);
assert.equal(evalPredicate(cond("s", "regex",      { value: "^buenos" }), row), true);

// Trees.
assert.equal(evalPredicate({ type: "and", children: [
  cond("n", "gt", { value: "5" }), cond("s", "contains", { value: "aires" }),
]}, row), true);
assert.equal(evalPredicate({ type: "or", children: [
  cond("n", "lt", { value: "5" }), cond("s", "contains", { value: "nope" }),
]}, row), false);

// Legacy spellings evaluate identically — the back-compat guarantee.
assert.equal(evalPredicate(cond("n", "equals", { value: "10" }), row), true);
assert.equal(evalPredicate(cond("z", "empty"), row), true);
assert.equal(evalPredicate(cond("s", "starts_with", { value: "Bue" }), row), true);

// An unknown operator THROWS. The old code returned true here, which meant a
// broken filter silently kept every row and looked like a valid result.
assert.throws(() => evalPredicate(cond("n", "wat", { value: "1" }), row), /unknown operator/i);

// ─── null vs blank ────────────────────────────────────────────────────────────
// Pins the distinction that made isblank/notblank necessary. `filter` always
// meant strict null; `set_where` always meant null-or-empty-string. Both
// meanings survive, addressed by different operator ids.
const blanks = { nul: null, empty: "", filled: "x", zero: 0 };

assert.equal(evalPredicate(cond("nul",   "isna"), blanks), true);
assert.equal(evalPredicate(cond("empty", "isna"), blanks), false); // "" is NOT null
assert.equal(evalPredicate(cond("nul",   "isblank"), blanks), true);
assert.equal(evalPredicate(cond("empty", "isblank"), blanks), true); // "" IS blank
assert.equal(evalPredicate(cond("filled","isblank"), blanks), false);
assert.equal(evalPredicate(cond("empty", "notblank"), blanks), false);
assert.equal(evalPredicate(cond("filled","notblank"), blanks), true);
// 0 is a value, not a blank — the classic falsy trap.
assert.equal(evalPredicate(cond("zero",  "isblank"), blanks), false);
assert.equal(evalPredicate(cond("zero",  "notblank"), blanks), true);

// The legacy set_where spellings reach the blank semantics, unchanged.
assert.equal(evalPredicate(cond("empty", "empty"), blanks), true);
assert.equal(evalPredicate(cond("empty", "notempty"), blanks), false);

// ─── deliberate behaviour changes, pinned so they cannot regress silently ─────
// 1. String ops are now case-insensitive for set_where too (filter already was).
assert.equal(evalPredicate(cond("s", "contains", { value: "BUENOS" }), row), true);
// 2. null never matches a comparison. Legacy buildPredicate coerced null to 0
//    via Number(null), so `null > -1` used to be true.
assert.equal(evalPredicate(cond("z", "gt",  { value: "-1" }), row), false);
assert.equal(evalPredicate(cond("z", "neq", { value: "x" }),  row), false);

console.log("predicate eval OK");
