/**
 * ESRI Shapefile + DBF parser
 * parseShapefile(dbfBuffer, shpBuffer?) → { headers: string[], rows: object[] }
 *
 * The dBase III+ .dbf file holds the attribute table and is self-contained.
 * The .shp file is optional — when provided, a __geometry column (WKT) is added.
 *
 * DBF format (dBase III+):
 *   Byte 0:      version byte
 *   Bytes 1–3:   last update (YY, MM, DD) — ignored
 *   Bytes 4–7:   record count (uint32 LE)
 *   Bytes 8–9:   header size in bytes (uint16 LE) — includes terminator
 *   Bytes 10–11: record size in bytes (uint16 LE)
 *   Bytes 12–31: reserved
 *   Bytes 32+:   field descriptors, 32 bytes each, until 0x0D terminator
 *   Then:        data records, fixed-width ASCII
 *
 * Field descriptor (32 bytes):
 *   Bytes 0–10:  field name (null-padded ASCII)
 *   Byte 11:     field type: C (char), N (numeric), F (float), D (date), L (logical), M (memo)
 *   Bytes 12–15: reserved
 *   Byte 16:     field length in bytes
 *   Byte 17:     decimal count
 *   Bytes 18–31: reserved
 *
 * Record:
 *   Byte 0:      deletion flag (' ' = valid, '*' = deleted)
 *   Bytes 1+:    field values, fixed-width (matching field lengths)
 *
 * SHP format (ESRI):
 *   File header: 100 bytes
 *     Bytes 0–3:  file code = 9994 (big-endian)
 *     Bytes 24–27: file length in 16-bit words (big-endian)
 *     Bytes 28–31: version = 1000 (little-endian)
 *     Bytes 32–35: shape type (little-endian)
 *   Records:
 *     Bytes 0–3:  record number (1-based, big-endian)
 *     Bytes 4–7:  content length in 16-bit words (big-endian)
 *     Then shape content:
 *       Int32 LE: shape type
 *       For Point (1):      X (float64 LE), Y (float64 LE)
 *       For Polyline (3):   bbox (4×float64), numParts (int32), numPoints (int32),
 *                           parts (numParts×int32), points (numPoints×{x,y float64})
 *       For Polygon (5):    same layout as Polyline; ESRI rings combine outer
 *                           rings (CW) and holes (CCW) in one record — emitted
 *                           as POLYGON when 1 outer ring, MULTIPOLYGON when >1.
 *       Null shape (0):     no further data
 */

// ── DBF field type codes ───────────────────────────────────────────────────────
// C = Character, N = Numeric, F = Float, D = Date, L = Logical, M = Memo (skip)

