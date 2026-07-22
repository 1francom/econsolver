# Explore module SQL fast-path — design

**Date:** 2026-07-22
**Trigger:** Franco reported Evidence Explorer stats (Group & Summarize, Summary Table) computing
wrong numbers on a 214,558-row DuckDB-backed dataset (`hansen_data.csv` → `drunk`). Root cause
chain, found and partially fixed across three prior sessions on branch
`claude/plot-builder-binwidth-fix-32rx1h` (PR #118):

1. DuckDB-routed datasets ship a 500-row **preview** in `cleanRows`; the real table (900k+ rows in
   the general case) stays in DuckDB. `ExplorerModule` fetched the full table into a JS array
   (`extractAllRows`) on mount to compute stats correctly — but that fetch was silently swallowed
   on failure and had no loading indicator, so every stat + the "N obs" header itself could render
   off the 500-row preview with zero signal anything was wrong. (Fixed: loading/error banner +
   auto-refresh, still landed on this branch.)
2. Even with that patched, `extractAllRows` materializing the **entire** table into JS on every tab
   visit is exactly the anti-pattern CLAUDE.md's "DuckDB-Wasm performance strategy" section warns
   against ("Never pull the full Arrow result into JS objects"). It happens to be tolerable at
   214k rows; at the 900k-row scale the app is meant to support, this is the ~15s tab-transition
   lag the strategy section is about, and it's a *correctness* bug in the meantime if the fetch is
   still running when a stat is read.

**Real fix:** push every Explore computation that touches the full dataset into SQL, so the
JS↔DuckDB boundary only ever crosses a handful of aggregated numbers — correct and fast at any row
count, no materialization step to race or fail silently. This mirrors what `duckdbRunner.js` and
`duckdb.js`'s `computeColStats` already do for pipeline steps; Explore's tabs never picked up the
pattern because they predate the DuckDB routing work.

## Scope — one phase per tab, each independently shippable

| # | Component | Status | Notes |
|---|-----------|--------|-------|
| 1 | `GroupSummarizeExplorer` ("Group & Summarize" panel) | **DONE 2026-07-22** | `doSummarize()` now issues `SELECT <byCols>, avg(...)... FROM "<duckTable>" GROUP BY <byCols>` via `queryDuckDB()` when a `duckTable` is available and no ad hoc `QuickFilter` condition is active; falls back to the original JS grouping otherwise (small/non-DuckDB datasets, or filtered views — translating QuickFilter conditions into a SQL `WHERE` is Phase 1b, not done). Aggregate mapping: `mean→avg`, `median→percentile_cont(0.5)`, `sd→stddev_samp` (sample, matches the JS branch's `n-1` formula), `count→count(*)` (counts all group rows, not just non-null numeric — matches JS), `sum/min/max` direct. |
| 1b | Same panel, QuickFilter active | PENDING | Translate the existing `{col,op,val}` condition list into a SQL `WHERE` clause (same op set: `>,<,>=,<=,=,≠,in,contains`) so the SQL path also covers the filtered case instead of falling back to JS. |
| 2 | `SummaryTable` (Summary tab, Stats/head/tail view) | PENDING | Heavier lift than #1 — `statsFor(subset, col)` is called inline from the render loop, the group-header row-count label, and both CSV/LaTeX export builders, all reading live off the `rows` prop. Needs a `sqlSummary` result object computed once (ungrouped: one wide `SELECT avg(...), stddev_pop(...), percentile_cont(...)...` row; grouped: same shape once per group via `GROUP BY`) and every read site switched to index into it instead of re-filtering `rows`. `head(n)`/`tail(n)` views can use `getTablePage`-style `LIMIT`/`ORDER BY ... DESC LIMIT` instead of `rows.slice()`. **Still the one open item** — everything else in this table shipped 2026-07-22. |
| 3 | `CorrHeatmap` (Correlation tab) | **DONE 2026-07-22** | `fetchCorrMatrixSQL()` — one query, `corr(a,b)` for every numeric pair (upper triangle, mirrored). JS `pearson()` kept as fallback for small/non-DuckDB datasets and filtered views. |
| 4 | Histograms + categorical bars (Distributions tab) | **DONE 2026-07-22** | `fetchHistogramStatsSQL()` (mean/stddev_pop/min/max/percentile_cont median+q1+q3/outlier count via IQR, all over the full table with the chosen log/log10/sqrt transform applied in SQL) + `fetchHistogramBinsSQL()` (bin counts via a `FLOOR` bucket expression, same bucketing rule as `SvgHistogram`'s own JS binning). `SvgHistogram` now accepts precomputed `counts`+`min`+`max` as an alternative to raw `data`, so it never needs the raw column in JS. Categorical bar chart: `fetchCategoryCountsSQL()`, one `GROUP BY` query. Note: q1/median/q3 use `percentile_cont` (linear interpolation, R's default quantile type) in the SQL path — more standard than, and therefore not bit-identical to, the JS fallback's `sorted[floor(n*p)]` nearest-rank indexing. Spaghetti sub-tab (panel tab, samples ≤15 entities) left on the JS path — no scaling benefit since it already only look at a handful of entities. |
| 5 | `TimeSeriesTab` (Time Series → Line chart) | **DONE 2026-07-22** | `fetchAggregateTimeSeriesSQL()` — `GROUP BY (grpCol, tCol)` inside DuckDB, reused for both the chart's grouped series and `flatY` (grpCol="", agg="mean" — flatY is always the mean of yCol per period regardless of the chart's own agg selector). ACF/PACF/ADF run in JS same as before, but now over the small SQL-aggregated series, never the raw table. |
| 6 | PlotBuilder point/scatter geoms fed by a DuckDB dataset | **DONE 2026-07-22 (scoped)** | Implemented at the `ExplorerModule` call site, not inside `PlotBuilder.jsx` itself (all marks in one Observable Plot call share one data array, so true per-geom sampling would need restructuring `buildMarksForLayer` to take per-layer datasets — not done). Past `rowCount > 50,000`, fetches `SELECT * FROM tbl USING SAMPLE 20000 ROWS` and feeds that in place of the full materialized array specifically for the Plot Builder tab, with a visible banner disclosing the sample size and that aggregated marks (mean lines, histograms) are therefore approximate. Below the threshold, or with an active QuickFilter, Plot Builder still gets the exact full array. |

## Non-goals
- Removing the `extractAllRows`/`fullRows` JS-materialization path entirely — phases 2-6 still
  depend on it until converted, so it stays as the fallback for now.
- Touching non-DuckDB (small, all-in-JS) datasets — `rows` there is already the true full array,
  no preview truncation exists, so the JS computation is already correct. Every phase above only
  changes behavior when `duckTable` is present.

## Why phase 1 first
It's the exact component in the bug report, it's the most self-contained (one `sumResult` snapshot,
not read from a dozen call sites like `SummaryTable`), and it validates the query-shape pattern
(`GROUP BY` + aggregate mapping table) that phases 2-5 reuse almost unchanged.
