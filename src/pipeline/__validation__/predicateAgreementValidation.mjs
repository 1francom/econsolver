// The central guarantee of the unified condition language: for the same
// predicate, the JS evaluator and the SQL compiler must select the same rows.
// This harness asserts the SQL TEXT encodes the JS semantics — the two traps
// being text-comparison for eq and case-insensitivity for the string ops.
import assert from "node:assert/strict";
import { predicateToSQL } from "../predicate.js";

const cond = (col, op, extra = {}) => ({ type: "condition", col, op, ...extra });

// Identifiers are quoted; embedded quotes are doubled.
assert.match(predicateToSQL(cond("my col", "notna")), /"my col" IS NOT NULL/);
assert.match(predicateToSQL(cond('a"b', "isna")), /"a""b" IS NULL/);

// isblank/notblank are null-OR-empty-string, matching legacy set_where.
assert.match(predicateToSQL(cond("a", "isblank")),  /"a" IS NULL OR CAST\("a" AS VARCHAR\) = ''/);
assert.match(predicateToSQL(cond("a", "notblank")), /"a" IS NOT NULL AND CAST\("a" AS VARCHAR\) != ''/);

// eq compares as TEXT, matching evalPredicate's `sv === String(val)`.
// A bare `col = 10` would make "10.0" match, which JS does not.
assert.match(predicateToSQL(cond("n", "eq", { value: "10" })), /CAST\("n" AS VARCHAR\) = '10'/);

// String ops must be case-insensitive to match JS.
assert.match(predicateToSQL(cond("s", "contains",   { value: "bue" })), /ILIKE '%bue%'/);
assert.match(predicateToSQL(cond("s", "ncontains",  { value: "bue" })), /NOT ILIKE '%bue%'/);
assert.match(predicateToSQL(cond("s", "startswith", { value: "bue" })), /ILIKE 'bue%'/);
assert.match(predicateToSQL(cond("s", "endswith",   { value: "bue" })), /ILIKE '%bue'/);
assert.match(predicateToSQL(cond("s", "regex",      { value: "^bue" })), /regexp_matches\(.*'i'\)/);

// Value quoting escapes single quotes — an injection guard, not a nicety.
assert.match(predicateToSQL(cond("s", "eq", { value: "O'Brien" })), /'O''Brien'/);

// LIKE metacharacters in a search term stay literal.
assert.match(predicateToSQL(cond("s", "contains", { value: "50%" })), /'%50\\%%'/);

// Lists and ranges.
assert.match(predicateToSQL(cond("s", "in",  { values: ["a", "b"] })), /IN \('a', 'b'\)/);
assert.match(predicateToSQL(cond("s", "nin", { values: ["a"] })),      /NOT IN \('a'\)/);
assert.match(predicateToSQL(cond("n", "between", { lo: 1, hi: 5 })),   /BETWEEN 1 AND 5/);

// Trees.
assert.match(
  predicateToSQL({ type: "and", children: [cond("a", "notna"), cond("b", "isna")] }),
  /\("a" IS NOT NULL AND "b" IS NULL\)/
);
assert.match(
  predicateToSQL({ type: "or", children: [cond("a", "notna"), cond("b", "isna")] }),
  /\("a" IS NOT NULL OR "b" IS NULL\)/
);

// Legacy spellings compile.
assert.match(predicateToSQL(cond("a", "is_null")), /"a" IS NULL/);
assert.match(predicateToSQL(cond("a", "==", { value: "x" })), /= 'x'/);
assert.match(predicateToSQL(cond("a", "empty")), /IS NULL OR/);

// A non-numeric operand for a numeric comparison must throw rather than emit
// SQL that DuckDB will reject at query time with a less legible message.
assert.throws(() => predicateToSQL(cond("n", "gt", { value: "abc" })), /non-numeric/i);

// THE REGRESSION THIS FILE EXISTS FOR: condToSQL used to end in
// `default: return "TRUE"`, so an unsupported operator matched every row and
// returned a plausible, wrong table. It must throw instead.
assert.throws(() => predicateToSQL(cond("a", "wat", { value: "1" })), /unknown operator/i);

// Every operator the Data Viewer's filter dropdown offers MUST compile to SQL.
// If one does not, a DuckDB-backed dataset shows an unfiltered view plus a
// banner instead of a working filter — technically honest, but useless. Keep
// this list in sync with the <select> in App.jsx's DataViewer.
for (const op of ["eq", "contains", "startswith", "endswith", "gt", "lt", "isblank", "notblank"]) {
  const node = { type: "condition", col: "c", op, value: "1" };
  assert.doesNotThrow(
    () => predicateToSQL(node),
    `Data Viewer offers "${op}" but predicateToSQL cannot compile it — the filter would silently show every row behind a warning banner`
  );
}

console.log("predicate SQL agreement OK");
