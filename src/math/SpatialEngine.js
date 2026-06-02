// ─── ECON STUDIO · SpatialEngine.js ──────────────────────────────────────────
// Pure-JS spatial analytics engine. No external dependencies, no React imports.
// All coordinates in decimal degrees (WGS-84) unless otherwise noted.
//
// Exports:
//   haversine, euclidean
//   isWithinBuffer, assignBuffer
//   assignRectGrid, assignH3Grid
//   pointInPolygon, spatialJoin
//   nearestNeighbor
//   assignBoundaryDistance — signed distance to polygon boundary (Spatial RD running variable)
//   parseWKTPolygon (helper)
//   makeGrid          — st_make_grid equivalent: rectangular cells clipped to boundary
//   aggregateToGrid   — count/sum/mean of point dataset within each grid cell

const EARTH_RADIUS_KM = 6371;
const arrMin = a => a.reduce((m, v) => v < m ? v : m, a[0]);
const arrMax = a => a.reduce((m, v) => v > m ? v : m, a[0]);
const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);
const UTM_K0 = 0.9996;

export function normalizeCrs(crs) {
  if (!crs) return "EPSG:4326";
  if (typeof crs === "number") return `EPSG:${crs}`;
  if (typeof crs === "object") {
    if (crs.epsg) return `EPSG:${crs.epsg}`;
    if (crs.code) return normalizeCrs(crs.code);
    if (crs.name && /4326|wgs\s*84/i.test(crs.name)) return "EPSG:4326";
    if (crs.name && /32721|utm.*21.*south/i.test(crs.name)) return "EPSG:32721";
  }
  const s = String(crs).trim().toUpperCase().replace(/\s+/g, "");
  if (s === "4326" || s === "WGS84" || s === "WGS_84" || s === "EPSG:4326") return "EPSG:4326";
  if (s === "32721" || s === "EPSG:32721" || s.includes("UTMZONE21S")) return "EPSG:32721";
  return s.startsWith("EPSG:") ? s : `EPSG:${s.replace(/^EPSG/, "")}`;
}

function lonLatToUtm32721(lon, lat) {
  const zone = 21;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const phi = lat * Math.PI / 180;
  const lam = lon * Math.PI / 180;
  const ep2 = WGS84_E2 / (1 - WGS84_E2);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi) ** 2);
  const t = Math.tan(phi) ** 2;
  const c = ep2 * Math.cos(phi) ** 2;
  const a = Math.cos(phi) * (lam - lon0);
  const m = WGS84_A * (
    (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256) * phi -
    (3 * WGS84_E2 / 8 + 3 * WGS84_E2 ** 2 / 32 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(2 * phi) +
    (15 * WGS84_E2 ** 2 / 256 + 45 * WGS84_E2 ** 3 / 1024) * Math.sin(4 * phi) -
    (35 * WGS84_E2 ** 3 / 3072) * Math.sin(6 * phi)
  );
  const x = UTM_K0 * n * (
    a + (1 - t + c) * a ** 3 / 6 +
    (5 - 18 * t + t ** 2 + 72 * c - 58 * ep2) * a ** 5 / 120
  ) + 500000;
  const yNorth = UTM_K0 * (
    m + n * Math.tan(phi) * (
      a ** 2 / 2 +
      (5 - t + 9 * c + 4 * c ** 2) * a ** 4 / 24 +
      (61 - 58 * t + t ** 2 + 600 * c - 330 * ep2) * a ** 6 / 720
    )
  );
  return [x, yNorth + 10000000];
}

function utm32721ToLonLat(x, y) {
  const zone = 21;
  const lon0 = ((zone - 1) * 6 - 180 + 3) * Math.PI / 180;
  const ep2 = WGS84_E2 / (1 - WGS84_E2);
  const e1 = (1 - Math.sqrt(1 - WGS84_E2)) / (1 + Math.sqrt(1 - WGS84_E2));
  const m = (y - 10000000) / UTM_K0;
  const mu = m / (WGS84_A * (1 - WGS84_E2 / 4 - 3 * WGS84_E2 ** 2 / 64 - 5 * WGS84_E2 ** 3 / 256));
  const phi1 = mu +
    (3 * e1 / 2 - 27 * e1 ** 3 / 32) * Math.sin(2 * mu) +
    (21 * e1 ** 2 / 16 - 55 * e1 ** 4 / 32) * Math.sin(4 * mu) +
    (151 * e1 ** 3 / 96) * Math.sin(6 * mu) +
    (1097 * e1 ** 4 / 512) * Math.sin(8 * mu);
  const n1 = WGS84_A / Math.sqrt(1 - WGS84_E2 * Math.sin(phi1) ** 2);
  const t1 = Math.tan(phi1) ** 2;
  const c1 = ep2 * Math.cos(phi1) ** 2;
  const r1 = WGS84_A * (1 - WGS84_E2) / Math.pow(1 - WGS84_E2 * Math.sin(phi1) ** 2, 1.5);
  const d = (x - 500000) / (n1 * UTM_K0);
  const lat = phi1 - (n1 * Math.tan(phi1) / r1) * (
    d ** 2 / 2 -
    (5 + 3 * t1 + 10 * c1 - 4 * c1 ** 2 - 9 * ep2) * d ** 4 / 24 +
    (61 + 90 * t1 + 298 * c1 + 45 * t1 ** 2 - 252 * ep2 - 3 * c1 ** 2) * d ** 6 / 720
  );
  const lon = lon0 + (
    d -
    (1 + 2 * t1 + c1) * d ** 3 / 6 +
    (5 - 2 * c1 + 28 * t1 - 3 * c1 ** 2 + 8 * ep2 + 24 * t1 ** 2) * d ** 5 / 120
  ) / Math.cos(phi1);
  return [lon * 180 / Math.PI, lat * 180 / Math.PI];
}

export function transformCoord(x, y, fromCrs = "EPSG:4326", toCrs = "EPSG:32721") {
  const from = normalizeCrs(fromCrs);
  const to = normalizeCrs(toCrs);
  if (from === to) return [Number(x), Number(y)];
  if (from === "EPSG:4326" && to === "EPSG:32721") return lonLatToUtm32721(Number(x), Number(y));
  if (from === "EPSG:32721" && to === "EPSG:4326") return utm32721ToLonLat(Number(x), Number(y));
  throw new Error(`Unsupported CRS transform: ${from} -> ${to}`);
}

export function transformWKT(wkt, fromCrs = "EPSG:4326", toCrs = "EPSG:32721", precision = 8) {
  if (!wkt || typeof wkt !== "string") return wkt;
  const rx = /(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;
  const fmt = n => {
    const v = Number(n);
    if (!isFinite(v)) return "NaN";
    return v.toFixed(precision).replace(/\.?0+$/, "");
  };
  return wkt.replace(rx, (_, xs, ys) => {
    const [x, y] = transformCoord(Number(xs), Number(ys), fromCrs, toCrs);
    return `${fmt(x)} ${fmt(y)}`;
  });
}

// ─── DISTANCE ─────────────────────────────────────────────────────────────────

/**
 * Haversine great-circle distance between two WGS-84 points.
 * Returns distance in kilometres.
 */
export function haversine(lat1, lon1, lat2, lon2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Euclidean distance in projected coordinate units (metres, feet, etc.).
 * Use for data already in a projected CRS (e.g. UTM).
 */
export function euclidean(x1, y1, x2, y2) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

// ─── BUFFER ───────────────────────────────────────────────────────────────────

/**
 * Returns true if (lat, lon) is within radiusKm of (centerLat, centerLon).
 */
export function isWithinBuffer(lat, lon, centerLat, centerLon, radiusKm) {
  return haversine(lat, lon, centerLat, centerLon) <= radiusKm;
}

/**
 * Adds a 0/1 integer column (outCol) to each row: 1 if within buffer, 0 otherwise.
 * Rows with missing lat/lon receive null.
 */
export function assignBuffer(rows, latCol, lonCol, centerLat, centerLon, radiusKm, outCol) {
  return rows.map(r => {
    const lat = r[latCol];
    const lon = r[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...r, [outCol]: null };
    }
    return {
      ...r,
      [outCol]: isWithinBuffer(Number(lat), Number(lon), centerLat, centerLon, radiusKm) ? 1 : 0,
    };
  });
}

// ─── DISTANCE COLUMN ──────────────────────────────────────────────────────────

/**
 * Adds a haversine distance column (outCol, in km) from each row to a fixed
 * reference point (refLat, refLon). Rows with missing coordinates get null.
 */
export function assignDistance(rows, latCol, lonCol, refLat, refLon, outCol) {
  return rows.map(r => {
    const lat = r[latCol];
    const lon = r[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...r, [outCol]: null };
    }
    return {
      ...r,
      [outCol]: haversine(Number(lat), Number(lon), refLat, refLon),
    };
  });
}

export function assignDistanceMetric(
  rows, latCol, lonCol, refLat, refLon, outCol,
  targetCrs = "EPSG:32721"
) {
  const [rx, ry] = transformCoord(Number(refLon), Number(refLat), "EPSG:4326", targetCrs);
  return rows.map(r => {
    const lat = r[latCol];
    const lon = r[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...r, [outCol]: null };
    }
    const [x, y] = transformCoord(Number(lon), Number(lat), "EPSG:4326", targetCrs);
    return { ...r, [outCol]: euclidean(x, y, rx, ry) };
  });
}

// ─── BOUNDARY DISTANCE (SPATIAL RD) ──────────────────────────────────────────

/**
 * Splits a string into its top-level parenthesised groups using a paren counter.
 * "((a),(b)),((c))" → ["(a),(b)", "(c)"]. Used to parse nested WKT structures.
 */
function splitParenGroups(s) {
  const groups = [];
  let depth = 0, start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") { if (depth === 0) start = i; depth++; }
    else if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) { groups.push(s.slice(start + 1, i)); start = -1; }
    }
  }
  return groups;
}

function _parseRingStr(s) {
  return s.split(",").map(p => {
    const [lon, lat] = p.trim().split(/\s+/).map(Number);
    return [lon, lat];
  }).filter(([x, y]) => !isNaN(x) && !isNaN(y));
}

/**
 * Parses a WKT POLYGON or MULTIPOLYGON into a flat array of rings (outer + holes,
 * across all polygon components for MULTIPOLYGON). Each ring is an array of [lon, lat]
 * pairs. Used by boundary-distance: every ring contributes boundary segments,
 * including hole rings.
 *
 * Replaces the previous regex-based parser, which silently dropped any
 * MULTIPOLYGON component containing holes.
 */
function parseWKTRings(wkt) {
  if (!wkt || typeof wkt !== "string") return [];
  const w = wkt.trim();
  const rings = [];
  const isMulti = /^MULTIPOLYGON/i.test(w);
  const isPoly  = /^POLYGON/i.test(w);
  if (!isMulti && !isPoly) return [];

  const body = w.slice(w.indexOf("("));
  const inner = splitParenGroups(body)[0]; // strip outermost ( )
  if (!inner) return [];

  if (isMulti) {
    // inner = "((r1),(h1)), ((r2))"  → each polygon at top level
    for (const polyStr of splitParenGroups(inner)) {
      for (const ringStr of splitParenGroups(polyStr)) {
        const r = _parseRingStr(ringStr);
        if (r.length >= 3) rings.push(r);
      }
    }
  } else {
    // inner = "(outer), (hole), ..."
    for (const ringStr of splitParenGroups(inner)) {
      const r = _parseRingStr(ringStr);
      if (r.length >= 3) rings.push(r);
    }
  }
  return rings;
}

