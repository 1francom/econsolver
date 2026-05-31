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
  const rings = parseWKTRings(polygonWKT);
  return pointInParsedRings(lat, lon, rings);
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
  if (!wkt || typeof wkt !== "string") return null;
  const from = sourceCrs === "auto"
    ? (isProjectedWktCoords(wkt) ? metricCrs : "EPSG:4326")
    : sourceCrs;
  const metricWkt = normalizeCrs(from) === normalizeCrs(metricCrs)
    ? wkt
    : transformWKT(wkt, from, metricCrs, 3);
  const rings = parseWKTRings(metricWkt)
    .map(r => r.map(([x, y]) => ({ x, y })).filter(p => isFinite(p.x) && isFinite(p.y)))
    .filter(r => r.length >= 3);
  if (!rings.length) return null;
  const largest = rings.reduce((best, ring) => xyArea(ring) > xyArea(best) ? ring : best, rings[0]);
  return xyCentroid(largest);
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
