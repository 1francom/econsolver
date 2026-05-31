// ─── ECON STUDIO · spatial/analyze/CRSTransformSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { mono } from "../shared/constants.js";
import { ColSelect, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol, guessWktCol } from "../shared/guess.js";
import { transformCoord, transformWKT } from "../../../../math/SpatialEngine.js";

export function CRSTransformSection({ rows, headers, onResult, C }) {
  const [mode, setMode] = useState("point");
  const [source, setSource] = useState("EPSG:4326");
  const [target, setTarget] = useState("EPSG:32721");
  const [xCol, setXCol] = useState(() => guessLonCol(headers));
  const [yCol, setYCol] = useState(() => guessLatCol(headers));
  const [wktCol, setWktCol] = useState(() => guessWktCol(headers));
  const [outX, setOutX] = useState("x_32721");
  const [outY, setOutY] = useState("y_32721");
  const [outWkt, setOutWkt] = useState("geometry_32721");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const canApply = mode === "point"
    ? xCol && yCol && outX && outY && source && target
    : wktCol && outWkt && source && target;

  function apply() {
    setErr("");
    try {
      if (mode === "point") {
        const out = rows.map(r => {
          const x = Number(r[xCol]);
          const y = Number(r[yCol]);
          if (!isFinite(x) || !isFinite(y)) return { ...r, [outX]: null, [outY]: null };
          const [nx, ny] = transformCoord(x, y, source, target);
          return { ...r, [outX]: nx, [outY]: ny };
        });
        setResult({ rows: out, cols: [outX, outY] });
        onResult(out, [outX, outY]);
      } else {
        const out = rows.map(r => ({
          ...r,
          [outWkt]: r[wktCol] ? transformWKT(String(r[wktCol]), source, target, target === "EPSG:4326" ? 8 : 3) : null,
        }));
        setResult({ rows: out, cols: [outWkt] });
        onResult(out, [outWkt]);
      }
    } catch (e) {
      setErr(e.message || "CRS transform failed");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Transforms point columns or WKT geometries between WGS84 and CABA metric coordinates.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["point", "Point columns"], ["wkt", "WKT geometry"]].map(([v, label]) => (
          <button key={v} onClick={() => setMode(v)}
            style={{ padding: "3px 10px", fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: mode === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${mode === v ? C.teal : C.border2}`,
              borderRadius: 3, color: mode === v ? C.teal : C.textDim }}
          >{label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Source CRS" value={source} onChange={setSource} headers={["EPSG:4326", "EPSG:32721"]} C={C} />
        <ColSelect label="Target CRS" value={target} onChange={setTarget} headers={["EPSG:32721", "EPSG:4326"]} C={C} />
      </div>
      {mode === "point" ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ColSelect label="X / longitude column" value={xCol} onChange={setXCol} headers={headers} C={C} />
          <ColSelect label="Y / latitude column" value={yCol} onChange={setYCol} headers={headers} C={C} />
          <TextInput label="Output X column" value={outX} onChange={setOutX} C={C} />
          <TextInput label="Output Y column" value={outY} onChange={setOutY} C={C} />
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ColSelect label="WKT geometry column" value={wktCol} onChange={setWktCol} headers={headers} C={C} />
          <TextInput label="Output WKT column" value={outWkt} onChange={setOutWkt} C={C} />
        </div>
      )}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label="Transform CRS" />
        {result && <span style={{ fontSize: 9, color: C.teal }}>OK: {rows.length} rows transformed</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={result.cols} C={C} />}
    </div>
  );
}

// 1. Distance to Point
