// ─── ECON STUDIO · src/math/index.js ──────────────────────────────────────────
// Single import point for all mathematical engines.
// Usage:  import { runOLS, runFE, run2SLS, runSharpRDD } from "./src/math/index.js"

// ── Core linear algebra + OLS + diagnostics + export helpers ──────────────────
export {
  // Matrix algebra
  transpose, matMul, matInv,
  // Statistics
  tCDF, fCDF, pValue, stars,
  // OLS
  runOLS,
  runWLS,
  // Diagnostics
  breuschPagan, computeVIF, hausmanTest,
  // Export helpers
  buildLatex, buildCSVExport, downloadText,
} from "./LinearEngine.js";

// ── Panel estimators ──────────────────────────────────────────────────────────
export {
  runFE,
  runFD,
  run2x2DiD,
  runTWFEDiD,
  runEventStudy,
  runLSDV,
} from "./PanelEngine.js";

// ── Causal inference estimators ───────────────────────────────────────────────
export {
  run2SLS,
  ikBandwidth,
  runSharpRDD,
  runFuzzyRDD,
  runMcCrary,
} from "./CausalEngine.js";

// ── Binary outcome models + Poisson FE ───────────────────────────────────────
export {
  runLogit,
  runProbit,
  runPoissonFE,
  normCDF,
  buildBinaryLatex,
  buildBinaryCSV,
} from "./NonLinearEngine.js";

// ── IV extensions: GMM and LIML ──────────────────────────────────────────────
export { runGMM, runLIML } from "./GMMEngine.js";

// ── Synthetic Control (Abadie-Diamond-Hainmueller 2010) ──────────────────────
export { runSyntheticControl } from "./SyntheticControlEngine.js";

// ── Canonical result wrapper ──────────────────────────────────────────────────
export { wrapResult, getCoeffBlock } from "./EstimationResult.js";

// ── Spatial Analytics (Phase 11) ─────────────────────────────────────────────
export {
  haversine, euclidean,
  isWithinBuffer, assignBuffer, assignDistance,
  assignRectGrid, assignH3Grid,
  pointInPolygon, parseWKTPolygon, spatialJoin,
  nearestNeighbor,
} from "./SpatialEngine.js";
