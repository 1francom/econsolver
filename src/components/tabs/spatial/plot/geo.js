// ─── ECON STUDIO · spatial/plot/geo.js ─ (moved verbatim from SpatialTab.jsx)
import { parseWktRings } from "../shared/wkt.js";

let _geoPlt = null, _geoPltPromise = null;
export function loadGeoPlt() {
  if (_geoPlt) return Promise.resolve(_geoPlt);
  if (_geoPltPromise) return _geoPltPromise;
  _geoPltPromise = import("https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm")
    .then(m => { _geoPlt = m; _geoPltPromise = null; return m; })
    .catch(e => { _geoPltPromise = null; throw e; });
  return _geoPltPromise;
}

export function geoBbox(layers, defaultRows, availableDatasets) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const exp = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const ly of layers) {
    if (!ly.visible) continue;
    const r = (!ly.datasetId || ly.datasetId === "active") ? defaultRows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? defaultRows;
    if (ly.type === "point" && ly.latCol && ly.lonCol) {
      for (const row of r) { const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]); if (!isNaN(lat) && !isNaN(lon)) exp(lon, lat); }
    } else if (ly.type === "heatmap" && ly.latCol && ly.lonCol) {
      for (const row of r) { const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]); if (!isNaN(lat) && !isNaN(lon)) exp(lon, lat); }
    } else if (ly.type === "grid" && (ly.mode ?? "boundary") === "latlon" && ly.latCol && ly.lonCol) {
      for (const row of r) { const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]); if (!isNaN(lat) && !isNaN(lon)) exp(lon, lat); }
    } else if (ly.type === "grid" && ly.mode === "wkt" && ly.wktCol) {
      for (const row of r) { const p = parseWktRings(row[ly.wktCol]); if (p) for (const ring of p.rings) for (const [x, y] of ring) exp(x, y); }
    } else if (ly.type === "grid" && (ly.mode ?? "boundary") === "boundary" && ly.boundaryCol) {
      const col = ly.boundaryCol || ly.wktCol;
      for (const row of r) { const p = parseWktRings(row[col]); if (p) for (const ring of p.rings) for (const [x, y] of ring) exp(x, y); }
    } else if (ly.wktCol) {
      for (const row of r) { const p = parseWktRings(row[ly.wktCol]); if (p) for (const ring of p.rings) for (const [x, y] of ring) exp(x, y); }
    }
  }
  if (!isFinite(x0)) return [-180, 180, -90, 90];
  const xp = (x1 - x0) * 0.06 || 0.1, yp = (y1 - y0) * 0.06 || 0.1;
  return [x0 - xp, x1 + xp, y0 - yp, y1 + yp];
}

export const GEO_COLORS = ["#6e9ec8", "#c8a96e", "#6ec8b4", "#c87070", "#a96ec8", "#c8c86e"];

export function mkGeoLayer(type, idx) {
  const id = `g${Date.now()}_${idx}`;
  const col = GEO_COLORS[idx % GEO_COLORS.length];
  if (type === "polygon")  return { id, type, visible: true, datasetId: "active", wktCol: "", fill: col, fillOpacity: 0.3, stroke: "#444", strokeWidth: 0.6 };
  if (type === "boundary") return { id, type, visible: true, datasetId: "active", wktCol: "", fill: "none", fillOpacity: 0, stroke: "#222", strokeWidth: 0.8 };
  if (type === "point")    return { id, type, visible: true, datasetId: "active", latCol: "", lonCol: "", fill: col, radius: 4, fillOpacity: 0.78 };
  if (type === "heatmap")  return { id, type, visible: true, datasetId: "active", latCol: "", lonCol: "", bandwidth: 250, gridN: 45, fill: col, fillOpacity: 0.72 };
  if (type === "line")     return { id, type, visible: true, datasetId: "active", wktCol: "", fill: "none", stroke: col, strokeWidth: 1.2 };
  if (type === "grid")     return { id, type, visible: true, datasetId: "active", mode: "wkt", wktCol: "", boundaryCol: "", latCol: "", lonCol: "", cellsize: 500, clipBorder: true, fillByCol: "", colorByCol: "", labelCol: "", labelSize: 10, fill: col, fillOpacity: 0.08, colorFillOpacity: 0.65, stroke: "#888", strokeWidth: 0.3 };
  return { id, type, visible: true, datasetId: "active" };
}
