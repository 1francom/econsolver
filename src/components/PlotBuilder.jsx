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
import { getPlotHistory, savePlotHistory } from "../services/Persistence/plotHistory.js";

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

// Per-geom defaults for the opts panel (ui-basic params per ggplot2-plot-design skill)
const GEOM_OPTS_DEFAULTS = {
  point:     { size: 3,   shape: "circle" },
  line:      { strokeWidth: 1.8, dash: "none" },
  smooth:    { method: "lm", showSE: true, ci: 0.95, span: 0.75 },
  boxplot:   { outlierShow: true, outlierSize: 3 },
  histogram: { bins: 20 },
  density:   { adjust: 1.0 },
  bar:       { strokeWidth: 0 },
  errorbar:  { strokeWidth: 1.5 },
};

function mkLayer(geom, idx) {
  return {
    id:       genId(),
    geom,
    aes:      { x: "", y: "", color: "", yMin: "", yMax: "", sizeCol: "", alphaCol: "" },
    value:    "",
    position: "identity",
    fill:     DEFAULT_FILLS[idx % DEFAULT_FILLS.length],
    visible:  true,
    opacity:  1.0,
    pinned:   false,
    opts:     { ...(GEOM_OPTS_DEFAULTS[geom] || {}) },
  };
}

// ─── LOESS SMOOTHER ───────────────────────────────────────────────────────────
// Local polynomial (degree 1) smoother with tricube kernel, O(n·k).
// Returns [{x, y}] sorted by x, evaluated at min(n,120) equally-spaced points.
function loessSmooth(pairs, span = 0.75) {
  if (pairs.length < 2) return pairs;
  const n = pairs.length;
  const k = Math.max(4, Math.round(span * n));
  const xMin = pairs[0].x, xMax = pairs[n - 1].x;
  const steps = Math.min(n, 120);
  const xs = Array.from({ length: steps }, (_, i) => xMin + (i / (steps - 1)) * (xMax - xMin));
  return xs.map(x0 => {
    const dists = pairs.map((p, j) => ({ j, d: Math.abs(p.x - x0) }));
    dists.sort((a, b) => a.d - b.d);
    const nbrs = dists.slice(0, k);
    const maxD = nbrs[nbrs.length - 1].d || 1;
    const pts = nbrs.map(({ j, d }) => {
      const u = d / maxD;
      const w = Math.pow(1 - Math.pow(u, 3), 3);
      return { x: pairs[j].x, y: pairs[j].y, w };
    });
    const sw = pts.reduce((s, p) => s + p.w, 0);
    const swx = pts.reduce((s, p) => s + p.w * p.x, 0);
    const swy = pts.reduce((s, p) => s + p.w * p.y, 0);
    const swxx = pts.reduce((s, p) => s + p.w * p.x * p.x, 0);
    const swxy = pts.reduce((s, p) => s + p.w * p.x * p.y, 0);
    const det = sw * swxx - swx * swx;
    if (Math.abs(det) < 1e-10) return { x: x0, y: sw > 0 ? swy / sw : 0 };
    const b = (sw * swxy - swx * swy) / det;
    const a = (swy - b * swx) / sw;
    return { x: x0, y: a + b * x0 };
  });
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
    case "point": {
      if (aes.x && aes.y) {
        const { size = 3, shape = "circle" } = ly.opts || {};
        // aes.sizeCol → variable mapping (ggplot aes(size=col)); else fixed opts.size
        const rOpt  = aes.sizeCol  ? { r: aes.sizeCol }  : { r: size };
        const sym   = shape !== "circle" ? { symbol: shape } : {};
        const dotO  = { x: aes.x, y: aes.y, fill: colorVal, ...rOpt, ...sym, fillOpacity: 0.78 * op };
        if (ly.position === "jitter") {
          marks.push(Plt.dot(rows, Plt.dodgeX("middle", { ...dotO, padding: 1 })));
        } else {
          marks.push(Plt.dot(rows, dotO));
        }
      }
      break;
    }

    case "line": {
      if (aes.x && aes.y) {
        const { strokeWidth = 1.8, dash = "none" } = ly.opts || {};
        marks.push(Plt.line(rows, {
          x: aes.x, y: aes.y, stroke: colorVal, strokeWidth, strokeOpacity: op,
          ...(dash !== "none" ? { strokeDasharray: dash } : {}),
        }));
      }
      break;
    }

    case "bar": {
      if (aes.x && aes.y) {
        const { strokeWidth: bsW = 0 } = ly.opts || {};
        const barExtra = bsW > 0 ? { stroke: colorVal, strokeWidth: bsW } : {};
        if (ly.position === "stack") {
          marks.push(Plt.barY(rows, Plt.stackY({ x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op, ...barExtra })));
        } else {
          marks.push(Plt.barY(rows, { x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op, ...barExtra }));
        }
      }
      break;
    }

    case "histogram": {
      if (aes.x) {
        const { bins = 20 } = ly.opts || {};
        marks.push(Plt.rectY(rows, Plt.binX({ y: "count" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.85 * op, thresholds: bins,
        })));
      }
      break;
    }

    case "density": {
      if (aes.x) {
        const { adjust = 1.0 } = ly.opts || {};
        marks.push(Plt.areaY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.22 * op, thresholds: Math.round(40 * adjust),
        })));
        marks.push(Plt.lineY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, stroke: colorVal, strokeWidth: 1.8, strokeOpacity: op, thresholds: Math.round(40 * adjust),
        })));
      }
      break;
    }

    case "smooth": {
      if (aes.x && aes.y) {
        const { method = "lm", showSE: se = true, ci = 0.95, span = 0.75 } = ly.opts || {};
        if (method === "lm") {
          marks.push(Plt.linearRegressionY(rows, {
            x: aes.x, y: aes.y,
            stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.88 * op,
            fill: colorVal, fillOpacity: se ? 0.15 * op : 0,
            ci: se ? ci : 0,
          }));
        } else if (method === "loess") {
          const pairs = rows
            .map(r => ({ x: +r[aes.x], y: +r[aes.y] }))
            .filter(p => isFinite(p.x) && isFinite(p.y))
            .sort((a, b) => a.x - b.x);
          if (pairs.length > 1) {
            const smoothed = loessSmooth(pairs, span);
            marks.push(Plt.line(smoothed, {
              x: "x", y: "y",
              stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.88 * op,
              curve: "catmull-rom",
            }));
          }
        } else if (method === "mean") {
          const yVals = rows.map(r => +r[aes.y]).filter(isFinite);
          if (yVals.length) {
            const ymean = yVals.reduce((s, v) => s + v, 0) / yVals.length;
            marks.push(Plt.ruleY([ymean], {
              stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.88 * op,
              strokeDasharray: "6 3",
            }));
          }
        }
      }
      break;
    }

    case "boxplot": {
      if (!aes.y) break;
      const { outlierShow = true, outlierSize = 3 } = ly.opts || {};
      const bOpts = { r: outlierShow ? outlierSize / 2 : 0 };
      const isGrouped = aes.color && aes.x && aes.color !== aes.x;
      if (isGrouped) {
        marks.push(Plt.boxY(rows, {
          fx: aes.x, x: aes.color, y: aes.y,
          fill: aes.color, fillOpacity: 0.72 * op, ...bOpts,
        }));
      } else {
        marks.push(Plt.boxY(rows, {
          x: aes.x || undefined, y: aes.y, fill: colorVal, fillOpacity: 0.68 * op, ...bOpts,
        }));
      }
      break;
    }

    case "errorbar": {
      if (aes.x && aes.yMin && aes.yMax) {
        const { strokeWidth: ebW = 1.5 } = ly.opts || {};
        marks.push(Plt.ruleX(rows, {
          x: aes.x, y1: aes.yMin, y2: aes.yMax,
          stroke: colorVal, strokeWidth: ebW, strokeOpacity: op,
        }));
        marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMin, stroke: colorVal, strokeWidth: ebW, strokeOpacity: op }));
        marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMax, stroke: colorVal, strokeWidth: ebW, strokeOpacity: op }));
      }
      break;
    }

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
function PlotCanvas({ layers, rows, xLabel, yLabel, title, width, height, scheme, canvasRef, showSE = true,
  xScale = "linear", yScale = "linear",
  xDomain = [null, null], yDomain = [null, null],
  xFmt = "", yFmt = "",
}) {
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
      // Auto-detect ISO date x-axis for smart tick intervals
      const xAesCol = layers.find(ly => ly.visible && ly.aes?.x)?.aes.x;
      const firstXVal = xAesCol ? rows.find(r => r[xAesCol] != null)?.[xAesCol] : null;
      const xIsDate = firstXVal != null && /^\d{4}-\d{2}-\d{2}/.test(String(firstXVal));

      // Build data marks first, then compose full mark stack
      const dataMarks = [];
      for (const ly of layers) {
        if (!ly.visible) continue;
        dataMarks.push(...buildMarksForLayer(Plt, ly, rows, showSE));
      }

      // Compute actual data extents to decide whether zero rules are meaningful
      const xCol = layers.find(ly => ly.visible && ly.aes?.x)?.aes.x;
      const yCol = layers.find(ly => ly.visible && ly.aes?.y)?.aes.y;
      const xVals = xCol ? rows.map(r => +r[xCol]).filter(v => isFinite(v)) : [];
      const yVals = yCol ? rows.map(r => +r[yCol]).filter(v => isFinite(v)) : [];
      const xMin = xVals.length ? Math.min(...xVals) : 0;
      const xMax = xVals.length ? Math.max(...xVals) : 1;
      const yMin = yVals.length ? Math.min(...yVals) : 0;
      const yMax = yVals.length ? Math.max(...yVals) : 1;
      // Only draw zero rule when 0 is within ±20% of the data range (ggplot expand default)
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      const showRuleX = 0 >= xMin - xRange * 0.2 && 0 <= xMax + xRange * 0.2;
      const showRuleY = 0 >= yMin - yRange * 0.2 && 0 <= yMax + yRange * 0.2;

      const zeroStyle = { stroke: "#888", strokeWidth: 1.4, strokeOpacity: 0.55 };
      const marks = [
        // 1. Grid (background, very subtle)
        Plt.gridX({ stroke: "#808080", strokeOpacity: 0.15 }),
        Plt.gridY({ stroke: "#808080", strokeOpacity: 0.15 }),
        // 2. Zero rules — only when 0 is near the data range (avoids scale compression)
        ...(showRuleX ? [Plt.ruleX([0], zeroStyle)] : []),
        ...(showRuleY ? [Plt.ruleY([0], zeroStyle)] : []),
        // 3. Data marks
        ...dataMarks,
        // 4. Frame on top to cleanly border the plot area
        Plt.frame({ stroke: "#333" }),
      ];

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
          nice:        xScale === "linear",
          inset:       8,
          ...(xIsDate ? { type: "utc" }
            : { type: xScale !== "linear" ? xScale : undefined,
                ticks: Math.min(10, Math.floor((width || 580) / 70)) }),
          ...(xDomain[0] != null || xDomain[1] != null
            ? { domain: [xDomain[0] ?? xMin, xDomain[1] ?? xMax] } : {}),
          ...(xFmt ? { tickFormat: xFmt } : {}),
        },
        y: {
          label:       yLabel || null,
          labelOffset: 40,
          nice:        yScale === "linear",
          inset:       8,
          ...(yScale !== "linear" ? { type: yScale } : {}),
          ...(yDomain[0] != null || yDomain[1] != null
            ? { domain: [yDomain[0] ?? yMin, yDomain[1] ?? yMax] } : {}),
          ...(yFmt ? { tickFormat: yFmt } : {}),
        },
        color: colorOpts,
        marks,
      });
      patchDarkTheme(el);
      container.innerHTML = "";
      container.appendChild(el);
    } catch (e) {
      container.innerHTML = `<div style="color:${C.red};font-family:${mono};font-size:11px;padding:1rem">Plot error: ${e.message}</div>`;
    }
    return () => { if (ref.current) ref.current.innerHTML = ""; }; // safe: clearing own container
  }, [Plt, layers, rows, xLabel, yLabel, width, scheme, xScale, yScale, xDomain, yDomain, xFmt, yFmt]);

  if (err) return <div style={{ color: C.red, fontFamily: mono, fontSize: 11, padding: "1.5rem" }}>{err}</div>;
  if (!Plt) return <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "1.5rem" }}>Loading Observable Plot…</div>;
  return (
    <div style={{ width: "100%", overflow: "visible" }}>
      {title && (
        <div style={{
          textAlign: "center", fontFamily: mono, fontSize: 12,
          color: C.text, paddingBottom: 4, fontWeight: 600,
        }}>{title}</div>
      )}
      <div ref={ref} style={{ width: "100%", overflow: "visible" }} />
    </div>
  );
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

