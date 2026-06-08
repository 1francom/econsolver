// ─── ECON STUDIO · spatial/analyze/_parked/SpatialMapSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo, useEffect, useRef } from "react";
import { useTheme } from "../../../../../ThemeContext.jsx";

import { BASEMAPS, addBasemap, loadLeaflet } from "../../shared/leaflet.js";
import { leafletPolygonLatLngs, wktToLeaflet } from "../../shared/wkt.js";
import { buildColorScale } from "../../shared/color.js";
import { ColSelect, NumInput } from "../../shared/atoms.jsx";
import { guessLatCol, guessLonCol } from "../../shared/guess.js";
import { getPlotHistory, savePlotHistory } from "../../../../../services/Persistence/plotHistory.js";
import { MapLegend } from "../../map/MapLegend.jsx";

export function SpatialMapSection({ rows, headers, C, pid }) {
  const { T } = useTheme();
  const wktHeaders = useMemo(() => headers.filter(h => {
    const sample = rows.find(r => r[h] != null)?.[h];
    return typeof sample === "string" && /^(POINT|POLYGON|MULTIPOLYGON)/i.test(sample.trim());
  }), [rows, headers]);

  const [latCol,      setLatCol]      = useState(() => guessLatCol(headers));
  const [lonCol,      setLonCol]      = useState(() => guessLonCol(headers));
  const [ptColorCol,  setPtColorCol]  = useState("");
  const [showPoints,  setShowPoints]  = useState(true);
  const [ptRadius,    setPtRadius]    = useState(5);

  const [wktCol,      setWktCol]      = useState(() => wktHeaders[0] ?? "");
  const [polyColorCol,setPolyColorCol]= useState("");
  const [showPolygons,setShowPolygons]= useState(true);
  const [polyOpacity, setPolyOpacity] = useState(0.45);
  const [basemap,     setBasemap]     = useState("light");

  // ── Map history ──────────────────────────────────────────────────────────────
  const [mapHistory, setMapHistory] = useState([]);
  const [histOpen,   setHistOpen]   = useState(false);

  useEffect(() => {
    if (!pid) return;
    getPlotHistory(pid).then(h => setMapHistory(h ?? [])).catch(() => {});
  }, [pid]);

  function getCurrentConfig() {
    return { latCol, lonCol, ptColorCol, showPoints, ptRadius, wktCol, polyColorCol, showPolygons, polyOpacity };
  }

  async function saveMap() {
    if (!pid) return;
    const name = window.prompt("Map name:", `Map ${mapHistory.length + 1}`);
    if (!name) return;
    const entry = { id: Date.now(), name, config: getCurrentConfig(), savedAt: Date.now() };
    const next = [...mapHistory, entry];
    setMapHistory(next);
    await savePlotHistory(pid, next);
  }

  async function loadMapEntry(entry) {
    const c = entry.config;
    setLatCol(c.latCol ?? ""); setLonCol(c.lonCol ?? "");
    setPtColorCol(c.ptColorCol ?? ""); setShowPoints(c.showPoints ?? true);
    setPtRadius(c.ptRadius ?? 5); setWktCol(c.wktCol ?? "");
    setPolyColorCol(c.polyColorCol ?? ""); setShowPolygons(c.showPolygons ?? true);
    setPolyOpacity(c.polyOpacity ?? 0.45);
  }

  async function deleteMapEntry(id) {
    const next = mapHistory.filter(e => e.id !== id);
    setMapHistory(next);
    if (pid) await savePlotHistory(pid, next);
  }

  const [L,    setL]   = useState(null);
  const [err,  setErr] = useState(null);
  const wrapRef   = useRef(null);
  const mapDivRef = useRef(null);
  const leafMapRef= useRef(null);

  useEffect(() => {
    loadLeaflet().then(setL).catch(() => setErr("Could not load Leaflet. Check internet connection."));
  }, []);

  // Resize observer — safe: watches fixed-height wrapper, not the Leaflet div
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (leafMapRef.current) leafMapRef.current.invalidateSize(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Build / rebuild the map whenever inputs change
  useEffect(() => {
    if (!L || !mapDivRef.current) return;
    if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; }

    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true });
    leafMapRef.current = map;

    addBasemap(L, map, basemap);

    const layerGroup = L.featureGroup().addTo(map);
    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    // ── Polygon / boundary layer ──────────────────────────────────────────────
    if (showPolygons && wktCol) {
      const { getColor: getPolyColor, legend: polyLegend } = buildColorScale(rows, polyColorCol);
      for (const row of rows) {
        const wkt = row[wktCol];
        if (!wkt) continue;
        const geo = wktToLeaflet(wkt);
        if (!geo) continue;
        const color = getPolyColor(row) ?? "#6e9ec8";

        if (geo.type === "point") {
          L.circleMarker(geo.latlng, {
            radius: 6, fillColor: color, color, weight: 1,
            fillOpacity: polyOpacity, opacity: 1,
          }).addTo(layerGroup);
        } else {
          const rings = leafletPolygonLatLngs(geo);
          const tip = polyColorCol
            ? `${esc(polyColorCol)}: ${esc(row[polyColorCol])}`
            : (row.name ?? row.NAME ?? "");
          L.polygon(rings, {
            fillColor: color, color: "#333",
            weight: 0.8, fillOpacity: polyOpacity,
          }).bindTooltip(tip ? String(tip) : undefined).addTo(layerGroup);
        }
      }
    }

    // ── Point layer ───────────────────────────────────────────────────────────
    if (showPoints && latCol && lonCol) {
      const { getColor: getPtColor, legend: ptLegend } = buildColorScale(rows, ptColorCol);
      for (const row of rows) {
        const lat = parseFloat(row[latCol]);
        const lon = parseFloat(row[lonCol]);
        if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
        const color = getPtColor(row) ?? "#6ec8b4";
        const tipParts = [`lat: ${lat.toFixed(4)}`, `lon: ${lon.toFixed(4)}`];
        if (ptColorCol) tipParts.push(`${esc(ptColorCol)}: ${esc(row[ptColorCol])}`);
        L.circleMarker([lat, lon], {
          radius: ptRadius, fillColor: color, color,
          weight: 1, opacity: 0.9, fillOpacity: 0.78,
        }).bindTooltip(tipParts.join("<br>")).addTo(layerGroup);
      }
    }

    // Fit bounds
    try {
      const b = layerGroup.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.06));
      else map.setView([20, 0], 2);
    } catch (_) { map.setView([20, 0], 2); }

    return () => { if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; } };
  }, [L, rows, latCol, lonCol, ptColorCol, showPoints, ptRadius, wktCol, polyColorCol, showPolygons, polyOpacity, basemap]);

  // Derive active legend (polygon takes priority over points)
  const { legend } = useMemo(() => {
    if (showPolygons && wktCol && polyColorCol) return buildColorScale(rows, polyColorCol);
    if (showPoints && ptColorCol)               return buildColorScale(rows, ptColorCol);
    return { legend: null };
  }, [rows, showPolygons, wktCol, polyColorCol, showPoints, ptColorCol]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Controls */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div style={{ gridColumn: "1 / -1", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Basemap
          </span>
          {Object.entries(BASEMAPS).map(([key, cfg]) => (
            <button key={key} onClick={() => setBasemap(key)}
              style={{
                padding: "3px 9px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                background: basemap === key ? `${C.teal}18` : "transparent",
                border: `1px solid ${basemap === key ? C.teal + "60" : C.border2}`,
                color: basemap === key ? C.teal : C.textMuted,
              }}
            >{cfg.label}</button>
          ))}
        </div>

        {/* Point layer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={showPoints} onChange={e => setShowPoints(e.target.checked)}
              style={{ accentColor: C.teal, cursor: "pointer" }} />
            <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Points layer
            </span>
          </div>
          <div style={{ opacity: showPoints ? 1 : 0.4, pointerEvents: showPoints ? "auto" : "none" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              <ColSelect label="Latitude" value={latCol} onChange={setLatCol} headers={headers} C={C} />
              <ColSelect label="Longitude" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
              <ColSelect label="Color by (optional)" value={ptColorCol} onChange={setPtColorCol} headers={headers} C={C} allowNone />
              <NumInput label="Point radius (px)" value={ptRadius} onChange={setPtRadius} C={C} min={2} max={20} step={1} />
            </div>
          </div>
        </div>

        {/* Polygon layer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={showPolygons} onChange={e => setShowPolygons(e.target.checked)}
              style={{ accentColor: C.teal, cursor: "pointer" }} />
            <span style={{ fontSize: T.caption.fontSize, color: C.teal, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Boundaries layer
            </span>
            <span style={{ fontSize: 8, color: C.textMuted }}>(WKT geometry)</span>
          </div>
          <div style={{ opacity: showPolygons ? 1 : 0.4, pointerEvents: showPolygons ? "auto" : "none" }}>
            {wktHeaders.length === 0 ? (
              <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.6 }}>
                No WKT geometry column detected. Load a shapefile or run a Spatial Join
                to add council / neighborhood / city boundary polygons.
              </div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <ColSelect label="Geometry (WKT)" value={wktCol} onChange={setWktCol} headers={wktHeaders} C={C} />
                <ColSelect label="Choropleth variable" value={polyColorCol} onChange={setPolyColorCol} headers={headers} C={C} allowNone />
                <NumInput label="Fill opacity" value={polyOpacity} onChange={setPolyOpacity} C={C} min={0} max={1} step={0.05} />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Save / History row ── */}
      {pid && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={saveMap}
            style={{ padding: "3px 10px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}18`, border: `1px solid ${C.teal}55`, color: C.teal, cursor: "pointer" }}
          >Save map</button>
          {mapHistory.length > 0 && (
            <button onClick={() => setHistOpen(o => !o)}
              style={{ padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
            >{histOpen ? "▲" : "▼"} {mapHistory.length} saved</button>
          )}
        </div>
      )}

      {/* ── History cards ── */}
      {pid && histOpen && mapHistory.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mapHistory.map(entry => (
            <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 3, border: `1px solid ${C.border2}`, background: C.surface }}>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text }}>{entry.name}</span>
              <button onClick={() => loadMapEntry(entry)}
                style={{ padding: "1px 6px", borderRadius: 2, fontFamily: T.code.fontFamily, fontSize: 8, background: `${C.teal}18`, border: `1px solid ${C.teal}55`, color: C.teal, cursor: "pointer" }}
              >Load</button>
              <button onClick={() => deleteMapEntry(entry.id)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.code.fontSize, lineHeight: 1, color: C.textMuted, padding: "0 2px" }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>{err}</div>}
      {!L   && <div style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>Loading Leaflet…</div>}

      {/* Map — fixed-height wrapper prevents ResizeObserver feedback loop */}
      <div ref={wrapRef} style={{ position: "relative", height: 480, borderRadius: 4, overflow: "hidden", border: `1px solid ${C.border2}` }}>
        <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
        <MapLegend legend={legend} C={C} />
      </div>
    </div>
  );
}

// ─── BOUNDARY DISTANCE SECTION ───────────────────────────────────────────────
