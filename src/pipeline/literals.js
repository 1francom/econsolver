// ─── ECON STUDIO · pipeline/literals.js ────────────────────────────────────
// Shared coercion for user-typed literal values in pipeline steps.
//
// Why this exists: `if_else` and `case_when` take their branch values from
// text <input>s, so a user typing 1 and 0 produces the STRINGS "1" and "0".
// A column built that way fails every numeric test downstream — ModelingTab's
// `numericCols` requires `typeof r[h] === "number"` — so a 0/1 flag silently
// never appears in the Y (dependent variable) picker even though it looks
// numeric on screen.
//
// Both `runner.js` and the R/Python/Stata translators in `stepTranslators.js`
// call this, so the value written into the dataset and the literal emitted
// into a replication script can never drift apart.

// A plain decimal literal. Deliberately rejects zero-padded integers so a
// typed code like "007" keeps its string form instead of silently becoming 7 —
// padded identifiers are meaningful in survey and administrative data.
const NUMERIC_LITERAL = /^[+-]?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * Convert a numeric-looking user literal into a real number.
 *
 * Non-strings pass through untouched (a value already coerced upstream, or a
 * column value looked up by name, must not be re-processed). Empty input
 * becomes null, matching how the rest of the pipeline represents missing.
 *
 * Callers must resolve column references BEFORE calling this — a column
 * legitimately named "2020" would otherwise be turned into the number 2020.
 */
export function coerceLiteral(v) {
  if (typeof v !== "string") return v;
  const t = v.trim();
  if (t === "") return null;
  if (!NUMERIC_LITERAL.test(t)) return v;
  const n = Number(t);
  return Number.isFinite(n) ? n : v;
}