/**
 * Approximate planar distance (km) from point P to line segment AB.
 * Uses equirectangular projection centred on the three points.
 * Accurate to <0.1% for segments < 200 km — sufficient for urban polygons.
 */
function distPointToSegKm(pLat, pLon, aLat, aLon, bLat, bLon) {
  const lat0  = (pLat + aLat + bLat) / 3;
  const cosLat = Math.cos(lat0 * Math.PI / 180);
  const K = 111.32; // km per degree latitude
  const px = (pLon - aLon) * K * cosLat;
  const py = (pLat - aLat) * K;
  const bx = (bLon - aLon) * K * cosLat;
  const by = (bLat - aLat) * K;
  const lenSq = bx * bx + by * by;
  if (lenSq < 1e-12) return Math.sqrt(px * px + py * py);
  const t  = Math.max(0, Math.min(1, (px * bx + py * by) / lenSq));
  const dx = px - t * bx;
  const dy = py - t * by;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Assigns boundary-distance columns to each point row relative to a set of
 * polygon rows — the core operation for Spatial Regression Discontinuity.
 *
 * Three output columns (names derived from outPrefix):
 *   {outPrefix}_dist_km  — unsigned haversine distance to nearest boundary edge (km)
 *   {outPrefix}_treat    — 1 if point is inside any polygon, 0 otherwise
 *   {outPrefix}_running  — signed distance: +dist inside treatment, −dist outside
 *                          Use this directly as the RD running variable.
 *
 * @param {object[]} pointRows   rows with lat/lon columns
 * @param {string}   latCol      latitude column
 * @param {string}   lonCol      longitude column
 * @param {object[]} polyRows    polygon dataset rows
 * @param {string}   wktCol      WKT geometry column in polyRows
 * @param {string}   outPrefix   prefix for the three output columns (default "boundary")
 * @returns {object[]}
 */
export function assignBoundaryDistance(pointRows, latCol, lonCol, polyRows, wktCol, outPrefix = "boundary") {
  const distCol    = `${outPrefix}_dist_km`;
  const treatCol   = `${outPrefix}_treat`;
  const runningCol = `${outPrefix}_running`;

  // Build segment list from all polygon rings in polyRows
  const segments = [];
  for (const row of polyRows) {
    for (const ring of parseWKTRings(row[wktCol] ?? "")) {
      for (let i = 0; i < ring.length - 1; i++) {
        const [aLon, aLat] = ring[i];
        const [bLon, bLat] = ring[i + 1];
        segments.push({ aLat, aLon, bLat, bLon });
      }
    }
  }

  if (segments.length === 0) {
    return pointRows.map(r => ({ ...r, [distCol]: null, [treatCol]: null, [runningCol]: null }));
  }

  return pointRows.map(row => {
    const lat = row[latCol];
    const lon = row[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...row, [distCol]: null, [treatCol]: null, [runningCol]: null };
    }
    const pLat = Number(lat);
    const pLon = Number(lon);

    // Minimum distance to any boundary segment
    let minDist = Infinity;
    for (const { aLat, aLon, bLat, bLon } of segments) {
      const d = distPointToSegKm(pLat, pLon, aLat, aLon, bLat, bLon);
      if (d < minDist) minDist = d;
    }

    // Treatment: inside any polygon?
    let treat = 0;
    for (const pRow of polyRows) {
      if (pRow[wktCol] && pointInPolygon(pLat, pLon, pRow[wktCol])) { treat = 1; break; }
    }

    const dist    = minDist === Infinity ? null : minDist;
    const running = dist === null ? null : (treat === 1 ? dist : -dist);
    return { ...row, [distCol]: dist, [treatCol]: treat, [runningCol]: running };
  });
}

// ─── GRID ASSIGNMENT ──────────────────────────────────────────────────────────

/**
 * Assigns a rectangular grid cell ID string to each row.
 * cellSizeKm controls the cell size; lat/lon steps are derived approximately
 * (1 deg lat ≈ 111 km; 1 deg lon ≈ 111·cos(lat) km at each row's latitude).
 * Output column contains strings like "3_-12".
 */
export function assignRectGrid(rows, latCol, lonCol, cellSizeKm, outCol) {
  const latStep = cellSizeKm / 111; // degrees latitude per cell
  return rows.map(r => {
    const lat = r[latCol];
    const lon = r[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...r, [outCol]: null };
    }
    const meanLatRad = Number(lat) * Math.PI / 180;
    const lonStep = cellSizeKm / (111 * Math.cos(meanLatRad));
    const gridLat = Math.floor(Number(lat) / latStep);
    const gridLon = Math.floor(Number(lon) / lonStep);
    return { ...r, [outCol]: `${gridLat}_${gridLon}` };
  });
}

/**
 * Assigns an approximate hexagonal grid cell ID using axial coordinates.
 * resolution 0 → ~1000 km cells; resolution 4 → ~7 km cells (each step ÷7).
 * Output column contains strings like "h3_5_-2".
 */
export function assignH3Grid(rows, latCol, lonCol, resolution, outCol) {
  const cellSizeKm = 1000 / Math.pow(7, resolution);
  const latStep = cellSizeKm / 111;
  return rows.map(r => {
    const lat = r[latCol];
    const lon = r[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...r, [outCol]: null };
    }
    const meanLatRad = Number(lat) * Math.PI / 180;
    const lonStep = cellSizeKm / (111 * Math.cos(meanLatRad));
    // Axial hex coordinate (offset layout)
    const q = Math.round(Number(lon) / lonStep);
    const rr = Math.round(Number(lat) / latStep - q * 0.5);
    return { ...r, [outCol]: `h${resolution}_${q}_${rr}` };
  });
}

// ─── POINT-IN-POLYGON (WKT) ───────────────────────────────────────────────────

/**
 * Parses a WKT POLYGON string into an array of [lon, lat] coordinate pairs.
 * Handles POLYGON((lon lat, lon lat, ...)) — outer ring only.
 * Returns null if parsing fails.
 */
export function parseWKTPolygon(wkt) {
  if (!wkt || typeof wkt !== "string") return null;
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)/i);
  if (!match) return null;
  try {
    return match[1]
      .split(",")
      .map(pair => pair.trim().split(/\s+/).map(Number))
      .filter(([x, y]) => !isNaN(x) && !isNaN(y));
  } catch {
    return null;
  }
}

/**
 * Ray-casting point-in-polygon test.
 * Handles both POLYGON and MULTIPOLYGON WKT — returns true if point is inside
 * any ring of the geometry. Uses parseWKTRings for full geometry support.
 */
export function pointInPolygon(lat, lon, polygonWKT) {
  const geom = parseWKTMultiPolygonXY(polygonWKT);
  return pointInGeometryXY(Number(lon), Number(lat), geom);
}

function pointInParsedRings(lat, lon, rings) {
  if (!rings.length) return false;
  for (const ring of rings) {
    if (ring.length < 3) continue;
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]; // xi=lon, yi=lat
      const [xj, yj] = ring[j];
      if ((yi > lat) !== (yj > lat) &&
          lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function ringsBBox(rings) {
  const xs = rings.flatMap(r => r.map(p => p[0]));
  const ys = rings.flatMap(r => r.map(p => p[1]));
  if (!xs.length || !ys.length) return null;
  return { minX: arrMin(xs), maxX: arrMax(xs), minY: arrMin(ys), maxY: arrMax(ys) };
}

function bboxContains(bbox, x, y) {
  return bbox && x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY;
}

// ─── SPATIAL JOIN ─────────────────────────────────────────────────────────────

/**
 * Left-joins polygon attributes to point rows.
 * For each point row, finds the first polygon in polyRows whose WKT geometry
 * contains the point, then appends joinCols from that polygon.
 * Unmatched rows receive null for all joinCols.
 *
 * @param {object[]} pointRows   - rows with lat/lon columns
 * @param {string}   latCol      - latitude column name
 * @param {string}   lonCol      - longitude column name
 * @param {object[]} polyRows    - polygon dataset rows
 * @param {string}   wktCol     - column containing WKT POLYGON geometry
 * @param {string[]} joinCols    - columns from polyRows to attach
 * @returns {object[]}
 */
export function spatialJoin(pointRows, latCol, lonCol, polyRows, wktCol, joinCols, predicate = "within") {
  const nullAttrs = Object.fromEntries(joinCols.map(c => [c, null]));
  return pointRows.map(row => {
    const lat = row[latCol];
    const lon = row[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...row, ...nullAttrs };
    }
    const match = polyRows.find(p => {
      if (!p[wktCol]) return false;
      // For point-in-polygon data, intersects and within are equivalent except
      // for boundary points; keep both predicates exposed for sf-style workflow parity.
      return predicate === "intersects"
        ? pointInPolygon(Number(lat), Number(lon), p[wktCol])
        : pointInPolygon(Number(lat), Number(lon), p[wktCol]);
    });
    const attrs = match
      ? Object.fromEntries(joinCols.map(c => [c, match[c] ?? null]))
      : nullAttrs;
    return { ...row, ...attrs };
  });
}

export function assignPointsToGrid(
  pointRows,
  latCol,
  lonCol,
  gridRows,
  gridWktCol,
  gridIdCol = "grid_id",
  outGridCol = "grid_id",
  options = {}
) {
  const attributeCols = Array.isArray(options.attributeCols) ? options.attributeCols : [];
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const sourceCrs = normalizeCrs(options.sourceCrs ?? "EPSG:4326");
  const fallbackWktCol = options.fallbackWktCol ?? "geometry";

  const prepared = gridRows.map((cell, idx) => {
    const wkt = cell[gridWktCol] ?? cell[fallbackWktCol];
    if (!wkt) return null;
    const projected = gridWktCol === "metric_geometry" || isProjectedWktCoords(wkt);
    const rings = parseWKTRings(wkt);
    if (!rings.length) return null;
    return { cell, idx, rings, bbox: ringsBBox(rings), projected };
  }).filter(Boolean);

  const nullAttrs = Object.fromEntries(attributeCols.map(c => [c, null]));
  return pointRows.map(row => {
    const lat = Number(row[latCol]);
    const lon = Number(row[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) {
      return { ...row, [outGridCol]: null, grid_row_index: null, ...nullAttrs };
    }

    let metricPoint = null;
    const match = prepared.find(({ rings, bbox, projected }) => {
      if (projected) {
        if (!metricPoint) metricPoint = transformCoord(lon, lat, sourceCrs, metricCrs);
        return bboxContains(bbox, metricPoint[0], metricPoint[1]) &&
          pointInParsedRings(metricPoint[1], metricPoint[0], rings);
      }
      return bboxContains(bbox, lon, lat) && pointInParsedRings(lat, lon, rings);
    });

    if (!match) return { ...row, [outGridCol]: null, grid_row_index: null, ...nullAttrs };
    const attrs = Object.fromEntries(attributeCols.map(c => [c, match.cell[c] ?? null]));
    return {
      ...row,
      [outGridCol]: match.cell[gridIdCol] ?? match.idx + 1,
      grid_row_index: match.idx,
      ...attrs,
    };
  });
}

// ─── NEAREST NEIGHBOR ─────────────────────────────────────────────────────────

/**
 * Brute-force O(n × m) nearest-neighbour search.
 * For each row finds the closest point in referenceRows and appends:
 *   outDistCol — haversine distance in km to nearest reference point
 *   outIdCol   — zero-based index of the nearest reference row
 *
 * Suitable for datasets up to ~10k × ~1k. Larger datasets may be slow.
 */
export function nearestNeighbor(
  rows, latCol, lonCol,
  referenceRows, refLatCol, refLonCol,
  outDistCol, outIdCol
) {
  // Pre-filter reference rows with valid coords
  const validRefs = referenceRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[refLatCol] != null && r[refLonCol] != null &&
                        !isNaN(r[refLatCol]) && !isNaN(r[refLonCol]));

  return rows.map(row => {
    const lat = row[latCol];
    const lon = row[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || validRefs.length === 0) {
      return { ...row, [outDistCol]: null, [outIdCol]: null };
    }
    let minDist = Infinity;
    let minIdx  = null;
    for (const { r, i } of validRefs) {
      const d = haversine(Number(lat), Number(lon), Number(r[refLatCol]), Number(r[refLonCol]));
      if (d < minDist) { minDist = d; minIdx = i; }
    }
    return {
      ...row,
      [outDistCol]: minDist === Infinity ? null : minDist,
      [outIdCol]:   minIdx,
    };
  });
}

function radiusLabel(radiusMeters) {
  const r = Number(radiusMeters);
  if (!isFinite(r)) return "buffer";
  return r >= 1000 && r % 1000 === 0 ? `${r / 1000}km` : `${Math.round(r)}m`;
}

function metricCirclePolys(cx, cy, radiusMeters, segments = 48) {
  const n = Math.max(12, Math.min(180, Math.round(Number(segments) || 48)));
  const r = Number(radiusMeters);
  const poly = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    poly.push({ x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r });
  }
  return [poly];
}

