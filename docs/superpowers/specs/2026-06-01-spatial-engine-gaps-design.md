# Design: Spatial Engine — sf-Parity Gaps & Roadmap (SpatialSpec)
**Date:** 2026-06-01
**Status:** Draft / Proposed
**Scope:** Close the spatial operations that block real-world replication of an sf-based research pipeline, then extend `SpatialEngine.js` toward `sf` parity and true spatial econometrics (spatial weights + spatial-lag models).

---

## Background

A replication audit of a Bachelor-thesis spatial pipeline (`validation/BA check/Data preparation _oficial.R` — crime-around-schools in CABA, Buenos Aires) found that ~70% of the script maps cleanly onto existing Litux wrangling + spatial modules, but **three load-bearing operations have no equivalent**, and they are exactly the operations that make the dataset *spatial* rather than flat:

1. Polygon×polygon **areal-weighted interpolation** (census → grid).
2. Buffer **dissolve (union) + exposure share** (area of overlap).
3. **Cartesian panel expansion** (`expand_grid`) to build the balanced grid×date×franja panel.

This spec records those gaps plus the smaller ergonomic gaps the same script exposed, and proposes a roadmap of adjacent spatial features that would round the module out to `sf` parity and unlock spatial econometrics.

**Architectural invariants (must hold for every item below):**
- `src/math/SpatialEngine.js` stays **pure JS** — no React, no UI imports. All coordinates WGS-84 unless a projected CRS is explicit (UTM 21S = EPSG:32721 for CABA).
- Each new analyze operation is a self-contained `*Section.jsx` under `src/components/tabs/spatial/analyze/`, communicating via the established `onResult(rows, newCols)` contract.
- Any new **pipeline** step (non-spatial wrangling, e.g. expand_grid) lands in `runner.js` **and** `registry.js` in the same change (registry must stay in sync).
- Every new math function is validated against R `sf` to 6 dp on coordinates / areas, 4 dp on derived stats, with fixtures in `src/math/__validation__`.

**Reference docs:** `.claude/skills/Spatial/{sf.pdf, sfCran.pdf, leaflet.pdf}`.

---

## Part A — Critical gaps (block replication)

### A1. Areal-weighted polygon interpolation
**sf equivalent:** `st_intersection(poly_a, poly_b)` → `weight = st_area(intersection) / st_area(a)` → weighted sums.
**Script use:** census radios → grid (lines 487–507, 570–592): `total_pop = Σ TOTAL_POB · (area_intersect / area_radio)`.
**Why it matters:** the standard sf move to push polygon attributes (population, poverty) onto a different polygon partition (the grid). Litux today does point→cell and polygon→centroid joins only — no polygon×polygon area overlap.

**Proposed API (SpatialEngine.js):**
```
polygonOverlapWeights(sourceRows, sourceWktCol, targetRows, targetWktCol, targetIdCol, {metricCrs})
  → [{ source_idx, target_id, area_intersect, area_source, weight }]

arealInterpolate(sourceRows, sourceWktCol, targetRows, targetWktCol, targetIdCol, valueCols, {metricCrs, extensive=true})
  → target rows + Σ value·weight per valueCol   (extensive=count/pop; intensive=area-weighted mean)
```
Requires a real **polygon-polygon clip** (Sutherland–Hodgman is already used for grid clipping in `makeGrid`; generalize it to arbitrary convex/concave clip via Weiler–Atherton or a triangulation-area approach) and a robust **polygon area** (shoelace on projected rings, MULTIPOLYGON-aware).
**UI:** `ArealInterpolateSection.jsx` — source layer + target layer + value columns + extensive/intensive toggle.
**Validation:** R `sf::st_interpolate_aw(x, to, extensive=TRUE/FALSE)`.

### A2. Buffer dissolve (union) + exposure share
**sf equivalent:** `st_union(st_buffer(points, r))` then `st_intersection(grid)` then `area_exposed / area_total`.
**Script use:** `compute_exposure` (lines 384–403) — fraction of each grid cell covered by the dissolved school-buffer blob, at r = 100/200/300 m.
**Why it matters:** continuous treatment-intensity variable; `createMetricPointBuffers` (SpatialEngine.js:643) already emits buffer polygons but there is no **union/dissolve** and no polygon-area-overlap.

**Proposed API:**
```
dissolveBuffers(bufferRows, wktCol, {metricCrs})            → single (multi)polygon WKT
gridExposureShare(gridRows, gridWktCol, gridIdCol, dissolvedWkt, {metricCrs, clamp=true})
  → grid rows + exposure ∈ [0,1]   (area_exposed / area_total, clamped)
```
Depends on the same polygon-clip + area primitives as A1, plus a **polygon union** (dissolve). Reuse A1's clip kernel.
**UI:** extend `MetricBufferSection.jsx` with a "dissolve + exposure share" mode, or a new `BufferExposureSection.jsx`.
**Validation:** R `st_area(st_intersection(grid, st_union(st_buffer(...)))) / st_area(grid)`.

