// ─── ECON STUDIO · spatial/analyze/MetricBufferSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState, useMemo } from "react";
import { mono, BUFFER_RADIUS_PRESETS, formatRadiusLabel } from "../shared/constants.js";
import { ColSelect, NumInput, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol, guessWktCol } from "../shared/guess.js";
import { createMetricPointBuffers, countPointsWithinGridCentroidBuffer } from "../../../../math/SpatialEngine.js";

export function MetricBufferSection({ rows, headers, availableDatasets, onResult, C }) {
  const [mode, setMode] = useState("point_buffers");
  const [latCol, setLatCol] = useState(() => guessLatCol(headers));
  const [lonCol, setLonCol] = useState(() => guessLonCol(headers));
  const [radiusPreset, setRadiusPreset] = useState("100");
  const [customRadius, setCustomRadius] = useState("");
  const [gridDsId, setGridDsId] = useState("");
  const [wktCol, setWktCol] = useState("");
  const [outPrefix, setOutPrefix] = useState("points");
  const [result, setResult] = useState(null);
  const [err, setErr] = useState("");

  const radius = radiusPreset === "custom" ? Number(customRadius) : Number(radiusPreset);
  const radiusText = formatRadiusLabel(radius);
  const gridDs = availableDatasets.find(ds => ds.id === gridDsId);
  const gridHeaders = gridDs?.headers ?? [];
  const guessedWkt = useMemo(() => guessWktCol(gridHeaders), [gridHeaders]);
  const effectiveWkt = wktCol || guessedWkt;
  const prefix = (outPrefix || "points").trim() || "points";
  const countCol = `${prefix}_within_${radiusText}`;
  const radiusCol = `${prefix}_buffer_radius_m`;

  const canApply = latCol && lonCol && isFinite(radius) && radius > 0 &&
    (mode === "point_buffers" || (gridDs?.rows?.length && effectiveWkt));

  function apply() {
    setErr("");
    try {
      if (mode === "point_buffers") {
        const out = createMetricPointBuffers(rows, latCol, lonCol, radius, {
          metricCrs: "EPSG:32721",
          segments: 48,
        });
        const cols = [
          "buffer_id",
          "buffer_radius_m",
          "center_lon",
          "center_lat",
          "center_x",
          "center_y",
          "geometry",
          "metric_geometry",
        ];
        const valid = out.filter(r => r.geometry).length;
        setResult({ rows: out, cols, message: `${valid} buffers created` });
        onResult(out, cols, headers);
        return;
      }

      const out = countPointsWithinGridCentroidBuffer(
        gridDs.rows,
        effectiveWkt,
        rows,
        latCol,
        lonCol,
        radius,
        prefix,
        { metricCrs: "EPSG:32721", outCol: countCol }
      );
      const cols = [countCol, radiusCol];
      setResult({ rows: out, cols, message: `${out.length} grid cells processed` });
      onResult(out, cols, gridHeaders);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 10, color: C.textMuted, lineHeight: 1.7 }}>
        Metric buffers use EPSG:32721, so preset radii are real meters. Create buffer polygons from point rows or count active points around grid centroids.
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {[["point_buffers", "Create buffers"], ["grid_centroids", "Count near grid centroids"]].map(([v, label]) => (
          <button key={v} onClick={() => setMode(v)}
            style={{ padding: "3px 10px", fontFamily: mono, fontSize: 9, cursor: "pointer",
              background: mode === v ? `${C.teal}18` : "transparent",
              border: `1px solid ${mode === v ? C.teal : C.border2}`,
              borderRadius: 3, color: mode === v ? C.teal : C.textDim }}
          >{label}</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Point latitude" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Point longitude" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            Buffer radius
          </label>
          <select value={radiusPreset} onChange={e => setRadiusPreset(e.target.value)}
            style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
            {BUFFER_RADIUS_PRESETS.map(([label, value]) => <option key={value} value={String(value)}>{label}</option>)}
            <option value="custom">custom</option>
          </select>
        </div>
        {radiusPreset === "custom" ? (
          <NumInput label="Custom radius (m)" value={customRadius} onChange={setCustomRadius} C={C} min={1} step={1} />
        ) : (
          <TextInput label="Output radius" value={`${radiusText} (EPSG:32721)`} onChange={() => {}} C={C} />
        )}
      </div>

      {mode === "grid_centroids" && (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            <label style={{ fontSize: 9, color: C.textMuted, letterSpacing: "0.12em", textTransform: "uppercase" }}>Grid dataset</label>
            <select value={gridDsId} onChange={e => { setGridDsId(e.target.value); setWktCol(""); }}
              style={{ padding: "4px 8px", background: C.surface, border: `1px solid ${C.border2}`, borderRadius: 3, color: C.text, fontFamily: mono, fontSize: 10, outline: "none" }}>
              <option value="">select grid dataset</option>
              {availableDatasets.map(ds => <option key={ds.id} value={ds.id}>{ds.filename ?? ds.name ?? ds.id}</option>)}
            </select>
          </div>
          {gridDs && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <ColSelect label="Grid WKT column" value={effectiveWkt} onChange={setWktCol} headers={gridHeaders} C={C} />
              <TextInput label="Output prefix" value={outPrefix} onChange={setOutPrefix} C={C} placeholder="schools" />
            </div>
          )}
        </>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} label={mode === "point_buffers" ? "Create buffers" : "Count points"} />
        {result && <span style={{ fontSize: 9, color: C.teal }}>OK: {result.message}</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={result.cols} C={C} />}
    </div>
  );
}

// 3. Grid Assignment