function isProjectedWktCoords(wkt) {
  if (!wkt || typeof wkt !== "string") return false;
  const m = wkt.match(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/);
  if (!m) return false;
  return Math.abs(Number(m[1])) > 180 || Math.abs(Number(m[2])) > 90;
}

function centroidFromWktMetric(wkt, sourceCrs = "EPSG:4326", metricCrs = "EPSG:32721") {
  const geom = geometryFromWktMetric(wkt, { sourceCrs, metricCrs });
  return geometryCentroidXY(geom);
}

export function createMetricPointBuffers(
  rows,
  latCol,
  lonCol,
  radiusMeters = 100,
  options = {}
) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const segments = Number(options.segments ?? 48);
  const radius = Number(radiusMeters);
  if (!isFinite(radius) || radius <= 0) throw new Error("radiusMeters must be > 0");

  let nextId = 1;
  return rows.map(row => {
    const lat = Number(row[latCol]);
    const lon = Number(row[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) {
      return {
        ...row,
        buffer_id: null,
        buffer_radius_m: radius,
        center_lon: null,
        center_lat: null,
        center_x: null,
        center_y: null,
        geometry: null,
        metric_geometry: null,
      };
    }
    const [cx, cy] = transformCoord(lon, lat, "EPSG:4326", metricCrs);
    const polys = metricCirclePolys(cx, cy, radius, segments);
    return {
      ...row,
      buffer_id: nextId++,
      buffer_radius_m: radius,
      center_lon: lon,
      center_lat: lat,
      center_x: cx,
      center_y: cy,
      geometry: projectedPolysToWkt(polys, metricCrs, "EPSG:4326"),
      metric_geometry: projectedPolysToWkt(polys, metricCrs, metricCrs),
    };
  });
}

export function countPointsWithinGridCentroidBuffer(
  gridRows,
  gridWktCol,
  pointRows,
  latCol,
  lonCol,
  radiusMeters = 100,
  outPrefix = "points",
  options = {}
) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const radius = Number(radiusMeters);
  if (!isFinite(radius) || radius <= 0) throw new Error("radiusMeters must be > 0");
  const prefix = String(outPrefix || "points").trim() || "points";
  const countCol = options.outCol || `${prefix}_within_${radiusLabel(radius)}`;

  const pts = pointRows.map((p, idx) => {
    const lat = Number(p[latCol]);
    const lon = Number(p[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const [x, y] = transformCoord(lon, lat, "EPSG:4326", metricCrs);
    return { idx, x, y };
  }).filter(Boolean);

  return gridRows.map(cell => {
    let cx = Number(cell.centroid_x);
    let cy = Number(cell.centroid_y);
    if (!isFinite(cx) || !isFinite(cy)) {
      const clon = Number(cell.centroid_lon);
      const clat = Number(cell.centroid_lat);
      if (isFinite(clon) && isFinite(clat)) {
        [cx, cy] = transformCoord(clon, clat, "EPSG:4326", metricCrs);
      }
    }
    if (!isFinite(cx) || !isFinite(cy)) {
      const wkt = cell.metric_geometry || cell[gridWktCol];
      const cent = centroidFromWktMetric(wkt, cell.metric_geometry ? metricCrs : "auto", metricCrs);
      if (cent) {
        cx = cent.x;
        cy = cent.y;
      }
    }
    if (!isFinite(cx) || !isFinite(cy)) {
      return { ...cell, [countCol]: null, [`${prefix}_buffer_radius_m`]: radius };
    }
    let count = 0;
    for (const p of pts) {
      if (euclidean(cx, cy, p.x, p.y) <= radius) count++;
    }
    return { ...cell, [countCol]: count, [`${prefix}_buffer_radius_m`]: radius };
  });
}

export function nearestNeighborMetric(
  rows, latCol, lonCol,
  referenceRows, refLatCol, refLonCol,
  outDistCol, outIdCol,
  targetCrs = "EPSG:32721"
) {
  const validRefs = referenceRows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r[refLatCol] != null && r[refLonCol] != null &&
                        !isNaN(r[refLatCol]) && !isNaN(r[refLonCol]))
    .map(({ r, i }) => {
      const [x, y] = transformCoord(Number(r[refLonCol]), Number(r[refLatCol]), "EPSG:4326", targetCrs);
      return { r, i, x, y };
    });

  return rows.map(row => {
    const lat = row[latCol];
    const lon = row[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon) || validRefs.length === 0) {
      return { ...row, [outDistCol]: null, [outIdCol]: null };
    }
    const [x, y] = transformCoord(Number(lon), Number(lat), "EPSG:4326", targetCrs);
    let minDist = Infinity;
    let minIdx = null;
    for (const ref of validRefs) {
      const d = euclidean(x, y, ref.x, ref.y);
      if (d < minDist) { minDist = d; minIdx = ref.i; }
    }
    return {
      ...row,
      [outDistCol]: minDist === Infinity ? null : minDist,
      [outIdCol]: minIdx,
    };
  });
}

export function addDistanceBins(rows, distCol, outCol, cuts = [100, 200, 300]) {
  const sorted = [...cuts].map(Number).filter(v => isFinite(v) && v > 0).sort((a, b) => a - b);
  return rows.map(row => {
    const d = Number(row[distCol]);
    if (!isFinite(d)) return { ...row, [outCol]: null };
    let lo = 0;
    for (const hi of sorted) {
      if (d < hi) return { ...row, [outCol]: `${lo}-${hi}m` };
      lo = hi;
    }
    return { ...row, [outCol]: `${sorted[sorted.length - 1] ?? 0}m+` };
  });
}

// ─── GRID GENERATION ──────────────────────────────────────────────────────────

/**
 * st_make_grid equivalent: generates rectangular grid cells (as WKT POLYGON
 * strings) clipped to a boundary WKT polygon.
 *
 * Works in WGS-84 decimal degrees. Cell sizes are converted from metres using
 * the standard approximation at the centroid latitude:
 *   1° lat ≈ 111 320 m
 *   1° lon ≈ 111 320 · cos(lat) m
 *
 * A cell is included if its centroid falls inside the boundary (ray-casting).
 * Hard cap: 25 000 cells — throws if exceeded so the UI can warn the user.
 *
 * @param   {string}  boundaryWkt    WKT POLYGON or MULTIPOLYGON string
 * @param   {number}  cellsizeMeters Grid cell side length in metres (default 500)
 * @returns {Array<{grid_id:number, geometry:string}>}
 */
