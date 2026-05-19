# DuckDB Fase 0 — Dispatcher, Cache, perfLog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ad-hoc OLS SQL gate in `ModelingTab.jsx` with a single `shouldUseSQLPath()` dispatcher, add a suff-stats cache, and add per-estimate performance instrumentation. No new estimators yet — Fase 0 is foundation only.

**Architecture:** Three new pure-JS modules under `src/services/data/` (no DuckDB-Wasm imports — they're testable standalone in Node): `dispatchConfig.js` (constants), `perfLog.js` (ring buffer + `measure`), `suffStatsCache.js` (LRU cache factory), `duckdbDispatch.js` (`shouldUseSQLPath`). One modified file: `ModelingTab.jsx:1700-1751` — replace the existing ad-hoc gate with a call to `shouldUseSQLPath`, wrap the SQL pass with `measure` and the cache, expose `window.__perfLog` for inspection. Tests live in `src/services/data/__validation__/dispatchValidation.js`, runnable from Node via a small runner script (matches existing `engineValidation.js` convention).

**Tech Stack:** ES modules (Node 18+ for the validation runner), React 19 hooks (`useRef`, `useEffect`), no test framework added — assertion harness modeled on existing `engineValidation.js`.

---

## File Structure

**Create:**
- `src/services/data/dispatchConfig.js` — exported constants (N_THRESHOLD, K_THRESHOLD, supported sets)
- `src/services/data/perfLog.js` — ring buffer + `measure()` async helper + `getEntries()` / `clearLog()`
- `src/services/data/suffStatsCache.js` — `createSuffStatsCache()` factory, `makeCacheKey()`, `validateSuffStatsEntry()`
- `src/services/data/duckdbDispatch.js` — `shouldUseSQLPath(ctx)` single-gate function
- `src/services/data/__validation__/dispatchValidation.js` — assertion harness with `check()` + per-module validators + `runDispatchValidation()`
- `src/services/data/__validation__/dispatchValidation.runner.js` — Node entry point

**Modify:**
- `src/components/ModelingTab.jsx` — replace lines 1710-1734 (ad-hoc gate + SQL pass) with dispatcher + cache + measure wrapping

---

## Task 1: Constants in `dispatchConfig.js`

**Files:**
- Create: `src/services/data/dispatchConfig.js`
- Create: `src/services/data/__validation__/dispatchValidation.js`
- Create: `src/services/data/__validation__/dispatchValidation.runner.js`

- [ ] **Step 1: Create `dispatchConfig.js`**

Create file with this exact content:

```js
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
// Fase 2: + cluster, twoway, HAC
export const SQL_SUPPORTED_ESTIMATORS = new Set(["OLS"]);
export const SQL_SUPPORTED_SE         = new Set(["classical"]);
```

- [ ] **Step 2: Create `dispatchValidation.runner.js`**

Create file with this exact content:

```js
// Node entry point for the dispatch validation harness.
// Run: node src/services/data/__validation__/dispatchValidation.runner.js
import { runDispatchValidation } from "./dispatchValidation.js";
const ok = runDispatchValidation();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Create `dispatchValidation.js` with config tests only**

Create file with this exact content:

```js
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
```

- [ ] **Step 4: Run the runner and verify it passes**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected output (exit code 0):
```
[dispatchConfig]
  ✓ N_THRESHOLD = 50_000
  ✓ K_THRESHOLD = 100
  ✓ RESIDUAL_SAMPLE_SIZE = 5_000
  ✓ CACHE_MAX_ENTRIES = 50
  ✓ SQL_SUPPORTED_ESTIMATORS has OLS
  ✓ SQL_SUPPORTED_SE has classical
  ✓ SQL_SUPPORTED_SE does not have HC1

7 passed, 0 failed
```

- [ ] **Step 5: Commit**

```bash
git add src/services/data/dispatchConfig.js src/services/data/__validation__/dispatchValidation.js src/services/data/__validation__/dispatchValidation.runner.js
git commit -m "$(cat <<'EOF'
feat(data): Fase 0 — dispatch config constants + validation scaffolding

Adds N_THRESHOLD=50_000, K_THRESHOLD=100, CACHE_MAX_ENTRIES=50,
RESIDUAL_SAMPLE_SIZE=5_000, and the SQL-supported estimator/SE sets
(Fase 0 = {OLS}/{classical}; grows per fase). Adds the Node-runnable
validation harness mirroring engineValidation.js convention.

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: `perfLog.js` — ring buffer + `measure()`

**Files:**
- Create: `src/services/data/perfLog.js`
- Modify: `src/services/data/__validation__/dispatchValidation.js` (add `validatePerfLog`)

- [ ] **Step 1: Create `perfLog.js` as a stub that throws**

Create file with this exact content:

```js
// ─── ECON STUDIO · src/services/data/perfLog.js ────────────────────────────────
// Stub — implementation in step 4.
export function logEstimate() { throw new Error("logEstimate not implemented"); }
export function getEntries()  { throw new Error("getEntries not implemented");  }
export function clearLog()    { throw new Error("clearLog not implemented");    }
export function measure()     { throw new Error("measure not implemented");     }
```

- [ ] **Step 2: Add `validatePerfLog` to `dispatchValidation.js`**

Edit `src/services/data/__validation__/dispatchValidation.js`. Change:

```js
import * as cfg from "../dispatchConfig.js";
```

to:

```js
import * as cfg from "../dispatchConfig.js";
import { logEstimate, getEntries, clearLog, measure } from "../perfLog.js";
```

Then, just before the `export function runDispatchValidation()` line, add this new function:

```js
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
```

Then update `runDispatchValidation` to call it. Change:

```js
export function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

to:

```js
export async function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  await validatePerfLog();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

Also update `dispatchValidation.runner.js`. Change:

```js
const ok = runDispatchValidation();
process.exit(ok ? 0 : 1);
```

to:

```js
const ok = await runDispatchValidation();
process.exit(ok ? 0 : 1);
```

- [ ] **Step 3: Run validation and confirm perfLog tests FAIL**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: config tests pass, then perfLog tests print errors and process exits with code 1. Error messages will include `"clearLog not implemented"` from the stubs.

- [ ] **Step 4: Replace `perfLog.js` stub with real implementation**

Overwrite `src/services/data/perfLog.js` with this exact content:

```js
// ─── ECON STUDIO · src/services/data/perfLog.js ────────────────────────────────
// Per-estimate performance ring buffer + measure() helper.
//
// Used by ModelingTab to record path (sql|js), n, k, seType, and timing for
// each estimation. Hidden from normal users — surfaced via window.__perfLog
// (set up in ModelingTab) for inspection in DevTools.

const BUFFER_MAX = 50;
const buffer = [];

// Use globalThis.performance if available (Node 16+, all browsers); fall back
// to Date.now() which is millisecond-resolution but always present.
const nowFn = (globalThis.performance && typeof globalThis.performance.now === "function")
  ? () => globalThis.performance.now()
  : () => Date.now();

export function logEstimate(entry) {
  buffer.push({ ts: nowFn(), ...entry });
  while (buffer.length > BUFFER_MAX) buffer.shift();
}

export function getEntries() {
  return buffer.slice();
}

export function clearLog() {
  buffer.length = 0;
}

// Wrap an async fn, return { result, ms }. The caller decides whether to log.
export async function measure(fn) {
  const start = nowFn();
  const result = await fn();
  return { result, ms: nowFn() - start };
}
```

- [ ] **Step 5: Run validation and confirm all tests PASS**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: all config and perfLog tests pass, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/data/perfLog.js src/services/data/__validation__/dispatchValidation.js src/services/data/__validation__/dispatchValidation.runner.js
git commit -m "$(cat <<'EOF'
feat(data): Fase 0 — perfLog ring buffer + measure() helper

Per-estimate performance log: 50-entry ring buffer, measure() wraps an
async fn and returns {result, ms}. Used by ModelingTab to record path
(sql|js), n, k, seType, msTotal per estimation. Inspection via
window.__perfLog (wired in next task).

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `suffStatsCache.js` — LRU factory + key helper + entry validator

**Files:**
- Create: `src/services/data/suffStatsCache.js`
- Modify: `src/services/data/__validation__/dispatchValidation.js` (add `validateSuffStatsCache`)

- [ ] **Step 1: Create `suffStatsCache.js` as a stub that throws**

Create file with this exact content:

```js
// ─── ECON STUDIO · src/services/data/suffStatsCache.js ─────────────────────────
// Stub — implementation in step 4.
export function createSuffStatsCache() { throw new Error("createSuffStatsCache not implemented"); }
export function makeCacheKey()         { throw new Error("makeCacheKey not implemented"); }
export function validateSuffStatsEntry() { throw new Error("validateSuffStatsEntry not implemented"); }
```

- [ ] **Step 2: Add `validateSuffStatsCache` to `dispatchValidation.js`**

Edit `src/services/data/__validation__/dispatchValidation.js`. Add to the import block:

```js
import { createSuffStatsCache, makeCacheKey, validateSuffStatsEntry } from "../suffStatsCache.js";
```

Add this new function before `runDispatchValidation`:

```js
function validateSuffStatsCache() {
  console.log("\n[suffStatsCache]");
  const c = createSuffStatsCache(3);
  check("new cache size 0", c.size() === 0);

  c.set("a", { v: 1 });
  c.set("b", { v: 2 });
  check("get hit returns value", c.get("a")?.v === 1);
  check("get miss returns null", c.get("z") === null);
  check("size reflects entries", c.size() === 2);

  // LRU: after accessing "a", inserting d,e,f should evict b first (oldest unused)
  c.get("a");                  // a now most-recent
  c.set("c", { v: 3 });
  c.set("d", { v: 4 });        // size=3
  c.set("e", { v: 5 });        // evicts b (oldest)
  check("LRU evicts oldest unused (b)", c.get("b") === null);
  check("LRU keeps recently used (a)",  c.get("a")?.v === 1);

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
```

Add call inside `runDispatchValidation`:

```js
export async function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  await validatePerfLog();
  validateSuffStatsCache();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

- [ ] **Step 3: Run validation and confirm cache tests FAIL**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: config + perfLog pass; cache tests throw `"createSuffStatsCache not implemented"`; exit code 1.

- [ ] **Step 4: Replace `suffStatsCache.js` stub with real implementation**

Overwrite `src/services/data/suffStatsCache.js` with this exact content:

```js
// ─── ECON STUDIO · src/services/data/suffStatsCache.js ─────────────────────────
// LRU cache for sufficient statistics (X'X, X'Y, Y'Y, β, Ainv, …) keyed by
// (tableName, yCol, sorted xCols). Held in a useRef inside ModelingTab — not
// persisted to IndexedDB. Invalidated on any pipeline / dataset change.
//
// `seType` is NOT part of the key: suff stats don't depend on SE choice;
// only the meat pass does. Flipping classical→HC1 reuses cached β/Ainv.

/**
 * @param {number} maxEntries  LRU eviction threshold (default 50)
 * @returns cache instance with get/set/invalidate/size
 */
export function createSuffStatsCache(maxEntries = 50) {
  const map = new Map();
  return {
    get(key) {
      if (!map.has(key)) return null;
      const v = map.get(key);
      // LRU: re-insert to mark most-recently used
      map.delete(key);
      map.set(key, v);
      return v;
    },
    set(key, value) {
      if (map.has(key)) map.delete(key);
      map.set(key, value);
      while (map.size > maxEntries) {
        const oldestKey = map.keys().next().value;
        map.delete(oldestKey);
      }
    },
    invalidate() {
      map.clear();
    },
    size() {
      return map.size;
    },
  };
}

/** Deterministic key from (tableName, yCol, xCols). Order of xCols irrelevant. */
export function makeCacheKey(tableName, yCol, xCols) {
  const sorted = [...xCols].sort();
  return `${tableName}|${yCol}|${sorted.join(",")}`;
}

/** Defensive check: dim of XtX must match k+1 (k = xCols.length). */
export function validateSuffStatsEntry(entry, xCols) {
  if (!entry || !entry.XtX) return false;
  if (entry.XtX.length !== xCols.length + 1) return false;
  return true;
}
```

- [ ] **Step 5: Run validation and confirm all tests PASS**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: config + perfLog + suffStatsCache all pass, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/data/suffStatsCache.js src/services/data/__validation__/dispatchValidation.js
git commit -m "$(cat <<'EOF'
feat(data): Fase 0 — suff-stats LRU cache + cache key + entry validator

createSuffStatsCache(maxEntries=50) returns a Map-backed LRU cache.
makeCacheKey(table, y, xCols) is order-insensitive on xCols since
xCols.sort() is applied. validateSuffStatsEntry guards against
mismatched dimensions (race condition between pipeline change and
cached read).

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `duckdbDispatch.js` — `shouldUseSQLPath(ctx)`

**Files:**
- Create: `src/services/data/duckdbDispatch.js`
- Modify: `src/services/data/__validation__/dispatchValidation.js` (add `validateDispatch`)

- [ ] **Step 1: Create `duckdbDispatch.js` as a stub that throws**

Create file with this exact content:

```js
// ─── ECON STUDIO · src/services/data/duckdbDispatch.js ─────────────────────────
// Stub — implementation in step 4.
export function shouldUseSQLPath() { throw new Error("shouldUseSQLPath not implemented"); }
```

- [ ] **Step 2: Add `validateDispatch` to `dispatchValidation.js`**

Edit `src/services/data/__validation__/dispatchValidation.js`. Add to imports:

```js
import { shouldUseSQLPath } from "../duckdbDispatch.js";
```

Add this new function before `runDispatchValidation`:

```js
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
  check("unsupported seType (HC1) → false",
    shouldUseSQLPath({ ...baseCtx, seType: "HC1" }) === false);
  check("hasWeights=true → false",
    shouldUseSQLPath({ ...baseCtx, hasWeights: true }) === false);
  check("hasFactors=true → false",
    shouldUseSQLPath({ ...baseCtx, hasFactors: true }) === false);
  check("seType undefined defaults to classical → true",
    shouldUseSQLPath({ ...baseCtx, seType: undefined }) === true);
}
```

Add call inside `runDispatchValidation`:

```js
export async function runDispatchValidation() {
  passes = 0; fails = 0;
  validateConfig();
  await validatePerfLog();
  validateSuffStatsCache();
  validateDispatch();
  console.log(`\n${passes} passed, ${fails} failed`);
  return fails === 0;
}
```

- [ ] **Step 3: Run validation and confirm dispatch tests FAIL**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected: previous suites pass; dispatch tests throw `"shouldUseSQLPath not implemented"`; exit code 1.

- [ ] **Step 4: Replace `duckdbDispatch.js` stub with real implementation**

Overwrite `src/services/data/duckdbDispatch.js` with this exact content:

```js
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
  if (ctx.hasFactors) return false;
  return true;
}
```

- [ ] **Step 5: Run validation and confirm all tests PASS**

Run: `node src/services/data/__validation__/dispatchValidation.runner.js`
Expected output ends with: `XX passed, 0 failed`, exit code 0.

- [ ] **Step 6: Commit**

```bash
git add src/services/data/duckdbDispatch.js src/services/data/__validation__/dispatchValidation.js
git commit -m "$(cat <<'EOF'
feat(data): Fase 0 — shouldUseSQLPath single dispatcher

