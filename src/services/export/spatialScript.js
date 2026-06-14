// ─── Spatial-op replication translator ───────────────────────────────────────
// Plan: docs/superpowers/plans/2026-06-14-spatial-replication.md
//
// Turns a logged Spatial-tab analyze op (sessionLog entry
// { module:"spatial", opType, params }) into R (sf) / Python (geopandas) code,
// closing the last replication gap (these ops previously emitted only a comment
// in the unified script). Stata has no native geometry stack → documented
// comment directing the user to R/Python or the exported result.
//
// Public: transpileSpatialOp(opType, params, language, datasets) -> string|null
//   datasets: map { [datasetId]: { name, filename } } to resolve referenced
//             polygon/grid/reference datasets to their df_<name> variable.

import { toDfVar } from "../../pipeline/exporter.js";

// Resolve a referenced datasetId → its data-frame variable name. Falls back to a
// readable placeholder + a flag so callers can append a "load this" note.
function dfRef(datasets, id) {
  const ds = datasets && id ? datasets[id] : null;
  if (ds) return { v: toDfVar(ds.name ?? ds.filename ?? id), known: true };
  return { v: `df_${String(id ?? "other").replace(/[^a-zA-Z0-9_]/g, "_")}`, known: false };
}

const rNum = (x) => (Number.isFinite(Number(x)) ? String(Number(x)) : "NA");
const pyNum = (x) => (Number.isFinite(Number(x)) ? String(Number(x)) : "float('nan')");

