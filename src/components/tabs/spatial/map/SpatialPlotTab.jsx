// ─── ECON STUDIO · spatial/map/SpatialPlotTab.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo, useEffect, useRef } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";

import { BASEMAPS, addBasemap, loadLeaflet } from "../shared/leaflet.js";
import { loadProj4, PRESET_CRS, isProjectedWKT, makeCabaMetricGrid } from "../shared/crs.js";
import { leafletPolygonLatLngs, wktToLeaflet } from "../shared/wkt.js";
import { buildColorScale } from "../shared/color.js";
import { MapLegend } from "./MapLegend.jsx";
import { SpatialLayerEditor } from "./SpatialLayerEditor.jsx";
import { mkSLayer } from "./layers.js";
import { loadSpatialMaps, saveSpatialMaps } from "../../../../services/Persistence/indexedDB.js";
import { getMapHistory, saveMapHistory } from "../../../../services/Persistence/plotHistory.js";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { MONO_STACK } from "../../../../theme.js";
import { useSessionLogOptional } from "../../../../services/session/sessionLog.jsx";

// ── PNG export helpers (Leaflet → canvas) ────────────────────────────────────
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y,     x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x,     y + h, r);
  ctx.arcTo(x,     y + h, x,     y,     r);
  ctx.arcTo(x,     y,     x + w, y,     r);
  ctx.closePath();
}

// Re-draw the active MapLegend onto the export canvas (bottom-right), mirroring
// MapLegend.jsx — since that legend is a DOM overlay, not part of the map SVG.
function paintMapLegend(ctx, legend, W, H, C, T) {
  if (!legend) return;
  const font = T?.code?.fontFamily || MONO_STACK;
  const fs = 11, pad = 8, rowH = 16, sw = 9, gap = 6;
  const title = String(legend.col ?? "").toUpperCase();

  let items = [];
  if (legend.type === "categorical")          items = legend.cats.map(c => ({ label: String(c), color: legend.cmap[c] }));
  else if (legend.type === "numeric-discrete") items = legend.values.map(v => ({ label: String(v), color: legend.cmap[String(v)] }));

  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `${fs}px ${font}`;

  let maxLabel = ctx.measureText(title).width;
  for (const it of items) maxLabel = Math.max(maxLabel, sw + gap + ctx.measureText(it.label).width);

  let boxW, boxH;
  if (legend.type === "gradient") {
    boxW = Math.max(120, maxLabel + pad * 2);
    boxH = pad + fs + 6 + 8 + 4 + fs + pad;
  } else {
    boxW = Math.max(90, maxLabel + pad * 2);
    boxH = pad + fs + 6 + items.length * rowH + pad - 4;
  }
  const x = W - boxW - 8;
  const y = H - boxH - 24;

  ctx.globalAlpha = 0.94;
  ctx.fillStyle = C?.surface ?? "#ffffff";
  roundRectPath(ctx, x, y, boxW, boxH, 4); ctx.fill();
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1;
  ctx.strokeStyle = C?.border2 ?? "#dddddd";
  roundRectPath(ctx, x, y, boxW, boxH, 4); ctx.stroke();

  ctx.fillStyle = C?.textMuted ?? "#777777";
  ctx.font = `${fs - 1}px ${font}`;
  ctx.fillText(title, x + pad, y + pad + fs - 2);
  ctx.font = `${fs}px ${font}`;

  if (legend.type === "gradient") {
    const barX = x + pad, barY = y + pad + fs + 4, barW = boxW - pad * 2, barH = 8;
    const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
    const pal = legend.pal;
    if (pal?.stops)               pal.stops.forEach((c, i, a) => grad.addColorStop(i / (a.length - 1), `rgb(${c.join(",")})`));
    else if (pal?.low && pal?.high) { grad.addColorStop(0, `rgb(${pal.low.join(",")})`); grad.addColorStop(1, `rgb(${pal.high.join(",")})`); }
    else                          { grad.addColorStop(0, "#149470"); grad.addColorStop(1, "#d27d12"); }
    ctx.fillStyle = grad;
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = C?.textDim ?? "#777777";
    ctx.fillText(Number(legend.min).toFixed(2), barX, barY + barH + fs);
    ctx.textAlign = "right";
    ctx.fillText(Number(legend.max).toFixed(2), barX + barW, barY + barH + fs);
    ctx.textAlign = "left";
  } else {
    items.forEach((it, i) => {
      const iy = y + pad + fs + 6 + i * rowH;
      ctx.fillStyle = it.color;
      roundRectPath(ctx, x + pad, iy - sw + 1, sw, sw, 2); ctx.fill();
      ctx.fillStyle = C?.text ?? "#333333";
      ctx.fillText(it.label, x + pad + sw + gap, iy);
    });
  }
  ctx.restore();
}

