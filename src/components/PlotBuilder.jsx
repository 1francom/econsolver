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
];

// Layer color cycle
const FILLS = [C.teal, C.gold, C.blue, "#c47070", "#a87ec8", "#7ab896", C.orange];

function genId() { return "ly_" + Math.random().toString(36).slice(2, 8); }

function mkLayer(geom, idx) {
  return {
    id:      genId(),
    geom,
    aes:     { x: "", y: "", color: "" },
    fill:    FILLS[idx % FILLS.length],
    visible: true,
  };
}

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
        if (aes.x && aes.y)
          marks.push(Plt.dot(rows, { x: aes.x, y: aes.y, fill: colorVal, r: 3, fillOpacity: 0.75 }));
        break;

      case "line":
        if (aes.x && aes.y)
          marks.push(Plt.line(rows, { x: aes.x, y: aes.y, stroke: colorVal, strokeWidth: 1.8 }));
        break;

      case "bar":
        if (aes.x && aes.y)
          marks.push(Plt.barY(rows, { x: aes.x, y: aes.y, fill: colorVal }));
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

// ─── PLOT CANVAS ──────────────────────────────────────────────────────────────
function PlotCanvas({ layers, rows, xLabel, yLabel, width }) {
  const ref  = useRef(null);
  const [Plt, setPlt]  = useState(null);
  const [err, setErr]  = useState(null);

  // Load Observable Plot once
  useEffect(() => {
    loadPlot().then(setPlt).catch(() => setErr("Could not load Observable Plot. Check internet connection."));
  }, []);

  // Re-render whenever layers / data / labels change
  useEffect(() => {
    if (!Plt || !ref.current) return;
    const container = ref.current;
    try {
      const marks = buildMarks(Plt, layers, rows);
      const hasY  = layers.some(ly => ly.visible && ly.aes.y);
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
        marks,
      });
      patchDarkTheme(el);
      container.innerHTML = "";
      container.appendChild(el);
    } catch (e) {
      container.innerHTML = `<div style="color:${C.red};font-family:${mono};font-size:11px;padding:1rem">Plot error: ${e.message}</div>`;
    }
    return () => { if (ref.current) ref.current.innerHTML = ""; };
  }, [Plt, layers, rows, xLabel, yLabel, width]);

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
  const noY = ["histogram", "density"].includes(layer.geom);
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

      {/* Aesthetic mappings */}
      <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: mono, marginBottom: 7 }}>
        Aesthetics
      </div>
      <AesRow label="x" value={layer.aes.x}
        onChange={v => onChange({ ...layer, aes: { ...layer.aes, x: v } })}
        headers={headers} />
      {!noY && (
        <AesRow label="y" value={layer.aes.y}
          onChange={v => onChange({ ...layer, aes: { ...layer.aes, y: v } })}
          headers={headers} />
      )}
      <AesRow label="color" value={layer.aes.color}
        onChange={v => onChange({ ...layer, aes: { ...layer.aes, color: v } })}
        headers={headers} optional />

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
export default function PlotBuilder({ headers = [], rows = [], style }) {
  const [layers,   setLayers]   = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [title,    setTitle]    = useState("");
  const [xLabel,   setXLabel]   = useState("");
  const [yLabel,   setYLabel]   = useState("");

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

        {/* Labels */}
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
        </div>
      </div>

      {/* ── CENTER: plot canvas ────────────────────────────────────────────── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {title && (
          <div style={{
            padding: "0.5rem 0.85rem", fontFamily: mono, fontSize: 12,
            color: C.text, borderBottom: `1px solid ${C.border}`, letterSpacing: "0.02em",
          }}>
            {title}
          </div>
        )}
        {layers.length === 0 ? (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            color: C.textMuted, fontFamily: mono, fontSize: 10, padding: "2rem", textAlign: "center",
          }}>
            Add a layer and pick X / Y columns to render a plot.
          </div>
        ) : (
          <div style={{ padding: "0.65rem" }}>
            <PlotCanvas
              layers={layers}
              rows={rows}
              xLabel={xLabel}
              yLabel={yLabel}
              width={canvasW}
            />
          </div>
        )}
      </div>
    </div>
  );
}
