import assert from "node:assert/strict";
import { OPERATORS, normalizeOp } from "../predicate.js";

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
