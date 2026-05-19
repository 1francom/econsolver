// ─── ECON STUDIO · src/services/data/__validation__/dispatchValidation.js ──────
// Assertion harness for the Fase 0 dispatch system. Mirrors the pattern in
// src/math/__validation__/engineValidation.js: plain JS, prints pass/fail to
// console, returns boolean. Run via dispatchValidation.runner.js or import
// directly in browser DevTools.

import * as cfg from "../dispatchConfig.js";
import { logEstimate, getEntries, clearLog, measure } from "../perfLog.js";

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

async function validatePerfLog() {
  console.log("\n[perfLog]");
  clearLog();
  check("clearLog leaves empty", getEntries().length === 0);

  logEstimate({ path: "sql", n: 100_000, msTotal: 42 });
  const e1 = getEntries();
  check("logEstimate appends one entry", e1.length === 1);
  check("entry has ts (number)", typeof e1[0].ts === "number");
  check("entry preserves path", e1[0].path === "sql");
  check("entry preserves msTotal", e1[0].msTotal === 42);

  // Ring buffer caps at 50
  clearLog();
  for (let i = 0; i < 60; i++) logEstimate({ i });
  const e2 = getEntries();
  check("ring buffer caps at 50", e2.length === 50);
  check("oldest entries evicted (first = i=10)", e2[0].i === 10);
  check("most recent kept (last = i=59)", e2[e2.length - 1].i === 59);

  // measure() returns {result, ms}
  const m = await measure(async () => { return 99; });
  check("measure returns result", m.result === 99);
  check("measure returns ms (number)", typeof m.ms === "number");
  check("measure ms >= 0", m.ms >= 0);

  // getEntries returns a snapshot, not the live buffer
  clearLog();
  logEstimate({ x: 1 });
  const snap = getEntries();
  logEstimate({ x: 2 });
  check("getEntries returns snapshot copy", snap.length === 1);
}

export async function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  await validatePerfLog();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
