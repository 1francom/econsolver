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
import { C, mono } from "./modeling/shared.jsx";
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

const FILLS = [C.teal, C.gold, C.blue, "#c47070", "#a87ec8", "#7ab896", C.orange];

const POSITION_OPTIONS = {
  bar:   ["identity", "stack"],
  point: ["identity", "jitter"],
};

function genId() { return "ly_" + Math.random().toString(36).slice(2, 8); }

function mkLayer(geom, idx) {
  return {
    id:       genId(),
    geom,
    aes:      { x: "", y: "", color: "", yMin: "", yMax: "" },
    value:    "",
    position: "identity",
    fill:     FILLS[idx % FILLS.length],
    visible:  true,
    opacity:  1.0,   // G10.2 — per-layer alpha (0–1)
    pinned:   false, // G10.4 — included in comparison view
  };
}

// ─── BUILD MARKS FOR A SINGLE LAYER ──────────────────────────────────────────
// Returns an array of Observable Plot marks for one layer.
// opacity is applied to every fillOpacity/strokeOpacity.
function buildMarksForLayer(Plt, ly, rows) {
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
          x: aes.x, y: aes.y, stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.88 * op,
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
function PlotCanvas({ layers, rows, xLabel, yLabel, width, height, scheme, canvasRef }) {
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
        marks.push(...buildMarksForLayer(Plt, ly, rows));
      }
      // Grid + frame always present
      marks.push(Plt.gridX({ stroke: "#1c1c1c", strokeOpacity: 1 }));
      marks.push(Plt.gridY({ stroke: "#1c1c1c", strokeOpacity: 1 }));
      marks.push(Plt.frame({ stroke: "#252525" }));

      const colorOpts = scheme ? { scheme } : {};
      const el = Plt.plot({
        width:        width || 580,
        height:       height || 310,
        marginLeft:   52,
        marginBottom: 40,
        style: {
          background: "transparent",
          color:      C.text,
          fontFamily: mono,
          fontSize:   "10px",
          overflow:   "visible",
        },
        x: { label: xLabel || null, labelOffset: 34 },
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
  return <div ref={ref} style={{ width: "100%", overflow: "hidden" }} />;
}

// ─── AES ROW ─────────────────────────────────────────────────────────────────
function AesRow({ label, value, onChange, headers, optional }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
      <span style={{ width: 38, fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0, textAlign: "right" }}>
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          flex: 1, background: C.bg, border: `1px solid ${value ? C.border2 : C.border}`,
          borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px",
          color: value ? C.text : C.textMuted,
        }}
      >
        <option value="">{optional ? "— none —" : "— pick column —"}</option>
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}

// ─── LAYER CARD ───────────────────────────────────────────────────────────────
function LayerCard({ layer, isActive, onSelect, onToggle, onPin, onRemove }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 5,
        padding: "5px 7px", borderRadius: 3, marginBottom: 3,
        background: isActive ? `${C.teal}12` : "transparent",
        border: `1px solid ${isActive ? C.teal + "40" : "transparent"}`,
        cursor: "pointer",
      }}
    >
      {/* Pin checkbox for comparison */}
      <input
        type="checkbox"
        checked={!!layer.pinned}
        onChange={e => { e.stopPropagation(); onPin(); }}
        onClick={e => e.stopPropagation()}
        title="Include in comparison"
        style={{ cursor: "pointer", accentColor: C.gold, margin: 0, flexShrink: 0 }}
      />
      <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: layer.fill }} />
      <span style={{
        flex: 1, fontFamily: mono, fontSize: 10,
        color: isActive ? C.teal : C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {layer.geom}{layer.aes.x ? ` · ${layer.aes.x}` : ""}
      </span>
      {/* Opacity badge */}
      {layer.opacity < 0.99 && (
        <span style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, flexShrink: 0 }}>
          {Math.round(layer.opacity * 100)}%
        </span>
      )}
      <button
        onClick={e => { e.stopPropagation(); onToggle(); }}
        title={layer.visible ? "Hide" : "Show"}
        style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0 2px", color: layer.visible ? C.textDim : C.textMuted }}
      >{layer.visible ? "●" : "○"}</button>
      <button
        onClick={e => { e.stopPropagation(); onRemove(); }}
        title="Remove layer"
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: 13, padding: "0 2px", lineHeight: 1, color: C.textMuted }}
      >×</button>
    </div>
  );
}

