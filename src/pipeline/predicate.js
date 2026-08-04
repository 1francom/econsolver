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
  { id: "contains",   label: "contains",         symbol: null, arity: "one", types: [CAT] },
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
