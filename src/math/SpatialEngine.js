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
export function spatialJoin(pointRows, latCol, lonCol, polyRows, wktCol, joinCols) {
  const nullAttrs = Object.fromEntries(joinCols.map(c => [c, null]));
  return pointRows.map(row => {
    const lat = row[latCol];
    const lon = row[lonCol];
    if (lat == null || lon == null || isNaN(lat) || isNaN(lon)) {
      return { ...row, ...nullAttrs };
    }
    const match = polyRows.find(
      p => p[wktCol] && pointInPolygon(Number(lat), Number(lon), p[wktCol])
    );
    const attrs = match
      ? Object.fromEntries(joinCols.map(c => [c, match[c] ?? null]))
      : nullAttrs;
    return { ...row, ...attrs };
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

/**
 * Aggregates point rows into grid cells.
 * For each cell (identified by its WKT geometry), counts/sums/averages matching
 * points. Returns the grid rows enriched with aggregate columns.
 *
 * aggSpecs: [{ col: "schools", fn: "count"|"sum"|"mean", outCol: "n_schools" }]
 * Use fn="count" with col="" to simply count rows.
 *
 * O(n_points × n_cells) — suitable for ≤ 5 000 × 10 000.
 */
export function aggregateToGrid(gridRows, gridWktCol, pointRows, latCol, lonCol, aggSpecs) {
  return gridRows.map(cell => {
    const wkt = cell[gridWktCol];
    if (!wkt) return cell;
    const matched = pointRows.filter(p => {
      const lat = parseFloat(p[latCol]);
      const lon = parseFloat(p[lonCol]);
      return !isNaN(lat) && !isNaN(lon) && pointInPolygon(lat, lon, wkt);
    });
    const extra = {};
    for (const { col, fn, outCol } of aggSpecs) {
      if (fn === "count") {
        extra[outCol] = matched.length;
      } else if (fn === "sum") {
        extra[outCol] = matched.reduce((s, p) => s + (parseFloat(p[col]) || 0), 0);
      } else if (fn === "mean") {
        const vals = matched.map(p => parseFloat(p[col])).filter(v => !isNaN(v));
        extra[outCol] = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
      }
    }
    return { ...cell, ...extra };
  });
}