/** Parse a dBase III+ .dbf file into column-row form */
function parseDBF(buf) {
  const dv = new DataView(buf);

  const recordCount  = dv.getUint32(4,  true);  // little-endian
  const headerSize   = dv.getUint16(8,  true);
  const recordSize   = dv.getUint16(10, true);

  // ── Field descriptors ──────────────────────────────────────────────────────
  const fields = [];
  let offset = 32;

  while (offset < headerSize - 1) {
    // Check for 0x0D terminator
    if (dv.getUint8(offset) === 0x0D) break;
    if (offset + 32 > buf.byteLength) break;

    // Field name: 11 bytes, null-terminated
    const nameBytes = new Uint8Array(buf, offset, 11);
    let nameEnd = nameBytes.indexOf(0);
    if (nameEnd === -1) nameEnd = 11;
    const name = new TextDecoder("ascii").decode(nameBytes.slice(0, nameEnd)).trim();

    const type    = String.fromCharCode(dv.getUint8(offset + 11));
    const length  = dv.getUint8(offset + 16);
    const decimal = dv.getUint8(offset + 17);

    fields.push({ name, type, length, decimal });
    offset += 32;
  }

  if (!fields.length) {
    throw new Error("DBF: No field descriptors found — file may be corrupt.");
  }

  // Deduplicate field names
  const nameCounts = {};
  const headers = fields.map(f => {
    const base = f.name || "col";
    nameCounts[base] = (nameCounts[base] || 0) + 1;
    return nameCounts[base] === 1 ? base : `${base}_${nameCounts[base]}`;
  });

  // ── Records ────────────────────────────────────────────────────────────────
  const recordsStart = headerSize;
  const rows = [];
  const td = new TextDecoder("latin1"); // DBF is typically Latin-1 / CP1252

  for (let r = 0; r < recordCount; r++) {
    const recOffset = recordsStart + r * recordSize;
    if (recOffset + recordSize > buf.byteLength) break;

    // Skip deleted records (deletion flag = '*' = 0x2A)
    const deletionFlag = dv.getUint8(recOffset);
    if (deletionFlag === 0x2A) continue;

    const row = {};
    let fieldOffset = recOffset + 1; // skip deletion byte

    for (let f = 0; f < fields.length; f++) {
      const field  = fields[f];
      const raw    = td.decode(new Uint8Array(buf, fieldOffset, field.length)).trim();
      const header = headers[f];
      fieldOffset += field.length;

      if (raw === "" || raw === "?" || raw === "*") {
        row[header] = null;
        continue;
      }

      switch (field.type) {
        case "N": // Numeric (integer or fixed-point)
        case "F": // Float
        case "O": // Double (dBase 7)
          if (raw === "" || raw.toLowerCase() === "null") {
            row[header] = null;
          } else {
            const n = parseFloat(raw);
            row[header] = isNaN(n) ? null : n;
          }
          break;

        case "D": // Date — YYYYMMDD string
          row[header] = raw.length === 8
            ? `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`
            : raw;
          break;

        case "L": // Logical: T/Y/1 → true, F/N/0 → false
          if ("TtYy1".includes(raw[0])) row[header] = true;
          else if ("FfNn0".includes(raw[0])) row[header] = false;
          else row[header] = null;
          break;

        case "M": // Memo field — just skip (block pointer)
          row[header] = null;
          break;

        case "C": // Character
        default:
          row[header] = raw === "" ? null : raw;
      }
    }

    rows.push(row);
  }

  return { headers, rows };
}

// ── CRS detection from .prj WKT ───────────────────────────────────────────────
// Maps a PRJ WKT string to a proj4 definition string suitable for proj4js.
// Returns null when the file is already geographic (lon/lat WGS-84-like).

