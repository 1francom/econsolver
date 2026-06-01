// ─── ECON STUDIO · spatial/shared/guess.js ───────────────────────────────────
// Column inference heuristics: pick the first column whose name looks like
// lat / lon / geometry / address. Pure JS, no deps.

export function guessLatCol(headers) {
  return headers.find(h => /^lat(itude)?$/i.test(h)) ??
         headers.find(h => /lat/i.test(h)) ??
         headers[0] ?? "";
}
export function guessLonCol(headers) {
  return headers.find(h => /^lon(gitude)?$/i.test(h)) ??
         headers.find(h => /lon|lng/i.test(h)) ??
         headers[1] ?? "";
}
export function guessWktCol(headers) {
  return headers.find(h => /wkt|geom|geometry|polygon|shape/i.test(h)) ?? headers[0] ?? "";
}
export function guessPointCountCol(headers) {
  const joined = headers.join(" ");
  if (/school|escuela|establec|cue|nivel|sector/i.test(joined)) return "n_schools";
  if (/crime|delito|hecho|robo|hurto|homic/i.test(joined)) return "n_crimes";
  if (/bus|parada|stop|colectivo|transport/i.test(joined)) return "n_bus_stops";
  if (/police|policia|policía|comisaria|comisaría/i.test(joined)) return "n_police";
  return "n_points";
}
export function looksLikeWktValue(v) {
  return typeof v === "string" && /^(POINT|POLYGON|MULTIPOLYGON|LINESTRING|MULTILINESTRING)/i.test(v.trim());
}
export function isGeometryHeader(headers, rows, h) {
  if (/wkt|geom|geometry|polygon|shape/i.test(h)) return true;
  return looksLikeWktValue(rows.find(r => r[h] != null)?.[h]);
}
export function guessAddressCol(headers) {
  return headers.find(h => /address|addr|street|direccion|dirección|adresse/i.test(h)) ??
         headers.find(h => /place|location|ubicacion|ubicación|name/i.test(h)) ??
         headers[0] ?? "";
}