export function makeGrid(boundaryWkt, cellsizeMeters = 500, clipBorder = true) {
  if (!boundaryWkt || typeof boundaryWkt !== "string") throw new Error("boundaryWkt must be a WKT string");
  if (cellsizeMeters <= 0) throw new Error("cellsizeMeters must be > 0");

  const MAX_CELLS = 25_000;

  // ── Parse outer ring(s) ──────────────────────────────────────────────────
  // Returns [{lon, lat}] rings; captures outer ring of each polygon part.
  function parseRings(wkt) {
    const parsed = parseWKTRings(wkt)
      .map(r => r.map(([lon, lat]) => ({ lon, lat })))
      .filter(r => r.length >= 3);
    const signedArea = (ring) => {
      let a = 0;
      for (let i = 0; i < ring.length; i++) {
        const p1 = ring[i], p2 = ring[(i + 1) % ring.length];
        a += p1.lon * p2.lat - p2.lon * p1.lat;
      }
      return a / 2;
    };
    const outers = parsed.filter(r => signedArea(r) > 0);
    return outers.length ? outers : parsed;
  }

  const rings = parseRings(boundaryWkt);
  if (!rings.length) throw new Error("Could not parse boundary WKT. Expected POLYGON or MULTIPOLYGON.");

  // ── Bounding box ──────────────────────────────────────────────────────────
  const allLons = rings.flatMap(r => r.map(p => p.lon));
  const allLats = rings.flatMap(r => r.map(p => p.lat));
  const minLon = arrMin(allLons), maxLon = arrMax(allLons);
  const minLat = arrMin(allLats), maxLat = arrMax(allLats);

  // ── Degree sizes ──────────────────────────────────────────────────────────
  const centerLat = (minLat + maxLat) / 2;
  const dLat = cellsizeMeters / 111_320;
  const dLon = cellsizeMeters / (111_320 * Math.cos(centerLat * Math.PI / 180));

  // Safety: estimate cell count before generating
  const nCols = Math.ceil((maxLon - minLon) / dLon);
  const nRows = Math.ceil((maxLat - minLat) / dLat);
  if (nCols * nRows > MAX_CELLS * 4) {
    throw new Error(
      `Cell size ${cellsizeMeters} m would produce ~${(nCols * nRows).toLocaleString()} candidate cells — too many. Increase cell size.`
    );
  }

  // ── Point-in-polygon (ray casting) for any ring ───────────────────────────
  function pip(lat, lon) {
    for (const ring of rings) {
      let inside = false;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const { lon: xi, lat: yi } = ring[i];
        const { lon: xj, lat: yj } = ring[j];
        if ((yi > lat) !== (yj > lat) &&
            lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
          inside = !inside;
        }
      }
      if (inside) return true;
    }
    return false;
  }

  // ── Sutherland-Hodgman polygon clipping ──────────────────────────────────
  // Exact intersection of each boundary ring with the cell rect. The rect is
  // convex, so SH gives the geometrically exact clip even when the boundary
  // ring is non-convex (harbors, fjords, peninsulas). Replaces an earlier
  // convex-hull approximation that produced diagonal artifacts on complex coasts.
  //
  // Returns:
  //   - null if no ring's interior intersects the rect
  //   - array of polygon point-arrays (one per ring with a non-empty result);
  //     each polygon is CCW or matches the source ring orientation
  function clipRectToRings(rLon0, rLat0, rLon1, rLat1) {
    // Four half-planes defining the rect interior (interior is "inside" each):
    //   bottom: lat ≥ rLat0
    //   right:  lon ≤ rLon1
    //   top:    lat ≤ rLat1
    //   left:   lon ≥ rLon0
    // Each plane has an axis-aligned boundary value and an inequality direction.
    const planes = [
      { axis: "lat", side: 1, val: rLat0 },  // keep lat >= rLat0
      { axis: "lon", side: -1, val: rLon1 }, // keep lon <= rLon1
      { axis: "lat", side: -1, val: rLat1 }, // keep lat <= rLat1
      { axis: "lon", side: 1, val: rLon0 },  // keep lon >= rLon0
    ];
    const inside = (p, pl) => {
      const v = pl.axis === "lat" ? p.lat : p.lon;
      return pl.side > 0 ? v >= pl.val : v <= pl.val;
    };
    // Linear interpolation of segment s→e where it crosses the plane boundary.
    const interp = (s, e, pl) => {
      if (pl.axis === "lat") {
        const t = (pl.val - s.lat) / (e.lat - s.lat);
        return { lon: s.lon + t * (e.lon - s.lon), lat: pl.val };
      }
      const t = (pl.val - s.lon) / (e.lon - s.lon);
      return { lon: pl.val, lat: s.lat + t * (e.lat - s.lat) };
    };
    // One SH pass: clip a subject polygon against a single half-plane.
    function clipOne(subj, pl) {
      if (!subj.length) return subj;
      const out = [];
      let s = subj[subj.length - 1]; // wrap-around edge: last → first
      for (const e of subj) {
        const eIn = inside(e, pl);
        const sIn = inside(s, pl);
        if (eIn) {
          if (!sIn) out.push(interp(s, e, pl));
          out.push(e);
        } else if (sIn) {
          out.push(interp(s, e, pl));
        }
        s = e;
      }
      return out;
    }

    const results = [];
    for (const ring of rings) {
      // Drop the closing duplicate vertex if present (POLYGON((... x1 y1)) has
      // first == last) — SH already wraps via the last→first edge.
      let poly = ring.slice();
      if (poly.length > 1) {
        const a = poly[0], b = poly[poly.length - 1];
        if (a.lon === b.lon && a.lat === b.lat) poly.pop();
      }
      for (const pl of planes) {
        poly = clipOne(poly, pl);
        if (!poly.length) break;
      }
      if (poly.length >= 3) results.push(poly);
    }
    return results.length ? results : null;
  }

  // ── Generate cells ────────────────────────────────────────────────────────
  const f = n => n.toFixed(8);
  const cells = [];
  for (let row = 0; minLat + row * dLat < maxLat + dLat * 0.01; row++) {
    for (let col = 0; minLon + col * dLon < maxLon + dLon * 0.01; col++) {
      const lon0 = minLon + col * dLon;
      const lat0 = minLat + row * dLat;
      const lon1 = lon0 + dLon, lat1 = lat0 + dLat;
      const cLat = lat0 + dLat / 2, cLon = lon0 + dLon / 2;

      // Include cell if any corner or centroid is inside boundary
      const inside =
        pip(lat0, lon0) || pip(lat0, lon1) ||
        pip(lat1, lon0) || pip(lat1, lon1) || pip(cLat, cLon);
      if (!inside) continue;

      if (cells.length >= MAX_CELLS) {
        throw new Error(`Grid exceeds ${MAX_CELLS.toLocaleString()} cells. Increase cell size.`);
      }

      let polys;
      if (clipBorder) {
        polys = clipRectToRings(lon0, lat0, lon1, lat1);
      }
      // Fall back to full rectangle (interior cells or failed clip)
      if (!polys) {
        polys = [[
          { lon: lon0, lat: lat0 }, { lon: lon1, lat: lat0 },
          { lon: lon1, lat: lat1 }, { lon: lon0, lat: lat1 },
        ]];
      }

      const ringWkt = p => [...p, p[0]].map(v => `${f(v.lon)} ${f(v.lat)}`).join(", ");
      const geometry = polys.length === 1
        ? `POLYGON((${ringWkt(polys[0])}))`
        : `MULTIPOLYGON(${polys.map(p => `((${ringWkt(p)}))`).join(", ")})`;
      cells.push({ grid_id: cells.length + 1, geometry });
    }
  }
  return cells;
}

function xyArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

function xyCentroid(poly) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) {
    return {
      x: poly.reduce((s, p) => s + p.x, 0) / poly.length,
      y: poly.reduce((s, p) => s + p.y, 0) / poly.length,
    };
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function xyPointInRings(x, y, rings) {
  for (const ring of rings) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const pi = ring[i], pj = ring[j];
      if ((pi.y > y) !== (pj.y > y) &&
          x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
        inside = !inside;
      }
    }
    if (inside) return true;
  }
  return false;
}

function clipRingsToRectXY(rings, x0, y0, x1, y1) {
  const planes = [
    { axis: "y", side: 1, val: y0 },
    { axis: "x", side: -1, val: x1 },
    { axis: "y", side: -1, val: y1 },
    { axis: "x", side: 1, val: x0 },
  ];
  const inside = (p, pl) => {
    const v = pl.axis === "x" ? p.x : p.y;
    return pl.side > 0 ? v >= pl.val : v <= pl.val;
  };
  const interp = (s, e, pl) => {
    if (pl.axis === "y") {
      const t = (pl.val - s.y) / (e.y - s.y);
      return { x: s.x + t * (e.x - s.x), y: pl.val };
    }
    const t = (pl.val - s.x) / (e.x - s.x);
    return { x: pl.val, y: s.y + t * (e.y - s.y) };
  };
  const clipOne = (subj, pl) => {
    if (!subj.length) return subj;
    const out = [];
    let s = subj[subj.length - 1];
    for (const e of subj) {
      const eIn = inside(e, pl), sIn = inside(s, pl);
      if (eIn) {
        if (!sIn) out.push(interp(s, e, pl));
        out.push(e);
      } else if (sIn) {
        out.push(interp(s, e, pl));
      }
      s = e;
    }
    return out;
  };

  const out = [];
  for (const ring of rings) {
    let poly = ring.slice();
    if (poly.length > 1) {
      const a = poly[0], b = poly[poly.length - 1];
      if (a.x === b.x && a.y === b.y) poly.pop();
    }
    for (const pl of planes) {
      poly = clipOne(poly, pl);
      if (!poly.length) break;
    }
    if (poly.length >= 3 && xyArea(poly) > 1e-6) out.push(poly);
  }
  return out.length ? out : null;
}

function projectedPolysToWkt(polys, fromCrs, toCrs) {
  const fmt = n => Number(n).toFixed(toCrs === "EPSG:4326" ? 8 : 3).replace(/\.?0+$/, "");
  const ring = poly => [...poly, poly[0]].map(p => {
    const [x, y] = transformCoord(p.x, p.y, fromCrs, toCrs);
    return `${fmt(x)} ${fmt(y)}`;
  }).join(", ");
  return polys.length === 1
    ? `POLYGON((${ring(polys[0])}))`
    : `MULTIPOLYGON(${polys.map(p => `((${ring(p)}))`).join(", ")})`;
}

