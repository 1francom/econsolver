import assert from "node:assert/strict";
import { OPERATORS, normalizeOp, evalPredicate } from "../predicate.js";

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
assert.equal(normalizeOp("empty"),       "isna");
assert.equal(normalizeOp("notempty"),    "notna");

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

console.log("predicate eval OK");
