// ─── ECON STUDIO · spatial/map/layers.js ─ (moved verbatim from SpatialTab.jsx)

export const LAYER_COLORS = ["#6e9ec8", "#c8a96e", "#6ec8b4", "#c47070", "#a87ec8"];
export function mkSLayer(type, idx) {
  const col = LAYER_COLORS[idx % LAYER_COLORS.length];
  const id  = "sl_" + Math.random().toString(36).slice(2, 7);
  if (type === "boundary") return { id, type, visible: true, datasetId: "active", wktCol: "", fillColor: "#d0d0d0", fillOpacity: 0.12, borderColor: "#222222", borderWidth: 0.5 };
  if (type === "grid")     return { id, type, visible: true, datasetId: "active", mode: "latlon", latCol: "", lonCol: "", wktCol: "", boundaryCol: "", cellsize: 500, clipBorder: true, fillColor: col, fillOpacity: 0, borderColor: "#d73027", borderWidth: 0.15, colorByCol: "", colorFillOpacity: 0.55 };
  if (type === "points")   return { id, type, visible: true, datasetId: "active", mode: "latlon", latCol: "", lonCol: "", wktCol: "", colorCol: "", fillColor: col, radius: 4, opacity: 0.78 };
  if (type === "line")     return { id, type, visible: true, datasetId: "active", wktCol: "", lineColor: col, lineWeight: 1.5, lineOpacity: 0.85 };
  return { id, type, visible: true };
}
