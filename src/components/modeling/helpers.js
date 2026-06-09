// ─── ECON STUDIO · modeling/helpers.js ────────────────────────────────────────
// Pure helpers for the modeling tab. No React — safe to import anywhere and unit-test.
// Extracted from ModelingTab.jsx.

export function buildModelAvail(panelOk, panelFdOk) {
  return {
    OLS: true, WLS: true,
    FE: panelOk, FD: panelFdOk,
    LSDV: panelOk, TWFE: panelOk, EventStudy: panelOk,
    "2SLS": true, RDD: true, FuzzyRDD: true, SpatialRDD: true, DiD: true,
    Logit: true, Probit: true, Poisson: true, PoissonFE: true,
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
export function applyFactors(rows, vars, factorVars) {
  const toExpand = vars.filter(v => factorVars.has(v));
  if (!toExpand.length) return { rows, vars };
  let expandedVars = [...vars];
  let expandedRows = rows;
  for (const col of toExpand) {
    const levels = [...new Set(rows.map(r => r[col]).filter(v => v != null))]
      .map(String).sort();
    const dummyLevels = levels.slice(1); // drop first = reference category
    const dummyCols   = dummyLevels.map(lv => `${col}_${lv.replace(/\s+/g, "_")}`);
    expandedRows = expandedRows.map(r => {
      const val    = String(r[col] ?? "");
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
export function expandInteractions(rows, xVars, wVars, interactionTerms, factorVars) {
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
      const levels = [...new Set(augRows.map(r => r[col]).filter(v => v != null))]
        .map(String).sort();
      const lvs = levels.slice(1);
      const dcs = lvs.map(lv => `${col}_${lv.replace(/\s+/g, '_')}`);
      const missing = dcs.filter(dc => !(dc in (augRows[0] ?? {})));
      if (missing.length) {
        augRows = augRows.map(r => {
          const val = String(r[col] ?? '');
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
          augRows = augRows.map(r => ({
            ...r,
            [intName]: (Number(r[c1]) || 0) * (Number(r[c2]) || 0),
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
