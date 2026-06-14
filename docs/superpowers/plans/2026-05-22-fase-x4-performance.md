# Fase X4 — Performance + Persistence

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Track:** C — Cross-cutting hardening
**Status:** Implementation complete 2026-06-14; browser validation pending Franco.
**Blocks:** Fase X5 (bug bash).

**Goal:** Make the 900k-row benchmark project usable. Every tab transition, every estimate, every export under 5 s. DuckDB-Wasm threaded, OPFS persistence working, `suffStatsCache` LRU staying under its memory ceiling, no heap growth over a 100-estimation loop.

**Why this matters:** the value of all the SQL push-down work in Track A is gated on the surrounding system being fast. If tab transitions still take 15 s because React re-renders the full table, users never see the SQL speedup. The privacy-first constraint forbids any server-side shortcut.

**Tech Stack:** DuckDB-Wasm 1.x via jsDelivr CDN, OPFS through `services/persistence/indexedDB.js` extension, Chrome DevTools Performance API for measurement, `performance.memory.usedJSHeapSize` for heap audits.

---

## Surface covered

- `vercel.json` — COOP / COEP headers for threaded WASM.
- `src/services/data/duckdb.js` — singleton init + OPFS hook.
- `src/services/data/suffStatsCache.js` — LRU implementation.
- `src/pipeline/duckdbRunner.js` — SQL step translation.
- All tabs that touch large datasets: Wrangling, Explore, Model, Plot Builder.

---

## File structure

Create:
```
src/services/data/__validation__/
├── faseX4PerfHarness.js         ← benchmark suite: tab transitions, estimates, exports
├── faseX4Fixtures/
│   ├── synth_900k.parquet       ← committed 900k-row Parquet (synthetic)
│   └── synth_900k.meta.json     ← schema + expected coefficients on the standard estimator panel
└── faseX4Benchmarks.json        ← target timings per scenario
```

---

## Task 1 — Threaded WASM verification

Audit `vercel.json`:

```json
{
  "headers": [
    { "source": "/(.*)",
      "headers": [
        { "key": "Cross-Origin-Opener-Policy",   "value": "same-origin" },
        { "key": "Cross-Origin-Embedder-Policy", "value": "require-corp" }
      ]
    }
  ]
}
```

In-browser verify:

```js
assert(crossOriginIsolated === true);                              // window.crossOriginIsolated
assert(typeof SharedArrayBuffer !== "undefined");
const db = await getDuckDB();
const r  = await db.query("SELECT current_setting('threads')");
assert(Number(r[0].setting) > 1);                                  // multi-thread active
```

---

## Task 2 — OPFS persistence

Flow:

1. Load `synth_900k.parquet` into DuckDB. Time the import.
2. Persist the Parquet file to OPFS via the `getDuckDB` initializer.
3. Close the tab (simulate via reloading the harness).
4. Reopen the harness with the same project ID.
5. Time the second "load." It must be ≥ 10× faster than step 1.

Acceptance: cold start parses Parquet from disk; warm start reads from OPFS.

---

## Task 3 — Tab transition timing

Standard benchmark loop on `synth_900k`:

| Scenario | Target (P50) | Target (P95) |
|---|---|---|
| Wrangling → Explore | 1.0 s | 2.0 s |
| Explore → Model | 1.0 s | 2.0 s |
| Model → Plot Builder | 1.5 s | 3.0 s |
| Apply log step | 0.5 s | 1.0 s |
| Estimate OLS (k=10) | 1.5 s | 3.0 s |
| Estimate FE (k=10, G=50k) | 2.5 s | 5.0 s |
| Estimate 2SLS (k=10) | 2.0 s | 4.0 s |
| Export R bundle | 1.5 s | 3.0 s |

Run each scenario 20 times after a warm-up estimation. Record P50 and P95. Commit results to `faseX4Benchmarks.json`.

---

## Task 4 — `suffStatsCache` ceiling

`suffStatsCache` is an LRU with capacity 50. Each entry holds X'X (k×k), X'Y (k×1), Y'Y (scalar), sumY (scalar), plus key metadata.

At k = 20 (worst realistic case), a single entry holds:
- X'X: 20·20·8 = 3.2 KB
- X'Y: 160 B
- metadata: ~1 KB
- → ~5 KB per entry → 50 entries × 5 KB = 250 KB. Acceptable.

Test: estimate 100 distinct models on `synth_900k` with k varying 5–20. Assert:
- Cache size ≤ 50 entries.
- Aggregate memory of cache ≤ 10 MB (measured via `JSON.stringify` byte length proxy).
- Old entries evicted in LRU order.

