// ─── ECON STUDIO · src/services/data/__validation__/dispatchValidation.js ──────
// Assertion harness for the Fase 0 dispatch system. Mirrors the pattern in
// src/math/__validation__/engineValidation.js: plain JS, prints pass/fail to
// console, returns boolean. Run via dispatchValidation.runner.js or import
// directly in browser DevTools.

import * as cfg from "../dispatchConfig.js";

let passes = 0, fails = 0;
function check(name, cond) {
  if (cond) { passes++; console.log(`  ✓ ${name}`); }
  else      { fails++;  console.error(`  ✗ ${name}`); }
}

function validateConfig() {
  console.log("\n[dispatchConfig]");
  check("N_THRESHOLD = 50_000",         cfg.N_THRESHOLD === 50_000);
  check("K_THRESHOLD = 100",            cfg.K_THRESHOLD === 100);
  check("RESIDUAL_SAMPLE_SIZE = 5_000", cfg.RESIDUAL_SAMPLE_SIZE === 5_000);
  check("CACHE_MAX_ENTRIES = 50",       cfg.CACHE_MAX_ENTRIES === 50);
  check("SQL_SUPPORTED_ESTIMATORS has OLS", cfg.SQL_SUPPORTED_ESTIMATORS.has("OLS"));
  check("SQL_SUPPORTED_SE has classical",   cfg.SQL_SUPPORTED_SE.has("classical"));
  check("SQL_SUPPORTED_SE does not have HC1", !cfg.SQL_SUPPORTED_SE.has("HC1"));
}

export function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