Replaces the ad-hoc gate scattered in ModelingTab.estimate (Fase 0 wiring
in the next commit). Cheap checks first: tableName → n ≥ N_THRESHOLD →
k ≤ K_THRESHOLD → estimator in supported set → seType supported →
no weights → no factors. Any failure returns false (silent fallback to
JS path).

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Wire dispatcher + cache + perfLog into `ModelingTab.jsx`

**Files:**
- Modify: `src/components/ModelingTab.jsx` (imports block + `estimate` callback at lines ~1700-1751)

- [ ] **Step 1: Add imports to `ModelingTab.jsx`**

Open `src/components/ModelingTab.jsx`. Find the import line:

```js
import { buildOLSSuffStats }    from "../services/data/duckdbOLS.js";
```

Replace it with:

```js
import { buildOLSSuffStats }    from "../services/data/duckdbOLS.js";
import { shouldUseSQLPath }     from "../services/data/duckdbDispatch.js";
import { createSuffStatsCache, makeCacheKey, validateSuffStatsEntry } from "../services/data/suffStatsCache.js";
import { logEstimate, measure, getEntries, clearLog } from "../services/data/perfLog.js";
import { CACHE_MAX_ENTRIES }    from "../services/data/dispatchConfig.js";
```

Also make sure `useRef` and `useEffect` are imported from React. Find the existing React import line near the top of the file. If `useRef` or `useEffect` is missing, add it to that line (do not duplicate).

