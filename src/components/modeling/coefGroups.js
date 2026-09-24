// ─── ECON STUDIO · src/components/modeling/coefGroups.js ─────────────────────
// Single owner for "which coefficients are nuisance factor levels".
//
// A model with `factor(municipality)` over 93 municipalities produces 93
// coefficients that are parameters, not findings. Listing them in a forest plot
// or as significance chips buries the two terms the user actually estimated.
// Every other tool omits them by default — R's modelsummary has `coef_omit=`,
// Stata's coefplot has `drop()`, stargazer has `omit=` — so the app should too,
// and the same set must reach the exporters or the script stops matching the
// figure (the `omitVars` contract ModelComparison already established).
//
// The grouping is NOT guessed from the column name. `spec.factorVars` declares
// which variables were expanded, and `applyFactors` names each dummy
// `${col}_${level}` with spaces collapsed to underscores (helpers.js), so the
// prefix test is exact for the names this app itself generated.

// A factor with a handful of levels is readable in full, and hiding it would be
// pure obstruction. Only past this many levels does collapsing pay for itself —
// the same "legibility is a separate limit from cost" line CORR_AUTO_MAX draws
// in the correlation heatmap.
export const FACTOR_COLLAPSE_MIN = 8;

// Interaction terms carry a separator; `expandInteractions` and the coefficient
// interpreter both spell them with one of these. A term like
// `municipality_10:post` starts with the factor's prefix but is an interaction,
// and interactions stay visible — they are terms the user wrote, not levels the
// app generated.
const IX_SEPARATOR = /[×·:*]|_x_/;

/**
 * Partition coefficient names into real regressors and collapsible factor levels.
 *
 * @param {string[]} varNames    the fitted coefficient names
 * @param {string[]} factorVars  spec.factorVars — the variables that were expanded
 * @param {{collapseMin?: number}} [opts]
 * @returns {{groups: {base: string, levels: string[]}[], levelOf: Map<string,string>}}
 *   `groups` is one entry per collapsible factor, in factorVars order.
 *   `levelOf` maps each collapsible level name to its base variable.
 */
export function buildCoefGroups(varNames = [], factorVars = [], opts = {}) {
  const collapseMin = opts.collapseMin ?? FACTOR_COLLAPSE_MIN;
  const groups = [];
  const levelOf = new Map();

  for (const base of factorVars ?? []) {
    if (!base) continue;
    const prefix = `${base}_`;
    const levels = (varNames ?? []).filter(v =>
      typeof v === "string" &&
      v !== base &&
      v.startsWith(prefix) &&
      !IX_SEPARATOR.test(v)
    );
    if (levels.length < collapseMin) continue;   // shown in full
    groups.push({ base, levels });
    for (const lv of levels) levelOf.set(lv, base);
  }

  return { groups, levelOf };
}

/**
 * The coefficient names to DISPLAY, given which groups the user has expanded.
 * Order is preserved from `varNames` so an expanded group appears where its
 * levels actually sit in the design matrix.
 *
 * @param {string[]} varNames
 * @param {Map<string,string>} levelOf   from buildCoefGroups
 * @param {Set<string>} expanded         bases the user opened
 */
export function visibleCoefNames(varNames = [], levelOf = new Map(), expanded = new Set()) {
  return (varNames ?? []).filter(v => {
    const base = levelOf.get(v);
    return base == null || expanded.has(base);
  });
}

/**
 * The names currently hidden — what the replication scripts must omit so the
 * emitted table matches the figure on screen.
 */
export function hiddenCoefNames(varNames = [], levelOf = new Map(), expanded = new Set()) {
  return (varNames ?? []).filter(v => {
    const base = levelOf.get(v);
    return base != null && !expanded.has(base);
  });
}
