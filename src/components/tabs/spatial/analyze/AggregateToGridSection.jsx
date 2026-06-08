// ─── ECON STUDIO · spatial/analyze/AggregateToGridSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol, guessWktCol, guessPointCountCol } from "../shared/guess.js";
import { aggregateToGrid, aggregateGridById } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function AggregateToGridSection({ rows, headers, availableDatasets, C, onResult }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [mode, setMode] = useState("grid_id");
  const [latCol, setLatCol] = useState(() => guessLatCol(headers));
  const [lonCol, setLonCol] = useState(() => guessLonCol(headers));
  const [pointGridCol, setPointGridCol] = useState(() => headers.find(h => /^grid_?id$/i.test(h)) ?? "");
  const [gridDsId, setGridDsId] = useState("");
  const [wktCol, setWktCol] = useState("");
  const [gridIdCol, setGridIdCol] = useState("");
  const [fn, setFn] = useState("count");
  const [valueCol, setValueCol] = useState("");
  const [outCol, setOutCol] = useState(() => guessPointCountCol(headers));
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const gridDs = availableDatasets.find(ds => ds.id === gridDsId);
  const gridHeaders = gridDs?.headers ?? [];
  const guessedWkt = useMemo(() => guessWktCol(gridHeaders), [gridHeaders]);
  const guessedGridId = useMemo(
    () => gridHeaders.find(h => /^grid_?id$/i.test(h)) ?? gridHeaders.find(h => /(^|_)id$/i.test(h)) ?? gridHeaders[0] ?? "",
    [gridHeaders]
  );
  const effectiveWkt = wktCol || guessedWkt;
  const effectiveGridId = gridIdCol || guessedGridId;
  const canApply = gridDs?.rows?.length && outCol && (fn === "count" || valueCol) && (
    mode === "grid_id"
      ? pointGridCol && effectiveGridId
      : latCol && lonCol && effectiveWkt
  );

  function apply() {
    setErr("");
    try {
      const spec = { col: fn === "count" ? "" : valueCol, fn, outCol };
      const out = mode === "grid_id"
        ? aggregateGridById(gridDs.rows, effectiveGridId, rows, pointGridCol, [spec])
        : aggregateToGrid(gridDs.rows, effectiveWkt, rows, latCol, lonCol, [spec]);
      setResult({ rows: out, cols: [outCol] });
      appendLog({ module: "spatial", opType: "aggregate_to_grid", params: { mode, gridDsId, outCol, fn, ...(fn !== "count" ? { valueCol } : {}), ...(mode === "grid_id" ? { pointGridCol, gridIdCol: effectiveGridId } : { latCol, lonCol, wktCol: effectiveWkt }) }, label: `Aggregate ${fn === "count" ? "count" : `${fn}(${valueCol})`} → ${outCol} (${out.length} grid cells)` });
      onResult(out, [outCol], gridHeaders);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Aggregates active point rows into a grid dataset. If points already have grid_id, use the fast ID path; geometry mode remains available for raw lat/lon points.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[
          ["Schools per grid", "n_schools"],
          ["Points per grid", "n_points"],
        ].map(([label, col]) => (
          <button key={col} onClick={() => { setMode("grid_id"); setFn("count"); setOutCol(col); }}
            style={{ padding: "3px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
              background: outCol === col && fn === "count" ? `${C.gold}18` : "transparent",
              border: `1px solid ${outCol === col && fn === "count" ? C.gold : C.border2}`,
              borderRadius: 3, color: outCol === col && fn === "count" ? C.gold : C.textDim }}
          >{label}</button>
        ))}
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["grid_id", "Use assigned grid_id"], ["geometry", "Point-in-polygon"]].map(([v, label]) => (
          <button key={v} onClick={() => setMode(v)}
            style={{ padding: "3px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
              background: mode === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${mode === v ? C.teal : C.border2}`,
              borderRadius: 3, color: mode === v ? C.teal : C.textDim }}
          >{label}</button>
        ))}
      </div>
      {mode === "geometry" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ColSelect label="Point latitude" value={latCol} onChange={setLatCol} headers={headers} C={C} />
          <ColSelect label="Point longitude" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        </div>
      ) : (
        <ColSelect label="Point grid ID column" value={pointGridCol} onChange={setPointGridCol} headers={headers} C={C} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Grid dataset</label>
        <select value={gridDsId} onChange={e => { setGridDsId(e.target.value); setWktCol(""); setGridIdCol(""); }}
          style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none" }}>
          <option value="">select grid dataset</option>
          {availableDatasets.map(ds => <option key={ds.id} value={ds.id}>{ds.filename ?? ds.name ?? ds.id}</option>)}
        </select>
      </div>
      {gridDs && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {mode === "geometry" ? (
            <ColSelect label="Grid WKT column" value={effectiveWkt} onChange={setWktCol} headers={gridHeaders} C={C} />
          ) : (
            <ColSelect label="Grid ID column" value={effectiveGridId} onChange={setGridIdCol} headers={gridHeaders} C={C} />
          )}
          <ColSelect label="Aggregation" value={fn} onChange={setFn} headers={["count", "sum", "mean", "share"]} C={C} />
          {fn !== "count" && <ColSelect label="Value column" value={valueCol} onChange={setValueCol} headers={headers} C={C} />}
          <TextInput label="Output column" value={outCol} onChange={setOutCol} C={C} placeholder="n_points" />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label={outCol === "n_schools" ? "Sum schools per grid" : "Aggregate to grid"} />
        {result && <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>OK: {result.rows.length} grid cells</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={mode === "geometry" ? [effectiveWkt, outCol] : [effectiveGridId, outCol]} C={C} />}
    </div>
  );
}

// 5. Nearest Neighbour