- [ ] **Step 2: Instantiate the cache and wire perfLog inspection**

Inside the `ModelingTab` component function, after the existing `useState` declarations (anywhere safe — before the `estimate` useCallback definition), add this block:

```js
  // ── Fase 0: suff-stats cache + perfLog inspection ──────────────────────────
  const suffStatsCacheRef = useRef(createSuffStatsCache(CACHE_MAX_ENTRIES));

  // Invalidate cache whenever the cleaned dataset reference changes (pipeline
  // re-runs produce a fresh _duckdb.tableName, so the old suff stats are stale).
  useEffect(() => {
    suffStatsCacheRef.current.invalidate();
  }, [cleanedData]);

  // Expose perfLog on window for DevTools inspection. Hidden from normal users.
  useEffect(() => {
    if (typeof window !== "undefined") {
      window.__perfLog = { getEntries, clearLog };
    }
  }, []);
```

- [ ] **Step 3: Replace the ad-hoc SQL gate with `shouldUseSQLPath` + cache + measure**

Open `src/components/ModelingTab.jsx`. Locate the `estimate` useCallback body (currently around lines 1700-1751). Find this exact block:

```js
      const duckTable = cleanedData?._duckdb?.tableName;
      const rowCount  = cleanedData?._duckdb?.rowCount ?? 0;

      // ── Fast path: DuckDB sufficient-statistics OLS ────────────────────────
      // SQL computes X'X, X'Y, Y'Y, n; JS only does the inversion + scaling.
      // Avoids materializing the full dataset into JS memory.
      // Gated to plain OLS — no weights, no factor expansion, classical SE.
      const wantSuffStats =
        duckTable &&
        rowCount > rows.length &&            // full data not already in memory
        model === "OLS" &&
        !weightVar[0] &&
        factorVars.size === 0 &&
        (!seType || seType === "classical");

      if (wantSuffStats && yVar[0] && (xVars.length + wVars.length) > 0) {
        try {
          const allX = [...xVars, ...wVars];
          const suff = await buildOLSSuffStats(duckTable, yVar[0], allX);
          const raw  = runOLSFromSuffStats(suff);
          if (raw) {
            const wrapped = wrapResult("OLS", raw, {
              yVar: yVar[0], xVars, wVars, weightCol: null,
            });
            setResult(wrapped);
            return;
          }
          // raw === null → singular X'X or n < k; fall through to full extraction
        } catch (e) {
          console.warn("[ModelingTab] DuckDB suff-stats path failed, falling back to full extraction:", e);
        }
      }
```

