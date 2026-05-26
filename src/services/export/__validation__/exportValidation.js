// ─── LITUX · services/export/__validation__/exportValidation.js ───────────────
// Smoke-tests the R / Stata / Python emitters for every estimator.
//
// Checks that each generated script:
//   (a) is a non-empty string
//   (b) contains the expected language-specific command for that estimator
//
// Does NOT run R/Stata/Python — this is a template / pattern test.
// Run in the browser console:
//   import("/src/services/export/__validation__/exportValidation.js")
//     .then(m => window.__validateExports = m.validateExports)
//   window.__validateExports()
//
// Or set window.__validateExports in DevTools after first import.

import { generateRScript }     from "../rScript.js";
import { generateStataScript } from "../stataScript.js";
import { generatePythonScript } from "../pythonScript.js";

// ─── Shared dummy dataset config ─────────────────────────────────────────────
const FILENAME = "data.csv";
const PIPELINE = [];  // no pipeline steps — isolates model emit

// ─── Per-estimator test configs ───────────────────────────────────────────────
// Each entry: { type, model, expectedR, expectedStata, expectedPython }
// expectedXxx: string that must appear in the generated script (case-sensitive)

const ESTIMATOR_TESTS = [
  {
    type: "OLS",
    model: { type: "OLS", yVar: "wage", xVars: ["educ", "exp"], wVars: [], zVars: [] },
    expectedR:      "feols",
    expectedStata:  "reg wage",
    expectedPython: "smf.ols",
  },
  {
    type: "WLS",
    model: { type: "WLS", yVar: "wage", xVars: ["educ", "exp"], wVars: [], zVars: [], weightCol: "wgt" },
    expectedR:      "weights = ~wgt",
    expectedStata:  "[aw=wgt]",
    expectedPython: "smf.wls",
  },
  {
    type: "FE",
    model: { type: "FE", yVar: "wage", xVars: ["educ"], wVars: [], entityCol: "firm", timeCol: "year" },
    expectedR:      "feols",
    expectedStata:  "xtreg",
    expectedPython: "PanelOLS",
  },
  {
    type: "FD",
    model: { type: "FD", yVar: "wage", xVars: ["educ"], wVars: [], entityCol: "firm", timeCol: "year" },
    expectedR:      "plm",
    expectedStata:  "xtreg",
    expectedPython: "FirstDifferenceOLS",
  },
  {
    type: "TWFE",
    model: { type: "TWFE", yVar: "wage", xVars: ["educ"], wVars: [], entityCol: "firm", timeCol: "year" },
    expectedR:      "feols",
    expectedStata:  "reghdfe",
    expectedPython: "PanelOLS",
  },
  {
    type: "DiD",
    model: { type: "DiD", yVar: "wage", xVars: ["educ"], wVars: [], postVar: "post", treatVar: "treat" },
    expectedR:      "feols",
    expectedStata:  "reg",
    expectedPython: "smf",
  },
  {
    type: "2SLS",
    model: { type: "2SLS", yVar: "wage", xVars: ["educ"], wVars: ["exp"], zVars: ["dist"], entityCol: null },
    expectedR:      "feols",
    expectedStata:  "ivregress 2sls",
    expectedPython: "IV2SLS",
  },
  {
    type: "RDD",
    model: { type: "RDD", yVar: "outcome", xVars: [], wVars: [], runningVar: "score", cutoff: 50, bandwidth: 10, kernel: "triangular" },
    expectedR:      "rdrobust",
    expectedStata:  "rdrobust",
    expectedPython: "rdrobust",
  },
  {
    type: "FuzzyRDD",
    model: { type: "FuzzyRDD", yVar: "outcome", xVars: [], wVars: [], runningVar: "score", cutoff: 50, bandwidth: 10, treatVar: "D", kernel: "triangular" },
    expectedR:      "rdrobust",
    expectedStata:  "rdrobust",
    expectedPython: "rdrobust",
  },
  {
    type: "SpatialRDD",
    model: { type: "SpatialRDD", yVar: "outcome", xVars: [], wVars: [], distCol: "dist_km", treatmentCol: "treated", bandwidth: 5, kernel: "triangular" },
    expectedR:      "_signed_dist",
    expectedStata:  "_signed_dist",
    expectedPython: "_signed_dist",
  },
  {
    type: "McCrary",
    model: { type: "McCrary", yVar: "outcome", xVars: [], wVars: [], runningVar: "score", cutoff: 0 },
    expectedR:      "rddensity",
    expectedStata:  "rddensity",
    expectedPython: "rddensity",
  },
  {
    type: "Logit",
    model: { type: "Logit", yVar: "employed", xVars: ["educ", "exp"], wVars: [] },
    expectedR:      "glm",
    expectedStata:  "logit",
    expectedPython: "smf.logit",
  },
  {
    type: "Probit",
    model: { type: "Probit", yVar: "employed", xVars: ["educ", "exp"], wVars: [] },
    expectedR:      "glm",
    expectedStata:  "probit",
    expectedPython: "smf.probit",
  },
  {
    type: "GMM",
    model: { type: "GMM", yVar: "wage", xVars: ["educ"], wVars: ["exp"], zVars: ["dist"] },
    expectedR:      "gmm::gmm",
    expectedStata:  "ivregress gmm",
    expectedPython: "IVGMM",
  },
  {
    type: "LIML",
    model: { type: "LIML", yVar: "wage", xVars: ["educ"], wVars: ["exp"], zVars: ["dist"] },
    expectedR:      "ivreg::ivreg",
    expectedStata:  "ivregress liml",
    expectedPython: "IVLIML",
  },
  {
    type: "LSDV",
    model: { type: "LSDV", yVar: "wage", xVars: ["educ"], wVars: [], entityCol: "firm", timeCol: "year" },
    expectedR:      "feols",
    expectedStata:  "xtreg",
    expectedPython: "PanelOLS",
  },
  {
    type: "PoissonFE",
    model: { type: "PoissonFE", yVar: "count", xVars: ["pop"], wVars: [], entityCol: "region" },
    expectedR:      "fepois",
    expectedStata:  "ppmlhdfe",
    expectedPython: "fepois",
  },
  {
    type: "EventStudy",
    model: { type: "EventStudy", yVar: "wage", xVars: [], wVars: [], entityCol: "firm", timeCol: "year", treatVar: "treat", treatTimeCol: "treat_time", kPre: 3, kPost: 3 },
    expectedR:      "feols",
    expectedStata:  "reghdfe",
    expectedPython: "PanelOLS",
  },
  {
    type: "SyntheticControl",
    model: { type: "SyntheticControl", yVar: "gdp", xVars: ["invest"], wVars: [], entityCol: "country", timeCol: "year", treatedUnit: "Germany", treatTime: 1990 },
    expectedR:      "synth",
    expectedStata:  "synth",
    expectedPython: "Synth",
  },
];

