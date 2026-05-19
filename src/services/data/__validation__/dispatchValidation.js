// ─── ECON STUDIO · src/services/data/__validation__/dispatchValidation.js ──────
// Assertion harness for the Fase 0 dispatch system. Mirrors the pattern in
// src/math/__validation__/engineValidation.js: plain JS, prints pass/fail to
// console, returns boolean. Run via dispatchValidation.runner.js or import
// directly in browser DevTools.

import * as cfg from "../dispatchConfig.js";
import { logEstimate, getEntries, clearLog, measure } from "../perfLog.js";
import { createSuffStatsCache, makeCacheKey, validateSuffStatsEntry } from "../suffStatsCache.js";
import { shouldUseSQLPath } from "../duckdbDispatch.js";

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
  check("SQL_SUPPORTED_SE has HC0", cfg.SQL_SUPPORTED_SE.has("HC0"));
  check("SQL_SUPPORTED_SE has HC3", cfg.SQL_SUPPORTED_SE.has("HC3"));
  check("SQL_SUPPORTED_SE does not have clustered", !cfg.SQL_SUPPORTED_SE.has("clustered"));
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

function validateSuffStatsCache() {
  console.log("\n[suffStatsCache]");
  const c = createSuffStatsCache(3);
  check("new cache size 0", c.size() === 0);

  c.set("a", { v: 1 });
  c.set("b", { v: 2 });
  check("get hit returns value", c.get("a")?.v === 1);
  check("get miss returns null", c.get("z") === null);
  check("size reflects entries", c.size() === 2);

  // LRU canonical test: fill cache to capacity, touch one entry, add one more,
  // verify the untouched-oldest got evicted and the touched one survives.
  // After previous get("a"), order is [b, a]. Add c → cache full at 3: [b, a, c].
  c.set("c", { v: 3 });
  check("size capped at maxEntries", c.size() === 3);
  c.get("a");                  // touch a → order: [b, c, a]
  c.set("d", { v: 4 });        // overflow → evict oldest (b). order: [c, a, d]
  check("LRU evicts oldest unused (b)", c.get("b") === null);
  check("LRU keeps recently used (a)",  c.get("a")?.v === 1);
  check("LRU keeps newest (d)",         c.get("d")?.v === 4);

  c.invalidate();
  check("invalidate clears cache", c.size() === 0);

  // Cache key
  check("makeCacheKey deterministic across xCols order",
    makeCacheKey("t", "y", ["b", "a"]) === makeCacheKey("t", "y", ["a", "b"]));
  check("makeCacheKey distinguishes tables",
    makeCacheKey("t1", "y", ["x"]) !== makeCacheKey("t2", "y", ["x"]));
  check("makeCacheKey distinguishes y",
    makeCacheKey("t", "y1", ["x"]) !== makeCacheKey("t", "y2", ["x"]));

  // Entry validation
  const goodEntry = { XtX: [[1,2],[3,4]], n: 100 };
  check("validateSuffStatsEntry accepts matching dim (k=1)",
    validateSuffStatsEntry(goodEntry, ["x1"]));
  check("validateSuffStatsEntry rejects mismatched dim",
    !validateSuffStatsEntry(goodEntry, ["x1", "x2"]));
  check("validateSuffStatsEntry rejects null",
    !validateSuffStatsEntry(null, ["x1"]));
  check("validateSuffStatsEntry rejects missing XtX",
    !validateSuffStatsEntry({ n: 100 }, ["x1"]));
}

function validateDispatch() {
  console.log("\n[duckdbDispatch]");
  const baseCtx = {
    tableName:       "data_abc",
    n:               100_000,
    xColsExpanded:   ["x1", "x2"],
    estimator:       "OLS",
    seType:          "classical",
    hasWeights:      false,
    hasFactors:      false,
  };
  check("baseline (large OLS classical) → true", shouldUseSQLPath(baseCtx) === true);
  check("no tableName → false",
    shouldUseSQLPath({ ...baseCtx, tableName: null }) === false);
  check("n below threshold → false",
    shouldUseSQLPath({ ...baseCtx, n: 10_000 }) === false);
  check("n exactly at threshold → true",
    shouldUseSQLPath({ ...baseCtx, n: 50_000 }) === true);
  check("k above threshold → false",
    shouldUseSQLPath({ ...baseCtx, xColsExpanded: new Array(150).fill("x") }) === false);
  check("k exactly at threshold → true",
    shouldUseSQLPath({ ...baseCtx, xColsExpanded: new Array(100).fill("x") }) === true);
  check("unsupported estimator (FE) → false",
    shouldUseSQLPath({ ...baseCtx, estimator: "FE" }) === false);
  check("HC0 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC0" }) === true);
  check("HC1 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC1" }) === true);
  check("HC2 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC2" }) === true);
  check("HC3 → true", shouldUseSQLPath({ ...baseCtx, seType: "HC3" }) === true);
  check("clustered → false (Fase 2)",
    shouldUseSQLPath({ ...baseCtx, seType: "clustered" }) === false);
  check("hasWeights=true → false",
    shouldUseSQLPath({ ...baseCtx, hasWeights: true }) === false);
  check("hasFactors=true → true (Fase 1)",
    shouldUseSQLPath({ ...baseCtx, hasFactors: true }) === true);
  check("seType undefined defaults to classical → true",
    shouldUseSQLPath({ ...baseCtx, seType: undefined }) === true);
}

export async function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  await validatePerfLog();
  validateSuffStatsCache();
  validateDispatch();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
