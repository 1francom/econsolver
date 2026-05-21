# Fase V1 — Spatial Module Validation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Track A-style validation pattern applied to a non-estimator module.

**Track:** B — Module hardening
**Status:** Queued; can start in parallel with Fase 5 once Fase 4b ships.
**Blocks:** nothing in Track A. Independent.

**Goal:** Validate every spatial operation in `src/math/SpatialEngine.js` and `src/services/data/parsers/shapefile.js` against R `sf` at documented tolerance. Fix every divergence. Result: a passing harness at `window.__validation.faseV1` and a "spatial: validated" line in CLAUDE.md.

**Why this matters:** spatial features have known bugs (MULTIPOLYGON parsing, grid clipping at irregular borders, per-op dataset selector — per memory). The estimator track has 6dp/4dp R parity; spatial does not yet. Pre-launch this gap closes.

**Tech Stack:** R `sf` 1.0+, `h3jsr`, `lwgeom` for distance/area; EconSolver harness at the browser console.

---

## File Structure

**Create:**
- `src/services/data/__validation__/faseV1RValidation.R` — produces `faseV1_data.csv` (or several CSVs: points, polygons, grids) plus `faseV1Benchmarks.json`.
- `src/services/data/__validation__/faseV1Validation.js` — `runFaseV1NumericalValidation()` exposed at `window.__validation.faseV1`.
- `src/services/data/__validation__/faseV1_truthset.geojson` — small geocoding ground-truth file (LMU, Marienplatz, Olympiapark, …) with hand-verified WGS84 coords.

**Modify (only if validation finds bugs):**
- `src/math/SpatialEngine.js`
- `src/services/data/parsers/shapefile.js`
- `src/components/tabs/SpatialTab.jsx` (per-op dataset selector flagged in memory)

---

## API surface to validate

From `src/math/SpatialEngine.js`:

| Function | Signature | R reference |
|---|---|---|
| `haversine` | `(lat1, lon1, lat2, lon2) → km` | `sf::st_distance(p1, p2, by_element=TRUE)` with `longlat=TRUE` |
| `euclidean` | `(x1, y1, x2, y2) → units` | `sqrt(sum((c(x1,y1)-c(x2,y2))^2))` |
| `isWithinBuffer` | `(lat, lon, cLat, cLon, radiusKm) → bool` | `st_distance(pt, ctr, longlat=TRUE) <= radiusKm` |
| `assignBuffer` | `(rows, latCol, lonCol, cLat, cLon, radiusKm, outCol) → rows` | `st_buffer + st_intersects` |
| `assignDistance` | `(rows, latCol, lonCol, refLat, refLon, outCol)` | `st_distance(points, ref, longlat=TRUE)` |
| `assignBoundaryDistance` | `(pointRows, latCol, lonCol, polyRows, wktCol, outPrefix)` | `st_distance(points, st_boundary(polygons))` |
| `assignRectGrid` | `(rows, latCol, lonCol, cellSizeKm, outCol)` | manual rectangular grid + `st_intersects` |
| `assignH3Grid` | `(rows, latCol, lonCol, resolution, outCol)` | `h3jsr::point_to_cell(points, res=resolution)` |
| `parseWKTPolygon` | `(wkt) → polygon coord array` | `sf::st_as_sfc(wkt)` |
| `pointInPolygon` | `(lat, lon, polygonWKT) → bool` | `sf::st_within(point, polygon)` |
| `spatialJoin` | `(pointRows, latCol, lonCol, polyRows, wktCol, joinCols) → rows` | `sf::st_join(points_sf, polygons_sf, join=st_within)` |
| `nearestNeighbor` | `(rows, latCol, lonCol, refRows, refLatCol, refLonCol, joinCols)` | `sf::st_nearest_feature` + `st_distance` |
| `makeGrid` | `(boundaryWkt, cellsizeMeters, clipBorder) → grid WKTs` | `sf::st_make_grid(polygon, cellsize, square=TRUE)` (+ `st_intersection` if `clipBorder`) |
| `aggregateToGrid` | `(gridRows, gridWktCol, pointRows, latCol, lonCol, aggSpecs)` | `sf::st_join` + `dplyr::summarise` per agg spec |