// Each entry: { proj4, label } where proj4=null means already WGS-84 geographic.
const CRS_FOR_EPSG = {
  // Geographic (no reprojection needed) — listed so we can still surface the label.
  "4326":  { proj4: null, label: "WGS84 / geographic (EPSG:4326)" },
  "4258":  { proj4: null, label: "ETRS89 / geographic (EPSG:4258)" },
  // Italy
  "3003":  { proj4: "+proj=tmerc +lat_0=0 +lon_0=9  +k=0.9996 +x_0=1500000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs", label: "Monte Mario / Italy zone 1 (EPSG:3003)" },
  "3004":  { proj4: "+proj=tmerc +lat_0=0 +lon_0=15 +k=0.9996 +x_0=2520000 +y_0=0 +ellps=intl +towgs84=-104.1,-49.1,-9.9,0.971,-2.917,0.714,-11.68 +units=m +no_defs", label: "Monte Mario / Italy zone 2 (EPSG:3004)" },
  "23032": { proj4: "+proj=utm +zone=32 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs",  label: "ED50 / UTM 32N (EPSG:23032)" },
  "23033": { proj4: "+proj=utm +zone=33 +ellps=intl +towgs84=-87,-98,-121,0,0,0,0 +units=m +no_defs",  label: "ED50 / UTM 33N (EPSG:23033)" },
  "25832": { proj4: "+proj=utm +zone=32 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",        label: "ETRS89 / UTM 32N (EPSG:25832)" },
  "25833": { proj4: "+proj=utm +zone=33 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs",        label: "ETRS89 / UTM 33N (EPSG:25833)" },
  "32632": { proj4: "+proj=utm +zone=32 +datum=WGS84 +units=m +no_defs",                                label: "WGS84 / UTM 32N (EPSG:32632)" },
  "32633": { proj4: "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs",                                label: "WGS84 / UTM 33N (EPSG:32633)" },
  "3035":  { proj4: "+proj=laea +lat_0=52 +lon_0=10 +x_0=4321000 +y_0=3210000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs", label: "ETRS89 / LAEA Europe (EPSG:3035)" },
  // Germany — DHDN / Gauss-Kruger
  "31466": { proj4: "+proj=tmerc +lat_0=0 +lon_0=6  +k=1 +x_0=2500000 +y_0=0 +ellps=bessel +datum=potsdam +units=m +no_defs", label: "DHDN / Gauss-Kruger zone 2 (EPSG:31466)" },
  "31467": { proj4: "+proj=tmerc +lat_0=0 +lon_0=9  +k=1 +x_0=3500000 +y_0=0 +ellps=bessel +datum=potsdam +units=m +no_defs", label: "DHDN / Gauss-Kruger zone 3 (EPSG:31467)" },
  "31468": { proj4: "+proj=tmerc +lat_0=0 +lon_0=12 +k=1 +x_0=4500000 +y_0=0 +ellps=bessel +datum=potsdam +units=m +no_defs", label: "DHDN / Gauss-Kruger zone 4 (EPSG:31468)" },
  // Austria — MGI / Lambert
  "31287": { proj4: "+proj=lcc +lat_1=49 +lat_2=46 +lat_0=47.5 +lon_0=13.33333333333333 +x_0=400000 +y_0=400000 +ellps=bessel +towgs84=577.326,90.129,463.919,5.137,1.474,5.297,2.4232 +units=m +no_defs", label: "MGI / Austria Lambert (EPSG:31287)" },
  // UK / NL
  "27700": { proj4: "+proj=tmerc +lat_0=49 +lon_0=-2 +k=0.9996012717 +x_0=400000 +y_0=-100000 +ellps=airy +datum=OSGB36 +units=m +no_defs", label: "OSGB36 / British National Grid (EPSG:27700)" },
  "28992": { proj4: "+proj=sterea +lat_0=52.15616055555555 +lon_0=5.38720621111111 +k=0.9999079 +x_0=155000 +y_0=463000 +ellps=bessel +towgs84=565.417,50.3319,465.552,-0.398957,0.343988,-1.8774,4.0725 +units=m +no_defs", label: "Amersfoort / RD New (EPSG:28992)" },
};

/**
 * Parse a .prj WKT string and return CRS metadata.
 * @returns {{proj4: string|null, label: string} | null}
 *   - { proj4: null,    label } when geographic (no reprojection needed)
 *   - { proj4: "+proj…", label } when projected & recognized
 *   - null when the .prj could not be matched
 */
