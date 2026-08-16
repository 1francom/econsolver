// ─── ECON STUDIO · modeling/helpers.js ────────────────────────────────────────
// Pure helpers for the modeling tab. No React — safe to import anywhere and unit-test.
// Extracted from ModelingTab.jsx.

export function buildModelAvail(panelOk, panelFdOk) {
  return {
    OLS: true, WLS: true,
    FE: panelOk, FD: panelFdOk,
    LSDV: panelOk, TWFE: panelOk, EventStudy: panelOk,
    "2SLS": true, RDD: true, FuzzyRDD: true, SpatialRDD: true, DiD: true,
    Logit: true, Probit: true, Poisson: true, PoissonFE: true, NegBinFE: true,
    GMM: true, LIML: true,
    SunAbraham: true, CallawayCS: true,
    SpatialRegression: true,
    SyntheticControl: true,
  };
}

export function buildModelHint(panel, panelOk, panelFdOk) {
  const noPanel   = "No panel structure declared — set Entity & Time columns in Wrangling.";
  const dupObsFD  = "Duplicate (i,t) pairs — FD requires unique observations per cell.";
  return {
    FE:        panelOk  ? "" : noPanel,
    FD:        panelFdOk ? "" : panel ? dupObsFD : noPanel,
    TWFE:      panelOk  ? "" : noPanel,
    LSDV:      panelOk  ? "" : noPanel,
    EventStudy:panelOk  ? "" : noPanel,
  };
}

// ─── FACTOR EXPANSION HELPER ──────────────────────────────────────────────────
// Sort a factor's distinct levels the way R's factor() would: numeric ascending
// when every level is a finite number (so Year ∈ {9,10,11} doesn't get the
// lexicographic "10","11","9" ordering), else lexicographic on the string form.
// Shared by applyFactors and expandInteractions so main-effect and interaction
// dummies pick the same reference category. Mirrors PanelEngine.js's sortLevels.
export function sortFactorLevels(rawLevels) {
  const allNum = rawLevels.every(v => typeof v === "number" && isFinite(v));
  return allNum
    ? [...rawLevels].sort((a, b) => a - b).map(String)
    : rawLevels.map(String).sort();
}

// Floats a user-chosen reference level to the front of an already-sorted
// levels array, leaving every other level's relative order untouched — the
// omitted-category convention downstream (dummyLevels = levels.slice(1))
// stays correct either way, it just omits whichever level is at index 0.
// `ref` arrives from the UI as a string; levels here are already strings
// (sortFactorLevels normalizes numeric levels via .map(String)), so a plain
// string compare is enough. Silently no-ops if ref isn't an actual level of
// this column (subsetted data, a stale saved model, a typo) — falling back
// to the existing first-level default rather than throwing, same tolerance
// this codebase already gives refPeriod in event studies.
function reorderForReference(sortedLevels, ref) {
  if (ref == null) return sortedLevels;
  const i = sortedLevels.indexOf(String(ref));
  if (i <= 0) return sortedLevels; // not found, or already first — no-op
  const rest = sortedLevels.slice();
  const [chosen] = rest.splice(i, 1);
  return [chosen, ...rest];
}

export function applyFactors(rows, vars, factorVars, factorRefs = {}) {
  const toExpand = vars.filter(v => factorVars.has(v));
  if (!toExpand.length) return { rows, vars };
  let expandedVars = [...vars];
  let expandedRows = rows;
  for (const col of toExpand) {
    const rawLevels  = [...new Set(rows.map(r => r[col]).filter(v => v != null))];
    const levels      = reorderForReference(sortFactorLevels(rawLevels), factorRefs[col]);
    const dummyLevels = levels.slice(1); // drop first = reference category
    const dummyCols   = dummyLevels.map(lv => `${col}_${lv.replace(/\s+/g, "_")}`);
    expandedRows = expandedRows.map(r => {
      if (r[col] == null) {
        // NA in a factor => listwise deletion (like lm()/regress), not silent
        // fold into the reference category. NaN propagates to the dummies so
        // runOLS/runWLS's isFinite() row filter drops this row entirely.
        return { ...r, ...Object.fromEntries(dummyCols.map(dc => [dc, NaN])) };
      }
      const val    = String(r[col]);
      const dummies = Object.fromEntries(dummyCols.map((dc, i) => [dc, val === dummyLevels[i] ? 1 : 0]));
      return { ...r, ...dummies };
    });
    expandedVars = expandedVars.flatMap(v => v === col ? dummyCols : [v]);
  }
  return { rows: expandedRows, vars: expandedVars };
}

