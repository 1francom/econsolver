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
//   zVars:         string[] | null  — instruments (required when estimator="2SLS")
//   endogCount:    number          — number of endogenous regressors (required when estimator="2SLS")
//   xColsEndog:    string[]         — endogenous regressor names (required when estimator="2SLS")
//   weightCol:     string | null  — weight column (required when estimator="WLS")
//   unitCol:       string | null  — entity column (required when estimator="FE", "FD", or "TWFE")
//   timeCol:       string | null  — time column (required when estimator="FD" or "TWFE"; also for HAC)
//   clusterVar:    string | null  — one-way cluster column (required when seType="clustered"
//                                   or for panel cluster-by-entity, in which case it equals unitCol)

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
  if (ctx.hasWeights && ctx.estimator !== "WLS") return false;

  // Cluster/HAC need their operand columns present; otherwise the SQL path
  // cannot run — fall back to JS so the engine returns "classical HC1" per
  // robustSE.js's existing degradation contract.
  if (se === "clustered" && !ctx.clusterVar) return false;
  if (se === "twoway"    && (!ctx.clusterVar || !ctx.clusterVar2)) return false;
  if (se === "HAC"       && !ctx.timeVar) return false;

  if (["2SLS", "GMM", "LIML"].includes(ctx.estimator)) {
    if (!Array.isArray(ctx.zVars) || ctx.zVars.length === 0) return false;
    if (!Array.isArray(ctx.xColsEndog) || ctx.xColsEndog.length === 0) return false;
    // Order condition: at least one instrument per endogenous regressor
    if (ctx.zVars.length < ctx.xColsEndog.length) return false;
    // Joint complexity: k + q must respect K_THRESHOLD (both go through suff-stats matrices)
    const totalK = (ctx.xColsExpanded?.length ?? 0) + ctx.zVars.length;
    if (totalK > K_THRESHOLD) return false;
  }

  // GMM 2-step efficient SE is heteroskedasticity-robust via Ω̂; HC overrides not
  // supported. LIML HC variants deferred to a later sub-fase.
  if (["GMM", "LIML"].includes(ctx.estimator) && se !== "classical") return false;

  if (ctx.estimator === "WLS") {
    if (!ctx.weightCol || typeof ctx.weightCol !== "string") return false;
    // Scope of Fase 3c: classical / HC0 / HC1 only
    if (!["classical", "HC0", "HC1"].includes(se)) return false;
  }

  // ── Panel (preempt before OLS fall-through) ────────────────────────────────
  if (["FE", "FD", "TWFE"].includes(ctx.estimator)) {
    if (!ctx.unitCol || typeof ctx.unitCol !== "string") return false;
    if (["FD", "TWFE"].includes(ctx.estimator)) {
      if (!ctx.timeCol || typeof ctx.timeCol !== "string") return false;
    }
    if (ctx.hasWeights) return false;

    // Fase 4b: classical / HC0 / HC1 / HC2 / HC3 / clustered / HAC
    const okSE = ["classical", "HC0", "HC1", "HC2", "HC3", "clustered", "HAC"];
    if (!okSE.includes(se)) return false;

    // Cluster: clusterVar can be null (engine defaults to entity), or a string column.
    if (se === "clustered" && ctx.clusterVar != null && typeof ctx.clusterVar !== "string") {
      return false;
    }

    // HAC for panels = Driscoll-Kraay. Requires timeCol (already validated for
    // FD/TWFE; for FE, timeCol must be supplied via seOpts.
    if (se === "HAC" && !ctx.timeCol) return false;

    // Two-way clustering on panels deferred to Fase 4c.
    if (se === "twoway") return false;

    // HC2/HC3 prepared-statement param budget: dim² params per aggregate.
    // At dim > 31 (k > 30) we exceed safe limits; fall back to JS.
    if (["HC2", "HC3"].includes(se) && (ctx.xColsExpanded.length + 1) ** 2 > 1000) {
      return false;
    }
  }

  return true;
}
