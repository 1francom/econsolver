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
import { useTheme } from "./modeling/shared.jsx";
import { PLOT_PALETTES, MONO_STACK } from "../theme.js";
import PlotExportBar from "./shared/PlotExportBar.jsx";
import { PRESETS, downloadCombinedPNG } from "../services/export/plotExporter.js";
import { buildGgplot, buildMatplotlibPlot, buildStataPlot } from "../services/export/plotScript.js";
import { toDfVar } from "../pipeline/exporter.js";
import { getPlotHistory, savePlotHistory } from "../services/Persistence/plotHistory.js";

const arrMin = (a, fb = 0) => a.length ? a.reduce((m, v) => v < m ? v : m, a[0]) : fb;
const arrMax = (a, fb = 1) => a.length ? a.reduce((m, v) => v > m ? v : m, a[0]) : fb;

const MAP_BASEMAPS = {
  light: {
    url: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: "&copy; <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a> &copy; <a href='https://carto.com/attributions'>CARTO</a>",
  },
};

// ─── OBSERVABLE PLOT — CACHED CDN SINGLETON ───────────────────────────────────
let _plt = null;
let _pltPromise = null;
function loadPlot() {
  if (_plt) return Promise.resolve(_plt);
  if (_pltPromise) return _pltPromise;
  _pltPromise = import("https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6.16/+esm")
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
      link.integrity = "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H";
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.integrity = "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH";
    script.crossOrigin = "anonymous";
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
  { id: "teal-gold",    label: "Teal-Gold"   },
  { id: "tableau10",    label: "Tableau"     },
  { id: "observable10", label: "Observable"  },
  { id: "dark2",        label: "Dark2"       },
  { id: "set1",         label: "Set1"        },
  { id: "set2",         label: "Set2"        },
  { id: "paired",       label: "Paired"      },
  { id: "accent",       label: "Accent"      },
];

// Maps appearance prefs plotPalette → PALETTE_PRESETS id
const PREF_TO_PRESET = { "teal-gold": "teal-gold", observable: "observable10", tableau: "tableau10" };



const POSITION_OPTIONS = {
  bar:      ["identity", "stack", "dodge"],
  point:    ["identity", "jitter", "dodge"],
  errorbar: ["identity", "dodge"],
};

function genId() { return "ly_" + Math.random().toString(36).slice(2, 8); }

const DEFAULT_FILLS = ["#6ec8b4","#c8a96e","#6e9ec8","#c47070","#a87ec8","#7ab896","#c88e6e"];

// Per-geom defaults for the opts panel (ui-basic params per ggplot2-plot-design skill)
const GEOM_OPTS_DEFAULTS = {
  point:     { size: 3,   shape: "circle" },
  line:      { strokeWidth: 1.8, dash: "none" },
  smooth:    { method: "lm", showSE: true, ci: 0.95, span: 0.75 },
  boxplot:   { outlierShow: true, outlierSize: 3, outlierColor: "", iqrCoef: 1.5 },
  histogram: { bins: 20, binMode: "count", binWidth: 1 },
  density:   { adjust: 1.0, binMode: "count", binWidth: 1 },
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
        if (ly.position === "jitter" || ly.position === "dodge") {
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
        } else if (ly.position === "dodge") {
          marks.push(Plt.barY(rows, Plt.dodgeX("middle", { x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op, ...barExtra, padding: 0.1 })));
        } else {
          marks.push(Plt.barY(rows, { x: aes.x, y: aes.y, fill: colorVal, fillOpacity: op, ...barExtra }));
        }
      }
      break;
    }

    case "histogram": {
      if (aes.x) {
        const { bins = 20, binMode = "count", binWidth = 1 } = ly.opts || {};
        const binOpt = binMode === "width" ? { interval: binWidth } : { thresholds: bins };
        marks.push(Plt.rectY(rows, Plt.binX({ y: "count" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.85 * op, ...binOpt,
        })));
      }
      break;
    }

    case "density": {
      if (aes.x) {
        const { adjust = 1.0, binMode = "count", binWidth = 1 } = ly.opts || {};
        const binOpt = binMode === "width" ? { interval: binWidth } : { thresholds: Math.round(40 * adjust) };
        marks.push(Plt.areaY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, fill: colorVal, fillOpacity: 0.22 * op, ...binOpt,
        })));
        marks.push(Plt.lineY(rows, Plt.binX({ y: "proportion" }, {
          x: aes.x, stroke: colorVal, strokeWidth: 1.8, strokeOpacity: op, ...binOpt,
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
      const outR = outlierShow ? Math.max(1, (outlierSize ?? 3) / 2) : 0;
      const isGrouped = aes.color && aes.x && aes.color !== aes.x;

      if (isGrouped) {
        const subVals = [...new Set(rows.map(r => String(r[aes.color] ?? "")))];
        for (let si = 0; si < subVals.length; si++) {
          const sv = subVals[si];
          const subColor = DEFAULT_FILLS[si % DEFAULT_FILLS.length];
          const subData = rows
            .filter(r => isFinite(+r[aes.y]) && String(r[aes.color] ?? "") === sv)
            .map(r => ({ __x: `${String(r[aes.x] ?? "")} · ${sv}`, __y: +r[aes.y] }));
          if (subData.length < 2) continue;
          marks.push(Plt.boxY(subData, {
            x: "__x", y: "__y",
            fill: subColor, stroke: subColor,
            fillOpacity: 0.68 * op, strokeOpacity: 0.85 * op,
            r: outR,
          }));
        }
      } else {
        const plotData = rows
          .filter(r => isFinite(+r[aes.y]))
          .map(r => ({ __x: aes.x ? String(r[aes.x] ?? "") : null, __y: +r[aes.y] }));
        if (plotData.length >= 2) {
          marks.push(Plt.boxY(plotData, {
            x: aes.x ? "__x" : null, y: "__y",
            fill: colorVal, stroke: colorVal,
            fillOpacity: 0.68 * op, strokeOpacity: 0.85 * op,
            r: outR,
          }));
        }
      }
      break;
    }

    case "errorbar": {
      if (aes.x && aes.yMin && aes.yMax) {
        const { strokeWidth: ebW = 1.5 } = ly.opts || {};
        const ebBase = { x: aes.x, y1: aes.yMin, y2: aes.yMax, stroke: colorVal, strokeWidth: ebW, strokeOpacity: op };
        if (ly.position === "dodge") {
          marks.push(Plt.ruleX(rows, Plt.dodgeX("middle", { ...ebBase, padding: 4 })));
        } else {
          marks.push(Plt.ruleX(rows, ebBase));
          marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMin, stroke: colorVal, strokeWidth: ebW, strokeOpacity: op }));
          marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMax, stroke: colorVal, strokeWidth: ebW, strokeOpacity: op }));
        }
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
  // Patch color legend figures for dark theme
  el.querySelectorAll("figure").forEach(f => {
    f.style.background = "transparent";
    f.style.color = "#9a9a9a";
    f.style.margin = "0";
  });
  el.querySelectorAll("figure h2").forEach(h => {
    h.style.fontFamily = MONO_STACK;
    h.style.fontSize = "9px";
    h.style.letterSpacing = "0.15em";
    h.style.textTransform = "uppercase";
    h.style.color = "#6a6a6a";
    h.style.fontWeight = "400";
    h.style.margin = "6px 0 3px";
  });
  el.querySelectorAll("figure span[style]").forEach(s => {
    s.style.color = "#9a9a9a";
  });
}