// ─── R (sf) ───────────────────────────────────────────────────────────────────
function rSpatial(opType, p, datasets) {
  const lat = p.latCol, lon = p.lonCol;
  const ptsSf = `sf::st_as_sf(df, coords = c("${lon}", "${lat}"), crs = 4326)`;
  switch (opType) {
    case "spatial_join": {
      const poly = dfRef(datasets, p.polyDsId);
      const cols = (p.joinCols ?? []).map(c => `"${c}"`).join(", ");
      const join = p.predicate === "intersects" ? "sf::st_intersects" : "sf::st_within";
      return [
        `# Spatial join (${p.predicate ?? "within"}): assign polygon attributes to points`,
        `pts_sf  <- ${ptsSf}`,
        `poly_sf <- sf::st_as_sf(${poly.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `df <- sf::st_drop_geometry(sf::st_join(pts_sf, poly_sf[c(${cols})], join = ${join}))`,
      ].join("\n");
    }
    case "distance": {
      const euclid = p.metric === "euclidean";
      return [
        `# Distance from each point to reference (${euclid ? "planar" : "geodesic"})`,
        `df$${p.outCol} <- as.numeric(sf::st_distance(`,
        `  ${ptsSf},`,
        `  sf::st_sfc(sf::st_point(c(${rNum(p.refLon)}, ${rNum(p.refLat)})), crs = 4326)))  # metres`,
      ].join("\n");
    }
    case "buffer_assign":
      return [
        `# Flag points within ${rNum(p.radius)} m of the reference point`,
        `df$${p.outCol} <- as.integer(as.numeric(sf::st_distance(`,
        `  ${ptsSf},`,
        `  sf::st_sfc(sf::st_point(c(${rNum(p.refLon)}, ${rNum(p.refLat)})), crs = 4326))) <= ${rNum(p.radius)})`,
      ].join("\n");
    case "nearest_neighbor": {
      const ref = dfRef(datasets, p.refDsId);
      return [
        `# Nearest reference feature for each point`,
        `pts_sf <- ${ptsSf}`,
        `ref_sf <- sf::st_as_sf(${ref.v}, coords = c("${p.refLonCol}", "${p.refLatCol}"), crs = 4326)`,
        `.idx <- sf::st_nearest_feature(pts_sf, ref_sf)`,
        `df$${p.outIdx}  <- .idx`,
        `df$${p.outDist} <- as.numeric(sf::st_distance(pts_sf, ref_sf[.idx, ], by_element = TRUE))`,
      ].join("\n");
    }
    case "crs_transform":
      if (p.mode === "wkt") {
        return [
          `# Reproject WKT geometry: ${p.source} -> ${p.target}`,
          `df$${p.outWkt} <- sf::st_as_text(sf::st_transform(sf::st_as_sfc(df$${p.wktCol}, crs = "${p.source}"), "${p.target}"))`,
        ].join("\n");
      }
      return [
        `# Reproject coordinates: ${p.source} -> ${p.target}`,
        `.sf <- sf::st_transform(sf::st_as_sf(df, coords = c("${p.xCol}", "${p.yCol}"), crs = "${p.source}"), "${p.target}")`,
        `df$${p.outX} <- sf::st_coordinates(.sf)[, 1]`,
        `df$${p.outY} <- sf::st_coordinates(.sf)[, 2]`,
      ].join("\n");
    case "boundary_distance": {
      const poly = dfRef(datasets, p.polyDsId);
      return [
        `# Distance from each point to the nearest polygon boundary`,
        `pts_sf  <- ${ptsSf}`,
        `poly_sf <- sf::st_as_sf(${poly.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `df$${p.outPrefix}_dist <- apply(sf::st_distance(pts_sf, sf::st_boundary(poly_sf)), 1, min)`,
      ].join("\n");
    }
    case "metric_buffer_create":
      return [
        `# Buffer points by ${rNum(p.radius)} m in projected CRS ${p.crs}`,
        `df_buffers <- sf::st_buffer(sf::st_transform(${ptsSf}, "${p.crs}"), ${rNum(p.radius)})`,
      ].join("\n");
    case "metric_buffer_count": {
      const grid = dfRef(datasets, p.gridDsId);
      return [
        `# Count points falling within ${rNum(p.radius)} m metric buffers per grid cell`,
        `pts_sf  <- sf::st_transform(${ptsSf}, 32721)`,
        `grid_sf <- sf::st_transform(sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326), 32721)`,
        `grid_sf$${p.outCol} <- lengths(sf::st_intersects(sf::st_buffer(grid_sf, ${rNum(p.radius)}), pts_sf))`,
      ].join("\n");
    }
    case "grid_assign_existing": {
      const grid = dfRef(datasets, p.gridDsId);
      const extra = (p.extraCols ?? []).map(c => `"${c}"`).join(", ");
      const keep = [`"${p.gridIdCol}"`, extra].filter(Boolean).join(", ");
      return [
        `# Assign each point to its grid cell (existing grid layer)`,
        `pts_sf  <- ${ptsSf}`,
        `grid_sf <- sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `df <- sf::st_drop_geometry(sf::st_join(pts_sf, grid_sf[c(${keep})], join = sf::st_within))`,
      ].join("\n");
    }
    case "aggregate_to_grid": {
      const grid = dfRef(datasets, p.gridDsId);
      const agg = p.fn === "count"
        ? `${p.outCol} = dplyr::n()`
        : `${p.outCol} = ${p.fn}(${p.valueCol}, na.rm = TRUE)`;
      return [
        `# Aggregate point values to grid cells (${p.fn})`,
        `pts_sf  <- ${ptsSf}`,
        `grid_sf <- sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `df <- sf::st_join(pts_sf, grid_sf, join = sf::st_within) |>`,
        `  sf::st_drop_geometry() |>`,
        `  dplyr::group_by(dplyr::across(dplyr::starts_with("grid"))) |>`,
        `  dplyr::summarise(${agg}, .groups = "drop")`,
      ].join("\n");
    }
    default:
      return null;
  }
}

// ─── Python (geopandas) ───────────────────────────────────────────────────────
function pySpatial(opType, p, datasets) {
  const lat = p.latCol, lon = p.lonCol;
  const ptsGdf = `gpd.GeoDataFrame(df.copy(), geometry=gpd.points_from_xy(df["${lon}"], df["${lat}"]), crs=4326)`;
  switch (opType) {
    case "spatial_join": {
      const poly = dfRef(datasets, p.polyDsId);
      const cols = (p.joinCols ?? []).map(c => `"${c}"`).join(", ");
      const pred = p.predicate === "intersects" ? "intersects" : "within";
      return [
        `# Spatial join (${p.predicate ?? "within"}): assign polygon attributes to points`,
        `_pts  = ${ptsGdf}`,
        `_poly = gpd.GeoDataFrame(${poly.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${poly.v}["${p.wktCol}"]), crs=4326)`,
        `df = gpd.sjoin(_pts, _poly[[${cols}, "geometry"]], predicate="${pred}").drop(columns=["geometry", "index_right"], errors="ignore")`,
      ].join("\n");
    }
    case "distance":
      return [
        `# Distance from each point to reference (${p.metric === "euclidean" ? "planar" : "geodesic"}), metres`,
        `_pts = gpd.GeoSeries(gpd.points_from_xy(df["${lon}"], df["${lat}"]), crs=4326).to_crs(3857)`,
        `_ref = gpd.GeoSeries([__import__("shapely.geometry", fromlist=["Point"]).Point(${pyNum(p.refLon)}, ${pyNum(p.refLat)})], crs=4326).to_crs(3857).iloc[0]`,
        `df["${p.outCol}"] = _pts.distance(_ref)`,
      ].join("\n");
    case "buffer_assign":
      return [
        `# Flag points within ${pyNum(p.radius)} m of the reference point`,
        `_pts = gpd.GeoSeries(gpd.points_from_xy(df["${lon}"], df["${lat}"]), crs=4326).to_crs(3857)`,
        `_ref = gpd.GeoSeries([__import__("shapely.geometry", fromlist=["Point"]).Point(${pyNum(p.refLon)}, ${pyNum(p.refLat)})], crs=4326).to_crs(3857).iloc[0]`,
        `df["${p.outCol}"] = (_pts.distance(_ref) <= ${pyNum(p.radius)}).astype(int)`,
      ].join("\n");
    case "nearest_neighbor": {
      const ref = dfRef(datasets, p.refDsId);
      return [
        `# Nearest reference feature for each point`,
        `_pts = ${ptsGdf}`,
        `_ref = gpd.GeoDataFrame(${ref.v}.copy(), geometry=gpd.points_from_xy(${ref.v}["${p.refLonCol}"], ${ref.v}["${p.refLatCol}"]), crs=4326)`,
        `_nn = gpd.sjoin_nearest(_pts.to_crs(3857), _ref.to_crs(3857), distance_col="${p.outDist}")`,
        `df["${p.outIdx}"]  = _nn["index_right"].values`,
        `df["${p.outDist}"] = _nn["${p.outDist}"].values`,
      ].join("\n");
    }
    case "crs_transform":
      if (p.mode === "wkt") {
        return [
          `# Reproject WKT geometry: ${p.source} -> ${p.target}`,
          `_g = gpd.GeoSeries.from_wkt(df["${p.wktCol}"], crs="${p.source}").to_crs("${p.target}")`,
          `df["${p.outWkt}"] = _g.to_wkt()`,
        ].join("\n");
      }
      return [
        `# Reproject coordinates: ${p.source} -> ${p.target}`,
        `_g = gpd.GeoSeries(gpd.points_from_xy(df["${p.xCol}"], df["${p.yCol}"]), crs="${p.source}").to_crs("${p.target}")`,
        `df["${p.outX}"] = _g.x`,
        `df["${p.outY}"] = _g.y`,
      ].join("\n");
    case "boundary_distance": {
      const poly = dfRef(datasets, p.polyDsId);
      return [
        `# Distance from each point to the nearest polygon boundary`,
        `_pts  = gpd.GeoSeries(gpd.points_from_xy(df["${lon}"], df["${lat}"]), crs=4326).to_crs(3857)`,
        `_bnd  = gpd.GeoSeries.from_wkt(${poly.v}["${p.wktCol}"], crs=4326).to_crs(3857).boundary.unary_union`,
        `df["${p.outPrefix}_dist"] = _pts.distance(_bnd)`,
      ].join("\n");
    }
    case "metric_buffer_create":
      return [
        `# Buffer points by ${pyNum(p.radius)} m in projected CRS ${p.crs}`,
        `df_buffers = ${ptsGdf}.to_crs("${p.crs}")`,
        `df_buffers["geometry"] = df_buffers.buffer(${pyNum(p.radius)})`,
      ].join("\n");
    case "metric_buffer_count": {
      const grid = dfRef(datasets, p.gridDsId);
      return [
        `# Count points within ${pyNum(p.radius)} m metric buffers per grid cell`,
        `_pts  = ${ptsGdf}.to_crs(32721)`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326).to_crs(32721)`,
        `_grid["geometry"] = _grid.buffer(${pyNum(p.radius)})`,
        `_grid["${p.outCol}"] = gpd.sjoin(_grid, _pts, predicate="contains").groupby(level=0).size()`,
      ].join("\n");
    }
    case "grid_assign_existing": {
      const grid = dfRef(datasets, p.gridDsId);
      const extra = (p.extraCols ?? []).map(c => `"${c}"`).join(", ");
      const keep = [`"${p.gridIdCol}"`, extra].filter(Boolean).join(", ");
      return [
        `# Assign each point to its grid cell (existing grid layer)`,
        `_pts  = ${ptsGdf}`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326)`,
        `df = gpd.sjoin(_pts, _grid[[${keep}, "geometry"]], predicate="within").drop(columns=["geometry", "index_right"], errors="ignore")`,
      ].join("\n");
    }
    case "aggregate_to_grid": {
      const grid = dfRef(datasets, p.gridDsId);
      const agg = p.fn === "count"
        ? `.size().reset_index(name="${p.outCol}")`
        : `["${p.valueCol}"].${p.fn}().reset_index(name="${p.outCol}")`;
      return [
        `# Aggregate point values to grid cells (${p.fn})`,
        `_pts  = ${ptsGdf}`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326)`,
        `_joined = gpd.sjoin(_pts, _grid, predicate="within")`,
        `df = _joined.groupby("index_right")${agg}`,
      ].join("\n");
    }
    default:
      return null;
  }
}

// ─── Public ───────────────────────────────────────────────────────────────────
export function transpileSpatialOp(opType, params = {}, language = "r", datasets = {}) {
  // geocode is a real pipeline step (translated by the step transpilers); skip.
  if (opType === "geocode") return null;
  if (language === "r")      return rSpatial(opType, params, datasets);
  if (language === "python") return pySpatial(opType, params, datasets);
  if (language === "stata") {
    return [
      `* Spatial op "${opType}" — Stata has no native geometry stack (no sf/geopandas).`,
      `* Reproduce this step in R (sf) or Python (geopandas), or load the exported`,
      `* result dataset from Litux and continue the analysis here.`,
    ].join("\n");
  }
  return null;
}

// Header imports a unified script must include when any spatial op is present.
export function spatialScriptImports(language) {
  if (language === "r")      return [`library(sf)`, `library(dplyr)`];
  if (language === "python") return [`import geopandas as gpd`];
  return [];
}
