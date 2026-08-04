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
