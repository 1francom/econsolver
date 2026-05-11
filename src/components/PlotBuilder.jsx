// ─── ECON STUDIO · src/components/PlotBuilder.jsx ────────────────────────────
// G1: layer-based plot builder (layer list, geom picker, aesthetic mappings)
// G2: basic geoms — point, line, bar, histogram, density
// G3: smooth, boxplot, errorbar, ribbon
// G6: hline, vline reference lines
// G7: palette presets
// G8: labels panel — title, x/y axis
// G9: SVG/PNG export via PlotExportBar
// G10.1–4: separate-canvas layers, per-layer opacity, in-app styles, comparison
//
// Rendering: Observable Plot 0.6 via CDN (MIT, ggplot-grammar, no bundle cost)
//
// Props:
//   headers       string[]   — column names for aesthetic dropdowns
//   rows          object[]   — data rows (pipeline output)
//   style         object     — optional container style overrides
//   initialLayers array      — optional pre-seeded layers (G10 template mode)

import { useState, useEffect, useRef, useCallback } from "react";
import { useTheme, mono } from "./modeling/shared.jsx";
import PlotExportBar from "./shared/PlotExportBar.jsx";

// ─── OBSERVABLE PLOT — CACHED CDN SINGLETON ───────────────────────────────────
let _plt = null;
let _pltPromise = null;
function loadPlot() {
  if (_plt) return Promise.resolve(_plt);
  if (_pltPromise) return _pltPromise;
  _pltPromise = import("https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm")
    .then(m => { _plt = m; _pltPromise = null; return m; })
    .catch(e => { _pltPromise = null; throw e; });
  return _pltPromise;
}

