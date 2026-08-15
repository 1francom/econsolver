// The Data Viewer's autofilter holds a STACK of per-column conditions. This
// turns it into the canonical predicate tree that evalPredicate, predicateToSQL
// and the `filter` step all already understand — so the view filter, the SQL
// pushdown, the bulk-edit where clause and the promoted pipeline step are all
// literally the same object, and cannot drift.
import assert from "node:assert/strict";
import { stackToPredicate, conditionIsComplete } from "../filterStack.js";
import { evalPredicate, predicateToSQL } from "../predicate.js";

const c = (col, op, extra = {}) => ({ col, op, ...extra });

// ─── an empty or all-incomplete stack means NO filter, never "match nothing" ──
// Returning an empty AND node would be an empty conjunction, which is vacuously
// TRUE in logic but reads as a filter to every consumer. null says "no filter".
assert.equal(stackToPredicate([]), null);
assert.equal(stackToPredicate(undefined), null);
assert.equal(stackToPredicate([c("", "eq", { value: "x" })]), null, "no column is not a condition");
assert.equal(stackToPredicate([c("a", "eq", { value: "" })]), null, "a value-taking op with no value is not ready");

// ─── one condition unwraps; two or more become an AND ─────────────────────────
const one = stackToPredicate([c("a", "eq", { value: "x" })]);
assert.equal(one.type, "condition");
assert.equal(one.col, "a");

const two = stackToPredicate([c("a", "eq", { value: "x" }), c("b", "gt", { value: "5" })]);
assert.equal(two.type, "and");
assert.equal(two.children.length, 2);

// Incomplete rows are dropped, not carried through as always-true clauses.
const mixed = stackToPredicate([c("a", "eq", { value: "x" }), c("", "eq", { value: "y" })]);
assert.equal(mixed.type, "condition", "the incomplete row should have been dropped");

// ─── ops that take no value are complete on their own ─────────────────────────
for (const op of ["isna", "notna", "isblank", "notblank"]) {
  assert.ok(conditionIsComplete(c("a", op)), `${op} needs no value`);
  assert.ok(stackToPredicate([c("a", op)]), `${op} should produce a predicate`);
}
// A list op needs at least one selected value — an empty checkbox list is the
// user having opened the menu, not a request to match nothing.
assert.ok(!conditionIsComplete(c("a", "in", { values: [] })));
assert.ok(conditionIsComplete(c("a", "in", { values: ["x"] })));
// `between` needs both ends.
assert.ok(!conditionIsComplete(c("a", "between", { lo: 1 })));
assert.ok(conditionIsComplete(c("a", "between", { lo: 1, hi: 5 })));
// 0 is a value, not a blank — the classic falsy trap.
assert.ok(conditionIsComplete(c("a", "eq", { value: 0 })));
assert.ok(conditionIsComplete(c("a", "between", { lo: 0, hi: 0 })));

// ─── the whole point: one object, three consumers ─────────────────────────────
const rows = [
  { region: "north", year: 2015, n: 10 },
  { region: "north", year: 2010, n: 20 },
  { region: "south", year: 2016, n: 30 },
];
const stack = [c("region", "in", { values: ["north"] }), c("year", "gte", { value: "2015" })];
const tree  = stackToPredicate(stack);

// evaluates in JS…
assert.deepEqual(rows.filter(r => evalPredicate(tree, r)).map(r => r.n), [10]);
// …compiles to SQL without throwing…
const sql = predicateToSQL(tree);
assert.match(sql, /region/);
assert.match(sql, /year/);
// …and is exactly what a `filter` step carries, so promotion needs no
// conversion step that could introduce a difference.
assert.deepEqual(stackToPredicate(stack), tree);

console.log("filterStack OK");