export function detectCRSFromPRJ(prjText) {
  if (!prjText || typeof prjText !== "string") return null;
  const t = prjText.replace(/\s+/g, " ");

  // EPSG authority code, if present
  const epsg = t.match(/AUTHORITY\s*\[\s*"EPSG"\s*,\s*"?(\d+)"?\s*\]\s*\]?\s*$/i);
  if (epsg && CRS_FOR_EPSG[epsg[1]]) return CRS_FOR_EPSG[epsg[1]];

  // No PROJCS → geographic (lon/lat); no reprojection needed
  if (!/PROJCS/i.test(t)) {
    // Try to extract the GEOGCS name for the label
    const gcs = t.match(/GEOGCS\s*\[\s*"([^"]+)"/i);
    return { proj4: null, label: gcs ? `${gcs[1]} / geographic` : "Geographic / WGS84" };
  }

  // UTM zone parsing from the PROJCS / PROJECTION block
  const utm = t.match(/UTM[_\s-]*(?:zone[_\s-]*)?(\d+)\s*([NS])?/i);
  if (utm) {
    const zone = parseInt(utm[1], 10);
    const south = (utm[2] || "").toUpperCase() === "S";
    let ellps = "WGS84", datum = "WGS84", towgs = "", datumName = "WGS84";
    if (/ED[_ ]?50|European_1950/i.test(t)) { ellps = "intl"; datum = ""; towgs = " +towgs84=-87,-98,-121,0,0,0,0"; datumName = "ED50"; }
    else if (/ETRS|GRS[_ ]?80/i.test(t))    { ellps = "GRS80"; datum = ""; towgs = " +towgs84=0,0,0,0,0,0,0";       datumName = "ETRS89"; }
    return {
      proj4: `+proj=utm +zone=${zone}${south ? " +south" : ""} ${datum ? `+datum=${datum}` : `+ellps=${ellps}`}${towgs} +units=m +no_defs`,
      label: `${datumName} / UTM ${zone}${south ? "S" : "N"}`,
    };
  }

  // Monte Mario / Gauss-Boaga (Italy)
  if (/Monte[_\s]*Mario|Gauss[_\s]*Boaga|Roma[_\s]*40/i.test(t)) {
    const east = /zone[_\s-]*2|fuso[_\s-]*2|East|EST/i.test(t);
    return CRS_FOR_EPSG[east ? "3004" : "3003"];
  }

  // Austria MGI Lambert
  if (/MGI[_\s]*\/?[_\s]*Austria[_\s]*Lambert|Austria[_\s]*GK[_\s]*Central/i.test(t)) {
    return CRS_FOR_EPSG["31287"];
  }

  // LAEA Europe
  if (/LAEA|Lambert_Azimuthal/i.test(t)) return CRS_FOR_EPSG["3035"];

  // OSGB36 (UK)
  if (/OSGB[_\s]*36|British_National_Grid/i.test(t)) return CRS_FOR_EPSG["27700"];

  // RD New (NL)
  if (/Amersfoort|RD[_\s]*New|Rijksdriehoek/i.test(t)) return CRS_FOR_EPSG["28992"];

  // Unknown projected CRS — surface the PROJCS name so the user knows we saw it.
  const projName = t.match(/PROJCS\s*\[\s*"([^"]+)"/i);
  return { proj4: null, label: projName ? `Unknown / ${projName[1]}` : "Unknown projected CRS" };
}

// Lazy-load proj4 from CDN (same loader pattern as SpatialTab.jsx).
let _proj4Promise = null;
async function loadProj4() {
  if (typeof window !== "undefined" && window.proj4) return window.proj4;
  if (_proj4Promise) return _proj4Promise;
  _proj4Promise = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://unpkg.com/proj4@2.9.0/dist/proj4.js";
    s.onload  = () => resolve(window.proj4);
    s.onerror = () => reject(new Error("proj4 load failed"));
    document.head.appendChild(s);
  });
  return _proj4Promise;
}

// ── SHP geometry reader ────────────────────────────────────────────────────────

/** Read a little-endian float64 pair as {x, y}, optionally projected to WGS-84. */
function readPoint(dv, offset, projectFn) {
  const x = dv.getFloat64(offset,     true);
  const y = dv.getFloat64(offset + 8, true);
  if (projectFn) {
    const out = projectFn([x, y]);
    return { x: out[0], y: out[1] };
  }
  return { x, y };
}

/** Format a point array as WKT ring string: "x1 y1, x2 y2, ..." */
function pointsToWKTRing(points) {
  return points.map(p => `${p.x} ${p.y}`).join(", ");
}

/**
 * Parse the .shp file and return an array of WKT strings (one per record).
 * Records with null shapes return null. Record index is 0-based.
 * If projectFn is supplied every coordinate is transformed before WKT emit.
 */