// ─── LEAFLET — CACHED CDN SINGLETON ──────────────────────────────────────────
let _leafletPromise = null;
function loadLeaflet() {
  if (typeof window !== "undefined" && window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;
  _leafletPromise = new Promise((resolve, reject) => {
    // Inject Leaflet CSS once
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => { _leafletPromise = null; resolve(window.L); };
    script.onerror = () => { _leafletPromise = null; reject(new Error("Leaflet load failed")); };
    document.head.appendChild(script);
  });
  return _leafletPromise;
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const GEOMS = [
  { id: "point",     label: "Point"     },
  { id: "line",      label: "Line"      },
  { id: "bar",       label: "Bar"       },
  { id: "histogram", label: "Histogram" },
  { id: "density",   label: "Density"   },
  { id: "smooth",    label: "Smooth"    },
  { id: "boxplot",   label: "Boxplot"   },
  { id: "errorbar",  label: "Errorbar"  },
  { id: "ribbon",    label: "Ribbon"    },
  { id: "hline",     label: "H-Line"    },
  { id: "vline",     label: "V-Line"    },
];

const PALETTE_PRESETS = [
  { id: "",             label: "Manual"      },
  { id: "tableau10",    label: "Tableau"     },
  { id: "observable10", label: "Observable"  },
  { id: "dark2",        label: "Dark2"       },
  { id: "set1",         label: "Set1"        },
  { id: "set2",         label: "Set2"        },
  { id: "paired",       label: "Paired"      },
  { id: "accent",       label: "Accent"      },
];



const POSITION_OPTIONS = {
  bar:   ["identity", "stack"],
  point: ["identity", "jitter"],
};

function genId() { return "ly_" + Math.random().toString(36).slice(2, 8); }

const DEFAULT_FILLS = ["#6ec8b4","#c8a96e","#6e9ec8","#c47070","#a87ec8","#7ab896","#c88e6e"];
function mkLayer(geom, idx) {
  return {
    id:       genId(),
    geom,
    aes:      { x: "", y: "", color: "", yMin: "", yMax: "" },
    value:    "",
    position: "identity",
    fill:     DEFAULT_FILLS[idx % DEFAULT_FILLS.length],
    visible:  true,
    opacity:  1.0,   // G10.2 — per-layer alpha (0–1)
    pinned:   false, // G10.4 — included in comparison view
  };
}

// ─── BUILD MARKS FOR A SINGLE LAYER ──────────────────────────────────────────
// Returns an array of Observable Plot marks for one layer.
// opacity is applied to every fillOpacity/strokeOpacity.
function buildMarksForLayer(Plt, ly, rows, showSE = true) {
  const marks = [];
  const { geom, aes, fill, opacity = 1 } = ly;
  const op  = Math.max(0, Math.min(1, opacity));
  const colorVal = aes.color || fill;

  switch (geom) {
    case "point":
      if (aes.x && aes.y) {
        if (ly.position === "jitter") {
          marks.push(Plt.dot(rows, Plt.dodgeX("middle", {
            x: aes.x, y: aes.y, fill: colorVal, r: 3,
            fillOpacity: 0.78 * op, padding: 1,
          })));
        } else {
          marks.push(Plt.dot(rows, {
            x: aes.x, y: aes.y, fill: colorVal, r: 3, fillOpacity: 0.78 * op,
          }));
        }
      }
      break;

    case "line":
      if (aes.x && aes.y)
        marks.push(Plt.line(rows, {
          x: aes.x, y: aes.y, stroke: colorVal, strokeWidth: 1.8, strokeOpacity: op,
        }));
      break;

    case "bar":
      if (aes.x && aes.y) {
        if (ly.position === "stack") {
          marks.push(Plt.barY(rows, Plt.stackY({ x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op })));
        } else {
          marks.push(Plt.barY(rows, { x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op }));
        }
      }
      break;

    case "histogram":
      if (aes.x)
        marks.push(Plt.rectY(rows, Plt.binX({ y: "count" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.85 * op,
        })));
      break;

    case "density":
      if (aes.x) {
        marks.push(Plt.areaY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.22 * op,
        })));
        marks.push(Plt.lineY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, stroke: colorVal, strokeWidth: 1.8, strokeOpacity: op,
        })));
      }
      break;

    case "smooth":
      if (aes.x && aes.y)
        marks.push(Plt.linearRegressionY(rows, {
          x: aes.x, y: aes.y,
          stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.88 * op,
          fill: colorVal, fillOpacity: showSE ? 0.15 * op : 0,
          ci: showSE ? 0.95 : 0,
        }));
      break;

    case "boxplot":
      if (aes.y)
        marks.push(Plt.boxY(rows, {
          x: aes.x || undefined, y: aes.y, fill: colorVal, fillOpacity: 0.68 * op,
        }));
      break;

    case "errorbar":
      if (aes.x && aes.yMin && aes.yMax) {
        marks.push(Plt.ruleX(rows, {
          x: aes.x, y1: aes.yMin, y2: aes.yMax,
          stroke: colorVal, strokeWidth: 1.5, strokeOpacity: op,
        }));
        marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMin, stroke: colorVal, strokeOpacity: op }));
        marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMax, stroke: colorVal, strokeOpacity: op }));
      }
      break;

    case "ribbon":
      if (aes.x && aes.yMin && aes.yMax)
        marks.push(Plt.areaY(rows, {
          x: aes.x, y1: aes.yMin, y2: aes.yMax, fill: colorVal, fillOpacity: 0.28 * op,
        }));
      break;

    case "hline": {
      const hv = parseFloat(ly.value);
      if (!isNaN(hv))
        marks.push(Plt.ruleY([hv], {
          stroke: colorVal, strokeDasharray: "5 3", strokeOpacity: 0.88 * op, strokeWidth: 1.5,
        }));
      break;
    }

    case "vline": {
      const vv = parseFloat(ly.value);
      if (!isNaN(vv))
        marks.push(Plt.ruleX([vv], {
          stroke: colorVal, strokeDasharray: "5 3", strokeOpacity: 0.88 * op, strokeWidth: 1.5,
        }));
      break;
    }

    case "map":
      // Map layers render via MapCanvas, not Observable Plot — skip here
      break;
  }

  return marks;
}

// ─── PATCH DARK THEME ─────────────────────────────────────────────────────────
function patchDarkTheme(el) {
  el.querySelectorAll("line[stroke='black'], line[stroke='#000']").forEach(l => {
    l.setAttribute("stroke", "#252525");
  });
}