export function makeProjectedGrid(
  boundaryWkt,
  cellsizeMeters = 500,
  clipBorder = true,
  options = {}
) {
  if (!boundaryWkt || typeof boundaryWkt !== "string") throw new Error("boundaryWkt must be a WKT string");
  if (cellsizeMeters <= 0) throw new Error("cellsizeMeters must be > 0");
  const sourceCrs = normalizeCrs(options.sourceCrs ?? "EPSG:4326");
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outputCrs = normalizeCrs(options.outputCrs ?? "EPSG:4326");
  const MAX_CELLS = Number(options.maxCells ?? 60000);

  const metricWkt = sourceCrs === metricCrs
    ? boundaryWkt
    : transformWKT(boundaryWkt, sourceCrs, metricCrs, 3);
  const rings = parseWKTRings(metricWkt)
    .map(r => r.map(([x, y]) => ({ x, y })).filter(p => isFinite(p.x) && isFinite(p.y)))
    .filter(r => r.length >= 3);
  if (!rings.length) throw new Error("Could not parse boundary WKT. Expected POLYGON or MULTIPOLYGON.");

  const xs = rings.flatMap(r => r.map(p => p.x));
  const ys = rings.flatMap(r => r.map(p => p.y));
  const minX = arrMin(xs), maxX = arrMax(xs), minY = arrMin(ys), maxY = arrMax(ys);
  const nCols = Math.ceil((maxX - minX) / cellsizeMeters);
  const nRows = Math.ceil((maxY - minY) / cellsizeMeters);
  if (nCols * nRows > MAX_CELLS * 4) {
    throw new Error(`Cell size ${cellsizeMeters} m would produce ~${(nCols * nRows).toLocaleString()} candidate cells. Increase cell size.`);
  }

  const cells = [];
  for (let row = 0; minY + row * cellsizeMeters < maxY + cellsizeMeters * 0.01; row++) {
    for (let col = 0; minX + col * cellsizeMeters < maxX + cellsizeMeters * 0.01; col++) {
      const x0 = minX + col * cellsizeMeters;
      const y0 = minY + row * cellsizeMeters;
      const x1 = x0 + cellsizeMeters;
      const y1 = y0 + cellsizeMeters;
      const cx = x0 + cellsizeMeters / 2;
      const cy = y0 + cellsizeMeters / 2;
      const inside =
        xyPointInRings(cx, cy, rings) ||
        xyPointInRings(x0, y0, rings) || xyPointInRings(x0, y1, rings) ||
        xyPointInRings(x1, y0, rings) || xyPointInRings(x1, y1, rings);
      const clipped = clipBorder ? clipRingsToRectXY(rings, x0, y0, x1, y1) : null;
      if (!inside && !clipped) continue;
      if (cells.length >= MAX_CELLS) throw new Error(`Grid exceeds ${MAX_CELLS.toLocaleString()} cells. Increase cell size.`);

      const polys = clipBorder && clipped ? clipped : [[
        { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
      ]];
      const area = polys.reduce((s, p) => s + xyArea(p), 0);
      const largest = polys.reduce((best, p) => xyArea(p) > xyArea(best) ? p : best, polys[0]);
      const cent = xyCentroid(largest);
      const [centLon, centLat] = transformCoord(cent.x, cent.y, metricCrs, "EPSG:4326");
      const displayGeometry = projectedPolysToWkt(polys, metricCrs, outputCrs);
      const metricGeometry = projectedPolysToWkt(polys, metricCrs, metricCrs);
      cells.push({
        grid_id: cells.length + 1,
        geometry: displayGeometry,
        metric_geometry: metricGeometry,
        centroid_lon: centLon,
        centroid_lat: centLat,
        centroid_x: cent.x,
        centroid_y: cent.y,
        area_m2: area,
        cellsize_m: Number(cellsizeMeters),
        metric_crs: metricCrs,
      });
    }
  }
  return cells;
}

/**
 * Aggregates point rows into grid cells.
 * For each cell (identified by its WKT geometry), counts/sums/averages matching
 * points. Returns the grid rows enriched with aggregate columns.
 *
 * aggSpecs: [{ col: "schools", fn: "count"|"sum"|"mean"|"share", outCol: "n_schools" }]
 * Use fn="count" with col="" to simply count rows.
 *
 * O(n_points × n_cells) — suitable for ≤ 5 000 × 10 000.
 */
export function aggregateToGrid(gridRows, gridWktCol, pointRows, latCol, lonCol, aggSpecs) {
  const cells = gridRows.map(cell => {
    const wkt = cell[gridWktCol];
    if (!wkt) return { cell, rings: [], bbox: null, projected: false };
    const projected = gridWktCol === "metric_geometry" || isProjectedWktCoords(wkt);
    const rings = parseWKTRings(wkt);
    return { cell, rings, bbox: ringsBBox(rings), projected };
  });
  const points = pointRows.map(p => {
    const lat = parseFloat(p[latCol]);
    const lon = parseFloat(p[lonCol]);
    if (isNaN(lat) || isNaN(lon)) return null;
    const [mx, my] = transformCoord(lon, lat, "EPSG:4326", "EPSG:32721");
    return { row: p, lat, lon, mx, my };
  }).filter(Boolean);

  return cells.map(({ cell, rings, bbox, projected }) => {
    if (!rings.length) return cell;
    const matched = points.filter(p => {
      if (projected) {
        return bboxContains(bbox, p.mx, p.my) && pointInParsedRings(p.my, p.mx, rings);
      }
      return bboxContains(bbox, p.lon, p.lat) && pointInParsedRings(p.lat, p.lon, rings);
    }).map(p => p.row);
    const extra = {};
    for (const { col, fn, outCol } of aggSpecs) {
      if (fn === "count") {
        extra[outCol] = matched.length;
      } else if (fn === "sum") {
        extra[outCol] = matched.reduce((s, p) => s + (parseFloat(p[col]) || 0), 0);
      } else if (fn === "mean") {
        const vals = matched.map(p => parseFloat(p[col])).filter(v => !isNaN(v));
        extra[outCol] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      } else if (fn === "share") {
        if (!matched.length) {
          extra[outCol] = 0;
        } else {
          const positives = matched.filter(p => {
            const v = p[col];
            if (typeof v === "number") return v > 0;
            return /^(1|true|yes|y|si|sí)$/i.test(String(v ?? "").trim());
          }).length;
          extra[outCol] = positives / matched.length;
        }
      }
    }
    return { ...cell, ...extra };
  });
}

function summarizeMatchedPoints(matched, aggSpecs) {
  const extra = {};
  for (const { col, fn, outCol } of aggSpecs) {
    if (fn === "count") {
      extra[outCol] = matched.length;
    } else if (fn === "sum") {
      extra[outCol] = matched.reduce((s, p) => s + (parseFloat(p[col]) || 0), 0);
    } else if (fn === "mean") {
      const vals = matched.map(p => parseFloat(p[col])).filter(v => !isNaN(v));
      extra[outCol] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
    } else if (fn === "share") {
      if (!matched.length) {
        extra[outCol] = 0;
      } else {
        const positives = matched.filter(p => {
          const v = p[col];
          if (typeof v === "number") return v > 0;
          return /^(1|true|yes|y|si|sí)$/i.test(String(v ?? "").trim());
        }).length;
        extra[outCol] = positives / matched.length;
      }
    }
  }
  return extra;
}

export function aggregateGridById(gridRows, gridIdCol, pointRows, pointGridCol, aggSpecs) {
  const groups = new Map();
  for (const row of pointRows) {
    const id = row[pointGridCol];
    if (id == null || id === "") continue;
    const key = String(id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return gridRows.map(cell => {
    const id = cell[gridIdCol];
    const matched = id == null ? [] : (groups.get(String(id)) ?? []);
    return { ...cell, ...summarizeMatchedPoints(matched, aggSpecs) };
  });
}

// --- POLYGON KERNEL ---------------------------------------------------------
// The public operations below share one WKT parser and one planar measurement
// path. Areas are computed in a metric CRS; interval-sweep overlay avoids
// double-counting overlapping MULTIPOLYGON parts and honors polygon holes.

const GEOM_EPS = 1e-9;

function cleanRingXY(ring) {
  const pts = ring
    .map(([x, y]) => ({ x: Number(x), y: Number(y) }))
    .filter(p => isFinite(p.x) && isFinite(p.y));
  if (pts.length > 1) {
    const a = pts[0], b = pts[pts.length - 1];
    if (Math.abs(a.x - b.x) < GEOM_EPS && Math.abs(a.y - b.y) < GEOM_EPS) pts.pop();
  }
  return pts.length >= 3 ? pts : null;
}

function parseWKTMultiPolygonXY(wkt) {
  if (!wkt || typeof wkt !== "string") return [];
  const raw = wkt.trim();
  const s = raw.toUpperCase();
  if (!s.startsWith("POLYGON") && !s.startsWith("MULTIPOLYGON")) return [];
  const body = raw.slice(raw.indexOf("("));
  const inner = splitParenGroups(body)[0];
  if (!inner) return [];

  const polys = [];
  if (s.startsWith("MULTIPOLYGON")) {
    for (const polyStr of splitParenGroups(inner)) {
      const rings = splitParenGroups(polyStr).map(r => cleanRingXY(_parseRingStr(r))).filter(Boolean);
      if (rings.length) polys.push({ rings });
    }
  } else {
    const rings = splitParenGroups(inner).map(r => cleanRingXY(_parseRingStr(r))).filter(Boolean);
    if (rings.length) polys.push({ rings });
  }
  return polys;
}

function geometryFromWktMetric(wkt, options = {}) {
  if (!wkt || typeof wkt !== "string") return [];
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const src = options.sourceCrs === "auto"
    ? (isProjectedWktCoords(wkt) ? metricCrs : "EPSG:4326")
    : normalizeCrs(options.sourceCrs ?? "EPSG:4326");
  const metricWkt = src === metricCrs ? wkt : transformWKT(wkt, src, metricCrs, 3);
  return parseWKTMultiPolygonXY(metricWkt);
}

function ringSignedAreaXY(ring) {
  let a = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function ringCentroidSignedXY(ring) {
  let twiceArea = 0, cx = 0, cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length];
    const cross = p.x * q.y - q.x * p.y;
    twiceArea += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(twiceArea) < GEOM_EPS) {
    return {
      area: 0,
      x: ring.reduce((s, p) => s + p.x, 0) / ring.length,
      y: ring.reduce((s, p) => s + p.y, 0) / ring.length,
    };
  }
  return { area: twiceArea / 2, x: cx / (3 * twiceArea), y: cy / (3 * twiceArea) };
}

function geometryAreaXY(geom) {
  let area = 0;
  for (const poly of geom) {
    if (!poly.rings?.length) continue;
    area += Math.abs(ringSignedAreaXY(poly.rings[0]));
    for (let i = 1; i < poly.rings.length; i++) area -= Math.abs(ringSignedAreaXY(poly.rings[i]));
  }
  return Math.max(0, area);
}

function geometryCentroidXY(geom) {
  let sumArea = 0, sx = 0, sy = 0;
  for (const poly of geom) {
    if (!poly.rings?.length) continue;
    for (let i = 0; i < poly.rings.length; i++) {
      const c = ringCentroidSignedXY(poly.rings[i]);
      const signed = (i === 0 ? 1 : -1) * Math.abs(c.area);
      if (Math.abs(signed) < GEOM_EPS) continue;
      sumArea += signed;
      sx += c.x * signed;
      sy += c.y * signed;
    }
  }
  if (Math.abs(sumArea) < GEOM_EPS) {
    const pts = geom.flatMap(p => p.rings ?? []).flat();
    if (!pts.length) return null;
    return {
      x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
      y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
    };
  }
  return { x: sx / sumArea, y: sy / sumArea };
}

function pointInRingXY(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const pi = ring[i], pj = ring[j];
    const onSegment =
      Math.abs((pj.x - pi.x) * (y - pi.y) - (pj.y - pi.y) * (x - pi.x)) < 1e-8 &&
      x >= Math.min(pi.x, pj.x) - 1e-8 && x <= Math.max(pi.x, pj.x) + 1e-8 &&
      y >= Math.min(pi.y, pj.y) - 1e-8 && y <= Math.max(pi.y, pj.y) + 1e-8;
    if (onSegment) return true;
    if ((pi.y > y) !== (pj.y > y) &&
        x < ((pj.x - pi.x) * (y - pi.y)) / (pj.y - pi.y) + pi.x) {
      inside = !inside;
    }
  }
  return inside;
}

function pointInGeometryXY(x, y, geom) {
  for (const poly of geom) {
    if (!poly.rings?.length) continue;
    if (!pointInRingXY(x, y, poly.rings[0])) continue;
    let inHole = false;
    for (let i = 1; i < poly.rings.length; i++) {
      if (pointInRingXY(x, y, poly.rings[i])) { inHole = true; break; }
    }
    if (!inHole) return true;
  }
  return false;
}

function geometryBboxXY(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of geom.flatMap(poly => poly.rings ?? []).flat()) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

function bboxIntersects(a, b) {
  return a && b && a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function bboxIntersection(a, b) {
  if (!bboxIntersects(a, b)) return null;
  return {
    minX: Math.max(a.minX, b.minX),
    maxX: Math.min(a.maxX, b.maxX),
    minY: Math.max(a.minY, b.minY),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

function ringIntervalsAtX(ring, x) {
  const ys = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (Math.abs(a.x - b.x) < GEOM_EPS) continue;
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const t = (x - a.x) / (b.x - a.x);
      ys.push(a.y + t * (b.y - a.y));
    }
  }
  ys.sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i + 1 < ys.length; i += 2) {
    if (ys[i + 1] - ys[i] > GEOM_EPS) out.push([ys[i], ys[i + 1]]);
  }
  return out;
}

function intervalUnion(intervals) {
  if (!intervals.length) return [];
  const sorted = intervals
    .filter(([a, b]) => b - a > GEOM_EPS)
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (!last || iv[0] > last[1] + GEOM_EPS) out.push([iv[0], iv[1]]);
    else last[1] = Math.max(last[1], iv[1]);
  }
  return out;
}

function intervalIntersection(a, b) {
  const out = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const lo = Math.max(a[i][0], b[j][0]);
    const hi = Math.min(a[i][1], b[j][1]);
    if (hi - lo > GEOM_EPS) out.push([lo, hi]);
    if (a[i][1] < b[j][1]) i++; else j++;
  }
  return out;
}

function intervalSubtract(a, b) {
  let out = a.slice();
  for (const [blo, bhi] of b) {
    const next = [];
    for (const [alo, ahi] of out) {
      if (bhi <= alo + GEOM_EPS || blo >= ahi - GEOM_EPS) {
        next.push([alo, ahi]);
      } else {
        if (blo - alo > GEOM_EPS) next.push([alo, blo]);
        if (ahi - bhi > GEOM_EPS) next.push([bhi, ahi]);
      }
    }
    out = next;
    if (!out.length) break;
  }
  return out;
}

function polygonIntervalsAtX(poly, x) {
  if (!poly.rings?.length) return [];
  let out = ringIntervalsAtX(poly.rings[0], x);
  for (let i = 1; i < poly.rings.length; i++) {
    out = intervalSubtract(out, ringIntervalsAtX(poly.rings[i], x));
  }
  return out;
}

