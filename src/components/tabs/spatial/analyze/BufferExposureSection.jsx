import { useMemo, useState } from "react";
import { mono } from "../shared/constants.js";
import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessWktCol } from "../shared/guess.js";
import { countBuffersIntersectingGrid, dissolveBuffers, gridExposureShare } from "../../../../math/SpatialEngine.js";

function datasetList(rows, headers, availableDatasets) {
  return [
    { id: "active", name: "active dataset", rows, headers },
    ...availableDatasets.map(ds => ({
      id: ds.id,
      name: ds.filename ?? ds.name ?? ds.id,
      rows: ds.rows ?? [],
      headers: ds.headers ?? [],
    })),
  ];
}

function DatasetSelect({ label, value, onChange, datasets, C }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
        {datasets.map(ds => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
      </select>
    </div>
  );
}

function defaultWkt(headers) {
  return headers.includes("metric_geometry") ? "metric_geometry" : guessWktCol(headers);
}

export function BufferExposureSection({ rows, headers, availableDatasets, C, onResult }) {
  const datasets = useMemo(() => datasetList(rows, headers, availableDatasets), [rows, headers, availableDatasets]);
  const [bufferId, setBufferId] = useState("active");
  const [gridId, setGridId] = useState(availableDatasets[0]?.id ?? "active");
  const [bufferWkt, setBufferWkt] = useState("");
  const [gridWkt, setGridWkt] = useState("");
  const [gridIdCol, setGridIdCol] = useState("");
  const [mode, setMode] = useState("both");
  const [outPrefix, setOutPrefix] = useState("buffer");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const bufferDs = datasets.find(ds => ds.id === bufferId) ?? datasets[0];
  const gridDs = datasets.find(ds => ds.id === gridId) ?? datasets[0];
  const effectiveBufferWkt = bufferWkt || defaultWkt(bufferDs.headers);
  const effectiveGridWkt = gridWkt || defaultWkt(gridDs.headers);
  const effectiveGridId = gridIdCol || gridDs.headers.find(h => /^grid_?id$/i.test(h)) || gridDs.headers.find(h => /(^|_)id$/i.test(h)) || gridDs.headers[0] || "";
  const prefix = (outPrefix || "buffer").trim() || "buffer";
  const shareCol = `${prefix}_exposure_share`;
  const countCol = `${prefix}_overlap_count`;
  const canApply = bufferDs?.rows?.length && gridDs?.rows?.length && effectiveBufferWkt && effectiveGridWkt && effectiveGridId;

  function apply() {
    setErr("");
    try {
      let out = gridDs.rows;
      const cols = [];
      if (mode === "share" || mode === "both") {
        const dissolved = dissolveBuffers(bufferDs.rows, effectiveBufferWkt, {
          sourceCrs: "auto",
          metricCrs: "EPSG:32721",
          outputCrs: "EPSG:32721",
        });
        out = gridExposureShare(out, effectiveGridWkt, effectiveGridId, dissolved, {
          gridSourceCrs: "auto",
          dissolvedSourceCrs: "EPSG:32721",
          metricCrs: "EPSG:32721",
          outCol: shareCol,
        });
        cols.push(shareCol, `${shareCol}_area_m2`, "area_total_m2");
      }
      if (mode === "count" || mode === "both") {
        out = countBuffersIntersectingGrid(out, effectiveGridWkt, effectiveGridId, bufferDs.rows, effectiveBufferWkt, {
          gridSourceCrs: "auto",
          bufferSourceCrs: "auto",
          metricCrs: "EPSG:32721",
          outCol: countCol,
        });
        cols.push(countCol);
      }
      setResult({ rows: out, cols });
      onResult(out, cols, gridDs.headers);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Computes dissolved buffer exposure share per grid cell and/or the number of individual buffer polygons intersecting each cell.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["both", "Share + count"], ["share", "Exposure share"], ["count", "Overlap count"]].map(([v, label]) => (
          <button key={v} onClick={() => setMode(v)}
            style={{ padding: "3px 10px", fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: mode === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${mode === v ? C.teal : C.border2}`,
              borderRadius: 3, color: mode === v ? C.teal : C.textDim }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <DatasetSelect label="Buffer polygons" value={bufferId} onChange={v => { setBufferId(v); setBufferWkt(""); }} datasets={datasets} C={C} />
        <DatasetSelect label="Grid polygons" value={gridId} onChange={v => { setGridId(v); setGridWkt(""); setGridIdCol(""); }} datasets={datasets} C={C} />
        <ColSelect label="Buffer WKT" value={effectiveBufferWkt} onChange={setBufferWkt} headers={bufferDs.headers} C={C} />
        <ColSelect label="Grid WKT" value={effectiveGridWkt} onChange={setGridWkt} headers={gridDs.headers} C={C} />
        <ColSelect label="Grid ID" value={effectiveGridId} onChange={setGridIdCol} headers={gridDs.headers} C={C} />
        <TextInput label="Output prefix" value={outPrefix} onChange={setOutPrefix} C={C} placeholder="schools_100m" />
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Compute exposure" />
        {result && <span style={{ fontSize: 9, color: C.teal }}>OK: {result.rows.length} grid cells</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[effectiveGridId, ...result.cols]} C={C} />}
    </div>
  );
}