// ─── PLOT CANVAS — renders one or more layers on a single Observable Plot ─────
// layers: array of layer objects (for overlay/comparison) OR single-element array
function PlotCanvas({ layers, rows, xLabel, yLabel, title, width, height, scheme, canvasRef, showSE = true,
  xScale = "linear", yScale = "linear",
  xDomain = [null, null], yDomain = [null, null],
  xFmt = "", yFmt = "",
  xCatOrder = "", yCatOrder = "",
  onRenderError,
}) {
  const { C, T } = useTheme();
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

      // For date columns, convert ISO strings → Date objects so Observable Plot
      // receives proper Date values (not strings that could be misinterpreted).
      const plotRows = (xIsDate && xAesCol)
        ? rows.map(r => {
            const v = r[xAesCol];
            if (v == null || v instanceof Date) return r;
            const d = new Date(v);
            return isNaN(d.getTime()) ? r : { ...r, [xAesCol]: d };
          })
        : rows;

      // When xCatOrder is set, sort rows by the domain array so line/area marks
      // connect points in the intended category sequence, not the raw data order.
      const xCatArr = xCatOrder ? xCatOrder.split(",").map(s => s.trim()).filter(Boolean) : null;
      const xColForSort = layers.find(ly => ly.visible && ly.aes?.x)?.aes.x;
      const marksRows = xCatArr && xColForSort
        ? [...plotRows].sort((a, b) => {
            const ai = xCatArr.indexOf(String(a[xColForSort] ?? ""));
            const bi = xCatArr.indexOf(String(b[xColForSort] ?? ""));
            return (ai === -1 ? 1e9 : ai) - (bi === -1 ? 1e9 : bi);
          })
        : plotRows;

      // Build data marks first, then compose full mark stack
      const dataMarks = [];
      for (const ly of layers) {
        if (!ly.visible) continue;
        dataMarks.push(...buildMarksForLayer(Plt, ly, marksRows, showSE));
      }

      // Compute actual data extents to decide whether zero rules are meaningful
      const xCol = xColForSort;
      const yCol = layers.find(ly => ly.visible && ly.aes?.y)?.aes.y;
      const xVals = xCol
        ? (xIsDate
          ? plotRows.map(r => { const v = r[xCol]; return v instanceof Date ? v.getTime() : NaN; }).filter(isFinite)
          : rows.map(r => +r[xCol]).filter(v => isFinite(v)))
        : [];
      const yVals = yCol ? rows.map(r => +r[yCol]).filter(v => isFinite(v)) : [];
      const xMin = arrMin(xVals);
      const xMax = arrMax(xVals);
      const yMin = arrMin(yVals);
      const yMax = arrMax(yVals);
      // Only draw zero rule when 0 is within ±20% of the data range (ggplot expand default)
      const xRange = xMax - xMin;
      const yRange = yMax - yMin;
      // Boxplot builds string category keys for x — adding a numeric ruleX([0]) creates a
      // duplicate "0" entry (number vs string) in Observable Plot's categorical domain.
      // Also skip ruleX when x is categorical (xVals empty because all values are strings).
      const hasBoxplot = layers.some(ly => ly.visible && ly.geom === "boxplot");
      const showRuleX = !xIsDate && !hasBoxplot && xVals.length > 0 && 0 >= xMin - xRange * 0.2 && 0 <= xMax + xRange * 0.2;
      const showRuleY = yVals.length > 0 && 0 >= yMin - yRange * 0.2 && 0 <= yMax + yRange * 0.2;

      const zeroStyle = { stroke: "#888", strokeWidth: 1.4, strokeOpacity: 0.55 };
      const marks = [
        // 1. Grid (background, very subtle)
        Plt.gridX({ stroke: "#808080", strokeOpacity: 0.15 }),
        Plt.gridY({ stroke: "#808080", strokeOpacity: 0.15 }),
        // 2. Zero rules — only when 0 is near the data range (avoids scale compression)
        //    For date x-axis, skip ruleX entirely (epoch 0 = 1970 would corrupt the domain).
        //    For ruleY on date axes, anchor x1/x2 explicitly to avoid domain bleed.
        ...(showRuleX ? [Plt.ruleX([0], zeroStyle)] : []),
        ...(showRuleY
          ? [xIsDate && xVals.length
              ? Plt.ruleY([0], { ...zeroStyle, x1: new Date(xMin), x2: new Date(xMax) })
              : Plt.ruleY([0], zeroStyle)]
          : []),
        // 3. Data marks
        ...dataMarks,
        // 4. Frame on top to cleanly border the plot area
        Plt.frame({ stroke: "#333" }),
      ];

      // Boxplot manages its own grouped colors with hardcoded hex — exclude it from the
      // color channel so Observable Plot doesn't create an "undefined" legend entry.
      const hasColorChannel = layers.some(ly => ly.visible && ly.aes?.color && ly.geom !== "boxplot");
      const tealGoldRange = PLOT_PALETTES["teal-gold"];
      const colorOpts = hasColorChannel
        ? (scheme === "teal-gold"
            ? { range: tealGoldRange, legend: true }
            : { scheme: scheme || "observable10", legend: true })
        : scheme === "teal-gold"
            ? { range: tealGoldRange }
            : scheme ? { scheme } : {};
      const el = Plt.plot({
        width:        width || 580,
        height:       height || 310,
        marginLeft:   52,
        marginBottom: xIsDate ? 52 : 40,
        marginTop:    24,
        style: {
          background: "transparent",
          color:      C.text,
          fontFamily: T.code.fontFamily,
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
          // xCatOrder: explicit category sequence (like ggplot scale_x_discrete(limits=c(...)))
          ...(xCatOrder
            ? { domain: xCatOrder.split(",").map(s => s.trim()).filter(Boolean) }
            : xDomain[0] != null || xDomain[1] != null
              ? { domain: [xDomain[0] ?? xMin, xDomain[1] ?? xMax] }
              : {}),
          ...(xFmt ? { tickFormat: xFmt } : {}),
        },
        y: {
          label:       yLabel || null,
          labelOffset: 40,
          // Disable nice when we supply an explicit domain — nice() can interact with
          // the domain in ways that reverse the axis on some Observable Plot versions.
          nice:        yScale === "linear" && yVals.length === 0 && yDomain[0] == null && yDomain[1] == null && !yCatOrder,
          inset:       8,
          reverse:     false, // hard-guard: never auto-reverse the y-axis
          // Limit tick density so labels don't pile up on narrow-range axes
          ticks:       Math.min(8, Math.floor((height || 310) / 40)),
          ...(yScale !== "linear" ? { type: yScale } : {}),
          // Explicit ascending domain prevents Observable Plot from inferring a reversed
          // domain from y1/y2-only marks (e.g. boxplot barY / ruleX whiskers).
          ...(yCatOrder
            ? { domain: yCatOrder.split(",").map(s => s.trim()).filter(Boolean) }
            : yDomain[0] != null || yDomain[1] != null
              ? { domain: [yDomain[0] ?? yMin, yDomain[1] ?? yMax] }
              : yVals.length > 0
                ? { domain: [yMin, yMax] }
                : {}),
          ...(yFmt ? { tickFormat: yFmt } : {}),
        },
        color: colorOpts,
        marks,
      });
      patchDarkTheme(el);
      container.replaceChildren(el);
    } catch (e) {
      container.replaceChildren();
      // Surface error via callback so it renders OUTSIDE the canvas div (excluded from PNG export)
      if (onRenderError) onRenderError(e.message);
    }
    return () => { if (ref.current) ref.current.replaceChildren(); };
  }, [Plt, layers, rows, xLabel, yLabel, width, scheme, xScale, yScale, xDomain, yDomain, xFmt, yFmt, xCatOrder, yCatOrder]);

  if (err) return <div style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "1.5rem" }}>{err}</div>;
  if (!Plt) return <div style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1.5rem" }}>Loading Observable Plot…</div>;
  return (
    <div style={{ width: "100%", overflow: "visible" }}>
      {title && (
        <div style={{
          textAlign: "center", fontFamily: T.code.fontFamily, fontSize: T.code.fontSize,
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
  const { C, T, theme } = useTheme();
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

    const basemap = MAP_BASEMAPS[theme === "light" ? "light" : "dark"];
    L.tileLayer(basemap.url, {
      attribution: basemap.attribution,
      maxZoom: 19,
      detectRetina: true,
      crossOrigin: true,
    }).addTo(map);

    // Color scale
    const colorCol = aes.color;
    let getColor;
    if (colorCol) {
      const vals = validRows.map(r => r[colorCol]);
      const isNum = vals.every(v => v !== "" && v !== null && !isNaN(parseFloat(v)));
      if (isNum) {
        const nums = vals.map(Number);
        const mn = arrMin(nums), mx = arrMax(nums), rng = mx - mn || 1;
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
  }, [L, layer, rows, theme]);

  if (err) return <div style={{ color: C.red, fontFamily: T.code.fontFamily, fontSize: T.code.fontSize, padding: "1.5rem" }}>{err}</div>;
  if (!L)  return <div style={{ color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1.5rem" }}>Loading Leaflet…</div>;
  const { aes } = layer;
  if (!aes.x || !aes.y) return (
    <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, padding: "2rem", textAlign: "center" }}>
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
  const { C, T } = useTheme();
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
      <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: isActive ? C.teal : C.textDim, whiteSpace: "nowrap" }}>
        {layer.geom}{layer.aes?.x ? ` · ${layer.aes.x}` : ""}
        {layer.opacity < 0.99 ? ` ${Math.round(layer.opacity*100)}%` : ""}
      </span>
      <button onClick={e => { e.stopPropagation(); onToggle(); }}
        title={layer.visible ? "Hide" : "Show"}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.caption.fontSize, padding: "0 1px", color: layer.visible ? C.textDim : C.textMuted, lineHeight: 1 }}>
        {layer.visible ? "●" : "○"}
      </button>
      <button onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remove"
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: T.body.fontSize, padding: "0 1px", color: C.textMuted, lineHeight: 1 }}>×</button>
    </div>
  );
}