function geometryIntervalsAtX(geom, x) {
  return intervalUnion(geom.flatMap(poly => polygonIntervalsAtX(poly, x)));
}

function allSegmentsXY(geom) {
  const segs = [];
  for (const ring of geom.flatMap(poly => poly.rings ?? [])) {
    for (let i = 0; i < ring.length; i++) {
      segs.push([ring[i], ring[(i + 1) % ring.length]]);
    }
  }
  return segs;
}

function segmentIntersectionX(a, b, c, d) {
  const den = (a.x - b.x) * (c.y - d.y) - (a.y - b.y) * (c.x - d.x);
  if (Math.abs(den) < GEOM_EPS) return null;
  const px = ((a.x * b.y - a.y * b.x) * (c.x - d.x) - (a.x - b.x) * (c.x * d.y - c.y * d.x)) / den;
  const py = ((a.x * b.y - a.y * b.x) * (c.y - d.y) - (a.y - b.y) * (c.x * d.y - c.y * d.x)) / den;
  const inA = px >= Math.min(a.x, b.x) - 1e-7 && px <= Math.max(a.x, b.x) + 1e-7 &&
              py >= Math.min(a.y, b.y) - 1e-7 && py <= Math.max(a.y, b.y) + 1e-7;
  const inB = px >= Math.min(c.x, d.x) - 1e-7 && px <= Math.max(c.x, d.x) + 1e-7 &&
              py >= Math.min(c.y, d.y) - 1e-7 && py <= Math.max(c.y, d.y) + 1e-7;
  return inA && inB ? px : null;
}

function collectSweepBreakpoints(geoms, xRange, maxSegmentPairs = 180000) {
  const xs = [xRange.minX, xRange.maxX];
  for (const geom of geoms) {
    for (const ring of geom.flatMap(poly => poly.rings ?? [])) {
      for (const p of ring) {
        if (p.x > xRange.minX + GEOM_EPS && p.x < xRange.maxX - GEOM_EPS) xs.push(p.x);
      }
    }
  }
  const segs = geoms.flatMap(allSegmentsXY)
    .filter(([a, b]) => Math.max(a.x, b.x) >= xRange.minX && Math.min(a.x, b.x) <= xRange.maxX);
  if (segs.length * (segs.length - 1) / 2 <= maxSegmentPairs) {
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const x = segmentIntersectionX(segs[i][0], segs[i][1], segs[j][0], segs[j][1]);
        if (x != null && x > xRange.minX + GEOM_EPS && x < xRange.maxX - GEOM_EPS) xs.push(x);
      }
    }
  }
  const sorted = [...new Set(xs.map(x => Number(x.toFixed(9))))].sort((a, b) => a - b);
  return sorted.length >= 2 ? sorted : [xRange.minX, xRange.maxX];
}

function intervalLength(intervals) {
  return intervals.reduce((s, [a, b]) => s + Math.max(0, b - a), 0);
}

function sweepIntervalsAtX(geoms, mode, x) {
  if (mode === "union") return intervalUnion(geoms.flatMap(g => geometryIntervalsAtX(g, x)));
  if (mode === "intersection") {
    let out = geometryIntervalsAtX(geoms[0], x);
    for (let i = 1; i < geoms.length; i++) out = intervalIntersection(out, geometryIntervalsAtX(geoms[i], x));
    return out;
  }
  if (mode === "difference") {
    let out = geometryIntervalsAtX(geoms[0], x);
    const rest = intervalUnion(geoms.slice(1).flatMap(g => geometryIntervalsAtX(g, x)));
    return intervalSubtract(out, rest);
  }
  return [];
}

function measureGeometriesXY(geoms, mode = "intersection", options = {}) {
  const valid = geoms.filter(g => g?.length);
  if (!valid.length) return 0;
  if (mode === "area") return geometryAreaXY(valid[0]);

  const bboxes = valid.map(geometryBboxXY).filter(Boolean);
  if (bboxes.length !== valid.length) return 0;
  let xRange;
  if (mode === "union") {
    xRange = {
      minX: Math.min(...bboxes.map(b => b.minX)),
      maxX: Math.max(...bboxes.map(b => b.maxX)),
    };
  } else {
    let b = bboxes[0];
    for (let i = 1; i < bboxes.length; i++) {
      b = bboxIntersection(b, bboxes[i]);
      if (!b) return 0;
    }
    xRange = { minX: b.minX, maxX: b.maxX };
  }
  if (xRange.maxX - xRange.minX <= GEOM_EPS) return 0;
  const xs = collectSweepBreakpoints(valid, xRange, options.maxSegmentPairs);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x0 = xs[i], x1 = xs[i + 1];
    const w = x1 - x0;
    if (w <= GEOM_EPS) continue;
    const e = Math.min(w * 1e-7, 1e-6);
    const l0 = intervalLength(sweepIntervalsAtX(valid, mode, x0 + e));
    const lm = intervalLength(sweepIntervalsAtX(valid, mode, (x0 + x1) / 2));
    const l1 = intervalLength(sweepIntervalsAtX(valid, mode, x1 - e));
    area += w * (l0 + 4 * lm + l1) / 6;
  }
  return Math.max(0, area);
}

function geometryToWkt(geom, fromCrs = "EPSG:32721", toCrs = "EPSG:4326", precision) {
  const out = geom.filter(poly => poly.rings?.length);
  const to = normalizeCrs(toCrs);
  const prec = precision ?? (to === "EPSG:4326" ? 8 : 3);
  const fmt = n => Number(n).toFixed(prec).replace(/\.?0+$/, "");
  const ringToText = ring => {
    const closed = [...ring, ring[0]];
    return closed.map(p => {
      const [x, y] = transformCoord(p.x, p.y, fromCrs, toCrs);
      return `${fmt(x)} ${fmt(y)}`;
    }).join(", ");
  };
  if (out.length === 0) return "POLYGON EMPTY";
  if (out.length === 1) return `POLYGON(${out[0].rings.map(r => `(${ringToText(r)})`).join(", ")})`;
  return `MULTIPOLYGON(${out.map(poly => `(${poly.rings.map(r => `(${ringToText(r)})`).join(", ")})`).join(", ")})`;
}

function filterGeometryByBbox(geom, bbox) {
  if (!bbox) return geom;
  return geom.filter(poly => bboxIntersects(geometryBboxXY([poly]), bbox));
}

export function polygonArea(wkt, options = {}) {
  return geometryAreaXY(geometryFromWktMetric(wkt, {
    sourceCrs: options.sourceCrs ?? "auto",
    metricCrs: options.metricCrs ?? "EPSG:32721",
  }));
}

export function addArea(rows, wktCol, options = {}) {
  const outCol = options.outCol ?? "area_m2";
  return rows.map(row => ({
    ...row,
    [outCol]: row[wktCol] ? polygonArea(row[wktCol], options) : null,
  }));
}

function parseLineWktMetric(wkt, options = {}) {
  if (!wkt || typeof wkt !== "string") return [];
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const src = options.sourceCrs === "auto"
    ? (isProjectedWktCoords(wkt) ? metricCrs : "EPSG:4326")
    : normalizeCrs(options.sourceCrs ?? "EPSG:4326");
  const metricWkt = src === metricCrs ? wkt : transformWKT(wkt, src, metricCrs, 3);
  const raw = metricWkt.trim();
  const s = raw.toUpperCase();
  const coords = str => str.trim().split(",").map(p => {
    const [x, y] = p.trim().split(/\s+/).map(Number);
    return { x, y };
  }).filter(p => isFinite(p.x) && isFinite(p.y));
  if (s.startsWith("LINESTRING")) {
    const inner = raw.slice(raw.indexOf("(") + 1, raw.lastIndexOf(")"));
    const line = coords(inner);
    return line.length >= 2 ? [line] : [];
  }
  if (s.startsWith("MULTILINESTRING")) {
    const body = raw.slice(raw.indexOf("("));
    const inner = splitParenGroups(body)[0];
    return splitParenGroups(inner).map(coords).filter(line => line.length >= 2);
  }
  if (s.startsWith("POLYGON") || s.startsWith("MULTIPOLYGON")) {
    return geometryFromWktMetric(wkt, options).flatMap(poly => poly.rings);
  }
  return [];
}

function lineLengthXY(line) {
  let len = 0;
  for (let i = 0; i + 1 < line.length; i++) len += euclidean(line[i].x, line[i].y, line[i + 1].x, line[i + 1].y);
  return len;
}

export function addLength(rows, wktCol, options = {}) {
  const outCol = options.outCol ?? "length_m";
  return rows.map(row => {
    const lines = parseLineWktMetric(row[wktCol], { sourceCrs: options.sourceCrs ?? "auto", metricCrs: options.metricCrs ?? "EPSG:32721" });
    return { ...row, [outCol]: lines.length ? lines.reduce((s, line) => s + lineLengthXY(line), 0) : null };
  });
}

export function polygonCentroid(rows, wktCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const lonCol = options.lonCol ?? "centroid_lon";
  const latCol = options.latCol ?? "centroid_lat";
  const xCol = options.xCol ?? "centroid_x";
  const yCol = options.yCol ?? "centroid_y";
  return rows.map(row => {
    const geom = geometryFromWktMetric(row[wktCol], { sourceCrs: options.sourceCrs ?? "auto", metricCrs });
    const c = geometryCentroidXY(geom);
    if (!c) return { ...row, [lonCol]: null, [latCol]: null, [xCol]: null, [yCol]: null };
    const [lon, lat] = transformCoord(c.x, c.y, metricCrs, "EPSG:4326");
    return { ...row, [lonCol]: lon, [latCol]: lat, [xCol]: c.x, [yCol]: c.y };
  });
}

function preparePolygonRows(rows, wktCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  return rows.map((row, idx) => {
    const geom = geometryFromWktMetric(row[wktCol], { sourceCrs: options.sourceCrs ?? "auto", metricCrs });
    const bbox = geometryBboxXY(geom);
    const area = geometryAreaXY(geom);
    return { row, idx, geom, bbox, area };
  }).filter(p => p.geom.length && p.area > GEOM_EPS && p.bbox);
}

export function polygonOverlapWeights(sourceRows, sourceWktCol, targetRows, targetWktCol, targetIdCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const source = preparePolygonRows(sourceRows, sourceWktCol, { sourceCrs: options.sourceCrs ?? "auto", metricCrs });
  const target = preparePolygonRows(targetRows, targetWktCol, { sourceCrs: options.targetSourceCrs ?? options.sourceCrs ?? "auto", metricCrs });
  const minArea = Number(options.minArea ?? 1e-8);
  const out = [];
  for (const s of source) {
    for (const t of target) {
      if (!bboxIntersects(s.bbox, t.bbox)) continue;
      const area_intersect = measureGeometriesXY([s.geom, t.geom], "intersection", options);
      if (area_intersect <= minArea) continue;
      out.push({
        source_idx: s.idx,
        target_idx: t.idx,
        target_id: targetIdCol ? t.row[targetIdCol] : t.idx,
        area_intersect,
        area_source: s.area,
        weight: s.area > 0 ? area_intersect / s.area : 0,
      });
    }
  }
  return out;
}