// ─── PLOT CANVAS — renders one or more layers on a single Observable Plot ─────
// layers: array of layer objects (for overlay/comparison) OR single-element array
function PlotCanvas({ layers, rows, xLabel, yLabel, width, height, scheme, canvasRef, showSE = true }) {
  const { C } = useTheme();
  const ownRef = useRef(null);
  const ref    = canvasRef ?? ownRef;
  const [Plt, setPlt] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    loadPlot().then(setPlt).catch(() => setErr("Could not load Observable Plot. Check internet connection."));
  }, []);

  useEffect(() => {
    if (!Plt || !ref.current) return;
    const container = ref.current;
    try {
      const marks = [];
      for (const ly of layers) {
        if (!ly.visible) continue;
        marks.push(...buildMarksForLayer(Plt, ly, rows, showSE));
      }
      // Grid + frame always present — subtle lines on any background
      marks.push(Plt.gridX({ stroke: "#808080", strokeOpacity: 0.18 }));
      marks.push(Plt.gridY({ stroke: "#808080", strokeOpacity: 0.18 }));
      marks.push(Plt.frame({ stroke: "#252525" }));

      // Auto-detect ISO date x-axis for smart tick intervals
      const xAesCol = layers.find(ly => ly.visible && ly.aes?.x)?.aes.x;
      const firstXVal = xAesCol ? rows.find(r => r[xAesCol] != null)?.[xAesCol] : null;
      const xIsDate = firstXVal != null && /^\d{4}-\d{2}-\d{2}/.test(String(firstXVal));

      const colorOpts = scheme ? { scheme } : {};
      const el = Plt.plot({
        width:        width || 580,
        height:       height || 310,
        marginLeft:   52,
        marginBottom: xIsDate ? 52 : 40,
        marginTop:    24,
        style: {
          background: "transparent",
          color:      C.text,
          fontFamily: mono,
          fontSize:   "10px",
          overflow:   "visible",
        },
        x: {
          label:       xLabel || null,
          labelOffset: xIsDate ? 46 : 34,
          ...(xIsDate ? { type: "utc" } : { ticks: Math.min(10, Math.floor((width || 580) / 70)) }),
        },
        y: { label: yLabel || null, labelOffset: 40 },
        color: colorOpts,
        marks,
      });
      patchDarkTheme(el);
      container.innerHTML = "";
      container.appendChild(el);
    } catch (e) {
      container.innerHTML = `<div style="color:${C.red};font-family:${mono};font-size:11px;padding:1rem">Plot error: ${e.message}</div>`;
    }
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [Plt, layers, rows, xLabel, yLabel, width, scheme]);

  if (err) return <div style={{ color: C.red, fontFamily: mono, fontSize: 11, padding: "1.5rem" }}>{err}</div>;
  if (!Plt) return <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "1.5rem" }}>Loading Observable Plot…</div>;
  return <div ref={ref} style={{ width: "100%", overflow: "visible" }} />;
}

