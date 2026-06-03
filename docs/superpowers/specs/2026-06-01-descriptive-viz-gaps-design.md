# Design: Descriptive Statistics & Visualization Gaps (DescriptiveVizSpec)
**Date:** 2026-06-01
**Status:** Draft / Proposed
**Scope:** Close the descriptive-statistics and publication-graphics gaps that block replication of the BA-thesis `Summary statistics.R` and `graphs and plots.R`, then round out the descriptive/viz stack toward standard R `dplyr`+`ggplot2`+`sf` workflows.

---

## Background

Audit of the two remaining thesis scripts (`validation/BA check/Summary statistics.R` — 595 lines; `graphs and plots.R` — 507 lines) found that the **data-prep and modeling gaps are tracked separately** (SpatialSpec, ModelingSpec). What remains is the **descriptive layer** (Table 1, distribution stats, overdispersion check) and the **publication-graphics layer** (static choropleths with labels, coefficient gradient plots, KDE heatmaps).

These two scripts are how the thesis *justifies the model* (overdispersion → Poisson) and *communicates results* (forest plots, choropleths, etable LaTeX). Without them, a user can estimate the models but cannot reproduce the figures or the descriptive tables that frame the paper.

**What Litux already has (non-gaps):**
- `group_summarize` (runner.js:378) — group-by aggregation with `count/sum/min/max/mean/sd/median`.
- `pivot_longer` (runner.js) — wide→long reshape.
- Spatial **interactive** choropleth — Map tab `colorByCol`/`colorCol` + `buildColorScale` (SpatialPlotTab.jsx:326,351) renders fill-by-variable on Leaflet (categorical + continuous legends).
- `nearestNeighbor` / `nearestNeighborMetric` (SpatialEngine.js) — nearest-feature spacing.
- PlotBuilder (PlotBuilder.jsx) — 11 geoms incl. `errorbar`, `ribbon`, `boxplot`, `density`, `histogram`, `smooth`, `hline`/`vline`; positions `identity/stack/jitter`; palette presets; SVG+PNG export; dark theme.
- ReportingModule — LaTeX stargazer multi-model table, forest plots; ModelComparison `buildStargazer` (covers `etable` — see ModelingSpec B3).
- Explorer summarise — per-column descriptive stats panel.

**Architectural invariants (must hold):**
- `src/math/` and `src/pipeline/` stay **pure JS**, no React.
- `runner.js` + `registry.js` stay in sync; new aggregations land as `group_summarize` funcs or new step types.
- PlotBuilder stays on Observable Plot 0.6 (CDN); geo plot tab stays on the SVG canvas; both keep SVG+PNG export.
- Spatial fill-by-variable reuses `buildColorScale` (shared/color.js) — never fork the scale logic.

---

## Part A — Critical gaps (block replication)

### A1. `pivot_wider` — long→wide reshape
**R/dplyr:** `count(sector, level) |> pivot_wider(names_from = level, values_from = n)` (Summary statistics.R cross-tab of crime sector × school level).
**Today:** only `pivot_longer` exists. Cross-tabs and contingency tables cannot be built; the thesis's sector×level and dist_bin×franja summary matrices are unreachable.
**Proposed:** `pivot_wider` runner step:
```
{ type:"pivot_wider", idCols:[...], namesFrom:"level", valuesFrom:"n", valuesFill:0, namesPrefix:"" }
```
- Group by `idCols`; spread distinct `namesFrom` values into columns; fill missing cells with `valuesFill`.
- Multiple `valuesFrom` → suffixed columns (`n_primary`, `n_secondary`).
- Emits a `pivot_wider` step in `runner.js` + `registry.js` (keep in sync).
**UI:** Reshape section of the Reshape & Merge tab — mirror the existing `pivot_longer` control with names/values pickers.
**Validation:** column-equivalence vs `tidyr::pivot_wider`.

### A2. Quantile / percentile aggregation in `group_summarize`
**R/dplyr:** `summarise(p10 = quantile(x,.1), p25 = quantile(x,.25), p75 = quantile(x,.75), p90 = quantile(x,.9))` (Summary statistics.R distribution table).
**Today:** `group_summarize` funcs are `count/sum/min/max/mean/sd/median` (runner.js:396–417). No percentile.
**Proposed:** add `fn:"quantile"` with a `q` field (0–1) to the `aggs` schema:
```
{ col:"n_robos", fn:"quantile", q:0.9, nn:"robos_p90" }
```
- Linear-interpolation quantile (R type-7 default) so values match `quantile(x)`.
- UI: aggregation-function dropdown gains "Quantile (p…)" with a percentile input.
**Validation:** vs R `quantile(x, probs, type=7)` to 6 dp.

### A3. Static publication choropleth (geo plot tab fill-by-variable + text labels)
**R/sf+ggplot2:** `geom_sf(aes(fill = poverty_rate)) + geom_text(aes(label = comuna)) + theme_void()` — grid colored by `dist_bin`, barrio/comuna boundary overlays, centroid text labels (graphs and plots.R complex choropleth; Summary statistics.R poverty choropleth).
**Today:** the **interactive Map tab** does fill-by-variable, but the **Geo Plot tab** (SVG, the publication-export surface) has only a single-color `fill` picker (GeoLayerConfig.jsx:142) — no `fillByCol`, no centroid text labels. The exact static figures in the thesis cannot be produced.
**Proposed:**
- Add `fillByCol` to the geo-plot polygon layer (GeoLayerConfig + GeoPlotCanvas), reusing `buildColorScale` from shared/color.js (same scale as the Map tab — categorical + continuous).
- Add a **centroid-label layer option**: `labelCol` → draw `<text>` at each polygon centroid (`xyCentroid`), with font-size/anchor controls. (`theme_void` ≈ existing axis-hiding toggle.)
- Boundary-overlay already supported via stacked polygon layers (border-only fill).
**UI:** GeoLayerConfig gains "Fill by column" (dropdown + scale/palette) and "Label by column" (dropdown + size).
**Validation:** visual + scale-domain equivalence vs `buildColorScale` Map-tab output for the same column.

