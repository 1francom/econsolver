# Condition Language — Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse six implementations of "compare a column against something" into one canonical module, and make the SQL compiler fail loudly instead of silently matching every row.

**Architecture:** A new `src/pipeline/predicate.js` owns the operator table, the JS evaluator, the SQL compiler and the legacy-spelling normaliser. `runner.js` and `duckdbRunner.js` delegate to it. **This plan covers slices 1–2 of the spec only** — the engine. No UI file is touched and there is no user-visible change, except one deliberate exception documented in Task 5.

**Tech Stack:** Plain ES modules, `node:assert/strict` harnesses run under node, DuckDB-Wasm SQL dialect.

**Spec:** `docs/superpowers/specs/2026-08-03-unified-condition-language-design.md`

**Why the UI slices (3–8) are a separate plan:** they consume the `OPERATORS` table this plan defines. Writing them before that table exists means guessing at its exact export shape. Write `docs/superpowers/plans/<date>-condition-language-surfaces.md` after this plan lands.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/pipeline/predicate.js` *(create)* | `OPERATORS`, `normalizeOp`, `evalPredicate`, `predicateToSQL`. The single owner. |
| `src/pipeline/__validation__/predicateValidation.mjs` *(create)* | Operator semantics + the alias table. |
| `src/pipeline/__validation__/predicateAgreementValidation.mjs` *(create)* | The central guarantee: JS and SQL return the same rows. |
| `src/pipeline/runner.js` *(modify)* | `filter` and `set_where` delegate; the inline `evalPredicate` and `buildPredicate` are deleted. |
| `src/pipeline/duckdbRunner.js` *(modify)* | `condToSQL` deleted; `filter` delegates to `predicateToSQL`. |

## Two traps this plan exists to avoid

**1. The JS evaluator compares `eq` as strings.** `runner.js:246` is `sv === String(val)` — a *text* comparison. `condToSQL` emits `col = <value>`, which DuckDB may resolve numerically. `"1.0" == 1` is false in JS and true in SQL. Any SQL compiler that does not force text comparison for `eq`/`neq` silently disagrees with the JS path, which is exactly the divergence this spec exists to close.

**2. String ops are case-INSENSITIVE in JS.** `runner.js:271-278` lowercases both sides for `contains`/`startswith`/`endswith` and passes the `i` flag to `RegExp`. SQL `LIKE` is case-sensitive in DuckDB, so the compiler must emit `ILIKE` and `regexp_matches(..., 'i')`.

---

### Task 1: Operator table and normaliser

**Files:**
- Create: `src/pipeline/predicate.js`
- Test: `src/pipeline/__validation__/predicateValidation.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/__validation__/predicateValidation.mjs`:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `ERR_MODULE_NOT_FOUND` — `predicate.js` does not exist.

- [ ] **Step 3: Write the table and normaliser**

Create `src/pipeline/predicate.js`:

```js
// ─── ECON STUDIO · pipeline/predicate.js ──────────────────────────────────────
// The single owner of "compare a column against something".
//
// Before this module there were six: evalPredicate in runner.js, a duplicate of
// it in CleanTab.jsx, buildPredicate for set_where, condToSQL in duckdbRunner.js,
// and the Data Viewer's inline closure — each with its own operator spellings.
// The canonical dialect is the predicate TREE the `filter` step already persists,
// so saved pipelines carrying that shape need no migration.
//
//   PredicateNode
//     { type: "and" | "or", children: PredicateNode[] }
//     { type: "condition", col, op, value, values, lo, hi }

// Column-type gating follows the convention already documented at
// CleanTab.jsx:590-592 — it moves here verbatim rather than being reinvented.
const NUM = "numeric", CAT = "categorical", ANY = "any";