// ─── GEOM-SPECIFIC OPTIONS ROW ────────────────────────────────────────────────
// Renders per-geom ui-basic params (ggplot2-plot-design skill classification).
// Variable mapping: aes.sizeCol / aes.alphaCol → ggplot aes(size=col, alpha=col)
function GeomOptsRow({ layer, onChange, headers = [] }) {
  const { C } = useTheme();
  const { geom, opts = {}, aes = {} } = layer;
  const set    = (key, val) => onChange({ ...layer, opts: { ...opts, [key]: val } });
  const setAes = (key, val) => onChange({ ...layer, aes: { ...aes, [key]: val } });

  const chip = (active) => ({
    padding: "2px 6px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
    border: `1px solid ${active ? C.teal + "65" : C.border}`,
    background: active ? `${C.teal}18` : "transparent",
    color: active ? C.teal : C.textMuted,
  });
  const chipGold = (active) => ({
    ...chip(false),
    border: `1px solid ${active ? C.gold + "65" : C.border}`,
    background: active ? `${C.gold}18` : "transparent",
    color: active ? C.gold : C.textMuted,
  });
  const lbl  = (t) => <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono }}>{t}</span>;
  const sep  = <div style={{ width: 1, height: 14, background: C.border, flexShrink: 0, alignSelf: "center" }} />;
  const numW = { width: 26, fontFamily: mono, fontSize: 9, color: C.textDim, flexShrink: 0 };
  const slider = (key, min, max, step, def) => (
    <input type="range" min={min} max={max} step={step} value={opts[key] ?? def}
      onChange={e => set(key, +e.target.value)}
      style={{ width: 60, accentColor: C.teal, cursor: "pointer" }} />
  );

  // shared col select style
  const colSel = (active) => ({
    background: C.bg, border: `1px solid ${active ? C.teal + "65" : C.border}`,
    borderRadius: 3, fontFamily: mono, fontSize: 9, padding: "2px 5px",
    color: active ? C.text : C.textMuted, minWidth: 80, maxWidth: 120,
  });
  // small "var" toggle button
  const varBtn = (isVar) => ({
    padding: "2px 5px", borderRadius: 3, fontFamily: mono, fontSize: 8, cursor: "pointer",
    border: `1px solid ${isVar ? C.gold + "65" : C.border}`,
    background: isVar ? `${C.gold}18` : "transparent",
    color: isVar ? C.gold : C.textMuted,
    title: isVar ? "Switch to fixed value" : "Map to variable",
  });

  if (geom === "point") {
    const sizeIsVar = !!aes.sizeCol;
    return <>
      {lbl("size")}
      {sizeIsVar
        ? <select value={aes.sizeCol} onChange={e => setAes("sizeCol", e.target.value)} style={colSel(true)}>
            <option value="">— col —</option>
            {headers.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        : <>{slider("size", 1, 12, 0.5, 3)}<span style={numW}>{opts.size ?? 3}</span></>
      }
      <button onClick={() => { setAes("sizeCol", sizeIsVar ? "" : (headers[0] || "")); }} style={varBtn(sizeIsVar)}>var</button>
      {sep}
      {lbl("shape")}
      {[["circle","○"],["square","□"],["triangle","△"],["diamond","◇"],["star","✦"],["times","×"]].map(([v,ic]) => (
        <button key={v} onClick={() => set("shape", v)} style={chip((opts.shape ?? "circle") === v)}>{ic}</button>
      ))}
    </>;
  }

  if (geom === "line") return <>
    {lbl("width")}
    {slider("strokeWidth", 0.5, 6, 0.5, 1.8)}
    <span style={numW}>{opts.strokeWidth ?? 1.8}</span>
    {lbl("dash")}
    {[["none","———"],["5,3","– – –"],["2,2","·····"]].map(([v,ic]) => (
      <button key={v} onClick={() => set("dash", v)} style={chip((opts.dash ?? "none") === v)}>{ic}</button>
    ))}
  </>;

  if (geom === "smooth") return <>
    {lbl("method")}
    {[["lm","lm"],["loess","loess"],["mean","mean"]].map(([v,l]) => (
      <button key={v} onClick={() => set("method", v)} style={chipGold((opts.method ?? "lm") === v)}>{l}</button>
    ))}
    {(opts.method ?? "lm") === "loess" && <>
      {lbl("span")}
      <input type="range" min={0.1} max={1} step={0.05} value={opts.span ?? 0.75}
        onChange={e => set("span", +e.target.value)}
        style={{ width: 64, accentColor: "#c8a96e", verticalAlign: "middle" }}/>
      <span style={{ fontSize: 9, color: "#c8a96e", fontFamily: mono }}>{(opts.span ?? 0.75).toFixed(2)}</span>
    </>}
    {(opts.method ?? "lm") === "lm" && <>
      {lbl("SE")}
      <button onClick={() => set("showSE", !(opts.showSE ?? true))} style={chip(opts.showSE ?? true)}>
        {(opts.showSE ?? true) ? "on" : "off"}
      </button>
      {(opts.showSE ?? true) && <>
        {lbl("CI")}
        {[[0.90,"90%"],[0.95,"95%"],[0.99,"99%"]].map(([v,l]) => (
          <button key={v} onClick={() => set("ci", v)} style={chipGold((opts.ci ?? 0.95) === v)}>{l}</button>
        ))}
      </>}
    </>}
  </>;

  if (geom === "boxplot") return <>
    <button onClick={() => set("outlierShow", !(opts.outlierShow ?? true))} style={chip(opts.outlierShow ?? true)}>
      outliers {(opts.outlierShow ?? true) ? "on" : "off"}
    </button>
    {(opts.outlierShow ?? true) && <>
      {lbl("size")}
      {slider("outlierSize", 1, 8, 0.5, 3)}
      <span style={numW}>{opts.outlierSize ?? 3}</span>
    </>}
  </>;

  if (geom === "histogram") return <>
    {lbl("bins")}
    <input type="number" min={3} max={200} value={opts.bins ?? 20}
      onChange={e => set("bins", Math.max(3, +e.target.value))}
      style={{ width: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: mono, fontSize: 9, padding: "2px 4px", color: C.text, outline: "none" }} />
  </>;

  if (geom === "density") return <>
    {lbl("adjust")}
    {slider("adjust", 0.25, 3, 0.25, 1)}
    <span style={{ ...numW, width: 30 }}>{opts.adjust ?? 1}×</span>
  </>;

  if (geom === "bar") return <>
    {lbl("stroke")}
    {slider("strokeWidth", 0, 2, 0.25, 0)}
    <span style={numW}>{opts.strokeWidth ?? 0}</span>
  </>;

  if (geom === "errorbar") return <>
    {lbl("width")}
    {slider("strokeWidth", 0.5, 4, 0.25, 1.5)}
    <span style={numW}>{opts.strokeWidth ?? 1.5}</span>
  </>;

  return null;
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

      {/* Geom-specific opts — inline, wraps naturally */}
      {GEOM_OPTS_DEFAULTS[layer.geom] && <>
        {sep}
        <GeomOptsRow layer={layer} onChange={onChange} headers={headers} />
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

// ─── PLOT HISTORY CARD ────────────────────────────────────────────────────────
function PlotHistoryCard({ entry, isCompared, onLoad, onDelete, onCompare, C: Cp }) {
  const geomNames = [...new Set(entry.layers.map(l => l.geom))].slice(0, 3).join(", ");
  return (
    <div
      onClick={onLoad}
      style={{
        flexShrink: 0, width: 140, cursor: "pointer", borderRadius: 4, padding: "6px 8px",
        background: isCompared ? "rgba(110,200,180,0.08)" : Cp.bg,
        border: `1px solid ${isCompared ? Cp.teal : Cp.border}`,
        display: "flex", flexDirection: "column", gap: 4, position: "relative",
      }}>
      {/* Color dots */}
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {entry.layers.slice(0, 5).map((l, i) => (
          <span key={i} style={{
            width: 8, height: 8, borderRadius: "50%", background: l.fill, flexShrink: 0, display: "inline-block",
          }} />
        ))}
      </div>
      {/* Geom names */}
      <div style={{ fontFamily: mono, fontSize: 8, color: Cp.textMuted, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {geomNames || "empty"}
      </div>
      {/* Title */}
      <div style={{ fontFamily: mono, fontSize: 9, color: Cp.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>
        {entry.name}
      </div>
      {/* Compare checkbox + delete */}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
        <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={isCompared} onChange={onCompare}
            style={{ accentColor: Cp.teal, cursor: "pointer", width: 10, height: 10 }} />
          <span style={{ fontFamily: mono, fontSize: 7, color: Cp.textMuted }}>compare</span>
        </label>
        <button
          onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{
            marginLeft: "auto", background: "none", border: "none", color: Cp.textMuted,
            cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0 2px", lineHeight: 1,
          }}>×</button>
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [], pid }) {
  const { C } = useTheme();
  const [layers,      setLayers]      = useState(initialLayers);
  const [activeId,    setActiveId]    = useState(initialLayers[0]?.id ?? null);
  const [title,       setTitle]       = useState("");
  const [xLabel,      setXLabel]      = useState("");
  const [yLabel,      setYLabel]      = useState("");
  const [scheme,      setScheme]      = useState("");
  const [showSE,      setShowSE]      = useState(true);
  const [plotHistory,   setPlotHistory]   = useState([]);
  const [histIdx,       setHistIdx]       = useState(null); // null = editor mode
  const [histOpen,      setHistOpen]      = useState(false);
  const [compareIds,    setCompareIds]    = useState(new Set());
  // Axis scale options (ggplot2: scale_x_log10, xlim, scale_y_continuous(labels=…))
  const [xScale,        setXScale]        = useState("linear"); // "linear" | "log" | "sqrt"
  const [yScale,        setYScale]        = useState("linear");
  const [xDomain,       setXDomain]       = useState([null, null]); // [min, max] or null=auto
  const [yDomain,       setYDomain]       = useState([null, null]);
  const [xFmt,          setXFmt]          = useState(""); // "" | "%" | ","
  const [yFmt,          setYFmt]          = useState("");
  const [showAxisOpts,  setShowAxisOpts]  = useState(false);
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

  // Load plot history from IndexedDB on mount / pid change
  useEffect(() => {
    if (!pid) return;
    getPlotHistory(pid).then(h => setPlotHistory(h ?? [])).catch(() => {});
  }, [pid]);

  // Keyboard nav: Alt+← / Alt+→
  useEffect(() => {
    const handler = (e) => {
      if (!e.altKey) return;
      if (e.key === "ArrowLeft")  { e.preventDefault(); navPrev(); }
      if (e.key === "ArrowRight") { e.preventDefault(); navNext(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });  // intentionally no dep array — navPrev/navNext are always current via closure

  const loadPlotEntry = useCallback((entry) => {
    setLayers(entry.layers.map(l => ({ ...l })));
    setActiveId(entry.layers[0]?.id ?? null);
    setTitle(entry.title || "");
    setXLabel(entry.xLabel || "");
    setYLabel(entry.yLabel || "");
    setScheme(entry.scheme || "");
    setXScale(entry.xScale || "linear");
    setYScale(entry.yScale || "linear");
    setXDomain(entry.xDomain || [null, null]);
    setYDomain(entry.yDomain || [null, null]);
    setXFmt(entry.xFmt || "");
    setYFmt(entry.yFmt || "");
  }, []);

  const savePlot = useCallback(() => {
    if (layers.length === 0) return;
    const scaleState = { xScale, yScale, xDomain, yDomain, xFmt, yFmt };
    let next;
    if (histIdx !== null && plotHistory[histIdx]) {
      const updated = {
        ...plotHistory[histIdx],
        layers: JSON.parse(JSON.stringify(layers)),
        title, xLabel, yLabel, scheme, ...scaleState,
      };
      next = plotHistory.map((e, i) => i === histIdx ? updated : e);
    } else {
      const entry = {
        id:      "ph_" + Math.random().toString(36).slice(2, 8),
        name:    `Plot ${plotHistory.length + 1}`,
        layers:  JSON.parse(JSON.stringify(layers)),
        title, xLabel, yLabel, scheme, ...scaleState,
        savedAt: Date.now(),
      };
      next = [...plotHistory, entry];
      setHistOpen(true);
    }
    setPlotHistory(next);
    if (pid) savePlotHistory(pid, next).catch(() => {});
  }, [plotHistory, histIdx, layers, title, xLabel, yLabel, scheme, xScale, yScale, xDomain, yDomain, xFmt, yFmt, pid]);

  const newPlot = useCallback(() => {
    setLayers([]);
    setActiveId(null);
    setTitle("");
    setXLabel("");
    setYLabel("");
    setScheme("");
    setXScale("linear");
    setYScale("linear");
    setXDomain([null, null]);
    setYDomain([null, null]);
    setXFmt("");
    setYFmt("");
    setHistIdx(null);
  }, []);

  const deleteFromHistory = useCallback((id) => {
    setPlotHistory(prev => {
      const idx  = prev.findIndex(e => e.id === id);
      const next = prev.filter(e => e.id !== id);
      if (pid) savePlotHistory(pid, next).catch(() => {});
      setHistIdx(hi => {
        if (hi === null) return null;
        if (idx < hi)  return hi - 1;
        if (idx === hi) return next.length > 0 ? Math.min(hi, next.length - 1) : null;
        return hi;
      });
      setCompareIds(c => { const s = new Set(c); s.delete(id); return s; });
      return next;
    });
  }, [pid]);

  const toggleCompare = useCallback((id) => {
    setCompareIds(prev => {
      const s = new Set(prev);
      if (s.has(id)) { s.delete(id); return s; }
      if (s.size >= 2) return prev;
      s.add(id); return s;
    });
  }, []);

  function navPrev() {
    const i = histIdx === null ? plotHistory.length - 1 : Math.max(0, histIdx - 1);
    if (plotHistory[i]) { loadPlotEntry(plotHistory[i]); setHistIdx(i); }
  }
  function navNext() {
    if (histIdx === null) return;
    if (histIdx < plotHistory.length - 1) { loadPlotEntry(plotHistory[histIdx + 1]); setHistIdx(histIdx + 1); }
    else setHistIdx(null);
  }

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
      border: `1px solid ${C.border}`, borderRadius: 4, overflowX: "hidden", overflowY: "auto",
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

        {/* Row 3: toolbar — labels, palette, axis opts, export */}
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

          {/* SE toggle moved to per-layer GeomOptsRow for smooth layers */}

          {/* Axis options toggle */}
          <button onClick={() => setShowAxisOpts(o => !o)} title="Axis scale options"
            style={{
              padding: "3px 7px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: showAxisOpts ? "rgba(110,200,180,0.12)" : "none",
              color: showAxisOpts ? C.teal : C.textMuted,
              border: `1px solid ${showAxisOpts ? C.teal : C.border}`,
            }}>⊞ Axis</button>

          {/* History nav + Save + New */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {plotHistory.length > 0 && (<>
              <button onClick={navPrev} title="Previous saved plot (Alt+←)"
                disabled={plotHistory.length === 0}
                style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "2px 6px", lineHeight: 1 }}>←</button>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, minWidth: 38, textAlign: "center" }}>
                {histIdx !== null ? `${histIdx + 1}/${plotHistory.length}` : `—/${plotHistory.length}`}
              </span>
              <button onClick={navNext} title="Next saved plot (Alt+→)"
                disabled={histIdx === null}
                style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: histIdx !== null ? C.textMuted : C.border, cursor: histIdx !== null ? "pointer" : "default", fontFamily: mono, fontSize: 10, padding: "2px 6px", lineHeight: 1 }}>→</button>
            </>)}
            <button onClick={savePlot} disabled={layers.length === 0} title="Save current plot to history"
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: layers.length > 0 ? "pointer" : "not-allowed",
                background: layers.length > 0 ? C.teal : "none", color: layers.length > 0 ? C.bg : C.border,
                border: `1px solid ${layers.length > 0 ? C.teal : C.border}`,
              }}>Save</button>
            <button onClick={newPlot} title="Clear builder to start a new plot"
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
                background: "none", color: C.textMuted, border: `1px solid ${C.border}`,
              }}>New</button>
          </div>

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

        {/* Row 4: axis scale options — collapsible */}
        {showAxisOpts && (
          <div style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12,
            padding: "0.35rem 0.75rem", background: C.bg, borderTop: `1px solid ${C.border}`,
          }}>
            {[
              { axis: "X", scale: xScale, setScale: setXScale, domain: xDomain, setDomain: setXDomain, fmt: xFmt, setFmt: setXFmt },
              { axis: "Y", scale: yScale, setScale: setYScale, domain: yDomain, setDomain: setYDomain, fmt: yFmt, setFmt: setYFmt },
            ].map(({ axis, scale, setScale, domain, setDomain, fmt, setFmt }) => (
              <div key={axis} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, width: 8 }}>{axis}</span>
                {/* Scale type */}
                {["linear", "log", "sqrt"].map(s => (
                  <button key={s} onClick={() => setScale(s)}
                    style={{
                      padding: "2px 6px", borderRadius: 3, fontFamily: mono, fontSize: 8, cursor: "pointer",
                      background: scale === s ? C.teal : "none",
                      color: scale === s ? C.bg : C.textMuted,
                      border: `1px solid ${scale === s ? C.teal : C.border}`,
                    }}>{s}</button>
                ))}
                {/* Limits */}
                <span style={{ fontFamily: mono, fontSize: 8, color: C.border }}>|</span>
                {["min", "max"].map((which, wi) => (
                  <input key={which} type="number" placeholder={which}
                    value={domain[wi] ?? ""}
                    onChange={e => {
                      const v = e.target.value === "" ? null : +e.target.value;
                      setDomain(d => wi === 0 ? [v, d[1]] : [d[0], v]);
                    }}
                    style={{
                      width: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                      fontFamily: mono, fontSize: 8, padding: "2px 4px", color: C.text, outline: "none",
                    }} />
                ))}
                {/* Tick format */}
                <span style={{ fontFamily: mono, fontSize: 8, color: C.border }}>|</span>
                <select value={fmt} onChange={e => setFmt(e.target.value)}
                  style={{
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                    fontFamily: mono, fontSize: 8, padding: "2px 4px", color: fmt ? C.text : C.textMuted,
                  }}>
                  <option value="">auto</option>
                  <option value=",">,000</option>
                  <option value=".1%">%</option>
                  <option value="$.2f">$</option>
                  <option value=".2f">.2f</option>
                  <option value=".3f">.3f</option>
                </select>
              </div>
            ))}
            {/* Reset all */}
            <button onClick={() => { setXScale("linear"); setYScale("linear"); setXDomain([null,null]); setYDomain([null,null]); setXFmt(""); setYFmt(""); }}
              style={{ padding: "2px 6px", borderRadius: 3, fontFamily: mono, fontSize: 8, cursor: "pointer", background: "none", color: C.textMuted, border: `1px solid ${C.border}`, marginLeft: "auto" }}>
              reset
            </button>
          </div>
        )}
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
              title={title}
              xLabel={xLabel}
              yLabel={yLabel}
              width={canvasW}
              height={canvasH}
              scheme={scheme}
              showSE={showSE}
              xScale={xScale}
              yScale={yScale}
              xDomain={xDomain}
              yDomain={yDomain}
              xFmt={xFmt}
              yFmt={yFmt}
            />
          </div>
        )}
      </div>

      {/* ── HISTORY STRIP ──────────────────────────────────────────────────── */}
      {plotHistory.length > 0 && (
        <div style={{ flexShrink: 0, borderTop: `1px solid ${C.border}` }}>
          {/* Collapsible header */}
          <div
            onClick={() => setHistOpen(o => !o)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "0.28rem 0.75rem", cursor: "pointer", userSelect: "none",
              background: C.surface,
            }}>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>
              ◈ Plot History ({plotHistory.length})
              {compareIds.size === 2 && <span style={{ color: C.teal, marginLeft: 8 }}>▸ compare</span>}
            </span>
            <span style={{ fontFamily: mono, fontSize: 9, color: C.border }}>{histOpen ? "▲" : "▼"}</span>
          </div>

          {/* Cards */}
          {histOpen && (
            <div style={{
              display: "flex", gap: 8, padding: "0.5rem 0.75rem",
              overflowX: "auto", background: C.bg,
            }}>
              {plotHistory.map((entry, i) => (
                <PlotHistoryCard
                  key={entry.id}
                  entry={entry}
                  isCompared={compareIds.has(entry.id)}
                  C={C}
                  onLoad={() => { loadPlotEntry(entry); setHistIdx(i); }}
                  onDelete={() => deleteFromHistory(entry.id)}
                  onCompare={() => toggleCompare(entry.id)}
                />
              ))}
            </div>
          )}

          {/* Compare mode — 2 plots side-by-side */}
          {compareIds.size === 2 && (() => {
            const [idA, idB] = [...compareIds];
            const entA = plotHistory.find(e => e.id === idA);
            const entB = plotHistory.find(e => e.id === idB);
            if (!entA || !entB) return null;
            const hw = Math.max(280, Math.floor(canvasW / 2) - 12);
            return (
              <div style={{
                display: "flex", gap: 8, padding: "0.5rem 0.75rem",
                borderTop: `1px solid ${C.border}`, background: C.bg, overflowX: "auto",
              }}>
                <PlotCanvas layers={entA.layers} rows={rows} title={entA.name} xLabel={entA.xLabel} yLabel={entA.yLabel} width={hw} height={320} scheme={entA.scheme} showSE xScale={entA.xScale||"linear"} yScale={entA.yScale||"linear"} xDomain={entA.xDomain||[null,null]} yDomain={entA.yDomain||[null,null]} xFmt={entA.xFmt||""} yFmt={entA.yFmt||""} />
                <PlotCanvas layers={entB.layers} rows={rows} title={entB.name} xLabel={entB.xLabel} yLabel={entB.yLabel} width={hw} height={320} scheme={entB.scheme} showSE xScale={entB.xScale||"linear"} yScale={entB.yScale||"linear"} xDomain={entB.xDomain||[null,null]} yDomain={entB.yDomain||[null,null]} xFmt={entB.xFmt||""} yFmt={entB.yFmt||""} />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
