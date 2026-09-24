// ─── ECON STUDIO · src/services/export/feInteractionTerm.js ───────────────────
// One owner for the "FE interaction" label → native notation translation.
//
// Litux materialises a crossed fixed effect as a synthetic column whose name is
// the two sources joined with "×" (see feInteraction.js / estimationDispatch).
// That column exists only inside the app: it is NOT in the user's data frame.
// Every exporter used to push the label through its identifier sanitiser, so the
// scripts named a column that does not exist — R got `CNT_female`, Stata and
// Python got a literal `×`, and none of the three would run.
//
// Each language has its own way of saying "cross these two into one FE":
//   R / fixest    CNT^female     (the ^ operator combines FE dimensions)
//   Stata/reghdfe CNT#female     (factor-variable interaction inside absorb())
//   Python        no absorb() to speak of — the caller must build the column
//
// Only the SPLIT lives here once; the three renderings sit beside it so a new
// language cannot quietly grow a fourth convention somewhere else.

export const FE_INTERACTION_SEP = "×"; // ×

/** ["CNT","female"] for a crossed label, or null for a plain column. */
export function splitFEInteraction(label) {
  const s = String(label ?? "");
  if (!s.includes(FE_INTERACTION_SEP)) return null;
  const parts = s.split(FE_INTERACTION_SEP).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/**
 * Render one FE column for a target language.
 * @param {string} col   the FE column, possibly a crossed label
 * @param {"r"|"stata"|"python"} lang
 * @param {(s:string)=>string} sanitize  the caller's own identifier formatter,
 *   applied to each SOURCE column (never to the label as a whole)
 */
export function feTerm(col, lang, sanitize = (s) => s) {
  const parts = splitFEInteraction(col);
  if (!parts) return sanitize(col);
  const joiner = lang === "r" ? "^" : lang === "stata" ? "#" : "_x_";
  return parts.map(sanitize).join(joiner);
}

/**
 * Python has no absorb(): the crossed FE has to become a real column first.
 * Returns the assignment lines needed before the model, one per crossed FE.
 * String-concatenating the two sources reproduces the same grouping the app
 * used, whatever the source dtypes are.
 */
export function pyFEInteractionSetup(feCols = [], dfName = "df") {
  const lines = [];
  for (const col of feCols) {
    const parts = splitFEInteraction(col);
    if (!parts) continue;
    const name = feTerm(col, "python");
    const expr = parts.map(p => `${dfName}["${p}"].astype(str)`).join(' + "_" + ');
    lines.push(`# ${col} is a crossed fixed effect — build it as one column first`);
    lines.push(`${dfName}["${name}"] = ${expr}`);
  }
  return lines;
}
