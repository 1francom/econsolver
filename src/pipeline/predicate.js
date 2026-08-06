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
  // isblank/notblank exist because set_where's legacy `empty`/`notempty` treated
  // null and "" as the same thing, while isna/notna mean strictly null. Mapping
  // the legacy spellings onto isna would silently stop a saved "fill the blanks"
  // step from touching empty-string cells. Distinct ops keep both meanings.
  { id: "isblank",    label: "is blank",     symbol: null, arity: "none", types: [NUM, CAT, ANY] },
  { id: "notblank",   label: "is not blank", symbol: null, arity: "none", types: [NUM, CAT, ANY] },
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
  // NOT isna/notna — see the isblank comment above.
  empty: "isblank", notempty: "notblank",
  // duckdbRunner condToSQL
  "==": "eq", "!=": "neq", ">": "gt", "<": "lt", ">=": "gte", "<=": "lte",
  starts_with: "startswith", ends_with: "endswith",
  is_null: "isna", is_not_null: "notna", not_contains: "ncontains",
  // Explore's FILTER_OPS symbols
  "=": "eq", "≠": "neq",
  // grouped_mutate's matchOne (runner.js) — the only surface that used this
  "<>": "neq",
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
  // Blank = null OR empty string. Must be answered before the null guard below.
  if (op === "isblank")  return v === null || v === undefined || String(v) === "";
  if (op === "notblank") return v !== null && v !== undefined && String(v) !== "";

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

// ─── presentation and export helpers ──────────────────────────────────────────

const BY_ID = new Map(OPERATORS.map(o => [o.id, o]));

/**
 * Label for a dropdown: "== equals", ">= at least", "is null".
 * The symbol is the SAME token the user would type in a formula box — showing
 * `=` in a menu while the formula box wants `==` is the inconsistency this
 * module exists to remove.
 */
export function menuLabel(op) {
  const o = BY_ID.get(normalizeOp(op));
  if (!o) return String(op);
  return o.symbol ? `${o.symbol} ${o.label}` : o.label;
}

/** Prose only: "is not null", "in list", "equals". */
export function opLabel(op) {
  return BY_ID.get(normalizeOp(op))?.label ?? String(op);
}

/** The symbol if the operator has one, else null. */
export function opSymbol(op) {
  return BY_ID.get(normalizeOp(op))?.symbol ?? null;
}

/** Symbol when there is one, prose otherwise — for inline step descriptions. */
export function opShort(op) {
  return opSymbol(op) ?? opLabel(op);
}

/** Every operator that has a plain infix spelling in the replication targets. */
const OP_INFIX = {
  eq:  { r: "==", py: "==", stata: "==" },
  neq: { r: "!=", py: "!=", stata: "!=" },
  gt:  { r: ">",  py: ">",  stata: ">"  },
  gte: { r: ">=", py: ">=", stata: ">=" },
  lt:  { r: "<",  py: "<",  stata: "<"  },
  lte: { r: "<=", py: "<=", stata: "<=" },
};

/**
 * Infix operator for a replication script. THROWS when the operator has no
 * infix form (in, contains, isna, …) — those need a function call per language
 * (`%in%`, `grepl`, `.isin`, `strpos`, `inlist`), and an exporter that emitted
 * them verbatim would produce a script that does not run. Failing here turns a
 * user-visible broken export into a failing test.
 */
export function opInfix(op, lang) {
  const row = OP_INFIX[normalizeOp(op)];
  if (!row) throw new Error(`Operator "${op}" has no infix form — ${lang} needs an explicit translation.`);
  return row[lang];
}

// ─── SQL compilation ──────────────────────────────────────────────────────────

const sqlIdent = (col) => `"${String(col).replace(/"/g, '""')}"`;
const sqlText  = (v)   => `'${String(v ?? "").replace(/'/g, "''")}'`;
const sqlNum   = (v)   => {
  const n = Number(v);
  if (!isFinite(n)) throw new Error(`Non-numeric value "${v}" in a numeric comparison.`);
  return String(n);
};
// LIKE metacharacters in a user's search term must stay literal.
const likeBody = (v) => String(v ?? "").replace(/([\\%_])/g, "\\$1").replace(/'/g, "''");

/**
 * Compile a predicate node to a DuckDB WHERE fragment.
 *
 * THROWS on an unknown operator. It never falls back to "TRUE": the previous
 * implementation (condToSQL in duckdbRunner.js) did, so an operator nobody had
 * implemented matched every row and produced a plausible wrong table. Callers
 * should catch and fall back to the JS runner — slower, but correct.
 *
 * Semantics deliberately mirror evalPredicate: eq/neq compare as TEXT, and the
 * string ops are case-insensitive. Diverging on either silently breaks the
 * guarantee that both paths select the same rows.
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
    case "notna":    return `${c} IS NOT NULL`;
    case "isna":     return `${c} IS NULL`;
    case "isblank":  return `(${c} IS NULL OR CAST(${c} AS VARCHAR) = '')`;
    case "notblank": return `(${c} IS NOT NULL AND CAST(${c} AS VARCHAR) != '')`;
    // Text comparison so "10.0" does not match 10, matching evalPredicate.
    case "eq":       return `CAST(${c} AS VARCHAR) = ${sqlText(val)}`;
    case "neq":      return `CAST(${c} AS VARCHAR) != ${sqlText(val)}`;
    case "gt":       return `${c} > ${sqlNum(val)}`;
    case "gte":      return `${c} >= ${sqlNum(val)}`;
    case "lt":       return `${c} < ${sqlNum(val)}`;
    case "lte":      return `${c} <= ${sqlNum(val)}`;
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