// ─── GEOM-SPECIFIC OPTIONS ROW ────────────────────────────────────────────────
// Renders per-geom ui-basic params (ggplot2-plot-design skill classification).
// Variable mapping: aes.sizeCol / aes.alphaCol → ggplot aes(size=col, alpha=col)
function GeomOptsRow({ layer, onChange, headers = [] }) {
  const { C, T } = useTheme();
  const { geom, opts = {}, aes = {} } = layer;
  const set    = (key, val) => onChange({ ...layer, opts: { ...opts, [key]: val } });
  const setAes = (key, val) => onChange({ ...layer, aes: { ...aes, [key]: val } });

  const chip = (active) => ({
    padding: "2px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
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
  const lbl  = (t) => <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{t}</span>;
  const sep  = <div style={{ width: 1, height: 14, background: C.border, flexShrink: 0, alignSelf: "center" }} />;
  const numW = { width: 26, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim, flexShrink: 0 };
  const slider = (key, min, max, step, def) => (
    <input type="range" min={min} max={max} step={step} value={opts[key] ?? def}
      onChange={e => set(key, +e.target.value)}
      style={{ width: 60, accentColor: C.teal, cursor: "pointer" }} />
  );

  // shared col select style
  const colSel = (active) => ({
    background: C.bg, border: `1px solid ${active ? C.teal + "65" : C.border}`,
    borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 5px",
    color: active ? C.text : C.textMuted, minWidth: 80, maxWidth: 120,
  });
  // small "var" toggle button
  const varBtn = (isVar) => ({
    padding: "2px 5px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
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
        style={{ width: 64, accentColor: C.gold, verticalAlign: "middle" }}/>
      <span style={{ fontSize: T.caption.fontSize, color: C.gold, fontFamily: T.code.fontFamily }}>{(opts.span ?? 0.75).toFixed(2)}</span>
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
    {lbl("IQR ×")}
    {slider("iqrCoef", 0.5, 3, 0.5, 1.5)}
    <span style={numW}>{opts.iqrCoef ?? 1.5}</span>
    <button onClick={() => set("outlierShow", !(opts.outlierShow ?? true))} style={chip(opts.outlierShow ?? true)}>
      outliers {(opts.outlierShow ?? true) ? "on" : "off"}
    </button>
    {(opts.outlierShow ?? true) && <>
      {lbl("size")}
      {slider("outlierSize", 1, 8, 0.5, 3)}
      <span style={numW}>{opts.outlierSize ?? 3}</span>
      {lbl("color")}
      <input type="color" value={opts.outlierColor || layer.fill}
        onChange={e => set("outlierColor", e.target.value)}
        title="Outlier dot color"
        style={{ width: 22, height: 18, padding: 0, border: `1px solid ${C.border}`, borderRadius: 3, cursor: "pointer", background: "none" }} />
    </>}
  </>;

  if (geom === "histogram") return <>
    <button onClick={() => set("binMode", (opts.binMode ?? "count") === "count" ? "width" : "count")} style={chip((opts.binMode ?? "count") === "width")}>
      by {(opts.binMode ?? "count") === "count" ? "count" : "width"}
    </button>
    {(opts.binMode ?? "count") === "count" ? <>
      {lbl("bins")}
      <input type="number" min={3} max={200} value={opts.bins ?? 20}
        onChange={e => set("bins", Math.max(3, +e.target.value))}
        style={{ width: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px", color: C.text, outline: "none" }} />
    </> : <>
      {lbl("width")}
      <input type="number" min={0.0001} step="any" value={opts.binWidth ?? 1}
        onChange={e => set("binWidth", Math.max(0.0001, +e.target.value))}
        style={{ width: 68, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px", color: C.text, outline: "none" }} />
    </>}
  </>;

  if (geom === "density") return <>
    {lbl("adjust")}
    {slider("adjust", 0.25, 3, 0.25, 1)}
    <span style={{ ...numW, width: 30 }}>{opts.adjust ?? 1}×</span>
    <button onClick={() => set("binMode", (opts.binMode ?? "count") === "count" ? "width" : "count")} style={chip((opts.binMode ?? "count") === "width")}>
      by {(opts.binMode ?? "count") === "count" ? "count" : "width"}
    </button>
    {(opts.binMode ?? "count") === "width" && <>
      {lbl("width")}
      <input type="number" min={0.0001} step="any" value={opts.binWidth ?? 1}
        onChange={e => set("binWidth", Math.max(0.0001, +e.target.value))}
        style={{ width: 68, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px", color: C.text, outline: "none" }} />
    </>}
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
  const { C, T } = useTheme();
  const isMap        = layer.geom === "map";
  const isRefLine    = ["hline", "vline"].includes(layer.geom);
  const needsYMinMax = ["errorbar", "ribbon"].includes(layer.geom);
  const noY          = ["histogram", "density", "hline", "vline"].includes(layer.geom);
  const noX          = ["hline", "vline"].includes(layer.geom);

  const selStyle = active => ({
    background: C.bg, border: `1px solid ${active ? C.border2 : C.border}`,
    borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "3px 5px",
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
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>value</span>
        <input type="number" value={layer.value ?? ""} placeholder="0"
          onChange={e => onChange({ ...layer, value: e.target.value })}
          style={{ ...selStyle(!!layer.value), width: 60 }} />
      </>}
      {!noX && <>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{isMap ? "lon" : "x"}</span>
        <select value={layer.aes.x} onChange={e => onChange({ ...layer, aes: { ...layer.aes, x: e.target.value } })} style={selStyle(!!layer.aes.x)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {!noY && <>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>{isMap ? "lat" : "y"}</span>
        <select value={layer.aes.y} onChange={e => onChange({ ...layer, aes: { ...layer.aes, y: e.target.value } })} style={selStyle(!!layer.aes.y)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {needsYMinMax && <>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>yMin</span>
        <select value={layer.aes.yMin ?? ""} onChange={e => onChange({ ...layer, aes: { ...layer.aes, yMin: e.target.value } })} style={selStyle(!!layer.aes.yMin)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>yMax</span>
        <select value={layer.aes.yMax ?? ""} onChange={e => onChange({ ...layer, aes: { ...layer.aes, yMax: e.target.value } })} style={selStyle(!!layer.aes.yMax)}>
          <option value="">— col —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}
      {!isRefLine && <>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>color</span>
        <select value={layer.aes.color} onChange={e => onChange({ ...layer, aes: { ...layer.aes, color: e.target.value } })} style={selStyle(!!layer.aes.color)}>
          <option value="">— none —</option>
          {headers.map(h => <option key={h} value={h}>{h}</option>)}
        </select>
      </>}

      {sep}

      {/* Fill color */}
      {!layer.aes?.color && <>
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>fill</span>
        <input type="color" value={layer.fill} onChange={e => onChange({ ...layer, fill: e.target.value })}
          style={{ width: 24, height: 20, border: "none", background: "none", cursor: "pointer", padding: 0 }} />
      </>}

      {/* Position */}
      {POSITION_OPTIONS[layer.geom] && <>
        {sep}
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>pos</span>
        {POSITION_OPTIONS[layer.geom].map(pos => (
          <button key={pos} onClick={() => onChange({ ...layer, position: pos })}
            style={{
              padding: "2px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
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
        <span style={{ fontSize: T.caption.fontSize, color: C.textMuted, fontFamily: T.code.fontFamily }}>α</span>
        <input type="range" min={0} max={1} step={0.05} value={layer.opacity ?? 1}
          onChange={e => onChange({ ...layer, opacity: +e.target.value })}
          style={{ width: 64, accentColor: C.teal, cursor: "pointer" }} />
        <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textDim, width: 26, textAlign: "right", flexShrink: 0 }}>
          {Math.round((layer.opacity ?? 1) * 100)}%
        </span>
      </div>
    </div>
  );
}

// ─── PLOT HISTORY CARD ────────────────────────────────────────────────────────
function PlotHistoryCard({ entry, index, count, isCompared, onLoad, onRename, onMove, onDelete, onCompare, C: Cp, datasetName, foreign }) {
  const { T } = useTheme();
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(entry.name || "");
  const geomNames = [...new Set(entry.layers.map(l => l.geom))].slice(0, 3).join(", ");
  return (
    <div
      onClick={onLoad}
      style={{
        flexShrink: 0, width: 150, cursor: "pointer", borderRadius: 4, padding: "6px 8px",
        background: isCompared ? "rgba(110,200,180,0.08)" : Cp.bg,
        border: `1px solid ${isCompared ? Cp.teal : Cp.border}`,
        display: "flex", flexDirection: "column", gap: 4, position: "relative",
      }}>
      <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
        {entry.layers.slice(0, 5).map((l, i) => (
          <span key={i} style={{ width: 8, height: 8, borderRadius: "50%", background: l.fill, flexShrink: 0, display: "inline-block" }} />
        ))}
      </div>
      <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.textMuted, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
        {geomNames || "empty"}
      </div>
      {editing ? (
        <input autoFocus value={val}
          onClick={e => e.stopPropagation()}
          onChange={e => setVal(e.target.value)}
          onBlur={() => { onRename?.(val.trim() || entry.name); setEditing(false); }}
          onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") setEditing(false); }}
          style={{ width: "100%", background: Cp.surface2, border: `1px solid ${Cp.teal}`, borderRadius: 3, color: Cp.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "1px 4px" }} />
      ) : (
        <div onDoubleClick={e => { e.stopPropagation(); setEditing(true); setVal(entry.name || ""); }}
          title="Double-click to rename"
          style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.text, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis", fontWeight: 500 }}>
          {entry.name}
        </div>
      )}
      {foreign && datasetName && (
        <div style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.blue, overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
          ⇄ {datasetName}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 2 }}>
        <button onClick={e => { e.stopPropagation(); onMove?.(-1); }} disabled={index === 0} title="Move left"
          style={{ background: "none", border: "none", color: index === 0 ? Cp.border : Cp.textMuted, cursor: index === 0 ? "default" : "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>◀</button>
        <button onClick={e => { e.stopPropagation(); onMove?.(1); }} disabled={index === count - 1} title="Move right"
          style={{ background: "none", border: "none", color: index === count - 1 ? Cp.border : Cp.textMuted, cursor: index === count - 1 ? "default" : "pointer", fontSize: T.caption.fontSize, padding: 0, lineHeight: 1 }}>▶</button>
        <label onClick={e => e.stopPropagation()} style={{ display: "flex", alignItems: "center", gap: 3, cursor: "pointer" }}>
          <input type="checkbox" checked={isCompared} onChange={onCompare} style={{ accentColor: Cp.teal, cursor: "pointer", width: 10, height: 10 }} />
          <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: Cp.textMuted }}>cmp</span>
        </label>
        <button onClick={e => { e.stopPropagation(); onDelete(); }}
          style={{ marginLeft: "auto", background: "none", border: "none", color: Cp.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "0 2px", lineHeight: 1 }}>×</button>
      </div>
    </div>
  );
}

// ─── COMBINED EXPORT BAR ──────────────────────────────────────────────────────
// Single export row for compare mode — exports both plots as one PNG.
function CombinedExportBar({ getElA, getElB, filename = "plot_combined" }) {
  const { C, T } = useTheme();
  const [preset, setPreset] = useState("default");
  const [busy, setBusy] = useState(false);

  const btnBase = {
    padding: "0.2rem 0.6rem",
    background: "transparent",
    border: `1px solid ${C.border2}`,
    borderRadius: 3,
    color: C.textDim,
    cursor: "pointer",
    fontFamily: T.code.fontFamily,
    fontSize: T.caption.fontSize,
    transition: "all 0.12s",
    flexShrink: 0,
  };

  async function handleCombined() {
    if (busy) return;
    setBusy(true);
    try {
      await downloadCombinedPNG(getElA(), getElB(), filename, preset);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "0.3rem 0.65rem",
      borderTop: `1px solid ${C.border}`,
      background: C.bg,
    }}>
      <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, flexShrink: 0 }}>Style</span>
      <select
        value={preset}
        onChange={e => setPreset(e.target.value)}
        style={{
          background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 3,
          fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 5px", color: C.text, cursor: "pointer",
        }}
      >
        {Object.entries(PRESETS).map(([key, { label }]) => (
          <option key={key} value={key}>{label}</option>
        ))}
      </select>
      <div style={{ flex: 1 }} />
      <button
        onClick={handleCombined}
        disabled={busy}
        title="Download both plots as one PNG"
        style={{ ...btnBase, opacity: busy ? 0.5 : 1 }}
        onMouseEnter={e => { if (!busy) { e.currentTarget.style.borderColor = C.teal; e.currentTarget.style.color = C.teal; } }}
        onMouseLeave={e => { e.currentTarget.style.borderColor = C.border2; e.currentTarget.style.color = C.textDim; }}
      >
        {busy ? "…" : "↓ PNG"}
      </button>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
// scriptPreamble(language) optionally prepends model-context replication code.
// datasetName: source dataset name → R/Python df identifier (df_<name>) in copied
// scripts so the export matches the unified-script convention. Defaults to "df".
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [], pid, projectPid, datasetId, onRequestDataset, initialPendingPlotId, onConsumePendingPlot, scriptPreamble, datasetName }) {
  const { C, T, prefs } = useTheme();
  const histPid = projectPid ?? pid; // history is project-scoped; falls back to pid
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
  const [scriptLanguage,setScriptLanguage]= useState("r");
  const [copiedLanguage,setCopiedLanguage]= useState(null);
  const [compareIds,    setCompareIds]    = useState(new Set());
  // Axis scale options (ggplot2: scale_x_log10, xlim, scale_y_continuous(labels=…))
  const [xScale,        setXScale]        = useState("linear"); // "linear" | "log" | "sqrt"
  const [yScale,        setYScale]        = useState("linear");
  const [xDomain,       setXDomain]       = useState([null, null]); // [min, max] or null=auto
  const [yDomain,       setYDomain]       = useState([null, null]);
  const [xFmt,          setXFmt]          = useState(""); // "" | "%" | ","
  const [yFmt,          setYFmt]          = useState("");
  const [xCatOrder,     setXCatOrder]     = useState(""); // comma-separated category order
  const [yCatOrder,     setYCatOrder]     = useState("");
  const [showAxisOpts,  setShowAxisOpts]  = useState(false);
  const [plotRenderError,  setPlotRenderError]  = useState(null);
  const [showPlotError,    setShowPlotError]    = useState(false);
  const canvasRef   = useRef(null);
  const plotRef     = useRef(null);
  const compareRefA = useRef(null);
  const compareRefB = useRef(null);
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

  // Clear render error when layers or data changes
  useEffect(() => { setPlotRenderError(null); setShowPlotError(false); }, [layers, rows]);

  // Initialise palette from appearance prefs on first mount
  useEffect(() => {
    setScheme(PREF_TO_PRESET[prefs?.plotPalette] || "");
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load project-scoped plot history; one-time best-effort merge of legacy
  // per-dataset entries (old plotHistory_<datasetId>) so nothing is lost.
  useEffect(() => {
    if (!histPid) return;
    let cancelled = false;
    (async () => {
      const proj = await getPlotHistory(histPid).catch(() => []);
      let merged = Array.isArray(proj) ? proj : [];
      if (datasetId && datasetId !== histPid) {
        const legacy = await getPlotHistory(datasetId).catch(() => []);
        const have = new Set(merged.map(e => e.id));
        const adopt = (legacy ?? [])
          .filter(e => !have.has(e.id))
          .map(e => ({ ...e, datasetId: e.datasetId ?? datasetId, datasetName: e.datasetName ?? datasetName }));
        if (adopt.length) { merged = [...merged, ...adopt]; savePlotHistory(histPid, merged).catch(() => {}); }
      }
      if (!cancelled) setPlotHistory(merged);
    })();
    return () => { cancelled = true; };
  }, [histPid, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setXCatOrder(entry.xCatOrder || "");
    setYCatOrder(entry.yCatOrder || "");
  }, []);

  // After App switches datasets to honor a cross-dataset plot click, open the
  // requested plot once this dataset's history is present.
  useEffect(() => {
    if (!initialPendingPlotId || !plotHistory.length) return;
    const i = plotHistory.findIndex(e => e.id === initialPendingPlotId);
    if (i >= 0) {
      const entry = plotHistory[i];
      // Only consume the pending token once the plot is actually loaded; if the
      // dataset hasn't propagated yet, leave it so the effect re-runs on match.
      if (!entry.datasetId || entry.datasetId === datasetId) {
        loadPlotEntry(entry); setHistIdx(i); setHistOpen(true);
        onConsumePendingPlot?.();
      }
    }
  }, [initialPendingPlotId, plotHistory, datasetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPlotEntry = useCallback(() => {
    const scaleState = { xScale, yScale, xDomain, yDomain, xFmt, yFmt, xCatOrder, yCatOrder };
    return {
      layers: JSON.parse(JSON.stringify(layers)),
      title, xLabel, yLabel, scheme, ...scaleState,
    };
  }, [layers, title, xLabel, yLabel, scheme, xScale, yScale, xDomain, yDomain, xFmt, yFmt, xCatOrder, yCatOrder]);

  const savePlot = useCallback(() => {
    if (layers.length === 0) return;
    const current = currentPlotEntry();
    let next;
    if (histIdx !== null && plotHistory[histIdx]) {
      const updated = {
        ...plotHistory[histIdx],
        ...current,
      };
      next = plotHistory.map((e, i) => i === histIdx ? updated : e);
    } else {
      const entry = {
        id:      "ph_" + Math.random().toString(36).slice(2, 8),
        name:    `Plot ${plotHistory.length + 1}`,
        ...current,
        datasetId:   datasetId ?? null,
        datasetName: datasetName ?? null,
        savedAt: Date.now(),
      };
      next = [...plotHistory, entry];
      setHistOpen(true);
    }
    setPlotHistory(next);
    if (histPid) savePlotHistory(histPid, next).catch(() => {});
  }, [plotHistory, histIdx, layers.length, currentPlotEntry, histPid, datasetId, datasetName]);

  const copyPlotScript = useCallback(() => {
    if (layers.length === 0) return;
    const entry = currentPlotEntry();
    const preamble = typeof scriptPreamble === "function"
      ? String(scriptPreamble(scriptLanguage) ?? "").trim()
      : "";
    const baseDfVar = datasetName ? toDfVar(datasetName) : "df";
    const dfVar = preamble && scriptLanguage !== "stata" ? "plot_df" : baseDfVar;
    const generated = scriptLanguage === "python"
      ? buildMatplotlibPlot(entry, { dfVar })
      : scriptLanguage === "stata"
        ? buildStataPlot(entry)
        : buildGgplot(entry, { dfVar });
    const script = preamble ? `${preamble}\n\n${generated}` : generated;
    navigator.clipboard.writeText(script).then(() => {
      setCopiedLanguage(scriptLanguage);
      setTimeout(() => setCopiedLanguage(current => current === scriptLanguage ? null : current), 1600);
    }).catch(() => setCopiedLanguage(null));
  }, [layers.length, currentPlotEntry, scriptLanguage, scriptPreamble, datasetName]);

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
    setXCatOrder("");
    setYCatOrder("");
    setHistIdx(null);
  }, []);

  const deleteFromHistory = useCallback((id) => {
    setPlotHistory(prev => {
      const idx  = prev.findIndex(e => e.id === id);
      const next = prev.filter(e => e.id !== id);
      if (histPid) savePlotHistory(histPid, next).catch(() => {});
      setHistIdx(hi => {
        if (hi === null) return null;
        if (idx < hi)  return hi - 1;
        if (idx === hi) return next.length > 0 ? Math.min(hi, next.length - 1) : null;
        return hi;
      });
      setCompareIds(c => { const s = new Set(c); s.delete(id); return s; });
      return next;
    });
  }, [histPid]);

  const renamePlot = useCallback((id, name) => {
    setPlotHistory(prev => {
      const next = prev.map(e => e.id === id ? { ...e, name } : e);
      if (histPid) savePlotHistory(histPid, next).catch(() => {});
      return next;
    });
  }, [histPid]);

  const movePlot = useCallback((i, dir) => {
    setPlotHistory(prev => {
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      if (histPid) savePlotHistory(histPid, next).catch(() => {});
      return next;
    });
  }, [histPid]);

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
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, marginRight: 4 }}>No layers —</span>
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
                padding: "3px 7px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
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
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>{lbl}</span>
              <input value={val} onChange={e => set(e.target.value)} placeholder={lbl.toLowerCase()}
                style={{
                  width: w, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                  fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "3px 5px", color: C.text, outline: "none",
                }} />
            </div>
          ))}

          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>Style</span>
            <select value={scheme} onChange={e => setScheme(e.target.value)}
              style={{
                background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "3px 5px",
                color: scheme ? C.text : C.textMuted,
              }}>
              {PALETTE_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>

          {/* SE toggle moved to per-layer GeomOptsRow for smooth layers */}

          {/* Axis options toggle */}
          <button onClick={() => setShowAxisOpts(o => !o)} title="Axis scale options"
            style={{
              padding: "3px 7px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
              background: showAxisOpts ? "rgba(110,200,180,0.12)" : "none",
              color: showAxisOpts ? C.teal : C.textMuted,
              border: `1px solid ${showAxisOpts ? C.teal : C.border}`,
            }}>⊞ Axis</button>

          {/* History nav + Save + New */}
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
            {plotHistory.length > 0 && (<>
              <button onClick={navPrev} title="Previous saved plot (Alt+←)"
                disabled={plotHistory.length === 0}
                style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: C.textMuted, cursor: "pointer", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 6px", lineHeight: 1 }}>←</button>
              <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, minWidth: 38, textAlign: "center" }}>
                {histIdx !== null ? `${histIdx + 1}/${plotHistory.length}` : `—/${plotHistory.length}`}
              </span>
              <button onClick={navNext} title="Next saved plot (Alt+→)"
                disabled={histIdx === null}
                style={{ background: "none", border: `1px solid ${C.border}`, borderRadius: 3, color: histIdx !== null ? C.textMuted : C.border, cursor: histIdx !== null ? "pointer" : "default", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 6px", lineHeight: 1 }}>→</button>
            </>)}
            <button onClick={savePlot} disabled={layers.length === 0} title="Save current plot to history"
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: layers.length > 0 ? "pointer" : "not-allowed",
                background: layers.length > 0 ? C.teal : "none", color: layers.length > 0 ? C.bg : C.border,
                border: `1px solid ${layers.length > 0 ? C.teal : C.border}`,
              }}>Save</button>
            <button onClick={newPlot} title="Clear builder to start a new plot"
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                background: "none", color: C.textMuted, border: `1px solid ${C.border}`,
              }}>New</button>
            <select value={scriptLanguage} onChange={event => setScriptLanguage(event.target.value)} title="Replication script language"
              style={{
                padding: "3px 5px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                cursor: "pointer", background: C.bg, color: C.textMuted, border: `1px solid ${C.border}`,
              }}>
              <option value="r">R</option>
              <option value="python">Python</option>
              <option value="stata">Stata</option>
            </select>
            <button onClick={copyPlotScript} disabled={layers.length === 0} title={`Copy current plot as ${scriptLanguage}`}
              style={{
                padding: "3px 8px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize,
                cursor: layers.length > 0 ? "pointer" : "not-allowed",
                background: copiedLanguage === scriptLanguage ? `${C.teal}18` : "none",
                color: copiedLanguage === scriptLanguage ? C.teal : layers.length > 0 ? C.textMuted : C.border,
                border: `1px solid ${copiedLanguage === scriptLanguage ? C.teal : C.border}`,
              }}>{copiedLanguage === scriptLanguage ? "Copied ✓" : "Copy"}</button>
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
              { axis: "X", scale: xScale, setScale: setXScale, domain: xDomain, setDomain: setXDomain, fmt: xFmt, setFmt: setXFmt, catOrder: xCatOrder, setCatOrder: setXCatOrder },
              { axis: "Y", scale: yScale, setScale: setYScale, domain: yDomain, setDomain: setYDomain, fmt: yFmt, setFmt: setYFmt, catOrder: yCatOrder, setCatOrder: setYCatOrder },
            ].map(({ axis, scale, setScale, domain, setDomain, fmt, setFmt, catOrder, setCatOrder }) => (
              <div key={axis} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted, width: 8 }}>{axis}</span>
                {/* Scale type */}
                {["linear", "log", "sqrt"].map(s => (
                  <button key={s} onClick={() => setScale(s)}
                    style={{
                      padding: "2px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                      background: scale === s ? C.teal : "none",
                      color: scale === s ? C.bg : C.textMuted,
                      border: `1px solid ${scale === s ? C.teal : C.border}`,
                    }}>{s}</button>
                ))}
                {/* Limits */}
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.border }}>|</span>
                {["min", "max"].map((which, wi) => (
                  <input key={which} type="number" placeholder={which}
                    value={domain[wi] ?? ""}
                    onChange={e => {
                      const v = e.target.value === "" ? null : +e.target.value;
                      setDomain(d => wi === 0 ? [v, d[1]] : [d[0], v]);
                    }}
                    style={{
                      width: 52, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                      fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px", color: C.text, outline: "none",
                    }} />
                ))}
                {/* Tick format */}
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.border }}>|</span>
                <select value={fmt} onChange={e => setFmt(e.target.value)}
                  style={{
                    background: C.bg, border: `1px solid ${C.border}`, borderRadius: 3,
                    fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px", color: fmt ? C.text : C.textMuted,
                  }}>
                  <option value="">auto</option>
                  <option value=",">,000</option>
                  <option value=".1%">%</option>
                  <option value="$.2f">$</option>
                  <option value=".2f">.2f</option>
                  <option value=".3f">.3f</option>
                </select>
                {/* Category order — like ggplot scale_x_discrete(limits=c(...)) */}
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.border }}>|</span>
                <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>order</span>
                <input
                  value={catOrder}
                  onChange={e => setCatOrder(e.target.value)}
                  placeholder="cat1, cat2, …"
                  title={`Comma-separated category order for ${axis} axis (like scale_${axis.toLowerCase()}_discrete(limits=...))`}
                  style={{
                    width: 110, background: C.bg, border: `1px solid ${catOrder ? C.teal : C.border}`,
                    borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, padding: "2px 4px",
                    color: catOrder ? C.text : C.textMuted, outline: "none",
                  }} />
              </div>
            ))}
            {/* Reset all */}
            <button onClick={() => { setXScale("linear"); setYScale("linear"); setXDomain([null,null]); setYDomain([null,null]); setXFmt(""); setYFmt(""); setXCatOrder(""); setYCatOrder(""); }}
              style={{ padding: "2px 6px", borderRadius: 3, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer", background: "none", color: C.textMuted, border: `1px solid ${C.border}`, marginLeft: "auto" }}>
              reset
            </button>
          </div>
        )}
      </div>

      {/* ── BOTTOM: plot — all visible layers composited ────────────────────── */}
      <div ref={plotRef} title="Drag the lower-right corner to resize the plot" style={{ flex: "0 0 auto", height: 400, maxHeight: "70vh", padding: "0.65rem", overflow: "hidden", resize: "vertical", minHeight: 220, position: "relative" }}>
        {/* Error badge — outside canvasRef so it is NOT captured in PNG export */}
        {plotRenderError && (
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 20 }}>
            <button
              onClick={() => setShowPlotError(s => !s)}
              title="Plot render error — click for details"
              style={{
                background: `${C.gold}22`, border: `1px solid ${C.gold}66`,
                borderRadius: 3, padding: "2px 6px", cursor: "pointer",
                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.gold, lineHeight: 1.4,
              }}>⚠ error</button>
            {showPlotError && (
              <div style={{
                position: "absolute", right: 0, top: 24, zIndex: 30,
                background: C.surface, border: `1px solid ${C.gold}55`,
                borderRadius: 4, padding: "0.5rem 0.75rem",
                fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.text,
                maxWidth: 300, whiteSpace: "pre-wrap", wordBreak: "break-word",
                boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
              }}>{plotRenderError}</div>
            )}
          </div>
        )}
        {visibleLayers.length === 0 ? (
          <div style={{
            height: "100%", minHeight: 180, display: "flex", alignItems: "center",
            justifyContent: "center", flexDirection: "column", gap: 8,
            color: C.textMuted, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, textAlign: "center",
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
              xCatOrder={xCatOrder}
              yCatOrder={yCatOrder}
              onRenderError={setPlotRenderError}
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
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
              ◈ Plot History ({plotHistory.length})
              {compareIds.size === 2 && <span style={{ color: C.teal, marginLeft: 8 }}>▸ compare</span>}
            </span>
            <span style={{ fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.border }}>{histOpen ? "▲" : "▼"}</span>
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
                  index={i}
                  count={plotHistory.length}
                  isCompared={compareIds.has(entry.id)}
                  C={C}
                  datasetName={entry.datasetName}
                  foreign={!!(entry.datasetId && datasetId && entry.datasetId !== datasetId)}
                  onLoad={() => {
                    if (entry.datasetId && datasetId && entry.datasetId !== datasetId) onRequestDataset?.(entry.datasetId, entry.id);
                    else { loadPlotEntry(entry); setHistIdx(i); }
                  }}
                  onRename={(name) => renamePlot(entry.id, name)}
                  onMove={(dir) => movePlot(i, dir)}
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
              <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${C.border}`, background: C.bg }}>
                {/* Side-by-side canvases */}
                <div style={{ display: "flex", gap: 8, padding: "0.5rem 0.75rem", overflowX: "auto" }}>
                  <div style={{ flex: "1 1 0" }}>
                    <PlotCanvas layers={entA.layers} rows={rows} title={entA.name} xLabel={entA.xLabel} yLabel={entA.yLabel} width={hw} height={320} scheme={entA.scheme} showSE xScale={entA.xScale||"linear"} yScale={entA.yScale||"linear"} xDomain={entA.xDomain||[null,null]} yDomain={entA.yDomain||[null,null]} xFmt={entA.xFmt||""} yFmt={entA.yFmt||""} xCatOrder={entA.xCatOrder||""} yCatOrder={entA.yCatOrder||""} canvasRef={compareRefA} />
                  </div>
                  <div style={{ flex: "1 1 0" }}>
                    <PlotCanvas layers={entB.layers} rows={rows} title={entB.name} xLabel={entB.xLabel} yLabel={entB.yLabel} width={hw} height={320} scheme={entB.scheme} showSE xScale={entB.xScale||"linear"} yScale={entB.yScale||"linear"} xDomain={entB.xDomain||[null,null]} yDomain={entB.yDomain||[null,null]} xFmt={entB.xFmt||""} yFmt={entB.yFmt||""} xCatOrder={entB.xCatOrder||""} yCatOrder={entB.yCatOrder||""} canvasRef={compareRefB} />
                  </div>
                </div>
                {/* Single combined export bar */}
                <CombinedExportBar
                  getElA={() => compareRefA.current}
                  getElB={() => compareRefB.current}
                  filename={`${entA.name || "plot_A"}_${entB.name || "plot_B"}`}
                />
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