### A3. Buffer-count overlap semantics
**sf equivalent:** `st_join(grid, buffers, join = st_intersects)` then count distinct buffers per cell.
**Script use:** `compute_buffer_count` (lines 405–415) — number of individual school buffers overlapping each cell.
**Gap nuance:** `countPointsWithinGridCentroidBuffer` (SpatialEngine.js:688) counts *points within a centroid buffer* — different from *buffers intersecting a cell polygon*. Need true polygon-intersects test cell↔buffer.

**Proposed API:**
```
countBuffersIntersectingGrid(gridRows, gridWktCol, gridIdCol, bufferRows, bufferWktCol, {metricCrs, outCol})
  → grid rows + n_buffers_overlapping
```
**UI:** option within `BufferExposureSection.jsx` (share vs count vs both).
**Validation:** R `lengths(st_intersects(grid, buffers))`.

### A4. Cartesian panel expansion (`expand_grid`) — *pipeline step, not spatial* — ✓ COVERED via `balance_panel` (2026-06-02)
**Resolution:** the shipped `balance_panel` step (registry + runner + `PanelTab.jsx`) already performs entity × time × slot cross-expansion + constant fill + static-copy — the thesis `expand_grid` + `left_join` + `coalesce(0)` in one step. A separate general-N-column `expand_grid` primitive was judged redundant for replication and not built.

**dplyr/tidyr equivalent:** `tidyr::expand_grid(id, date, franja)` → balanced skeleton, then `left_join` + `coalesce(0)`.
**Script use:** lines 668, 1220 — builds the `907 × 295 × 4` balanced panel for Poisson (explicit zeros where no crime occurred).
**Why here:** it is the backbone of the whole design and surfaced in this audit, but it belongs in **`runner.js` + `registry.js`** as a wrangling step, not in SpatialEngine. Cross-referenced here so it is not orphaned.

**Proposed step type `expand_grid`:**
```
{ type: "expand_grid", cols: ["grid_id","date","franja"], source: "values"|"distinct" }
```
Cartesian product of the distinct values of named columns (or explicit value lists), producing the skeleton; downstream `join` + `fill_na(0)` already exist. Pair with an integrity assertion (`nrow == Π |distinct|`).
**UI:** new control in ReshapeTab (or Panel tab). **Owner skill:** `implement-wrangling-feature` / `pipeline-step-adder`.
**Validation:** row-count identity + spot-check zero-fill vs R.

---

## Part B — Minor gaps / ergonomics (same script)

| # | Gap | Script ref | Proposal |
|---|-----|-----------|----------|
| B1 | **Polygon centroid** as a user-facing op | police WKT → `st_centroid` (line 280) | Expose `xyCentroid`/`centroidFromWktMetric` (already internal) as `polygonCentroid(rows, wktCol)` → lon/lat + x/y cols; new toggle in a geometry-utils section. sf: `st_centroid`. |
| B2 | **Distinct / dedup** step | `distinct(lon, lat, .keep_all)` (line 257) | Pipeline step `distinct { cols }` in runner.js/registry.js (keep first). dplyr: `distinct`. |
| B3 | **Locale-aware numeric parse** (comma decimal) | `gsub(",",".")` on coords (line 253) | `type_cast` option `decimalComma: true`; avoids manual regex. |
| B4 | **Multi-bucket `case_when`** ergonomics | hour→franja buckets (lines 188–214) | `recode` currently does value→value; add a `bins`/`case_when` mode mapping value-sets → label (`hora %in% c(7,12,13,16) → "school_hour"`). |
| B5 | **`stopifnot` integrity assertions** | lines 157, 441, 754 | Optional `assert` pipeline step (row-count / no-NA / unique-key) surfaced in AuditTrail; non-fatal warning by default. |

---

## Part C — Adjacent features for sf parity & spatial econometrics ("and more")

These are not required by the thesis script but are the natural next layer once A1–A3 land the polygon-clip/area/union primitives. They turn the module from "spatial joins" into a real spatial-econometrics workbench.

### C1. General polygon set operations
Once the clip kernel from A1 exists, expose the full trio: `st_intersection`, `st_union`, `st_difference` between two layers (and self-union/dissolve by group key). Foundation for everything else.
**API:** `polygonSetOp(aRows, aWkt, bRows, bWkt, op)` where `op ∈ {intersection, union, difference}`.

### C2. Geometry measurement columns
`st_area` (polygons) and `st_length` (lines/perimeter) as one-click feature columns in a projected CRS. The script computes `area_total`, `area_radio`, `area_intersect` repeatedly (lines 382, 485, 492) — make it a first-class op.
**API:** `addArea(rows, wktCol, {metricCrs, outCol})`, `addLength(...)`.