---

## Task 5 — Heap leak audit

Loop:

```js
const baseline = performance.memory.usedJSHeapSize;
for (let i = 0; i < 100; i++) {
  await estimate({ /* random config */ });
}
const final = performance.memory.usedJSHeapSize;
assert(final - baseline < 100 * 1024 * 1024);   // < 100 MB growth
```

Run in Chrome with `--enable-precise-memory-info`. If growth > 100 MB, instrument with the DevTools allocation profiler to locate the retained set.

Likely culprits:
- React state holding stale model objects.
- DuckDB query handles not closed (`stmt.dispose()`).
- Plot SVG nodes attached to detached React trees.

---

## Task 6 — Display-vs-computation split audit

Verify the CLAUDE.md "DuckDB-Wasm performance strategy" rule:

- Wrangling / Explore tabs render at most 500 rows in the visible table.
- Pipeline steps (filter, log, z-score, lag, etc.) run on the full 900k rows via DuckDB SQL.
- Column stats (mean, sd, min, max, n_distinct) are computed once via SQL and cached in component state.
- No JS path iterates all 900k rows during a tab render.

Instrument with a counter that increments on JS-side row iteration; assert counter stays at 0 for full-table operations.

---

## Acceptance gate

- [ ] COOP/COEP headers present in `vercel.json`; `crossOriginIsolated === true`. (`vercel.json` fixed; deployed-browser assertion pending.)
- [ ] OPFS warm start ≥ 10× cold start.
- [ ] All 8 timing scenarios meet P50 + P95 targets.
- [x] `suffStatsCache` stays at 50 entries and under 10 MB. Node harness: 431.8 KiB serialized proxy at k=20.
- [ ] Heap growth over 100 estimations < 100 MB.
- [ ] No JS-side 900k-row iteration triggered by tab renders.

---

## Implementation result — 2026-06-14

Code-complete, with browser-only gates deliberately left pending:

- `vercel.json`: COOP remains `same-origin`; COEP changed from `credentialless` to `require-corp` per CLAUDE.md rule 4. `credentialless` can create a cross-origin-isolated context where implemented, but MDN browser-compat data lists it from Chrome 96 and Firefox 119 desktop while Safari, Firefox Android, and Opera Android remain unsupported. `require-corp` is therefore the portable target-browser setting. Browser smoke must also confirm every CDN dependency supplies CORS/CORP-compatible responses.
- OPFS project reopen: dataset registry now persists `opfsCacheKey` + full `rowCount`; project hydration restores a fresh DuckDB table from that key before falling back to the IndexedDB preview. CSV/parsed-data/Parquet loads await the OPFS write, so closing the tab cannot race a fire-and-forget save. Temporary DuckDB connections and registered OPFS buffers are closed/dropped.
- Node harness: `node src/services/data/__validation__/faseX4PerformanceValidation.mjs` checks COOP/COEP/CSP plus LRU capacity, true recency eviction, and serialized size. Result on 2026-06-14: **10 passed, 0 failed; 431.8 KiB** for 50 realistic k=20 entries.
- Browser harness: open the deployed app with `?validation=faseX4`; use `window.__validation.faseX4`. Exact OPFS, 20-run timing, and 100-estimation heap procedures are in `src/services/data/__validation__/faseX4BrowserChecklist.md`.
- `faseX4Benchmarks.json` contains targets only and remains `pending_browser_validation`; no timing or heap values were invented.

Not marked validated until Franco runs the deployed-browser checklist. The optional display-vs-computation audit from Task 6 also remains pending because it is outside the five X4 scope items in the pre-launch spec.

---

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `performance`, `slow`, `crash`, `OOM`, `memory`, `freeze`, `hang`, `tab transition`, `OPFS`, `DuckDB`.
2. For every open row in scope:
   - **Fix-now:** address before concluding (especially crash and OOM rows).
   - **Fix-later:** file in `BugTriage.md` with a `FaseX4 →` reference.
   - **Wontfix:** document rationale and resolve in Supabase.
3. Concluding without an empty in-scope queue is a blocker.

Performance is hardware-dependent — Franco's machine may pass the synthetic benchmark while a thesis student on a 4 GB Chromebook still hits OOM. Supabase reports surface that gap.

---

## Commits

- `test(perf): Fase X4 — threaded WASM + OPFS persistence`
- `test(perf): Fase X4 — tab transition + estimate timing harness`
- `test(perf): Fase X4 — suffStatsCache ceiling + heap leak audit`
- `fix(perf): Fase X4 — regressions surfaced by harness` (if any)
- `docs: Fase X4 — performance + persistence validated`
