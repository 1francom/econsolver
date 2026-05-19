// ─── ECON STUDIO · src/services/data/duckdbDispatch.js ─────────────────────────
// Single decision point: does this estimation go via SQL suff-stats or via the
// classic JS path (extractAllRows + runOLS et al)? Cheap checks first.
//
// ctx shape:
//   tableName:     string | null  — DuckDB table backing the dataset
//   n:             number         — row count of the full dataset
//   xColsExpanded: string[]       — regressor names after factor expansion
//   estimator:     string         — "OLS", "FE", "2SLS", …
//   seType:        string | undefined  — "classical", "HC1", …; undefined → classical
//   hasWeights:    boolean
//   hasFactors:    boolean        — true if any factor() in xCols pre-expansion
//   clusterVar:    string | null  — one-way cluster column (required when seType="clustered" or "twoway")
//   clusterVar2:   string | null  — second cluster column (required when seType="twoway")
//   timeVar:       string | null  — time column for HAC LAG ordering (required when seType="HAC")

import {
  N_THRESHOLD,
  K_THRESHOLD,
  SQL_SUPPORTED_ESTIMATORS,
  SQL_SUPPORTED_SE,
} from "./dispatchConfig.js";

export function shouldUseSQLPath(ctx) {
  if (!ctx.tableName) return false;
  if (!(ctx.n >= N_THRESHOLD)) return false;
  if (!Array.isArray(ctx.xColsExpanded) || ctx.xColsExpanded.length > K_THRESHOLD) return false;
  if (!SQL_SUPPORTED_ESTIMATORS.has(ctx.estimator)) return false;
  const se = ctx.seType ?? "classical";
  if (!SQL_SUPPORTED_SE.has(se)) return false;
  if (ctx.hasWeights) return false;

  // Cluster/HAC need their operand columns present; otherwise the SQL path
  // cannot run — fall back to JS so the engine returns "classical HC1" per
  // robustSE.js's existing degradation contract.
  if (se === "clustered" && !ctx.clusterVar) return false;
  if (se === "twoway"    && (!ctx.clusterVar || !ctx.clusterVar2)) return false;
  if (se === "HAC"       && !ctx.timeVar) return false;

  return true;
}