### C3. Spatial weights matrices (W) — **the keystone for spatial econometrics**
Build a neighbor/weights object from a polygon or point layer:
- **Contiguity:** queen / rook (share edge vs vertex) from polygon adjacency.
- **K-nearest-neighbour:** KNN on centroids (reuse `nearestNeighbor`).
- **Distance-band:** all neighbours within threshold d.
- Row-standardized (`W`) and binary (`B`) styles.
**API:** `buildSpatialWeights(rows, geomCol, {type:"queen"|"rook"|"knn"|"dband", k, d, style:"W"|"B"})` → sparse `{i, j, w}` triples + summary (avg neighbours, islands).
**sf/spdep equivalent:** `spdep::poly2nb`, `knn2nb`, `dnearneigh`, `nb2listw`.
**Note:** lives in SpatialEngine (pure JS); consumed by C4/C5.

### C4. Spatial autocorrelation diagnostics
Consuming W from C3:
- **Global Moran's I** (+ permutation / analytic p-value), **Geary's C**.
- **Local Moran's I (LISA)** with HH/LL/HL/LH cluster classification, mappable on the Leaflet/Plot tabs.
**API:** `moranI(values, W)`, `localMoran(values, W)`, `gearyC(values, W)`.
**sf/spdep:** `moran.test`, `localmoran`, `geary.test`.

### C5. Spatial regression models (math engine, not SpatialEngine)
New `src/math/SpatialRegressionEngine.js` consuming a W matrix:
- **SLX** (spatially-lagged X) — trivially OLS on `WX`.
- **SAR / spatial lag** (`y = ρWy + Xβ + ε`) — ML or 2SLS/GMM.
- **SEM / spatial error** (`y = Xβ + u, u = λWu + ε`).
- **SDM** (Durbin) as the nesting model.
Wire through the standard estimator path (`add-estimator` skill, EstimatorSidebar, ModelConfiguration, EstimationResult), with W selected from a dropdown of built weights.
**Validation:** R `spatialreg::lagsarlm`, `errorsarlm`, `spdep`. **This is the headline post-MVP spatial feature** — Litux currently has zero spatial-lag models.

### C6. Kernel density / point intensity
Quartic/Gaussian KDE of a point layer onto a grid (crime hotspots without arbitrary cells). Output a density column per grid cell or a raster-like grid for choropleth.
**API:** `kernelDensityToGrid(pointRows, latCol, lonCol, gridRows, gridWkt, {bandwidth, kernel})`.

### C7. Zonal statistics (vector)
Generalize `aggregateToGrid`: aggregate **any** point/polygon attribute (mean/median/sd/quantile, not just count/sum) into arbitrary zones (comunas, barrios), not only the grid. The script already does barrio/comuna joins (lines 1267–1296); zonal stats would replace the join+group_summarize dance.

### C8. Geometry validity & holes
- `st_make_valid` equivalent: detect/repair self-intersections, ensure ring orientation before area/clip ops (A1–A3 correctness depends on this).
- **Polygon holes:** current `pointInPolygon` ray-casting ignores interior rings (documented limitation in the skill). Honour holes for accurate area/clip.

### C9. Line geometry & network distance
Support LINESTRING geometry; Manhattan/path distance as an alternative to Euclidean/haversine (street-grid realism for pedestrian-exposure designs like the thesis). Lower priority.

---

## Implementation notes

- **Shared kernel:** A1, A2, A3, C1, C2 all reduce to two robust primitives — **polygon area** (shoelace, MULTIPOLYGON + hole aware) and **polygon-polygon clip/union**. Build and validate those once; everything else composes on top. The existing Sutherland–Hodgman clip in `makeGrid` is the starting point but must be generalized beyond rectangle-vs-polygon.
- **Performance:** polygon×polygon ops are O(n·m) like the existing joins. Warn above ~1M pair tests; DuckDB-spatial is the eventual fast path (already flagged pending in the skill). Keep an n·m guard consistent with `spatialJoin`.
- **CRS discipline:** all area/length/clip math runs in the projected metric CRS (EPSG:32721 default), then results re-projected to WGS-84 for display. Never compute area in degrees.
- **Spatial weights** are the dependency bottleneck for the whole econometrics layer (C4→C5). Prioritize C3 immediately after the polygon kernel if spatial regression is on the roadmap.

## Validation plan
Per item: R fixtures in `src/math/__validation__/spatialGapsRValidation.R` → `spatialGapsBenchmarks.json` → `window.__validation.spatialGaps`. Tolerances: areas/coords 6 dp, interpolated values 4 dp, Moran's I / model coefs 4 dp (SE 3 dp, ML df differences expected).

## Priority & sequencing
1. **Polygon kernel** (area + clip + union) — unblocks A1, A2, A3, C1, C2.
2. **A1 areal interpolation**, **A2 exposure**, **A3 buffer count** — completes thesis replication.
3. **A4 expand_grid** + **B1–B5** ergonomics — independent, can run in parallel (wrangling track).
4. **C3 spatial weights** → **C4 autocorrelation** → **C5 spatial regression** — the spatial-econometrics arc.
5. **C6–C9** — opportunistic / lower priority.
