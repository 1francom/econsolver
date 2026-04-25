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
} from "./PanelEngine.js";

// ── Causal inference estimators ───────────────────────────────────────────────
export {
  run2SLS,
  ikBandwidth,
  runSharpRDD,
  runMcCrary,
} from "./CausalEngine.js";