From `src/services/data/parsers/shapefile.js`:
- `parseShapefile` — `sf::st_read`. MULTIPOLYGON support is the known bug spot.

Geocoding (`src/components/tabs/SpatialTab.jsx` `GeocodeSection`):
- Photon/Nominatim queries. Cache keyed by address. No R reference; instead a hand-verified truth set.

---

## Task 1 — R validation script

**Files:** `src/services/data/__validation__/faseV1RValidation.R`

- [ ] **Step 1: Generate ground-truth datasets**

```r
library(sf); library(h3jsr); library(jsonlite)
set.seed(20260522)

# 200 random points in München bbox: lat ∈ [48.05, 48.25], lon ∈ [11.40, 11.80]
n <- 200
pts <- data.frame(
  id  = 1:n,
  lat = runif(n, 48.05, 48.25),
  lon = runif(n, 11.40, 11.80),
  attr_a = rnorm(n),
  attr_b = sample(letters, n, replace=TRUE)
)
write.csv(pts, "faseV1_points.csv", row.names=FALSE)

# 5 polygons (München districts as crude bboxes)
polys <- data.frame(
  poly_id = c("MX","SW","SO","NW","NO"),
  wkt = c(
    "POLYGON((11.40 48.05, 11.60 48.05, 11.60 48.15, 11.40 48.15, 11.40 48.05))",
    "POLYGON((11.40 48.15, 11.60 48.15, 11.60 48.25, 11.40 48.25, 11.40 48.15))",
    "POLYGON((11.60 48.05, 11.80 48.05, 11.80 48.15, 11.60 48.15, 11.60 48.05))",
    "POLYGON((11.60 48.15, 11.80 48.15, 11.80 48.25, 11.60 48.25, 11.60 48.15))",
    "POLYGON((11.50 48.10, 11.55 48.10, 11.55 48.20, 11.50 48.20, 11.50 48.10))"
  )
)
write.csv(polys, "faseV1_polys.csv", row.names=FALSE)
```

- [ ] **Step 2: Compute R-side benchmarks**

For each cell, persist sample of `≥ 20` outputs (not the full 200 — we just need to anchor each function):

```r
bench <- list()

pts_sf  <- st_as_sf(pts, coords=c("lon","lat"), crs=4326)
polys_sf <- st_as_sf(polys, wkt="wkt", crs=4326)

# haversine: 20 pairs (i, i+1)
hv_pairs <- lapply(1:20, function(i) {
  list(i=i, j=i+1,
       d_km = as.numeric(st_distance(pts_sf[i,], pts_sf[i+1,])) / 1000)
})
bench$haversine <- hv_pairs

# assignBuffer: center (48.15, 11.60) radius 5 km
ctr <- st_sfc(st_point(c(11.60, 48.15)), crs=4326)
bench$buffer_5km <- list(
  ctr_lat = 48.15, ctr_lon = 11.60, radius_km = 5,
  in_buffer_ids = pts_sf$id[as.logical(st_intersects(pts_sf, st_buffer(ctr, 5000), sparse=FALSE))]
)

# assignDistance: ref (48.15, 11.60)
bench$dist_to_center <- data.frame(
  id = pts_sf$id,
  d_km = as.numeric(st_distance(pts_sf, ctr)) / 1000
)

# spatialJoin: assign each point to its containing poly
joined <- st_join(pts_sf, polys_sf, join=st_within)
bench$spatial_join <- data.frame(id = joined$id, poly_id = joined$poly_id)

# H3 at resolution 8
bench$h3_res8 <- data.frame(
  id = pts$id,
  cell = h3jsr::point_to_cell(pts_sf, res=8)
)

# rectGrid: 1 km cells over München bbox
# (just persist first 5 cell IDs per point for a stable hash)
# ... etc for makeGrid, aggregateToGrid, boundaryDistance, nearestNeighbor

writeLines(toJSON(bench, auto_unbox=TRUE, digits=10), "faseV1Benchmarks.json")
```

- [ ] **Step 3: Geocoding truth set**

Hand-curate `faseV1_truthset.geojson` (or `.json`) with 10–15 known landmarks:

