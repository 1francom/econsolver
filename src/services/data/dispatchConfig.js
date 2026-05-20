// ─── ECON STUDIO · src/services/data/dispatchConfig.js ─────────────────────────
// Configuration constants for the DuckDB sufficient-statistics dispatch system.
// See docs/superpowers/specs/2026-05-19-duckdb-suffstats-roadmap-design.md.
//
// These are intentionally hardcoded — no UI knob, no runtime calibration. If
// real-world telemetry from perfLog shows a threshold is wrong, adjust the
// constant in a one-line PR.

export const N_THRESHOLD = 50_000;
export const K_THRESHOLD = 100;
export const RESIDUAL_SAMPLE_SIZE = 5_000;
export const CACHE_MAX_ENTRIES = 50;

// Sets grow per fase as estimators / SE types get SQL coverage.
// Fase 0:  {OLS}, {classical}
// Fase 1: + HC0/HC1/HC2/HC3 + factor expansion
// Fase 2: + clustered, twoway, HAC
// Values stored here are canonical (post-normalization). ModelingTab.estimate()
// canonicalizes UI seType before calling shouldUseSQLPath: hc[0-3] → uppercase,
// hac → HAC, clustered/twoway pass through lowercase.
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS", "2SLS", "WLS", "GMM", "LIML"]);
export const SQL_SUPPORTED_SE         = new Set([
  "classical",
  "HC0", "HC1", "HC2", "HC3",
  "clustered", "twoway", "HAC",
]);
