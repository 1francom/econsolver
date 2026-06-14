# Fase X4 browser validation checklist

Status: **PENDING Franco browser validation**. Do not mark these checks validated from Node/build output.

## 1. Launch and environment

1. Deploy to Vercel and open the app with `?validation=faseX4` appended to the URL.
2. For the heap check, launch Chrome/Edge with `--enable-precise-memory-info`.
3. Open DevTools and run:

```js
await window.__validation.faseX4.environment()
```

Pass only when `crossOriginIsolated`, `sharedArrayBuffer`, and `opfs` are `true`, and `threads > 1`.

## 2. OPFS close/reopen

1. Clear the site's storage once, then open a project and load the 900k-row CSV/TSV/Parquet.
2. Record the cold load with `performance.now()` and confirm the dataset badge says `duckdb`.
3. Run `window.__validation.faseX4.opfsStatus()`. Require `writeErrors === 0` and at least one miss.
4. Close the tab completely. Do not upload the file again.
5. Reopen the same project. The registry must restore the DuckDB table from its persisted `opfsCacheKey`.
6. Confirm the dataset badge says `cached`, the row count is 900,000, and `opfsStatus()` shows a new hit.
7. Record warm-load time. Pass only when `coldMs / warmMs >= 10`.

## 3. 900k timing suite

Warm up with one estimation. Run every scenario 20 times. For callbacks callable from DevTools use:

```js
await window.__validation.faseX4.benchmark(
  "estimate_ols",
  window.__validation.faseX4.estimate
)
```

For UI-only actions, bracket each action with `start(label)` and `stop(label)`, then repeat 20 times:

```js
window.__validation.faseX4.start("wrangling_to_explore")
// perform the action, wait until the target tab/result is ready
window.__validation.faseX4.stop("wrangling_to_explore")
```

Use the exact labels in `window.__validation.faseX4.targets`. Then run:

```js
window.__validation.faseX4.summary()
```

Copy the measured P50/P95 values into `faseX4Benchmarks.json`. Every scenario needs 20 runs and status `pass`.

## 4. Heap growth

Configure the real 900k-row model, then run:

```js
await window.__validation.faseX4.heapLoop(undefined, 100)
```

Pass only when `growthMiB < 100`. If it fails, capture a DevTools Allocation instrumentation profile and inspect retained React results, DuckDB handles, and detached plot nodes.

## 5. Record results

Fill `faseX4Benchmarks.json` with browser version, hardware, OPFS cold/warm timings, all 20-run P50/P95 results, and heap growth. Only Franco changes `status` from `pending_browser_validation` after the real run.