function parseSHP(buf, projectFn = null) {
  const dv = new DataView(buf);
  const geometries = [];

  // SHP file header is 100 bytes
  let pos = 100;

  while (pos < buf.byteLength - 8) {
    // Record header: record number (BE int32) + content length in 16-bit words (BE int32)
    const contentLenWords = dv.getInt32(pos + 4, false); // big-endian
    const contentBytes    = contentLenWords * 2;
    pos += 8; // skip record header

    // If a single record is malformed we still want subsequent records to be
    // read — emit null for this slot and stop only when the file is truncated.
    if (contentBytes < 4) {
      geometries.push(null);
      continue;
    }
    if (pos + contentBytes > buf.byteLength) break;

    const shapeType = dv.getInt32(pos, true); // little-endian
    let wkt = null;

    switch (shapeType) {
      case 0: // Null shape
        wkt = null;
        break;

      case 1: // Point
      case 11: // PointZ
      case 21: { // PointM
        const p = readPoint(dv, pos + 4, projectFn);
        wkt = `POINT(${p.x} ${p.y})`;
        break;
      }

      case 3:  // Polyline
      case 13: // PolylineZ
      case 23: { // PolylineM
        // bbox: 4×float64 (32 bytes)
        const numParts  = dv.getInt32(pos + 4 + 32,     true);
        const numPoints = dv.getInt32(pos + 4 + 32 + 4, true);
        if (numParts < 1 || numPoints < 1) { wkt = null; break; }

        const partsOffset  = pos + 4 + 32 + 8;
        const pointsOffset = partsOffset + numParts * 4;

        // Read all points
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
          pts.push(readPoint(dv, pointsOffset + i * 16, projectFn));
        }

        if (numParts === 1) {
          wkt = `LINESTRING(${pointsToWKTRing(pts)})`;
        } else {
          // Read part start indices, build MULTILINESTRING
          const partStarts = [];
          for (let i = 0; i < numParts; i++) {
            partStarts.push(dv.getInt32(partsOffset + i * 4, true));
          }
          const parts = partStarts.map((start, i) => {
            const end = i + 1 < numParts ? partStarts[i + 1] : numPoints;
            return `(${pointsToWKTRing(pts.slice(start, end))})`;
          });
          wkt = `MULTILINESTRING(${parts.join(", ")})`;
        }
        break;
      }

      case 5:  // Polygon
      case 15: // PolygonZ
      case 25: { // PolygonM
        const numParts  = dv.getInt32(pos + 4 + 32,     true);
        const numPoints = dv.getInt32(pos + 4 + 32 + 4, true);
        if (numParts < 1 || numPoints < 1) { wkt = null; break; }

        const partsOffset  = pos + 4 + 32 + 8;
        const pointsOffset = partsOffset + numParts * 4;

        const pts = [];
        for (let i = 0; i < numPoints; i++) {
          pts.push(readPoint(dv, pointsOffset + i * 16, projectFn));
        }

        const partStarts = [];
        for (let i = 0; i < numParts; i++) {
          partStarts.push(dv.getInt32(partsOffset + i * 4, true));
        }

        // Slice each part into its own point array, drop degenerate rings,
        // and force-close any open ring (first == last vertex).
        let rings = partStarts.map((start, i) => {
          const end = i + 1 < numParts ? partStarts[i + 1] : numPoints;
          return pts.slice(start, end);
        }).filter(r => r.length >= 4);

        rings = rings.map(r => {
          const f = r[0], l = r[r.length - 1];
          return (f.x === l.x && f.y === l.y) ? r : [...r, { x: f.x, y: f.y }];
        });

        if (!rings.length) { wkt = null; break; }

        // ── Ring classification by point-in-polygon containment ──
        // ESRI shape-type 5 conflates POLYGON and MULTIPOLYGON: a single record
        // can hold multiple disjoint outer rings + their holes. The ESRI spec
        // requires outer = CW and hole = CCW, but in practice many shapefiles
        // (ISTAT, GADM, etc.) ship rings in arbitrary orientation. GDAL/OGR,
        // R sf, and PostGIS all use geometric containment (point-in-polygon),
        // not orientation, to identify outer rings vs holes. We do the same.
        //
        // For each ring r, count how many OTHER rings contain it. Even count
        // (0, 2, …) → outer ring (new polygon). Odd count (1, 3, …) → hole
        // of the deepest containing outer.

        // Bounding box per ring — cheap reject before ray-cast.
        const bboxes = rings.map(r => {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const p of r) {
            if (p.x < minX) minX = p.x;
            if (p.x > maxX) maxX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.y > maxY) maxY = p.y;
          }
          return { minX, maxX, minY, maxY };
        });

        // Standard ray-casting point-in-ring (works regardless of orientation).
        const pointInRing = (px, py, ring) => {
          let inside = false;
          for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const xi = ring[i].x, yi = ring[i].y;
            const xj = ring[j].x, yj = ring[j].y;
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
              inside = !inside;
            }
          }
          return inside;
        };

        // Test point: vertex centroid (mean of all unique vertices). For
        // simply-connected polygons this is overwhelmingly likely to lie in
        // the interior, far from any other ring's boundary — which is the
        // robust property we need for ring containment classification.
        // (The previous version used the midpoint of the first edge, which
        // sits ON the ring boundary — vulnerable to edge-on-edge ambiguity
        // when two rings share a corner, and unreliable as a "representative
        // interior point" for the ring itself.)
        const interiorTestPt = (ring) => {
          // Drop the closing duplicate vertex if present
          const n = (ring.length > 1 && ring[0].x === ring[ring.length - 1].x
                                     && ring[0].y === ring[ring.length - 1].y)
                    ? ring.length - 1 : ring.length;
          let sx = 0, sy = 0;
          for (let k = 0; k < n; k++) { sx += ring[k].x; sy += ring[k].y; }
          return { x: sx / n, y: sy / n };
        };

        const containedBy = rings.map((ring, i) => {
          const tp = interiorTestPt(ring);
          const containers = [];
          for (let j = 0; j < rings.length; j++) {
            if (i === j) continue;
            const bb = bboxes[j];
            if (tp.x < bb.minX || tp.x > bb.maxX ||
                tp.y < bb.minY || tp.y > bb.maxY) continue;
            if (pointInRing(tp.x, tp.y, rings[j])) containers.push(j);
          }
          return containers;
        });

        const depth = containedBy.map(c => c.length);

        // First pass: outer rings (even depth → top-level outer of *its* polygon).
        const ringToPoly = new Array(rings.length).fill(-1);
        const polys = [];
        for (let i = 0; i < rings.length; i++) {
          if (depth[i] % 2 === 0) {
            ringToPoly[i] = polys.length;
            polys.push([rings[i]]);
          }
        }

        // Second pass: hole rings → attach to the nearest enclosing outer
        // (the container with the greatest even depth).
        for (let i = 0; i < rings.length; i++) {
          if (depth[i] % 2 === 0) continue;
          let parent = -1, parentDepth = -1;
          for (const c of containedBy[i]) {
            if (depth[c] % 2 === 0 && depth[c] > parentDepth) {
              parent = c;
              parentDepth = depth[c];
            }
          }
          if (parent >= 0) {
            polys[ringToPoly[parent]].push(rings[i]);
          } else {
            // Orphan (shouldn't happen if depths are consistent): emit as outer.
            polys.push([rings[i]]);
          }
        }

        if (!polys.length) { wkt = null; break; }

        // Normalize ring orientation to OGC SFS: outer = CCW, holes = CW.
        // This is the convention WKT consumers (e.g. PostGIS, sf) expect.
        const signedArea = (ring) => {
          let a = 0;
          for (let i = 0, n = ring.length; i < n; i++) {
            const p1 = ring[i], p2 = ring[(i + 1) % n];
            a += (p1.x * p2.y - p2.x * p1.y);
          }
          return a / 2;
        };
        const orient = (ring, wantCCW) => {
          const isCCW = signedArea(ring) > 0;
          return isCCW === wantCCW ? ring : [...ring].reverse();
        };
        const normalized = polys.map(p =>
          [orient(p[0], true), ...p.slice(1).map(h => orient(h, false))]
        );

        const polyToWKT = poly =>
          poly.map(r => `(${pointsToWKTRing(r)})`).join(", ");

        wkt = normalized.length === 1
          ? `POLYGON(${polyToWKT(normalized[0])})`
          : `MULTIPOLYGON(${normalized.map(p => `(${polyToWKT(p)})`).join(", ")})`;
        break;
      }

      case 8:  // MultiPoint
      case 18: // MultiPointZ
      case 28: { // MultiPointM
        const numPoints = dv.getInt32(pos + 4 + 32, true);
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
          pts.push(readPoint(dv, pos + 4 + 32 + 4 + i * 16, projectFn));
        }
        wkt = `MULTIPOINT(${pts.map(p => `(${p.x} ${p.y})`).join(", ")})`;
        break;
      }

      default:
        // Unknown shape type — skip record
        wkt = null;
    }

    geometries.push(wkt);
    pos += contentBytes;
  }

  return geometries;
}

