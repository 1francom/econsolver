// ─── ECON STUDIO · spatial/analyze/GridSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { mono } from "../shared/constants.js";
import { ColSelect, NumInput, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol, guessWktCol, isGeometryHeader } from "../shared/guess.js";
import { assignRectGrid, assignH3Grid, assignPointsToGrid } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../../services/session/sessionLog.jsx";

export function GridSection({ rows, headers, availableDatasets, onResult, C }) {
  const { appendLog } = useSessionLog();
  const [latCol,    setLatCol]    = useState(() => guessLatCol(headers));
  const [lonCol,    setLonCol]    = useState(() => guessLonCol(headers));
  const [gridType,  setGridType]  = useState("existing"); // "existing" | "rectangular" | "hex"
  const [cellSize,  setCellSize]  = useState(50);
  const [resolution, setResolution] = useState(2);
  const [outCol,    setOutCol]    = useState("grid_id");
  const [gridDsId, setGridDsId] = useState("");
  const [wktCol, setWktCol] = useState("");
  const [gridIdCol, setGridIdCol] = useState("");
  const [extraCols, setExtraCols] = useState([]);
  const [result,    setResult]    = useState(null);
  const [err,       setErr]       = useState("");

  const gridDs = availableDatasets.find(ds => ds.id === gridDsId);
  const gridHeaders = gridDs?.headers ?? [];
  const guessedWkt = useMemo(() => {
    if (gridHeaders.includes("metric_geometry")) return "metric_geometry";
    return guessWktCol(gridHeaders);
  }, [gridHeaders]);
  const guessedId = useMemo(
    () => gridHeaders.find(h => /^grid_?id$/i.test(h)) ?? gridHeaders.find(h => /(^|_)id$/i.test(h)) ?? gridHeaders[0] ?? "",
    [gridHeaders]
  );
  const effectiveWkt = wktCol || guessedWkt;
  const effectiveGridId = gridIdCol || guessedId;
  const gridExtraHeaders = gridHeaders.filter(h =>
    h !== effectiveWkt && h !== effectiveGridId && !isGeometryHeader(gridHeaders, gridDs?.rows ?? [], h)
  );

  const canApply = latCol && lonCol && outCol && (
    gridType === "existing"
      ? gridDs?.rows?.length && effectiveWkt && effectiveGridId
      : (gridType === "rectangular" ? cellSize > 0 : true)
  );

  function toggleExtraCol(col) {
    setExtraCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  function apply() {
    setErr("");
    try {
      if (gridType === "existing") {
        const out = assignPointsToGrid(
          rows,
          latCol,
          lonCol,
          gridDs.rows,
          effectiveWkt,
          effectiveGridId,
          outCol,
          { attributeCols: extraCols, metricCrs: "EPSG:32721" }
        );
        const matched = out.filter(r => r[outCol] != null).length;
        const cols = [outCol, "grid_row_index", ...extraCols];
        const distinct = new Set(out.map(r => r[outCol]).filter(v => v != null)).size;
        setResult({ rows: out, distinct, matched, cols });
        appendLog({ module: "spatial", opType: "grid_assign_existing", params: { latCol, lonCol, outCol, gridDsId, wktCol: effectiveWkt, gridIdCol: effectiveGridId, extraCols }, label: `Grid assign → ${outCol} (${distinct} cells, ${matched}/${rows.length} matched)` });
        onResult(out, cols);
        return;
      }

      const out = gridType === "rectangular"
        ? assignRectGrid(rows, latCol, lonCol, Number(cellSize), outCol)
        : assignH3Grid(rows, latCol, lonCol, Number(resolution), outCol);
      const distinct = new Set(out.map(r => r[outCol]).filter(v => v != null)).size;
      setResult({ rows: out, distinct, matched: null, cols: [outCol] });
      appendLog({ module: "spatial", opType: gridType === "rectangular" ? "grid_rect" : "grid_hex", params: { latCol, lonCol, outCol, ...(gridType === "rectangular" ? { cellSize: Number(cellSize) } : { resolution: Number(resolution) }) }, label: `${gridType === "rectangular" ? `Rect grid ${cellSize}km` : `Hex grid res ${resolution}`} → ${outCol} (${distinct} cells)` });
      onResult(out, [outCol]);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Assigns each point to a stable grid ID from an existing grid, or to quick exploratory rectangular/hex bins.
        Use existing generated grids for schools, crimes, bus stops, and police station point workflows.
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 4 }}>
        {[["existing", "Existing grid"], ["rectangular", "Rectangular"], ["hex", "Hex (approx.)"]].map(([v, l]) => (
          <button
            key={v} onClick={() => {
              setGridType(v);
              setOutCol(v === "existing" ? "grid_id" : "grid_cell");
            }}
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
        {gridType === "existing" ? null : gridType === "rectangular"
          ? <NumInput label="Cell size (km)" value={cellSize} onChange={setCellSize} C={C} min={0.1} step={1} />
          : <NumInput label="Resolution (0–5)" value={resolution} onChange={setResolution} C={C} min={0} max={5} step={1} />
        }
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="grid_cell" />
      </div>
      {gridType === "existing" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Grid dataset</label>
            <select value={gridDsId} onChange={e => { setGridDsId(e.target.value); setWktCol(""); setGridIdCol(""); setExtraCols([]); }}
              style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
              <option value="">select grid dataset</option>
              {availableDatasets.map(ds => <option key={ds.id} value={ds.id}>{ds.filename ?? ds.name ?? ds.id}</option>)}
            </select>
          </div>
          {gridDs && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <ColSelect label="Grid WKT column" value={effectiveWkt} onChange={setWktCol} headers={gridHeaders} C={C} />
                <ColSelect label="Grid ID column" value={effectiveGridId} onChange={setGridIdCol} headers={gridHeaders} C={C} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Optional grid attributes</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {gridExtraHeaders.map(h => (
                    <button key={h} onClick={() => toggleExtraCol(h)}
                      style={{ padding: "2px 8px", fontFamily: mono, fontSize: 9, cursor: "pointer",
                        background: extraCols.includes(h) ? `${C.teal}18` : "transparent",
                        border: `1px solid ${extraCols.includes(h) ? C.teal : C.border2}`,
                        borderRadius: 3, color: extraCols.includes(h) ? C.teal : C.textDim }}
                    >{h}</button>
                  ))}
                </div>
              </div>
            </>
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Assign grid" />
        {result && (
          <span style={{ fontSize: 9, color: C.teal }}>
            {gridType === "existing" ? `OK: ${result.matched} / ${rows.length} matched, ${result.distinct} grid cells` : `OK: ${result.distinct} distinct cells across ${rows.length} rows`}
          </span>
        )}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[...result.cols, latCol, lonCol]} C={C} />}
    </div>
  );
}

// 4. Spatial Join (point-in-polygon)
