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
  return true;
}
