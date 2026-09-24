// ─── ECON STUDIO · src/services/export/stataJoin.js ──────────────────────────
// Single owner for how a join/lookup/bind_cols is spelled in Stata.
//
// THE BUG THIS EXISTS FOR (measured on StataNow 19.5, 2026-09-12):
// every emitted merge carried `suffixes("" "_r")`, and
//
//     merge m:1 k using "r.dta", suffixes("" "_y")
//     -> option suffixes() not allowed
//     r(198);
//
// **Stata's `merge` has no `suffixes()` option at all** — that is a dplyr/pandas
// concept. So the option is a SYNTAX error, independent of cardinality, and the
// line failed in every regime: the `join`, `lookup` and `bind_cols` steps each
// produced a do-file that died where the datasets were combined. It had been
// marked "UNVERIFIED against a real Stata run"; it does not run.
//
// CARDINALITY. Litux's runner joins with a multimap, i.e. dplyr semantics, and
// on three fixtures (master repeats / using repeats / both repeat) dplyr and
// Litux both return 200 / 200 / 60 rows. Against those:
//
//     merge 1:m ... (what was emitted)   r(198) in all three
//     merge 1:m ... (option removed)     r(459) when the master key repeats
//     joinby ...    200 / 200 / 60       matches dplyr and Litux everywhere
//
// `joinby` is therefore the right primary for `join`: it needs no advance
// knowledge of which regime the data is in, which the exporter does not have.
// `merge m:1` stays correct for `lookup` (that step is m:1 by contract and
// THROWS on a repeated right key) and `merge 1:1` for `bind_cols`.
//
// HOMONYMS. With no `suffixes()`, `joinby` keeps the MASTER's copy of a shared
// column and discards the using's outright (verified: master v=1 survived, the
// using's v=999 vanished, no v_y created). dplyr instead keeps both, suffixing
// the second. Since `allDatasets` carries only `{name, filename}` and no
// headers, the exporter cannot name the shared columns at export time — so the
// rename is done AT RUNTIME from the master's own varlist. Verified end to end:
// the result carries `v` = 1 and `v_y` = 999, which is dplyr's behaviour exactly.

/** dplyr's join types as joinby's `unmatched()` argument. */
export const UNMATCHED_BY_HOW = {
  left:  "master",
  inner: "none",
  right: "using",
  full:  "both",
};

/**
 * Capture the master's variable names before the using dataset replaces the
 * data in memory. Macros survive preserve/restore, the data does not.
 */
export function stataMasterVarlist(macro = "_mastervars") {
  return [`unab ${macro} : _all`];
}

/**
 * Rename the using dataset's columns that collide with the master's, so the
 * combine keeps both copies the way dplyr does. Emitted INSIDE the preserve
 * block, with the using dataset in memory.
 *
 * @param {string[]} keyVars  columns to leave alone (the join keys)
 * @param {string}   suffix   the step's suffix, e.g. "_r"
 * @param {string}   macro    the macro filled by stataMasterVarlist
 */
export function stataSuffixHomonyms(keyVars = [], suffix = "_r", macro = "_mastervars") {
  const skip = keyVars.filter(Boolean);
  const guard = skip.length
    ? `    if ${skip.map(k => `"\`_v'" != "${k}"`).join(" & ")} {`
    : `    if 1 {`;
  return [
    `  * Stata's merge/joinby have no suffixes() option, so a column present in`,
    `  * BOTH datasets would silently keep only the master's copy. Rename the`,
    `  * using's collisions to reproduce the "${suffix}" suffix R and Python apply.`,
    `  foreach _v of local ${macro} {`,
    guard,
    `      capture confirm variable \`_v'`,
    `      if !_rc rename \`_v' \`_v'${suffix}`,
    `    }`,
    `  }`,
  ];
}

/** joinby adds a `_merge` marker unless unmatched(none); dplyr adds no such
 *  column, and the old emission used `nogen` for the same reason. */
export function stataDropMergeMarker() {
  return [`capture drop _merge`];
}