export const OPERATORS = [
  { id: "notna",      label: "is not null",  symbol: null, arity: "none", types: [NUM, CAT, ANY] },
  { id: "isna",       label: "is null",      symbol: null, arity: "none", types: [NUM, CAT, ANY] },
  { id: "eq",         label: "equals",       symbol: "==", arity: "one",  types: [NUM, CAT] },
  { id: "neq",        label: "not equals",   symbol: "!=", arity: "one",  types: [NUM, CAT] },
  { id: "gt",         label: "greater than", symbol: ">",  arity: "one",  types: [NUM] },
  { id: "gte",        label: "at least",     symbol: ">=", arity: "one",  types: [NUM] },
  { id: "lt",         label: "less than",    symbol: "<",  arity: "one",  types: [NUM] },
  { id: "lte",        label: "at most",      symbol: "<=", arity: "one",  types: [NUM] },
  { id: "between",    label: "between",      symbol: null, arity: "two",  types: [NUM] },
  { id: "in",         label: "in list",      symbol: null, arity: "list", types: [NUM, CAT] },
  { id: "nin",        label: "not in list",  symbol: null, arity: "list", types: [NUM, CAT] },
  { id: "contains",   label: "contains",     symbol: null, arity: "one",  types: [CAT] },
  { id: "ncontains",  label: "does not contain", symbol: null, arity: "one", types: [CAT] },
  { id: "startswith", label: "starts with",  symbol: null, arity: "one",  types: [CAT] },
  { id: "endswith",   label: "ends with",    symbol: null, arity: "one",  types: [CAT] },
  { id: "regex",      label: "matches",      symbol: null, arity: "one",  types: [CAT] },
];

const CANONICAL = new Set(OPERATORS.map(o => o.id));

// Every legacy spelling that has ever been persisted or rendered, mapped to its
// canonical id. RULE: an entry is NEVER deleted. Pipelines live in user-exported
// .json files, client-encrypted sync blobs and other people's shared projects —
// none of which a migration script can reach, so read-time normalisation is the
// only thing that keeps a six-month-old export opening.
const ALIASES = {
  // set_where (runner.js buildPredicate)
  equals: "eq", not_equals: "neq", starts: "startswith", ends: "endswith",
  empty: "isna", notempty: "notna",
  // duckdbRunner condToSQL
  "==": "eq", "!=": "neq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte",
  starts_with: "startswith", ends_with: "endswith",
  is_null: "isna", is_not_null: "notna", not_contains: "ncontains",
  // Explore's FILTER_OPS symbols
  "=": "eq", "≠": "neq",
};

/** Map any known spelling to its canonical id. Unknown input is returned
 *  unchanged — deciding whether that is fatal belongs to the caller. */
export function normalizeOp(op) {
  if (op == null) return op;
  if (CANONICAL.has(op)) return op;
  return ALIASES[op] ?? op;
}

