// ─── ECON STUDIO · SpatialTab.jsx ────────────────────────────────────────────
// Spatial analytics module — Phase 11.
// Sections: Distance · Buffer · Grid Assignment · Spatial Join · Nearest Neighbour · Geocode
// All operations call SpatialEngine.js (pure JS, no backend).

import { useState, useMemo, useCallback } from "react";
import { useTheme } from "../../ThemeContext.jsx";
import { HintBox } from "../HelpSystem.jsx";
import {
  haversine,
  assignDistance,
  assignBuffer,
  assignRectGrid,
  assignH3Grid,
  spatialJoin,
  nearestNeighbor,
} from "../../math/SpatialEngine.js";

const mono = "'IBM Plex Mono','JetBrains Mono',Consolas,monospace";

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
      display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    }}>
      <span style={{ fontSize: 10, color: C.teal, flex: 1 }}>
        Ready to save — {pendingRows.length} rows · new col{pendingCols.length > 1 ? "s" : ""}: {pendingCols.join(", ")}
      </span>
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
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────

export default function SpatialTab({ rows = [], headers = [], availableDatasets = [], onAddDataset }) {
  const { C } = useTheme();
  const [pendingRows, setPendingRows] = useState(null);
  const [pendingCols, setPendingCols] = useState([]);

  const numericHeaders = useMemo(
    () => headers.filter(h => rows.slice(0, 20).some(r => typeof r[h] === "number")),
    [rows, headers]
  );

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
      {/* ── Header ── */}
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
        <span style={{ fontSize: 9, color: C.border2, marginLeft: "auto" }}>Phase 11</span>
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

      {/* ── Sections ── */}
      {hasData && (
        <div style={{ flex: 1, overflowY: "auto", padding: "1.2rem 1.4rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxWidth: 860 }}>

            {/* Save pending result */}
            <OutputPanel
              pendingRows={pendingRows}
              pendingCols={pendingCols}
              onSave={handleSave}
              C={C}
            />

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

            <Section title="Geocode — Address → Lat/Lon" badge="coming soon · phase 11.2" C={C}>
              <GeocodeSection C={C} />
            </Section>

          </div>
        </div>
      )}
    </div>
  );
}