// ── Main exports ───────────────────────────────────────────────────────────────

/**
 * Build a projectFn ([x,y] → [lon,lat]) from a .prj text, or null when the
 * shapefile is already geographic (no projection needed). Async because
 * proj4 is lazy-loaded from CDN the first time it's used.
 * @returns {{ fn: Function|null, info: {proj4, label}|null }}
 */
async function buildProjectFn(prjText) {
  const info = detectCRSFromPRJ(prjText);
  if (!info || !info.proj4) return { fn: null, info };
  try {
    const proj4 = await loadProj4();
    const transform = proj4(info.proj4, "+proj=longlat +datum=WGS84 +no_defs");
    const fn = (xy) => {
      const out = transform.forward(xy);
      // proj4 returns [lon, lat]; we keep x=lon, y=lat downstream
      return [out[0], out[1]];
    };
    return { fn, info };
  } catch (e) {
    console.warn("Shapefile: proj4 reprojection failed —", e.message);
    return { fn: null, info };
  }
}

/**
 * Load a standalone .shp file (geometry only, no attribute table).
 * Returns a single __geometry column with WKT strings.
 * @param {ArrayBuffer} shpBuffer
 * @param {string}      [prjText]  Optional .prj WKT text for reprojection
 * @returns {{ headers: string[], rows: object[] }}
 */
