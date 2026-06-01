// ─── ECON STUDIO · spatial/map/SpatialLayerEditor.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useMemo } from "react";
import { mono } from "../shared/constants.js";
import { ColSelect, NumInput } from "../shared/atoms.jsx";
import { ColorRow } from "./ColorRow.jsx";

export function SpatialLayerEditor({ layer, onChange, activeRows, activeHeaders, availableDatasets, C }) {
  const lyDs      = (layer.datasetId && layer.datasetId !== "active")
    ? availableDatasets.find(d => d.id === layer.datasetId) : null;
  const lyRows    = lyDs?.rows    ?? activeRows;
  const lyHeaders = lyDs?.headers ?? activeHeaders;
  const lyWktHeaders = useMemo(() =>
    lyHeaders.filter(h => {
      const s = lyRows.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTIPOLYGON|LINESTRING|MULTILINESTRING)/i.test(s.trim());
    }),
  [lyRows, lyHeaders]);
  const geomCols = lyWktHeaders.length ? lyWktHeaders : lyHeaders;

  function onDsChange(dsId) {
    onChange({ ...layer, datasetId: dsId, latCol: "", lonCol: "", wktCol: "", colorCol: "", colorByCol: "", boundaryCol: "" });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* Dataset selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>Dataset</label>
        <select
          value={layer.datasetId ?? "active"}
          onChange={e => onDsChange(e.target.value)}
          style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none", cursor: "pointer" }}
        >
          <option value="active">Active dataset</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>

      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono }}>
        {layer.type} layer
      </div>

      {/* ── Boundary ──────────────────────────────────────────────────────── */}
      {layer.type === "boundary" && (<>
        <ColSelect label="WKT geometry column" value={layer.wktCol}
          onChange={v => onChange({ ...layer, wktCol: v })} headers={geomCols} C={C} allowNone />
        <ColorRow label="Fill" color={layer.fillColor} opacity={layer.fillOpacity}
          onColor={v => onChange({ ...layer, fillColor: v })}
          onOpacity={v => onChange({ ...layer, fillOpacity: v })} C={C} />
        <ColorRow label="Border" color={layer.borderColor} opacity={layer.borderWidth}
          opacityLabel="width" opacityMin={0} opacityMax={3} opacityStep={0.05}
          onColor={v => onChange({ ...layer, borderColor: v })}
          onOpacity={v => onChange({ ...layer, borderWidth: v })} C={C} />
      </>)}

      {/* ── Grid ──────────────────────────────────────────────────────────── */}
      {layer.type === "grid" && (<>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {[["latlon", "Lat/Lon extent"], ["generate", "Boundary WKT"], ["wkt", "From WKT col"]].map(([m, lbl]) => (
            <button key={m} onClick={() => onChange({ ...layer, mode: m })}
              style={{
                flex: 1, padding: "3px 0", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
                background: layer.mode === m ? `${C.teal}18` : "transparent",
                border: `1px solid ${layer.mode === m ? C.teal + "60" : C.border}`,
                color: layer.mode === m ? C.teal : C.textMuted,
              }}
            >{lbl}</button>
          ))}
        </div>

        {layer.mode === "latlon" && (<>
          <ColSelect label="Latitude column" value={layer.latCol}
            onChange={v => onChange({ ...layer, latCol: v })} headers={lyHeaders} C={C} allowNone />
          <ColSelect label="Longitude column" value={layer.lonCol}
            onChange={v => onChange({ ...layer, lonCol: v })} headers={lyHeaders} C={C} allowNone />
          <NumInput label="Cell size (meters)" value={layer.cellsize}
            onChange={v => onChange({ ...layer, cellsize: Number(v) })} C={C} min={50} max={10000} step={50} confirm />
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={layer.clipBorder !== false}
              onChange={e => onChange({ ...layer, clipBorder: e.target.checked })}
              style={{ accentColor: C.teal, cursor: "pointer" }} />
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>Clip border cells to extent</span>
          </label>
        </>)}

        {layer.mode === "generate" && (<>
          <ColSelect label="Boundary WKT column" value={layer.boundaryCol}
            onChange={v => onChange({ ...layer, boundaryCol: v })} headers={geomCols} C={C} allowNone />
          <NumInput label="Cell size (meters)" value={layer.cellsize}
            onChange={v => onChange({ ...layer, cellsize: Number(v) })} C={C} min={50} max={10000} step={50} confirm />
          <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", userSelect: "none" }}>
            <input type="checkbox" checked={layer.clipBorder !== false}
              onChange={e => onChange({ ...layer, clipBorder: e.target.checked })}
              style={{ accentColor: C.teal, cursor: "pointer" }} />
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>Clip border cells to boundary</span>
          </label>
        </>)}

        {layer.mode === "wkt" && (<>
          <ColSelect label="Grid WKT column" value={layer.wktCol}
            onChange={v => onChange({ ...layer, wktCol: v })} headers={geomCols} C={C} allowNone />
          <ColSelect label="Choropleth variable" value={layer.colorByCol}
            onChange={v => onChange({ ...layer, colorByCol: v })} headers={lyHeaders} C={C} allowNone />
          {layer.colorByCol && (
            <NumInput label="Choropleth fill opacity" value={layer.colorFillOpacity}
              onChange={v => onChange({ ...layer, colorFillOpacity: Number(v) })} C={C} min={0} max={1} step={0.05} />
          )}
        </>)}

        <ColorRow label="Fill" color={layer.fillColor} opacity={layer.fillOpacity}
          onColor={v => onChange({ ...layer, fillColor: v })}
          onOpacity={v => onChange({ ...layer, fillOpacity: v })} C={C} />
        <ColorRow label="Border" color={layer.borderColor} opacity={layer.borderWidth}
          opacityLabel="width" opacityMin={0} opacityMax={3} opacityStep={0.05}
          onColor={v => onChange({ ...layer, borderColor: v })}
          onOpacity={v => onChange({ ...layer, borderWidth: v })} C={C} />
      </>)}

      {/* ── Line ─────────────────────────────────────────────────────────── */}
      {layer.type === "line" && (<>
        <ColSelect label="WKT geometry column" value={layer.wktCol}
          onChange={v => onChange({ ...layer, wktCol: v })} headers={geomCols} C={C} allowNone />
        <ColorRow label="Line color" color={layer.lineColor ?? "#6e9ec8"} opacity={layer.lineWeight ?? 1.5}
          opacityLabel="width" opacityMin={0.5} opacityMax={6} opacityStep={0.25}
          onColor={v => onChange({ ...layer, lineColor: v })}
          onOpacity={v => onChange({ ...layer, lineWeight: v })} C={C} />
        <NumInput label="Opacity" value={layer.lineOpacity ?? 0.85}
          onChange={v => onChange({ ...layer, lineOpacity: Number(v) })} C={C} min={0} max={1} step={0.05} />
      </>)}

      {/* ── Points ────────────────────────────────────────────────────────── */}
      {layer.type === "points" && (<>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <ColSelect label="Latitude" value={layer.latCol}
            onChange={v => onChange({ ...layer, latCol: v })} headers={lyHeaders} C={C} allowNone />
          <ColSelect label="Longitude" value={layer.lonCol}
            onChange={v => onChange({ ...layer, lonCol: v })} headers={lyHeaders} C={C} allowNone />
        </div>
        <ColSelect label="Color by (optional)" value={layer.colorCol}
          onChange={v => onChange({ ...layer, colorCol: v })} headers={lyHeaders} C={C} allowNone />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <NumInput label="Radius (px)" value={layer.radius}
            onChange={v => onChange({ ...layer, radius: Number(v) })} C={C} min={1} max={20} step={1} />
          <NumInput label="Opacity" value={layer.opacity ?? 0.78}
            onChange={v => onChange({ ...layer, opacity: Number(v) })} C={C} min={0} max={1} step={0.05} />
        </div>
        {!layer.colorCol && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>Color</span>
            <input type="color" value={layer.fillColor}
              onChange={e => onChange({ ...layer, fillColor: e.target.value })}
              style={{ width: 28, height: 22, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
          </div>
        )}
      </>)}
    </div>
  );
}

// Layer factory
