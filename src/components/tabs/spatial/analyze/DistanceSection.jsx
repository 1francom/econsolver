// ─── ECON STUDIO · spatial/analyze/DistanceSection.jsx ─ (moved verbatim from SpatialTab.jsx)
import { useState } from "react";
import { useTheme } from "../../../../ThemeContext.jsx";
import { ColSelect, NumInput, TextInput, ApplyBtn, ResultPreview, ErrBanner } from "../shared/atoms.jsx";
import { guessLatCol, guessLonCol } from "../shared/guess.js";
import { assignDistance, assignDistanceMetric, addDistanceBins } from "../../../../math/SpatialEngine.js";
import { useSessionLog } from "../../../../services/session/sessionLog.jsx";

export function DistanceSection({ rows, headers, onResult, C }) {
  const { T } = useTheme();
  const { appendLog } = useSessionLog();
  const [latCol,   setLatCol]   = useState(() => guessLatCol(headers));
  const [lonCol,   setLonCol]   = useState(() => guessLonCol(headers));
  const [refLat,   setRefLat]   = useState("");
  const [refLon,   setRefLon]   = useState("");
  const [outCol,   setOutCol]   = useState("dist_km");
  const [metric,   setMetric]   = useState(false);
  const [binCol,   setBinCol]   = useState("");
  const [result,   setResult]   = useState(null);
  const [err,      setErr]      = useState("");

  const canApply = latCol && lonCol && refLat !== "" && refLon !== "" && outCol;

  function apply() {
    setErr("");
    try {
      let out = metric
        ? assignDistanceMetric(rows, latCol, lonCol, Number(refLat), Number(refLon), outCol, "EPSG:32721")
        : assignDistance(rows, latCol, lonCol, Number(refLat), Number(refLon), outCol);
      const cols = [outCol];
      if (metric && binCol.trim()) {
        out = addDistanceBins(out, outCol, binCol.trim());
        cols.push(binCol.trim());
      }
      setResult({ rows: out, cols });
      appendLog({ module: "spatial", opType: "distance", params: { latCol, lonCol, refLat: Number(refLat), refLon: Number(refLon), outCol, metric }, label: `Distance → ${outCol}${metric ? " (metric)" : ""}` });
      onResult(out, cols, null, { kind: "step", step: {
        type: "sp_distance", latCol, lonCol,
        refLat: Number(refLat), refLon: Number(refLon),
        outCol, metric, binCol: metric ? binCol.trim() : "",
      }});
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: T.caption.fontSize, color: C.textMuted, lineHeight: 1.7 }}>
        Computes distance from each observation to a fixed reference point. Metric mode uses EPSG:32721 and returns meters.
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: T.code.fontFamily, fontSize: T.caption.fontSize, color: C.textMuted }}>
        <input type="checkbox" checked={metric} onChange={e => {
          setMetric(e.target.checked);
          setOutCol(e.target.checked ? "dist_m" : "dist_km");
        }} style={{ accentColor: C.teal }} />
        Use EPSG:32721 metric distance
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <ColSelect label="Latitude column" value={latCol} onChange={setLatCol} headers={headers} C={C} />
        <ColSelect label="Longitude column" value={lonCol} onChange={setLonCol} headers={headers} C={C} />
        <NumInput label="Reference latitude" value={refLat} onChange={setRefLat} C={C} step="any" placeholder="e.g. 48.1374" />
        <NumInput label="Reference longitude" value={refLon} onChange={setRefLon} C={C} step="any" placeholder="e.g. 11.5755" />
        <TextInput label="Output column name" value={outCol} onChange={setOutCol} C={C} placeholder="dist_km" />
        {metric && <TextInput label="Distance bin column" value={binCol} onChange={setBinCol} C={C} placeholder="dist_bin (optional)" />}
      </div>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <ApplyBtn onClick={apply} disabled={!canApply} C={C} />
        {result && <span style={{ fontSize: T.caption.fontSize, color: C.teal }}>✓ {result.rows.length} rows processed</span>}
      </div>
      <ErrBanner msg={err} C={C} />
      {result && <ResultPreview rows={result.rows} newCols={[...result.cols, latCol, lonCol]} C={C} />}
    </div>
  );
}

// 2. Buffer Indicator