// ─── Runner ───────────────────────────────────────────────────────────────────

function runTest(test) {
  const { type, model, expectedR, expectedStata, expectedPython } = test;
  const cfg = { filename: FILENAME, pipeline: PIPELINE, model };

  const results = { type, R: null, Stata: null, Python: null };
  const errors  = [];

  // R
  try {
    const raw = generateRScript(cfg);
    const script = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
    const pass = script.length > 0 && script.includes(expectedR);
    results.R = pass ? "PASS" : `FAIL (expected "${expectedR}")`;
    if (!pass) errors.push(`R: ${results.R}\n  snippet: ${script.slice(0, 200)}`);
  } catch (e) {
    results.R = `ERROR: ${e.message}`;
    errors.push(`R: ${results.R}`);
  }

  // Stata
  try {
    const raw = generateStataScript(cfg);
    const script = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
    const pass = script.length > 0 && script.includes(expectedStata);
    results.Stata = pass ? "PASS" : `FAIL (expected "${expectedStata}")`;
    if (!pass) errors.push(`Stata: ${results.Stata}\n  snippet: ${script.slice(0, 200)}`);
  } catch (e) {
    results.Stata = `ERROR: ${e.message}`;
    errors.push(`Stata: ${results.Stata}`);
  }

  // Python
  try {
    const raw = generatePythonScript(cfg);
    const script = Array.isArray(raw) ? raw.join("\n") : String(raw ?? "");
    const pass = script.length > 0 && script.includes(expectedPython);
    results.Python = pass ? "PASS" : `FAIL (expected "${expectedPython}")`;
    if (!pass) errors.push(`Python: ${results.Python}\n  snippet: ${script.slice(0, 200)}`);
  } catch (e) {
    results.Python = `ERROR: ${e.message}`;
    errors.push(`Python: ${results.Python}`);
  }

  results.ok = errors.length === 0;
  results.errors = errors;
  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function validateExports() {
  const results = ESTIMATOR_TESTS.map(runTest);
  const passed  = results.filter(r => r.ok).length;
  const failed  = results.filter(r => !r.ok);

  // Console table
  console.group(`%cExport Validation — ${passed}/${results.length} passed`, passed === results.length ? "color: #6ec8b4" : "color: #c8a96e");
  console.table(
    Object.fromEntries(results.map(r => [r.type, { R: r.R, Stata: r.Stata, Python: r.Python }]))
  );
  if (failed.length) {
    console.group("Failures");
    failed.forEach(r => {
      console.group(r.type);
      r.errors.forEach(e => console.error(e));
      console.groupEnd();
    });
    console.groupEnd();
  }
  console.groupEnd();

  return { passed, total: results.length, failed: failed.map(r => r.type), results };
}

// Auto-attach to window when loaded in browser
if (typeof window !== "undefined") {
  window.__validateExports = validateExports;
  console.log("[exportValidation] Ready — run window.__validateExports() to validate all emitters.");
}