function paintMapAttribution(ctx, W, H, T, text = "© OpenStreetMap © CARTO") {
  ctx.save();
  ctx.font = `9px ${T?.code?.fontFamily || MONO_STACK}`;
  ctx.fillStyle = "rgba(90,90,90,0.85)";
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText(text, W - 4, H - 2);
  ctx.restore();
}

export function SpatialPlotTab({ rows, headers, availableDatasets, onAddDataset, C, pid }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLogOptional();
  const wrapRef    = useRef(null);
  const mapDivRef  = useRef(null);
  const leafMapRef = useRef(null);

  const [L,        setL]       = useState(null);
  const [mapErr,   setMapErr]  = useState(null);
  const [layers,   setLayers]  = useState([]);
  const [activeId, setActiveId]= useState(null);
  const [saveName, setSaveName]= useState("grid_cells");
  const [basemap,  setBasemap] = useState("light");
  const [mapHistory, setMapHistory] = useState([]);
  const [savedMapId, setSavedMapId] = useState(null);
  const [ptDiag,   setPtDiag]  = useState({});  // layerId → {total, valid, outOfBounds}

  // ── Download as HTML ─────────────────────────────────────────────────────────
  function downloadMapHtml() {
    const features = [];
    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const pushPolygon = (geo, options, tooltip = "") => {
      if (!geo || geo.type === "point") return;
      features.push({ kind: "polygon", latlngs: leafletPolygonLatLngs(geo), options, tooltip });
    };

    for (const ly of layers) {
      if (!ly.visible) continue;
      const data = lyRows(ly);

      if (ly.type === "boundary" && ly.wktCol) {
        for (const row of data) {
          const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
          const options = {
            fillColor: ly.fillColor, color: ly.borderColor,
            weight: ly.borderWidth, fillOpacity: ly.fillOpacity,
          };
          if (geo?.type === "point") features.push({ kind: "point", latlng: geo.latlng, options: { ...options, radius: 6 } });
          else pushPolygon(geo, options);
        }
      }

      if (ly.type === "grid") {
        const cells = ly.mode === "wkt" && ly.wktCol
          ? data.filter(row => row[ly.wktCol])
          : ly.mode === "generate" ? generatedGrid?.cells ?? [] : [];
        const wktCol = ly.mode === "wkt" ? ly.wktCol : "geometry";
        const { getColor } = buildColorScale(cells, ly.colorByCol, ly.palette);
        for (const cell of cells) {
          const geo = wktToLeaflet(cell[wktCol], ly.mode === "wkt" ? proj4fn : null);
          const fillColor = ly.colorByCol ? (getColor(cell) ?? ly.fillColor) : ly.fillColor;
          const fillOpacity = ly.colorByCol ? ly.colorFillOpacity : ly.fillOpacity;
          const tooltip = ly.colorByCol
            ? `${esc(ly.colorByCol)}: ${esc(cell[ly.colorByCol])}`
            : `grid #${esc(cell.grid_id ?? "")}`;
          pushPolygon(geo, {
            fillColor, fillOpacity, color: ly.borderColor, weight: ly.borderWidth,
          }, tooltip);
        }
      }

      if (ly.type === "points") {
        const { getColor } = buildColorScale(data, ly.colorCol, ly.palette);
        const opacity = ly.opacity ?? 0.78;
        for (const row of data) {
          let latlng = null;
          if (ly.mode === "wkt" && ly.wktCol) {
            const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
            if (geo?.type === "point") latlng = geo.latlng;
          } else if (ly.latCol && ly.lonCol) {
            let lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]);
            if (Number.isFinite(lat) && Number.isFinite(lon)) {
              if (proj4fn) { const projected = proj4fn([lon, lat]); lon = projected[0]; lat = projected[1]; }
              if (lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) latlng = [lat, lon];
            }
          }
          if (!latlng) continue;
          const color = (ly.colorCol ? getColor(row) : null) ?? ly.fillColor;
          const tooltip = [
            `lat: ${latlng[0].toFixed(4)}`,
            `lon: ${latlng[1].toFixed(4)}`,
            ...(ly.colorCol ? [`${esc(ly.colorCol)}: ${esc(row[ly.colorCol])}`] : []),
          ].join("<br>");
          features.push({
            kind: "point", latlng, tooltip,
            options: { radius: ly.radius, fillColor: color, color, weight: 1, opacity, fillOpacity: opacity * 0.78 },
          });
        }
      }

      if (ly.type === "line" && ly.wktCol) {
        for (const row of data) {
          const geo = wktToLeaflet(row[ly.wktCol], proj4fn);
          if (!geo || (geo.type !== "line" && geo.type !== "multiline")) continue;
          for (const latlngs of geo.rings) {
            features.push({
              kind: "line", latlngs,
              options: { color: ly.lineColor ?? "#6e9ec8", weight: ly.lineWeight ?? 1.5, opacity: ly.lineOpacity ?? 0.85 },
            });
          }
        }
      }
    }

    const map = leafMapRef.current;
    const center = map?.getCenter();
    const mapView = center ? { center: [center.lat, center.lng], zoom: map.getZoom() } : null;
    const scriptJson = value => JSON.stringify(value)
      .replace(/</g, "\\u003c")
      .replace(/\u2028/g, "\\u2028")
      .replace(/\u2029/g, "\\u2029");

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" /><title>Spatial Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head><body><div id="map"></div><script>
const FEATURES=${scriptJson(features)};
const BASEMAP=${scriptJson(BASEMAPS[basemap] ?? BASEMAPS.light)};
const VIEW=${scriptJson(mapView)};
const LEGEND=${scriptJson(activeLegend)};
const map=L.map("map");
L.tileLayer(BASEMAP.url,{attribution:BASEMAP.attribution,maxZoom:19,detectRetina:true,crossOrigin:true}).addTo(map);
const group=L.featureGroup().addTo(map);
for(const feature of FEATURES){
  let layer=null;
  if(feature.kind==="point")layer=L.circleMarker(feature.latlng,feature.options);
  else if(feature.kind==="polygon")layer=L.polygon(feature.latlngs,feature.options);
  else if(feature.kind==="line")layer=L.polyline(feature.latlngs,feature.options);
  if(!layer)continue;
  if(feature.tooltip)layer.bindTooltip(feature.tooltip);
  layer.addTo(group);
}
try{
  if(VIEW&&Array.isArray(VIEW.center)&&Number.isFinite(VIEW.zoom))map.setView(VIEW.center,VIEW.zoom,{animate:false});
  else{const b=group.getBounds();if(b.isValid())map.fitBounds(b.pad(0.06));else map.setView([20,0],2);}
}catch(_){map.setView([20,0],2);}
if(LEGEND){
  const ctl=L.control({position:"bottomright"});
  ctl.onAdd=function(){
    const div=L.DomUtil.create("div");
    div.style.cssText="background:#fff;border:1px solid #ddd;border-radius:4px;padding:6px 10px;font:11px ui-monospace,SFMono-Regular,monospace;box-shadow:0 1px 4px rgba(0,0,0,0.2);line-height:1.4";
    const t=document.createElement("div");
    t.style.cssText="text-transform:uppercase;letter-spacing:0.1em;color:#777;margin-bottom:4px";
    t.textContent=LEGEND.col||"";div.appendChild(t);
    function row(color,label,round){
      const r=document.createElement("div");
      r.style.cssText="display:flex;align-items:center;gap:5px;margin-bottom:2px";
      const sw=document.createElement("span");
      sw.style.cssText="width:9px;height:9px;flex-shrink:0;display:inline-block;border-radius:"+(round?"50%":"2px")+";background:"+color;
      const lb=document.createElement("span");lb.textContent=label;
      r.appendChild(sw);r.appendChild(lb);div.appendChild(r);
    }
    if(LEGEND.type==="categorical"){for(const c of LEGEND.cats)row(LEGEND.cmap[c],String(c),true);}
    else if(LEGEND.type==="numeric-discrete"){for(const v of LEGEND.values)row(LEGEND.cmap[String(v)],String(v),false);}
    else if(LEGEND.type==="gradient"){
      const p=LEGEND.pal;const g=p&&p.stops?p.stops.map(c=>"rgb("+c.join(",")+")").join(","):p&&p.low&&p.high?"rgb("+p.low.join(",")+"),rgb("+p.high.join(",")+")":"#149470,#d27d12";
      const bar=document.createElement("div");bar.style.cssText="height:8px;border-radius:2px;margin-bottom:3px;background:linear-gradient(to right,"+g+")";div.appendChild(bar);
      const mm=document.createElement("div");mm.style.cssText="display:flex;justify-content:space-between;color:#777";
      const lo=document.createElement("span");lo.textContent=Number(LEGEND.min).toFixed(2);
      const hi=document.createElement("span");hi.textContent=Number(LEGEND.max).toFixed(2);
      mm.appendChild(lo);mm.appendChild(hi);div.appendChild(mm);
    }
    return div;
  };
  ctl.addTo(map);
}
<\/script></body></html>`;

    const blob = new Blob([html], { type: "text/html" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href = url; a.download = "spatial_map.html"; a.click();
    URL.revokeObjectURL(url);
  }

  // ── Compose the live map into a canvas using the exact DOM positions Leaflet
  //    rendered. Shared by PNG and PDF export. ─────────────────────────────────
  async function buildMapCanvas() {
    const map = leafMapRef.current;
    if (!map) return null;
    const container     = map.getContainer();
    const containerRect = container.getBoundingClientRect();
    const W = Math.max(1, Math.round(containerRect.width));
    const H = Math.max(1, Math.round(containerRect.height));
    const scale = 2;

    const canvas = document.createElement("canvas");
    canvas.width  = Math.round(W * scale);
    canvas.height = Math.round(H * scale);
    const ctx = canvas.getContext("2d");
    ctx.scale(scale, scale);
    ctx.fillStyle = basemap === "dark" ? "#111318" : "#f0ede8";
    ctx.fillRect(0, 0, W, H);

    const loadExportImage = (src, crossOrigin = false) => new Promise(resolve => {
      const img = new Image();
      if (crossOrigin) img.crossOrigin = "anonymous";
      const timer = setTimeout(() => resolve(null), 5000);
      img.onload = () => { clearTimeout(timer); resolve(img); };
      img.onerror = () => { clearTimeout(timer); resolve(null); };
      img.src = src;
    });

    // 1 — basemap tiles. Re-load the visible tile URLs with CORS enabled, but
    //     use their rendered rectangles so retina tiles and zoom transforms
    //     remain pixel-aligned with the vector pane.
    const tileSpecs = [...container.querySelectorAll(".leaflet-tile-pane img.leaflet-tile")]
      .map((element, order) => {
        const rect = element.getBoundingClientRect();
        const tileContainer = element.closest(".leaflet-tile-container");
        const tileLayer = element.closest(".leaflet-layer");
        return {
          element, order,
          src: element.currentSrc || element.src,
          x: rect.left - containerRect.left,
          y: rect.top - containerRect.top,
          width: rect.width,
          height: rect.height,
          zIndex: Number.parseInt(tileContainer?.style.zIndex || "0", 10) || 0,
          opacity: Number.parseFloat(tileLayer?.style.opacity || "1") || 1,
        };
      })
      .filter(tile => tile.src && tile.width > 0 && tile.height > 0
        && tile.x < W && tile.y < H && tile.x + tile.width > 0 && tile.y + tile.height > 0)
      .sort((a, b) => a.zIndex - b.zIndex || a.order - b.order);

    const tiles = await Promise.all(tileSpecs.map(async tile => ({
      ...tile,
      image: await loadExportImage(tile.src, true),
    })));
    for (const tile of tiles) {
      const image = tile.image ?? (tile.element.complete ? tile.element : null);
      if (!image) continue;
      try {
        ctx.save();
        ctx.globalAlpha = tile.opacity;
        ctx.drawImage(image, tile.x, tile.y, tile.width, tile.height);
        ctx.restore();
      } catch {
        ctx.restore();
      }
    }

    // 2 — vector overlays. Preserve Leaflet's original viewBox and draw each
    //     SVG at its rendered offset; replacing the viewBox shifts the paths.
    const overlaySvgs = [...(map.getPanes().overlayPane?.querySelectorAll("svg") ?? [])];
    for (const overlaySvg of overlaySvgs) {
      const svgRect = overlaySvg.getBoundingClientRect();
      if (svgRect.width <= 0 || svgRect.height <= 0) continue;
      const svgClone = overlaySvg.cloneNode(true);
      svgClone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      svgClone.setAttribute("width", String(svgRect.width));
      svgClone.setAttribute("height", String(svgRect.height));
      svgClone.style.transform = "none";
      svgClone.style.left = "0";
      svgClone.style.top = "0";
      const svgStr = new XMLSerializer().serializeToString(svgClone);
      const blobUrl = URL.createObjectURL(new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" }));
      const image = await loadExportImage(blobUrl);
      URL.revokeObjectURL(blobUrl);
      if (!image) continue;
      try {
        ctx.drawImage(
          image,
          svgRect.left - containerRect.left,
          svgRect.top - containerRect.top,
          svgRect.width,
          svgRect.height,
        );
      } catch { /* skip an invalid overlay */ }
    }

    const attrText = basemap === "osm" ? "© OpenStreetMap" : "© OpenStreetMap © CARTO";
    paintMapLegend(ctx, activeLegend, W, H, C, T);
    paintMapAttribution(ctx, W, H, T, attrText);
    return canvas;
  }

  // ── Download map as PNG (basemap + vectors + legend baked in) ────────────────
  function downloadMapPng() {
    buildMapCanvas().then(canvas => {
      if (!canvas) return;
      let url;
      try { url = canvas.toDataURL("image/png"); }
      catch { alert("PNG export blocked by tile CORS — try the Light or OSM basemap."); return; }
      const a = document.createElement("a");
      a.href = url; a.download = "spatial_map.png"; a.click();
    });
  }

  // ── Download map as PDF (same composited canvas, printed via iframe) ─────────
  function downloadMapPdf() {
    buildMapCanvas().then(canvas => {
      if (!canvas) return;
      let dataUrl;
      try { dataUrl = canvas.toDataURL("image/png"); }
      catch { alert("PDF export blocked by tile CORS — try the Light or OSM basemap."); return; }
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>spatial_map</title>`
        + `<style>@page{margin:8mm}html,body{margin:0;padding:0}img{width:100%;height:auto;display:block}</style>`
        + `</head><body><img src="${dataUrl}"></body></html>`;
      const blobUrl = URL.createObjectURL(new Blob([html], { type: "text/html" }));
      const iframe  = document.createElement("iframe");
      iframe.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:900px;height:650px;border:none;";
      iframe.src = blobUrl;
      iframe.onload = () => {
        setTimeout(() => {
          try { iframe.contentWindow.focus(); iframe.contentWindow.print(); } catch (_) { void _; alert("PDF export: use the browser print dialog."); }
          setTimeout(() => { URL.revokeObjectURL(blobUrl); document.body.removeChild(iframe); }, 2000);
        }, 300);
      };
      document.body.appendChild(iframe);
    });
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
  useEffect(() => {
    let cancelled = false;
    if (!pid) {
      setMapHistory([]);
      setSavedMapId(null);
      return () => { cancelled = true; };
    }
    getMapHistory(pid).then(history => {
      if (!cancelled) setMapHistory(history ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [pid]);

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

  async function saveNamedMap() {
    if (!pid || layers.length === 0) return;
    const name = window.prompt("Map name:", `Map ${mapHistory.length + 1}`);
    if (!name) return;
    const now = Date.now();
    const entry = { id: now, name, layers, basemap, crsInput, savedAt: now };
    const next = [...mapHistory, entry];
    setMapHistory(next);
    setSavedMapId(entry.id);
    await saveMapHistory(pid, next);
  }

  function loadNamedMap(id) {
    const entry = mapHistory.find(item => item.id === id);
    if (!entry) return;
    setSavedMapId(id);
    setLayers(Array.isArray(entry.layers) ? entry.layers : []);
    setActiveId(null);
    setBasemap(entry.basemap ?? "light");
    if (entry.crsInput?.trim()) void applyCrs(entry.crsInput);
    else clearCrs();
  }

  async function deleteNamedMap() {
    if (savedMapId === null) return;
    const next = mapHistory.filter(entry => entry.id !== savedMapId);
    setMapHistory(next);
    setSavedMapId(null);
    if (pid) await saveMapHistory(pid, next);
  }

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

  function saveGeneratedGrid() {
    if (!saveName || !generatedGrid?.cells?.length) return;
    const gridLayer = layers.find(l =>
      l.type === "grid" && l.cellsize > 0 && (
        (l.mode === "generate" && l.boundaryCol) ||
        (l.mode === "latlon" && l.latCol && l.lonCol)
      )
    );
    if (!gridLayer) return;

    const gridDsId = crypto.randomUUID();
    appendLog({
      module: "spatial",
      opType: "grid_create_map",
      datasetId: gridDsId,
      params: {
        gridDsId,
        gridName: saveName,
        sourceDatasetId: !gridLayer.datasetId || gridLayer.datasetId === "active" ? pid : gridLayer.datasetId,
        mode: gridLayer.mode,
        boundaryCol: gridLayer.boundaryCol || null,
        latCol: gridLayer.latCol || null,
        lonCol: gridLayer.lonCol || null,
        cellSize: Number(gridLayer.cellsize),
        clipBorder: gridLayer.clipBorder !== false,
        wktCol: "geometry",
        gridIdCol: "grid_id",
        metricCrs: "EPSG:32721",
        cellCount: generatedGrid.cells.length,
      },
      label: `Create map grid ${saveName} (${generatedGrid.cells.length.toLocaleString()} cells)`,
    });
    onAddDataset?.(saveName, generatedGrid.cells, [
      "grid_id", "geometry", "metric_geometry", "centroid_lon", "centroid_lat",
      "centroid_x", "centroid_y", "area_m2", "cellsize_m", "metric_crs",
    ], { id: gridDsId });
  }

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

          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {pid && (
              <button onClick={saveNamedMap} disabled={layers.length === 0}
                style={{ padding: "3px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                  background: `${C.teal}12`, border: `1px solid ${C.teal}40`,
                  color: layers.length > 0 ? C.teal : C.border, cursor: layers.length > 0 ? "pointer" : "not-allowed" }}>
                Save map
              </button>
            )}
            {mapHistory.length > 0 && (
              <div style={{ display: "flex", gap: 4 }}>
                <select value={savedMapId ?? ""} onChange={event => loadNamedMap(Number(event.target.value))}
                  style={{ flex: 1, minWidth: 0, padding: "3px 5px", background: C.bg, border: `1px solid ${C.border2}`,
                    borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize }}>
                  <option value="">Saved maps...</option>
                  {mapHistory.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
                <button onClick={deleteNamedMap} disabled={savedMapId === null} title="Delete selected saved map"
                  style={{ padding: "3px 7px", borderRadius: 3, background: "none", border: `1px solid ${C.border2}`,
                    color: savedMapId === null ? C.border : C.textMuted, fontFamily: T.code.fontFamily,
                    fontSize: T.caption.fontSize, cursor: savedMapId === null ? "not-allowed" : "pointer" }}>
                  Delete
                </button>
              </div>
            )}
          </div>
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
                    onClick={saveGeneratedGrid}
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