// ─── MAP CANVAS — Leaflet + OSM tile underlay ─────────────────────────────────
// Does NOT accept width/height from parent — owns its own ResizeObserver to
// avoid the feedback loop: Leaflet fills container → parent ResizeObserver fires
// → canvasH grows → Leaflet grows → repeat.
function MapCanvas({ layer, rows }) {
  const { C } = useTheme();
  const wrapRef     = useRef(null);  // fixed-size wrapper — ResizeObserver target
  const mapDivRef   = useRef(null);  // inner div Leaflet mounts into
  const leafMapRef  = useRef(null);
  const [L,   setL]   = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    loadLeaflet().then(setL).catch(() => setErr("Could not load Leaflet. Check internet connection."));
  }, []);

  // Watch the wrapper (not the Leaflet div) and invalidate — safe because
  // wrapRef has CSS height: 100% of a fixed-height parent, not of the map itself.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      if (leafMapRef.current) leafMapRef.current.invalidateSize();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!L || !mapDivRef.current) return;
    const { aes, fill, opacity = 1 } = layer;
    const lonCol = aes.x;
    const latCol = aes.y;
    if (!lonCol || !latCol) return;

    // Destroy previous map instance
    if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; }

    const validRows = rows.filter(r => {
      const lat = parseFloat(r[latCol]);
      const lon = parseFloat(r[lonCol]);
      return !isNaN(lat) && !isNaN(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
    });
    if (validRows.length === 0) return;

    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true });
    leafMapRef.current = map;

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      maxZoom: 19,
    }).addTo(map);

    // Color scale
    const colorCol = aes.color;
    let getColor;
    if (colorCol) {
      const vals = validRows.map(r => r[colorCol]);
      const isNum = vals.every(v => v !== "" && v !== null && !isNaN(parseFloat(v)));
      if (isNum) {
        const nums = vals.map(Number);
        const mn = Math.min(...nums), mx = Math.max(...nums), rng = mx - mn || 1;
        // teal (#6ec8b4) → gold (#c8a96e) gradient
        getColor = row => {
          const t = (Number(row[colorCol]) - mn) / rng;
          const r = Math.round(110 + t * (200 - 110));
          const g = Math.round(200 - t * (200 - 169));
          const b = Math.round(180 - t * (180 - 110));
          return `rgb(${r},${g},${b})`;
        };
      } else {
        const cats = [...new Set(vals)];
        const pal  = ["#6ec8b4","#c8a96e","#6e9ec8","#c47070","#a87ec8","#7ab896","#c88e6e"];
        const cmap = Object.fromEntries(cats.map((c, i) => [c, pal[i % pal.length]]));
        getColor = row => cmap[row[colorCol]] ?? fill;
      }
    } else {
      getColor = () => fill;
    }

    const esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    const markers = [];
    for (const row of validRows) {
      const lat = parseFloat(row[latCol]);
      const lon = parseFloat(row[lonCol]);
      const color = getColor(row);
      const m = L.circleMarker([lat, lon], {
        radius: 5, fillColor: color, color: color,
        weight: 1, opacity, fillOpacity: 0.78 * opacity,
      });
      const tipParts = [`${esc(latCol)}: ${lat.toFixed(4)}`, `${esc(lonCol)}: ${lon.toFixed(4)}`];
      if (colorCol) tipParts.push(`${esc(colorCol)}: ${esc(row[colorCol])}`);
      m.bindTooltip(tipParts.join("<br>"));
      markers.push(m);
    }
    const group = L.featureGroup(markers).addTo(map);
    try { map.fitBounds(group.getBounds().pad(0.08)); } catch (_) { map.setView([0, 0], 2); }

    return () => { if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; } };
  }, [L, layer, rows]);

  if (err) return <div style={{ color: "#c47070", fontFamily: mono, fontSize: 11, padding: "1.5rem" }}>{err}</div>;
  if (!L)  return <div style={{ color: "#666", fontFamily: mono, fontSize: 10, padding: "1.5rem" }}>Loading Leaflet…</div>;
  const { aes } = layer;
  if (!aes.x || !aes.y) return (
    <div style={{ fontFamily: mono, fontSize: 10, color: "#666", padding: "2rem", textAlign: "center" }}>
      Set <b>lon</b> (x) and <b>lat</b> (y) columns to render the map.
    </div>
  );
  // wrapRef is the ResizeObserver target — fixed height so Leaflet cannot push the
  // parent panel taller and trigger a resize loop.
  return (
    <div ref={wrapRef} style={{ width: "100%", height: "100%", minHeight: 420, position: "relative" }}>
      <div ref={mapDivRef} style={{ position: "absolute", inset: 0, borderRadius: 3 }} />
    </div>
  );
}

