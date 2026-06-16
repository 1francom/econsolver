// ─── Spatial replication harness ─────────────────────────────────────────────
// Plan: docs/superpowers/plans/2026-06-14-spatial-replication.md
// `node src/services/export/__validation__/spatialReplicationValidation.mjs`
//
// Every logged spatial opType must produce real R (sf) + Python (geopandas)
// code — non-empty, no fallback-only comment, no undefined/[object Object].

import { transpileSpatialOp, spatialScriptImports } from "../spatialScript.js";

let pass = 0, fail = 0;
const check = (n, c, extra) => {
  if (c) { pass++; console.log("  [pass]", n); }
  else   { fail++; console.log("  [FAIL]", n, extra != null ? "→ " + extra : ""); }
};

const GARBAGE = /undefined|\[object Object\]/;
const DATASETS = {
  POLY: { name: "barrios", filename: "barrios.csv" },
  GRID: { name: "grid_500m", filename: "grid.csv" },
  REF:  { name: "hospitals", filename: "hospitals.csv" },
};

// Representative params per logged opType (mirrors the appendLog calls).
const FIX = {
  spatial_join:        { latCol: "lat", lonCol: "lon", polyDsId: "POLY", wktCol: "geometry", joinCols: ["comuna", "area"], predicate: "within" },
  distance:            { latCol: "lat", lonCol: "lon", refLat: -34.6, refLon: -58.4, outCol: "dist_center", metric: "haversine" },
  buffer_assign:       { latCol: "lat", lonCol: "lon", refLat: -34.6, refLon: -58.4, radius: 1000, outCol: "near_center" },
  nearest_neighbor:    { latCol: "lat", lonCol: "lon", refDsId: "REF", refLatCol: "h_lat", refLonCol: "h_lon", outDist: "nn_dist", outIdx: "nn_idx", metric: "haversine" },
  crs_transform:       { mode: "point", xCol: "x", yCol: "y", outX: "lon", outY: "lat", source: "EPSG:22185", target: "EPSG:4326" },
  boundary_distance:   { latCol: "lat", lonCol: "lon", polyDsId: "POLY", wktCol: "geometry", outPrefix: "boundary" },
  metric_buffer_create:{ latCol: "lat", lonCol: "lon", radius: 500, crs: "EPSG:32721" },
  metric_buffer_count: { latCol: "lat", lonCol: "lon", radius: 500, gridDsId: "GRID", wktCol: "geometry", outCol: "n_pts" },
  grid_assign_existing:{ latCol: "lat", lonCol: "lon", outCol: "cell", gridDsId: "GRID", wktCol: "geometry", gridIdCol: "grid_id", extraCols: ["zone"] },
  aggregate_to_grid:   { mode: "grid", gridDsId: "GRID", wktCol: "geometry", outCol: "mean_price", fn: "mean", valueCol: "price", latCol: "lat", lonCol: "lon" },
  grid_create_map:     { mode: "generate", sourceDatasetId: "POLY", boundaryCol: "geometry", cellSize: 500, clipBorder: true, gridDsId: "GRID", gridName: "grid_500m", wktCol: "geometry", gridIdCol: "grid_id" },
};

