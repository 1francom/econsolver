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
//   parseWKTPolygon (helper)
//   makeGrid          — st_make_grid equivalent: rectangular cells clipped to boundary
//   aggregateToGrid   — count/sum/mean of point dataset within each grid cell

const EARTH_RADIUS_KM = 6371;

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
 * lat, lon are the point; polygonWKT is a WKT POLYGON string.
 * WKT convention: POLYGON((longitude latitude, ...)).
 * Returns false if WKT is unparseable.
 */
export function pointInPolygon(lat, lon, polygonWKT) {
  const coords = parseWKTPolygon(polygonWKT);
  if (!coords || coords.length < 3) return false;
  let inside = false;
  for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
    const [xi, yi] = coords[i]; // xi=lon, yi=lat
    const [xj, yj] = coords[j];
    const intersect =
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
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
export function makeGrid(boundaryWkt, cellsizeMeters = 500) {
  if (!boundaryWkt || typeof boundaryWkt !== "string") throw new Error("boundaryWkt must be a WKT string");
  if (cellsizeMeters <= 0) throw new Error("cellsizeMeters must be > 0");

  const MAX_CELLS = 25_000;
  const wktU = boundaryWkt.trim().toUpperCase();

  // ── Parse outer ring(s) ──────────────────────────────────────────────────
  // Returns [{lon, lat}] rings; captures outer ring of each polygon part.
  function parseRings(wkt) {
    const rings = [];
    // MULTIPOLYGON: extract each (( )) block
    if (wktU.startsWith("MULTIPOLYGON")) {
      const re = /\(\(([^()]+)\)\)/g;
      let m;
      while ((m = re.exec(wkt)) !== null) {
        const r = m[1].split(",").map(p => {
          const [lon, lat] = p.trim().split(/\s+/).map(Number);
          return { lon, lat };
        }).filter(p => !isNaN(p.lon) && !isNaN(p.lat));
        if (r.length >= 3) rings.push(r);
      }
    } else {
      // POLYGON — outer ring only (first ((...)))
      const m = wkt.match(/POLYGON\s*\(\(([^()]+)\)/i);
      if (m) {
        const r = m[1].split(",").map(p => {
          const [lon, lat] = p.trim().split(/\s+/).map(Number);
          return { lon, lat };
        }).filter(p => !isNaN(p.lon) && !isNaN(p.lat));
        if (r.length >= 3) rings.push(r);
      }
    }
    return rings;
  }

  const rings = parseRings(boundaryWkt);
  if (!rings.length) throw new Error("Could not parse boundary WKT. Expected POLYGON or MULTIPOLYGON.");

  // ── Bounding box ──────────────────────────────────────────────────────────
  const allLons = rings.flatMap(r => r.map(p => p.lon));
  const allLats = rings.flatMap(r => r.map(p => p.lat));
  const minLon = Math.min(...allLons), maxLon = Math.max(...allLons);
  const minLat = Math.min(...allLats), maxLat = Math.max(...allLats);

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

  // ── Generate cells ────────────────────────────────────────────────────────
  const f = n => n.toFixed(8);
  const cells = [];
  for (let row = 0; minLat + row * dLat < maxLat + dLat * 0.01; row++) {
    for (let col = 0; minLon + col * dLon < maxLon + dLon * 0.01; col++) {
      const lon0 = minLon + col * dLon;
      const lat0 = minLat + row * dLat;
      const cLat = lat0 + dLat / 2;
      const cLon = lon0 + dLon / 2;
      if (!pip(cLat, cLon)) continue;
      if (cells.length >= MAX_CELLS) {
        throw new Error(`Grid exceeds ${MAX_CELLS.toLocaleString()} cells. Increase cell size.`);
      }
      // WKT: POLYGON((lon lat, ...)) — standard lon-first convention
      const wkt = `POLYGON((${f(lon0)} ${f(lat0)}, ${f(lon0+dLon)} ${f(lat0)}, ${f(lon0+dLon)} ${f(lat0+dLat)}, ${f(lon0)} ${f(lat0+dLat)}, ${f(lon0)} ${f(lat0)}))`;
      cells.push({ grid_id: cells.length + 1, geometry: wkt });
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