// ─── LAYER TAB (compact horizontal pill) ─────────────────────────────────────
function LayerTab({ layer, isActive, onSelect, onToggle, onRemove }) {
  const { C } = useTheme();
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "4px 8px 4px 6px", borderRadius: 3, flexShrink: 0,
        background: isActive ? `${C.teal}15` : C.bg,
        border: `1px solid ${isActive ? C.teal + "55" : C.border}`,
        cursor: "pointer", transition: "border-color 0.12s",
      }}
    >
      <div style={{ width: 7, height: 7, borderRadius: "50%", background: layer.fill, flexShrink: 0 }} />
      <span style={{ fontFamily: mono, fontSize: 10, color: isActive ? C.teal : C.textDim, whiteSpace: "nowrap" }}>
        {layer.geom}{layer.aes?.x ? ` · ${layer.aes.x}` : ""}
        {layer.opacity < 0.99 ? ` ${Math.round(layer.opacity*100)}%` : ""}
      </span>
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        title={layer.visible ? "Hide" : "Show"}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, padding: "0 1px", color: layer.visible ? C.textDim : C.textMuted, lineHeight: 1 }}>
        {layer.visible ? "●" : "○"}
      </button>
      <button onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remove"
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 1px", color: C.textMuted, lineHeight: 1 }}>×</button>
    </div>
  );
}

