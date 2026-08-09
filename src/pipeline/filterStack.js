// ─── ECON STUDIO · pipeline/filterStack.js ────────────────────────────────────
// The Data Viewer's autofilter holds a STACK of per-column conditions. This
// turns that stack into the canonical predicate tree from ./predicate.js.
//
// One tree, four consumers: the JS view filter (evalPredicate), the DuckDB
// pushdown (predicateToSQL), the bulk-edit where clause, and the `filter` step
// the user can promote the stack into. They cannot disagree, because there is
// only ever one object.
//
// A stack row is the shape the UI edits directly:
//   { col, op, value?, values?, lo?, hi? }

import { opArity, normalizeOp } from "./predicate.js";

const blank = (v) => v === null || v === undefined || v === "";

/**
 * Is this row ready to filter with? A half-typed row must be IGNORED, not
 * treated as always-true — the user is mid-edit, not asking for every row.
 */
export function conditionIsComplete(cond) {
  if (!cond?.col || !cond?.op) return false;
  switch (opArity(normalizeOp(cond.op))) {
    case "none": return true;
    case "list": return Array.isArray(cond.values) && cond.values.length > 0;
    // `0` is a value; only null/undefined/"" are blanks.
    case "two":  return !blank(cond.lo) && !blank(cond.hi);
    default:     return !blank(cond.value);
  }
}

/** A stack row as a canonical condition node. */
function toNode(cond) {
  return {
    type: "condition",
    col: cond.col,
    op: normalizeOp(cond.op),
    value: cond.value,
    values: cond.values,
    lo: cond.lo,
    hi: cond.hi,
  };
}

/**
 * Compile the stack into one predicate tree, ANDed.
 *
 * Returns NULL when nothing is ready — not an empty `and` node. An empty
 * conjunction is vacuously true in logic, but every consumer here reads a
 * non-null predicate as "a filter is active", so returning one would make the
 * viewer announce a filter that selects everything.
 */
export function stackToPredicate(stack) {
  const ready = (stack ?? []).filter(conditionIsComplete).map(toNode);
  if (!ready.length) return null;
  if (ready.length === 1) return ready[0];
  return { type: "and", children: ready };
}
