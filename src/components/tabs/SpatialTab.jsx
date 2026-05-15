// ─── ECON STUDIO · SpatialTab.jsx ────────────────────────────────────────────
// Spatial analytics module — Phase 11.
// Sections: Distance · Buffer · Grid Assignment · Spatial Join · Nearest Neighbour · Geocode
// All operations call SpatialEngine.js (pure JS, no backend).

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { HintBox } from "../HelpSystem.jsx";
import { getPlotHistory, savePlotHistory } from "../../services/Persistence/plotHistory.js";
import {
  haversine,
  assignDistance,
  assignBuffer,
  assignRectGrid,
  assignH3Grid,
  spatialJoin,
  nearestNeighbor,
  assignBoundaryDistance,
  makeGrid,
  aggregateToGrid,
} from "../../math/SpatialEngine.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

// ─── LEAFLET CDN LOADER ───────────────────────────────────────────────────────
let _leafletPromiseST = null;
function loadLeaflet() {
  if (typeof window !== "undefined" && window.L) return Promise.resolve(window.L);
  if (_leafletPromiseST) return _leafletPromiseST;
  _leafletPromiseST = new Promise((resolve, reject) => {
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.onload = () => { _leafletPromiseST = null; resolve(window.L); };
    script.onerror = () => { _leafletPromiseST = null; reject(new Error("Leaflet load failed")); };
    document.head.appendChild(script);
  });
  return _leafletPromiseST;
}

// ─── WKT PARSER ──────────────────────────────────────────────────────────────
// Returns Leaflet-compatible [lat, lon] ring arrays from a WKT string.
// Handles POINT, POLYGON, MULTIPOLYGON.
function wktToLeaflet(wkt) {
  if (!wkt || typeof wkt !== "string") return null;
  const s = wkt.trim().toUpperCase();

  const coordPair = str => {
    const [lon, lat] = str.trim().split(/\s+/).map(Number);
    return isNaN(lat) || isNaN(lon) ? null : [lat, lon];
  };
  const ring = str => str.split(",").map(coordPair).filter(Boolean);

  if (s.startsWith("POINT")) {
    const m = wkt.match(/POINT\s*\(\s*([^)]+)\)/i);
    if (!m) return null;
    const p = coordPair(m[1]);
    return p ? { type: "point", latlng: p } : null;
  }
  if (s.startsWith("MULTIPOLYGON")) {
    const polys = [];
    const re = /\(\(([^()]+)\)\)/g;
    let m;
    while ((m = re.exec(wkt)) !== null) polys.push([ring(m[1])]);
    return polys.length ? { type: "multipolygon", rings: polys } : null;
  }
  if (s.startsWith("POLYGON")) {
    const outer = wkt.match(/POLYGON\s*\(\(([^()]+)\)/i);
    if (!outer) return null;
    return { type: "polygon", rings: [ring(outer[1])] };
  }
  return null;
}

// ─── COLOR HELPERS ────────────────────────────────────────────────────────────
const CAT_PALETTE = ["#6ec8b4","#c8a96e","#6e9ec8","#c47070","#a87ec8","#7ab896","#c88e6e","#c8c46e","#6ec8c4"];

function buildColorScale(rows, col) {
  if (!col) return { getColor: () => null, legend: null };
  const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== "");
  if (!vals.length) return { getColor: () => null, legend: null };
  const isNum = vals.every(v => !isNaN(parseFloat(v)));
  if (isNum) {
    const nums = vals.map(Number);
    const mn = Math.min(...nums), mx = Math.max(...nums), rng = mx - mn || 1;
    const getColor = row => {
      const v = row[col];
      if (v === null || v === undefined || v === "") return null;
      const t = (Number(v) - mn) / rng;
      const r = Math.round(110 + t * 90);   // 110→200
      const g = Math.round(200 - t * 31);   // 200→169
      const b = Math.round(180 - t * 70);   // 180→110
      return `rgb(${r},${g},${b})`;
    };
    return { getColor, legend: { type: "gradient", min: mn, max: mx, col } };
  }
  const cats = [...new Set(vals)];
  const cmap = Object.fromEntries(cats.map((c, i) => [c, CAT_PALETTE[i % CAT_PALETTE.length]]));
  return { getColor: row => cmap[row[col]] ?? "#888", legend: { type: "categorical", cats: cats.slice(0, 8), cmap, col } };
}

// ─── SHARED UI ATOMS ─────────────────────────────────────────────────────────

function ColSelect({ label, value, onChange, headers, C, allowNone = false }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 3, color: value ? C.text : C.textMuted, fontFamily: mono,
          fontSize: 10, outline: "none", cursor: "pointer",
        }}
      >
        {allowNone && <option value="">— none —</option>}
        {headers.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
}

function NumInput({ label, value, onChange, C, min, max, step = "any", placeholder = "" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(e.target.value === "" ? "" : Number(e.target.value))}
        min={min} max={max} step={step} placeholder={placeholder}
        style={{
          padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
          outline: "none", width: "100%",
        }}
      />
    </div>
  );
}

function TextInput({ label, value, onChange, C, placeholder = "" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
          borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10,
          outline: "none", width: "100%",
        }}
      />
    </div>
  );
}

function ApplyBtn({ onClick, disabled, label = "Apply", C }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.4rem 1rem", background: disabled ? "transparent" : `${C.teal}18`,
        border: `1px solid ${disabled ? C.border2 : C.teal}`,
        borderRadius: 3, color: disabled ? C.textMuted : C.teal,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: mono, fontSize: 10,
        transition: "all 0.13s",
      }}
    >{label}</button>
  );
}

function SaveBtn({ onClick, disabled, C }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "0.4rem 1rem", background: disabled ? "transparent" : `${C.gold}18`,
        border: `1px solid ${disabled ? C.border2 : C.gold}`,
        borderRadius: 3, color: disabled ? C.textMuted : C.gold,
        cursor: disabled ? "not-allowed" : "pointer", fontFamily: mono, fontSize: 10,
      }}
    >Save as dataset</button>
  );
}

