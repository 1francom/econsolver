import { useMemo, useState } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";

import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessWktCol } from "../shared/guess.js";
import { arealInterpolate } from "../../../../math/SpatialEngine.js";

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
  const { T } = useTheme();
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>{label}</label>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, outline: "none" }}>
        {datasets.map(ds => <option key={ds.id} value={ds.id}>{ds.name}</option>)}
      </select>
    </div>
  );
}

export function ArealInterpolateSection({ rows, headers, availableDatasets, C, onResult }) {
  const { T } = useTheme();
  const datasets = useMemo(() => datasetList(rows, headers, availableDatasets), [rows, headers, availableDatasets]);
  const [sourceId, setSourceId] = useState("active");
  const [targetId, setTargetId] = useState(availableDatasets[0]?.id ?? "active");
  const [sourceWkt, setSourceWkt] = useState("");
  const [targetWkt, setTargetWkt] = useState("");
  const [targetIdCol, setTargetIdCol] = useState("");
  const [valueCols, setValueCols] = useState([]);
  const [extensive, setExtensive] = useState(true);
  const [outPrefix, setOutPrefix] = useState("aw");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const sourceDs = datasets.find(ds => ds.id === sourceId) ?? datasets[0];
  const targetDs = datasets.find(ds => ds.id === targetId) ?? datasets[0];
  const effectiveSourceWkt = sourceWkt || guessWktCol(sourceDs.headers);
  const effectiveTargetWkt = targetWkt || guessWktCol(targetDs.headers);
  const effectiveTargetId = targetIdCol || targetDs.headers.find(h => /^grid_?id$/i.test(h)) || targetDs.headers.find(h => /(^|_)id$/i.test(h)) || targetDs.headers[0] || "";
  const numericSourceHeaders = sourceDs.headers.filter(h => sourceDs.rows.slice(0, 30).some(r => Number.isFinite(Number(r[h]))));
  const outCols = valueCols.map(c => (outPrefix || "").trim() ? `${outPrefix.trim()}_${c}` : c);
  const canApply = sourceDs?.rows?.length && targetDs?.rows?.length && effectiveSourceWkt && effectiveTargetWkt && effectiveTargetId && valueCols.length;

  function toggleValue(col) {
    setValueCols(prev => prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]);
  }

  function apply() {
    setErr("");
    try {
      const out = arealInterpolate(
        sourceDs.rows,
        effectiveSourceWkt,
        targetDs.rows,
        effectiveTargetWkt,
        effectiveTargetId,
        valueCols,
        {
          sourceCrs: "auto",
          targetSourceCrs: "auto",
          metricCrs: "EPSG:32721",
          extensive,
          outPrefix: (outPrefix || "").trim(),
        },
      );
      setResult({ rows: out, cols: outCols });
      onResult(out, outCols, targetDs.headers);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Transfers polygon attributes from a source layer to a target polygon layer using intersection area weights in EPSG:32721.
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <DatasetSelect label="Source polygons" value={sourceId} onChange={v => { setSourceId(v); setSourceWkt(""); setValueCols([]); }} datasets={datasets} C={C} />
        <DatasetSelect label="Target polygons" value={targetId} onChange={v => { setTargetId(v); setTargetWkt(""); setTargetIdCol(""); }} datasets={datasets} C={C} />
        <ColSelect label="Source WKT" value={effectiveSourceWkt} onChange={setSourceWkt} headers={sourceDs.headers} C={C} />
        <ColSelect label="Target WKT" value={effectiveTargetWkt} onChange={setTargetWkt} headers={targetDs.headers} C={C} />
        <ColSelect label="Target ID" value={effectiveTargetId} onChange={setTargetIdCol} headers={targetDs.headers} C={C} />
        <TextInput label="Output prefix" value={outPrefix} onChange={setOutPrefix} C={C} placeholder="aw" />
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["extensive", "Extensive sum"], ["intensive", "Intensive mean"]].map(([mode, label]) => (
          <button key={mode} onClick={() => setExtensive(mode === "extensive")}
            style={{ padding: "3px 10px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
              background: (extensive ? "extensive" : "intensive") === mode ? `${C.teal}18` : "transparent",
              border: `1px solid ${(extensive ? "extensive" : "intensive") === mode ? C.teal : C.border2}`,
              borderRadius: 3, color: (extensive ? "extensive" : "intensive") === mode ? C.teal : C.textDim }}>
            {label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <label style={{ fontSize: T.caption.fontSize, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Value columns</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {numericSourceHeaders.map(h => (
            <button key={h} onClick={() => toggleValue(h)}
              style={{ padding: "2px 8px", fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, cursor: "pointer",
                background: valueCols.includes(h) ? `${C.gold}18` : "transparent",
                border: `1px solid ${valueCols.includes(h) ? C.gold : C.border2}`,
                borderRadius: 3, color: valueCols.includes(h) ? C.gold : C.textDim }}>
              {h}
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Interpolate" />
        {result && <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>OK: {result.rows.length} target polygons</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[effectiveTargetId, ...result.cols]} C={C} />}
    </div>
  );
}