Replace it with this exact block:

```js
      const duckTable = cleanedData?._duckdb?.tableName;
      const rowCount  = cleanedData?._duckdb?.rowCount ?? 0;
      const allX      = (yVar[0] && (xVars.length + wVars.length) > 0)
        ? [...xVars, ...wVars]
        : [];

      // ── Fase 0 dispatcher: single gate decides SQL suff-stats vs JS path ───
      const dispatchCtx = {
        tableName:     duckTable ?? null,
        n:             rowCount,
        xColsExpanded: allX,
        estimator:     model,
        seType:        seType ?? "classical",
        hasWeights:    !!weightVar[0],
        hasFactors:    factorVars.size > 0,
      };

      if (allX.length > 0 && shouldUseSQLPath(dispatchCtx) && rowCount > rows.length) {
        const cache = suffStatsCacheRef.current;
        const key   = makeCacheKey(duckTable, yVar[0], allX);
        try {
          const { result: wrapped, ms: msTotal } = await measure(async () => {
            let cached = cache.get(key);
            if (cached && !validateSuffStatsEntry(cached, allX)) {
              cache.invalidate();
              cached = null;
            }
            const suff = cached ?? await buildOLSSuffStats(duckTable, yVar[0], allX);
            if (!cached) cache.set(key, suff);
            const raw = runOLSFromSuffStats(suff);
            if (!raw) return null;  // singular X'X — fall through to JS path
            return wrapResult("OLS", raw, {
              yVar: yVar[0], xVars, wVars, weightCol: null,
            });
          });
          if (wrapped) {
            logEstimate({
              path:      "sql",
              estimator: model,
              n:         rowCount,
              k:         allX.length,
              seType:    "classical",
              msTotal,
              cached:    !!cache.get(key),
            });
            setResult(wrapped);
            return;
          }
          // wrapped === null → singular; fall through
        } catch (e) {
          console.warn("[ModelingTab] DuckDB suff-stats path failed, falling back to JS path:", e);
          logEstimate({
            path:      "sql",
            estimator: model,
            n:         rowCount,
            k:         allX.length,
            seType:    "classical",
            sqlFailed: true,
            error:     String(e?.message ?? e),
          });
        }
      }
```

