// ─── ECON STUDIO · src/components/PlotBuilder.jsx ────────────────────────────
// G1: layer-based plot builder (layer list, geom picker, aesthetic mappings)
// G2: basic geoms — point, line, bar, histogram, density
// G8: labels panel — title, x/y axis
//
// Rendering: Observable Plot 0.6 via CDN (MIT, ggplot-grammar, no bundle cost)
//
// Props:
//   headers  string[]   — column names for aesthetic dropdowns
//   rows     object[]   — data rows (pipeline output)
//   style    object     — optional container style overrides

import { useState, useEffect, useRef, useCallback } from "react";
import { C, mono } from "./modeling/shared.jsx";

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
  { id: "smooth",    label: "Smooth"    },  // G3
  { id: "boxplot",   label: "Boxplot"   },  // G3
  { id: "errorbar",  label: "Errorbar"  },  // G3
  { id: "ribbon",    label: "Ribbon"    },  // G3
  { id: "hline",     label: "H-Line"    },  // G6
  { id: "vline",     label: "V-Line"    },  // G6
];

// G7 — color palette presets (Observable Plot built-in schemes)
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

// Layer color cycle
const FILLS = [C.teal, C.gold, C.blue, "#c47070", "#a87ec8", "#7ab896", C.orange];

function genId() { return "ly_" + Math.random().toString(36).slice(2, 8); }

function mkLayer(geom, idx) {
  return {
    id:       genId(),
    geom,
    aes:      { x: "", y: "", color: "", yMin: "", yMax: "" },
    value:    "",   // numeric reference value for hline / vline
    position: "identity",  // G5: "identity" | "stack" | "jitter"
    fill:     FILLS[idx % FILLS.length],
    visible:  true,
  };
}

// G5 — which geoms support position adjustments
const POSITION_OPTIONS = {
  bar:   ["identity", "stack"],
  point: ["identity", "jitter"],
};

// ─── BUILD MARKS ──────────────────────────────────────────────────────────────
// Convert layer array → Observable Plot mark array.
// When aes.color names a column it acts as a channel; otherwise fall back to
// the manual fill color (CSS string → literal).
function buildMarks(Plt, layers, rows) {
  const marks = [];

  for (const ly of layers) {
    if (!ly.visible) continue;
    const { geom, aes, fill } = ly;
    const colorVal = aes.color || fill;   // column name OR CSS color

    switch (geom) {
      case "point":
        if (aes.x && aes.y) {
          if (ly.position === "jitter") {
            // dodgeX spreads overlapping points horizontally — deterministic, no random noise
            marks.push(Plt.dot(rows, Plt.dodgeX("middle", {
              x: aes.x, y: aes.y, fill: colorVal, r: 3, fillOpacity: 0.75, padding: 1,
            })));
          } else {
            marks.push(Plt.dot(rows, { x: aes.x, y: aes.y, fill: colorVal, r: 3, fillOpacity: 0.75 }));
          }
        }
        break;

      case "line":
        if (aes.x && aes.y)
          marks.push(Plt.line(rows, { x: aes.x, y: aes.y, stroke: colorVal, strokeWidth: 1.8 }));
        break;

      case "bar":
        if (aes.x && aes.y) {
          if (ly.position === "stack") {
            marks.push(Plt.barY(rows, Plt.stackY({ x: aes.x, y: aes.y, fill: colorVal })));
          } else {
            marks.push(Plt.barY(rows, { x: aes.x, y: aes.y, fill: colorVal }));
          }
        }
        break;

      case "histogram":
        if (aes.x)
          marks.push(Plt.rectY(rows, Plt.binX({ y: "count" }, {
            x: aes.x, fill: colorVal, fillOpacity: 0.8,
          })));
        break;

      case "density":
        // 1-D density approximation via proportion bins
        if (aes.x) {
          marks.push(Plt.areaY(rows, Plt.binX({ y: "proportion" }, {
            x: aes.x, fill: colorVal, fillOpacity: 0.2,
          })));
          marks.push(Plt.lineY(rows, Plt.binX({ y: "proportion" }, {
            x: aes.x, stroke: colorVal, strokeWidth: 1.8,
          })));
        }
        break;

      // ── G3: advanced geoms ────────────────────────────────────────────────
      case "smooth":
        if (aes.x && aes.y)
          marks.push(Plt.linearRegressionY(rows, {
            x: aes.x, y: aes.y, stroke: colorVal, strokeWidth: 2, strokeOpacity: 0.85,
          }));
        break;

      case "boxplot":
        if (aes.y)
          marks.push(Plt.boxY(rows, {
            x: aes.x || undefined, y: aes.y,
            fill: colorVal, fillOpacity: 0.65,
          }));
        break;

      case "errorbar":
        if (aes.x && aes.yMin && aes.yMax) {
          // vertical rule from yMin to yMax
          marks.push(Plt.ruleX(rows, {
            x: aes.x, y1: aes.yMin, y2: aes.yMax,
            stroke: colorVal, strokeWidth: 1.5,
          }));
          // caps at yMin and yMax
          marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMin, stroke: colorVal }));
          marks.push(Plt.tickX(rows, { x: aes.x, y: aes.yMax, stroke: colorVal }));
        }
        break;

      case "ribbon":
        if (aes.x && aes.yMin && aes.yMax)
          marks.push(Plt.areaY(rows, {
            x: aes.x, y1: aes.yMin, y2: aes.yMax,
            fill: colorVal, fillOpacity: 0.25,
          }));
        break;

      // ── G6: reference lines ───────────────────────────────────────────────
      case "hline": {
        const hv = parseFloat(ly.value);
        if (!isNaN(hv))
          marks.push(Plt.ruleY([hv], {
            stroke: colorVal, strokeDasharray: "5 3", strokeOpacity: 0.85, strokeWidth: 1.5,
          }));
        break;
      }

      case "vline": {
        const vv = parseFloat(ly.value);
        if (!isNaN(vv))
          marks.push(Plt.ruleX([vv], {
            stroke: colorVal, strokeDasharray: "5 3", strokeOpacity: 0.85, strokeWidth: 1.5,
          }));
        break;
      }
    }
  }

  // Grid + border (dark theme)
  marks.push(Plt.gridX({ stroke: "#1c1c1c", strokeOpacity: 1 }));
  marks.push(Plt.gridY({ stroke: "#1c1c1c", strokeOpacity: 1 }));
  marks.push(Plt.frame({ stroke: "#252525" }));

  return marks;
}