function ResultPreview({ rows, newCols, C }) {
  if (!rows || !rows.length || !newCols.length) return null;
  const preview = rows.slice(0, 8);
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 9, color: C.teal, letterSpacing: "0.14em", textTransform: "uppercase", marginBottom: 6 }}>
        Preview — {rows.length} rows
      </div>
      <div style={{ overflowX: "auto", border: `1px solid ${C.border2}`, borderRadius: 3 }}>
        <table style={{ borderCollapse: "collapse", fontFamily: mono, fontSize: 9, width: "100%" }}>
          <thead>
            <tr style={{ background: C.surface2 }}>
              {newCols.map(c => (
                <th key={c} style={{
                  padding: "4px 8px", borderBottom: `1px solid ${C.border}`,
                  color: C.teal, fontWeight: 400, whiteSpace: "nowrap",
                }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i} style={{ background: i % 2 ? C.surface2 : C.surface }}>
                {newCols.map(c => {
                  const v = row[c];
                  return (
                    <td key={c} style={{
                      padding: "3px 8px", color: v == null ? C.textMuted : C.text,
                      borderBottom: `1px solid ${C.border}`, whiteSpace: "nowrap",
                    }}>
                      {v == null ? "·" : typeof v === "number" ? v.toFixed(4).replace(/\.?0+$/, "") : String(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ErrBanner({ msg, C }) {
  if (!msg) return null;
  return (
    <div style={{
      padding: "0.4rem 0.7rem", background: `${C.red ?? "#c84e4e"}18`,
      border: `1px solid ${C.red ?? "#c84e4e"}60`,
      borderRadius: 3, fontSize: 10, color: C.red ?? "#c84e4e", fontFamily: mono, marginTop: 8,
    }}>{msg}</div>
  );
}

// ─── COLLAPSIBLE SECTION WRAPPER ─────────────────────────────────────────────

function Section({ title, badge, children, C, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ border: `1px solid ${C.border2}`, borderRadius: 4, overflow: "hidden" }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8,
          padding: "0.55rem 0.9rem", background: open ? C.surface2 : C.surface,
          border: "none", cursor: "pointer", textAlign: "left", fontFamily: mono,
          borderBottom: open ? `1px solid ${C.border}` : "none",
          transition: "background 0.12s",
        }}
      >
        <span style={{ fontSize: 9, color: C.teal }}>{open ? "▾" : "▸"}</span>
        <span style={{ fontSize: 11, color: C.text, flex: 1 }}>{title}</span>
        {badge && (
          <span style={{
            fontSize: 8, padding: "2px 6px", border: `1px solid ${C.border2}`,
            borderRadius: 2, color: C.textMuted, letterSpacing: "0.1em",
          }}>{badge}</span>
        )}
      </button>
      {open && (
        <div style={{ padding: "1rem", background: C.surface }}>
          {children}
        </div>
      )}
    </div>
  );
}

// ─── COLUMN INFERENCE ────────────────────────────────────────────────────────
// Heuristic: pick the first column whose name looks like lat / lon / geometry.

function guessLatCol(headers) {
  return headers.find(h => /^lat(itude)?$/i.test(h)) ??
         headers.find(h => /lat/i.test(h)) ??
         headers[0] ?? "";
}
function guessLonCol(headers) {
  return headers.find(h => /^lon(gitude)?$/i.test(h)) ??
         headers.find(h => /lon|lng/i.test(h)) ??
         headers[1] ?? "";
}
function guessWktCol(headers) {
  return headers.find(h => /wkt|geom|geometry|polygon|shape/i.test(h)) ?? headers[0] ?? "";
}

// ─── SECTIONS ─────────────────────────────────────────────────────────────────

// 1. Distance to Point
function DistanceSection({ rows, headers, onResult, C }) {
  const [latCol,   setLatCol]   = useState(() => guessLatCol(headers));
  const [lonCol,   setLonCol]   = useState(() => guessLonCol(headers));
  const [refLat,   setRefLat]   = useState("");
  const [refLon,   setRefLon]   = useState("");
  const [outCol,   setOutCol]   = useState("dist_km");
  const [result,   setResult]   = useState(null);
  const [err,      setErr]      = useState("");

  const canApply = latCol && lonCol && refLat !== "" && refLon !== "" && outCol;

  function apply() {
    setErr("");
    try {
      const out = assignDistance(rows, latCol, lonCol, Number(refLat), Number(refLon), outCol);
      setResult(out);
      onResult(out, [outCol]);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Computes the haversine great-circle distance (km) from each observation to a fixed reference point.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <NumInput label="Reference latitude" value={refLat} onChange={setRefLat} C={C} step="any" placeholder="e.g. 48.1374" />
        <NumInput label="Reference longitude" value={refLon} onChange={setRefLon} C={C} step="any" placeholder="e.g. 11.5755" />
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="dist_km" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && <span style={{ fontSize: 9, color: C.teal }}>✓ {result.length} rows processed</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result} newCols={[outCol, latCol, lonCol]} C={C} />}
    </div>
  );
}

// 2. Buffer Indicator
function BufferSection({ rows, headers, onResult, C }) {
  const [latCol,   setLatCol]   = useState(() => guessLatCol(headers));
  const [lonCol,   setLonCol]   = useState(() => guessLonCol(headers));
  const [refLat,   setRefLat]   = useState("");
  const [refLon,   setRefLon]   = useState("");
  const [radius,   setRadius]   = useState(50);
  const [outCol,   setOutCol]   = useState("in_buffer");
  const [result,   setResult]   = useState(null);
  const [err,      setErr]      = useState("");

  const canApply = latCol && lonCol && refLat !== "" && refLon !== "" && radius > 0 && outCol;

  function apply() {
    setErr("");
    try {
      const out = assignBuffer(rows, latCol, lonCol, Number(refLat), Number(refLon), Number(radius), outCol);
      const treated = out.filter(r => r[outCol] === 1).length;
      setResult({ rows: out, treated });
      onResult(out, [outCol]);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Creates a binary treatment indicator (0/1) — 1 if the observation is within the specified radius of a reference point.
        Useful as an instrumental variable or treatment assignment variable.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <NumInput label="Reference latitude" value={refLat} onChange={setRefLat} C={C} step="any" placeholder="e.g. 48.1374" />
        <NumInput label="Reference longitude" value={refLon} onChange={setRefLon} C={C} step="any" placeholder="e.g. 11.5755" />
        <NumInput label="Radius (km)" value={radius} onChange={setRadius} C={C} min={0.1} step={1} />
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="in_buffer" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            ✓ {result.treated} treated / {rows.length - result.treated} control
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[outCol, latCol, lonCol]} C={C} />}
    </div>
  );
}

// 3. Grid Assignment
function GridSection({ rows, headers, onResult, C }) {
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [gridType,  setGridType]  = useState("rectangular"); // "rectangular" | "hex"
  const [cellSize,  setCellSize]  = useState(50);
  const [resolution, setResolution] = useState(2);
  const [outCol,    setOutCol]    = useState("grid_cell");
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const canApply = latCol && lonCol && outCol && (gridType === "rectangular" ? cellSize > 0 : true);

  function apply() {
    setErr("");
    try {
      const out = gridType === "rectangular"
        ? assignRectGrid(rows, latCol, lonCol, Number(cellSize), outCol)
        : assignH3Grid(rows, latCol, lonCol, Number(resolution), outCol);
      const distinct = new Set(out.map(r => r[outCol]).filter(v => v != null)).size;
      setResult({ rows: out, distinct });
      onResult(out, [outCol]);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Assigns each observation to a spatial grid cell — rectangular or approximate hexagonal.
        The resulting ID can be used as a fixed effect or aggregation key.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        {[["rectangular", "Rectangular"], ["hex", "Hex (approx.)"]].map(([v, l]) => (
          <button
            key={v} onClick={() => setGridType(v)}
            style={{
              padding: "3px 10px", fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: gridType === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${gridType === v ? C.teal : C.border2}`,
              borderRadius: 3, color: gridType === v ? C.teal : C.textDim,
            }}
          >{l}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        {gridType === "rectangular"
          ? <NumInput label="Cell size (km)" value={cellSize} onChange={setCellSize} C={C} min={0.1} step={1} />
          : <NumInput label="Resolution (0–5)" value={resolution} onChange={setResolution} C={C} min={0} max={5} step={1} />
        }
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="grid_cell" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            ✓ {result.distinct} distinct cells across {rows.length} rows
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[outCol, latCol, lonCol]} C={C} />}
    </div>
  );
}

// 4. Spatial Join (point-in-polygon)
function SpatialJoinSection({ rows, headers, availableDatasets, C, onResult }) {
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [polyDsId,  setPolyDsId]  = useState("");
  const [wktCol,    setWktCol]    = useState("");
  const [joinCols,  setJoinCols]  = useState([]);
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const polyDs = availableDatasets.find(ds => ds.id === polyDsId);
  const polyHeaders = polyDs?.headers ?? [];
  const guessedWkt = useMemo(() => guessWktCol(polyHeaders), [polyHeaders]);

  // Auto-set wkt col when polygon dataset changes
  const effectiveWkt = wktCol || guessedWkt;

  const canApply = latCol && lonCol && polyDs?.rows?.length && effectiveWkt && joinCols.length > 0;

  function toggleJoinCol(col) {
    setJoinCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  function apply() {
    setErr("");
    try {
      const out = spatialJoin(rows, latCol, lonCol, polyDs.rows, effectiveWkt, joinCols);
      const matched = out.filter(r => r[joinCols[0]] != null).length;
      setResult({ rows: out, matched });
      onResult(out, joinCols);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Assigns polygon attributes to each point by testing containment (ray-casting).
        Requires a loaded polygon dataset with a WKT geometry column (e.g. from a .dbf/.shp upload).
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
      </div>

      {/* Polygon dataset picker */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Polygon dataset
        </label>
        {availableDatasets.length <= 1 ? (
          <div style={{ fontSize: 10, color: C.gold, padding: "6px 8px", border: `1px solid ${C.gold}40`, borderRadius: 3 }}>
            Load a shapefile/polygon dataset first (Data tab → Load dataset).
          </div>
        ) : (
          <select
            value={polyDsId}
            onChange={e => { setPolyDsId(e.target.value); setWktCol(""); setJoinCols([]); }}
            style={{
              padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
              borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none",
            }}
          >
            <option value="">— select polygon dataset —</option>
            {availableDatasets.map(ds => (
              <option key={ds.id} value={ds.id}>{ds.filename ?? ds.id}</option>
            ))}
          </select>
        )}
      </div>

      {polyDs && (
        <>
          <ColSelect
            label="WKT geometry column"
            value={effectiveWkt}
            onChange={setWktCol}
            headers={polyHeaders}
            C={C}
          />
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Columns to join
            </label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {polyHeaders.filter(h => h !== effectiveWkt).map(h => (
                <button
                  key={h}
                  onClick={() => toggleJoinCol(h)}
                  style={{
                    padding: "2px 8px", fontFamily: mono, fontSize: 9, cursor: "pointer",
                    background: joinCols.includes(h) ? `${C.teal}18` : "transparent",
                    border: `1px solid ${joinCols.includes(h) ? C.teal : C.border2}`,
                    borderRadius: 3, color: joinCols.includes(h) ? C.teal : C.textDim,
                  }}
                >{h}</button>
              ))}
            </div>
          </div>
        </>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Join" />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            ✓ {result.matched} / {rows.length} matched
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={joinCols} C={C} />}
    </div>
  );
}

// 5. Nearest Neighbour
function NearestNeighborSection({ rows, headers, availableDatasets, C, onResult }) {
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [refDsId,   setRefDsId]   = useState("self");   // "self" or a dataset id
  const [refLatCol, setRefLatCol] = useState("");
  const [refLonCol, setRefLonCol] = useState("");
  const [outDist,   setOutDist]   = useState("nn_dist_km");
  const [outIdx,    setOutIdx]    = useState("nn_idx");
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");
  const [running,   setRunning]   = useState(false);

  const refDs = refDsId === "self" ? { headers, rows } : availableDatasets.find(ds => ds.id === refDsId);
  const refHeaders = refDs?.headers ?? [];

  const effectiveRefLat = refLatCol || guessLatCol(refHeaders);
  const effectiveRefLon = refLonCol || guessLonCol(refHeaders);

  const canApply = latCol && lonCol && refDs?.rows?.length && effectiveRefLat && effectiveRefLon;

  function apply() {
    setErr("");
    setRunning(true);
    // Run async to avoid blocking UI on large datasets
    setTimeout(() => {
      try {
        const out = nearestNeighbor(
          rows, latCol, lonCol,
          refDs.rows, effectiveRefLat, effectiveRefLon,
          outDist, outIdx
        );
        setResult(out);
        onResult(out, [outDist, outIdx]);
      } catch (e) {
        setErr(e.message);
      }
      setRunning(false);
    }, 0);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        For each observation, finds the nearest point in a reference dataset and returns the haversine distance (km) and reference row index.
        Brute-force O(n×m) — suitable up to ~10 k × 1 k rows.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
          Reference dataset
        </label>
        <select
          value={refDsId}
          onChange={e => { setRefDsId(e.target.value); setRefLatCol(""); setRefLonCol(""); }}
          style={{
            padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none",
          }}
        >
          <option value="self">Same dataset (self-join)</option>
          {availableDatasets.map(ds => (
            <option key={ds.id} value={ds.id}>{ds.filename ?? ds.id}</option>
          ))}
        </select>
      </div>

      {refDs && refHeaders.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ColSelect label="Ref. latitude column" value={effectiveRefLat} onChange={setRefLatCol} headers={refHeaders} C={C} />
          <ColSelect label="Ref. longitude column" value={effectiveRefLon} onChange={setRefLonCol} headers={refHeaders} C={C} />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <TextInput label="Distance output col" value={outDist} onChange={setOutDist} C={C} placeholder="nn_dist_km" />
        <TextInput label="Index output col" value={outIdx} onChange={setOutIdx} C={C} placeholder="nn_idx" />
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply || running} label={running ? "Computing…" : "Find neighbours"} C={C} />
        {result && <span style={{ fontSize: 9, color: C.teal }}>✓ {result.length} rows processed</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result} newCols={[latCol, lonCol, outDist, outIdx]} C={C} />}
    </div>
  );
}

// 6. Geocode (stub — Nominatim requires network + rate limiting)
function GeocodeSection({ C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Converts address strings to latitude/longitude via the OpenStreetMap Nominatim API
        (1 request/sec, cached per session).
      </div>
      <div style={{
        padding: "0.9rem 1rem",
        border: `1px dashed ${C.border2}`,
        borderRadius: 4,
        color: C.textMuted,
        fontSize: 10,
        fontFamily: mono,
        lineHeight: 1.8,
      }}>
        <div style={{ color: C.gold, marginBottom: 4 }}>⚠ Coming in Phase 11.2</div>
        Geocoding requires network access + Nominatim rate-limiting logic.
        This section will add lat/lon columns from an address column using the OpenStreetMap API.
        Results are cached in sessionStorage to avoid re-fetching on pipeline replay.
      </div>
    </div>
  );
}

// ─── 7. MAP VIEWER ───────────────────────────────────────────────────────────
function MapLegend({ legend, C }) {
  if (!legend) return null;
  return (
    <div style={{
      position: "absolute", bottom: 24, right: 8, zIndex: 999,
      background: C.surface, border: `1px solid ${C.border2}`,
      borderRadius: 4, padding: "6px 10px", fontFamily: mono, fontSize: 9, minWidth: 100,
      backdropFilter: "blur(4px)",
    }}>
      <div style={{ color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", marginBottom: 5 }}>
        {legend.col}
      </div>
      {legend.type === "gradient" && (
        <div>
          <div style={{ height: 8, borderRadius: 2, background: "linear-gradient(to right,#6ec8b4,#c8a96e)", marginBottom: 4 }} />
          <div style={{ display: "flex", justifyContent: "space-between", color: C.textDim }}>
            <span>{Number(legend.min).toFixed(2)}</span>
            <span>{Number(legend.max).toFixed(2)}</span>
          </div>
        </div>
      )}
      {legend.type === "categorical" && legend.cats.map(cat => (
        <div key={cat} style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 2 }}>
          <div style={{ width: 8, height: 8, borderRadius: "50%", background: legend.cmap[cat], flexShrink: 0 }} />
          <span style={{ color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 120 }}>{String(cat)}</span>
        </div>
      ))}
    </div>
  );
}

function SpatialMapSection({ rows, headers, C, pid }) {
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

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>",
      maxZoom: 19,
    }).addTo(map);

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
          const rings = geo.type === "multipolygon"
            ? geo.rings.map(r => r[0])
            : geo.rings;
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
  }, [L, rows, latCol, lonCol, ptColorCol, showPoints, ptRadius, wktCol, polyColorCol, showPolygons, polyOpacity]);

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

        {/* Point layer */}
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={showPoints} onChange={e => setShowPoints(e.target.checked)}
              style={{ accentColor: C.teal, cursor: "pointer" }} />
            <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.12em", textTransform: "uppercase" }}>
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
            <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.12em", textTransform: "uppercase" }}>
              Boundaries layer
            </span>
            <span style={{ fontSize: 8, color: C.textMuted }}>(WKT geometry)</span>
          </div>
          <div style={{ opacity: showPolygons ? 1 : 0.4, pointerEvents: showPolygons ? "auto" : "none" }}>
            {wktHeaders.length === 0 ? (
              <div style={{ fontSize: 9, color: C.textMuted, lineHeight: 1.6 }}>
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
            style={{ padding: "3px 10px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: `${C.teal}18`, border: `1px solid ${C.teal}55`, color: C.teal, cursor: "pointer" }}
          >Save map</button>
          {mapHistory.length > 0 && (
            <button onClick={() => setHistOpen(o => !o)}
              style={{ padding: "3px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
            >{histOpen ? "▲" : "▼"} {mapHistory.length} saved</button>
          )}
        </div>
      )}

      {/* ── History cards ── */}
      {pid && histOpen && mapHistory.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {mapHistory.map(entry => (
            <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px", borderRadius: 3, border: `1px solid ${C.border2}`, background: C.surface }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.text }}>{entry.name}</span>
              <button onClick={() => loadMapEntry(entry)}
                style={{ padding: "1px 6px", borderRadius: 2, fontFamily: mono, fontSize: 8, background: `${C.teal}18`, border: `1px solid ${C.teal}55`, color: C.teal, cursor: "pointer" }}
              >Load</button>
              <button onClick={() => deleteMapEntry(entry.id)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, lineHeight: 1, color: C.textMuted, padding: "0 2px" }}
              >×</button>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ color: "#c47070", fontFamily: mono, fontSize: 10 }}>{err}</div>}
      {!L   && <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10 }}>Loading Leaflet…</div>}

      {/* Map — fixed-height wrapper prevents ResizeObserver feedback loop */}
      <div ref={wrapRef} style={{ position: "relative", height: 480, borderRadius: 4, overflow: "hidden", border: `1px solid ${C.border2}` }}>
        <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
        <MapLegend legend={legend} C={C} />
      </div>
    </div>
  );
}

// ─── BOUNDARY DISTANCE SECTION ───────────────────────────────────────────────
function BoundaryDistanceSection({ rows, headers, availableDatasets, onResult, C }) {
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [polyDsId,  setPolyDsId]  = useState("");
  const [wktCol,    setWktCol]    = useState("");
  const [outPrefix, setOutPrefix] = useState("boundary");
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const polyDs      = availableDatasets.find(d => d.id === polyDsId);
  const polyHeaders = polyDs?.headers ?? [];
  const guessedWkt  = useMemo(() =>
    polyHeaders.find(h => {
      const s = polyDs?.rows?.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTIPOLYGON)/i.test(s.trim());
    }) ?? "",
  [polyDs, polyHeaders]);
  const effectiveWkt = wktCol || guessedWkt;

  const canApply = latCol && lonCol && polyDs?.rows?.length && effectiveWkt && outPrefix;

  function apply() {
    setErr("");
    try {
      const out = assignBoundaryDistance(rows, latCol, lonCol, polyDs.rows, effectiveWkt, outPrefix);
      const treated  = out.filter(r => r[`${outPrefix}_treat`] === 1).length;
      const newCols  = [`${outPrefix}_dist_km`, `${outPrefix}_treat`, `${outPrefix}_running`];
      setResult({ rows: out, treated, newCols });
      onResult(out, newCols);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Computes the minimum distance from each point to the nearest polygon boundary edge,
        plus a treatment indicator and signed running variable for Spatial RD.
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
      </div>

      {/* Polygon dataset picker */}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase", fontFamily: mono }}>
          Boundary polygon dataset
        </label>
        <select
          value={polyDsId}
          onChange={e => { setPolyDsId(e.target.value); setWktCol(""); }}
          style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: polyDsId ? C.text : C.textMuted, fontFamily: mono, fontSize: 10, outline: "none" }}
        >
          <option value="">— select polygon dataset —</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>

      {polyDs && (
        <ColSelect label={`WKT geometry column${guessedWkt ? ` (auto: ${guessedWkt})` : ""}`}
          value={effectiveWkt} onChange={setWktCol} headers={polyHeaders} C={C} />
      )}

      <TextInput label="Output column prefix" value={outPrefix} onChange={setOutPrefix} C={C} placeholder="boundary" />

      {outPrefix && (
        <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, lineHeight: 1.7 }}>
          Outputs: <span style={{ color: C.teal }}>{outPrefix}_dist_km</span> · <span style={{ color: C.teal }}>{outPrefix}_treat</span> · <span style={{ color: C.teal }}>{outPrefix}_running</span> (signed, use as RD running variable)
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            ✓ {result.rows.length} rows · {result.treated} treated
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={result.newCols} C={C} />}
    </div>
  );
}

// ─── DATASET OUTPUT PANEL ─────────────────────────────────────────────────────

function OutputPanel({ pendingRows, pendingCols, onSave, C }) {
  const [name, setName] = useState("spatial_result");

  if (!pendingRows) return null;
  return (
    <div style={{
      padding: "0.8rem 1rem",
      border: `1px solid ${C.teal}40`,
      borderRadius: 4,
      background: `${C.teal}08`,
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <span style={{ fontSize: 10, color: C.teal }}>
        Ready — {pendingRows.length} rows · new col{pendingCols.length > 1 ? "s" : ""}: <strong>{pendingCols.join(", ")}</strong>
      </span>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          value={name} onChange={e => setName(e.target.value)}
          placeholder="dataset name"
          style={{
            padding: "3px 8px", background: C.surface, border: `1px solid ${C.border2}`,
            borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none", width: 160,
          }}
        />
        <SaveBtn onClick={() => onSave(name, pendingRows)} disabled={!name} C={C} />
      </div>
    </div>
  );
}

// ─── PLOT TAB ─────────────────────────────────────────────────────────────────

// Compact color + opacity/width row used in layer editors
function ColorRow({ label, color, opacity, opacityLabel = "opacity", opacityMin = 0, opacityMax = 1, opacityStep = 0.05, onColor, onOpacity, C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <span style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</span>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <input type="color" value={color} onChange={e => onColor(e.target.value)}
          style={{ width: 26, height: 20, border: "none", background: "none", cursor: "pointer", padding: 0, flexShrink: 0 }} />
        <span style={{ fontSize: 8, color: C.textMuted, fontFamily: mono, flexShrink: 0 }}>{opacityLabel}</span>
        <input type="range" min={opacityMin} max={opacityMax} step={opacityStep} value={opacity}
          onChange={e => onOpacity(+e.target.value)}
          style={{ flex: 1, accentColor: C.teal, cursor: "pointer" }} />
        <span style={{ fontSize: 9, color: C.textDim, fontFamily: mono, width: 30, textAlign: "right", flexShrink: 0 }}>
          {opacityMax === 1 ? `${Math.round(opacity * 100)}%` : opacity.toFixed(1)}
        </span>
      </div>
    </div>
  );
}

function SpatialLayerEditor({ layer, onChange, activeRows, activeHeaders, availableDatasets, C }) {
  const lyDs      = (layer.datasetId && layer.datasetId !== "active")
    ? availableDatasets.find(d => d.id === layer.datasetId) : null;
  const lyRows    = lyDs?.rows    ?? activeRows;
  const lyHeaders = lyDs?.headers ?? activeHeaders;
  const lyWktHeaders = useMemo(() =>
    lyHeaders.filter(h => {
      const s = lyRows.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTIPOLYGON)/i.test(s.trim());
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
        <div style={{ display: "flex", gap: 4 }}>
          {[["generate", "Auto-generate"], ["wkt", "From WKT col"]].map(([m, lbl]) => (
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

        {layer.mode === "generate" && (<>
          <ColSelect label="Boundary WKT column" value={layer.boundaryCol}
            onChange={v => onChange({ ...layer, boundaryCol: v })} headers={geomCols} C={C} allowNone />
          <NumInput label="Cell size (meters)" value={layer.cellsize}
            onChange={v => onChange({ ...layer, cellsize: Number(v) })} C={C} min={50} max={10000} step={50} />
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
const LAYER_COLORS = ["#6e9ec8", "#c8a96e", "#6ec8b4", "#c47070", "#a87ec8"];
function mkSLayer(type, idx) {
  const col = LAYER_COLORS[idx % LAYER_COLORS.length];
  const id  = "sl_" + Math.random().toString(36).slice(2, 7);
  if (type === "boundary") return { id, type, visible: true, datasetId: "active", wktCol: "", fillColor: "#d0d0d0", fillOpacity: 0.12, borderColor: "#222222", borderWidth: 0.5 };
  if (type === "grid")     return { id, type, visible: true, datasetId: "active", mode: "generate", wktCol: "", boundaryCol: "", cellsize: 500, clipBorder: true, fillColor: col, fillOpacity: 0, borderColor: "#d73027", borderWidth: 0.15, colorByCol: "", colorFillOpacity: 0.55 };
  if (type === "points")   return { id, type, visible: true, datasetId: "active", latCol: "", lonCol: "", colorCol: "", fillColor: col, radius: 4, opacity: 0.78 };
  return { id, type, visible: true };
}

function SpatialPlotTab({ rows, headers, availableDatasets, onAddDataset, C, pid }) {
  const wrapRef    = useRef(null);
  const mapDivRef  = useRef(null);
  const leafMapRef = useRef(null);

  const [L,        setL]       = useState(null);
  const [mapErr,   setMapErr]  = useState(null);
  const [layers,   setLayers]  = useState([]);
  const [activeId, setActiveId]= useState(null);
  const [saveName, setSaveName]= useState("grid_cells");

  // ── Download as HTML ─────────────────────────────────────────────────────────
  function downloadMapHtml() {
    const visibleLayers = layers.filter(ly => ly.visible);
    const layerData = visibleLayers.map(ly => {
      const lyRows = (!ly.datasetId || ly.datasetId === "active")
        ? rows
        : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      return { ...ly, _data: lyRows };
    });

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="utf-8" /><title>Spatial Map</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>body{margin:0}#map{width:100vw;height:100vh}</style>
</head><body><div id="map"></div><script>
const LAYERS=${JSON.stringify(layerData)};
function parseWkt(wkt){
  if(!wkt||typeof wkt!=="string")return null;
  const s=wkt.trim().toUpperCase();
  function parseRing(s){return s.replace(/[()]/g,"").trim().split(",").map(p=>{const[x,y]=p.trim().split(/\s+/);return[parseFloat(y),parseFloat(x)];});}
  if(s.startsWith("POINT")){const c=s.match(/POINT\s*\(([^)]+)\)/);if(!c)return null;const[x,y]=c[1].trim().split(/\s+/);return{type:"point",latlng:[parseFloat(y),parseFloat(x)]};}
  if(s.startsWith("POLYGON")){const m=s.match(/\((\([^)]+\)(?:\s*,\s*\([^)]+\))*)\)/);if(!m)return null;const rings=m[1].match(/\([^)]+\)/g).map(r=>parseRing(r));return{type:"polygon",rings};}
  if(s.startsWith("MULTIPOLYGON")){const parts=s.match(/\(\([^)]+\)\)/g)||[];const rings=parts.map(p=>{const inner=p.match(/\(([^)]+)\)/g)||[];return inner.map(r=>parseRing(r));});return{type:"multipolygon",rings};}
  return null;
}
const map=L.map("map");
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{attribution:"© OpenStreetMap"}).addTo(map);
const group=L.featureGroup().addTo(map);
for(const ly of LAYERS){
  if(ly.type==="points"&&ly.latCol&&ly.lonCol){
    for(const row of ly._data){const lat=parseFloat(row[ly.latCol]),lon=parseFloat(row[ly.lonCol]);if(isNaN(lat)||isNaN(lon))continue;L.circleMarker([lat,lon],{radius:ly.radius??4,fillColor:ly.fillColor??"#6ec8b4",color:ly.fillColor??"#6ec8b4",weight:1,fillOpacity:0.78}).addTo(group);}
  }else if(ly.type==="boundary"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo)continue;if(geo.type==="point"){L.circleMarker(geo.latlng,{radius:6,fillColor:ly.fillColor??"#6e9ec8",color:ly.borderColor??"#333",weight:ly.borderWidth??0.8,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}else{const rings=geo.type==="multipolygon"?geo.rings.map(r=>r[0]):geo.rings;L.polygon(rings,{fillColor:ly.fillColor??"#6e9ec8",color:ly.borderColor??"#333",weight:ly.borderWidth??0.8,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}}
  }else if(ly.type==="grid"&&ly.wktCol){
    for(const row of ly._data){const geo=parseWkt(row[ly.wktCol]);if(!geo)continue;if(geo.type!=="point"){const rings=geo.type==="multipolygon"?geo.rings.map(r=>r[0]):geo.rings;L.polygon(rings,{fillColor:ly.fillColor??"#6ec8b4",color:ly.borderColor??"#d73027",weight:ly.borderWidth??0.15,fillOpacity:ly.fillOpacity??0.55}).addTo(group);}}
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

  const addLayer    = type => setLayers(prev => { const ly = mkSLayer(type, prev.length); setActiveId(ly.id); return [...prev, ly]; });
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
    const gl = layers.find(l => l.type === "grid" && l.mode === "generate" && l.boundaryCol && l.cellsize > 0);
    if (!gl) return null;
    const glRows = (!gl.datasetId || gl.datasetId === "active") ? rows : availableDatasets.find(d => d.id === gl.datasetId)?.rows ?? rows;
    const wkt = glRows.find(r => r[gl.boundaryCol])?.[gl.boundaryCol];
    if (!wkt) return null;
    try { return { cells: makeGrid(wkt, gl.cellsize, gl.clipBorder !== false), error: null }; }
    catch (e) { return { cells: null, error: e.message }; }
  }, [layers, rows, availableDatasets]);

  // Build Leaflet map
  useEffect(() => {
    if (!L || !mapDivRef.current) return;
    if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; }

    const map = L.map(mapDivRef.current, { zoomControl: true, attributionControl: true });
    leafMapRef.current = map;
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "© <a href='https://www.openstreetmap.org/copyright'>OpenStreetMap</a>", maxZoom: 19,
    }).addTo(map);

    const group = L.featureGroup().addTo(map);
    const esc = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");

    for (const ly of layers) {
      if (!ly.visible) continue;

      // ── Boundary ──────────────────────────────────────────────────────────
      if (ly.type === "boundary" && ly.wktCol) {
        for (const row of lyRows(ly)) {
          const geo = wktToLeaflet(row[ly.wktCol]);
          if (!geo) continue;
          if (geo.type === "point") {
            L.circleMarker(geo.latlng, { radius: 6, fillColor: ly.fillColor, color: ly.borderColor, weight: ly.borderWidth, fillOpacity: ly.fillOpacity }).addTo(group);
          } else {
            const rings = geo.type === "multipolygon" ? geo.rings.map(r => r[0]) : geo.rings;
            L.polygon(rings, { fillColor: ly.fillColor, fillOpacity: ly.fillOpacity, color: ly.borderColor, weight: ly.borderWidth }).addTo(group);
          }
        }
      }

      // ── Grid ──────────────────────────────────────────────────────────────
      if (ly.type === "grid") {
        let cells = [];
        if (ly.mode === "wkt" && ly.wktCol) {
          cells = lyRows(ly).filter(r => r[ly.wktCol]);
          const { getColor } = buildColorScale(cells, ly.colorByCol);
          for (const cell of cells) {
            const geo = wktToLeaflet(cell[ly.wktCol]);
            if (!geo || geo.type === "point") continue;
            const rings = geo.type === "multipolygon" ? geo.rings.map(r => r[0]) : geo.rings;
            const fc = ly.colorByCol ? (getColor(cell) ?? ly.fillColor) : ly.fillColor;
            const fo = ly.colorByCol ? ly.colorFillOpacity : ly.fillOpacity;
            L.polygon(rings, { fillColor: fc, fillOpacity: fo, color: ly.borderColor, weight: ly.borderWidth })
              .bindTooltip(ly.colorByCol ? `${esc(ly.colorByCol)}: ${esc(cell[ly.colorByCol])}` : `grid #${cell.grid_id ?? ""}`)
              .addTo(group);
          }
        } else if (ly.mode === "generate" && generatedGrid?.cells) {
          cells = generatedGrid.cells;
          for (const cell of cells) {
            const geo = wktToLeaflet(cell.geometry);
            if (!geo || geo.type === "point") continue;
            const rings = geo.type === "multipolygon" ? geo.rings.map(r => r[0]) : geo.rings;
            L.polygon(rings, { fillColor: ly.fillColor, fillOpacity: ly.fillOpacity, color: ly.borderColor, weight: ly.borderWidth })
              .bindTooltip(`grid #${cell.grid_id}`)
              .addTo(group);
          }
        }
      }

      // ── Points ────────────────────────────────────────────────────────────
      if (ly.type === "points" && ly.latCol && ly.lonCol) {
        const ptRows = lyRows(ly);
        const { getColor } = buildColorScale(ptRows, ly.colorCol);
        for (const row of ptRows) {
          const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]);
          if (isNaN(lat) || isNaN(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
          const color = (ly.colorCol ? getColor(row) : null) ?? ly.fillColor;
          const op    = ly.opacity ?? 0.78;
          const tipParts = [`lat: ${lat.toFixed(4)}`, `lon: ${lon.toFixed(4)}`];
          if (ly.colorCol) tipParts.push(`${esc(ly.colorCol)}: ${esc(row[ly.colorCol])}`);
          L.circleMarker([lat, lon], { radius: ly.radius, fillColor: color, color, weight: 1, opacity: op, fillOpacity: op * 0.78 })
            .bindTooltip(tipParts.join("<br>")).addTo(group);
        }
      }
    }

    try {
      const b = group.getBounds();
      if (b.isValid()) map.fitBounds(b.pad(0.05));
      else map.setView([20, 0], 2);
    } catch (_) { map.setView([20, 0], 2); }

    return () => { if (leafMapRef.current) { leafMapRef.current.remove(); leafMapRef.current = null; } };
  }, [L, layers, rows, availableDatasets, generatedGrid]);

  // Active legend
  const activeLegend = useMemo(() => {
    for (const ly of [...layers].reverse()) {
      if (!ly.visible) continue;
      const r = (!ly.datasetId || ly.datasetId === "active") ? rows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      if (ly.type === "grid"   && ly.mode === "wkt" && ly.colorByCol) return buildColorScale(r, ly.colorByCol).legend;
      if (ly.type === "points" && ly.colorCol)                         return buildColorScale(r, ly.colorCol).legend;
    }
    return null;
  }, [layers, rows, availableDatasets]);

  if (!L) return <div style={{ padding: "2rem", fontFamily: mono, fontSize: 10, color: C.textMuted }}>Loading Leaflet…</div>;

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>

      {/* ── LEFT PANEL ─────────────────────────────────────────────────────── */}
      <div style={{ width: 252, flexShrink: 0, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", overflow: "hidden" }}>

        {/* Layer list */}
        <div style={{ padding: "0.75rem 0.65rem 0.6rem", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.22em", textTransform: "uppercase", fontFamily: mono, marginBottom: 8 }}>
            Map Layers
          </div>
          {layers.length === 0 && (
            <div style={{ fontSize: 9, color: C.textMuted, fontFamily: mono, marginBottom: 8 }}>
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
                background: ly.type === "boundary" ? ly.borderColor : ly.type === "grid" ? ly.borderColor : ly.fillColor,
              }} />
              <span style={{ flex: 1, fontFamily: mono, fontSize: 9, color: activeId === ly.id ? C.teal : C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {ly.type}
                {ly.type === "boundary" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "grid" && ly.mode === "generate" && ` · ${ly.cellsize}m`}
                {ly.type === "grid" && ly.mode === "wkt" && ly.wktCol && ` · ${ly.wktCol}`}
                {ly.type === "points" && ly.latCol && ` · ${ly.latCol}/${ly.lonCol}`}
              </span>
              <button onClick={e => { e.stopPropagation(); updateLayer({ ...ly, visible: !ly.visible }); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontFamily: mono, fontSize: 10, padding: "0 2px", color: ly.visible ? C.textDim : C.textMuted }}
              >{ly.visible ? "●" : "○"}</button>
              <button onClick={e => { e.stopPropagation(); removeLayer(ly.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, padding: "0 2px", lineHeight: 1, color: C.textMuted }}
              >×</button>
            </div>
          ))}
          {/* Add buttons */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 8 }}>
            {[["boundary","Boundary"], ["grid","Grid"], ["points","Points"]].map(([t, lbl]) => (
              <button key={t} onClick={() => addLayer(t)}
                style={{ padding: "3px 7px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px dashed ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
              >+{lbl}</button>
            ))}
          </div>

          {/* ── Download as HTML ── */}
          {layers.length > 0 && (
            <div style={{ marginTop: 10 }}>
              <button onClick={downloadMapHtml}
                style={{ width: "100%", padding: "3px 6px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: `${C.gold}15`, border: `1px solid ${C.gold}55`, color: C.gold, cursor: "pointer" }}
              >⬇ Download map.html</button>
            </div>
          )}
        </div>

        {/* Layer editor */}
        <div style={{ flex: 1, padding: "0.75rem 0.65rem", overflowY: "auto" }}>
          {activeLayer
            ? <SpatialLayerEditor layer={activeLayer} onChange={updateLayer} activeRows={rows} activeHeaders={headers} availableDatasets={availableDatasets} C={C} />
            : <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>Select or add a layer.</div>
          }
        </div>

        {/* Grid status / save */}
        {generatedGrid && (
          <div style={{ padding: "0.65rem", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
            {generatedGrid.error ? (
              <div style={{ fontSize: 9, color: "#c47070", fontFamily: mono, lineHeight: 1.5 }}>{generatedGrid.error}</div>
            ) : (
              <>
                <div style={{ fontSize: 9, color: C.teal, fontFamily: mono, marginBottom: 6 }}>
                  {generatedGrid.cells.length.toLocaleString()} grid cells generated
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <input value={saveName} onChange={e => setSaveName(e.target.value)} placeholder="grid_cells"
                    style={{ flex: 1, padding: "3px 6px", background: C.bg, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: mono, fontSize: 9, color: C.text, outline: "none" }}
                  />
                  <button
                    onClick={() => saveName && onAddDataset?.(saveName, generatedGrid.cells, ["grid_id", "geometry"])}
                    disabled={!saveName}
                    style={{ padding: "3px 9px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: `${C.gold}18`, border: `1px solid ${C.gold}`, color: C.gold, cursor: "pointer" }}
                  >Save</button>
                </div>
              </>
            )}
          </div>
        )}

        {mapErr && <div style={{ padding: "0.5rem", fontSize: 9, color: "#c47070", fontFamily: mono }}>{mapErr}</div>}
      </div>

      {/* ── MAP ─────────────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <div ref={wrapRef} style={{ position: "absolute", inset: 0 }}>
          <div ref={mapDivRef} style={{ position: "absolute", inset: 0 }} />
          <MapLegend legend={activeLegend} C={C} />
        </div>
        {layers.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none", zIndex: 500 }}>
            <div style={{ background: "rgba(8,8,8,0.75)", border: `1px solid ${C.border2}`, borderRadius: 4, padding: "1.2rem 2rem", fontFamily: mono, fontSize: 10, color: C.textMuted, textAlign: "center" }}>
              Add a Boundary, Grid, or Points layer<br />
              <span style={{ fontSize: 9 }}>to build your spatial plot.</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SPATIAL GEO PLOT — Observable Plot / ggplot2+sf style ───────────────────

let _geoPlt = null, _geoPltPromise = null;
function loadGeoPlt() {
  if (_geoPlt) return Promise.resolve(_geoPlt);
  if (_geoPltPromise) return _geoPltPromise;
  _geoPltPromise = import("https://cdn.jsdelivr.net/npm/@observablehq/plot@0.6/+esm")
    .then(m => { _geoPlt = m; _geoPltPromise = null; return m; })
    .catch(e => { _geoPltPromise = null; throw e; });
  return _geoPltPromise;
}

function parseWktRings(wkt) {
  if (!wkt || typeof wkt !== "string") return null;
  const s = wkt.trim().toUpperCase();
  const coords = str => str.trim().split(",").map(p => {
    const [x, y] = p.trim().split(/\s+/);
    return [parseFloat(x), parseFloat(y)];
  }).filter(([x, y]) => !isNaN(x) && !isNaN(y));
  const allGroups = [...s.matchAll(/\(([^()]+)\)/g)].map(m => coords(m[1])).filter(r => r.length >= 2);
  if (s.startsWith("POINT")) {
    const m = s.match(/POINT\s*\(([^)]+)\)/);
    if (!m) return null;
    const [x, y] = m[1].trim().split(/\s+/).map(Number);
    return { type: "point", rings: [[[x, y]]] };
  }
  if (s.startsWith("MULTIPOLYGON") || s.startsWith("POLYGON")) return allGroups.length ? { type: "polygon", rings: allGroups } : null;
  if (s.startsWith("LINESTRING") || s.startsWith("MULTILINESTRING")) return allGroups.length ? { type: "line", rings: allGroups } : null;
  return null;
}

function geoBbox(layers, defaultRows, availableDatasets) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const exp = (x, y) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  for (const ly of layers) {
    if (!ly.visible) continue;
    const r = (!ly.datasetId || ly.datasetId === "active") ? defaultRows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? defaultRows;
    if (ly.type === "point" && ly.latCol && ly.lonCol) {
      for (const row of r) { const lat = parseFloat(row[ly.latCol]), lon = parseFloat(row[ly.lonCol]); if (!isNaN(lat) && !isNaN(lon)) exp(lon, lat); }
    } else if (ly.wktCol) {
      for (const row of r) { const p = parseWktRings(row[ly.wktCol]); if (p) for (const ring of p.rings) for (const [x, y] of ring) exp(x, y); }
    }
  }
  if (!isFinite(x0)) return [-180, 180, -90, 90];
  const xp = (x1 - x0) * 0.06 || 0.1, yp = (y1 - y0) * 0.06 || 0.1;
  return [x0 - xp, x1 + xp, y0 - yp, y1 + yp];
}

const GEO_COLORS = ["#6e9ec8", "#c8a96e", "#6ec8b4", "#c87070", "#a96ec8", "#c8c86e"];

function mkGeoLayer(type, idx) {
  const id = `g${Date.now()}_${idx}`;
  const col = GEO_COLORS[idx % GEO_COLORS.length];
  if (type === "polygon")  return { id, type, visible: true, datasetId: "active", wktCol: "", fill: col, fillOpacity: 0.3, stroke: "#444", strokeWidth: 0.6 };
  if (type === "boundary") return { id, type, visible: true, datasetId: "active", wktCol: "", fill: "none", fillOpacity: 0, stroke: "#222", strokeWidth: 0.8 };
  if (type === "point")    return { id, type, visible: true, datasetId: "active", latCol: "", lonCol: "", fill: col, radius: 4, fillOpacity: 0.78 };
  if (type === "line")     return { id, type, visible: true, datasetId: "active", wktCol: "", fill: "none", stroke: col, strokeWidth: 1.2 };
  return { id, type, visible: true, datasetId: "active" };
}

function GeoLayerConfig({ ly, onChange, headers, wktHeaders, availableDatasets, C }) {
  const upd = patch => onChange({ ...ly, ...patch });

  // Resolve headers for the currently selected dataset
  const dsHeaders = useMemo(() => {
    if (!ly.datasetId || ly.datasetId === "active") return headers;
    const ds = availableDatasets.find(d => d.id === ly.datasetId);
    return ds?.headers ?? headers;
  }, [ly.datasetId, headers, availableDatasets]);

  const dsWktHeaders = useMemo(() =>
    dsHeaders.filter(h => {
      const ds = (!ly.datasetId || ly.datasetId === "active") ? null : availableDatasets.find(d => d.id === ly.datasetId);
      const rows = ds?.rows ?? [];
      const s = rows.find(r => r[h] != null)?.[h];
      return typeof s === "string" && /^(POINT|POLYGON|MULTI|LINE)/i.test(s.trim());
    }),
  [dsHeaders, ly.datasetId, availableDatasets]);

  const geomCols = dsWktHeaders.length ? dsWktHeaders : (wktHeaders.length ? wktHeaders : dsHeaders);

  const Sel = ({ label, value, onChg, opts }) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1, minWidth: 80 }}>
      <div style={{ fontSize: 7, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: mono }}>{label}</div>
      <select value={value} onChange={e => onChg(e.target.value)}
        style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: mono, fontSize: 9, color: C.text, outline: "none" }}>
        <option value="">— none —</option>
        {opts.map(h => <option key={h} value={h}>{h}</option>)}
      </select>
    </div>
  );
  const Rng = ({ label, value, onChg, min, max, step, fmt }) => (
    <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
      <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em", whiteSpace: "nowrap" }}>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={e => onChg(parseFloat(e.target.value))}
        style={{ width: 60, accentColor: C.teal }} />
      <span style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, minWidth: 28 }}>{fmt ? fmt(value) : value}</span>
    </div>
  );
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {/* Dataset selector */}
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 7, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.11em", fontFamily: mono }}>Dataset</div>
        <select value={ly.datasetId ?? "active"} onChange={e => upd({ datasetId: e.target.value, wktCol: "", latCol: "", lonCol: "" })}
          style={{ padding: "2px 4px", background: C.surface, border: `1px solid ${C.teal}55`, borderRadius: 3, fontFamily: mono, fontSize: 9, color: C.text, outline: "none" }}>
          <option value="active">— active dataset —</option>
          {availableDatasets.map(d => <option key={d.id} value={d.id}>{d.filename ?? d.name ?? d.id}</option>)}
        </select>
      </div>
      {(ly.type === "polygon" || ly.type === "boundary" || ly.type === "line") && (
        <Sel label="Geometry (WKT)" value={ly.wktCol} onChg={v => upd({ wktCol: v })} opts={geomCols} />
      )}
      {ly.type === "point" && (
        <div style={{ display: "flex", gap: 6 }}>
          <Sel label="Latitude" value={ly.latCol} onChg={v => upd({ latCol: v })} opts={dsHeaders} />
          <Sel label="Longitude" value={ly.lonCol} onChg={v => upd({ lonCol: v })} opts={dsHeaders} />
        </div>
      )}
      {(ly.type === "polygon" || ly.type === "point") && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em" }}>Fill</span>
            <input type="color" value={ly.fill === "none" ? "#6e9ec8" : (ly.fill ?? "#6e9ec8")}
              onChange={e => upd({ fill: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Opacity" value={ly.fillOpacity ?? 0.3} onChg={v => upd({ fillOpacity: v })} min={0} max={1} step={0.05} fmt={v => (v * 100).toFixed(0) + "%"} />
        </div>
      )}
      {ly.type !== "point" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono, textTransform: "uppercase", letterSpacing: "0.1em" }}>Stroke</span>
            <input type="color" value={ly.stroke ?? "#333333"} onChange={e => upd({ stroke: e.target.value })}
              style={{ width: 26, height: 18, cursor: "pointer", border: "none", padding: 0, background: "none" }} />
          </div>
          <Rng label="Width" value={ly.strokeWidth ?? 0.8} onChg={v => upd({ strokeWidth: v })} min={0.1} max={4} step={0.1} fmt={v => v.toFixed(1) + "px"} />
        </div>
      )}
      {ly.type === "point" && (
        <Rng label="Radius" value={ly.radius ?? 4} onChg={v => upd({ radius: v })} min={1} max={14} step={0.5} fmt={v => v.toFixed(1)} />
      )}
    </div>
  );
}

function GeoPlotCanvas({ Plt, layers, rows, availableDatasets, title, subtitle, caption, width = 700, maxH = 0, forceH = 0 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!Plt || !canvasRef.current || layers.length === 0) return;
    const el = canvasRef.current;
    while (el.firstChild) el.removeChild(el.firstChild);

    const [xMin, xMax, yMin, yMax] = geoBbox(layers, rows, availableDatasets);
    const midLat = (yMin + yMax) / 2;
    const cosLat = Math.max(0.1, Math.cos(midLat * Math.PI / 180));

    // Compute height: user override → auto-computed capped to container
    const xRange = xMax - xMin, yRange = yMax - yMin;
    const innerW = width - 60;
    const idealH = Math.round(innerW * (yRange / Math.max(xRange, 1e-9)) / cosLat) + 40;
    const plotH  = forceH > 0 ? forceH
                 : maxH  > 0 ? Math.min(Math.max(idealH, 180), maxH)
                 : Math.max(idealH, 180);

    const marks = [Plt.frame({ stroke: "#bbb", strokeWidth: 0.5 })];

    for (const ly of layers) {
      if (!ly.visible) continue;
      const r = (!ly.datasetId || ly.datasetId === "active") ? rows : availableDatasets.find(d => d.id === ly.datasetId)?.rows ?? rows;
      if (ly.type === "point" && ly.latCol && ly.lonCol) {
        marks.push(Plt.dot(r.filter(row => !isNaN(parseFloat(row[ly.latCol])) && !isNaN(parseFloat(row[ly.lonCol]))), {
          x: row => parseFloat(row[ly.lonCol]), y: row => parseFloat(row[ly.latCol]),
          fill: ly.fill ?? "#6ec8b4", r: ly.radius ?? 4,
          fillOpacity: ly.fillOpacity ?? 0.78, stroke: "none",
        }));
      } else if (ly.wktCol) {
        for (const row of r) {
          const parsed = parseWktRings(row[ly.wktCol]);
          if (!parsed) continue;
          for (const ring of parsed.rings) {
            if (ring.length < 2) continue;
            const closed = parsed.type === "polygon" ? [...ring, ring[0]] : ring;
            marks.push(Plt.line(closed, {
              x: d => d[0], y: d => d[1],
              fill: (parsed.type === "polygon" && ly.fill !== "none") ? (ly.fill ?? "none") : "none",
              fillOpacity: ly.fillOpacity ?? 0,
              stroke: ly.stroke ?? "#333", strokeWidth: ly.strokeWidth ?? 0.8,
              strokeLinejoin: "round", strokeLinecap: "round",
            }));
          }
        }
      }
    }

    try {
      const svg = Plt.plot({
        width,
        height: plotH,
        style: { background: "white", color: "#444", fontFamily: "serif", fontSize: "11px" },
        x: { domain: [xMin, xMax], label: null, nice: false, grid: true,
             tickFormat: d => d < 0 ? `${Math.abs(d).toFixed(2)}°W` : `${d.toFixed(2)}°E` },
        y: { domain: [yMin, yMax], label: null, nice: false, grid: true,
             tickFormat: d => d < 0 ? `${Math.abs(d).toFixed(2)}°S` : `${d.toFixed(2)}°N` },
        marks,
      });
      el.appendChild(svg);
    } catch (e) {
      const errDiv = document.createElement("div");
      errDiv.style.cssText = "color:#c47070;font-family:monospace;font-size:10px;padding:8px";
      errDiv.textContent = e.message;
      el.appendChild(errDiv);
    }

    return () => { while (el.firstChild) el.removeChild(el.firstChild); };
  }, [Plt, layers, rows, availableDatasets, title, subtitle, caption, width, maxH, forceH]);

  return (
    <div style={{ fontFamily: "serif", color: "#333", background: "white", padding: "12px 8px 8px", borderRadius: 4, border: "1px solid #ddd" }}>
      {title    && <div style={{ textAlign: "center", fontSize: 15, fontWeight: "bold", marginBottom: 2 }}>{title}</div>}
      {subtitle && <div style={{ textAlign: "center", fontSize: 11, color: "#666", marginBottom: 6 }}>{subtitle}</div>}
      <div ref={canvasRef} />
      {caption  && <div style={{ textAlign: "right", fontSize: 9, color: "#999", marginTop: 4 }}>{caption}</div>}
    </div>
  );
}

function SpatialGeoPlot({ rows, headers, availableDatasets, C, pid }) {
  const [Plt,     setPlt]     = useState(null);
  const [pltErr,  setPltErr]  = useState(null);
  const [layers,  setLayers]  = useState([]);
  const [activeId,setActiveId]= useState(null);
  const [title,   setTitle]   = useState("");
  const [subtitle,setSubtitle]= useState("");
  const [caption, setCaption] = useState("");
  const [plotHistory, setPlotHistory] = useState([]);
  const [histIdx,     setHistIdx]     = useState(null);
  const [histOpen,    setHistOpen]    = useState(false);
  const [compareIds,  setCompareIds]  = useState(new Set());
  const [userH,       setUserH]       = useState(null); // null = auto
  const wrapRef = useRef(null);
  const [canvasW, setCanvasW] = useState(700);
  const [canvasH, setCanvasH] = useState(500);

  useEffect(() => { loadGeoPlt().then(setPlt).catch(e => setPltErr(e.message)); }, []);
  useEffect(() => { if (!pid) return; getPlotHistory(pid).then(h => setPlotHistory(h ?? [])).catch(() => {}); }, [pid]);
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setCanvasW(e.contentRect.width);
      setCanvasH(e.contentRect.height);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  const wktHeaders = useMemo(() => headers.filter(h => {
    const s = rows.find(r => r[h] != null)?.[h];
    return typeof s === "string" && /^(POINT|POLYGON|MULTI|LINE)/i.test(s.trim());
  }), [rows, headers]);

  const addLayer    = type => { const ly = mkGeoLayer(type, layers.length); setLayers(p => [...p, ly]); setActiveId(ly.id); setHistIdx(null); };
  const updateLayer = upd  => setLayers(p => p.map(l => l.id === upd.id ? upd : l));
  const removeLayer = id   => { setLayers(p => p.filter(l => l.id !== id)); setActiveId(p => p === id ? null : p); };
  const activeLayer = layers.find(l => l.id === activeId) ?? null;

  const currentEntry = () => ({ layers, title, subtitle, caption });

  async function savePlot() {
    if (!pid) return;
    const name = window.prompt("Plot name:", `Map ${plotHistory.length + 1}`);
    if (!name) return;
    let next;
    if (histIdx !== null) {
      next = plotHistory.map((e, i) => i === histIdx ? { ...e, ...currentEntry(), name } : e);
    } else {
      next = [...plotHistory, { id: Date.now(), name, ...currentEntry(), savedAt: Date.now() }];
      setHistIdx(next.length - 1);
    }
    setPlotHistory(next);
    await savePlotHistory(pid, next);
  }

  async function deletePlot(id) {
    const next = plotHistory.filter(e => e.id !== id);
    setPlotHistory(next); setHistIdx(null);
    if (pid) await savePlotHistory(pid, next);
  }

  function newPlot() { setLayers([]); setActiveId(null); setTitle(""); setSubtitle(""); setCaption(""); setHistIdx(null); }

  const view      = histIdx !== null ? plotHistory[histIdx] : null;
  const dLayers   = view ? view.layers   : layers;
  const dTitle    = view ? view.title    : title;
  const dSubtitle = view ? view.subtitle : subtitle;
  const dCaption  = view ? view.caption  : caption;
  const comparePlots = plotHistory.filter(e => compareIds.has(e.id));
  const plotW = Math.max(280, canvasW - 48);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflowY: "auto" }}>

      {/* Toolbar */}
      <div style={{ padding: "8px 14px", borderBottom: `1px solid ${C.border}`, flexShrink: 0, display: "flex", flexDirection: "column", gap: 6 }}>

        {/* Row 1 — layer chips + add buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap" }}>
          {layers.map(ly => (
            <div key={ly.id} onClick={() => { setActiveId(ly.id); setHistIdx(null); }}
              style={{ display: "flex", alignItems: "center", gap: 4, padding: "2px 8px 2px 6px", borderRadius: 12, cursor: "pointer",
                background: activeId === ly.id ? `${C.teal}18` : C.surface,
                border: `1px solid ${activeId === ly.id ? C.teal + "55" : C.border2}` }}
            >
              <div style={{ width: 8, height: 8, borderRadius: ly.type === "point" ? "50%" : 1, flexShrink: 0,
                background: ly.fill !== "none" ? (ly.fill ?? ly.stroke) : ly.stroke }} />
              <span style={{ fontFamily: mono, fontSize: 9, color: activeId === ly.id ? C.teal : C.text }}>
                {ly.type}{(ly.wktCol || ly.latCol) ? ` · ${ly.wktCol || ly.latCol}` : ""}
              </span>
              <button onClick={e => { e.stopPropagation(); removeLayer(ly.id); }}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.textMuted, padding: "0 0 0 2px", lineHeight: 1 }}>×</button>
            </div>
          ))}
          {[["polygon","Polygon"], ["boundary","Boundary"], ["point","Point"], ["line","Line"]].map(([t, lbl]) => (
            <button key={t} onClick={() => addLayer(t)}
              style={{ padding: "2px 8px", borderRadius: 12, fontFamily: mono, fontSize: 9, background: "none", border: `1px dashed ${C.border2}`, color: C.textMuted, cursor: "pointer" }}
            >+{lbl}</button>
          ))}
        </div>

        {/* Row 2 — active layer config */}
        {activeLayer && histIdx === null && (
          <div style={{ padding: "8px 10px", background: C.surface, borderRadius: 4, border: `1px solid ${C.border2}` }}>
            <GeoLayerConfig ly={activeLayer} onChange={updateLayer} headers={headers} wktHeaders={wktHeaders} availableDatasets={availableDatasets} C={C} />
          </div>
        )}

        {/* Row 3 — title/subtitle/source + save/nav */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {[["TITLE", title, setTitle, "title", 110], ["SUBTITLE", subtitle, setSubtitle, "subtitle", 140], ["SOURCE", caption, setCaption, "source / caption", 140]].map(([lbl, val, set, ph, w]) => (
            <div key={lbl} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono }}>{lbl}</span>
              <input value={val} onChange={e => set(e.target.value)} placeholder={ph}
                style={{ padding: "2px 6px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, fontFamily: "serif", fontSize: 10, color: C.text, outline: "none", width: w }} />
            </div>
          ))}
          {/* Height slider */}
          <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ fontSize: 7, color: C.textMuted, fontFamily: mono }}>H</span>
            <input type="range" min={150} max={1200} step={20}
              value={userH ?? Math.max(200, canvasH - 60)}
              onChange={e => setUserH(parseInt(e.target.value))}
              style={{ width: 70, accentColor: C.teal }} />
            <span style={{ fontFamily: mono, fontSize: 8, color: C.textMuted, minWidth: 32 }}>
              {userH ?? "auto"}
            </span>
            {userH !== null && (
              <button onClick={() => setUserH(null)}
                style={{ background: "none", border: "none", cursor: "pointer", fontSize: 10, color: C.textMuted, padding: 0, lineHeight: 1 }}>↺</button>
            )}
          </div>

          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            {plotHistory.length > 0 && (<>
              <button onClick={() => setHistIdx(i => i === null ? plotHistory.length - 1 : Math.max(0, i - 1))}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>←</button>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted }}>
                {histIdx !== null ? `${histIdx + 1}/${plotHistory.length}` : `–/${plotHistory.length}`}
              </span>
              <button onClick={() => setHistIdx(i => i === null ? 0 : Math.min(plotHistory.length - 1, i + 1))}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>→</button>
            </>)}
            {pid && <button onClick={savePlot}
              style={{ padding: "2px 10px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: `${C.teal}18`, border: `1px solid ${C.teal}60`, color: C.teal, cursor: "pointer" }}>Save</button>}
            <button onClick={newPlot}
              style={{ padding: "2px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>New</button>
          </div>
        </div>
      </div>

      {/* Canvas + history */}
      <div ref={wrapRef} style={{ padding: "16px 20px", background: "#f5f5f5" }}>
        {pltErr && <div style={{ color: "#c47070", fontFamily: mono, fontSize: 10, marginBottom: 8 }}>Observable Plot load error: {pltErr}</div>}
        {!Plt && !pltErr && <div style={{ color: C.textMuted, fontFamily: mono, fontSize: 10 }}>Loading Observable Plot…</div>}
        {Plt && dLayers.length === 0 && (
          <div style={{ textAlign: "center", color: C.textMuted, fontFamily: mono, fontSize: 10, marginTop: 60 }}>
            Add a +Polygon / +Boundary / +Point / +Line layer to build your map.
          </div>
        )}
        {Plt && dLayers.length > 0 && (
          <GeoPlotCanvas Plt={Plt} layers={dLayers} rows={rows} availableDatasets={availableDatasets}
            title={dTitle} subtitle={dSubtitle} caption={dCaption} width={plotW}
            maxH={Math.max(200, (typeof window !== "undefined" ? window.innerHeight : 700) - 260)}
            forceH={userH ?? 0} />
        )}

        {/* History strip */}
        {plotHistory.length > 0 && (
          <div style={{ marginTop: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 12, borderTop: `1px solid ${C.border}` }}>
              <span style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.15em" }}>Saved</span>
              <button onClick={() => setHistOpen(o => !o)}
                style={{ padding: "2px 8px", borderRadius: 3, fontFamily: mono, fontSize: 9, background: "none", border: `1px solid ${C.border2}`, color: C.textMuted, cursor: "pointer" }}>
                {histOpen ? "▲" : "▼"} {plotHistory.length}
              </button>
            </div>
            {histOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
                {plotHistory.map((entry, i) => (
                  <div key={entry.id} onClick={() => setHistIdx(histIdx === i ? null : i)}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 4, cursor: "pointer",
                      background: histIdx === i ? `${C.teal}15` : C.surface,
                      border: `1px solid ${histIdx === i ? C.teal + "50" : C.border2}` }}
                  >
                    <input type="checkbox" checked={compareIds.has(entry.id)} onClick={e => e.stopPropagation()}
                      onChange={e => setCompareIds(prev => { const s = new Set(prev); e.target.checked ? s.add(entry.id) : s.delete(entry.id); return s; })}
                      style={{ accentColor: C.teal, cursor: "pointer" }} />
                    <span style={{ fontFamily: mono, fontSize: 9, color: C.text }}>{entry.name}</span>
                    <button onClick={e => { e.stopPropagation(); deletePlot(entry.id); }}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: 12, color: C.textMuted, padding: "0 0 0 2px", lineHeight: 1 }}>×</button>
                  </div>
                ))}
              </div>
            )}
            {comparePlots.length >= 2 && Plt && (
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 16 }}>
                {comparePlots.map(entry => (
                  <div key={entry.id} style={{ flex: "1 1 340px" }}>
                    <div style={{ fontFamily: mono, fontSize: 9, color: C.textMuted, marginBottom: 6 }}>{entry.name}</div>
                    <GeoPlotCanvas Plt={Plt} layers={entry.layers ?? []} rows={rows} availableDatasets={availableDatasets}
                      title={entry.title} subtitle={entry.subtitle} caption={entry.caption}
                      width={Math.max(240, (plotW - 32) / 2)}
                      forceH={userH ?? 0} />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function SpatialTab({ rows = [], headers = [], availableDatasets = [], onAddDataset, pid }) {
  const { C } = useTheme();
  const [mainTab,     setMainTab]     = useState("analyze");
  const [pendingRows, setPendingRows] = useState(null);
  const [pendingCols, setPendingCols] = useState([]);

  const numericHeaders = useMemo(
    () => headers.filter(h => rows.slice(0, 20).some(r => typeof r[h] === "number")),
    [rows, headers]
  );

  // Eagerly preload Leaflet so Map Viewer and Plot tab open instantly.
  // loadLeaflet() is idempotent — uses window.L cache after first load.
  const hasRows = rows.length > 0;
  useEffect(() => {
    if (hasRows) loadLeaflet().catch(() => {});
  }, [hasRows]);

  const handleResult = useCallback((resultRows, newCols) => {
    setPendingRows(resultRows);
    setPendingCols(newCols);
  }, []);

  function handleSave(name, resultRows) {
    const allHeaders = [...new Set([...headers, ...pendingCols])];
    onAddDataset?.(name, resultRows, allHeaders);
    setPendingRows(null);
    setPendingCols([]);
  }

  const hasData = rows.length > 0 && headers.length > 0;

  // Key derived from the active dataset's column fingerprint.
  // When headers change (dataset switch), all section sub-components remount
  // so their useState() column selections reset to the new dataset's guesses.
  const sectionsKey = headers.join("\0");

  // Clear any pending result from the previous dataset when headers change.
  useEffect(() => {
    setPendingRows(null);
    setPendingCols([]);
  }, [sectionsKey]);

  return (
    <div style={{
      display: "flex", flexDirection: "column", height: "100%",
      fontFamily: mono, color: C.text, overflow: "hidden",
    }}>
      <div style={{ padding: "0.75rem 1.2rem 0", flexShrink: 0 }}>
        <HintBox tips={[
          "Load a shapefile (.shp + .dbf) to map geographic boundaries",
          "Join your dataset to the shapefile by a common identifier column",
          "Choropleth maps color regions by any numeric variable",
          "Spatial statistics: Moran's I for spatial autocorrelation",
        ]} />
      </div>
      {/* ── Header + tab bar ── */}
      <div style={{
        padding: "0.6rem 1.2rem", borderBottom: `1px solid ${C.border}`,
        background: C.surface2, flexShrink: 0,
        display: "flex", alignItems: "center", gap: 12,
      }}>
        <span style={{ fontSize: 9, color: C.teal, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          Spatial Analytics
        </span>
        {hasData && (
          <span style={{ fontSize: 9, color: C.textMuted }}>
            {rows.length.toLocaleString()} rows · {numericHeaders.length} numeric cols
          </span>
        )}
        {/* Tab toggle */}
        <div style={{ display: "flex", gap: 3, marginLeft: "auto" }}>
          {[["analyze", "Analyze"], ["map", "Map"], ["plot", "Plot"]].map(([tab, lbl]) => (
            <button key={tab} onClick={() => setMainTab(tab)}
              style={{
                padding: "3px 12px", borderRadius: 3, fontFamily: mono, fontSize: 9, cursor: "pointer",
                background: mainTab === tab ? `${C.teal}18` : "transparent",
                border: `1px solid ${mainTab === tab ? C.teal + "60" : C.border}`,
                color: mainTab === tab ? C.teal : C.textMuted,
              }}
            >{lbl}</button>
          ))}
        </div>
      </div>

      {/* ── No data guard ── */}
      {!hasData && (
        <div style={{
          flex: 1, display: "flex", flexDirection: "column", alignItems: "center",
          justifyContent: "center", gap: 10,
        }}>
          <div style={{ fontSize: 22, color: C.border2 }}>⊙</div>
          <div style={{ fontSize: 12, color: C.textDim }}>No dataset active.</div>
          <div style={{ fontSize: 10, color: C.textMuted }}>
            Run your pipeline in Clean → or load data in the Data tab.
          </div>
        </div>
      )}

      {/* ── Map tab (Leaflet layer builder) ── */}
      {hasData && mainTab === "map" && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <SpatialPlotTab
            rows={rows} headers={headers}
            availableDatasets={availableDatasets}
            onAddDataset={onAddDataset}
            C={C}
          />
        </div>
      )}

      {/* ── Plot tab (ggplot2+sf style static map, with history) ── */}
      {hasData && mainTab === "plot" && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <SpatialGeoPlot
            rows={rows} headers={headers}
            availableDatasets={availableDatasets}
            C={C}
            pid={pid}
          />
        </div>
      )}

      {/* ── Analyze sections ── */}
      {hasData && mainTab === "analyze" && (
        <div key={sectionsKey} style={{ flex: 1, overflowY: "auto", padding: "1.2rem 1.4rem", position: "relative" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>

            <Section title="Distance to Point" badge="haversine · km" C={C} defaultOpen>
              <DistanceSection rows={rows} headers={numericHeaders.length ? numericHeaders : headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="Buffer Indicator" badge="0 / 1 treatment" C={C}>
              <BufferSection rows={rows} headers={numericHeaders.length ? numericHeaders : headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="Grid Assignment" badge="rectangular · hex" C={C}>
              <GridSection rows={rows} headers={numericHeaders.length ? numericHeaders : headers} onResult={handleResult} C={C} />
            </Section>

            <Section title="Spatial Join (point-in-polygon)" badge="requires polygon dataset" C={C}>
              <SpatialJoinSection
                rows={rows} headers={headers}
                availableDatasets={availableDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Nearest Neighbour" badge="O(n × m) brute-force" C={C}>
              <NearestNeighborSection
                rows={rows} headers={numericHeaders.length ? numericHeaders : headers}
                availableDatasets={availableDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Distance to Boundary" badge="Spatial RD running variable" C={C}>
              <BoundaryDistanceSection
                rows={rows} headers={numericHeaders.length ? numericHeaders : headers}
                availableDatasets={availableDatasets}
                C={C} onResult={handleResult}
              />
            </Section>

            <Section title="Geocode — Address → Lat/Lon" badge="coming soon · phase 11.2" C={C}>
              <GeocodeSection C={C} />
            </Section>

          </div>

          {/* Sticky save bar — visible wherever the user is in the list */}
          {pendingRows && (
            <div style={{ position: "sticky", bottom: 0, left: 0, right: 0, zIndex: 10, paddingTop: 8 }}>
              <OutputPanel
                pendingRows={pendingRows}
                pendingCols={pendingCols}
                onSave={handleSave}
                C={C}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