---

## Part B — Moderate gaps

| # | Gap | Script ref | Proposal |
|---|-----|-----------|----------|
| B1 | **Overdispersion statistic** (var/mean ratio + Cameron-Trivedi test) | Summary statistics.R var/mean motivating Poisson | Descriptive readout (per group or overall): `mean`, `var`, `var/mean`, and a dispersion-test p-value. Surfaces in Explorer summarise + as a one-click "count diagnostics" panel. Pairs with ModelingSpec C1 (NB/quasi-Poisson). |
| B2 | **`position_dodge` for grouped errorbar/pointrange** | graphs and plots.R coefficient gradient plot (geom_pointrange + position_dodge by group) | PlotBuilder `dodge` position for `errorbar`/`point`/`bar` (Observable Plot `dodgeX`/`dodgeY` grouped by color). Unblocks side-by-side coefficient forest plots across franjas. (The `(exp(β)−1)·100` axis transform = ModelingSpec B2 IRR display.) |
| B3 | **Publication "Table 1" descriptive export** | Summary statistics.R Table 1 (N, mean, sd, min, max per variable, by group) | A descriptive-table builder: select variables → emit a grouped summary matrix → export LaTeX (`\begin{tabular}`) + CSV, matching `modelsummary::datasummary` / `stargazer(type="latex", summary=TRUE)`. Reuse ReportingModule LaTeX plumbing. |

---

## Part C — "And more" (round out the descriptive / viz stack)

- **C1. 2-D kernel density heatmap (`bkde2D` + raster).** Thesis uses `KernSmooth::bkde2D` → raster → `leaflet::addRasterImage` for a crime-density hotspot map. Proposed: `kde2d(points, {bandwidth, gridN})` in SpatialEngine → raster grid; render as a Leaflet image overlay (Map tab) and/or a binned heatmap geom in the geo plot tab. Standard hotspot analysis; high value beyond the thesis.
- **C2. Contingency-table / cross-tab helper.** Beyond A1 raw `pivot_wider`: a one-click `count(a, b) → wide` cross-tab with row/column margins and optional row/col proportions (`prop.table`). UI in Explorer.
- **C3. Correlation matrix + heatmap.** `cor()` over selected numeric columns → matrix + a PlotBuilder heatmap geom (new geom). Common descriptive step absent today.
- **C4. Faceting (`facet_wrap`/`facet_grid`) in PlotBuilder.** Small-multiples by a categorical column — Observable Plot `fx`/`fy` facets. The thesis plots distributions by month/dow; faceting makes these one plot instead of many.
- **C5. Binned/aggregated geoms (`stat_summary`, `geom_bin2d`).** On-the-fly mean/median-by-bin without a pre-aggregation pipeline step — convenience for exploratory plots.
- **C6. Marginal / rug + density-overlay combos.** Histogram + density overlay and rug marks (Observable Plot `tickX`) for distribution figures.
- **C7. ECDF + Lorenz/concentration curves.** Distribution-comparison geoms; useful for inequality/poverty descriptives the thesis touches.
- **C8. Map scale bar + north arrow + graticule.** Publication-map furniture for the geo plot tab (`ggspatial::annotation_scale`/`annotation_north_arrow`).

---

## Implementation notes
- **A1 + A2 are pure runner.js work** — additive, low-risk, no new engine. Land them first; they also feed B3 (Table 1) and C2 (cross-tab margins).
- **A3 reuses `buildColorScale`** — do **not** fork scale logic between Map and Plot tabs. The only new code is wiring `fillByCol`/`labelCol` into the SVG canvas + centroid text via existing `xyCentroid`.
- **B2 is a thin PlotBuilder addition** — extend the `POSITIONS` map (PlotBuilder.jsx:107) and the mark branch to call Observable Plot's `dodgeX`/`dodgeY`; no data-shape change.
- **C1 (KDE)** is the only mathematically substantial item — a 2-D Gaussian KDE on a grid; validate against `KernSmooth::bkde2D`.
- Keep PlotBuilder on Observable Plot 0.6; new geoms (C3 heatmap) follow the existing geom-registry pattern (`GEOMS` array + mark branch).

## Validation plan
`src/math/__validation__/descriptiveVizRValidation.R` → `descriptiveVizBenchmarks.json` → `window.__validation.descriptiveViz`. Targets: `tidyr::pivot_wider` (column equivalence), `quantile(type=7)` (6 dp), `KernSmooth::bkde2D` density grid (4 dp), `cor()` matrix (6 dp), var/mean dispersion + Cameron-Trivedi (4 dp). Visual items (A3, B2, C4) checked by scale-domain/structure equivalence, not pixel diff.

## Priority & sequencing
1. **A1 pivot_wider + A2 quantile agg** — pure runner.js, unblock cross-tabs + distribution tables + Table 1.
2. **B3 Table 1 LaTeX export** — composes on A2; high paper-facing value.
3. **A3 static choropleth fill-by-var + labels** — the thesis's headline figures.
4. **B2 position_dodge** + **B1 overdispersion stat** — coefficient plots + the Poisson justification.
5. **C1 KDE heatmap** — hotspot maps (mathematically substantial, validate vs bkde2D).
6. **C2–C8** — cross-tab margins, correlation heatmap, faceting, binned geoms, ECDF/Lorenz, map furniture — opportunistic.
