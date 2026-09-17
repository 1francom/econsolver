// ─── ECON STUDIO · services/export/dummyStep.js ──────────────────────────────
// Single owner of the `dummy` step's emission in all three languages. There
// were SIX copies (stepTranslators.js plus a private one in each exporter) and
// every one of them disagreed with `runner.js`, which is the definition:
//
//   one column per level of the source column, named `${pfx}_${level}`,
//   1/0 (a null row is 0 everywhere, not NA), and the SOURCE COLUMN IS KEPT.
//
// Measured on hansen_data.csv (214,558 rows) with pfx "yr" over `year`:
//   R      fastDummies::dummy_cols   → year_2000 …    (ignores the prefix)
//   Stata  tabulate, generate(yr)    → yr1 … yr8      (positional, not levels)
//   Python pd.get_dummies(columns=…) → drops `year`   (source column gone)
// A script whose columns are named differently cannot be re-run against the
// model that follows it, so all three were wrong in the same way: plausible
// output, different table.

const rStr  = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const pyStr = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
const stVar = (c) => String(c).replace(/`/g, "");

/**
 * Base R, deliberately without fastDummies: the package cannot express the
 * prefix, and one less dependency in a replication script is one less reason
 * it does not run on someone else's machine.
 */
export function dummyR(step, df = "df") {
  const col = rStr(step.col);
  const pfx = String(step.pfx ?? step.col);
  return [
    `# One-hot encode ${step.col} (prefix "${pfx}") — one column per level, source column kept`,
    `for (.lvl in unique(${df}[[${col}]][!is.na(${df}[[${col}]])]))`,
    `  ${df}[[paste0(${rStr(pfx + "_")}, .lvl)]] <- as.integer(!is.na(${df}[[${col}]]) & ${df}[[${col}]] == .lvl)`,
  ].join("\n");
}

/**
 * Stata names each dummy after the LEVEL, like the app, instead of numbering
 * them. `strtoname` keeps a level that is not a legal name (a decimal, a minus
 * sign, a string with spaces) from producing an invalid variable name.
 */
export function dummyStata(step) {
  const col = stVar(step.col);
  const pfx = stVar(String(step.pfx ?? step.col));
  return [
    `* One-hot encode ${col} (prefix ${pfx}) — one dummy per level, source column kept`,
    `levelsof ${col}, local(_lv)`,
    `capture confirm numeric variable ${col}`,
    `if _rc == 0 {`,
    `    foreach _l of local _lv {`,
    `        local _nm = strtoname("${pfx}_" + string(\`_l'))`,
    `        capture drop \`_nm'`,
    `        gen byte \`_nm' = (${col} == \`_l') & !missing(${col})`,
    `    }`,
    `}`,
    `else {`,
    `    foreach _l of local _lv {`,
    `        local _nm = strtoname("${pfx}_" + "\`_l'")`,
    `        capture drop \`_nm'`,
    `        gen byte \`_nm' = (${col} == "\`_l'")`,
    `    }`,
    `}`,
  ].join("\n");
}

/**
 * `pd.get_dummies(df, columns=[c])` REMOVES c. Encoding the series and joining
 * it back keeps the source column, and NaN rows come back as zeros — which is
 * what the app produces.
 */
export function dummyPython(step, df = "df") {
  const col = pyStr(step.col);
  const pfx = pyStr(String(step.pfx ?? step.col));
  return [
    `# One-hot encode ${step.col} (prefix ${step.pfx ?? step.col}) — source column kept`,
    `${df} = ${df}.join(pd.get_dummies(${df}[${col}], prefix=${pfx}, dtype=int))`,
  ].join("\n");
}
