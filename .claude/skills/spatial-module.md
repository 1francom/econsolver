---
name: spatial-module
description: Use when working on any spatial feature in EconSolver — SpatialTab.jsx, SpatialEngine.js, shapefile.js, maps, buffers, spatial joins, grids, nearest-neighbor, boundary distance, Leaflet rendering, or any geometry computation. Also triggers on Phase 11 spatial bugs.
---

# Spatial Module — EconSolver

## Overview

EconSolver users are R/sf users. Every spatial operation must match `sf` package semantics: WGS-84 coordinates, correct CRS handling, correct geometry types (POINT, POLYGON, MULTIPOLYGON). Leaflet 1.9.4 (CDN) is the map renderer.

## Reference PDFs — read before touching spatial code

Path: `C:\Franco\econsolver\.claude\skills\Spatial\`

Use the lookup table below — read only the PDF(s) for the task at hand:

| Task / Bug area | PDF(s) to read |
|-----------------|---------------|
| Geometry types, spatial predicates, WKT, simple features spec | `sf.pdf` |
| `st_*` function signatures, MULTIPOLYGON handling, CRS conversion | `sfCran.pdf` |
| Leaflet map init, tile layers, polygons, GeoJSON, event handling, L.geoJSON | `leaflet.pdf` |
| Polygon clipping / grid border artifacts (Sutherland-Hodgman) | `sf.pdf` (st_intersection) + `sfCran.pdf` |
| MULTIPOLYGON / GEOMETRYCOLLECTION parsing from WKT | `sf.pdf` section on geometry collections |
| Spatial RD running variable (boundary distance) | `sfCran.pdf` (st_distance to linestring) |
| Nearest neighbor / spatial join | `sfCran.pdf` (st_nearest_feature, st_join) |

Each PDF covers: geometry math, `sf` function signatures, canonical behavior → use as the spec when implementing or fixing spatial operations.

---

## Files — EconSolver spatial stack

| File | Role |
|------|------|
| `src/math/SpatialEngine.js` | Pure JS spatial math — haversine, buffer, grid, join, nearest-neighbor, boundary distance, WKT parsing |
| `src/components/tabs/SpatialTab.jsx` | React UI — tab panels (Buffer, Join, Grid, Analyze, Map), Leaflet map rendering, operation dispatch |
| `src/services/data/parsers/shapefile.js` | .shp + .dbf parser → WKT geometry column + attribute columns |
| `src/pipeline/runner.js` | Pipeline step dispatch — spatial steps wired here |
| `src/pipeline/registry.js` | STEP_REGISTRY — must stay in sync with runner.js |

---

## What is implemented in SpatialEngine.js

| Function | sf equivalent | Notes |
|----------|--------------|-------|
| `haversine(lat1,lon1,lat2,lon2)` | `st_distance` | Great-circle km; use for WGS-84 |
| `euclidean(x1,y1,x2,y2)` | `st_distance` | Projected CRS only (UTM, metres) |
| `isWithinBuffer` | `st_within(st_buffer(...))` | Boolean; uses haversine |
| `assignBuffer` | `st_join` + `st_buffer` | Adds 0/1 column |
| `assignDistance` | `st_distance` | Adds km column to each row |
| `assignRectGrid` | `st_make_grid` | Rectangular cells by lat/lon step |
| `assignH3Grid` | H3 hex grid | Approx hex via rect fallback |
| `pointInPolygon` | `st_within` | Ray-casting; handles WKT POLYGON |
| `spatialJoin` | `st_join` | Assigns polygon attributes to points |
| `nearestNeighbor` | `st_nearest_feature` | Brute-force O(n·m); haversine |
| `assignBoundaryDistance` | `st_distance` to boundary | Signed distance for Spatial RD |
| `makeGrid` | `st_make_grid` clipped | Rect cells clipped to polygon boundary |
| `aggregateToGrid` | `aggregate` + grid | count/sum/mean of points per cell |
| `parseWKTPolygon` | `st_as_sfc` | WKT → ring arrays for Leaflet |

Leaflet loaded via `loadLeaflet()` singleton CDN promise in SpatialTab.jsx. WKT → Leaflet via `wktToLeaflet()`.

---

## Known bugs to fix (Phase 11)

### 1. MULTIPOLYGON / GEOMETRYCOLLECTION not rendered
- **Symptom**: Polygons from shapefiles with MULTIPOLYGON WKT silently fail to render on the Leaflet map.
- **Root cause**: `parseWKTPolygon` only handles `POLYGON(...)` — skips `MULTIPOLYGON(...)` and `GEOMETRYCOLLECTION(...)`.
- **Fix**: Parse MULTIPOLYGON as an array of polygon rings. Read `sf.pdf` section on geometry collections for the WKT grammar. `L.polygon` accepts multiple ring arrays.
- **sf reference**: `st_cast(x, "POLYGON")` decomposes MULTIPOLYGON → use same logic in JS.

### 2. Grid border clipping artifacts
- **Symptom**: `makeGrid` produces cells that extend beyond the polygon boundary — grid cells are rectangular but boundary is irregular.
- **Root cause**: `makeGrid` creates a full rectangular grid, then `clipRectToRings` clips each cell using Sutherland-Hodgman. The clipping algorithm has an edge case when re-entry happens on the same edge as exit.
- **Fix**: The `clipRectToRings` same-edge re-entry bug was partially fixed in commit `ff2c34d`. Verify fix by testing concave polygons. Read `sfCran.pdf` `st_intersection` section for reference clipping semantics.
- **Test**: L-shaped polygon, grid step = 1 degree. No cell should extend outside the L boundary.

### 3. Per-operation dataset selector in Analyze tab
- **Symptom**: The Analyze tab always uses the primary dataset. There is no way to pick a secondary dataset (e.g., polygon boundaries from a second file) for the operation target.
- **Fix**: Add a dataset selector dropdown in the Analyze tab UI (similar to MergeTab's dataset selectors). Wire to `useSessionState()` datasets registry.

---

## Key math — quick reference

### Haversine (great-circle distance)
```
a = sin²(Δlat/2) + cos(lat1)·cos(lat2)·sin²(Δlon/2)
d = 2R · arcsin(√a),  R = 6371 km
```
Use for any WGS-84 coordinate pair. **Never use Euclidean on lat/lon.**

### Point-in-polygon (ray-casting)
Cast a horizontal ray from the test point. Count polygon edge crossings — odd = inside, even = outside. Handles concave polygons. Does NOT handle holes (document the limitation for complex polygons).

### Sutherland-Hodgman polygon clipping
Clips a subject polygon against each edge of the clip polygon in turn. For each clip edge:
- Inside vertex → keep
- Outside vertex → drop
- Crossing edge → compute intersection point and insert

Same-edge re-entry bug: when consecutive vertices are both on the clip edge (not inside or outside), the algorithm can produce a spurious crossing. Guard: check that the intersection point is strictly between edge endpoints.

### Spatial join (point-in-polygon assignment)
For each point row, test `pointInPolygon` against every polygon. Assign matching polygon attributes. O(n·m) — warn user if n·m > 1M.

### Grid assignment
Rectangular: `cellRow = floor((lat - latMin) / latStep)`, `cellCol = floor((lon - lonMin) / lonStep)`. Cell ID = `"row_col"` string.

### Boundary distance (Spatial RD)
Running variable = signed distance from polygon boundary. Negative inside, positive outside. Nearest boundary segment using haversine to each segment midpoint.

---

## Leaflet conventions (SpatialTab.jsx)

- Load via `loadLeaflet()` — singleton CDN promise, never duplicate
- Tile layer: `https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png`
- Map cleanup: always `map.remove()` in effect cleanup to avoid "Map container is already initialized" crash
- WKT POLYGON → `wktToLeaflet()` → `L.polygon(rings).addTo(map)`
- WKT MULTIPOLYGON → parse each polygon part, render as separate `L.polygon` layers or use `L.geoJSON`
- Points → `L.circleMarker([lat, lon], opts).addTo(map)`
- Fit bounds: `map.fitBounds(L.latLngBounds(allPoints))` after adding all layers
- **WKT lon/lat vs Leaflet lat/lon**: WKT is `lon lat`; Leaflet wants `[lat, lon]`. `wktToLeaflet()` handles this swap — don't swap again.

---

## CRS rules

| Data type | Correct function |
|-----------|----------------|
| WGS-84 lat/lon (most CSVs, shapefiles) | `haversine` |
| Projected (UTM, metres) | `euclidean` |
| Mixed | Project to WGS-84 first; never mix |

When user provides coordinates, assume WGS-84 unless column names or metadata say otherwise.

---

## Coding rules for spatial changes

1. `SpatialEngine.js` is pure JS — no React imports, no UI code.
2. All new spatial operations go in `SpatialEngine.js`; UI dispatch in `SpatialTab.jsx`.
3. If adding a new pipeline step type: add to `runner.js` AND `registry.js` in the same patch.
4. Read the relevant PDF section before implementing any new geometry operation.
5. Surgical `Edit` patches only — never rewrite entire files.
6. After fixing a geometry bug, test with both convex and concave polygon examples.

---

## Common mistakes

- **Using Euclidean on lat/lon** — gives wrong distances; always use `haversine`.
- **Leaflet map not removed on unmount** — "Map container is already initialized" crash; always call `map.remove()` in effect cleanup.
- **WKT lon/lat vs Leaflet lat/lon** — `wktToLeaflet()` already handles the swap; don't swap twice.
- **Forgetting MULTIPOLYGON** — shapefiles often have MULTIPOLYGON geometry; `parseWKTPolygon` must handle it.
- **O(n·m) join on large data** — warn user; DuckDB spatial is the eventual fix.
- **Polygon holes** — ray-casting ignores holes; document this limitation.
- **Same-edge re-entry in Sutherland-Hodgman** — produces spurious extra vertices on grid cell boundaries; guard with strict endpoint check.