- [ ] **Step 4: Instrument the JS fallback path**

Still in the `estimate` callback, find this block:

```js
      // ── Standard path: extract full rows into JS, run engine ───────────────
      // For DuckDB datasets, `rows` is only a 500-row preview.
      let estimationRows = rows;
      if (duckTable && rows.length < (rowCount || Infinity)) {
        estimationRows = await extractAllRows(duckTable);
      }
      const out = _runEstimation(estimationRows);
      if (out.error) { setErr(out.error); }
      else { setResult(out.result); setPanelFE(out.panelFE ?? null); setPanelFD(out.panelFD ?? null); }
```

Replace it with this exact block:

```js
      // ── Standard path: extract full rows into JS, run engine ───────────────
      // For DuckDB datasets, `rows` is only a 500-row preview.
      const { result: out, ms: msTotal } = await measure(async () => {
        let estimationRows = rows;
        if (duckTable && rows.length < (rowCount || Infinity)) {
          estimationRows = await extractAllRows(duckTable);
        }
        return _runEstimation(estimationRows);
      });
      logEstimate({
        path:      "js",
        estimator: model,
        n:         rowCount || rows.length,
        k:         allX.length,
        seType:    seType ?? "classical",
        msTotal,
      });
      if (out.error) { setErr(out.error); }
      else { setResult(out.result); setPanelFE(out.panelFE ?? null); setPanelFD(out.panelFD ?? null); }
```

