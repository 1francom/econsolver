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
 *       For Polygon (5):    same layout as Polyline
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

// ── SHP geometry reader ────────────────────────────────────────────────────────

/** Read a little-endian float64 pair as {x, y} */
function readPoint(dv, offset) {
  return {
    x: dv.getFloat64(offset,     true),
    y: dv.getFloat64(offset + 8, true),
  };
}

/** Format a point array as WKT ring string: "x1 y1, x2 y2, ..." */
function pointsToWKTRing(points) {
  return points.map(p => `${p.x} ${p.y}`).join(", ");
}

/**
 * Parse the .shp file and return an array of WKT strings (one per record).
 * Records with null shapes return null. Record index is 0-based.
 */
function parseSHP(buf) {
  const dv = new DataView(buf);
  const geometries = [];

  // SHP file header is 100 bytes
  let pos = 100;

  while (pos < buf.byteLength - 8) {
    // Record header: record number (BE int32) + content length in 16-bit words (BE int32)
    const contentLenWords = dv.getInt32(pos + 4, false); // big-endian
    const contentBytes    = contentLenWords * 2;
    pos += 8; // skip record header

    if (contentBytes < 4 || pos + contentBytes > buf.byteLength) break;

    const shapeType = dv.getInt32(pos, true); // little-endian
    let wkt = null;

    switch (shapeType) {
      case 0: // Null shape
        wkt = null;
        break;

      case 1: // Point
      case 11: // PointZ
      case 21: { // PointM
        const p = readPoint(dv, pos + 4);
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
          pts.push(readPoint(dv, pointsOffset + i * 16));
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
          pts.push(readPoint(dv, pointsOffset + i * 16));
        }

        const partStarts = [];
        for (let i = 0; i < numParts; i++) {
          partStarts.push(dv.getInt32(partsOffset + i * 4, true));
        }

        const rings = partStarts.map((start, i) => {
          const end = i + 1 < numParts ? partStarts[i + 1] : numPoints;
          return `(${pointsToWKTRing(pts.slice(start, end))})`;
        });

        wkt = numParts === 1
          ? `POLYGON(${rings[0]})`
          : `POLYGON(${rings.join(", ")})`;
        break;
      }

      case 8:  // MultiPoint
      case 18: // MultiPointZ
      case 28: { // MultiPointM
        const numPoints = dv.getInt32(pos + 4 + 32, true);
        const pts = [];
        for (let i = 0; i < numPoints; i++) {
          pts.push(readPoint(dv, pos + 4 + 32 + 4 + i * 16));
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

// ── Main export ────────────────────────────────────────────────────────────────
/**
 * Parse an ESRI Shapefile attribute table.
 * @param {ArrayBuffer} dbfBuffer   - Contents of the .dbf file (required)
 * @param {ArrayBuffer} [shpBuffer] - Contents of the .shp file (optional)
 * @returns {{ headers: string[], rows: object[] }}
 */
export async function parseShapefile(dbfBuffer, shpBuffer = null) {
  if (!dbfBuffer || dbfBuffer.byteLength < 32) {
    throw new Error("Shapefile: .dbf buffer is missing or too small.");
  }

  const { headers, rows } = parseDBF(dbfBuffer);

  // Add WKT geometry column if .shp is provided
  if (shpBuffer && shpBuffer.byteLength > 100) {
    let geometries;
    try {
      geometries = parseSHP(shpBuffer);
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
      return { headers: geomHeaders, rows: geomRows };
    }
  }

  return { headers, rows };
}
