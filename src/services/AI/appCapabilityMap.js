// ─── ECON STUDIO · services/AI/appCapabilityMap.js ───────────────────────────
// Derives the AI's knowledge of the pipeline vocabulary from STEP_REGISTRY so
// it never drifts. Used by the NL command bar (allowed-step catalogue) and,
// later, by the research coach (capability map).
import { STEP_REGISTRY, CATEGORIES } from "../../pipeline/registry.js";

// Coarse type hint for each schema field, so the model knows what to emit.
function fieldHint(field) {
  if (field.type === "select" && Array.isArray(field.options)) {
    return `${field.key}:one-of[${field.options.map(o => o.value).join("|")}]`;
  }
  return `${field.key}:${field.type}`;
}

// Produce a compact catalogue of the steps the AI is allowed to emit.
// allowedCategories filters which registry categories are exposed.
export function serializeAllowedSteps(allowedCategories = ["cleaning", "features"]) {
  const lines = ["ALLOWED PIPELINE STEPS (emit only these `type`s; provide every listed key):"];
  for (const s of STEP_REGISTRY) {
    if (s.internal) continue;
    if (!allowedCategories.includes(s.category)) continue;
    const keys = (s.schema || []).map(fieldHint).join(", ");
    lines.push(`- ${s.type} (${s.label}): ${s.description}`);
    if (keys) lines.push(`    keys: ${keys}`);
  }
  return lines.join("\n");
}

// ─── APP CAPABILITY MAP (for the research coach) ─────────────────────────────
// Curated shell — the ONE place to edit when a tab/sub-tab is added.
// Keep each entry to a single short purpose line.
export const APP_CAPABILITY_MAP = {
  Data:      { purpose: "Load & inspect datasets", subtabs: {
                 "Data Viewer": "browse/edit the table, per-cell edits",
                 "Sources": "fetch from World Bank / OECD, upload CSV/Excel/Stata/RDS/Parquet/shapefile" } },
  Clean:     { purpose: "Wrangle & clean the data (builds the pipeline)", subtabs: {
                 "Cleaning": "filter, drop NA, fill NA, recode, winsorize, trim/flag outliers, distinct",
                 "Panel Structure": "declare entity/time panel structure",
                 "Transform": "log/sq/z-score, lag/lead/diff, dummies, dates, mutate, generate column from vector",
                 "Reshape & Merge": "pivot longer/wider, group & summarize, group transform, joins, append, combine, vector",
                 "Dictionary": "AI-infer or edit variable descriptions",
                 "AI command": "describe a change in plain language; preview & apply pipeline steps" } },
  Explore:   { purpose: "Descriptive stats & plots", subtabs: {
                 "Explorer": "summary stats, distributions",
                 "Plot Builder": "layered charts (point/line/bar/histogram/density)" } },
  Model:     { purpose: "Estimate econometric models", subtabs: {
                 "Estimator": "pick a model — Linear (OLS), Panel (FE/FD/LSDV), DiD (2×2 DiD, TWFE DiD, CS DiD, Sun-Abraham), Event Study (Classical TWFE, CS DiD, Sun-Abraham), IV/2SLS, RDD, GMM, Synthetic Control",
                 "Variables": "choose Y, X, instruments, weights",
                 "Inference Options": "SE type — classical / HC1-3 / clustered / two-way / HAC",
                 "Diagnostics": "heteroskedasticity, autocorrelation, normality tests",
                 "Compare": "pin models side by side; run across subsets",
                 "Code": "view/edit R / Python / Stata replication code" } },
  Simulate:  { purpose: "DGP builder, Monte Carlo, pre-model sample tests", subtabs: {} },
  Calculate: { purpose: "Calculator workspace", subtabs: {} },
  Report:    { purpose: "Publication output — LaTeX tables, forest plots, AI narrative & unified script", subtabs: {} },
};

// Full app map: curated shell + auto-derived pipeline operations (never drifts).
export function serializeCapabilityMap() {
  const lines = ["Litux — WHERE TO DO THINGS (guide the user to the right place):"];
  for (const [tab, info] of Object.entries(APP_CAPABILITY_MAP)) {
    lines.push(`\n[${tab}] ${info.purpose}`);
    for (const [sub, desc] of Object.entries(info.subtabs || {})) {
      lines.push(`  - ${sub}: ${desc}`);
    }
  }
  lines.push("\nWRANGLING OPERATIONS (pipeline steps, auto-listed from the registry):");
  for (const cat of CATEGORIES) {
    const steps = STEP_REGISTRY.filter(s => s.category === cat.id && !s.internal);
    if (!steps.length) continue;
    lines.push(`  ${cat.label}: ${steps.map(s => s.label).join("; ")}`);
  }
  return lines.join("\n");
}
