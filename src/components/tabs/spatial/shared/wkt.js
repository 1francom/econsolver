// ─── ECON STUDIO · spatial/shared/wkt.js ─────────────────────────────────────
// WKT parsing helpers. Pure JS, no deps.
//  - wktToLeaflet  → Leaflet-compatible [lat, lon] geometry (used by map tab)
//  - parseWktRings → [x, y] (lon/lat) rings for SVG plotting (used by plot tab)

export function splitParenGroups(s) {
  const groups = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "(") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === ")") {
      depth--;
      if (depth === 0 && start >= 0) {
        groups.push(s.slice(start + 1, i));
        start = -1;
      }
    }
  }
  return groups;
}

export function leafletPolygonLatLngs(geo) {
  if (!geo || geo.type === "point") return null;
  return geo.type === "multipolygon" ? geo.rings : geo.rings;
}

// ─── WKT PARSER ──────────────────────────────────────────────────────────────
// Returns Leaflet-compatible [lat, lon] coordinates from WKT.
// POLYGON:      { type:"polygon",      rings:[[lat,lon], ...][] }
// MULTIPOLYGON: { type:"multipolygon", rings:[ polygonRings[] ] }
// projectFn: optional (xy: [x,y]) => [lon, lat] transform for projected CRS.
export function wktToLeaflet(wkt, projectFn) {
  if (!wkt || typeof wkt !== "string") return null;
  const s = wkt.trim().toUpperCase();

  const coordPair = str => {
    const parts = str.trim().split(/\s+/);
    const x = parseFloat(parts[0]), y = parseFloat(parts[1]);
    if (isNaN(x) || isNaN(y)) return null;
    if (projectFn) {
      const [lon, lat] = projectFn([x, y]);
      return isNaN(lon) || isNaN(lat) ? null : [lat, lon];
    }
    return [y, x]; // WGS84: x=lon, y=lat → Leaflet [lat, lon]
  };
  const ring = str => str.split(",").map(coordPair).filter(Boolean);

  if (s.startsWith("POINT")) {
    const m = wkt.match(/POINT\s*\(\s*([^)]+)\)/i);
    if (!m) return null;
    const p = coordPair(m[1]);
    return p ? { type: "point", latlng: p } : null;
  }

  const body = wkt.slice(wkt.indexOf("("));
  const inner = splitParenGroups(body)[0];
  if (!inner) return null;

  if (s.startsWith("MULTIPOLYGON")) {
    const polys = splitParenGroups(inner)
      .map(polyStr => splitParenGroups(polyStr).map(ring).filter(r => r.length >= 3))
      .filter(poly => poly.length);
    return polys.length ? { type: "multipolygon", rings: polys } : null;
  }
  if (s.startsWith("POLYGON")) {
    const rings = splitParenGroups(inner).map(ring).filter(r => r.length >= 3);
    return rings.length ? { type: "polygon", rings } : null;
  }
  if (s.startsWith("MULTILINESTRING")) {
    const lines = splitParenGroups(inner).map(ring).filter(r => r.length >= 2);
    return lines.length ? { type: "multiline", rings: lines } : null;
  }
  if (s.startsWith("LINESTRING")) {
    const coords = ring(inner);
    return coords.length >= 2 ? { type: "line", rings: [coords] } : null;
  }
  return null;
}

// Returns raw [x, y] (lon/lat) rings for SVG plotting.
export function parseWktRings(wkt) {
  if (!wkt || typeof wkt !== "string") return null;
  const raw = wkt.trim();
  const s = raw.toUpperCase();
  const coords = str => str.trim().split(",").map(p => {
    const [x, y] = p.trim().split(/\s+/);
    return [parseFloat(x), parseFloat(y)];
  }).filter(([x, y]) => !isNaN(x) && !isNaN(y));
  if (s.startsWith("POINT")) {
    const m = raw.match(/POINT\s*\(([^)]+)\)/i);
    if (!m) return null;
    const [x, y] = m[1].trim().split(/\s+/).map(Number);
    return { type: "point", rings: [[[x, y]]] };
  }
  const body = raw.slice(raw.indexOf("("));
  const inner = splitParenGroups(body)[0];
  if (!inner) return null;
  if (s.startsWith("MULTIPOLYGON")) {
    const rings = [];
    for (const poly of splitParenGroups(inner)) {
      for (const ring of splitParenGroups(poly)) {
        const r = coords(ring);
        if (r.length >= 2) rings.push(r);
      }
    }
    return rings.length ? { type: "polygon", rings } : null;
  }
  if (s.startsWith("POLYGON")) {
    const rings = splitParenGroups(inner).map(coords).filter(r => r.length >= 2);
    return rings.length ? { type: "polygon", rings } : null;
  }
  if (s.startsWith("MULTILINESTRING")) {
    const rings = splitParenGroups(inner).map(coords).filter(r => r.length >= 2);
    return rings.length ? { type: "line", rings } : null;
  }
  if (s.startsWith("LINESTRING")) {
    const r = coords(inner);
    return r.length >= 2 ? { type: "line", rings: [r] } : null;
  }
  return null;
}