// ─── INLINE LAYER EDITOR (horizontal compact row) ─────────────────────────────
function LayerEditorInline({ layer, onChange, headers }) {
  const { C } = useTheme();
  const isMap        = layer.geom === "map";
  const isRefLine    = ["hline", "vline"].includes(layer.geom);
  const needsYMinMax = ["errorbar", "ribbon"].includes(layer.geom);
  const noY          = ["histogram", "density", "hline", "vline"].includes(layer.geom);
  const noX          = ["hline", "vline"].includes(layer.geom);

  const selStyle = active => ({
    background: C.bg, border: `1px solid ${active ? C.border2 : C.border}`,
    borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px",
    color: active ? C.text : C.textMuted, minWidth: 90, maxWidth: 140,
  });
  const sep = <div style={{ width: 1, height: 18, background: C.border, flexShrink: 0, alignSelf: "center" }} />;

  return (
    <div style={{
      display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5,
      padding: "0.45rem 0.75rem", borderBottom: `1px solid ${C.border}`,
      background: `${C.teal}07`,
    }}>
      {/* Geom chips */}
      <span style={{ fontSize: 8, color: C.textMuted, fontFamily: mono, letterSpacing: "0.15em", textTransform: "uppercase" }}>geom</span>
      {GEOMS.map(g => (
        <button key={g.id} onClick={() => onChange({ ...layer, geom: g.id })}
          style={{
            padding: "2px 6px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
            background: layer.geom === g.id ? `${C.teal}20` : "transparent",
            border: `1px solid ${layer.geom === g.id ? C.teal + "65" : C.border}`,
            color: layer.geom === g.id ? C.teal : C.textMuted,
          }}>{g.label}</button>
      ))}

      {sep}

      {/* Aesthetics */}
      {isRefLine && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>value</span>
        <input type="number" value={layer.value ?? ""} placeholder="0"
          onChange={e => onChange({ ...layer, value: e.target.value })}
          style={{ ...selStyle(!!layer.value), width: 60 }} />
      </>}
      {!noX && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>{isMap ? "lon" : "x"}</span>
        <select value={layer.aes.x} onChange={e => onChange({ ...layer, aes: { ...layer.aes, x: e.target.value } })} style={selStyle(!!layer.aes.x)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {!noY && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>{isMap ? "lat" : "y"}</span>
        <select value={layer.aes.y} onChange={e => onChange({ ...layer, aes: { ...layer.aes, y: e.target.value } })} style={selStyle(!!layer.aes.y)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {needsYMinMax && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>yMin</span>
        <select value={layer.aes.yMin ?? ""} onChange={e => onChange({ ...layer, aes: { ...layer.aes, yMin: e.target.value } })} style={selStyle(!!layer.aes.yMin)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>yMax</span>
        <select value={layer.aes.yMax ?? ""} onChange={e => onChange({ ...layer, aes: { ...layer.aes, yMax: e.target.value } })} style={selStyle(!!layer.aes.yMax)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {!isRefLine && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>color</span>
        <select value={layer.aes.color} onChange={e => onChange({ ...layer, aes: { ...layer.aes, color: e.target.value } })} style={selStyle(!!layer.aes.color)}>
          <option value="">— none —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}

      {sep}

      {/* Fill color */}
      {!layer.aes?.color && <>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>fill</span>
        <input type="color" value={layer.fill} onChange={e => onChange({ ...layer, fill: e.target.value })}
          style={{ width: 24, height: 20, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
      </>}

      {/* Position */}
      {POSITION_OPTIONS[layer.geom] && <>
        {sep}
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>pos</span>
        {POSITION_OPTIONS[layer.geom].map(pos => (
          <button key={pos} onClick={() => onChange({ ...layer, position: pos })}
            style={{
              padding: "2px 6px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: layer.position === pos ? `${C.gold}18` : "transparent",
              border: `1px solid ${layer.position === pos ? C.gold + "65" : C.border}`,
              color: layer.position === pos ? C.gold : C.textMuted,
            }}>{pos}</button>
        ))}
      </>}

      {/* Opacity — right-aligned */}
      <div style={{ display: "flex", alignItems: "center", gap: 5, marginLeft: "auto" }}>
        <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>α</span>
        <input type="range" min={0} max={1} step={0.05} value={layer.opacity ?? 1}
          onChange={e => onChange({ ...layer, opacity: +e.target.value })}
          style={{ width: 64, accentColor: C.teal, cursor: "pointer" }} />
        <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, width: 26, textAlign: "right", flexShrink: 0 }}>
          {Math.round((layer.opacity ?? 1) * 100)}%
        </span>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [] }) {
  const { C } = useTheme();
  const [layers,   setLayers]   = useState(initialLayers);
  const [activeId, setActiveId] = useState(initialLayers[0]?.id ?? null);
  const [title,    setTitle]    = useState("");
  const [xLabel,   setXLabel]   = useState("");
  const [yLabel,   setYLabel]   = useState("");
  const [scheme,   setScheme]   = useState("");
  const [showSE,   setShowSE]   = useState(true);
  const canvasRef  = useRef(null);
  const plotRef    = useRef(null);
  const [canvasW,  setCanvasW]  = useState(760);
  const [canvasH,  setCanvasH]  = useState(400);

  // Measure the plot area for responsive canvas sizing
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const { width, height } = entries[0]?.contentRect ?? {};
      if (width)  setCanvasW(Math.max(300, Math.round(width)  - 20));
      if (height) setCanvasH(Math.max(220, Math.round(height) - 20));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const addLayer = useCallback((geom) => {
    setLayers(prev => {
      const ly = mkLayer(geom, prev.length);
      setActiveId(ly.id);
      return [...prev, ly];
    });
  }, []);

  const updateLayer = useCallback(updated =>
    setLayers(prev => prev.map(l => l.id === updated.id ? updated : l)), []);

  const removeLayer = useCallback(id => {
    setLayers(prev => {
      const next = prev.filter(l => l.id !== id);
      setActiveId(a => a === id ? (next[next.length - 1]?.id ?? null) : a);
      return next;
    });
  }, []);

  const activeLayer    = layers.find(l => l.id === activeId) ?? null;
  const visibleLayers  = layers.filter(l => l.visible);
  const hasSmooth      = visibleLayers.some(l => l.geom === "smooth");
  const hasMap         = visibleLayers.some(l => l.geom === "map");
  const mapLayer       = visibleLayers.find(l => l.geom === "map");

  return (
    <div style={{
      display: "flex", flexDirection: "column", background: C.surface,
      border: `1px solid ${C.border}`, borderRadius: 4, overflow: "hidden",
      minHeight: 480, ...style,
    }}>

      {/* ── TOP: controls ─────────────────────────────────────────────────── */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${C.border}` }}>

        {/* Row 1: layer tabs + add-layer chips */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 5,
          padding: "0.45rem 0.75rem", borderBottom: `1px solid ${C.border}`,
          background: C.surface,
        }}>
          {layers.length === 0 && (
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, marginRight: 4 }}>No layers —</span>
          )}
          {layers.map(ly => (
            <LayerTab
              key={ly.id}
              layer={ly}
              isActive={ly.id === activeId}
              onSelect={() => setActiveId(ly.id)}
              onToggle={() => updateLayer({ ...ly, visible: !ly.visible })}
              onRemove={() => removeLayer(ly.id)}
            />
          ))}
          {/* Divider when layers exist */}
          {layers.length > 0 && (
            <div style={{ width: 1, height: 16, background: C.border, alignSelf: "center", margin: "0 2px" }} />
          )}
          {/* Add-layer chips */}
          {GEOMS.map(g => (
            <button key={g.id} onClick={() => addLayer(g.id)}
              title={`Add ${g.label} layer`}
              style={{
                padding: "3px 7px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                background: "none", border: `1px dashed ${C.border2}`,
                color: C.textMuted, cursor: "pointer", flexShrink: 0,
              }}>+{g.label}</button>
          ))}
        </div>

        {/* Row 2: inline editor for active layer */}
        {activeLayer && (
          <LayerEditorInline layer={activeLayer} onChange={updateLayer} headers={headers} />
        )}

        {/* Row 3: toolbar — labels, palette, SE, export */}
        <div style={{
          display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8,
          padding: "0.38rem 0.75rem", background: C.surface,
        }}>
          {[
            { lbl: "Title",  val: title,  set: setTitle,  w: 120 },
            { lbl: "X axis", val: xLabel, set: setXLabel, w: 80  },
            { lbl: "Y axis", val: yLabel, set: setYLabel, w: 80  },
          ].map(({ lbl, val, set, w }) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>{lbl}</span>
              <input value={val} onChange={e => set(e.target.value)} placeholder={lbl.toLowerCase()}
                style={{
                  width: w, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                  fontFamily: mono, fontSize: 9, padding: "3px 5px", color: C.text, outline: "none",
                }} />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>Style</span>
            <select value={scheme} onChange={e => setScheme(e.target.value)}
              style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                fontFamily: mono, fontSize: 9, padding: "3px 5px",
                color: scheme ? C.text : C.textMuted,
              }}>
              {PALETTE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          {hasSmooth && (
            <button onClick={() => setShowSE(v => !v)}
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                cursor: "pointer", border: `1px solid ${C.border2}`,
                background: showSE ? `${C.teal}18` : "transparent",
                color: showSE ? C.teal : C.textMuted, transition: "all 0.12s",
              }}>SE {showSE ? "TRUE" : "FALSE"}</button>
          )}

          {visibleLayers.length > 0 && (
            <div style={{ marginLeft: "auto" }}>
              <PlotExportBar
                getEl={() => canvasRef.current}
                filename={title || "plot"}
                style={{ border: "none", padding: 0, background: "transparent", borderTop: "none" }}
              />
            </div>
          )}
        </div>
      </div>

      {/* ── BOTTOM: plot — all visible layers composited ────────────────────── */}
      <div ref={plotRef} style={{ flex: 1, padding: "0.65rem", overflow: "hidden", minHeight: 220 }}>
        {visibleLayers.length === 0 ? (
          <div style={{
            height: "100%", minHeight: 180, display: "flex", alignItems: "center",
            justifyContent: "center", flexDirection: "column", gap: 8,
            color: C.textMuted, fontFamily: mono, fontSize: 10, textAlign: "center",
          }}>
            Add a layer above, then pick x / y columns — all visible layers compose on one canvas.
          </div>
        ) : hasMap ? (
          <div style={{ height: Math.max(280, canvasH) }}>
            <MapCanvas layer={mapLayer} rows={rows} />
          </div>
        ) : (
          <div ref={canvasRef}>
            <PlotCanvas
              layers={visibleLayers}
              rows={rows}
              xLabel={xLabel}
              yLabel={yLabel}
              width={canvasW}
              height={canvasH}
              scheme={scheme}
              showSE={showSE}
            />
          </div>
        )}
      </div>
    </div>
  );
}