export function arealInterpolate(sourceRows, sourceWktCol, targetRows, targetWktCol, targetIdCol, valueCols, options = {}) {
  const cols = Array.isArray(valueCols) ? valueCols : [valueCols].filter(Boolean);
  const extensive = options.extensive !== false;
  const weights = polygonOverlapWeights(sourceRows, sourceWktCol, targetRows, targetWktCol, targetIdCol, options);
  const outCols = cols.map(c => options.outPrefix ? `${options.outPrefix}_${c}` : c);
  const acc = targetRows.map(row => ({ row: { ...row }, denom: Object.fromEntries(cols.map(c => [c, 0])) }));
  for (let i = 0; i < acc.length; i++) for (const c of outCols) acc[i].row[c] = 0;

  for (const w of weights) {
    const target = acc[w.target_idx];
    const src = sourceRows[w.source_idx];
    if (!target || !src) continue;
    for (let i = 0; i < cols.length; i++) {
      const v = Number(src[cols[i]]);
      if (!isFinite(v)) continue;
      if (extensive) {
        target.row[outCols[i]] += v * w.weight;
      } else {
        target.row[outCols[i]] += v * w.area_intersect;
        target.denom[cols[i]] += w.area_intersect;
      }
    }
  }
  if (!extensive) {
    for (const t of acc) {
      for (let i = 0; i < cols.length; i++) {
        t.row[outCols[i]] = t.denom[cols[i]] > 0 ? t.row[outCols[i]] / t.denom[cols[i]] : null;
      }
    }
  }
  return acc.map(t => t.row);
}

export function dissolveBuffers(bufferRows, wktCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outputCrs = normalizeCrs(options.outputCrs ?? metricCrs);
  const geom = [];
  for (const row of bufferRows) {
    const g = geometryFromWktMetric(row[wktCol], { sourceCrs: options.sourceCrs ?? "auto", metricCrs });
    geom.push(...g);
  }
  return geometryToWkt(geom, metricCrs, outputCrs, options.precision);
}

export function gridExposureShare(gridRows, gridWktCol, gridIdCol, dissolvedWkt, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outCol = options.outCol ?? "exposure_share";
  const exposedAreaCol = options.exposedAreaCol ?? `${outCol}_area_m2`;
  const totalAreaCol = options.totalAreaCol ?? "area_total_m2";
  const dissolved = geometryFromWktMetric(dissolvedWkt, { sourceCrs: options.dissolvedSourceCrs ?? "auto", metricCrs });
  const dissolvedBBox = geometryBboxXY(dissolved);
  return gridRows.map(row => {
    const gridWkt = row[gridWktCol] ?? row.geometry ?? row.metric_geometry;
    const sourceCrs = options.gridSourceCrs ?? (gridWktCol === "metric_geometry" || isProjectedWktCoords(gridWkt) ? metricCrs : "auto");
    const cell = geometryFromWktMetric(gridWkt, { sourceCrs, metricCrs });
    const bbox = geometryBboxXY(cell);
    const total = Number(row.area_m2) > 0 ? Number(row.area_m2) : geometryAreaXY(cell);
    let exposed = 0;
    if (total > 0 && bboxIntersects(bbox, dissolvedBBox)) {
      const localDissolved = filterGeometryByBbox(dissolved, bbox);
      exposed = measureGeometriesXY([cell, localDissolved], "intersection", options);
    }
    let share = total > 0 ? exposed / total : null;
    if (share != null && options.clamp !== false) share = Math.max(0, Math.min(1, share));
    return { ...row, [outCol]: share, [exposedAreaCol]: exposed, [totalAreaCol]: total, [gridIdCol]: row[gridIdCol] };
  });
}

export function countBuffersIntersectingGrid(gridRows, gridWktCol, gridIdCol, bufferRows, bufferWktCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outCol = options.outCol ?? "n_buffers_overlapping";
  const buffers = preparePolygonRows(bufferRows, bufferWktCol, { sourceCrs: options.bufferSourceCrs ?? "auto", metricCrs });
  const minArea = Number(options.minArea ?? 1e-8);
  return gridRows.map(row => {
    const gridWkt = row[gridWktCol] ?? row.geometry ?? row.metric_geometry;
    const sourceCrs = options.gridSourceCrs ?? (gridWktCol === "metric_geometry" || isProjectedWktCoords(gridWkt) ? metricCrs : "auto");
    const geom = geometryFromWktMetric(gridWkt, { sourceCrs, metricCrs });
    const bbox = geometryBboxXY(geom);
    let count = 0;
    for (const b of buffers) {
      if (!bboxIntersects(bbox, b.bbox)) continue;
      const area = measureGeometriesXY([geom, b.geom], "intersection", options);
      if (area > minArea) count++;
    }
    return { ...row, [outCol]: count, [gridIdCol]: row[gridIdCol] };
  });
}

function isConvexRing(ring) {
  if (ring.length < 3) return false;
  let sign = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length], c = ring[(i + 2) % ring.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-8) continue;
    const s = Math.sign(cross);
    if (!sign) sign = s;
    else if (sign !== s) return false;
  }
  return true;
}

function clipRingByConvex(subject, clip) {
  if (!subject.length || !clip.length) return [];
  const orient = Math.sign(ringSignedAreaXY(clip)) || 1;
  const inside = (p, a, b) => orient * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) >= -1e-8;
  const intersect = (s, e, a, b) => {
    const den = (s.x - e.x) * (a.y - b.y) - (s.y - e.y) * (a.x - b.x);
    if (Math.abs(den) < GEOM_EPS) return e;
    const px = ((s.x * e.y - s.y * e.x) * (a.x - b.x) - (s.x - e.x) * (a.x * b.y - a.y * b.x)) / den;
    const py = ((s.x * e.y - s.y * e.x) * (a.y - b.y) - (s.y - e.y) * (a.x * b.y - a.y * b.x)) / den;
    return { x: px, y: py };
  };
  let out = subject.slice();
  for (let i = 0; i < clip.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const input = out;
    out = [];
    if (!input.length) break;
    let s = input[input.length - 1];
    for (const e of input) {
      const eIn = inside(e, a, b), sIn = inside(s, a, b);
      if (eIn) {
        if (!sIn) out.push(intersect(s, e, a, b));
        out.push(e);
      } else if (sIn) {
        out.push(intersect(s, e, a, b));
      }
      s = e;
    }
  }
  return out.length >= 3 ? out : [];
}

function intersectionGeometryIfConvex(a, b) {
  if (a.length !== 1 || b.length !== 1 || a[0].rings.length !== 1 || b[0].rings.length !== 1) return [];
  const ar = a[0].rings[0], br = b[0].rings[0];
  let ring = [];
  if (isConvexRing(br)) ring = clipRingByConvex(ar, br);
  else if (isConvexRing(ar)) ring = clipRingByConvex(br, ar);
  return ring.length ? [{ rings: [ring] }] : [];
}

export function polygonSetOp(aRows, aWktCol, bRows, bWktCol, op = "intersection", options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outputCrs = normalizeCrs(options.outputCrs ?? "EPSG:4326");
  const aPrep = preparePolygonRows(aRows, aWktCol, { sourceCrs: options.aSourceCrs ?? options.sourceCrs ?? "auto", metricCrs });
  const bPrep = preparePolygonRows(bRows, bWktCol, { sourceCrs: options.bSourceCrs ?? options.sourceCrs ?? "auto", metricCrs });
  const rows = [];
  for (const a of aPrep) {
    for (const b of bPrep) {
      if (!bboxIntersects(a.bbox, b.bbox) && op !== "union") continue;
      const area = op === "union"
        ? measureGeometriesXY([a.geom, b.geom], "union", options)
        : op === "difference"
          ? measureGeometriesXY([a.geom, b.geom], "difference", options)
          : measureGeometriesXY([a.geom, b.geom], "intersection", options);
      if (area <= Number(options.minArea ?? 1e-8)) continue;
      let geom = [];
      if (op === "intersection") geom = intersectionGeometryIfConvex(a.geom, b.geom);
      if (op === "union") geom = [...a.geom, ...b.geom];
      if (op === "difference") geom = a.geom;
      rows.push({
        a_idx: a.idx,
        b_idx: b.idx,
        op,
        area_m2: area,
        geometry: geom.length ? geometryToWkt(geom, metricCrs, outputCrs, options.precision) : null,
      });
    }
  }
  return rows;
}

function centroidForWeights(row, geomCol, metricCrs) {
  const geom = geometryFromWktMetric(row[geomCol], { sourceCrs: "auto", metricCrs });
  return geometryCentroidXY(geom);
}

function sharedBoundaryScore(a, b, tol = 1e-6) {
  let vertexTouch = false, edgeTouch = false;
  const segsA = allSegmentsXY(a), segsB = allSegmentsXY(b);
  for (const [a0, a1] of segsA) {
    for (const [b0, b1] of segsB) {
      const ix = segmentIntersectionX(a0, a1, b0, b1);
      if (ix != null) vertexTouch = true;
      const collinear = Math.abs((a1.x - a0.x) * (b0.y - a0.y) - (a1.y - a0.y) * (b0.x - a0.x)) < tol &&
                        Math.abs((a1.x - a0.x) * (b1.y - a0.y) - (a1.y - a0.y) * (b1.x - a0.x)) < tol;
      if (!collinear) continue;
      const axMajor = Math.abs(a1.x - a0.x) >= Math.abs(a1.y - a0.y);
      const aa = axMajor ? [a0.x, a1.x].sort((x, y) => x - y) : [a0.y, a1.y].sort((x, y) => x - y);
      const bb = axMajor ? [b0.x, b1.x].sort((x, y) => x - y) : [b0.y, b1.y].sort((x, y) => x - y);
      if (Math.min(aa[1], bb[1]) - Math.max(aa[0], bb[0]) > tol) edgeTouch = true;
    }
  }
  return { queen: vertexTouch || edgeTouch, rook: edgeTouch };
}

export function buildSpatialWeights(rows, geomCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const type = options.type ?? "queen";
  const style = options.style ?? "W";
  const ids = rows.map((r, i) => r[options.idCol] ?? i);
  const geoms = rows.map(row => geometryFromWktMetric(row[geomCol], { sourceCrs: "auto", metricCrs }));
  const centroids = rows.map((row, i) => {
    const c = geometryCentroidXY(geoms[i]) ?? centroidForWeights(row, geomCol, metricCrs);
    return c ? { i, x: c.x, y: c.y } : null;
  });
  const triples = [];
  if (type === "knn" || type === "dband") {
    const k = Math.max(1, Number(options.k ?? 4));
    const d = Number(options.d ?? options.distance ?? 1000);
    for (const c of centroids.filter(Boolean)) {
      const ds = centroids.filter(o => o && o.i !== c.i)
        .map(o => ({ j: o.i, dist: euclidean(c.x, c.y, o.x, o.y) }))
        .sort((a, b) => a.dist - b.dist);
      const neigh = type === "knn" ? ds.slice(0, k) : ds.filter(o => o.dist <= d);
      for (const n of neigh) triples.push({ i: c.i, j: n.j, w: 1, dist: n.dist });
    }
  } else {
    const bboxes = geoms.map(geometryBboxXY);
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        if (!bboxIntersects(bboxes[i], bboxes[j])) continue;
        const s = sharedBoundaryScore(geoms[i], geoms[j]);
        const ok = type === "rook" ? s.rook : s.queen;
        if (ok) {
          triples.push({ i, j, w: 1 });
          triples.push({ i: j, j: i, w: 1 });
        }
      }
    }
  }
  if (style === "W") {
    const sums = new Map();
    for (const t of triples) sums.set(t.i, (sums.get(t.i) ?? 0) + t.w);
    for (const t of triples) t.w = sums.get(t.i) ? t.w / sums.get(t.i) : 0;
  }
  const counts = rows.map((_, i) => triples.filter(t => t.i === i).length);
  return {
    ids,
    weights: triples,
    summary: {
      n: rows.length,
      links: triples.length,
      avgNeighbors: counts.reduce((s, v) => s + v, 0) / Math.max(1, rows.length),
      islands: counts.filter(v => v === 0).length,
      type,
      style,
    },
  };
}