// ─── INTERACTION EXPANSION HELPER ────────────────────────────────────────────
// Expands interaction terms (A*B or A:B) into product columns on rows, and
// augments xVars/wVars with the new columns. Called before applyFactors so
// that factor dummy columns produced here are byte-identical with what
// applyFactors would create (same naming convention: col_level).
//
// term.type === "*": main effects (var1, var2) stay in xVars AND interaction
//                   product columns are added.
// term.type === ":": only product columns are added; callers must include
//                   main effects separately if desired.
export function expandInteractions(rows, xVars, wVars, interactionTerms, factorVars, factorRefs = {}) {
  if (!interactionTerms?.length) return { rows, xVars, wVars };
  const fvSet = factorVars instanceof Set ? factorVars : new Set(factorVars ?? []);
  let augRows = rows;
  const augX  = [...xVars];
  const augW  = [...wVars];

  for (const { var1, var2, type } of interactionTerms) {
    if (!var1 || !var2 || var1 === var2) continue;

    // Returns dummy column names for a factor var (same convention as applyFactors),
    // or [col] for a numeric var. Side-effect: creates missing dummy columns in augRows.
    const ensureAndGetCols = (col) => {
      if (!fvSet.has(col)) return [col];
      const rawLevels = [...new Set(augRows.map(r => r[col]).filter(v => v != null))];
      const levels = reorderForReference(sortFactorLevels(rawLevels), factorRefs[col]);
      const lvs = levels.slice(1);
      const dcs = lvs.map(lv => `${col}_${lv.replace(/\s+/g, '_')}`);
      const missing = dcs.filter(dc => !(dc in (augRows[0] ?? {})));
      if (missing.length) {
        augRows = augRows.map(r => {
          if (r[col] == null) {
            // Same listwise-deletion contract as applyFactors: NaN propagates
            // through the product column below and drops the row in runOLS.
            const extras = {};
            dcs.forEach(dc => { if (!(dc in r)) extras[dc] = NaN; });
            return Object.keys(extras).length ? { ...r, ...extras } : r;
          }
          const val = String(r[col]);
          const extras = {};
          dcs.forEach((dc, i) => { if (!(dc in r)) extras[dc] = val === lvs[i] ? 1 : 0; });
          return Object.keys(extras).length ? { ...r, ...extras } : r;
        });
      }
      return dcs;
    };

    const cols1 = ensureAndGetCols(var1);
    const cols2 = ensureAndGetCols(var2);

    for (const c1 of cols1) {
      for (const c2 of cols2) {
        const intName = `${c1}:${c2}`;
        if (!(intName in (augRows[0] ?? {}))) {
          // No `|| 0` fallback: NaN must propagate (not get coerced to a false
          // "0" interaction) so a missing factor level or numeric NA still
          // drops the row via runOLS/runWLS's isFinite() filter.
          augRows = augRows.map(r => ({
            ...r,
            [intName]: Number(r[c1]) * Number(r[c2]),
          }));
        }
        if (!augX.includes(intName) && !augW.includes(intName)) augX.push(intName);
      }
    }

    if (type === '*') {
      if (!augX.includes(var1) && !augW.includes(var1)) augX.push(var1);
      if (!augX.includes(var2) && !augW.includes(var2)) augX.push(var2);
    }
  }

  return { rows: augRows, xVars: augX, wVars: augW };
}

// ─── ESTIMATOR RESOLVER ───────────────────────────────────────────────────────
// Maps (identification strategy, outcome family, has-weight) → the legacy
// estimator id that the dispatch branches + SQL fast path already understand.
// This keeps both _runEstimation and estimate() keyed on a single resolved id
// so the 2D (strategy × family) selector reuses every existing engine path.
export function resolveEstimator(model, family, hasWeight) {
  if (model === "OLS") {
    if (family === "poisson") return "Poisson";
    if (family === "logit")   return "Logit";
    if (family === "probit")  return "Probit";
    return hasWeight ? "WLS" : "OLS";
  }
  if (model === "FE" && family === "poisson")         return "PoissonFE";
  if (model === "EventStudy" && family === "poisson") return "SunAbraham";
  if (model === "2SLS" && family === "poisson")       return "IVPoisson"; // engine added in a later task
  return model;
}
