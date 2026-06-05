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
