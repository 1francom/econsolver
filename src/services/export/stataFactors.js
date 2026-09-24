// ─── ECON STUDIO · src/services/export/stataFactors.js ───────────────────────
// Single owner for "this factor is a string, so Stata needs an encode first".
//
// Stata's factor-variable operators (i. / ib#. / c.) require a NUMERIC variable.
// Measured against StataNow 19.5 on 2026-09-12:
//
//   reg y x i.region          (region is str8)      -> r(109)  type mismatch
//   reg y x i.f1h             (f1h is 9.5, 10.5…)   -> r(452)  factor variables
//                                                              may not contain
//                                                              noninteger values
//   encode region, gen(region_n)
//   reg y x i.region_n                              -> r(0), and the estimates
//                                                      match Litux/R/Python to
//                                                      15 significant digits
//
// So the exporter used to emit a do-file that DIED on the estimation line for
// any model with a string factor — country, region, category names, i.e. the
// common case. It is not a precision gap, the script simply does not run.
//
// `encode` assigns codes 1..n in sorted order of the string values, so its base
// level (code 1) is the alphabetically-first one. That is the SAME reference
// Litux's `sortFactorLevels` picks (it drops levels[0] of a lexicographic sort)
// and the same one R's `factor()` and patsy's `C()` use — verified on a fixture
// whose data order is deliberately NOT alphabetical (south, north, east): all
// four put the base on "east" and returned identical coefficients. The default
// case therefore needs no reference bookkeeping at all.

/**
 * Collapse the expansion's dummy map into the level list per factor.
 * `factorMap` is `{ dummyCol: { factor, level, ref } }` as built by
 * `applyFactors` and carried on the result (trimResult whitelists it).
 *
 * @returns {Record<string, (string|number)[]>} factor -> every level, sorted the
 *   way Stata's `encode` will sort them (plain ascending by value).
 */
export function factorLevelsFromMap(factorMap) {
  if (!factorMap || typeof factorMap !== "object") return {};
  const byFactor = {};
  for (const entry of Object.values(factorMap)) {
    if (!entry || !entry.factor) continue;
    const set = byFactor[entry.factor] ?? (byFactor[entry.factor] = new Set());
    if (entry.level != null) set.add(entry.level);
    // A fully-coded factor (through-the-origin) carries ref === null and has no
    // dropped level, so this is a no-op there rather than adding a bogus level.
    if (entry.ref != null) set.add(entry.ref);
  }
  const out = {};
  for (const [col, set] of Object.entries(byFactor)) {
    const levels = [...set];
    const allNum = levels.every(v => v !== "" && isFinite(Number(v)));
    out[col] = allNum
      ? levels.sort((a, b) => Number(a) - Number(b))
      : levels.map(String).sort();
    // NOTE: JS sorts by UTF-16 code unit and Stata's encode by UTF-8 byte order.
    // These agree for ASCII (and for the plain-ASCII level names this sees in
    // practice); they can diverge on accented levels, which only matters for the
    // ib#. index below, never for the default base.
  }
  return out;
}

/** A factor Stata cannot take as-is: any level that is not a whole number. */
export function needsEncode(levels) {
  if (!Array.isArray(levels) || !levels.length) return false;
  return !levels.every(v => /^-?\d+$/.test(String(v)));
}

/** The variable `encode` creates. Kept in one place so the term and the
 *  generate() line cannot drift apart. */
export function encodedName(col) {
  return `${col}_n`;
}

/**
 * The `encode` lines to emit before the estimation command, one per factor that
 * needs one. Returns [] when every factor is already an integer column, so a
 * model without string factors produces a byte-identical do-file to before.
 *
 * @param {string[]} factorVars   the declared factor variables
 * @param {Record<string,(string|number)[]>} factorLevels  from factorLevelsFromMap
 */
export function stataEncodeLines(factorVars = [], factorLevels = {}) {
  const lines = [];
  for (const col of factorVars) {
    const levels = factorLevels[col];
    if (!levels || !needsEncode(levels)) continue;
    lines.push(`* ${col} is a string/non-integer factor — Stata's i. operator needs a`);
    lines.push(`* numeric variable (i.${col} alone errors with "type mismatch"). encode`);
    lines.push(`* assigns codes 1..n in alphabetical order, so the base level matches`);
    lines.push(`* the one Litux, R's factor() and patsy's C() all use.`);
    lines.push(`capture drop ${encodedName(col)}`);
    lines.push(`encode ${col}, generate(${encodedName(col)})`);
  }
  return lines;
}

/**
 * 1-based code `encode` will give `ref`, or null when it cannot be determined.
 * Used for `ib#.` on a string factor with a custom reference — which previously
 * fell back to the default base, silently changing every contrast.
 */
export function encodedRefCode(ref, levels) {
  if (ref == null || !Array.isArray(levels)) return null;
  const i = levels.map(String).indexOf(String(ref));
  return i < 0 ? null : i + 1;
}
