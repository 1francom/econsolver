// ─── Spatial-op replication translator ───────────────────────────────────────
// Plan: docs/superpowers/plans/2026-06-14-spatial-replication.md
//
// Turns a logged Spatial-tab analyze op (sessionLog entry
// { module:"spatial", opType, params }) into R (sf) / Python (geopandas) code,
// closing the last replication gap (these ops previously emitted only a comment
// in the unified script). Stata has no native geometry stack → documented
// comment directing the user to R/Python or the exported result.
//
// Public: transpileSpatialOp(opType, params, language, datasets, src) -> string|null
//   datasets: map { [datasetId]: { name, filename } } to resolve referenced
//             polygon/grid/reference datasets to their df_<name> variable.
//   src:      { v, known } — the POINT dataset the op ran on. `v` is its df_<name>
//             variable (resolved by the caller from the op's lat/lon columns);
//             `known:false` means it could not be resolved and `v` is a readable
//             placeholder the user must bind.

import { toDfVar } from "../../pipeline/exporter.js";

// Resolve a referenced datasetId → its data-frame variable name. Falls back to a
// READABLE, role-based placeholder (never a raw UUID) + a `known:false` flag so
// the caller can append a "provide this dataset" note. A grid drawn live in the
// Map tab has a random-UUID id and no source file → it must resolve to something
// a human can act on (e.g. `grid_cells`), not `df_d99a0bc8_…`.
function dfRef(datasets, id, role = "other") {
  const ds = datasets && id ? datasets[id] : null;
  if (ds) return { v: toDfVar(ds.name ?? ds.filename ?? id), known: true };
  const placeholder = { grid: "grid_cells", poly: "polygons", ref: "reference_points" }[role] ?? "other_layer";
  return { v: placeholder, known: false };
}

const rNum  = (x) => (Number.isFinite(Number(x)) ? String(Number(x)) : "NA");
const pyNum = (x) => (Number.isFinite(Number(x)) ? String(Number(x)) : "float('nan')");

// Drop rows with missing coordinates BEFORE building geometry — sf::st_as_sf
// errors on NA coords ("missing values in coordinates not allowed"), and
// geopandas silently makes empty points. Reassign the source var so any column
// appended afterwards stays row-aligned.
const naFilterR  = (src, lon, lat) =>
  `${src} <- ${src}[!is.na(${src}[["${lon}"]]) & !is.na(${src}[["${lat}"]]), ]  # drop rows with missing coordinates`;
const naFilterPy = (src, lon, lat) =>
  `${src} = ${src}.dropna(subset=["${lon}", "${lat}"]).reset_index(drop=True)  # drop rows with missing coordinates`;

