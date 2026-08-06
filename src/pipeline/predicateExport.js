// ─── ECON STUDIO · pipeline/predicateExport.js ────────────────────────────────
// Compiles a canonical PredicateNode (see ./predicate.js) into an R, Python or
// Stata boolean expression for the replication scripts.
//
// Kept out of predicate.js so that module stays about evaluating and one SQL
// dialect; this one is about the three export targets.
//
// EVERY compiler here mirrors evalPredicate's semantics, because a replication
// script that selects different rows than the app is worse than one that fails:
//   * eq/neq compare as TEXT
//   * contains/startswith/endswith/regex are case-INSENSITIVE
//   * a null value matches nothing except isna/notna/isblank/notblank
//
// And every compiler THROWS on an unknown operator. The three translators these
// replace each ended in a permissive default (`TRUE` / `True` / `1`), so a
// filter they could not express exported as "keep every row" — the script ran,
// returned more rows than the analysis, and said nothing.

import { normalizeOp } from "./predicate.js";

// ─── shared escaping ──────────────────────────────────────────────────────────

// Escape a literal so it can sit inside a double-quoted string in R/Stata.
const dq = (v) => String(v ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
// Escape a literal so it is matched literally by a regex engine.
const rxEsc = (v) => String(v ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A regex literal inside an R double-quoted string needs both layers.
const rRegex = (v) => dq(rxEsc(v));

const num = (v, op) => {
  const n = Number(v);
  if (!isFinite(n)) throw new Error(`Non-numeric value "${v}" for operator "${op}".`);
  return String(n);
};

const unknown = (op, lang) => {
  throw new Error(
    `Unknown operator "${op}" — refusing to emit ${lang} that would keep every row.`
  );
};

// ─── R (dplyr) ────────────────────────────────────────────────────────────────

export function predicateToR(node, opts = {}) {
  const name = opts.name ?? (x => x);
  if (node.type === "and" || node.type === "or") {
    const sep = node.type === "and" ? " & " : " | ";
    return "(" + node.children.map(c => predicateToR(c, opts)).join(sep) + ")";
  }
  const c   = name(node.col);
  const op  = normalizeOp(node.op);
  const val = node.value;
  const list = (Array.isArray(node.values) ? node.values : [val]).map(v => `"${dq(v)}"`).join(", ");

  switch (op) {
    case "notna":    return `!is.na(${c})`;
    case "isna":     return `is.na(${c})`;
    case "isblank":  return `(is.na(${c}) | as.character(${c}) == "")`;
    case "notblank": return `(!is.na(${c}) & as.character(${c}) != "")`;
    // Text comparison, matching evalPredicate. NA propagates through == and
    // dplyr::filter drops NA rows, which is what evalPredicate does too.
    case "eq":       return `as.character(${c}) == "${dq(val)}"`;
    case "neq":      return `as.character(${c}) != "${dq(val)}"`;
    case "gt":       return `${c} > ${num(val, op)}`;
    case "gte":      return `${c} >= ${num(val, op)}`;
    case "lt":       return `${c} < ${num(val, op)}`;
    case "lte":      return `${c} <= ${num(val, op)}`;
    case "between":  return `(${c} >= ${num(node.lo ?? val, op)} & ${c} <= ${num(node.hi ?? node.value2, op)})`;
    case "in":       return `as.character(${c}) %in% c(${list})`;
    // `NA %in% c(...)` is FALSE in R, so a bare negation would KEEP null rows
    // while evalPredicate drops them. The is.na guard is load-bearing.
    case "nin":      return `(!is.na(${c}) & !(as.character(${c}) %in% c(${list})))`;
    case "contains":   return `grepl("${rRegex(val)}", as.character(${c}), ignore.case = TRUE)`;
    case "ncontains":  return `(!is.na(${c}) & !grepl("${rRegex(val)}", as.character(${c}), ignore.case = TRUE))`;
    case "startswith": return `grepl("^${rRegex(val)}", as.character(${c}), ignore.case = TRUE)`;
    case "endswith":   return `grepl("${rRegex(val)}$", as.character(${c}), ignore.case = TRUE)`;
    // A regex operand is already a pattern — escaping it would break it.
    case "regex":      return `grepl("${dq(val)}", as.character(${c}), ignore.case = TRUE)`;
    default: return unknown(node.op, "R");
  }
}

// ─── Python (pandas) ──────────────────────────────────────────────────────────

export function predicateToPython(node, opts = {}) {
  const df = opts.df ?? "df";
  if (node.type === "and" || node.type === "or") {
    const sep = node.type === "and" ? " & " : " | ";
    return "(" + node.children.map(c => predicateToPython(c, opts)).join(sep) + ")";
  }
  const ref = `${df}["${dq(node.col)}"]`;
  const str = `${ref}.astype("string")`;
  const op  = normalizeOp(node.op);
  const val = node.value;
  const list = (Array.isArray(node.values) ? node.values : [val]).map(v => `"${dq(v)}"`).join(", ");

  switch (op) {
    case "notna":    return `${ref}.notna()`;
    case "isna":     return `${ref}.isna()`;
    case "isblank":  return `(${ref}.isna() | (${str} == ""))`;
    case "notblank": return `(${ref}.notna() & (${str} != ""))`;
    // A mask containing pd.NA cannot be used for boolean indexing, so equality
    // masks are filled. NA then reads as "does not match", matching evalPredicate.
    case "eq":       return `(${str} == "${dq(val)}").fillna(False)`;
    case "neq":      return `(${ref}.notna() & (${str} != "${dq(val)}"))`;
    case "gt":       return `(${ref} > ${num(val, op)})`;
    case "gte":      return `(${ref} >= ${num(val, op)})`;
    case "lt":       return `(${ref} < ${num(val, op)})`;
    case "lte":      return `(${ref} <= ${num(val, op)})`;
    case "between":  return `(${ref} >= ${num(node.lo ?? val, op)}) & (${ref} <= ${num(node.hi ?? node.value2, op)})`;
    case "in":       return `${str}.isin([${list}])`;
    // ~isin(...) is True for NA, which would keep null rows; guard with notna.
    case "nin":      return `(${ref}.notna() & ~${str}.isin([${list}]))`;
    case "contains":  return `${str}.str.contains("${dq(val)}", case=False, regex=False, na=False)`;
    case "ncontains": return `(${ref}.notna() & ~${str}.str.contains("${dq(val)}", case=False, regex=False, na=False))`;
    // pandas' startswith/endswith take no `case` argument, so both sides lower.
    case "startswith": return `${str}.str.lower().str.startswith("${dq(String(val ?? "").toLowerCase())}", na=False)`;
    case "endswith":   return `${str}.str.lower().str.endswith("${dq(String(val ?? "").toLowerCase())}", na=False)`;
    case "regex":      return `${str}.str.contains("${dq(val)}", case=False, regex=True, na=False)`;
    default: return unknown(node.op, "Python");
  }
}

// ─── Stata ────────────────────────────────────────────────────────────────────
// Two deliberate approximations, both noted rather than hidden:
//   * Stata has no case-insensitive regex, so `regex` lowercases both sides —
//     correct for literal patterns, lossy for a pattern using character classes.
//   * `missing()` already covers the empty string for string variables, which is
//     Stata's own data model, so isblank and isna coincide there.

export function predicateToStata(node, opts = {}) {
  const name = opts.name ?? (x => x);
  if (node.type === "and" || node.type === "or") {
    const sep = node.type === "and" ? " & " : " | ";
    return "(" + node.children.map(c => predicateToStata(c, opts)).join(sep) + ")";
  }
  const c   = name(node.col);
  const op  = normalizeOp(node.op);
  const val = node.value;
  const vals = Array.isArray(node.values) ? node.values : [val];

  switch (op) {
    case "notna":    return `!missing(${c})`;
    case "isna":     return `missing(${c})`;
    case "isblank":  return `missing(${c})`;
    case "notblank": return `!missing(${c})`;
    case "eq":       return `${c} == "${dq(val)}"`;
    case "neq":      return `(!missing(${c}) & ${c} != "${dq(val)}")`;
    case "gt":       return `${c} > ${num(val, op)}`;
    case "gte":      return `${c} >= ${num(val, op)}`;
    case "lt":       return `${c} < ${num(val, op)}`;
    case "lte":      return `${c} <= ${num(val, op)}`;
    case "between":  return `inrange(${c}, ${num(node.lo ?? val, op)}, ${num(node.hi ?? node.value2, op)})`;
    // inlist() caps at 10 string arguments, so an or-chain is used instead —
    // it has no length limit and reads the same.
    case "in":       return `(${vals.map(v => `${c} == "${dq(v)}"`).join(" | ")})`;
    case "nin":      return `(!missing(${c}) & !(${vals.map(v => `${c} == "${dq(v)}"`).join(" | ")}))`;
    case "contains":   return `strpos(lower(${c}), "${dq(String(val ?? "").toLowerCase())}") > 0`;
    case "ncontains":  return `(!missing(${c}) & strpos(lower(${c}), "${dq(String(val ?? "").toLowerCase())}") == 0)`;
    case "startswith": return `strpos(lower(${c}), "${dq(String(val ?? "").toLowerCase())}") == 1`;
    case "endswith":   return `substr(lower(${c}), -strlen("${dq(String(val ?? "").toLowerCase())}"), .) == "${dq(String(val ?? "").toLowerCase())}"`;
    case "regex":      return `regexm(lower(${c}), "${dq(String(val ?? "").toLowerCase())}")`;
    default: return unknown(node.op, "Stata");
  }
}

/** Normalise a `filter` step to a predicate node, accepting both stored shapes. */
export function filterStepToNode(step) {
  return step.predicate ?? {
    type: "condition",
    col: step.col, op: step.op, value: step.value,
    values: step.values, lo: step.lo, hi: step.hi,
  };
}
