// ─── ECON STUDIO · spatial/map/SpatialPlotTab.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo, useEffect, useRef } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";

import { BASEMAPS, addBasemap, loadLeaflet } from "../shared/leaflet.js";
import { loadProj4, PRESET_CRS, isProjectedWKT, makeCabaMetricGrid } from "../shared/crs.js";
import { leafletPolygonLatLngs, wktToLeaflet } from "../shared/wkt.js";
import { buildColorScale } from "../shared/color.js";
import { transformWKT } from "../../../../math/SpatialEngine.js";
import { MapLegend } from "./MapLegend.jsx";
import { SpatialLayerEditor } from "./SpatialLayerEditor.jsx";
import { mkSLayer } from "./layers.js";
import { loadSpatialMaps, saveSpatialMaps } from "../../../../services/Persistence/indexedDB.js";
import { guessLatCol, guessLonCol } from "../shared/guess.js";

export function SpatialPlotTab({ rows, headers, availableDatasets, onAddDataset, C, pid }) {
  const { T } = useTheme();
  const wrapRef    = useRef(null);
  const mapDivRef  = useRef(null);
  const leafMapRef = useRef(null);

  const [L,        setL]       = useState(null);
  const [mapErr,   setMapErr]  = useState(null);
  const [layers,   setLayers]  = useState([]);
  const [activeId, setActiveId]= useState(null);
  const [saveName, setSaveName]= useState("grid_cells");
  const [basemap,  setBasemap] = useState("light");
  const [ptDiag,   setPtDiag]  = useState({});  // layerId → {total, valid, outOfBounds}

  // ── Download as HTML ─────────────────────────────────────────────────────────
  function downloadMapHtml() {
    const toDisplayWkt = wkt => {
      if (!wkt) return "";
      try {
        return isProjectedWKT(wkt) ? transformWKT(wkt, "EPSG:32721", "EPSG:4326", 8) : wkt;
      } catch {
        return wkt;
      }
    };
    const gridFromLayer = ly => {
      const lyRows = (!ly.datasetId || ly.datasetId === "active")
        ? rows
        : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      if (ly.mode === "wkt" && ly.wktCol) {
        return lyRows
          .filter(r => r[ly.wktCol])
          .map(r => ({ ...r, geometry: toDisplayWkt(r[ly.wktCol]) }));
      }
      if ((ly.mode === "generate" || ly.mode === "boundary") && (ly.boundaryCol || ly.wktCol)) {
        const col = ly.boundaryCol || ly.wktCol;
        return lyRows.flatMap(r => {
          const wkt = r[col];
          if (!wkt) return [];
          try { return makeCabaMetricGrid(wkt, Number(ly.cellsize) || 500, ly.clipBorder !== false); }
          catch { return []; }
        });
      }
      if (ly.mode === "latlon" && ly.latCol && ly.lonCol) {
        const lats = lyRows.map(r => parseFloat(r[ly.latCol])).filter(v => !isNaN(v));
        const lons = lyRows.map(r => parseFloat(r[ly.lonCol])).filter(v => !isNaN(v));
        if (!lats.length || !lons.length) return [];
        const pad = 0.0001;
        const lat0 = Math.min(...lats) - pad, lat1 = Math.max(...lats) + pad;
        const lon0 = Math.min(...lons) - pad, lon1 = Math.max(...lons) + pad;
        const bboxWkt = `POLYGON((${lon0} ${lat0}, ${lon1} ${lat0}, ${lon1} ${lat1}, ${lon0} ${lat1}, ${lon0} ${lat0}))`;
        try { return makeCabaMetricGrid(bboxWkt, Number(ly.cellsize) || 500, false); }
        catch { return []; }
      }
      return [];
    };
    const layerData = layers.filter(ly => ly.visible).map(ly => {
      const lyRows = (!ly.datasetId || ly.datasetId === "active")
        ? rows
        : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      if (ly.type === "grid") return { ...ly, _data: gridFromLayer(ly), wktCol: "geometry", mode: "wkt" };
      if ((ly.type === "boundary" || ly.type === "line") && ly.wktCol) {
        return { ...ly, _data: lyRows.map(r => ({ ...r, [ly.wktCol]: toDisplayWkt(r[ly.wktCol]) })) };
      }
      return { ...ly, _data: lyRows };
    }).filter(ly => ly.type !== "grid" || ly._data.length);

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" /><title>Spatial Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head><body><div id="map"></div><script>
const LAYERS=${JSON.stringify(layerData)};
const BASEMAP=${JSON.stringify(BASEMAPS[basemap] ?? BASEMAPS.light)};
function parseWkt(wkt){
  if(!wkt||typeof wkt!=="string")return null;
  const s=wkt.trim().toUpperCase();
  function parseRing(s){return s.replace(/[()]/g,"").trim().split(",").map(p=>{const[x,y]=p.trim().split(/\s+/);return[parseFloat(y),parseFloat(x)];}).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));}
  if(s.startsWith("POINT")){const c=s.match(/POINT\s*\(([^)]+)\)/);if(!c)return null;const[x,y]=c[1].trim().split(/\s+/);return{type:"point",latlng:[parseFloat(y),parseFloat(x)]};}
  function groups(s){const out=[];let d=0,st=-1;for(let i=0;i<s.length;i++){const ch=s[i];if(ch==="("){if(d===0)st=i;d++;}else if(ch===")"){d--;if(d===0&&st>=0){out.push(s.slice(st+1,i));st=-1;}}}return out;}
  const body=wkt.slice(wkt.indexOf("("));const inner=groups(body)[0];if(!inner)return null;
  if(s.startsWith("POLYGON")){const rings=groups(inner).map(parseRing).filter(r=>r.length>=3);return rings.length?{type:"polygon",rings}:null;}
  if(s.startsWith("MULTIPOLYGON")){const rings=groups(inner).map(p=>groups(p).map(parseRing).filter(r=>r.length>=3)).filter(p=>p.length);return rings.length?{type:"multipolygon",rings}:null;}
  if(s.startsWith("LINESTRING")){const coords=parseRing(inner);return coords.length>=2?{type:"line",rings:[coords]}:null;}
  if(s.startsWith("MULTILINESTRING")){const lines=groups(inner).map(parseRing).filter(r=>r.length>=2);return lines.length?{type:"multiline",rings:lines}:null;}
  return null;
}
const map=L.map("map");
L.tileLayer(BASEMAP.url,{attribution:BASEMAP.attribution,maxZoom:19,detectRetina:true,crossOrigin:true}).addTo(map);
const group=L.featureGroup().addTo(map);
for(const ly of LAYERS){
  if(ly.type==="points"&&ly.mode==="wkt"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo||geo.type!=="point")continue;L.circleMarker(geo.latlng,{radius:ly.radius??4,fillColor:ly.fillColor??"#6ec8b4",color:ly.fillColor??"#6ec8b4",weight:1,fillOpacity:0.78}).addTo(group);}
  }else if(ly.type==="points"&&ly.latCol&&ly.lonCol){
    for(const row of ly._data){const lat=parseFloat(row[ly.latCol]),lon=parseFloat(row[ly.lonCol]);if(isNaN(lat)||isNaN(lon))continue;L.circleMarker([lat,lon],{radius:ly.radius??4,fillColor:ly.fillColor??"#6ec8b4",color:ly.fillColor??"#6ec8b4",weight:1,fillOpacity:0.78}).addTo(group);}
  }else if(ly.type==="boundary"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo)continue;if(geo.type==="point"){L.circleMarker(geo.latlng,{radius:6,fillColor:ly.fillColor??"#6e9ec8",color:ly.borderColor??"#333",weight:ly.borderWidth??0.8,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}else{L.polygon(geo.rings,{fillColor:ly.fillColor??"#6e9ec8",color:ly.borderColor??"#333",weight:ly.borderWidth??0.8,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}}
  }else if(ly.type==="grid"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo)continue;if(geo.type!=="point"){L.polygon(geo.rings,{fillColor:ly.fillColor??"#6ec8b4",color:ly.borderColor??"#d73027",weight:ly.borderWidth??0.15,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}}
  }else if(ly.type==="line"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo)continue;if(geo.type==="line"||geo.type==="multiline"){for(const coords of geo.rings){L.polyline(coords,{color:ly.lineColor??"#6e9ec8",weight:ly.lineWeight??1.5,opacity:ly.lineOpacity??0.85}).addTo(group);}}}
  }
}
try{const b=group.getBounds();if(b.isValid())map.fitBounds(b.pad(0.06));else map.setView([20,0],2);}catch(_){map.setView([20,0],2);}
<\/script></body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "spatial_map.html"; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Download map as PNG (vector overlay cropped to visible area) ────────────
  function downloadMapPng() {
    const map = leafMapRef.current;
    if (!map) return;
    const overlaySvg = map.getPanes().overlayPane?.querySelector("svg");
    if (!overlaySvg) { alert("No vector layers to export."); return; }

    // Leaflet's overlay SVG extends beyond the viewport by its padding (default ~200px).
    // Crop to the visible map container using viewBox.
    const containerRect = map.getContainer().getBoundingClientRect();
    const svgRect       = overlaySvg.getBoundingClientRect();
    const vbX = containerRect.left - svgRect.left;
    const vbY = containerRect.top  - svgRect.top;
    const vbW = Math.max(1, containerRect.width);
    const vbH = Math.max(1, containerRect.height);

    const svgClone = overlaySvg.cloneNode(true);
    svgClone.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
    svgClone.setAttribute("width",  vbW);
    svgClone.setAttribute("height", vbH);

    const svgStr  = new XMLSerializer().serializeToString(svgClone);
    const svgBlob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(svgBlob);
    const img = new Image();
    img.onload = () => {
      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width  = Math.round(vbW) * scale;
      canvas.height = Math.round(vbH) * scale;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#f0ede8"; // light CARTO-style background
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(blobUrl);
      const a = document.createElement("a");
      a.href = canvas.toDataURL("image/png");
      a.download = "spatial_map.png";
      a.click();
    };
    img.onerror = () => { URL.revokeObjectURL(blobUrl); alert("PNG export failed — try a different browser."); };
    img.src = blobUrl;
  }

  // ── Download map as PDF (SVG in print iframe) ────────────────────────────────
  function downloadMapPdf() {
    const map = leafMapRef.current;
    if (!map) return;
    const overlaySvg = map.getPanes().overlayPane?.querySelector("svg");
    if (!overlaySvg) { alert("No vector layers to export."); return; }
    const { width, height } = overlaySvg.getBoundingClientRect();
    const svgStr  = new XMLSerializer().serializeToString(overlaySvg);
    const blob    = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const iframe  = document.createElement("iframe");
    iframe.style.cssText = `position:fixed;top:-9999px;left:-9999px;width:${Math.max(1, Math.round(width))}px;height:${Math.max(1, Math.round(height))}px;border:none;`;
    iframe.src = blobUrl;
    iframe.onload = () => {
      try { iframe.contentWindow.print(); } catch (_) { alert("PDF export: use the browser print dialog."); }
      setTimeout(() => { URL.revokeObjectURL(blobUrl); document.body.removeChild(iframe); }, 2000);
    };
    document.body.appendChild(iframe);
  }

  useEffect(() => {
    loadLeaflet().then(setL).catch(() => setMapErr("Could not load Leaflet."));
  }, []);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { if (leafMapRef.current) leafMapRef.current.invalidateSize(); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const wktHeaders = useMemo(() => headers.filter(h => {
    const s = rows.find(r => r[h] != null)?.[h];
    return typeof s === "string" && /^(POINT|POLYGON|MULTIPOLYGON)/i.test(s.trim());
  }), [rows, headers]);

  // ── CRS reprojection ─────────────────────────────────────────────────────────
  const [crsInput,   setCrsInput]   = useState("");
  const [activeCrs,  setActiveCrs]  = useState(null);   // null = WGS84
  const [proj4fn,    setProj4fn]    = useState(null);   // ([x,y]) => [lon,lat]
  const [crsErr,     setCrsErr]     = useState("");
  const [crsLoading, setCrsLoading] = useState(false);

  // ── Persist / restore map config per project (Phase 4b) ──────────────────────
  // The layer config (mkSLayer objects) + basemap + CRS string are plain-
  // serializable; the Leaflet render is rebuilt from them by the effects below.
  const hydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    hydratedRef.current = false;
    loadSpatialMaps(pid).then(rec => {
      if (cancelled) return;
      const m = rec?.maps;
      if (m) {
        if (Array.isArray(m.layers)) setLayers(m.layers);
        if (m.basemap)               setBasemap(m.basemap);
        // Re-apply CRS so proj4fn is live (not just restoring the string)
        if (typeof m.crsInput === "string" && m.crsInput) applyCrs(m.crsInput);
      }
      hydratedRef.current = true;
    });
    return () => { cancelled = true; };
  }, [pid]);
  useEffect(() => {
    if (!pid || !hydratedRef.current) return; // don't overwrite before restore completes
    const t = setTimeout(() => saveSpatialMaps(pid, { layers, basemap, crsInput }), 400);
    return () => clearTimeout(t);
  }, [pid, layers, basemap, crsInput]);

  // Detect if any visible dataset contains projected WKT.
  const hasProjected = useMemo(() => {
    const allRows = [
      ...rows,
      ...availableDatasets.flatMap(d => d.rows ?? []),
    ];
    const checkRow = r => Object.values(r).some(v => typeof v === "string" && isProjectedWKT(v));
    return allRows.slice(0, 200).some(checkRow);
  }, [rows, availableDatasets]);

  async function applyCrs(crsStr) {
    const proj4str = (crsStr ?? crsInput).trim();
    if (!proj4str) return;
    setCrsErr(""); setCrsLoading(true);
    try {
      const p4 = await loadProj4();
      // Validate — try projecting a sample point
      const out = p4(proj4str, "WGS84", [500000, 5000000]);
      if (!Array.isArray(out) || isNaN(out[0])) throw new Error("bad output");
      setActiveCrs(proj4str);
      // Store as a stable function reference (useState setter form prevents double-call)
      const fn = xy => p4(proj4str, "WGS84", xy);
      setProj4fn(() => fn);
      setCrsInput(proj4str);
    } catch (e) {
      setCrsErr("Invalid proj4 string — paste a +proj=… definition.");
    }
    setCrsLoading(false);
  }

  function clearCrs() {
    setActiveCrs(null); setProj4fn(null); setCrsInput(""); setCrsErr("");
  }

  // J3 — auto-init CRS from dataset metadata when projected coords are detected
  // and no CRS has been set yet.
  useEffect(() => {
    if (activeCrs || !hasProjected) return;
    const dsCrs = availableDatasets.find(d => d.crs?.proj4)?.crs;
    if (dsCrs?.proj4) applyCrs(dsCrs.proj4);
  }, [hasProjected, availableDatasets]); // eslint-disable-line react-hooks/exhaustive-deps

  const addLayer    = type => setLayers(prev => {
    const ly = mkSLayer(type, prev.length);
    // Auto-populate lat/lon columns for Points layers using header heuristics
    if (type === "points") {
      ly.latCol = guessLatCol(headers);
      ly.lonCol = guessLonCol(headers);
    }
    setActiveId(ly.id);
    return [...prev, ly];
  });
  const updateLayer = upd  => setLayers(prev => prev.map(l => l.id === upd.id ? upd : l));
  const removeLayer = id   => { setLayers(prev => prev.filter(l => l.id !== id)); setActiveId(prev => prev === id ? null : prev); };
  const activeLayer = layers.find(l => l.id === activeId) ?? null;

  // Helper: resolve rows for a layer based on its datasetId
  function lyRows(ly) {
    if (!ly.datasetId || ly.datasetId === "active") return rows;
    return availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
  }

  // Auto-generate grid cells (memoized — also used for save)
  const generatedGrid = useMemo(() => {
    const gl = layers.find(l =>
      l.type === "grid" && l.cellsize > 0 && (
        (l.mode === "generate" && l.boundaryCol) ||
        (l.mode === "latlon"   && l.latCol && l.lonCol)
      )
    );
    if (!gl) return null;
    const glRows = (!gl.datasetId || gl.datasetId === "active") ? rows : availableDatasets.find(d => d.id === gl.datasetId)?.rows ?? rows;
    let wkt;
    if (gl.mode === "generate") {
      wkt = glRows.find(r => r[gl.boundaryCol])?.[gl.boundaryCol];
      if (!wkt) return null;
    } else {
      // latlon mode: build bounding-box WKT from point extent
      const lats = glRows.map(r => parseFloat(r[gl.latCol])).filter(v => !isNaN(v));
      const lons = glRows.map(r => parseFloat(r[gl.lonCol])).filter(v => !isNaN(v));
      if (!lats.length || !lons.length) return null;
      const pad = 0.0001;
      const lat0 = Math.min(...lats) - pad, lat1 = Math.max(...lats) + pad;
      const lon0 = Math.min(...lons) - pad, lon1 = Math.max(...lons) + pad;
      wkt = `POLYGON((${lon0} ${lat0}, ${lon1} ${lat0}, ${lon1} ${lat1}, ${lon0} ${lat1}, ${lon0} ${lat0}))`;
    }
    try { return { cells: makeCabaMetricGrid(wkt, gl.cellsize, gl.clipBorder !== false), error: null }; }
    catch (e) { return { cells: null, error: e.message }; }
  }, [layers, rows, availableDatasets]);

  // Build Leaflet map
  useEffect(() => {
    if (!L || !mapDivRef.current) return;
    if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; }

    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true });
    leafMapRef.current = map;
    addBasemap(L, map, basemap);

    const group = L.featureGroup().addTo(map);
    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const layerDiags = {};   // collected per-layer point diagnostics

    for (const ly of layers) {
      if (!ly.visible) continue;

      // ── Boundary ──────────────────────────────────────────────────────────
      if (ly.type === "boundary" && ly.wktCol) {
        for (const row of lyRows(ly)) {
          const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
          if (!geo) continue;
          if (geo.type === "point") {
            L.circleMarker(geo.latlng, { radius: 6, fillColor: ly.fillColor, color: ly.borderColor, weight: ly.borderWidth, fillOpacity: ly.fillOpacity }).addTo(group);
          } else {
            L.polygon(leafletPolygonLatLngs(geo), { fillColor: ly.fillColor, fillOpacity: ly.fillOpacity, color: ly.borderColor, weight: ly.borderWidth }).addTo(group);
          }
        }
      }

      // ── Grid ──────────────────────────────────────────────────────────────
      if (ly.type === "grid") {
        let cells = [];
        if (ly.mode === "wkt" && ly.wktCol) {
          cells = lyRows(ly).filter(r => r[ly.wktCol]);
          const { getColor } = buildColorScale(cells, ly.colorByCol, ly.palette);
          for (const cell of cells) {
            const geo = wktToLeaflet(cell[ly.wktCol], proj4fn);
            if (!geo || geo.type === "point") continue;
            const fc = ly.colorByCol ? (getColor(cell) ?? ly.fillColor) : ly.fillColor;
            const fo = ly.colorByCol ? ly.colorFillOpacity : ly.fillOpacity;
            L.polygon(leafletPolygonLatLngs(geo), { fillColor: fc, fillOpacity: fo, color: ly.borderColor, weight: ly.borderWidth })
              .bindTooltip(ly.colorByCol ? `${esc(ly.colorByCol)}: ${esc(cell[ly.colorByCol])}` : `grid #${cell.grid_id ?? ""}`)
              .addTo(group);
          }
        } else if (ly.mode === "generate" && generatedGrid?.cells) {
          cells = generatedGrid.cells;
          for (const cell of cells) {
            const geo = wktToLeaflet(cell.geometry);
            if (!geo || geo.type === "point") continue;
            L.polygon(leafletPolygonLatLngs(geo), { fillColor: ly.fillColor, fillOpacity: ly.fillOpacity, color: ly.borderColor, weight: ly.borderWidth })
              .bindTooltip(`grid #${cell.grid_id}`)
              .addTo(group);
          }
        }
      }

      // ── Points ────────────────────────────────────────────────────────────
      if (ly.type === "points") {
        const ptRows = lyRows(ly);
        const { getColor } = buildColorScale(ptRows, ly.colorCol, ly.palette);
        const op = ly.opacity ?? 0.78;

        if (ly.mode === "wkt" && ly.wktCol) {
          for (const row of ptRows) {
            const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
            if (!geo || geo.type !== "point") continue;
            const color = (ly.colorCol ? getColor(row) : null) ?? ly.fillColor;
            const tipParts = [`lat: ${geo.latlng[0].toFixed(4)}`, `lon: ${geo.latlng[1].toFixed(4)}`];
            if (ly.colorCol) tipParts.push(`${esc(ly.colorCol)}: ${esc(row[ly.colorCol])}`);
            L.circleMarker(geo.latlng, { radius: ly.radius, fillColor: color, color, weight: 1, opacity: op, fillOpacity: op * 0.78 })
              .bindTooltip(tipParts.join("<br>")).addTo(group);
          }
        } else if (ly.latCol && ly.lonCol) {
          let diagTotal = 0, diagValid = 0, diagOob = 0;
          for (const row of ptRows) {
            diagTotal++;
            let lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]);
            if (isNaN(lat) || isNaN(lon)) continue;
            // J2: reproject from projected CRS (easting=lon col, northing=lat col) → WGS84
            if (proj4fn) { const [wLon, wLat] = proj4fn([lon, lat]); lon = wLon; lat = wLat; }
            if (lat < -90 || lat > 90 || lon < -180 || lon > 180) { diagOob++; continue; }
            diagValid++;
            const color = (ly.colorCol ? getColor(row) : null) ?? ly.fillColor;
            const tipParts = [`lat: ${lat.toFixed(4)}`, `lon: ${lon.toFixed(4)}`];
            if (ly.colorCol) tipParts.push(`${esc(ly.colorCol)}: ${esc(row[ly.colorCol])}`);
            L.circleMarker([lat, lon], { radius: ly.radius, fillColor: color, color, weight: 1, opacity: op, fillOpacity: op * 0.78 })
              .bindTooltip(tipParts.join("<br>")).addTo(group);
          }
          layerDiags[ly.id] = { total: diagTotal, valid: diagValid, outOfBounds: diagOob };
        }
      }

      // ── Line ──────────────────────────────────────────────────────────────
      if (ly.type === "line" && ly.wktCol) {
        for (const row of lyRows(ly)) {
          const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
          if (!geo || (geo.type !== "line" && geo.type !== "multiline")) continue;
          for (const coords of geo.rings) {
            L.polyline(coords, { color: ly.lineColor ?? "#6e9ec8", weight: ly.lineWeight ?? 1.5, opacity: ly.lineOpacity ?? 0.85 }).addTo(group);
          }
        }
      }
    }

    try {
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.05));
      else map.setView([20, 0], 2);
    } catch (_) { map.setView([20, 0], 2); }

    setPtDiag(layerDiags);

    return () => { if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; } };
  }, [L, layers, rows, availableDatasets, generatedGrid, proj4fn, basemap]);

  // Active legend
  const activeLegend = useMemo(() => {
    for (const ly of [...layers].reverse()) {
      if (!ly.visible) continue;
      const r = (!ly.datasetId || ly.datasetId === "active") ? rows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      if (ly.type === "grid"   && ly.mode === "wkt" && ly.colorByCol) return buildColorScale(r, ly.colorByCol, ly.palette).legend;
      if (ly.type === "points" && ly.colorCol)                         return buildColorScale(r, ly.colorCol, ly.palette).legend;
    }
    return null;
  }, [layers, rows, availableDatasets]);

  if (!L) return <div style={{ padding: "2rem", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Loading Leaflet…</div>;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <div style={{ width: 252, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* CRS Banner — shown when projected coordinates detected or CRS active */}
        {(hasProjected || activeCrs) && (
          <div style={{
            padding: "7px 10px", borderBottom: `1px solid ${C.border}`,
            background: activeCrs ? `${C.teal}08` : `${C.gold}0c`,
            flexShrink: 0,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
              <span style={{ fontSize: T.caption.fontSize, letterSpacing: "0.12em", textTransform: "uppercase",
                color: activeCrs ? C.teal : C.gold, fontFamily: T.code.fontFamily }}>
                {activeCrs ? "✓ CRS active" : "⚠ Projected CRS detected"}
              </span>
              {activeCrs && (
                <button onClick={clearCrs} style={{
                  marginLeft: "auto", padding: "1px 6px", borderRadius: 2, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                  background: "transparent", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer",
                }}>clear</button>
              )}
            </div>
            {/* Preset chip row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 3, marginBottom: 5 }}>
              {Object.entries(PRESET_CRS).map(([name, proj4str]) => (
                <button key={name} onClick={() => applyCrs(proj4str)}
                  style={{
                    padding: "2px 5px", borderRadius: 2, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                    background: activeCrs === proj4str ? `${C.gold}22` : "transparent",
                    border: `1px solid ${activeCrs === proj4str ? C.gold : C.border2}`,
                    color: activeCrs === proj4str ? C.gold : C.textMuted,
                    cursor: "pointer", whiteSpace: "nowrap",
                  }}
                >{name}</button>
              ))}
            </div>
            {/* Custom proj4 input */}
            <div style={{ display: "flex", gap: 4 }}>
              <input value={crsInput} onChange={e => setCrsInput(e.target.value)}
                placeholder="+proj=utm +zone=32 +datum=WGS84 …"
                style={{
                  flex: 1, padding: "3px 5px", background: C.bg,
                  border: `1px solid ${C.border2}`, borderRadius: 2,
                  color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none",
                  minWidth: 0,
                }}
              />
              <button onClick={() => applyCrs()} disabled={crsLoading || !crsInput.trim()}
                style={{
                  padding: "3px 7px", borderRadius: 2, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                  background: `${C.teal}18`, border: `1px solid ${C.teal}55`,
                  color: C.teal, cursor: "pointer", flexShrink: 0,
                }}
              >{crsLoading ? "…" : "Apply"}</button>
            </div>
            {crsErr && <div style={{ fontSize: T.caption.fontSize, color: C.red, fontFamily: T.code.fontFamily, marginTop: 3 }}>{crsErr}</div>}
          </div>
        )}

        {/* Layer list */}
        <div style={{ padding: "0.75rem 0.65rem 0.6rem", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.18em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 5 }}>
              Basemap
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 4 }}>
              {Object.entries(BASEMAPS).map(([key, cfg]) => (
                <button key={key} onClick={() => setBasemap(key)}
                  style={{
                    padding: "3px 5px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                    background: basemap === key ? `${C.teal}18` : "transparent",
                    border: `1px solid ${basemap === key ? C.teal + "60" : C.border2}`,
                    color: basemap === key ? C.teal : C.textMuted,
                  }}
                >{cfg.label}</button>
              ))}
            </div>
          </div>

          <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: T.code.fontFamily, marginBottom: 8 }}>
            Map Layers
          </div>
          {layers.length === 0 && (
            <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily, marginBottom: 8 }}>
              Add layers to build your map.
            </div>
          )}
          {layers.map(ly => (
            <div key={ly.id} onClick={() => setActiveId(ly.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "4px 6px",
                borderRadius: 3, marginBottom: 3, cursor: "pointer",
                background: activeId === ly.id ? `${C.teal}12` : "transparent",
                border: `1px solid ${activeId === ly.id ? C.teal + "40" : "transparent"}`,
              }}
            >
              <div style={{
                width: 7, height: 7, borderRadius: ly.type === "points" ? "50%" : 1, flexShrink: 0,
                background: ly.type === "boundary" ? ly.borderColor : ly.type === "grid" ? ly.borderColor : ly.type === "line" ? (ly.lineColor ?? "#6e9ec8") : ly.fillColor,
              }} />
              <span style={{ flex: 1, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: activeId === ly.id ? C.teal : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ly.type}
                {ly.type === "boundary" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "grid" && (ly.mode === "latlon" || ly.mode === "generate") && ` · ${ly.cellsize}m`}
                {ly.type === "grid" && ly.mode === "wkt" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "line" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "points" && ly.mode === "wkt" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "points" && ly.mode !== "wkt" && ly.latCol && ` · ${ly.latCol}/${ly.lonCol}`}
              </span>
              <button onClick={e => { e.stopPropagation(); updateLayer({ ...ly, visible: !ly.visible }); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 2px", color: ly.visible ? C.textDim : C.textMuted }}
              >{ly.visible ? "●" : "○"}</button>
              <button onClick={e => { e.stopPropagation(); removeLayer(ly.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.code.fontSize, padding: "0 2px", lineHeight: 1, color: C.textMuted }}
              >×</button>
            </div>
          ))}
          {/* Add buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {[["boundary","Boundary"], ["grid","Grid"], ["points","Points"], ["line","Line"]].map(([t, lbl]) => (
              <button key={t} onClick={() => addLayer(t)}
                style={{ padding: "3px 7px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: "none", border: `1px dashed ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
              >+{lbl}</button>
            ))}
          </div>

          {/* ── Download as HTML / PNG / PDF ── */}
          {layers.length > 0 && (
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
              <button onClick={downloadMapHtml}
                style={{ padding: "3px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.gold}15`, border: `1px solid ${C.gold}55`, color: C.gold, cursor: "pointer" }}
              >⬇ map.html</button>
              <div style={{ display: "flex", gap: 4 }}>
                <button onClick={downloadMapPng}
                  style={{ flex: 1, padding: "3px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}12`, border: `1px solid ${C.teal}40`, color: C.teal, cursor: "pointer" }}
                >⬇ .png</button>
                <button onClick={downloadMapPdf}
                  style={{ flex: 1, padding: "3px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.teal}12`, border: `1px solid ${C.teal}40`, color: C.teal, cursor: "pointer" }}
                >⬇ .pdf</button>
              </div>
            </div>
          )}
        </div>

        {/* Layer editor */}
        <div style={{ flex: 1, padding: "0.75rem 0.65rem", overflowY: "auto" }}>
          {activeLayer
            ? <>
                <SpatialLayerEditor layer={activeLayer} onChange={updateLayer} activeRows={rows} activeHeaders={headers} availableDatasets={availableDatasets} C={C} />
                {/* Points out-of-bounds diagnostic */}
                {activeLayer.type === "points" && (activeLayer.mode === "latlon" || !activeLayer.mode) && activeLayer.latCol && activeLayer.lonCol && (() => {
                  const d = ptDiag[activeLayer.id];
                  if (!d || d.total === 0) return null;
                  if (d.valid === d.total) return (
                    <div style={{ marginTop: 8, padding: "5px 8px", borderRadius: 3, background: `${C.teal}12`, border: `1px solid ${C.teal}30`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.teal }}>
                      ✓ {d.valid.toLocaleString()} points plotted
                    </div>
                  );
                  if (d.valid === 0) return (
                    <div style={{ marginTop: 8, padding: "6px 8px", borderRadius: 3, background: `${C.gold}12`, border: `1px solid ${C.gold}50`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold, lineHeight: 1.5 }}>
                      ⚠ 0 of {d.total.toLocaleString()} points plotted — all values are outside WGS84 bounds
                      (lat: −90…90, lon: −180…180).<br/>
                      {d.outOfBounds > 0 && `${d.outOfBounds.toLocaleString()} rows filtered.`}{" "}
                      If your coordinates are integer-encoded (e.g. −345123456 → −34.5123456),
                      use the DataViewer → Position panel to insert the decimal point,
                      or use the CRS Transform section if they are projected coordinates.
                    </div>
                  );
                  return (
                    <div style={{ marginTop: 8, padding: "5px 8px", borderRadius: 3, background: `${C.gold}0c`, border: `1px solid ${C.gold}40`, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold }}>
                      ⚠ {d.valid.toLocaleString()} of {d.total.toLocaleString()} points plotted
                      ({d.outOfBounds.toLocaleString()} out-of-bounds filtered)
                    </div>
                  );
                })()}
              </>
            : <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Select or add a layer.</div>
          }
        </div>

        {/* Grid status / save */}
        {generatedGrid && (
          <div style={{ padding: "0.65rem", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            {generatedGrid.error ? (
              <div style={{ fontSize: T.caption.fontSize, color: C.red, fontFamily: T.code.fontFamily, lineHeight: 1.5 }}>{generatedGrid.error}</div>
            ) : (
              <>
                <div style={{ fontSize: T.caption.fontSize, color: C.teal, fontFamily: T.code.fontFamily, marginBottom: 6 }}>
                  {generatedGrid.cells.length.toLocaleString()} grid cells generated
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="grid_cells"
                    style={{ flex: 1, padding: "3px 6px", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text, outline: "none" }}
                  />
                  <button
                    onClick={() => saveName && onAddDataset?.(saveName, generatedGrid.cells, [
                      "grid_id", "geometry", "metric_geometry", "centroid_lon", "centroid_lat",
                      "centroid_x", "centroid_y", "area_m2", "cellsize_m", "metric_crs"
                    ])}
                    disabled={!saveName}
                    style={{ padding: "3px 9px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, background: `${C.gold}18`, border: `1px solid ${C.gold}`, color: C.gold, cursor: "pointer" }}
                  >Save</button>
                </div>
              </>
            )}
          </div>
        )}

        {mapErr && <div style={{ padding: "0.5rem", fontSize: T.caption.fontSize, color: C.red, fontFamily: T.code.fontFamily }}>{mapErr}</div>}
      </div>

      {/* ── MAP ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
          <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
          <MapLegend legend={activeLegend} C={C} />
        </div>
        {layers.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 500 }}>
            <div style={{ background: `${C.bg}bf`, border: `1px solid ${C.border2}`, borderRadius: 4, padding: "1.2rem 2rem", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, textAlign: "center" }}>
              Add a Boundary, Grid, Points, or Line layer<br />
              <span style={{ fontSize: T.caption.fontSize }}>to build your spatial plot.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SPATIAL GEO PLOT — Observable Plot / ggplot2+sf style ───────────────────