// ─── R (sf) ───────────────────────────────────────────────────────────────────
function rSpatial(opType, p, datasets, srcV) {
  const lat = p.latCol, lon = p.lonCol;
  const ptsSf = `sf::st_as_sf(${srcV}, coords = c("${lon}", "${lat}"), crs = 4326)`;
  switch (opType) {
    case "spatial_join": {
      const poly = dfRef(datasets, p.polyDsId, "poly");
      const cols = (p.joinCols ?? []).map(c => `"${c}"`).join(", ");
      const join = p.predicate === "intersects" ? "sf::st_intersects" : "sf::st_within";
      return [
        `# Spatial join (${p.predicate ?? "within"}): assign polygon attributes to points`,
        naFilterR(srcV, lon, lat),
        `pts_sf  <- ${ptsSf}`,
        `poly_sf <- sf::st_as_sf(${poly.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `${srcV} <- sf::st_drop_geometry(sf::st_join(pts_sf, poly_sf[c(${cols})], join = ${join}))`,
      ].join("\n");
    }
    case "distance":
      return [
        `# Distance from each point to reference (${p.metric === "euclidean" ? "planar" : "geodesic"})`,
        naFilterR(srcV, lon, lat),
        `${srcV}$${p.outCol} <- as.numeric(sf::st_distance(`,
        `  ${ptsSf},`,
        `  sf::st_sfc(sf::st_point(c(${rNum(p.refLon)}, ${rNum(p.refLat)})), crs = 4326)))  # metres`,
      ].join("\n");
    case "buffer_assign":
      return [
        `# Flag points within ${rNum(p.radius)} m of the reference point`,
        naFilterR(srcV, lon, lat),
        `${srcV}$${p.outCol} <- as.integer(as.numeric(sf::st_distance(`,
        `  ${ptsSf},`,
        `  sf::st_sfc(sf::st_point(c(${rNum(p.refLon)}, ${rNum(p.refLat)})), crs = 4326))) <= ${rNum(p.radius)})`,
      ].join("\n");
    case "nearest_neighbor": {
      const ref = dfRef(datasets, p.refDsId, "ref");
      return [
        `# Nearest reference feature for each point`,
        naFilterR(srcV, lon, lat),
        `pts_sf <- ${ptsSf}`,
        `ref_sf <- sf::st_as_sf(${ref.v}, coords = c("${p.refLonCol}", "${p.refLatCol}"), crs = 4326)`,
        `.idx <- sf::st_nearest_feature(pts_sf, ref_sf)`,
        `${srcV}$${p.outIdx}  <- .idx`,
        `${srcV}$${p.outDist} <- as.numeric(sf::st_distance(pts_sf, ref_sf[.idx, ], by_element = TRUE))`,
      ].join("\n");
    }
    case "crs_transform":
      if (p.mode === "wkt") {
        return [
          `# Reproject WKT geometry: ${p.source} -> ${p.target}`,
          `${srcV}$${p.outWkt} <- sf::st_as_text(sf::st_transform(sf::st_as_sfc(${srcV}$${p.wktCol}, crs = "${p.source}"), "${p.target}"))`,
        ].join("\n");
      }
      return [
        `# Reproject coordinates: ${p.source} -> ${p.target}`,
        naFilterR(srcV, p.xCol, p.yCol),
        `.sf <- sf::st_transform(sf::st_as_sf(${srcV}, coords = c("${p.xCol}", "${p.yCol}"), crs = "${p.source}"), "${p.target}")`,
        `${srcV}$${p.outX} <- sf::st_coordinates(.sf)[, 1]`,
        `${srcV}$${p.outY} <- sf::st_coordinates(.sf)[, 2]`,
      ].join("\n");
    case "boundary_distance": {
      const poly = dfRef(datasets, p.polyDsId, "poly");
      return [
        `# Distance from each point to the nearest polygon boundary`,
        naFilterR(srcV, lon, lat),
        `pts_sf  <- ${ptsSf}`,
        `poly_sf <- sf::st_as_sf(${poly.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `${srcV}$${p.outPrefix}_dist <- apply(sf::st_distance(pts_sf, sf::st_boundary(poly_sf)), 1, min)`,
      ].join("\n");
    }
    case "metric_buffer_create":
      return [
        `# Buffer points by ${rNum(p.radius)} m in projected CRS ${p.crs}`,
        naFilterR(srcV, lon, lat),
        `df_buffers <- sf::st_buffer(sf::st_transform(${ptsSf}, "${p.crs}"), ${rNum(p.radius)})`,
      ].join("\n");
    case "metric_buffer_count": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      return [
        `# Count points falling within ${rNum(p.radius)} m metric buffers per grid cell`,
        naFilterR(srcV, lon, lat),
        `pts_sf  <- sf::st_transform(${ptsSf}, 32721)`,
        `grid_sf <- sf::st_transform(sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326), 32721)`,
        `grid_sf$${p.outCol} <- lengths(sf::st_intersects(sf::st_buffer(grid_sf, ${rNum(p.radius)}), pts_sf))`,
      ].join("\n");
    }
    case "grid_assign_existing": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      const extra = (p.extraCols ?? []).map(c => `"${c}"`).join(", ");
      const keep = [`"${p.gridIdCol}"`, extra].filter(Boolean).join(", ");
      return [
        `# Assign each point to its grid cell (existing grid layer)`,
        naFilterR(srcV, lon, lat),
        `pts_sf  <- ${ptsSf}`,
        `grid_sf <- sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `${srcV} <- sf::st_drop_geometry(sf::st_join(pts_sf, grid_sf[c(${keep})], join = sf::st_within))`,
      ].join("\n");
    }
    case "aggregate_to_grid": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      const agg = p.fn === "count"
        ? `${p.outCol} = dplyr::n()`
        : `${p.outCol} = ${p.fn}(${p.valueCol}, na.rm = TRUE)`;
      return [
        `# Aggregate point values to grid cells (${p.fn})`,
        naFilterR(srcV, lon, lat),
        `pts_sf  <- ${ptsSf}`,
        `grid_sf <- sf::st_as_sf(${grid.v}, wkt = "${p.wktCol}", crs = 4326)`,
        `${srcV} <- sf::st_join(pts_sf, grid_sf, join = sf::st_within) |>`,
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
function pySpatial(opType, p, datasets, srcV) {
  const lat = p.latCol, lon = p.lonCol;
  const ptsGdf = `gpd.GeoDataFrame(${srcV}, geometry=gpd.points_from_xy(${srcV}["${lon}"], ${srcV}["${lat}"]), crs=4326)`;
  switch (opType) {
    case "spatial_join": {
      const poly = dfRef(datasets, p.polyDsId, "poly");
      const cols = (p.joinCols ?? []).map(c => `"${c}"`).join(", ");
      const pred = p.predicate === "intersects" ? "intersects" : "within";
      return [
        `# Spatial join (${p.predicate ?? "within"}): assign polygon attributes to points`,
        naFilterPy(srcV, lon, lat),
        `_pts  = ${ptsGdf}`,
        `_poly = gpd.GeoDataFrame(${poly.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${poly.v}["${p.wktCol}"]), crs=4326)`,
        `${srcV} = gpd.sjoin(_pts, _poly[[${cols}, "geometry"]], predicate="${pred}").drop(columns=["geometry", "index_right"], errors="ignore")`,
      ].join("\n");
    }
    case "distance":
      return [
        `# Distance from each point to reference (${p.metric === "euclidean" ? "planar" : "geodesic"}), metres`,
        naFilterPy(srcV, lon, lat),
        `_pts = gpd.GeoSeries(gpd.points_from_xy(${srcV}["${lon}"], ${srcV}["${lat}"]), crs=4326).to_crs(3857)`,
        `_ref = gpd.GeoSeries([__import__("shapely.geometry", fromlist=["Point"]).Point(${pyNum(p.refLon)}, ${pyNum(p.refLat)})], crs=4326).to_crs(3857).iloc[0]`,
        `${srcV}["${p.outCol}"] = _pts.distance(_ref)`,
      ].join("\n");
    case "buffer_assign":
      return [
        `# Flag points within ${pyNum(p.radius)} m of the reference point`,
        naFilterPy(srcV, lon, lat),
        `_pts = gpd.GeoSeries(gpd.points_from_xy(${srcV}["${lon}"], ${srcV}["${lat}"]), crs=4326).to_crs(3857)`,
        `_ref = gpd.GeoSeries([__import__("shapely.geometry", fromlist=["Point"]).Point(${pyNum(p.refLon)}, ${pyNum(p.refLat)})], crs=4326).to_crs(3857).iloc[0]`,
        `${srcV}["${p.outCol}"] = (_pts.distance(_ref) <= ${pyNum(p.radius)}).astype(int)`,
      ].join("\n");
    case "nearest_neighbor": {
      const ref = dfRef(datasets, p.refDsId, "ref");
      return [
        `# Nearest reference feature for each point`,
        naFilterPy(srcV, lon, lat),
        `_pts = ${ptsGdf}`,
        `_ref = gpd.GeoDataFrame(${ref.v}.copy(), geometry=gpd.points_from_xy(${ref.v}["${p.refLonCol}"], ${ref.v}["${p.refLatCol}"]), crs=4326)`,
        `_nn = gpd.sjoin_nearest(_pts.to_crs(3857), _ref.to_crs(3857), distance_col="${p.outDist}")`,
        `${srcV}["${p.outIdx}"]  = _nn["index_right"].values`,
        `${srcV}["${p.outDist}"] = _nn["${p.outDist}"].values`,
      ].join("\n");
    }
    case "crs_transform":
      if (p.mode === "wkt") {
        return [
          `# Reproject WKT geometry: ${p.source} -> ${p.target}`,
          `_g = gpd.GeoSeries.from_wkt(${srcV}["${p.wktCol}"], crs="${p.source}").to_crs("${p.target}")`,
          `${srcV}["${p.outWkt}"] = _g.to_wkt()`,
        ].join("\n");
      }
      return [
        `# Reproject coordinates: ${p.source} -> ${p.target}`,
        naFilterPy(srcV, p.xCol, p.yCol),
        `_g = gpd.GeoSeries(gpd.points_from_xy(${srcV}["${p.xCol}"], ${srcV}["${p.yCol}"]), crs="${p.source}").to_crs("${p.target}")`,
        `${srcV}["${p.outX}"] = _g.x`,
        `${srcV}["${p.outY}"] = _g.y`,
      ].join("\n");
    case "boundary_distance": {
      const poly = dfRef(datasets, p.polyDsId, "poly");
      return [
        `# Distance from each point to the nearest polygon boundary`,
        naFilterPy(srcV, lon, lat),
        `_pts  = gpd.GeoSeries(gpd.points_from_xy(${srcV}["${lon}"], ${srcV}["${lat}"]), crs=4326).to_crs(3857)`,
        `_bnd  = gpd.GeoSeries.from_wkt(${poly.v}["${p.wktCol}"], crs=4326).to_crs(3857).boundary.unary_union`,
        `${srcV}["${p.outPrefix}_dist"] = _pts.distance(_bnd)`,
      ].join("\n");
    }
    case "metric_buffer_create":
      return [
        `# Buffer points by ${pyNum(p.radius)} m in projected CRS ${p.crs}`,
        naFilterPy(srcV, lon, lat),
        `df_buffers = ${ptsGdf}.to_crs("${p.crs}")`,
        `df_buffers["geometry"] = df_buffers.buffer(${pyNum(p.radius)})`,
      ].join("\n");
    case "metric_buffer_count": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      return [
        `# Count points within ${pyNum(p.radius)} m metric buffers per grid cell`,
        naFilterPy(srcV, lon, lat),
        `_pts  = ${ptsGdf}.to_crs(32721)`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326).to_crs(32721)`,
        `_grid["geometry"] = _grid.buffer(${pyNum(p.radius)})`,
        `_grid["${p.outCol}"] = gpd.sjoin(_grid, _pts, predicate="contains").groupby(level=0).size()`,
      ].join("\n");
    }
    case "grid_assign_existing": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      const extra = (p.extraCols ?? []).map(c => `"${c}"`).join(", ");
      const keep = [`"${p.gridIdCol}"`, extra].filter(Boolean).join(", ");
      return [
        `# Assign each point to its grid cell (existing grid layer)`,
        naFilterPy(srcV, lon, lat),
        `_pts  = ${ptsGdf}`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326)`,
        `${srcV} = gpd.sjoin(_pts, _grid[[${keep}, "geometry"]], predicate="within").drop(columns=["geometry", "index_right"], errors="ignore")`,
      ].join("\n");
    }
    case "aggregate_to_grid": {
      const grid = dfRef(datasets, p.gridDsId, "grid");
      const agg = p.fn === "count"
        ? `.size().reset_index(name="${p.outCol}")`
        : `["${p.valueCol}"].${p.fn}().reset_index(name="${p.outCol}")`;
      return [
        `# Aggregate point values to grid cells (${p.fn})`,
        naFilterPy(srcV, lon, lat),
        `_pts  = ${ptsGdf}`,
        `_grid = gpd.GeoDataFrame(${grid.v}.copy(), geometry=gpd.GeoSeries.from_wkt(${grid.v}["${p.wktCol}"]), crs=4326)`,
        `_joined = gpd.sjoin(_pts, _grid, predicate="within")`,
        `${srcV} = _joined.groupby("index_right")${agg}`,
      ].join("\n");
    }
    default:
      return null;
  }
}

// Which referenced (non-point) dataset role an op carries, for the "provide this
// layer" note when it resolves to a placeholder.
function targetRefOf(opType, p, datasets) {
  const idRole =
    p.gridDsId ? { id: p.gridDsId, role: "grid" } :
    p.polyDsId ? { id: p.polyDsId, role: "poly" } :
    p.refDsId  ? { id: p.refDsId,  role: "ref"  } : null;
  if (!idRole) return null;
  return dfRef(datasets, idRole.id, idRole.role);
}

// ─── Public ───────────────────────────────────────────────────────────────────
export function transpileSpatialOp(opType, params = {}, language = "r", datasets = {}, src = null) {
  // geocode is a real pipeline step (translated by the step transpilers); skip.
  if (opType === "geocode") return null;

  if (language === "stata") {
    return [
      `* Spatial op "${opType}" — Stata has no native geometry stack (no sf/geopandas).`,
      `* Reproduce this step in R (sf) or Python (geopandas), or load the exported`,
      `* result dataset from Litux and continue the analysis here.`,
    ].join("\n");
  }

  const srcV = src?.v ?? "points_df";
  const code = language === "python"
    ? pySpatial(opType, params, datasets, srcV)
    : rSpatial(opType, params, datasets, srcV);
  if (!code) return null;

  // Self-document any dataset that could not be resolved to a real loaded file
  // (rather than emitting a bare `df` or a raw-UUID variable a user can't act on).
  const cmt = "#";
  const notes = [];
  if (src && src.known === false) {
    notes.push(`${cmt} NOTE: bind '${srcV}' to the point dataset this op ran on (the geocoded/lat-lon table) before running.`);
  }
  const tgt = targetRefOf(opType, params, datasets);
  if (tgt && tgt.known === false) {
    notes.push(`${cmt} NOTE: '${tgt.v}' was built inside Litux and has no source file — export it from Litux as ${tgt.v}.csv (e.g. the schools-per-grid layer) and load it first.`);
  }
  return notes.length ? `${notes.join("\n")}\n${code}` : code;
}

// Header imports a unified script must include when any spatial op is present.
export function spatialScriptImports(language) {
  if (language === "r")      return [`library(sf)`, `library(dplyr)`];
  if (language === "python") return [`import geopandas as gpd`];
  return [];
}