console.log("── spatial op → R / Python coverage ──");
for (const [opType, params] of Object.entries(FIX)) {
  for (const lang of ["r", "python"]) {
    const code = transpileSpatialOp(opType, params, lang, DATASETS);
    const ok = typeof code === "string" && code.trim().length > 0
      && /[a-z]/.test(code.replace(/^#.*$/gm, "").replace(/^\s*$/gm, ""))  // has real (non-comment) code
      && !GARBAGE.test(code);
    check(`${lang}: ${opType}`, ok, code ? code.split("\n").find(l => GARBAGE.test(l)) ?? (ok ? "" : "comment-only") : "null");
  }
}

console.log("\n── crs_transform wkt mode ──");
{
  const r = transpileSpatialOp("crs_transform", { mode: "wkt", wktCol: "geom", outWkt: "geom_4326", source: "EPSG:22185", target: "EPSG:4326" }, "r", {});
  check("r: crs_transform wkt mode emits st_transform", /st_transform/.test(r) && !GARBAGE.test(r));
}

console.log("\n── geocode is skipped (it is a pipeline step) ──");
check("geocode → null in all languages",
  transpileSpatialOp("geocode", {}, "r") === null && transpileSpatialOp("geocode", {}, "python") === null);

console.log("\n── Stata emits an honest no-geometry comment ──");
{
  const s = transpileSpatialOp("spatial_join", FIX.spatial_join, "stata", DATASETS);
  check("stata: documented comment, no garbage", /no native geometry/i.test(s) && !GARBAGE.test(s));
}

console.log("\n── referenced datasets resolve to df_<name> ──");
{
  const r = transpileSpatialOp("spatial_join", FIX.spatial_join, "r", DATASETS);
  check("r: poly dataset resolves to df_barrios", /df_barrios/.test(r), r.split("\n")[2]);
  const rUnknown = transpileSpatialOp("spatial_join", { ...FIX.spatial_join, polyDsId: "MISSING" }, "r", DATASETS);
  // Unknown refs must resolve to a READABLE, role-based placeholder (never a raw
  // id) + a "provide this dataset" NOTE — not df_MISSING / df_<uuid>.
  check("r: unknown dataset gets a readable placeholder + note",
    /\bpolygons\b/.test(rUnknown) && /NOTE:/.test(rUnknown) && !/MISSING/.test(rUnknown), rUnknown.split("\n")[0]);
}

console.log("\n── points dataset + NA-coord guard ──");
{
  const src = { v: "df_schools", known: true };
  const r = transpileSpatialOp("aggregate_to_grid", FIX.aggregate_to_grid, "r", DATASETS, src);
  check("r: binds resolved points var (no bare df)", /df_schools/.test(r) && !/\bsf::st_as_sf\(df,/.test(r), r.split("\n")[1]);
  check("r: drops NA coords before st_as_sf", /is\.na\(/.test(r) && r.indexOf("is.na(") < r.indexOf("st_as_sf"));
  const py = transpileSpatialOp("aggregate_to_grid", FIX.aggregate_to_grid, "python", DATASETS, src);
  check("python: drops NA coords (dropna)", /dropna\(subset=/.test(py));
  const rNoSrc = transpileSpatialOp("aggregate_to_grid", FIX.aggregate_to_grid, "r", DATASETS, { v: "points_df", known: false });
  check("r: unknown points var gets a NOTE", /NOTE: bind 'points_df'/.test(rNoSrc));
}

console.log("\n── grid_create_map regenerates the grid in-script ──");
{
  const r = transpileSpatialOp("grid_create_map", FIX.grid_create_map, "r", DATASETS);
  check("r: builds grid via st_make_grid over the boundary", /st_make_grid\(/.test(r) && /df_barrios/.test(r));
  check("r: clips to boundary when clipBorder", /st_intersection\(/.test(r));
  check("r: output binds to the grid's own name (grid_500m)", /grid_500m <- data\.frame\(grid_id/.test(r));
  check("r: no 'export this' note (grid is built, not loaded)", !/export it from Litux/.test(r) && !/NOTE: bind/.test(r));
  const rNoClip = transpileSpatialOp("grid_create_map", { ...FIX.grid_create_map, clipBorder: false }, "r", DATASETS);
  check("r: skips clip when clipBorder=false", !/st_intersection\(/.test(rNoClip));
  const rLatlon = transpileSpatialOp("grid_create_map", { mode: "latlon", sourceDatasetId: "REF", latCol: "lat", lonCol: "lon", cellSize: 250, gridDsId: "GRID", gridName: "grid_500m" }, "r", DATASETS);
  check("r: latlon mode grids the points bbox", /st_make_grid\(\.pts/.test(rLatlon) && /df_hospitals/.test(rLatlon));
  const py = transpileSpatialOp("grid_create_map", FIX.grid_create_map, "python", DATASETS);
  check("python: tiles boxes + emits WKT geometry", /shapely\.geometry import box/.test(py) && /to_wkt\(\)/.test(py) && /df_barrios/.test(py));
}

console.log("\n── imports helper ──");
check("r imports include sf", spatialScriptImports("r").some(l => /library\(sf\)/.test(l)));
check("python imports include geopandas", spatialScriptImports("python").some(l => /import geopandas/.test(l)));

console.log(`\nspatialReplication: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
