# Spatial replication — translate spatial ops to R (sf) / Python (geopandas)

**Spec context:** replication-fidelity (`specs/2026-06-12-replication-fidelity-design.md`)
Track P / D7. This closes the last replication gap: spatial **analyze** ops
(join/buffer/grid/distance) currently emit only a comment in the unified script
("use the Spatial tab exports") → genuinely non-reproducible. R validation
2026-06-14 confirmed: the spatial join became "export schools_barrios.csv from
Litux", breaking the one-script promise.
**Status:** DONE 2026-06-14 (structural; sf/geopandas runtime validation pending Franco). `spatialScript.js` translates all 10 geometric opTypes (geocode skipped — it is a pipeline step) to R sf + Python geopandas; wired into ReportingModule per-execution assembler; harness `spatialReplicationValidation.mjs` 27/27 green; X2 269/269 + build + lint green. Executor: Claude (Sonnet 4.6).
**Gate:** no R needed to build — deterministic translator + node harness;
Franco runs sf/geopandas to validate output.

## What already exists (do not rebuild)
- Each spatial analyze section already **logs a structured recipe** to the
  sessionLog: `appendLog({ module:"spatial", opType, params, label })`. 11 op
  types: spatial_join, buffer_assign, metric_buffer_create, metric_buffer_count,
  distance, grid_assign_existing, aggregate_to_grid, nearest_neighbor,
  crs_transform, boundary_distance, geocode.
- The unified-script "per-execution" assembler (ReportingModule ~995) already
  walks `plan.blocks`; spatial blocks arrive as `blk.kind === "spatial"` with
  `blk.events[0] = { opType, params, label }`. It currently pushes a comment.
- Track P map/plot translators (leaflet/folium, ggplot/folium) already cover the
  Map and Geo-plot tabs — this plan is ONLY the analyze ops.

## Deliverable
New `src/services/export/spatialScript.js`:
`transpileSpatialOp(opType, params, language, datasets)` → R (sf) / Python
(geopandas) code string (or an honest documented comment for ops that need an
interactive grid that can't be reconstructed from params alone).

## Op → target mapping (R sf / Py geopandas)
| opType | R (sf) | Python (geopandas) | Fidelity |
|--------|--------|--------------------|----------|
| spatial_join | `st_join(points, polys, join=st_within)` | `gpd.sjoin(pts, polys, predicate=...)` | full |
| distance | haversine/euclidean to ref point via `st_distance` | `pts.distance(ref)` / haversine | full |
| buffer_assign | flag within radius of ref (haversine ≤ r) | boolean mask | full |
| nearest_neighbor | `st_nearest_feature` + `st_distance` | `gpd.sjoin_nearest` | full |
| crs_transform | `st_transform(x, target)` | `.to_crs(target)` | full |
| boundary_distance | `st_distance(pts, st_boundary(poly))` | `.boundary.distance` | full |
| metric_buffer_create | `st_buffer(x, r)` in projected CRS | `.to_crs(m).buffer(r)` | full |
| metric_buffer_count | buffer + `st_intersects` count | sjoin + groupby count | full |
| grid_assign_existing | `st_join` to grid polys | `sjoin` to grid | full |
| aggregate_to_grid | `st_join` + `group_by(grid) summarise` | `sjoin` + `groupby.agg` | full |
| geocode | — (already a pipeline step `geocode`, translated by the step transpilers) | — | skip |

## Tasks
1. `spatialScript.js` — one translator per op for R + Python; Stata emits a
   documented "no native geometry — use R/Python or export the result" comment
   (Stata has no sf/geopandas equivalent; honest, not broken).
2. Wire into ReportingModule's per-execution assembler (replace the line-996
   comment with `transpileSpatialOp(ev.opType, ev.params, lang, dsMap)`; keep a
   fallback comment when the translator returns null).
3. Harness `src/services/export/__validation__/spatialReplicationValidation.mjs`
   (node): every logged opType has a non-comment R + Python translation (no
   "undefined"/"[object Object]"); a representative fixture per op.
4. Gates: harness green + X2 harness still green + `npm run build` + `lint:undef`.

## Out of scope (deferred)
- Stata geometry (no native support → documented comment).
- Map/geo-plot replication (Track P P2/P3 — already done).
- Reconstructing an interactively-drawn grid that was not saved as a dataset
  (params reference a `gridDsId`; if that dataset is in the session it loads,
  otherwise a comment notes it must be exported).

## Done criteria
`node src/services/export/__validation__/spatialReplicationValidation.mjs`
exits 0; the unified per-execution script emits real sf/geopandas for the
spatial ops instead of a comment; build + lint green. Franco validates the
emitted sf/geopandas in R/Python.