// ─── PATCH DARK THEME ─────────────────────────────────────────────────────────
// Observable Plot renders with currentColor; setting `color` on the container
// handles most text. Axis tick lines default to black — patch them here.
function patchDarkTheme(el) {
  el.querySelectorAll("line[stroke='black'], line[stroke='#000']").forEach(l => {
    l.setAttribute("stroke", "#252525");
  });
}

// ─── SVG EXPORT (G9) ─────────────────────────────────────────────────────────
function exportSVG(containerEl, filename = "plot.svg") {
  const svg = containerEl?.querySelector("svg");
  if (!svg) return;
  const clone = svg.cloneNode(true);
  // Embed white background for standalone SVG
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const blob = new Blob([clone.outerHTML], { type: "image/svg+xml" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function exportPNG(containerEl, filename = "plot.png") {
  const svg = containerEl?.querySelector("svg");
  if (!svg) return;
  const { width, height } = svg.getBoundingClientRect();
  const blob  = new Blob([svg.outerHTML], { type: "image/svg+xml" });
  const url   = URL.createObjectURL(blob);
  const img   = new Image();
  img.onload  = () => {
    const canvas = document.createElement("canvas");
    canvas.width  = width  * 2;   // 2× for retina
    canvas.height = height * 2;
    const ctx = canvas.getContext("2d");
    ctx.scale(2, 2);
    ctx.fillStyle = "#080808";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    URL.revokeObjectURL(url);
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png"); a.download = filename; a.click();
  };
  img.src = url;
}

// ─── PLOT CANVAS ──────────────────────────────────────────────────────────────
function PlotCanvas({ layers, rows, xLabel, yLabel, width, scheme, canvasRef }) {
  const ownRef = useRef(null);
  const ref    = canvasRef ?? ownRef;
  const [Plt, setPlt]  = useState(null);
  const [err, setErr]  = useState(null);

  // Load Observable Plot once
  useEffect(() => {
    loadPlot().then(setPlt).catch(() => setErr("Could not load Observable Plot. Check internet connection."));
  }, []);

  // Re-render whenever layers / data / labels / scheme change
  useEffect(() => {
    if (!Plt || !ref.current) return;
    const container = ref.current;
    try {
      const marks = buildMarks(Plt, layers, rows);
      const colorOpts = scheme ? { scheme } : {};
      const el    = Plt.plot({
        width:        width || 580,
        height:       320,
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

  if (err) return (
    <div style={{ color: C.red, fontFamily: mono, fontSize: 11, padding: "1.5rem" }}>{err}</div>
  );
  if (!Plt) return (
    <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "1.5rem" }}>
      Loading Observable Plot…
    </div>
  );
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
function LayerCard({ layer, isActive, onSelect, onToggle, onRemove }) {
  return (
    <div
      onClick={onSelect}
      style={{
        display: "flex", alignItems: "center", gap: 6,
        padding: "5px 7px", borderRadius: 3, marginBottom: 3,
        background: isActive ? `${C.teal}12` : "transparent",
        border: `1px solid ${isActive ? C.teal + "40" : "transparent"}`,
        cursor: "pointer",
      }}
    >
      <div style={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: layer.fill }} />
      <span style={{
        flex: 1, fontFamily: mono, fontSize: 10,
        color: isActive ? C.teal : C.text,
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
      }}>
        {layer.geom}{layer.aes.x ? ` · ${layer.aes.x}` : ""}
      </span>
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

      {/* G5 — Position adjustment (only for geoms that support it) */}
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

      {/* Aesthetic mappings */}
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 7 }}>
        Aesthetics
      </div>

      {/* Reference-line value input (G6) */}
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

      {/* Manual fill color when no color mapping */}
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
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function PlotBuilder({ headers = [], rows = [], style, initialLayers = [] }) {
  const [layers,   setLayers]   = useState(initialLayers);
  const [activeId, setActiveId] = useState(initialLayers[0]?.id ?? null);
  const [title,    setTitle]    = useState("");
  const [xLabel,   setXLabel]   = useState("");
  const [yLabel,   setYLabel]   = useState("");
  const [scheme,   setScheme]   = useState("");   // G7 color palette
  const canvasRef = useRef(null);                  // G9 export target

  // Responsive canvas width via ResizeObserver on the container
  const containerRef  = useRef(null);
  const [canvasW, setCanvasW] = useState(560);
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
    setLayers(prev => prev.filter(l => l.id !== id));
    setActiveId(prev => prev === id ? null : prev);
  }, []);

  const activeLayer = layers.find(l => l.id === activeId) ?? null;

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
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>
            Layers
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

        {/* Labels + Palette (G7) */}
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {/* Title + G9 export toolbar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0.4rem 0.85rem", borderBottom: `1px solid ${C.border}`, minHeight: 32,
        }}>
          <span style={{ fontFamily: mono, fontSize: 12, color: C.text, letterSpacing: "0.02em" }}>
            {title}
          </span>
          {layers.length > 0 && (
            <div style={{ display: "flex", gap: 5 }}>
              <button
                onClick={() => exportSVG(canvasRef.current, (title || "plot") + ".svg")}
                title="Download SVG"
                style={{
                  padding: "2px 8px", fontFamily: mono, fontSize: 9, cursor: "pointer",
                  background: "none", border: `1px solid ${C.border}`, borderRadius: 3,
                  color: C.textMuted,
                }}
              >SVG</button>
              <button
                onClick={() => exportPNG(canvasRef.current, (title || "plot") + ".png")}
                title="Download PNG"
                style={{
                  padding: "2px 8px", fontFamily: mono, fontSize: 9, cursor: "pointer",
                  background: "none", border: `1px solid ${C.border}`, borderRadius: 3,
                  color: C.textMuted,
                }}
              >PNG</button>
            </div>
          )}
        </div>

        {layers.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "2rem", textAlign: "center",
          }}>
            Add a layer and pick X / Y columns to render a plot.
          </div>
        ) : (
          <div ref={canvasRef} style={{ padding: "0.65rem" }}>
            <PlotCanvas
              layers={layers}
              rows={rows}
              xLabel={xLabel}
              yLabel={yLabel}
              width={canvasW}
              scheme={scheme}
            />
          </div>
        )}
      </div>
    </div>
  );
}