function normalizeWeightsInput(W) {
  if (Array.isArray(W)) return W;
  if (Array.isArray(W?.weights)) return W.weights;
  return [];
}

export function moranI(values, W, options = {}) {
  const vals = values.map(Number);
  const good = vals.map(Number.isFinite);
  const n = good.filter(Boolean).length;
  if (!n) return { I: null, n: 0 };
  const mean = vals.reduce((s, v, i) => s + (good[i] ? v : 0), 0) / n;
  const z = vals.map((v, i) => good[i] ? v - mean : 0);
  const weights = normalizeWeightsInput(W).filter(t => good[t.i] && good[t.j]);
  const s0 = weights.reduce((s, t) => s + t.w, 0);
  const num = weights.reduce((s, t) => s + t.w * z[t.i] * z[t.j], 0);
  const den = z.reduce((s, v, i) => s + (good[i] ? v * v : 0), 0);
  const I = s0 && den ? (n / s0) * (num / den) : null;
  return { I, n, s0, expected: n > 1 ? -1 / (n - 1) : null, permutations: options.permutations ?? 0 };
}

export function gearyC(values, W) {
  const vals = values.map(Number);
  const good = vals.map(Number.isFinite);
  const n = good.filter(Boolean).length;
  if (!n) return { C: null, n: 0 };
  const mean = vals.reduce((s, v, i) => s + (good[i] ? v : 0), 0) / n;
  const den = vals.reduce((s, v, i) => s + (good[i] ? (v - mean) ** 2 : 0), 0);
  const weights = normalizeWeightsInput(W).filter(t => good[t.i] && good[t.j]);
  const s0 = weights.reduce((s, t) => s + t.w, 0);
  const num = weights.reduce((s, t) => s + t.w * (vals[t.i] - vals[t.j]) ** 2, 0);
  const C = s0 && den ? ((n - 1) / (2 * s0)) * (num / den) : null;
  return { C, n, s0 };
}

export function localMoran(values, W) {
  const vals = values.map(Number);
  const good = vals.map(Number.isFinite);
  const n = good.filter(Boolean).length;
  const mean = vals.reduce((s, v, i) => s + (good[i] ? v : 0), 0) / Math.max(1, n);
  const z = vals.map((v, i) => good[i] ? v - mean : 0);
  const m2 = z.reduce((s, v, i) => s + (good[i] ? v * v : 0), 0) / Math.max(1, n);
  const byI = new Map();
  for (const t of normalizeWeightsInput(W)) {
    if (!good[t.i] || !good[t.j]) continue;
    byI.set(t.i, (byI.get(t.i) ?? 0) + t.w * z[t.j]);
  }
  return vals.map((v, i) => {
    const lag = byI.get(i) ?? 0;
    const Ii = m2 ? z[i] * lag / m2 : null;
    const cluster = z[i] >= 0 && lag >= 0 ? "HH" : z[i] < 0 && lag < 0 ? "LL" : z[i] >= 0 ? "HL" : "LH";
    return { i, value: v, lag, Ii, cluster };
  });
}

function summarizeValues(vals, fn, q = 0.5) {
  const xs = vals.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (fn === "count") return vals.length;
  if (!xs.length) return null;
  if (fn === "sum") return xs.reduce((s, v) => s + v, 0);
  if (fn === "mean") return xs.reduce((s, v) => s + v, 0) / xs.length;
  if (fn === "min") return xs[0];
  if (fn === "max") return xs[xs.length - 1];
  if (fn === "sd") {
    const m = xs.reduce((s, v) => s + v, 0) / xs.length;
    return xs.length > 1 ? Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)) : 0;
  }
  const pos = (xs.length - 1) * Number(q);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

export function zonalStats(zoneRows, zoneWktCol, valueRows, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const latCol = options.latCol, lonCol = options.lonCol;
  const specs = options.aggSpecs ?? [{ fn: "count", outCol: "n" }];
  const zones = preparePolygonRows(zoneRows, zoneWktCol, { sourceCrs: options.zoneSourceCrs ?? "auto", metricCrs });
  const points = valueRows.map((row, idx) => {
    const lat = Number(row[latCol]), lon = Number(row[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const [x, y] = transformCoord(lon, lat, "EPSG:4326", metricCrs);
    return { row, idx, x, y };
  }).filter(Boolean);
  const out = zoneRows.map(row => ({ ...row }));
  for (const z of zones) {
    const matched = points.filter(p =>
      bboxContains(z.bbox, p.x, p.y) && pointInGeometryXY(p.x, p.y, z.geom)
    ).map(p => p.row);
    for (const spec of specs) {
      const vals = spec.fn === "count" ? matched : matched.map(r => r[spec.col]);
      out[z.idx][spec.outCol] = summarizeValues(vals, spec.fn, spec.q);
    }
  }
  return out;
}

function silvermanBandwidth(points) {
  const xs = points.map(p => p.x), ys = points.map(p => p.y);
  const sx = Math.sqrt(xs.reduce((s, x) => s + (x - xs.reduce((a, v) => a + v, 0) / xs.length) ** 2, 0) / Math.max(1, xs.length - 1));
  const sy = Math.sqrt(ys.reduce((s, y) => s + (y - ys.reduce((a, v) => a + v, 0) / ys.length) ** 2, 0) / Math.max(1, ys.length - 1));
  return Math.max(1, 1.06 * Math.max(sx, sy, 1) * Math.pow(points.length, -1 / 6));
}

function kernelValue(u, kernel = "gaussian") {
  if (kernel === "quartic" || kernel === "biweight") {
    const r2 = u * u;
    return r2 < 1 ? (15 / 16) * (1 - r2) ** 2 : 0;
  }
  return Math.exp(-0.5 * u * u) / Math.sqrt(2 * Math.PI);
}

export function kde2d(pointRows, latCol, lonCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const pts = pointRows.map(row => {
    const lat = Number(row[latCol]), lon = Number(row[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const [x, y] = transformCoord(lon, lat, "EPSG:4326", metricCrs);
    return { x, y, row };
  }).filter(Boolean);
  if (!pts.length) return { rows: [], x: [], y: [], bbox: null, bandwidth: null };
  const bbox = options.bbox ?? {
    minX: Math.min(...pts.map(p => p.x)),
    maxX: Math.max(...pts.map(p => p.x)),
    minY: Math.min(...pts.map(p => p.y)),
    maxY: Math.max(...pts.map(p => p.y)),
  };
  const pad = Number(options.pad ?? 0.05);
  const dxPad = (bbox.maxX - bbox.minX || 1) * pad;
  const dyPad = (bbox.maxY - bbox.minY || 1) * pad;
  const bb = { minX: bbox.minX - dxPad, maxX: bbox.maxX + dxPad, minY: bbox.minY - dyPad, maxY: bbox.maxY + dyPad };
  const nx = Math.max(2, Number(options.gridN ?? options.nx ?? 50));
  const ny = Math.max(2, Number(options.ny ?? options.gridN ?? nx));
  const h = Math.max(1, Number(options.bandwidth ?? silvermanBandwidth(pts)));
  const x = Array.from({ length: nx }, (_, i) => bb.minX + (bb.maxX - bb.minX) * i / (nx - 1));
  const y = Array.from({ length: ny }, (_, i) => bb.minY + (bb.maxY - bb.minY) * i / (ny - 1));
  const rows = [];
  for (let yi = 0; yi < ny; yi++) {
    for (let xi = 0; xi < nx; xi++) {
      let d = 0;
      for (const p of pts) {
        const kx = kernelValue((x[xi] - p.x) / h, options.kernel);
        const ky = kernelValue((y[yi] - p.y) / h, options.kernel);
        d += kx * ky / (h * h);
      }
      d /= pts.length;
      const [lon, lat] = transformCoord(x[xi], y[yi], metricCrs, "EPSG:4326");
      rows.push({ xi, yi, x: x[xi], y: y[yi], lon, lat, density: d });
    }
  }
  return { rows, x, y, bbox: bb, bandwidth: h, metricCrs };
}

export function kernelDensityToGrid(pointRows, latCol, lonCol, gridRows, gridWktCol, options = {}) {
  const metricCrs = normalizeCrs(options.metricCrs ?? "EPSG:32721");
  const outCol = options.outCol ?? "kde_density";
  const pts = pointRows.map(row => {
    const lat = Number(row[latCol]), lon = Number(row[lonCol]);
    if (!isFinite(lat) || !isFinite(lon)) return null;
    const [x, y] = transformCoord(lon, lat, "EPSG:4326", metricCrs);
    return { x, y };
  }).filter(Boolean);
  if (!pts.length) return gridRows.map(row => ({ ...row, [outCol]: null }));
  const h = Math.max(1, Number(options.bandwidth ?? silvermanBandwidth(pts)));
  return gridRows.map(row => {
    const geom = geometryFromWktMetric(row[gridWktCol] ?? row.metric_geometry ?? row.geometry, { sourceCrs: options.gridSourceCrs ?? "auto", metricCrs });
    const c = geometryCentroidXY(geom);
    if (!c) return { ...row, [outCol]: null, kde_bandwidth_m: h };
    let d = 0;
    for (const p of pts) {
      const kx = kernelValue((c.x - p.x) / h, options.kernel);
      const ky = kernelValue((c.y - p.y) / h, options.kernel);
      d += kx * ky / (h * h);
    }
    return { ...row, [outCol]: d / pts.length, kde_bandwidth_m: h };
  });
}

export function geometryDiagnostics(rows, wktCol, options = {}) {
  return rows.map(row => {
    const geom = parseWKTMultiPolygonXY(row[wktCol]);
    let rings = 0, holes = 0, closed = true, hasSelfIntersection = false;
    for (const poly of geom) {
      rings += poly.rings.length;
      holes += Math.max(0, poly.rings.length - 1);
      for (const ring of poly.rings) {
        if (ring.length < 3) closed = false;
        const segs = allSegmentsXY([{ rings: [ring] }]);
        for (let i = 0; i < segs.length; i++) {
          for (let j = i + 1; j < segs.length; j++) {
            if (Math.abs(i - j) <= 1 || (i === 0 && j === segs.length - 1)) continue;
            if (segmentIntersectionX(segs[i][0], segs[i][1], segs[j][0], segs[j][1]) != null) {
              hasSelfIntersection = true;
            }
          }
        }
      }
    }
    return {
      ...row,
      valid_geometry: geom.length > 0 && closed && !hasSelfIntersection,
      n_polygon_parts: geom.length,
      n_rings: rings,
      n_holes: holes,
      self_intersects: hasSelfIntersection,
      area_m2: row[wktCol] ? polygonArea(row[wktCol], options) : null,
    };
  });
}