- [ ] **Step 5: Verify the dev build still compiles**

Run: `npm run build`
Expected: build succeeds with no errors from `ModelingTab.jsx`. If lint warns about unused imports (`runOLSFromSuffStats` is already imported elsewhere — leave it), that's fine.

If `npm run build` is too slow, instead run: `npm run lint -- src/components/ModelingTab.jsx src/services/data/`
Expected: no errors.

- [ ] **Step 6: Manual smoke test (browser)**

Run: `npm run dev`

In the browser:
1. Load a Parquet file or CSV >10MB so DuckDB takes over (use any existing test dataset; CLAUDE.md hint: `data/example_large.parquet` if present, otherwise upload any large CSV from the local dev datasets).
2. Open the Modeling tab.
3. Select OLS, choose a numeric Y, choose 1–3 numeric X. Leave SE as Classical, no weights, no factors.
4. Click Estimate. Result should appear normally.
5. In DevTools console: `window.__perfLog.getEntries()` — should show one entry with `path: "sql"`, `n` matching the dataset row count, and `msTotal` finite.
6. Click Estimate again with the same X. The second entry should show `cached: true`.
7. Add a factor variable or change SE to HC1. Click Estimate. New `perfLog` entry should have `path: "js"`.

If any of these fail, stop and debug before committing.

- [ ] **Step 7: Commit**

```bash
git add src/components/ModelingTab.jsx
git commit -m "$(cat <<'EOF'
feat(modeling): Fase 0 — wire dispatcher + suff-stats cache + perfLog

ModelingTab.estimate now uses shouldUseSQLPath() instead of the ad-hoc
gate. Cache (50-entry LRU) lives in useRef and invalidates on
cleanedData change. Every estimate emits a perfLog entry with
{path, estimator, n, k, seType, msTotal, cached?, sqlFailed?}.
window.__perfLog exposes getEntries/clearLog for DevTools inspection.

Co-Authored-By: Claude Opus 4 <noreply@anthropic.com>
EOF
)"
```

---

## Self-review notes (for the implementer)

Before declaring Fase 0 done:

1. Re-run `node src/services/data/__validation__/dispatchValidation.runner.js` → all suites pass.
2. `npm run build` succeeds.
3. Manual smoke test (Task 5 Step 6) passes both SQL and JS paths.
4. `git log --oneline -5` shows five Fase 0 commits in order: config, perfLog, cache, dispatch, ModelingTab.

If any check fails, do **not** mark Fase 0 done — fix and re-verify.

## What this plan does NOT cover (deferred to later fases)

- Factor expansion in SQL (Fase 1)
- HC0/HC1/HC2/HC3 robust SE (Fase 1)
- Lazy residual sampling for plots (Fase 1)
- BP/DW/JB/VIF/cond diagnostics in SQL (Fase 1)
- Cluster, two-way, HAC SE (Fase 2)
- WLS, 2SLS, IV, GMM, FE, FD, TWFE, DiD, Event Study, Logit, Probit, Poisson FE, RDD (Fases 3–7)
- UI panel for `perfLog` behind `?perf=1` query param — Fase 0 exposes it via `window.__perfLog` only

These all build on Fase 0 infrastructure. Each gets its own plan when its fase begins.