// ─── LAYER EDITOR ─────────────────────────────────────────────────────────────
function LayerEditor({ layer, onChange, headers }) {
  const isRefLine    = ["hline", "vline"].includes(layer.geom);
  const needsYMinMax = ["errorbar", "ribbon"].includes(layer.geom);
  const noY          = ["histogram", "density", "hline", "vline"].includes(layer.geom);
  const noX          = ["hline", "vline"].includes(layer.geom);

  return (
    <div>
      {/* Geom selector */}
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 7 }}>
        Geom
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 12 }}>
        {GEOMS.map(g => (
          <button
            key={g.id}
            onClick={() => onChange({ ...layer, geom: g.id })}
            style={{
              padding: "3px 7px", borderRadius: 3, fontFamily: mono, fontSize: 9,
              cursor: "pointer",
              background: layer.geom === g.id ? `${C.teal}18` : "transparent",
              border: `1px solid ${layer.geom === g.id ? C.teal + "60" : C.border}`,
              color: layer.geom === g.id ? C.teal : C.textMuted,
            }}
          >{g.label}</button>
        ))}
      </div>

      {/* Position */}
      {POSITION_OPTIONS[layer.geom] && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 7 }}>
            Position
          </div>
          <div style={{ display: "flex", gap: 4 }}>
            {POSITION_OPTIONS[layer.geom].map(pos => (
              <button
                key={pos}
                onClick={() => onChange({ ...layer, position: pos })}
                style={{
                  padding: "3px 9px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                  cursor: "pointer",
                  background: layer.position === pos ? `${C.gold}18` : "transparent",
                  border: `1px solid ${layer.position === pos ? C.gold + "60" : C.border}`,
                  color: layer.position === pos ? C.gold : C.textMuted,
                }}
              >{pos}</button>
            ))}
          </div>
        </div>
      )}

      {/* Aesthetics */}
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 7 }}>
        Aesthetics
      </div>

      {isRefLine && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 5 }}>
          <span style={{ width: 38, fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0, textAlign: "right" }}>value</span>
          <input
            type="number"
            value={layer.value ?? ""}
            onChange={e => onChange({ ...layer, value: e.target.value })}
            placeholder="0"
            style={{
              flex: 1, background: C.bg, border: `1px solid ${C.border}`,
              borderRadius: 3, fontFamily: mono, fontSize: 10, padding: "3px 5px",
              color: C.text, outline: "none",
            }}
          />
        </div>
      )}

      {!noX && (
        <AesRow label="x" value={layer.aes.x}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, x: v } })}
          headers={headers} optional={["boxplot"].includes(layer.geom)} />
      )}
      {!noY && (
        <AesRow label="y" value={layer.aes.y}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, y: v } })}
          headers={headers} />
      )}
      {needsYMinMax && (<>
        <AesRow label="yMin" value={layer.aes.yMin ?? ""}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, yMin: v } })}
          headers={headers} />
        <AesRow label="yMax" value={layer.aes.yMax ?? ""}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, yMax: v } })}
          headers={headers} />
      </>)}
      {!isRefLine && (
        <AesRow label="color" value={layer.aes.color}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, color: v } })}
          headers={headers} optional />
      )}

      {/* Manual fill color */}
      {!layer.aes.color && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 4 }}>
          <span style={{ width: 38, fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0, textAlign: "right" }}>fill</span>
          <input
            type="color"
            value={layer.fill}
            onChange={e => onChange({ ...layer, fill: e.target.value })}
            style={{ width: 30, height: 22, border: "none", background: "none", cursor: "pointer", padding: 0 }}
          />
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>{layer.fill}</span>
        </div>
      )}

      {/* G10.2 — Opacity slider */}
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 6 }}>
          Opacity
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={layer.opacity ?? 1}
            onChange={e => onChange({ ...layer, opacity: +e.target.value })}
            style={{ flex: 1, accentColor: C.teal, cursor: "pointer" }}
          />
          <span style={{ fontFamily: mono, fontSize: 9, color: C.textDim, width: 28, textAlign: "right", flexShrink: 0 }}>
            {Math.round((layer.opacity ?? 1) * 100)}%
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── COMPARISON PANEL ─────────────────────────────────────────────────────────
// Renders pinned layers side-by-side or overlaid
function ComparisonPanel({ pinnedLayers, rows, xLabel, yLabel, w, scheme, overlayMode }) {
  const canvasRefs = [useRef(null), useRef(null), useRef(null)];

  if (overlayMode) {
    // Overlay: all pinned layers on one canvas with per-layer opacity
    return (
      <div>
        <PlotCanvas
          layers={pinnedLayers}
          rows={rows}
          xLabel={xLabel}
          yLabel={yLabel}
          width={w}
          scheme={scheme}
          canvasRef={canvasRefs[0]}
        />
      </div>
    );
  }

  // Side-by-side: each pinned layer gets its own canvas
  const panelW = Math.max(200, Math.floor((w - (pinnedLayers.length - 1) * 12) / pinnedLayers.length));
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
      {pinnedLayers.map((ly, i) => (
        <div key={ly.id} style={{ flex: "1 1 0", minWidth: 200 }}>
          <div style={{ fontFamily: mono, fontSize: 9, color: ly.fill, marginBottom: 4, letterSpacing: "0.1em" }}>
            {ly.geom}{ly.aes.x ? ` · ${ly.aes.x}` : ""}{ly.aes.y ? ` / ${ly.aes.y}` : ""}
          </div>
          <PlotCanvas
            layers={[{ ...ly, opacity: ly.opacity ?? 1 }]}
            rows={rows}
            xLabel={xLabel}
            yLabel={yLabel}
            width={panelW}
            scheme={scheme}
            canvasRef={canvasRefs[i]}
          />
        </div>
      ))}
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [] }) {
  const [layers,      setLayers]      = useState(initialLayers);
  const [activeId,    setActiveId]    = useState(initialLayers[0]?.id ?? null);
  const [title,       setTitle]       = useState("");
  const [xLabel,      setXLabel]      = useState("");
  const [yLabel,      setYLabel]      = useState("");
  const [scheme,      setScheme]      = useState("");
  const [overlayMode, setOverlayMode] = useState(false); // G10.4
  const canvasRef   = useRef(null);
  const containerRef = useRef(null);
  const centerRef    = useRef(null);
  const [canvasW, setCanvasW] = useState(560);
  const [canvasH, setCanvasH] = useState(440);

  // Track container width (for canvas width calculation)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w) setCanvasW(Math.max(280, Math.round(w) - 242));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Track center panel height (for single-layer full-height canvas)
  useEffect(() => {
    const el = centerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const h = entries[0]?.contentRect.height;
      if (h) setCanvasH(Math.max(280, Math.round(h) - 48)); // subtract toolbar
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

  const updateLayer  = useCallback(updated =>
    setLayers(prev => prev.map(l => l.id === updated.id ? updated : l)), []);

  const removeLayer  = useCallback(id => {
    setLayers(prev => prev.filter(l => l.id !== id));
    setActiveId(prev => prev === id ? null : prev);
  }, []);

  const togglePin = useCallback(id =>
    setLayers(prev => prev.map(l => l.id === id ? { ...l, pinned: !l.pinned } : l)), []);

  const activeLayer  = layers.find(l => l.id === activeId) ?? null;
  const pinnedLayers = layers.filter(l => l.pinned && l.visible);
  const isComparing  = pinnedLayers.length >= 2;

  return (
    <div
      ref={containerRef}
      style={{
        display: "flex", background: C.surface, border: `1px solid ${C.border}`,
        borderRadius: 4, overflow: "hidden", minHeight: 380, ...style,
      }}
    >
      {/* ── LEFT PANEL ────────────────────────────────────────────────────── */}
      <div style={{
        width: 232, flexShrink: 0, borderRight: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
      }}>

        {/* Layer list */}
        <div style={{ padding: "0.75rem 0.65rem 0.6rem", borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
            <span style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono }}>
              Layers
            </span>
            {/* Comparison hint */}
            {layers.length > 0 && (
              <span style={{ fontSize: 8, color: C.textMuted, fontFamily: mono }}>
                ☐ = compare
              </span>
            )}
          </div>
          {layers.length === 0 && (
            <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, marginBottom: 6 }}>No layers yet.</div>
          )}
          {layers.map(ly => (
            <LayerCard
              key={ly.id}
              layer={ly}
              isActive={ly.id === activeId}
              onSelect={() => setActiveId(ly.id)}
              onToggle={() => updateLayer({ ...ly, visible: !ly.visible })}
              onPin={() => togglePin(ly.id)}
              onRemove={() => removeLayer(ly.id)}
            />
          ))}

          {/* Add layer buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {GEOMS.map(g => (
              <button
                key={g.id}
                onClick={() => addLayer(g.id)}
                title={`Add ${g.label} layer`}
                style={{
                  padding: "3px 7px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                  background: "none", border: `1px dashed ${C.border2}`,
                  color: C.textMuted, cursor: "pointer",
                }}
              >+{g.label}</button>
            ))}
          </div>
        </div>

        {/* Active layer editor */}
        <div style={{ flex: 1, padding: "0.75rem 0.65rem", overflowY: "auto" }}>
          {activeLayer
            ? <LayerEditor layer={activeLayer} onChange={updateLayer} headers={headers} />
            : <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>Select a layer to configure its aesthetics.</div>
          }
        </div>

        {/* Labels + Palette */}
        <div style={{ padding: "0.65rem", borderTop: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>
            Labels
          </div>
          {[
            { lbl: "Title",  val: title,  set: setTitle  },
            { lbl: "X axis", val: xLabel, set: setXLabel },
            { lbl: "Y axis", val: yLabel, set: setYLabel },
          ].map(({ lbl, val, set }) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 5 }}>
              <span style={{ width: 38, fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0 }}>{lbl}</span>
              <input
                value={val}
                onChange={e => set(e.target.value)}
                placeholder={lbl.toLowerCase()}
                style={{
                  flex: 1, background: C.bg, border: `1px solid ${C.border}`,
                  borderRadius: 3, fontFamily: mono, fontSize: 9, padding: "3px 5px",
                  color: C.text, outline: "none",
                }}
              />
            </div>
          ))}
          {/* G7 — palette preset */}
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <span style={{ width: 38, fontFamily: mono, fontSize: 9, color: C.textMuted, flexShrink: 0 }}>palette</span>
            <select
              value={scheme}
              onChange={e => setScheme(e.target.value)}
              style={{
                flex: 1, background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: 3, fontFamily: mono, fontSize: 9, padding: "3px 5px",
                color: scheme ? C.text : C.textMuted,
              }}
            >
              {PALETTE_PRESETS.map(p => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* ── CENTER: plot canvas ────────────────────────────────────────────── */}
      <div ref={centerRef} style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>

        {/* Toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.4rem 0.85rem", borderBottom: `1px solid ${C.border}`, minHeight: 32,
          gap: 8,
        }}>
          <span style={{ fontFamily: mono, fontSize: 12, color: C.text, letterSpacing: "0.02em" }}>
            {title}
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {/* G10.4 — comparison mode toggle */}
            {isComparing && (
              <div style={{ display: "flex", gap: 4 }}>
                {["side-by-side", "overlay"].map(mode => (
                  <button
                    key={mode}
                    onClick={() => setOverlayMode(mode === "overlay")}
                    style={{
                      padding: "2px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9,
                      cursor: "pointer", border: `1px solid ${C.border2}`,
                      background: (mode === "overlay") === overlayMode ? `${C.gold}18` : "transparent",
                      color: (mode === "overlay") === overlayMode ? C.gold : C.textMuted,
                    }}
                  >{mode}</button>
                ))}
              </div>
            )}
            {layers.length > 0 && (
              <PlotExportBar
                getEl={() => canvasRef.current}
                filename={title || "plot"}
                style={{ border: "none", padding: "0 0.35rem", background: "transparent", borderTop: "none" }}
              />
            )}
          </div>
        </div>

        {/* Canvas area */}
        {layers.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "2rem", textAlign: "center",
          }}>
            Add a layer and pick X / Y columns to render a plot.
            <br /><br />
            <span style={{ fontSize: 9 }}>Tick the ☐ checkbox on 2–3 layers to compare them side-by-side or overlaid.</span>
          </div>
        ) : isComparing ? (
          /* G10.4 — comparison view */
          <div ref={canvasRef} style={{ padding: "0.65rem", overflowX: "auto" }}>
            <ComparisonPanel
              pinnedLayers={pinnedLayers}
              rows={rows}
              xLabel={xLabel}
              yLabel={yLabel}
              w={canvasW}
              scheme={scheme}
              overlayMode={overlayMode}
            />
          </div>
        ) : (
          /* Single active layer */
          <div ref={canvasRef} style={{ padding: "0.65rem", flex: 1 }}>
            {activeLayer ? (
              <PlotCanvas
                layers={[activeLayer]}
                rows={rows}
                xLabel={xLabel}
                yLabel={yLabel}
                width={canvasW}
                height={canvasH}
                scheme={scheme}
              />
            ) : (
              <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "2rem", textAlign: "center" }}>
                Select a layer in the left panel to preview it.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