```json
{
  "landmarks": [
    { "name": "LMU Hauptgebäude", "address": "Geschwister-Scholl-Platz 1, 80539 München",
      "truth": { "lat": 48.15042, "lon": 11.58093, "tolerance_m": 50 } },
    { "name": "Marienplatz",      "address": "Marienplatz, 80331 München",
      "truth": { "lat": 48.13726, "lon": 11.57549, "tolerance_m": 50 } }
  ]
}
```

---

## Task 2 — Browser harness

**Files:** `src/services/data/__validation__/faseV1Validation.js`

- [ ] **Step 1: Load datasets in the harness**

Pseudocode:

```js
import * as Sp from "../../../math/SpatialEngine.js";
import { parseShapefile } from "../parsers/shapefile.js";

export async function runFaseV1NumericalValidation() {
  const points = await fetchCSV("faseV1_points.csv");
  const polys  = await fetchCSV("faseV1_polys.csv");
  const bench  = await fetchJSON("faseV1Benchmarks.json");
  const truth  = await fetchJSON("faseV1_truthset.geojson");
  const report = [];

  // 1. Haversine — relative 1e-6, absolute 1 m
  for (const hv of bench.haversine) {
    const a = points[hv.i - 1], b = points[hv.j - 1];
    const got = Sp.haversine(a.lat, a.lon, b.lat, b.lon);
    const expected = hv.d_km;
    const absM = Math.abs(got - expected) * 1000;
    const relErr = Math.abs(got - expected) / expected;
    report.push({ cell: `haversine_${hv.i}_${hv.j}`,
                  pass: absM <= 1 || relErr <= 1e-6,
                  got, expected, absM, relErr });
  }

  // 2. assignBuffer — exact match on assignment set
  const buf = Sp.assignBuffer(points, "lat", "lon",
                              bench.buffer_5km.ctr_lat,
                              bench.buffer_5km.ctr_lon,
                              bench.buffer_5km.radius_km,
                              "in_buf");
  const gotIds = buf.filter(r => r.in_buf).map(r => r.id).sort();
  const expIds = bench.buffer_5km.in_buffer_ids.sort();
  report.push({ cell: "assignBuffer_5km",
                pass: JSON.stringify(gotIds) === JSON.stringify(expIds),
                gotIds, expIds });

  // 3. assignDistance — relative 1e-6 per row, summarized
  // 4. spatialJoin — exact match on (id, poly_id)
  // 5. H3 — exact match on cell strings
  // 6. nearestNeighbor — exact match on NN id, distance at 1e-6 rel
  // 7. makeGrid — count + total area ratio at 1e-6
  // 8. aggregateToGrid — per-cell sum/mean at 1e-6
  // 9. boundaryDistance — sample at 1e-6 rel

  // 10. Geocoding — truth set
  for (const lm of truth.landmarks) {
    // Run the actual geocode call (or fixture cached result)
    const got = await geocode(lm.address);
    const d  = Sp.haversine(got.lat, got.lon, lm.truth.lat, lm.truth.lon) * 1000;
    report.push({ cell: `geocode_${lm.name}`,
                  pass: d <= lm.truth.tolerance_m,
                  d_m: d });
  }

  return report;
}
```

- [ ] **Step 2: Expose at `window.__validation.faseV1`**

Mirror the convention from Fase 4 / 3b validation harnesses. Returns the report array; the dev console formats it.

- [ ] **Step 3: Edge cases**

Add explicit failing-mode cells to the harness:
- Point exactly on polygon vertex → which polygon assigned?
- Point on grid cell boundary → tie-breaker behavior must match R.
- MULTIPOLYGON in shapefile (load `faseV1_multipoly.shp` if generated by `sf::st_write`) — known bug spot per memory.
- Antimeridian crossing (180° longitude) — should fall back gracefully; not a launch blocker but document behavior.
- Polar latitudes (|lat| > 85°) — haversine still valid but document.

---

## Task 3 — Fix discrepancies

For each failing cell:

- [ ] **Diagnose** which side is wrong (R or EconSolver). Default assumption: R is correct.
- [ ] **Patch** the EconSolver function. Use surgical Edit, not full rewrites (per project memory).
- [ ] **Re-run** the harness; assert all cells now pass.
- [ ] **Document** the bug in CLAUDE.md "Key bugs fixed" with the fix description.