export function isCanonicalOp(op) {
  return CANONICAL.has(op);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `predicate operators OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/predicate.js src/pipeline/__validation__/predicateValidation.mjs
git commit -m "feat(predicate): canonical operator table and legacy-spelling normaliser"
```

---

### Task 2: JS evaluator

**Files:**
- Modify: `src/pipeline/predicate.js`
- Modify: `src/pipeline/__validation__/predicateValidation.mjs`

- [ ] **Step 1: Add the failing semantics tests**

Append to `src/pipeline/__validation__/predicateValidation.mjs`, before the final
`console.log`:

```js
import { evalPredicate } from "../predicate.js";

const cond = (col, op, extra = {}) => ({ type: "condition", col, op, ...extra });
const row  = { n: 10, s: "Buenos Aires", z: null };

// Null handling: only notna/isna see nulls; every other op rejects them.
assert.equal(evalPredicate(cond("z", "notna"), row), false);
assert.equal(evalPredicate(cond("z", "isna"),  row), true);
assert.equal(evalPredicate(cond("z", "eq", { value: "" }), row), false);

// eq compares as TEXT — this is why the SQL compiler must cast (see Task 4).
assert.equal(evalPredicate(cond("n", "eq", { value: "10" }),  row), true);
assert.equal(evalPredicate(cond("n", "eq", { value: "10.0" }), row), false);

assert.equal(evalPredicate(cond("n", "gt",  { value: "5" }),  row), true);
assert.equal(evalPredicate(cond("n", "gte", { value: "10" }), row), true);
assert.equal(evalPredicate(cond("n", "lt",  { value: "5" }),  row), false);
assert.equal(evalPredicate(cond("n", "between", { lo: 5, hi: 15 }), row), true);
assert.equal(evalPredicate(cond("n", "between", { lo: 11, hi: 15 }), row), false);

assert.equal(evalPredicate(cond("s", "in",  { values: ["Buenos Aires", "Córdoba"] }), row), true);
assert.equal(evalPredicate(cond("s", "nin", { values: ["Córdoba"] }), row), true);

// String ops are case-INSENSITIVE — the SQL compiler must use ILIKE to match.
assert.equal(evalPredicate(cond("s", "contains",   { value: "buenos" }), row), true);
assert.equal(evalPredicate(cond("s", "ncontains",  { value: "buenos" }), row), false);
assert.equal(evalPredicate(cond("s", "startswith", { value: "BUE" }),    row), true);
assert.equal(evalPredicate(cond("s", "endswith",   { value: "AIRES" }),  row), true);
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `SyntaxError` or `ERR` on the missing `evalPredicate` export.

- [ ] **Step 3: Implement**

Append to `src/pipeline/predicate.js`. The body is `runner.js:227-281` moved
verbatim except for two changes, both called out inline:

```js
/**
 * Evaluate a predicate node against one row.
 * Semantics are preserved exactly from the former runner.js implementation:
 * `eq`/`neq` compare as TEXT, and contains/startswith/endswith/regex are
 * case-INSENSITIVE. Any SQL compiler must reproduce both or the two paths
 * disagree — see predicateToSQL.
 */
export function evalPredicate(node, row) {
  if (node.type === "and") return node.children.every(c => evalPredicate(c, row));
  if (node.type === "or")  return node.children.some(c  => evalPredicate(c, row));

  const v  = row[node.col];
  const op = normalizeOp(node.op);   // CHANGE 1: legacy spellings accepted here

  if (op === "notna") return v !== null && v !== undefined;
  if (op === "isna")  return v === null || v === undefined;

  // For every remaining op, null never matches.
  if (v === null || v === undefined) return false;

  const sv   = String(v);
  const nv   = typeof v === "number" ? v : parseFloat(v);
  const val  = node.value;
  const nval = parseFloat(val);

  if (op === "eq")  return sv === String(val);
  if (op === "neq") return sv !== String(val);
  if (op === "gt")  return isFinite(nv) && nv >  nval;
  if (op === "gte") return isFinite(nv) && nv >= nval;
  if (op === "lt")  return isFinite(nv) && nv <  nval;
  if (op === "lte") return isFinite(nv) && nv <= nval;

  if (op === "in" || op === "nin") {
    const vals = (Array.isArray(node.values) ? node.values : [String(val)]).map(String);
    return op === "in" ? vals.includes(sv) : !vals.includes(sv);
  }

  if (op === "between") {
    const lo = parseFloat(node.lo ?? node.value);
    const hi = parseFloat(node.hi ?? node.value2);
    return isFinite(nv) && nv >= lo && nv <= hi;
  }

  const svl  = sv.toLowerCase();
  const vall = String(val ?? "").toLowerCase();
  if (op === "contains")   return svl.includes(vall);
  if (op === "ncontains")  return !svl.includes(vall);
  if (op === "startswith") return svl.startsWith(vall);
  if (op === "endswith")   return svl.endsWith(vall);
  if (op === "regex") {
    try { return new RegExp(val, "i").test(sv); } catch { return false; }
  }

  // CHANGE 2: the old code returned true here. That is the bug this module
  // exists to remove — a filter with an operator nobody implemented silently
  // kept every row and looked like a legitimate result.
  throw new Error(`Unknown operator "${node.op}" in condition on column "${node.col}".`);
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node src/pipeline/__validation__/predicateValidation.mjs
```

Expected: `predicate operators OK` then `predicate eval OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/predicate.js src/pipeline/__validation__/predicateValidation.mjs
git commit -m "feat(predicate): canonical JS evaluator, throwing on unknown operators"
```

---

### Task 3: `runner.js` delegates

**Files:**
- Modify: `src/pipeline/runner.js:90-118` (delete `buildPredicate`), `:227-281` (delete inline `evalPredicate`), `:398` (`set_where`)

- [ ] **Step 1: Import the module**

At the top of `src/pipeline/runner.js`, with the other imports:

```js
import { evalPredicate, normalizeOp } from "./predicate.js";
```

- [ ] **Step 2: Delete the inline `evalPredicate`**

Remove `runner.js:227-281` entirely — the whole `function evalPredicate(node, row) { … }`
declaration inside the `case "filter":` block. The imported one takes over by name.

- [ ] **Step 3: Replace `buildPredicate` with a delegating shim**

Replace `runner.js:91-118` (the whole `function buildPredicate(where) { … }`) with:

```js
// Build a row predicate from a structured where clause for set_where.
// The flat {col, op, value} shape is the LEGACY form; it is translated into a
// canonical condition node so there is exactly one evaluator in this file.
// `where.predicate` (a full tree) is accepted too — that is the shape the Data
// Viewer's stackable filters will emit.
function buildPredicate(where) {
  if (!where) return () => true;
  if (where.predicate) return (r) => evalPredicate(where.predicate, r);
  if (!where.col || !where.op) return () => true;
  const node = {
    type: "condition",
    col: where.col,
    op: normalizeOp(where.op),
    value: Array.isArray(where.value) ? where.value[0] : where.value,
    lo: Array.isArray(where.value) ? where.value[0] : where.lo,
    hi: Array.isArray(where.value) ? where.value[1] : where.hi,
    values: where.values,
  };
  return (r) => evalPredicate(node, r);
}
```

Note the array handling: `set_where`'s `between` passes `value: [lo, hi]`
(see the fixture at `pipelineReliabilityValidation.mjs` and
`gridSteps.test.mjs:31`), whereas the canonical node uses `lo`/`hi`. This shim is
the only place that translation lives.

- [ ] **Step 4: Run the existing pipeline harnesses**

```bash
node src/pipeline/__validation__/pipelineReliabilityValidation.mjs && node src/pipeline/__validation__/gridSteps.test.mjs
```

Expected: both pass unchanged. These already cover `filter` and `set_where`
including `between` + `contains`, so a green run here is the evidence that the
delegation preserved behaviour.

- [ ] **Step 5: Build**

```bash
npm run build && npm run lint:undef
```

Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/runner.js
git commit -m "refactor(runner): filter and set_where delegate to predicate.js"
```

---

### Task 4: SQL compiler

**Files:**
- Modify: `src/pipeline/predicate.js`
- Create: `src/pipeline/__validation__/predicateAgreementValidation.mjs`

- [ ] **Step 1: Write the failing test**

Create `src/pipeline/__validation__/predicateAgreementValidation.mjs`:

```js
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

// eq compares as TEXT, matching evalPredicate's `sv === String(val)`.
// A bare `col = 10` would make "10.0" match, which JS does not.
const eqSQL = predicateToSQL(cond("n", "eq", { value: "10" }));
assert.match(eqSQL, /CAST\("n" AS VARCHAR\) = '10'/);

// String ops must be case-insensitive to match JS.
assert.match(predicateToSQL(cond("s", "contains",   { value: "bue" })), /ILIKE '%bue%'/);
assert.match(predicateToSQL(cond("s", "ncontains",  { value: "bue" })), /NOT ILIKE '%bue%'/);
assert.match(predicateToSQL(cond("s", "startswith", { value: "bue" })), /ILIKE 'bue%'/);
assert.match(predicateToSQL(cond("s", "endswith",   { value: "bue" })), /ILIKE '%bue'/);
assert.match(predicateToSQL(cond("s", "regex",      { value: "^bue" })), /regexp_matches\(.*'i'\)/);

// Value quoting escapes single quotes — an injection guard, not a nicety.
assert.match(predicateToSQL(cond("s", "eq", { value: "O'Brien" })), /'O''Brien'/);

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

// THE REGRESSION THIS FILE EXISTS FOR: condToSQL used to end in
// `default: return "TRUE"`, so an unsupported operator matched every row and
// returned a plausible, wrong table. It must throw instead.
assert.throws(() => predicateToSQL(cond("a", "wat", { value: "1" })), /unknown operator/i);
assert.doesNotMatch(
  (() => { try { return predicateToSQL(cond("a", "wat")); } catch { return ""; } })(),
  /TRUE/
);

console.log("predicate SQL agreement OK");
```

- [ ] **Step 2: Run to verify it fails**

```bash
node src/pipeline/__validation__/predicateAgreementValidation.mjs
```

Expected: failure on the missing `predicateToSQL` export.

- [ ] **Step 3: Implement**

Append to `src/pipeline/predicate.js`:

```js
const sqlIdent = (col) => `"${String(col).replace(/"/g, '""')}"`;
const sqlText  = (v)   => `'${String(v ?? "").replace(/'/g, "''")}'`;
const sqlNum   = (v)   => {
  const n = Number(v);
  if (!isFinite(n)) throw new Error(`Non-numeric value "${v}" in a numeric comparison.`);
  return String(n);
};
// LIKE metacharacters in a user's search term must be literal.
const likeBody = (v) => String(v ?? "").replace(/([\\%_])/g, "\\$1").replace(/'/g, "''");

/**
 * Compile a predicate node to a DuckDB WHERE fragment.
 *
 * THROWS on an unknown operator. It never falls back to "TRUE": the previous
 * implementation (condToSQL) did, so an operator nobody had implemented matched
 * every row and produced a plausible wrong table. Callers should catch and fall
 * back to the JS runner, which is slower but correct.
 *
 * Semantics deliberately mirror evalPredicate: eq/neq compare as TEXT, and the
 * string ops are case-insensitive.
 */
export function predicateToSQL(node) {
  if (node.type === "and" || node.type === "or") {
    const sep = node.type === "and" ? " AND " : " OR ";
    return "(" + node.children.map(predicateToSQL).join(sep) + ")";
  }

  const c   = sqlIdent(node.col);
  const op  = normalizeOp(node.op);
  const val = node.value;

  switch (op) {
    case "notna": return `${c} IS NOT NULL`;
    case "isna":  return `${c} IS NULL`;
    // Text comparison so "10.0" does not match 10, matching evalPredicate.
    case "eq":    return `CAST(${c} AS VARCHAR) = ${sqlText(val)}`;
    case "neq":   return `CAST(${c} AS VARCHAR) != ${sqlText(val)}`;
    case "gt":    return `${c} > ${sqlNum(val)}`;
    case "gte":   return `${c} >= ${sqlNum(val)}`;
    case "lt":    return `${c} < ${sqlNum(val)}`;
    case "lte":   return `${c} <= ${sqlNum(val)}`;
    case "between": {
      const lo = sqlNum(node.lo ?? node.value);
      const hi = sqlNum(node.hi ?? node.value2);
      return `${c} BETWEEN ${lo} AND ${hi}`;
    }
    case "in":
    case "nin": {
      const vals = (Array.isArray(node.values) ? node.values : [val]).map(sqlText);
      if (!vals.length) return op === "in" ? "FALSE" : "TRUE";
      return `CAST(${c} AS VARCHAR) ${op === "nin" ? "NOT " : ""}IN (${vals.join(", ")})`;
    }
    case "contains":   return `CAST(${c} AS VARCHAR) ILIKE '%${likeBody(val)}%' ESCAPE '\\'`;
    case "ncontains":  return `CAST(${c} AS VARCHAR) NOT ILIKE '%${likeBody(val)}%' ESCAPE '\\'`;
    case "startswith": return `CAST(${c} AS VARCHAR) ILIKE '${likeBody(val)}%' ESCAPE '\\'`;
    case "endswith":   return `CAST(${c} AS VARCHAR) ILIKE '%${likeBody(val)}' ESCAPE '\\'`;
    case "regex":      return `regexp_matches(CAST(${c} AS VARCHAR), ${sqlText(val)}, 'i')`;
    default:
      throw new Error(`Unknown operator "${node.op}" — refusing to compile a WHERE clause that would match every row.`);
  }
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
node src/pipeline/__validation__/predicateAgreementValidation.mjs
```

Expected: `predicate SQL agreement OK`

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/predicate.js src/pipeline/__validation__/predicateAgreementValidation.mjs
git commit -m "feat(predicate): SQL compiler that throws instead of matching every row"
```

---

### Task 5: `duckdbRunner.js` delegates

**Files:**
- Modify: `src/pipeline/duckdbRunner.js:71-98` (delete `condToSQL`), `:116-126` (`case "filter"`)

- [ ] **Step 1: Import and replace the `filter` case**

At the top of `src/pipeline/duckdbRunner.js`:

```js
import { predicateToSQL } from "./predicate.js";
```

Replace the body of `case "filter":` (`duckdbRunner.js:116-126`) with:

```js
    case "filter": {
      // Free-text formula filters have no SQL translation — fall back to the JS
      // runner, which does handle step.expr.
      if (step.expr) return null;
      // predicateToSQL THROWS on an operator it does not know rather than
      // emitting TRUE. Returning null here routes the step to the JS runner:
      // slower, but it never silently keeps every row.
      let where;
      try {
        where = predicateToSQL(step.predicate ?? step);
      } catch {
        return null;
      }
      await conn.query(
        `CREATE OR REPLACE TABLE "${next}" AS SELECT * FROM "${tbl}" WHERE ${where}`
      );
      return { tableName: next, headers };
    }
```

Note `step.predicate ?? step`: the `filter` step carries either a tree under
`predicate` or the legacy flat shape on the step itself, and `predicateToSQL`
handles a bare condition node. A legacy flat step has no `type` field, so add
this normalisation immediately above the `try`:

```js
      const node = step.predicate ?? { type: "condition", col: step.col, op: step.op, value: step.value, values: step.values, lo: step.lo, hi: step.hi };
```

and pass `node` to `predicateToSQL`.

- [ ] **Step 2: Delete `condToSQL`**

Remove `duckdbRunner.js:71-98` — the `// ── Predicate → SQL WHERE clause ──` banner
and the whole `function condToSQL(cond) { … }`.

- [ ] **Step 3: Check for other callers**

```bash
grep -rn "condToSQL" src/
```

Expected: no matches. If any remain, point them at `predicateToSQL` — leaving one
behind reintroduces the `default: "TRUE"` path this whole plan removes.

- [ ] **Step 4: Verify**

```bash
npm run build && npm run lint:undef && node src/pipeline/__validation__/pipelineReliabilityValidation.mjs
```

Expected: all three succeed.

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/duckdbRunner.js
git commit -m "refactor(duckdb): filter compiles through predicate.js; condToSQL removed"
```

---

## The one intentional behaviour change

Everything above is invisible to the user except this: an operator that no
implementation recognises now **fails** instead of matching every row. It cannot
be reached by any legitimate saved pipeline — every spelling that has ever
shipped is in the alias table — so in practice it fires only on corrupted or
hand-edited pipeline JSON, which is exactly when silence is most expensive.

On the SQL side the failure is not even user-visible: `duckdbRunner` catches and
falls back to the JS runner.

## Done criteria

- `node src/pipeline/__validation__/predicateValidation.mjs` → `predicate operators OK`, `predicate eval OK`
- `node src/pipeline/__validation__/predicateAgreementValidation.mjs` → `predicate SQL agreement OK`
- `node src/pipeline/__validation__/pipelineReliabilityValidation.mjs` and `gridSteps.test.mjs` pass **unchanged** — the proof that delegation preserved behaviour
- `grep -rn "condToSQL" src/` returns nothing
- `npm run build` and `npm run lint:undef` green
- Franco's browser pass: build a multi-condition filter in Clean on a DuckDB-backed dataset (>50k rows) and confirm the row count matches the same filter on a small JS-backed dataset

## Next plan

`docs/superpowers/plans/<date>-condition-language-surfaces.md` — spec slices 3–8:
`CleanTab`'s duplicate evaluator, Explore's `FILTER_OPS`, SubsetManager (plus the
three subset exporters), the Data Viewer, FeatureTab, and the help copy. All of
them consume `OPERATORS` from this plan.