export async function parseSHPOnly(shpBuffer, prjText = null) {
  if (!shpBuffer || shpBuffer.byteLength < 100) {
    throw new Error("SHP: buffer is missing or too small.");
  }
  const { fn: projectFn, info } = await buildProjectFn(prjText);
  const geometries = parseSHP(shpBuffer, projectFn);
  if (!geometries.length) {
    throw new Error("SHP: no shape records found.");
  }
  const rows = geometries.map((wkt, i) => ({ id: i + 1, __geometry: wkt }));
  return { headers: ["id", "__geometry"], rows, _crs: crsMeta(info, projectFn) };
}

/**
 * Parse an ESRI Shapefile attribute table.
 * @param {ArrayBuffer} dbfBuffer   - Contents of the .dbf file (required)
 * @param {ArrayBuffer} [shpBuffer] - Contents of the .shp file (optional)
 * @param {string}      [prjText]   - Contents of the .prj file (optional)
 * @returns {{ headers: string[], rows: object[] }}
 */
export async function parseShapefile(dbfBuffer, shpBuffer = null, prjText = null) {
  if (!dbfBuffer || dbfBuffer.byteLength < 32) {
    throw new Error("Shapefile: .dbf buffer is missing or too small.");
  }

  const { headers, rows } = parseDBF(dbfBuffer);

  // Add WKT geometry column if .shp is provided
  if (shpBuffer && shpBuffer.byteLength > 100) {
    const { fn: projectFn, info } = await buildProjectFn(prjText);
    let geometries;
    try {
      geometries = parseSHP(shpBuffer, projectFn);
    } catch (e) {
      // Non-fatal: geometry parse failed, continue without it
      console.warn("Shapefile: SHP geometry parse failed —", e.message);
      geometries = [];
    }

    // Only add __geometry column if we got anything useful
    if (geometries.length > 0) {
      const geomHeaders = ["__geometry", ...headers];
      const geomRows    = rows.map((row, i) => ({
        __geometry: geometries[i] ?? null,
        ...row,
      }));
      return { headers: geomHeaders, rows: geomRows, _crs: crsMeta(info, projectFn) };
    }
  }

  return { headers, rows };
}

// Build dataset-level CRS metadata from detectCRSFromPRJ + transform outcome.
function crsMeta(info, projectFn) {
  if (!info) return null;
  return {
    label:       info.label,
    proj4:       info.proj4,
    reprojected: !!projectFn,            // true when we actually transformed coords to WGS-84
    target:      projectFn ? "WGS84 (EPSG:4326)" : null,
  };
}