**Likely failure points (from memory + skill notes):**
- **Shapefile MULTIPOLYGON:** parser may discard rings beyond the first. Fix in `shapefile.js`.
- **Grid clipping:** `makeGrid` with irregular boundary may emit grid cells that protrude beyond polygon. Sutherland-Hodgman clipping per spatial-module skill notes — verify implementation.
- **Per-op dataset selector:** UX bug, not numerical. May surface during integration smoke test (Task 5).
- **H3 boundary cells:** verify `h3jsr` and EconSolver agree on which H3 cell contains a point on a hex edge.

---

## Task 4 — CLAUDE.md update + commits

- [ ] **Step 1:** Add a "Spatial: validated vs R sf 1.0" line to the "Estimators implemented"-style table in CLAUDE.md (consider a new "Modules validated" subsection).
- [ ] **Step 2:** For each bug discovered, append to "Key bugs fixed".
- [ ] **Step 3:** Commit sequence:
  1. `test(spatial): Fase V1 — R sf golden values`
  2. `test(spatial): Fase V1 — browser harness`
  3. `fix(spatial): <bug 1>` (one commit per bug)
  4. ...
  5. `docs: Fase V1 — spatial validation complete`

---

## Tolerances (summary)

| Operation | Tolerance |
|---|---|
| Distance (haversine) | 1 m absolute or 1e-6 relative |
| Distance (planar / euclidean) | 1e-9 relative |
| Polygon area | 1e-6 relative |
| Point-in-polygon | exact assignment |
| H3 cell assignment | exact string match |
| Grid cell ID | exact match on count + total area |
| NN id | exact; NN distance 1e-6 relative |
| Geocoding | ≤ 50 m on known landmarks |

## Risks

| Risk | Mitigation |
|---|---|
| `sf` and EconSolver use different earth radii (R=6378.137 vs R=6371) | Document EconSolver's radius constant; if mismatch, change EconSolver to match `sf`. Apply uniformly. |
| H3 versions differ between `h3jsr` and EconSolver's H3 implementation | Pin H3 version in package.json; document in plan. |
| Geocoding provider returns variable results | Cache responses to a fixture file; tolerance ≥ 50 m absorbs provider drift. |
| Shapefile MULTIPOLYGON test data hard to construct in pure R | Use `sf::st_write` on a constructed `sfc_MULTIPOLYGON` object; commit the resulting `.shp` + `.dbf` to the repo. |

## Out of scope (post-launch)

- Spatial autoregressive models (SAR / SEM) — math/spatial-econometrics is post-MVP.
- 3D / altitude support.
- WGS84-to-other-CRS transformations beyond what `parseWKTPolygon` already does.
- Geocoding accuracy beyond 50 m (Photon/Nominatim precision limit).

## Pre-merge gate — Supabase feedback check (MANDATORY)

Before marking this fase complete, run the `feedback-collector` agent to pull unprocessed rows from the Supabase `feedback` table into `ClaudeFB.md`. Then:

1. **Filter** feedback by scope tags that touch this fase: `spatial`, `map`, `shapefile`, `geocoding`, `buffer`, `grid`, `H3`, `distance`, `Leaflet`.
2. For every open row in scope:
   - **Fix-now:** address before concluding.
   - **Fix-later:** file in `BugTriage.md` with a `FaseV1 →` reference.
   - **Wontfix:** document rationale in `ClaudeFB.md` and resolve in Supabase.
3. Concluding this fase without an empty in-scope queue in `ClaudeFB.md` is a blocker.

The harness covers numerical parity; user-reported issues catch UX-level discrepancies (wrong layer order, missing tooltips, dataset-selector confusion) the harness cannot see.

---

## Done criteria

1. Harness `window.__validation.faseV1()` returns all-pass on the 60+ cells (≥ 20 haversine + ≥ 10 buffer + 200 distance summary + 200 join + 200 H3 + 10 NN + 10 grid + 10 aggregateToGrid + 5 boundary + 10 geocoding).
2. Every bug found has a referenced commit.
3. CLAUDE.md updated.
4. Manual smoke test in SpatialTab: load a shapefile, draw a buffer, see correct count of points inside.

---

**Author:** Franco Medero · **Plan drafted:** 2026-05-21
